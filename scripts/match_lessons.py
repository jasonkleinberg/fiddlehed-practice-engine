#!/usr/bin/env python3
"""
match_lessons.py — Curation gate + missing-XML gap report.

Two jobs:
  1. CURATION: match each in-scope Dropbox MusicXML to a published lesson
     (via the AI tutor lesson YAMLs, which carry page_url). A match = in-scope
     for the engine + supplies videoLessonUrl.
  2. GAP: surface course tunes whose XML source appears to be lost — folders
     in the course tree that hold a sheet-music PDF but no MusicXML beside it.

Outputs a markdown report. Read-only; writes nothing except the report.

Usage:
  python3 scripts/match_lessons.py [--dropbox PATH] [--yamls PATH] [--out FILE]
"""

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from import_song import extract_metadata, slugify  # noqa: E402

DEFAULT_DROPBOX = Path("/sessions/gracious-elegant-dirac/mnt/Dropbox")
DEFAULT_YAMLS = (
    Path(__file__).resolve().parent.parent.parent
    / "fiddlehed-ai-tutor-data"
)

# Folders that are out of scope for the student-facing engine.
EXCLUDE = (
    "zzz_someday", "viola", "archive", "selective sync conflict",
    "practice playground", "older files",
)
# Course content lives here; used to scope the PDF-vs-XML gap scan.
COURSE_TREE = "content projects"

MUSIC_EXTS = (".musicxml", ".mxl", ".xml")

# Variation suffix tokens stripped to collapse a lesson to its base tune.
SUFFIX_TOKENS = {
    "adding", "double", "stops", "stop", "variation", "variations", "upper",
    "lower", "octave", "basic", "made", "easy", "slow", "fast", "version",
    "advanced", "beginner", "intermediate", "with", "drone", "drones",
    "chords", "harmony", "part", "parts", "the", "a", "in", "and", "of",
    "d", "g", "c", "e", "a", "bb", "f",  # key letters
}


def is_inscope(path: Path) -> bool:
    low = str(path).lower()
    return not any(x in low for x in EXCLUDE)


def is_musicxml(path: Path) -> bool:
    if path.suffix.lower() in (".musicxml", ".mxl"):
        return True
    if path.suffix.lower() == ".xml":
        try:
            head = path.read_bytes()[:600].lower()
        except OSError:
            return False
        return b"score-partwise" in head or b"score-timewise" in head
    return False


def collect_xml(dropbox: Path):
    files = []
    for ext in MUSIC_EXTS:
        files += dropbox.rglob(f"*{ext}")
    out = []
    for f in sorted(set(files)):
        if not is_inscope(f) or not is_musicxml(f):
            continue
        try:
            meta = extract_metadata(f)
            title = meta["title"]
        except Exception:  # noqa: BLE001
            title = f.stem
        out.append({"path": f, "title": title, "slug": slugify(title)})
    return out


def load_lessons(yamls: Path):
    """Light YAML scrape — only the fields we need, no yaml dependency."""
    lessons = []
    for d in ("core_lesson_yamls", "bonus-lesson-yamls", "workshop_yamls"):
        for yf in (yamls / d).glob("*.y*ml"):
            text = yf.read_text(errors="ignore")
            title = _scrape(text, "lesson_title") or yf.stem
            url = _scrape(text, "page_url")
            tags = _scrape(text, "tags") or ""
            play_along = "play_along" in tags or "play_along" in text
            lessons.append({
                "title": title, "url": url, "play_along": play_along,
                "base": base_tune(title),
            })
    return lessons


def _scrape(text, key):
    m = re.search(rf"^{re.escape(key)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip().strip("'\"") if m else ""


def base_tune(lesson_title: str) -> str:
    # Drop leading lesson number like "17.07_" or "12.05 ".
    t = re.sub(r"^\d+\.\d+[_\s]*", "", lesson_title)
    toks = [w for w in re.split(r"[^a-z0-9]+", t.lower()) if w]
    kept = [w for w in toks if w not in SUFFIX_TOKENS]
    return "-".join(kept) if kept else "-".join(toks)


def tokset(slug: str):
    return {t for t in slug.split("-") if t}


def match_score(a: str, b: str) -> float:
    ta, tb = tokset(a), tokset(b)
    if not ta or not tb:
        return 0.0
    if a in b or b in a:
        return 1.0
    inter = ta & tb
    return len(inter) / len(ta | tb)


def best_lesson(xml_slug: str, lessons):
    best, score = None, 0.0
    for L in lessons:
        s = max(match_score(xml_slug, L["base"]),
                match_score(xml_slug, slugify(L["title"])))
        if s > score:
            best, score = L, s
    return best, score


def pdf_without_xml(dropbox: Path):
    """Course-tree folders with a sheet-music PDF but no MusicXML nearby."""
    gaps = []
    for pdf in dropbox.rglob("*.pdf"):
        low = str(pdf).lower()
        if COURSE_TREE not in low or not is_inscope(pdf):
            continue
        # Look for any music file in the PDF's folder or its parent.
        scope_dirs = {pdf.parent, pdf.parent.parent}
        has_xml = any(
            is_musicxml(m)
            for d in scope_dirs if d.exists()
            for m in d.rglob("*") if m.suffix.lower() in MUSIC_EXTS
        )
        if not has_xml:
            gaps.append(pdf)
    return gaps


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dropbox", default=str(DEFAULT_DROPBOX))
    p.add_argument("--yamls", default=str(DEFAULT_YAMLS))
    p.add_argument("--out", default=str(
        Path(__file__).resolve().parent.parent / "LIBRARY_GAP_REPORT.md"))
    p.add_argument("--threshold", type=float, default=0.5)
    args = p.parse_args()

    dropbox, yamls = Path(args.dropbox), Path(args.yamls)
    xmls = collect_xml(dropbox)
    lessons = load_lessons(yamls)
    play = [L for L in lessons if L["play_along"]]

    # De-dup XMLs by slug, remembering how many copies exist.
    by_slug = {}
    for x in xmls:
        by_slug.setdefault(x["slug"], {"title": x["title"], "paths": []})
        by_slug[x["slug"]]["paths"].append(x["path"])

    matched, unmatched_xml = [], []
    for slug, info in sorted(by_slug.items()):
        L, score = best_lesson(slug, lessons)
        if L and score >= args.threshold:
            matched.append((info["title"], slug, L["title"], L["url"], score,
                            len(info["paths"])))
        else:
            unmatched_xml.append((info["title"], slug, score))

    pdf_gaps = pdf_without_xml(dropbox)

    # ── Write report ──
    out = []
    out.append("# Library Gap Report")
    out.append(f"_Generated {Path(__file__).name}. "
               f"In-scope XML tunes: {len(by_slug)} | "
               f"play-along lessons: {len(play)}_\n")

    out.append("## 1. Importable now — XML exists & matches a lesson\n")
    out.append("| Tune (from XML) | Matched lesson | Lesson URL | copies |")
    out.append("|---|---|---|---|")
    for title, slug, ltitle, url, score, n in matched:
        out.append(f"| {title} | {ltitle} | {url or '—'} | {n} |")
    out.append("")

    out.append("## 2. XML present but NOT in the lesson dataset — confirm manually\n")
    out.append("_These tunes have a usable XML but no matching AI-tutor lesson YAML. "
               "The YAML set isn't a complete tune index, so most are likely real "
               "published/bonus lessons whose URL just needs confirming (or holiday/"
               "one-off tunes). Not 'missing' — just unmatched._\n")
    out.append("| Tune (from XML) | slug | best score |")
    out.append("|---|---|---|")
    for title, slug, score in unmatched_xml:
        out.append(f"| {title.replace(chr(10), ' ')} | {slug} | {score:.2f} |")
    out.append("")

    out.append("## 3. Sheet music exists but XML source appears LOST\n")
    out.append("_Course-tree tune folders with a sheet-music PDF but no MusicXML "
               "anywhere nearby — the 'poor file management' cases. To import these, "
               "the XML must be re-engraved from the PDF._\n")
    if pdf_gaps:
        # Group by tune folder so duet score/violin-1/violin-2 collapse to one line.
        generic = {
            "sheet music", "sheet_music", "score", "violin 1", "violin 2",
            "violin1", "violin2", "learning version", "performance version",
            "updated sheet music", "fiddlehed course duets", "duets", "parts",
            "no ds", "with ds",
        }
        folders = {}
        for pdf in pdf_gaps:
            rel = pdf.relative_to(dropbox)
            # Walk up from the PDF past generic subfolders to the real tune folder.
            tune_folder = pdf.parent.name
            for anc in pdf.parents:
                if anc.name.lower() in generic or anc.name.lower().startswith("violin"):
                    continue
                tune_folder = anc.name
                break
            folders.setdefault(tune_folder, 0)
            folders[tune_folder] += 1
        out.append("| Tune folder (under Content Projects) | PDF files |")
        out.append("|---|---|")
        for f, n in sorted(folders.items()):
            out.append(f"| {f} | {n} |")
    else:
        out.append("_None found._")
    out.append("")

    Path(args.out).write_text("\n".join(out) + "\n")

    # ── Console summary ──
    print(f"In-scope XML tunes (unique): {len(by_slug)}")
    print(f"  ✓ matched to a lesson:     {len(matched)}")
    print(f"  ? need manual match:       {len(unmatched_xml)}")
    print(f"Play-along lessons total:    {len(play)}")
    print(f"PDF-but-no-XML (lost source):{len(pdf_gaps)}")
    print(f"\nReport → {args.out}")


if __name__ == "__main__":
    main()
