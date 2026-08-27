# Beta Fix Plan — from Jason's QA spreadsheet (2026-08-26)

Source: "Practice Engine" QA sheet (69 tunes checked). Deadline context: PE beta runs
second half of September, closes by Oct 2 — all NECESSARY items should land by ~Sep 12.

Verdict counts from the sheet: 20 rows marked **fix** · ~20 marked **good, optional fix
for beta** · rest good. Plus 8 GENERAL notes at the bottom.

---

## The big unlock

Both the audio engine AND the sheet display (OSMD) read the **same raw MusicXML** at load
time. So a small load-time preprocessor in playalong.js can fix two "general" complaints
across all 70 files at once — zero XML editing:

1. **Chord-every-bar overkill** → strip consecutive duplicate `<harmony>` nodes before
   render/parse. Jason wrote "if Claude can fix all the XML files, ideal; if not, skip" —
   the engine-level fix makes it nearly free, AND it may fix part of the **pulsing**
   complaint: the organ currently re-attacks on every repeated chord, once per bar.
2. **Metronome indications in sheet music** → strip `<metronome>` directions at load.

---

## Bucket A — Engine fixes (code; one place, fixes everything)

| # | Fix | Where | Effort |
|---|-----|-------|--------|
| A1 | **Controls unreachable while playing** (must pause to scroll; worst on mobile) — restructure layout: compact sticky transport (Play/Pause/Stop + tempo) and/or move volume sliders above the score, or a collapsible score | playalong.html layout | The one real design task |
| A2 | **Melody lags kick at faster tempos** (>100 BPM, eighth notes) — revisit `lookAhead = 0.35` + `melodyLeadFor()` sample-onset compensation; lead is tempo-scaled and may undercompensate | playalong.js ~486, ~578 | Investigate + tune |
| A3 | **Pulsing on long notes** — hypotheses: organ re-attack per bar (fixed by harmony dedup), sampler release/loop artifacts. Test after A5 | playalong.js audio | Investigate |
| A4 | **Default kick volume 100 → 30** (all three sliders start at 30) | playalong.html line ~358 (`kick-volume` value) | 1 line |
| A5 | **Load-time XML preprocessor** — dedupe repeated `<harmony>`, strip `<metronome>` marks | playalong.js load path | Small, high leverage |
| A6 | **Remove "The red note is what's playing" hint** | playalong.html:342 | 1 line |
| A7 | **Audio/notation desync bugs**: Kesh Jig Double Stops (bar 11 skips last note), Cotton Eyed Joe (kick not on 1&3), Coleraine (kick totally off) — likely parser edge cases (double stops / pickup handling); debug with those three files | playalong.js parser | Investigate |

Remember: bump APP_VERSION + `?v=` together on every visible change.

## Bucket B — Content fixes (per-tune)

**B1. Wrong tune/version loaded — needs correct source (Sibelius/export), JASON:**
- 1.19 Fiddle Fiddle Little Star → should be hoedown Twinkle (also consider retitling lesson)
- 6.04 Bile 'em Cabbage Var 1 → basic version loaded, need the variation
- 10.07 Banshee → currently "Lilting Banshee," need "The Banshee"
- 12.05 Kesh Jig → double-stop version loaded, need single-note
- 17.04 Kerry Polka – Adding Double Stops → not added yet

**B2. Remove from index (Claude):** 16.03 Bile Chord Backup · 16.07 Kerry Polka Backup
Chords ("we'll eventually have a chord viewer for all lessons")

**B3. Chord corrections in XML (Claude can batch):**
- 6.05 Fire on the Mountain — A part starts on A major (+ full check)
- 10.04 Old Joe Clark Var 1 — bar 5 back to A major
- 12.02 Harvest Home — bar 8 A→G · B part bar 10 |A D| · bar 11 |G A| · bar 12 |A| · bars 14–end mirror 6–9
- 16.02 Lucy Farr's — bar chords |F Bb| (+ B repeat, see B4)
- 16.05 House of the Rising Sun — bar 7 |Am E|
- Optional-for-beta: Auld Lang Syne bar 7 |G C| · Soldier's Joy bars 7/15 |D A| · Whiskey Before Breakfast bar 14 |G D|

**B4. Repeat / ending fixes in XML (Claude attempts, Jason verifies by ear):**
- 13.02 Saint Anne's Reel — B repeat not closed (plays once) + bar 8 |G A|
- 16.02 Lucy Farr's — B repeat not closed
- 9.09 Fisher's Hornpipe — 1st/2nd endings cut off melody
- 14.07 Give the Fiddler a Dram — endings broken, two endings on second half of each part
- 16.09 Done Gone — endings broken (no bracket) — **KEEP 1st/2nd endings here** (unique 2nd ending)
- 8.08 Girl I Left Behind Me — bar 7 D is an octave too high (should be open D) + pickup/repeat
- 14.02 Southwind — pickup into repeats; A pickup = Bb (AL1), B pickup = C (AL2)
- 19.02 Coleraine — key label should read Dm/G · pickups (A: single 8th; B: open D… B1 = B natural, first finger on A)

## Bucket C — Nice-to-have (post-beta unless trivial)

- **Pickup-inside-repeat rewrites** across ~15 tunes ("Peacock Rag does this correctly" — use it as the model). Jason's stated policy: pickups inside the repeat range, avoid 1st/2nd endings (except Done Gone).
- Relative-minor key labels: Shady Grove, Cluck Old Hen, Drunken Sailor, Foggy Dew, Lonesome Fiddle Blues (Dm/Am instead of parent major)
- Danny Boy — half-note pickup bar + matching short final bar
- Hobart's Transformation — AABB repeat structure instead of AB
- Oh Susannah Double Stops — render bottom note with upward stem (one voice, not two)
- Mary Had A Little Lamb — collapse to one part (no B/B1–B4)
- Oh Susannah — double bar between B2 & B3
- The Butterfly — end of A part note overlaps repeat sign (OSMD spacing)
- Angeline the Baker — title lists key of A twice
- Lonesome Fiddle Blues — not yet re-checked (Checked = FALSE)

## Suggested sequence

1. **v1.19 quick wins** (day 1): A4 kick default, A6 hint text, A5 preprocessor, B2 removals
2. **v1.20 layout** (A1) — the scroll/controls fix; test on a real phone
3. **Audio quality pass** (A2, A3, A7) — the three desync tunes are the test bed
4. **Content batch** (B3, B4) — Claude edits XML, Jason spot-checks by ear in the player
5. **Jason's Sibelius exports** (B1) — 5 tunes, can run parallel to everything
6. Bucket C after beta launch, unless a batch script makes one trivial

---

## Status — 2026-08-26 (v1.20, on disk, NOT pushed)

DONE: A2 (lead retuned — ear-check), A4, A5, A6, A7 (all three diagnosed + fixed), B2 (16.03; 16.07 was never indexed), B3 all incl. optionals, B4 (saint-anne's, lucy-farr's, fisher's, dram, done-gone voltas rebuilt; girl-i-left m7 octave), A1 (sliders above score, sticky transport, autoScroll yields to user), coleraine key label.
OPEN: B1 re-exports (Jason) · southwind/coleraine pickup restructures · A3 pulsing re-listen · bucket C.
v1.20 addendum: A2/A3 root-caused — violin samples trimmed + self-hosted (samples/violin/*.wav), onset table re-measured, lead knobs reduced. Validation recording protocol: one capture, melody+kick only, analysis by band-split.
