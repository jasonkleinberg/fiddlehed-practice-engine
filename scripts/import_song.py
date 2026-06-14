#!/usr/bin/env python3
"""
import_song.py — Practice Engine song importer.

Takes a MusicXML (.musicxml / .xml) or compressed MusicXML (.mxl) file and:
  1. validates that it parses,
  2. extracts title, key, time signature, tempo from the score,
  3. normalizes a slug,
  4. copies the file into the engine's /music/ folder,
  5. writes/updates the record in /music/index.json (full schema),
  6. optionally runs the Tabulator to produce DRAFT tabs (flagged for review).

Designed to be safe to re-run (trickle mode): existing human-entered metadata
(videoLessonUrl / difficulty / genre) is preserved unless you pass a new value.

Usage:
  python3 scripts/import_song.py "path/to/Tune.musicxml"
  python3 scripts/import_song.py "path/to/Tune.mxl" --video-url https://... --difficulty beginner --genre old-time
  python3 scripts/import_song.py "a.musicxml" "b.mxl" --no-tabs        # batch, skip tabs
  python3 scripts/import_song.py "Tune.musicxml" --dry-run             # report only, write nothing

Stdlib only. No build step.
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

# ─── Paths ───────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
MUSIC_DIR = REPO_ROOT / "music"
INDEX_FILE = MUSIC_DIR / "index.json"

# Tabulator lives in the sibling fiddlehed-content repo. Override with --tabulator.
DEFAULT_TABULATOR = (
    REPO_ROOT.parent / "fiddlehed-content" / "Projects" / "Tab Converter" / "tab_converter.py"
)

# Circle of fifths: index 0 == 0 sharps/flats (C major / A minor).
_MAJOR_BY_FIFTHS = {
    -7: "Cb", -6: "Gb", -5: "Db", -4: "Ab", -3: "Eb", -2: "Bb", -1: "F",
    0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F#", 7: "C#",
}
_MINOR_BY_FIFTHS = {
    -7: "Ab", -6: "Eb", -5: "Bb", -4: "F", -3: "C", -2: "G", -1: "D",
    0: "A", 1: "E", 2: "B", 3: "F#", 4: "C#", 5: "G#", 6: "D#", 7: "A#",
}


# ─── XML loading ─────────────────────────────────────────────────────
def load_score_xml(path: Path) -> bytes:
    """Return raw MusicXML bytes, transparently unzipping .mxl containers."""
    if path.suffix.lower() == ".mxl":
        with zipfile.ZipFile(path) as zf:
            rootfile = _mxl_rootfile(zf)
            return zf.read(rootfile)
    return path.read_bytes()


def _mxl_rootfile(zf: zipfile.ZipFile) -> str:
    """Find the main score path inside an .mxl using META-INF/container.xml."""
    try:
        container = zf.read("META-INF/container.xml")
        root = ET.fromstring(container)
        # rootfile path is in an attribute; namespaces vary, so search loosely.
        for rf in root.iter():
            if rf.tag.endswith("rootfile") and rf.get("full-path"):
                return rf.get("full-path")
    except KeyError:
        pass
    # Fallback: first non-META-INF .xml/.musicxml entry.
    for name in zf.namelist():
        if name.startswith("META-INF/"):
            continue
        if name.lower().endswith((".xml", ".musicxml")):
            return name
    raise ValueError("No score file found inside .mxl archive")


def _localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _find(root, name):
    """Namespace-agnostic findall by local tag name (returns first or None)."""
    for el in root.iter():
        if _localname(el.tag) == name:
            return el
    return None


def _find_all(root, name):
    return [el for el in root.iter() if _localname(el.tag) == name]


# ─── Metadata extraction ─────────────────────────────────────────────
def extract_metadata(path: Path) -> dict:
    raw = load_score_xml(path)
    root = ET.fromstring(raw)

    return {
        "title": _extract_title(root, path),
        "key": _extract_key(root),
        "timeSignature": _extract_time_sig(root),
        "tempo": _extract_tempo(root),
    }


def _text(el):
    return el.text.strip() if (el is not None and el.text) else ""


def _extract_title(root, path: Path) -> str:
    for tag in ("work-title", "movement-title"):
        el = _find(root, tag)
        if _text(el):
            return _text(el)
    # Fallback: first credit-words, else filename stem.
    cw = _find(root, "credit-words")
    if _text(cw):
        return _text(cw)
    return path.stem


def _extract_key(root):
    fifths_el = _find(root, "fifths")
    if fifths_el is None or not _text(fifths_el):
        return ""
    try:
        fifths = int(_text(fifths_el))
    except ValueError:
        return ""
    mode_el = _find(root, "mode")
    mode = (_text(mode_el) or "major").lower()
    if mode == "minor":
        tonic = _MINOR_BY_FIFTHS.get(fifths)
        return f"{tonic} minor" if tonic else ""
    tonic = _MAJOR_BY_FIFTHS.get(fifths)
    return f"{tonic} major" if tonic else ""


def _extract_time_sig(root):
    beats = _find(root, "beats")
    beat_type = _find(root, "beat-type")
    if _text(beats) and _text(beat_type):
        return f"{_text(beats)}/{_text(beat_type)}"
    return ""


def _extract_tempo(root):
    # 1) Explicit playback tempo: <sound tempo="120"/>
    for snd in _find_all(root, "sound"):
        if snd.get("tempo"):
            try:
                return round(float(snd.get("tempo")))
            except ValueError:
                pass
    # 2) Notated metronome: <per-minute>120</per-minute>
    pm = _find(root, "per-minute")
    if _text(pm):
        try:
            return round(float(_text(pm)))
        except ValueError:
            pass
    return None  # not embedded — flagged downstream


# ─── Slug ────────────────────────────────────────────────────────────
def slugify(title: str) -> str:
    s = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


# ─── Index I/O ───────────────────────────────────────────────────────
SCHEMA_KEYS = [
    "file", "title", "slug", "key", "timeSignature", "tempo",
    "videoLessonUrl", "difficulty", "genre", "tabsFile", "status",
]


def load_index() -> list:
    if INDEX_FILE.exists():
        return json.loads(INDEX_FILE.read_text())
    return []


def save_index(records: list):
    INDEX_FILE.write_text(json.dumps(records, indent=2) + "\n")


def blank_record() -> dict:
    return {k: ("" if k != "tempo" else None) for k in SCHEMA_KEYS}


# ─── Tabulator ───────────────────────────────────────────────────────
def run_tabulator(src: Path, slug: str, tabulator: Path) -> tuple:
    """Run the Tabulator. Returns (tabs_filename, status_note)."""
    if not tabulator.exists():
        return "", "tabulator-not-found"
    try:
        result = subprocess.run(
            [sys.executable, str(tabulator), str(src)],
            capture_output=True, text=True, timeout=60,
        )
    except Exception as e:  # noqa: BLE001
        return "", f"tab-error:{type(e).__name__}"
    if result.returncode != 0 or not result.stdout.strip():
        return "", "tab-failed"
    tabs_name = f"{slug}.tabs.txt"
    (MUSIC_DIR / tabs_name).write_text(result.stdout)
    return tabs_name, "ok"


# ─── Import one file ─────────────────────────────────────────────────
def import_file(path: Path, args) -> dict:
    report = {"input": str(path), "ok": False, "flags": []}

    if not path.exists():
        report["error"] = "file not found"
        return report
    if path.suffix.lower() not in (".musicxml", ".xml", ".mxl"):
        report["error"] = f"unsupported extension {path.suffix}"
        return report

    try:
        meta = extract_metadata(path)
    except Exception as e:  # noqa: BLE001
        report["error"] = f"parse failed: {e}"
        return report

    slug = slugify(meta["title"])
    dest_name = f"{slug}{path.suffix.lower()}"
    report.update(slug=slug, **meta)

    # Merge into existing record (preserve human-entered fields).
    records = load_index()
    rec = next((r for r in records if r.get("slug") == slug), None)
    is_new = rec is None
    if is_new:
        rec = blank_record()
    else:
        # Backfill any schema keys missing from older/partial records.
        for k in SCHEMA_KEYS:
            rec.setdefault(k, None if k == "tempo" else "")

    rec["file"] = dest_name
    rec["title"] = meta["title"]
    rec["slug"] = slug
    rec["key"] = meta["key"]
    rec["timeSignature"] = meta["timeSignature"]
    rec["tempo"] = meta["tempo"]
    if args.video_url:
        rec["videoLessonUrl"] = args.video_url
    if args.difficulty:
        rec["difficulty"] = args.difficulty
    if args.genre:
        rec["genre"] = args.genre

    # Flags for the verification report.
    if meta["tempo"] is None:
        report["flags"].append("needs-tempo")
    if not rec["videoLessonUrl"]:
        report["flags"].append("no-video-url")

    status = "playable"

    if args.dry_run:
        report["ok"] = True
        report["would_write"] = dest_name
        report["new_record"] = is_new
        report["status"] = status
        return report

    # Copy the score into /music/.
    MUSIC_DIR.mkdir(exist_ok=True)
    shutil.copy2(path, MUSIC_DIR / dest_name)

    # Tabs (non-blocking).
    if not args.no_tabs:
        tabs_name, tab_status = run_tabulator(path, slug, Path(args.tabulator))
        rec["tabsFile"] = tabs_name
        if tab_status == "ok":
            status = "needs-tab-review"  # draft tabs exist, await human review
            report["flags"].append("needs-tab-review")
        else:
            report["flags"].append(tab_status)
    rec["status"] = status

    if is_new:
        records.append(rec)
    save_index(records)

    report["ok"] = True
    report["status"] = status
    report["new_record"] = is_new
    return report


# ─── CLI ─────────────────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser(description="Import a tune into the practice engine.")
    p.add_argument("files", nargs="+", help="MusicXML / .mxl file(s) to import")
    p.add_argument("--video-url", default="", help="FiddleHed lesson page URL")
    p.add_argument("--difficulty", default="", help="e.g. beginner / intermediate")
    p.add_argument("--genre", default="", help="e.g. old-time / bluegrass / celtic")
    p.add_argument("--no-tabs", action="store_true", help="skip Tabulator step")
    p.add_argument("--tabulator", default=str(DEFAULT_TABULATOR),
                   help="path to tab_converter.py")
    p.add_argument("--dry-run", action="store_true", help="report only; write nothing")
    args = p.parse_args()

    reports = [import_file(Path(f), args) for f in args.files]

    # ── Summary ──
    print("\n=== IMPORT REPORT ===")
    for r in reports:
        if r["ok"]:
            flags = (" [" + ", ".join(r["flags"]) + "]") if r["flags"] else ""
            tempo = r.get("tempo")
            tempo_str = tempo if tempo is not None else "—"
            verb = "DRY-RUN" if args.dry_run else ("NEW" if r.get("new_record") else "UPDATED")
            print(f"  ✓ {verb}: {r.get('title')}  ({r.get('key') or '?'}, "
                  f"{r.get('timeSignature') or '?'}, tempo {tempo_str}) "
                  f"→ {r.get('slug')}{flags}")
        else:
            print(f"  ✗ FAILED: {r['input']} — {r.get('error')}")
    ok = sum(1 for r in reports if r["ok"])
    print(f"\n{ok}/{len(reports)} imported.")


if __name__ == "__main__":
    main()
