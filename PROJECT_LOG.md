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
