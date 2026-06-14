# New-Song Workflow

_How a tune goes from raw source to playable in the practice engine. Designed in a Cowork planning session, 2026-06-13._

---

## The decisions behind this

- **Source of truth = Dropbox.** The raw `.musicxml`/`.mxl` files live in Jason's Dropbox (Sibelius exports). There is no Dropbox connector — the folder is reached by mounting it into Cowork. Files are *copied* into the engine repo; Dropbox stays the master.
- **Library scope = tunes with a published lesson.** A tune belongs in the engine only if it has a real FiddleHed video lesson. This keeps viola parts, `zzz_SOMEDAY` experiments, and archive dupes out, and it doubles as the source for each tune's lesson URL.
- **Lesson matching source = AI tutor lesson YAMLs.** The `fiddlehed-ai-tutor-data` YAMLs are local, structured, and carry a `page_url` field. Matching a tune to a YAML both confirms scope and supplies `videoLessonUrl` for free. WordPress / Content Release Schedule are fallbacks for ambiguous cases.
- **Full metadata schema now, blanks allowed.** Auto-extractable fields (key, time sig, tempo) are filled during import at zero cost. Human-judgment fields (video URL, difficulty, genre) get a slot in every record so back-filling later is a one-field edit, never a restructure or a second full pass.
- **Tabs are non-blocking.** The Tabulator (`fiddlehed-content/Projects/Tab Converter/tab_converter.py`) still needs hardening, so its output is saved as a draft and flagged for review. A tune registers and plays even without finalized tabs.

---

## Pipeline

| Step | What happens | Blocking? |
|------|--------------|-----------|
| 1. Source | Tune as `.musicxml`/`.mxl` in Dropbox | — |
| 2. Curate | Match tune name → AI tutor lesson YAML. Match = in-scope + captures `videoLessonUrl` | **gate** |
| 3. Ingest | Validate it parses; unzip `.mxl` if needed; normalize filename to slug | yes |
| 4. Auto-extract | title, key, time signature, tempo (read from the XML) | yes |
| 5. Human meta | difficulty, genre — fill what's on hand, blanks OK | no |
| 6. Tabs | Run Tabulator → save draft `.txt`, set status `needs-tab-review` | no |
| 7. Output | Copy file to `/music/`, write `index.json` record, save tabs alongside | yes |

**Bulk mode:** run steps 2–7 across all matched tunes, then emit a verification report (clean / needs-tempo / needs-tab-review / no-video-URL).
**Trickle mode:** the same pipeline on a single new file.

---

## `index.json` record schema

```json
{
  "file": "Oh Susanna.musicxml",
  "title": "Oh Susanna",
  "slug": "oh-susanna",
  "key": "",
  "timeSignature": "",
  "tempo": null,
  "videoLessonUrl": "",
  "difficulty": "",
  "genre": "",
  "tabsFile": "",
  "status": "playable"
}
```

`status` values: `playable`, `needs-tab-review` (and room for more, e.g. `needs-meta`).

---

## Current state (2026-06-13)

- Engine: static AlphaTab page, plays one tune from `/music/`, tiny `index.json` (2 songs: Oh Susanna, Orange Blossom Special).
- Dropbox holds ~52 music files (13 `.musicxml` + 39 `.mxl`) scattered across the FiddleHed tree — much of it out of scope (viola versions, someday, archive conflicts).
- AI tutor data: 617 YAMLs with `page_url` fields, ready to match against.

## Build order

1. ✅ This spec.
2. Import script (single file → validated, extracted, copied, registered). Test on the 2 existing tunes.
3. Curation/matching pass (52 Dropbox tunes ↔ lesson YAMLs → in-scope list + flagged report).
4. Bulk import + verification report.
