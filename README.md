# FiddleHed Play-Along Player

A practice tool for fiddle and violin students. Think SoundSlice, but built specifically for FiddleHed — and eventually integrated with an AI tutor into a unified practice environment.

---

## Long-Term Vision

Students won't navigate a website. They'll live in a single practice window that does everything:

- **The player is the center.** Students cue up a tune and practice.
- **AI tutor is always available** via chat — students can ask questions without leaving.
- **The tutor surfaces resources on demand:** sheet music, tabs, video lessons, text tips.
- **Performance feedback** is built in — students record themselves, compare to the reference track, and get AI-evaluated feedback on timing and pitch.

This dovetails with the [AI Tutor project](../fiddlehed-ai-tutor-data/). They're being developed separately for now but are designed to merge. The unified UI is a third project that combines both.

The long-term paradigm shift: the course website becomes a resource library that the AI pulls from — not a place students navigate.

---

## Project Phases

### Phase 0 — Background / Admin Work (can be done anytime)
- Audit and organize existing MusicXML files from course tunes
- Establish a consistent file naming convention
- Build a simple inventory spreadsheet: tune name, key, time signature, MusicXML file status, MIDI status
- Research AlphaTab library in depth (see Tech section)

### Phase 1 — MVP: Single-Song MIDI Player (web app)
**Goal:** One tune, playable in the browser, with tempo control. Proof of concept.

**Features:**
- Load a single MusicXML or MIDI file
- Playback with a decent violin/fiddle soundfont
- Tempo slider (e.g. 50%–150% of original speed)
- Basic loop: select a bar range and repeat it

**Not in MVP:**
- Transposition (Phase 2)
- Multiple tunes
- Recording
- Sheet music display

**Tech stack:**
- React (or plain HTML/JS for true simplicity)
- AlphaTab — handles MusicXML parsing, sheet music rendering, soundfont playback, tempo, and looping out of the box
- Fallback: Tone.js + @tonejs/midi + soundfont-player if AlphaTab is overkill for MVP

**Deliverable:** A hosted web page (GitHub Pages or similar) that plays one tune.

### Phase 2 — Real Library + More Tunes
- AlphaTab fully integrated with sheet music display
- Multiple tunes selectable
- Transposition control
- Better soundfont (Salamander or similar high-quality violin samples)
- Import pipeline for MusicXML files from course

### Phase 3 — Recording + A/B Comparison
- Mic input via WebAudio API
- Play-along mode: backing track + student records simultaneously
- Side-by-side playback (student vs. reference)
- Headphone-friendly design

### Phase 4 — AI Performance Evaluation
- Pitch detection (pitchfinder, aubio via WASM, or send audio to a model)
- Timing/rhythm analysis vs. expected beat grid
- Simple feedback: "Your D was a bit flat" / "You rushed bars 5–6"
- This is where the AI Tutor project connects

---

## Key Technology

**AlphaTab** — the most important library to evaluate first.
- Open-source, web-native
- Parses MusicXML and Guitar Pro files
- Renders sheet music in the browser
- Built-in soundfont playback
- Tempo control and looping built in
- Docs: https://www.alphatab.net/

**Supporting libraries:**
- Tone.js — audio synthesis and scheduling
- @tonejs/midi — MIDI file parsing
- soundfont-player — lightweight soundfont playback
- pitchfinder — JS pitch detection for Phase 4
- Web Audio API — recording, analysis

---

## Related Projects
- `fiddlehed-ai-tutor-data` — AI tutor (separate project, future integration)
- `metrodrone` — drone pitch reference tool. Currently standalone, but eventually becomes a built-in component of the practice environment. When a student is working on a tune in A, the drone for that key should be one click away.
- `fiddlehed-content` — course content, likely source of MusicXML files

---

## Decisions Made

- **Notation software:** Sibelius — MusicXML exports come from there
- **MVP stack:** Plain HTML (faster to build, easier to deploy, no build step)
- **Hosting:** GitHub Pages — already proven with MetroDrone, free, easy to deploy. FiddleHed subdomain integration is a later step once things stabilize.
- **Phase 1 dev resource:** Claude Code. Build the MVP AI-assisted, validate the concept, then assess whether a human dev is needed for later phases.
- **MVP goal:** Simple enough to demo with students during an upcoming lesson on a new song.

---

## Session Logging

Every Claude Code session should start by reading this file and `PROJECT_LOG.md`, and end by logging what was changed and any decisions made. This compensates for AI having no persistent memory between sessions.

---

## First Steps (whenever there's bandwidth)
1. Audit MusicXML files in `fiddlehed-content` — count them, check quality, pick one clean tune as the MVP test song
2. Start a Claude Code session: "Read README.md and PROJECT_LOG.md, then build a plain HTML AlphaTab proof-of-concept for [tune name]"
3. Deploy to GitHub Pages
4. Demo with students during an upcoming lesson — collect informal feedback
5. Iterate from there
