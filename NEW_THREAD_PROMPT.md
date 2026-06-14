# Handoff prompt — build the 3-layer play-along player (new thread, Fable)

_Paste the block below to start the build thread._

---

We're building the FiddleHed Practice Engine — a browser play-along tool for fiddle students. Repo: `~/Documents/GitHub/fiddlehed-practice-engine` (I push via GitHub Desktop; it ships to GitHub Pages). Read `NEW_SONG_WORKFLOW.md` and `PROJECT_LOG.md` in the repo first.

**Goal:** a single-tune prototype of a 3-layer play-along player, then generalize. Three synced layers on ONE audio engine (Tone.js):

1. **Melody** — `Tone.Sampler` with real violin samples (pick a good set; the bar to beat is AlphaTab's old sonivox tone, which was mediocre).
2. **Organ chords** — a Tone.js synth (Hammond/drawbar = stacked sine waves), playing chord changes read from the MusicXML `<harmony>` symbols.
3. **Kick beat** — reuse MetroDrone's `Tone.MembraneSynth`. See `~/Documents/GitHub/metrodrone/index.html` for the metronome synth AND its `Tone.Gain` volume-slider pattern.

**Controls:** a tempo slider (already in `js/player.js`), plus a volume slider per layer (melody / organ / kick), copying MetroDrone's gain-slider approach.

**Architecture (locked):** all Tone.js, one Transport/clock — sample-accurate sync and trivial per-layer gain. We dropped AlphaTab on purpose: it only plays *notated notes*, not `<harmony>` chord symbols, and can't produce the MetroDrone kick. AlphaTab may return later only to draw on-screen sheet music.

**Data:** MusicXML melodies are in `/music/`. 12 of 17 in-scope tunes already carry chord symbols in `<harmony>` tags (clean: G, D, Em…). Parsing references: `scripts/import_song.py` (metadata extraction), `scripts/match_lessons.py` (the `<harmony>` chord-extraction logic), and `fiddlehed-content/Projects/Tab Converter/tab_converter.py` (melody-note parsing).

**Prototype tune:** Mississippi Sawyer (D/G/A) or Fire on the Mountain — both already chorded.

**Constraints:** plain HTML + vanilla JS, Tone.js via CDN, no build step.

**Done =** one tune playing melody + organ chords + kick locked together, with a working tempo control and three volume sliders.
