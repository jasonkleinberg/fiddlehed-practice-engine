# Claude Code Brief — Practice Engine MVP

## The Goal

Build a single HTML page that loads one MusicXML file and plays it back with a tempo slider. That's it. Proof of concept, demo-able with a student.

If a fiddle student can slow down a tune and play along, we win. Everything else is Phase 2.

## Before You Start

Read `README.md` and `PROJECT_LOG.md` in this repo. They have the full vision and history. This brief is the narrow slice for *this* build.

## What You're Building

A static web app with:

- One MusicXML file loaded from `/music/`
- AlphaTab handling parsing, soundfont playback, and tempo
- Play / pause / stop buttons
- A tempo slider, 50%–150%

Nothing else. No loop, no sheet music rendering on screen, no tune picker, no recording, no styling beyond what keeps the page legible.

## Stack

- Plain HTML + vanilla JS. No build step, no React.
- AlphaTab via CDN.
- Ships to GitHub Pages.

## File Layout

```
/index.html
/music/
  <tune-name>.musicxml     ← Jason will drop this in
/js/
  player.js                ← AlphaTab setup + controls
/README.md
/PROJECT_LOG.md
```

The MusicXML file goes in `/music/`. One file for now, but the folder name makes room for the next 50 tunes without a rename.

## UI

Bare minimum. A title, the transport buttons, the tempo slider with a percentage readout. Semantic HTML, no CSS framework. Think 1998 but the buttons work.

## What "Done" Looks Like

1. `index.html` loads in the browser.
2. Tune plays with violin soundfont.
3. Tempo slider actually changes playback speed in real time.
4. Play / pause / stop all behave correctly.
5. Deployed to GitHub Pages, URL in the commit.

If any of those fail on a quick local test, it's not done.

## What to NOT Do (MVP Discipline)

- Don't add looping. Tempting, but Phase 2.
- Don't render the sheet music. AlphaTab can — we're skipping it for now to keep the first demo focused on audio.
- Don't build a tune selector. One file, hardcoded.
- Don't install npm packages. CDN only.
- Don't refactor for "future flexibility." One file in `/music/` is fine.

## Session Protocol

- Start: read `README.md` and `PROJECT_LOG.md`.
- End: append an entry to `PROJECT_LOG.md` with what you built, any decisions, and what the next session should pick up. Claude sessions don't carry memory; the log is how we stay sane.

## Questions to Flag, Not Assume

- If the MusicXML file isn't in `/music/` yet, stop and ask. Don't fabricate one.
- If AlphaTab's default soundfont sounds terrible, note it in the log — don't spend an hour hunting for a better one in this pass.
- If something in the README contradicts this brief, this brief wins for this build.
