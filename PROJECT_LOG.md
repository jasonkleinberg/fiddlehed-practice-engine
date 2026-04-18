# Project Log

_Each Claude Code session should append an entry here: what was done, what was decided, what's next._

---

## 2026-04-16 — Project kickoff (Cowork session with Jason)

**What happened:**
- Project conceived: a play-along practice tool for FiddleHed fiddle students
- Researched AlphaTab as primary library candidate (handles MusicXML parsing, sheet music rendering, soundfont playback, tempo, and looping out of the box)
- Documented long-term vision: unified practice environment combining this player with the AI Tutor project
- Set up project folder in GitHub

**Decisions made:**
- MVP = plain HTML, single tune, tempo control, GitHub Pages hosting
- MusicXML source = Sibelius exports
- Phase 1 dev = Claude Code
- Keep this project and the AI Tutor project separate for now; they'll merge into a unified UI eventually
- MetroDrone becomes a built-in component of the future unified environment

**Next session should:**
- Audit MusicXML files in `fiddlehed-content` to find a good MVP tune
- Build a minimal AlphaTab HTML proof-of-concept

---

## 2026-04-18 — MVP built (Claude Code session)

**What happened:**
- Built the Phase 1 MVP per `CLAUDE_CODE_BRIEF.md`: plain HTML + vanilla JS, no build step, AlphaTab via CDN.
- Files added:
  - `index.html` — title, Play/Pause/Stop, tempo slider 50–150% with % readout, status line. Semantic HTML, minimal inline CSS.
  - `js/player.js` — AlphaTab wiring, transport handlers, tempo → `api.playbackSpeed`.
- Single tune: `music/Oh Susanna.musicxml` (loaded manually via `fetch` + `api.load(buffer)` rather than AlphaTab's built-in `core.file` config — see decision below).
- Sheet music intentionally not rendered (container hidden, `display.layoutMode: Horizontal`). AlphaTab logs a "width=0" rendering warning that is expected and harmless for audio-only use.
- Verified end-to-end in a real browser via Playwright:
  - Score loads (title "Oh Susanna", tempo 120, 1 track).
  - Play advances `tickPosition` / `timePosition`.
  - Tempo slider change updates `api.playbackSpeed` live (tested 100% → 75%).
  - Pause freezes position; Stop resets near start. Status text updates through playerStateChanged events.

**Decisions made:**
- **AlphaTab version: `@coderline/alphatab@1.4.3`** via jsDelivr CDN. Soundfont: sonivox.sf2 bundled with the package. Font directory: the package's `/dist/font/` on CDN. Not a great fiddle tone (generic violin patch) but adequate for the first demo — noted in the brief's "don't hunt for a better one in this pass" clause.
- **Manual fetch → `api.load(buffer)` instead of `core.file`.** AlphaTab's built-in file loader never fired `scoreLoaded` in this setup (likely a worker/script path resolution issue with the CDN build). Fetching the MusicXML ourselves and handing the `ArrayBuffer` to the API works reliably and keeps the no-build-step constraint. Worth revisiting in Phase 2 if we want the native loader's progress/streaming behavior.
- **Container hidden, sheet music not rendered.** Per the brief. The `alphatab-container` div exists because AlphaTab requires a host element, but it's `display: none`.
- **No state beyond what's needed.** No loop, no tune picker, no recording, no transposition. Held the line on MVP discipline.

**Known limitations / things Jason should know:**
- Soundfont tone is the stock sonivox violin — fine for demo, not beautiful. Phase 2 target: Salamander or a better fiddle-specific soundfont.
- Pause/Stop both end up in `playerState = 0` (paused). AlphaTab uses the same enum value; Stop additionally seeks to the beginning. UI status just says "Paused." for both; acceptable for MVP.
- Tempo slider is continuous (`input` event) so it updates while dragging.
- Hardcoded tune path and title in `js/player.js` (`TUNE_FILE` / `TUNE_TITLE` constants). Swap the file and the constant when adding a new one.

**Deployment:**
- Not yet pushed to GitHub Pages. Jason pushes via GitHub Desktop (per global CLAUDE.md) — once committed and pushed, enabling Pages on the `main` branch root should be enough. URL will be `https://jasonkleinberg.github.io/fiddlehed-practice-engine/`.

**Next session should:**
- Jason: commit via GitHub Desktop, push, enable GitHub Pages, confirm the hosted URL plays the tune.
- After a student demo: collect feedback — is tempo range (50–150%) the right span? Is sonivox tone tolerable? Do students ask for looping immediately, or does tempo alone carry the first session?
- Phase 2 candidates in priority order: (1) AB loop by bar range, (2) sheet music render + playback cursor, (3) tune picker driven by a simple JSON index of `music/`, (4) better soundfont.
