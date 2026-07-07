# Next step: add a tune selector to the Practice Engine (70 tunes)

Paste this into a fresh coding session. It's self-contained.

## Context

Repo: `~/Documents/GitHub/fiddlehed-practice-engine` (plain HTML/JS, no build step, deploys to GitHub Pages). Read `README.md` and `PROJECT_LOG.md` first — the latest log entry (2026-07-06) explains the current state.

The play-along prototype lives in `playalong.html` + `js/playalong.js`. It's a 3-layer Tone.js player: melody (violin sampler), organ (chords read from MusicXML `<harmony>`), and kick (beat). It already parses melody AND chords and plays all three layers — it's just **locked to one hardcoded tune**:

```js
const TUNE_FILE = "music/oh-susannah.musicxml";   // js/playalong.js ~line 19
```

The full tune library is ready and sitting in `music/`:
- **70 `.musicxml` files**, slug-named (e.g. `shady-grove.musicxml`), every one with chords.
- **`music/index.json`** — an array of records:
  ```json
  { "file": "shady-grove.musicxml", "title": "Shady Grove", "slug": "shady-grove",
    "lesson_id": "7.02", "module": 7, "key": "D", "timeSignature": "4/4",
    "tempo": null, "hasChords": true, "videoLessonUrl": "https://…", "status": "playable" }
  ```

## The task

Let the student pick any of the 70 tunes and have the player load it.

1. **Add a tune selector** to `playalong.html` — a `<select>` dropdown (bonus: a text filter/search box above it, since 70 is a lot to scroll). Populate it from `music/index.json`. Group or order by `module` then `lesson_id`, and show the `title` (optionally the key), e.g. "7.02 · Shady Grove (D)".
2. **Refactor `init()` in `js/playalong.js`**: extract a `loadTune(file)` function from the current one-shot load. On selector change, call `loadTune()` — fetch `music/<file>`, re-parse, rebuild/rewire the schedule, reset the transport to the top, and update the tune title. Make sure playing → switching tunes → playing again works cleanly (stop and clear the old Tone.Transport schedule first so notes don't overlap).
3. **Tempo default:** most files have `tempo: null`. When a tune loads, if its `index.json` tempo is null, default the tempo slider to a sensible value (say 90 BPM) rather than leaving whatever the last tune used. If a tune does carry a tempo, use it.
4. Keep the existing tempo/volume sliders and spacebar-to-play working across tune switches.

## Constraints

- Plain HTML/JS only, no build step, no new dependencies beyond Tone.js (already loaded). Match the existing code style and the simple inline-CSS look.
- Don't touch the `music/` files or `index.json` — treat them as read-only data.
- Handle the async carefully: `Tone.start()` still needs a user gesture; loading a new tune shouldn't require re-clicking Play unless audio context isn't started yet.

## Verify

Playwright is already set up in the repo (`.playwright-mcp/`). Test in a real browser: load `playalong.html`, confirm the dropdown lists 70 tunes, pick 2–3 different ones (e.g. Shady Grove, Frères Jacques, Danny Boy), confirm each loads, shows the right title, and plays melody + chords + kick. Switch tunes mid-playback and confirm no overlap or stuck notes.

## When done

Append a `PROJECT_LOG.md` entry: what changed, any decisions, and what's next (e.g. wiring the video-lesson link, loop/section practice, or the AI-tutor integration).
