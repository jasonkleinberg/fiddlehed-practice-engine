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

---

## 2026-04-18 (later) — Pickup handling, BPM slider, continuous loop

**What happened (order matches the session):**

1. **Pickup gap fix.** Sibelius exports pickup measures as short first bars without the MusicXML `implicit="yes"` flag, and AlphaTab pads the bar to the full time signature with silence — audible as a gap between the pickup notes and bar 2. Added `detectAndFlagPickup(score)` in `scoreLoaded`: if the first bar's content duration is shorter than a full bar, set `masterBars[0].isAnacrusis = true` and call `api.loadMidiForScore()` to regenerate the MIDI. Works generically for any Sibelius tune with a pickup; no-ops for tunes without one.

2. **Continuous loop.** Added a default loop: pickup plays once at the start of each Play session, then the body (bar 2 → bar 17) loops until the user hits Stop. Went through three approaches before landing on the right one — see "Decisions / gotchas" below.

3. **BPM tempo slider (40–200).** Replaced the 50–150% slider with an absolute BPM slider. Reads the tune's native BPM from `score.tempo` at load (120 for Oh Susanna), initializes the slider to that value, computes `api.playbackSpeed = desiredBPM / originalBPM`. Generalizes to any tune.

4. **Project permissions file.** Created `.claude/settings.json` (project-scoped, separate from the auto-populated `.claude/settings.local.json`) with five common read-only MCP permissions: Playwright navigate/wait/click/console-messages, plus context7 query-docs. Runs via the `/fewer-permission-prompts` skill.

**Decisions / gotchas (the useful lessons from this session):**

- **AlphaTab native looping has a "started outside the range" rule.** If `api.play()` is called while `tickPosition` is outside `api.playbackRange`, native wrap goes to `tick 0` — NOT to `playbackRange.startTick`. Only sessions that *start inside* the range wrap to `startTick`. This fights "pickup plays once, then skip" because the pickup-including first play has to start at tick 0 (outside `[loopStartTick, end]`), so native wrap replays the pickup.

- **`endTick == songEnd` is treated as "song complete."** Setting `api.playbackRange.endTick` to exactly the score's last tick makes AlphaTab reset `tickPosition = 0` at the end instead of wrapping. Using `musicalEnd - 1` engages the range-wrap logic. The one-tick haircut is ~0.5 ms — imperceptible and actually helps mask the soundfont release tail.

- **Three looping approaches I tried, in order, with why I abandoned each:**
  1. **Manual `playerFinished` → seek + play.** Simple, works for tick positions, but the `play()` call after a natural song end has an audio-context warm-up — 1–2 seconds on Safari (huge), ~100–200 ms on Chrome (a "slight pause"). `api.stop()` before the play makes it worse (the synth reset adds more latency). Rejected.
  2. **Two-phase handoff with native looping.** Play the first pass from tick 0 with no loop. On `playerFinished`, set `isLooping = true` + `playbackRange = [loopStartTick, musicalEnd - 1]`, seek to `loopStartTick`, and call `play()` — starting a new session *inside* the range so native wrap goes to `startTick`. Works correctly (tested: wrap goes `62327 → 969`), and subsequent native wraps are truly seamless. BUT the Phase 1 → Phase 2 handoff itself still involves a play() call after state=0, so there's a slight audible pause at the first wrap. Fine on Chrome, user noticed it anyway as a "very hard to detect" pause.
  3. **Watchdog mid-play seek (what shipped).** A `setInterval` at 10 ms polls `api.tickPosition` during playback. When tick is within `END_APPROACH_MARGIN_TICKS` (50) of `musicalEndTick`, it sets `api.tickPosition = loopStartTick` directly — no stop, no pause, no play() call. State stays at 1 throughout. `playerFinished` never fires. A `seekArmed` guard makes sure one pass triggers exactly one seek, re-arming once playback has moved back into the first half of the song. Works identically for tunes with or without a pickup (if `loopStartTick = 0`, the seek wraps to the top).

- **Safari vs. Chrome audio engine gap.** Approach #1 gave a 1–2 second gap on Safari (apparently its AudioContext warm-up-after-stopped behavior is slow), but only a tiny pause on Chrome. The shipped watchdog approach avoids the stop/play cycle entirely, so Safari should be better too — untested, flagged for later.

- **Sibelius doesn't emit `implicit="yes"`.** The pickup flag on measure 1 is missing from its MusicXML export even though the measure is obviously a pickup. The `detectAndFlagPickup` function compensates by inspecting actual note content duration vs. the time-signature expectation. If a future tune has a pickup that includes rests and comes out with a full measure of content, that heuristic could miss — revisit if it comes up.

**Known limitations / things to know:**
- The watchdog polls every 10 ms while playing. Trivial CPU cost, but it is a timer.
- The 50-tick approach margin cuts ~25 ms off the tail of the last note at native tempo. At faster tempos the cut is proportionally smaller in wall-clock time (fine); at 40 BPM it's ~75 ms (still imperceptible).
- Safari loop smoothness is untested since the shipped fix. If Jason hears the old 4-bar gap in Safari, something deeper is going on with its Web Audio implementation.

**Files changed this session:**
- `index.html` — tempo slider range 40–200 BPM, initial readout "— BPM" (replaced at load).
- `js/player.js` — anacrusis detection, BPM slider wiring, watchdog loop, simplified stop handler.
- `.claude/settings.json` — new; five MCP allowlist entries.

**Next session should:**
- Jason: try it with a tune that has no pickup and confirm the watchdog path handles it cleanly (should just wrap tick → 0 indistinguishably).
- Jason: test on Safari to see if the watchdog approach resolves the multi-second gap there too.
- Consider: (a) a small UI to pick a tune from `/music/` instead of a hardcoded constant, (b) sheet music rendering (AlphaTab already supports it — one config flag change), (c) AB loop by bar range for targeted practice.
- If the sonivox violin tone starts bothering anyone, swap in a better soundfont. AlphaTab can load external `.sf2` files via `player.soundFont`.

---

## 2026-04-18 (later still) — Metronome (kick drum)

**What happened:**
- Added a kick-drum metronome that layers on top of AlphaTab's playback. New slider under the tempo slider (0–100, defaults to 0 / "Off").
- Verified in Chrome via Playwright: at 120 BPM clicks fire every 500–510ms (expected 500); at 180 BPM every 339–341ms (expected 333, ~7ms timer overhead). Pause immediately stops the ticker; Play resumes it.

**Decisions / gotchas:**

- **The "kick drum sound" in MetroDrone is not a file.** It's a `Tone.MembraneSynth` synthesized live (`pitchDecay: 0.008, octaves: 2, attack: 0.0006, decay: 0.05, sustain: 0`, triggered on `C2`). Copied the config verbatim so the kick matches the MetroDrone project exactly. Jason had been looking for an mp3 — there isn't one.
- **Tone.js on its own AudioContext, independent of AlphaTab.** Two audio engines in the page: AlphaTab's internal synth plays the violin, Tone.js drives the metronome. The alternative was enabling AlphaTab's built-in metronome (`api.metronomeVolume`), which would be sample-accurate but uses a generic wood-block click instead of the kick Jason asked for. Accepted a small cadence drift over long loops (empirically well under 10ms/beat on a 17-bar tune) in exchange for the exact sound.
- **Self-rescheduling `setTimeout` reads the BPM slider each tick.** A plain `setInterval` would require tearing down and rebuilding on every tempo change; the recursive `setTimeout` picks up the new BPM on the next beat automatically. Tempo changes take effect on the next beat boundary, not mid-beat, which feels right musically.
- **Lazy Tone.start() in the Play handler.** Browsers suspend Tone's audio context until a user gesture. Play click → `await Tone.start()` → create `MembraneSynth` + `Gain` → `api.play()`. First click after reload pays a small initialization cost; subsequent plays are instant.
- **Gain mapping: `(slider/100) * 10` max.** MetroDrone uses `*36` because its metronome has to cut through a continuous drone; we're only competing with AlphaTab's violin, so 10x is plenty. Slider defaults to 0 (off) — a student who doesn't want a click never hears one.
- **No beat/downbeat alignment.** The metronome starts ticking the moment playback starts, so on pickup tunes the click won't align with the bar-2 downbeat. For MVP this is fine — it's still a useful steady pulse. If it becomes annoying, the fix is to delay the first click by the pickup's duration (we already compute `loopStartTick` in ms).
- **Clicks are independent of AlphaTab's loop.** When the watchdog seeks back to `loopStartTick` mid-play, the metronome keeps ticking on its own schedule. The music wrap is seamless but the click doesn't re-align with the new loop position. Acceptable.

**Known limitations:**
- Click doesn't land on downbeats of bars that follow a pickup (see above).
- Two AudioContexts may be slightly heavier on battery than one. Untested impact.
- Safari untested since this change. Tone.js's mobile Safari warm-up is handled differently than AlphaTab's — if the first click sounds late on iOS, look at the aggressive context-resume pattern in MetroDrone's `startBtn` handler.

**Files changed this session:**
- `index.html` — metronome CSS (shared with `.tempo`), metronome slider block, Tone.js CDN script tag.
- `js/player.js` — `metronomeVolumeSlider`/`metronomeVolumeReadout` refs, `ensureMetronome()`, `startMetronome()`, `stopMetronome()`, volume-slider handler, hooks into `playerStateChanged`, async `playBtn` handler for lazy Tone init.

**Next session should:**
- Jason: try it with the tempo at extremes (40 and 200) and at a few slider positions — confirm the kick is audible but not overpowering. 0 ≤ volume ≤ 10x gain is a range we can tune if it feels wrong.
- Test on Safari / iOS. If the first click is late or missing, copy MetroDrone's "resume audio context up to 5 times" warm-up pattern.
- Consider whether the metronome should also tick when nothing is playing (just the metronome alone, as a practice tool between loops). Today it's tied to AlphaTab's `playerState`.

---

## 2026-04-18 (even later) — Tick-driven sync + 4-beat count-in

**What happened:**
- Metronome had two problems: (1) clicks drifted out of sync with the melody over a loop, and (2) no count-in — the click and the melody started simultaneously, which is bad practice pedagogy. Fixed both.
- Clicks are now driven off AlphaTab's `tickPosition` (inside the existing 10ms watchdog) instead of a setTimeout reading the BPM slider. Measured on Chrome/macOS at 120 BPM: 499–502ms click-to-click intervals during the body of the tune. Locked to the music.
- Count-in = always 4 beats of clicks before the first downbeat, with the pickup (if any) landing inside those 4 beats at the correct position. For Oh Susanna (1-beat pickup): 3 clicks alone, then click 4 coincides with the pickup entry, then click 5 = downbeat of bar 1. For a no-pickup tune: 4 clicks alone, then click 5 = downbeat.

**Decisions / gotchas:**

- **`calculateDuration()` on an anacrusis bar returns the PICKUP length, not the full bar length.** First implementation used `masterBars[0].calculateDuration()` which gave 960 ticks (the pickup) instead of 3840 (the full 4/4 bar). That made `ticksPerBeat = 240` and wreaked havoc on the beat grid. Fix: reference `masterBars[1]` for `ticksPerBeat` whenever bar 0 is a pickup. Generic across tunes.

- **Count-in scheduling: 4 wall-clock setTimeouts + a delayed `api.play()`.** Clicks fire at `t = 0, period, 2*period, 3*period`. `api.play()` fires at `(4 - pickupBeats) * period`. So for Oh Susanna (pickupBeats=1), `api.play()` fires at click 4's moment — pickup enters with click 4. For a no-pickup tune, `api.play()` fires at click 5's moment — downbeat enters with click 5. All beat count targets fall out of one formula.

- **Tick-driven click handoff: `nextClickTick = pickupTicks` on start and after every loop wrap.** Count-in has already fired the click coinciding with tick 0 (pickup entry), so the first tick-based click needs to fire at the next beat boundary — which is exactly `pickupTicks`. Same value works for `loopStartTick` on wrap since they're equal by construction.

- **AlphaTab audio-context warm-up is ~30ms on first play after load.** Measured: first-play handoff was 525–554ms (expected 500); second-play 514ms; third-play ≤505ms. Fixed by priming the audio context at page load: set `api.masterVolume = 0`, `api.play()`, wait 150ms, `api.pause()`, seek to 0, restore volume. The `isWarmingUp` guard suppresses the status-line flicker during priming. After warm-up the first *user* play is as tight as subsequent ones.

- **`ALPHATAB_START_LATENCY_MS = 20` compensation.** Even warmed up, there's ~20–25ms of inherent output latency between `api.play()` being called and the user hearing the first sample. We pre-fire `api.play()` by 20ms inside `runCountIn()` so the pickup audio lands on click 4, not after it. Constant is a single tuning knob if Safari/Firefox show different latency.

- **Why two audio engines still works here.** Tone.js drives the kick (user wanted that specific MetroDrone sound), AlphaTab drives the violin. During playback the clicks are tick-position-driven, which removes drift because both engines are slaved to AlphaTab's musical time. The count-in is wall-clock (no ticks exist yet before `api.play()`), but the warm-up + 20ms compensation keeps the handoff inside 5ms.

- **Pause/Stop cancel pending count-in timers.** Otherwise a student who hits Play then immediately Stop would still get `api.play()` firing a second later. `cancelCountIn()` clears all pending setTimeouts and the `countInActive` guard prevents re-entry into a second count-in.

**Known limitations:**
- Count-in length is hardcoded to 4 beats regardless of time signature. In 3/4 this means count-in is 1 bar + 1 beat, which is unusual. If a 3/4 tune shows up, we can either revisit (count-in = 1 bar, variable by signature) or keep 4 beats as the universal practice convention.
- Fractional-beat pickups (e.g. a single eighth-note upbeat = 0.5 beats) will compute `pickupBeats = 0.5`. The formula still works (`api.play()` fires at 3.5 * period), but there's no click on the upbeat — only on the full-beat boundaries. Good enough for now.
- If a tune has internal tempo changes (fermata, accelerando), `ticksPerBeat` is taken from the first full bar and assumed constant. Fine for the fiddle repertoire we care about; would need rework for classical scores.
- The 20ms latency compensation is measured for Chrome on macOS. Safari and Firefox may need a different constant.

**Files changed this session:**
- `js/player.js` — big refactor:
  - scoreLoaded now computes `ticksPerBeat` and `pickupTicks` (beat grid).
  - `startEndWatchdog` now owns metronome click firing (tick-driven). `startMetronome`/`stopMetronome` deleted.
  - New `runCountIn` / `cancelCountIn` / `countInActive` for the count-in.
  - New `primeIfNeeded` / `isWarmingUp` for load-time audio priming.
  - `playBtn` handler now picks count-in vs. direct play based on whether the metronome is enabled.
  - `ALPHATAB_START_LATENCY_MS` constant for handoff compensation.

**Next session should:**
- Jason: confirm the count-in feels right rhythmically on Oh Susanna, and test with and without the metronome (volume = 0 should skip the count-in entirely and start the music immediately).
- Test Safari/iOS — the priming + compensation constants were tuned on Chrome/macOS. If first-play sync feels off on Safari, log the handoff gap and re-tune `ALPHATAB_START_LATENCY_MS`.
- Drop in a tune with no pickup and confirm the count-in does 4 clicks alone then downbeat on click 5.
- Decide count-in behavior for non-4/4 tunes if/when one shows up.

---

## 2026-04-18 (last one) — Threw out Tone.js, using AlphaTab's built-in clicks

**What happened:**
- The Tone.js kick drum had a persistent sync offset against the melody that I couldn't eliminate. I tried priming the audio context, empirically compensating `api.play()`, and finally matching AlphaTab's 32ms `outputLatency` by scheduling each click +32ms into Tone's future. Jason's ear still said "out of sync" — there was a residual drift I couldn't measure from code.
- Switched to AlphaTab's built-in metronome: `api.metronomeVolume` (on every beat during play) + `api.countInVolume` (one bar of clicks before the tune starts). Both ride AlphaTab's own audio clock, so sync is guaranteed by construction.
- Ripped out Tone.js entirely. Deleted: CDN script tag, MembraneSynth, Tone.Gain, `ensureMetronome`, `fireMetronomeClick`, `runCountIn`, `cancelCountIn`, `countInTimers`, `countInActive`, `clickDelaySec`, `findAlphaTabAudioContext`, `ALPHATAB_START_LATENCY_MS`, `isWarmingUp`, `primeIfNeeded`, `primed`, the custom tick-driven click firing inside the watchdog. About 130 lines removed.

**Decisions / gotchas:**

- **Sync over sound character.** Jason's MVP priority was correct: a click that's rhythmically trustworthy beats a click that's beautiful but drifts. The MetroDrone kick drum was a nice-to-have; sample-accurate sync is a must-have for a practice tool.
- **AlphaTab's count-in is always 1 full bar, not configurable.** For Oh Susanna that means the student hears 4 clicks alone, then click 5 lands on the pickup entry (= tick 0), then click 6 = downbeat of bar 1. Slightly more verbose than the "3 clicks + pickup on click 4" spec Jason described, but it's the standard practice-room convention and a full bar of pulse is arguably more useful.
- **Count-in only fires on fresh `api.play()`, not on loop wraps.** The watchdog's mid-play seek back to `loopStartTick` doesn't trigger AlphaTab's count-in, so the loop stays tight. Exactly what we want.
- **One slider controls both volumes.** `metronomeVolume` and `countInVolume` are set from the same slider, normalized 0–1. Slider at 0 = no clicks anywhere. No separate control for count-in volume since nobody wants a quiet count-in followed by loud in-tune clicks.
- **Why two audio engines never reconciled.** Tone.js clicks and AlphaTab melody live on separate `AudioContext`s. Each has its own `baseLatency` and `outputLatency`, and they don't share a clock. You can read both latencies and try to compensate, but browsers don't expose the actual "time from schedule to speaker" precisely enough for <10ms alignment. We got to ~30ms measured click-to-melody offset, but Jason's ear still caught the remaining slip.

**What's still good:**
- All the tempo/pickup/loop-wrap logic from earlier sessions is intact and unchanged.
- `ticksPerBeat` and the count-in formula logic were removed (no longer needed) — AlphaTab handles its own beat grid.

**Files changed this session:**
- `js/player.js` — trimmed from ~240 lines to ~175 lines. Metronome is now just `api.metronomeVolume = v/100; api.countInVolume = v/100;` on slider input.
- `index.html` — removed Tone.js CDN `<script>` tag.

**Next session should:**
- Jason: confirm the AlphaTab wooden-block click is acceptable sonically, and that sync finally feels locked.
- If he wants the MetroDrone kick drum back later, the path would be: share ONE `AudioContext` between Tone.js and AlphaTab (via `Tone.setContext(alphaTabsContext)` or the inverse). That kills the cross-engine latency problem, but requires reaching into AlphaTab's internals and isn't worth it until it's the only remaining feature request.
- Confirm on Safari — AlphaTab's metronome should just work there too since it's the same audio path as the melody.

---

## 2026-04-18 (one more) — Kick drum back, driven by AlphaTab tick events

**What happened:**
- Jason wanted the MetroDrone kick sound back but only if sync could hold. Found the right API: `api.midiEventsPlayedFilter = [alphaTab.midi.MidiEventType.AlphaTabMetronome]` + `api.midiEventsPlayed` fires a JS event on every metronome tick (count-in AND in-tune). That event is driven by AlphaTab's own playback clock — not `tickPosition` polling, not wall-clock — so triggering Tone.js inside the handler should keep the kick locked to the melody.
- Re-added Tone.js CDN. Rebuilt the `MembraneSynth` + `Gain` with the exact MetroDrone config. Set `api.metronomeVolume = api.countInVolume = 0.001` when the slider is on (inaudible but non-zero so AlphaTab keeps firing events) and let the Tone.js kick carry the actual loudness.

**Decisions / gotchas:**

- **AlphaTab needs `metronomeVolume > 0` for the events to fire.** Setting it to `0` disables the metronome entirely. `0.001` is effectively silent but keeps the event stream alive. Same for `countInVolume`.
- **Count-in now plays the kick too.** `midiEventsPlayed` fires during the 1-bar count-in, so the 4 count-in beats go through the same code path as in-tune beats. User hears: 4 kicks → pickup enters with kick 5 → downbeat with kick 6 → etc.
- **Why this should succeed where our earlier Tone.js attempts failed.** Before, we drove clicks off `tickPosition` polling or wall-clock setTimeouts — both ran AHEAD of AlphaTab's audible output by ~30ms. The `midiEventsPlayed` event is AlphaTab's own "the metronome just played" notification, which fires in sync with audio output (not with the scheduler lookahead). Listener latency should be a handful of milliseconds — imperceptible.
- **Listener is registered once at module load,** before any playback. It's cheap when idle.

**Known limitations:**
- Still two audio engines. If the listener turns out to fire at scheduler-time rather than audio-time, we're back to ~30ms drift and Jason will hear it. If that happens, the next move is to subscribe, then schedule Tone.js at `Tone.now() + compensation` — and tune `compensation` empirically, or share AudioContexts across the two libraries.
- Tone.js CDN adds ~90KB over the wire. Negligible for desktop, mild concern for a mobile-practice flow.

**Files changed this session:**
- `index.html` — re-added Tone.js CDN `<script>` tag.
- `js/player.js` — replaced the simple AlphaTab-click metronome with: Tone.js `MembraneSynth`, lazy `ensureMetronome`, `midiEventsPlayedFilter` + event listener calling `fireKick()`, `applyMetronomeVolume()` now sets AlphaTab volumes to 0.001/0 and the Tone gain to the slider value. Play button is async again (`await ensureMetronome()` before `api.play()`).

**Next session should:**
- Jason: refresh, play with metronome on, confirm kick drum is now in sync with the melody. If not, log whether the kick sounds early or late and by how much.
- If it's still off: first try, bump `applyMetronomeVolume` to fire the kick at `Tone.now() + 0.03` and see if that pulls the click onto the beat.

---

## 2026-04-18 (reverted) — Shipped the wooden-block metronome

**What happened:**
- The `midiEventsPlayed` + Tone.js kick approach produced audibly jittery playback — irregular lag periods that Jason described as "garage hip-hop from Britain circa late 90s." Root cause is that `midiEventsPlayed` dispatches batched events across a worker boundary, so delivery timing to the main thread is uneven; the kick fires on that uneven schedule, not on the beat.
- Reverted to AlphaTab's built-in metronome click + 1-bar count-in (`api.metronomeVolume` + `api.countInVolume`). Ripped out Tone.js entirely (CDN tag + MembraneSynth + gain + `ensureMetronome` + midi event listener). Player is back to ~175 lines.

**What's shipped for the metronome in this MVP:**
- Single slider controls both in-tune clicks and the count-in. 0 = off. Any non-zero value = 1 bar of count-in, then clicks on every beat.
- Sound is AlphaTab's stock wood-block (or side-stick, TBD by the sonivox soundfont). Not the MetroDrone kick — that chase cost the session and the cross-AudioContext sync problem never fully resolved.

**Why the kick is parked:**
- Tone.js and AlphaTab run on separate `AudioContext`s. Clicks emerged from speakers with a different latency than the melody (~30ms offset). Every compensation attempt (priming, per-event scheduling, `Tone.now() + latency`) left residual drift that Jason's ear caught.
- `api.midiEventsPlayed` with the `AlphaTabMetronome` filter seemed promising — it's AlphaTab's own "tick played" event — but the cross-thread dispatch jitter ruined timing consistency.
- The real fix is to share a single `AudioContext` between the two libraries (`Tone.setContext(alphaTabsContext)` or reverse). That's worth doing if/when sound character becomes the top priority. For MVP: ship reliable sync with the wooden block.

**Files changed this session (net):**
- `index.html` — Tone.js CDN tag added, then removed (net: same as start-of-session).
- `js/player.js` — went through three architectures in the session; landed where we started on metronome, but with a much better understanding of why. Final state: `api.metronomeVolume = v/100` + `api.countInVolume = v/100` on slider input.
- `PROJECT_LOG.md` — multiple entries documenting each attempt and why it failed.

**Recommended next sessions (in rough priority order):**

1. **Tune selection — "how do I use this with different songs?"** Today `TUNE_FILE` and `TUNE_TITLE` are hardcoded constants at the top of `js/player.js`. The minimum viable version is a dropdown that swaps the MusicXML file. The cleaner version is a small JSON index at `music/index.json` describing each tune (file, title, native BPM, tricky-pickup notes) that the UI reads to build the dropdown. Care needed around: resetting `loopStartTick` / `musicalEndTick` / `originalBPM` on load, clearing any in-flight watchdog, and what happens if the user switches tunes mid-playback. Good candidate for a focused session.

2. **Better violin tone — string sound.** Today we use the bundled `sonivox.sf2`, whose General-MIDI violin patch is serviceable but not expressive. AlphaTab takes any SoundFont 2 file via `player.soundFont`. Options to evaluate: (a) swap in a fiddle-specific SF2 (search for "violin" or "orchestra" soundfonts on Polyphone / musical-artifacts), (b) layer strings (violin + pad) — AlphaTab can render multi-track MusicXML so we could add a sustained-string track to the score, (c) go beyond SF2 with a sampler engine (Tone.Sampler or similar), but that re-opens the two-engine sync problem we just exited. Recommend starting with (a) as the least-invasive test.

3. **Kick drum rematch — shared AudioContext.** Now that we understand the real problem, the path forward is: instantiate AlphaTab normally, wait for its AudioContext, then `Tone.setContext(new Tone.Context({ context: alphaTabsAudioContext }))` before creating any Tone synths. Both engines write to the same output buffer, same latency, no cross-engine drift. If done cleanly, the kick should land on the beat. Worth a session when sound character becomes the priority; not before.

4. **AB loop by bar range.** Jason's Phase 2 candidate from the MVP kickoff. Students want to loop one phrase, not the whole tune. Would reuse the existing watchdog seek logic.

5. **Render the sheet music with a playback cursor.** One AlphaTab config flag change to enable, plus un-hiding the container. Nice-to-have for students who read notation.

---

## 2026-04-28 — Tune-selector dropdown (BACKFILLED 2026-06-12)

_This work shipped in commit `0d3afe4` ("player updates") on 2026-04-28 but was never logged at the time. Reconstructed from the diff on 2026-06-12 so the log stops lying about "tune selection" being an open task._

**What happened:**
- Built the tune-picker dropdown that the prior log listed as the #1 next task. The hardcoded `TUNE_FILE` / `TUNE_TITLE` constants are gone.
- Added `music/index.json` — a hand-maintained array of `{ file, title }` entries. The page fetches it on load, populates a `<select id="tune-select">`, and loads the first tune automatically.
- `loadTune(file, title)` handles switching: cancels any pending count-in, stops playback + the watchdog, disables transport buttons, fetches the new MusicXML, and `api.load()`s it. `scoreLoaded` / `playerReady` recompute pickup, loop ticks, and BPM per tune, so switching tunes is clean.
- Added a second tune: `music/Orange Blossom Special.musicxml`.

**Known limitations carried forward:**
- `index.json` is hand-typed. Fine now; at hundreds of tunes it WILL drift from the actual `/music/` folder contents. Future chore: a small build script that scans `/music/` and regenerates `index.json` automatically.
- No per-page default tune yet (see decisions below) — the dropdown always defaults to the first entry.

---

## 2026-06-12 — Session with Jason: decisions logged + sound work (violin + kick)

### Decisions made this session (not all built yet)

- **GitHub Pages needs a public repo.** The repo is currently private, and GitHub Pages on a private repo requires a paid plan (~$48/yr). Jason hit the "Upgrade or make this repository public" wall. Decision leaning: make the repo public (it's static, public-domain tunes, no secrets — verified: no API keys/credentials in the tree) so Pages is free. NOT yet done — Jason to flip visibility in Settings → General → Danger Zone, then enable Pages on `main` / root. Hosted URL will be `https://jasonkleinberg.github.io/fiddlehed-practice-engine/`.

- **Per-page default tune = URL query param, slug-based.** For embedding on WordPress lesson pages: the player should read a `?tune=<slug>` param on load, select that tune, and fall back to the first tune if the param is missing/unknown. This makes each lesson page open to its own tune AND return to it on refresh (the URL carries the default — unlike localStorage, which would wrongly "remember" whatever tune the student last clicked). **Decision: use a SLUG, not the filename** (e.g. `?tune=oh-susanna`), so files can be renamed without breaking embed links. Requires adding a `slug` field to each `index.json` entry. NOT yet built — next-session candidate.

- **`index.json` auto-generation** is a known future chore (see backfill entry above).

### What was built this session: sound

1. **Violin soundfont upgraded.** Swapped AlphaTab's stock `sonivox.sf2` for **FluidR3Mono_GM.sf3** (MuseScore's GM soundfont), loaded from jsDelivr's GitHub mirror: `https://cdn.jsdelivr.net/gh/musescore/MuseScore@2.1/share/sound/FluidR3Mono_GM.sf3`. Verified: HTTP 200, CORS `access-control-allow-origin: *`, ~14.5MB (under jsDelivr's 20MB gh limit), valid RIFF SoundFont, and it contains proper `Violin` / `Slow Violin` / `Strings` / `Fiddle` presets. The score's existing MIDI program (Violin) selects the patch automatically — no score change needed. (`FluidR3` also has a GM 110 "Fiddle" patch if we ever want a twangier tone — would require changing the track program.)
   - **Caveat:** SF3 (OGG-compressed) support is "experimental" in AlphaTab 1.4.x (added in 1.4.0; we're on 1.4.3). AlphaTab ships its own `sonivox.sf3`, so it's exercised, but if SF3 ever misbehaves the fallback is the old `sonivox.sf2` URL (one-line revert). A full-quality SF2 FluidR3 is ~140MB — too big for CDN — so SF3 is the practical path for a better tone over the network.

2. **MetroDrone kick drum — attempt #6, shared-AudioContext approach.** Re-added Tone.js (`tone@14.7.77`, same as MetroDrone) and the exact MetroDrone `MembraneSynth` config (`pitchDecay 0.008, octaves 2, attack 0.0006, decay 0.05, sustain 0`, triggered `C2`). The new idea vs. all prior failed attempts:
   - **Shared AudioContext.** `ensureKick()` walks AlphaTab's (minified) object graph by instance type to find its live `AudioContext`, then `Tone.setContext(atCtx)` so Tone and AlphaTab share ONE clock + one output latency. This targets documented failure #1 (the ~30ms cross-engine offset from two separate contexts). If the context can't be found, it falls back to Tone's own context and logs a warning — degrades to the previously-known-bad behavior, not a crash.
   - **Timing from Tone.Transport, not midi events.** Kicks fire on a `Tone.Transport.scheduleRepeat(..., "4n")` grid, BPM slaved to the tempo slider. This avoids documented failure #2 (`api.midiEventsPlayed` worker-boundary jitter, the "garage hip-hop" problem). The grid starts at Play (laying down the count-in clicks) and carries into the tune. Count-in length still uses the existing `countInBeats` logic; `api.play()` is fired after the count-in, early by `ALPHATAB_START_LATENCY_MS`.
   - **One tuning knob:** `KICK_OFFSET_SEC` (default 0) shifts every kick earlier/later vs the melody.
   - Pause/Stop stop the Transport grid; tempo slider updates `Tone.Transport.bpm` live.

   **⚠️ NOT VERIFIED BY EAR.** This was written in a sandbox with NO audio output and NO browser (couldn't install Chromium's system libs — no root), so sync was *reasoned about, not heard*. Every prior kick verdict in this log came from Jason's ear, so this needs the same. Two known residual risks to listen for:
   - **First-play context race:** if AlphaTab hasn't created its AudioContext by the first Play, `ensureKick` won't find it and that first session uses Tone's own context (drift). Should self-heal on the second Play. If the first play sounds off but later ones lock in, this is why — fix would be to call `ensureKick` once after the first `api.play()`.
   - **Loop-seam drift:** the kick grid is periodic and independent of the watchdog loop seek. It stays aligned only if the loop length is an exact integer number of beats; the watchdog's ±10ms seek slop could nudge the click off the downbeat at each wrap. If it drifts only *at the loop point*, that's this.
   - If sync is unacceptable, the reliable wooden-block metronome (`api.metronomeVolume`) is one `git revert` away.

**Files changed this session:**
- `js/player.js` — soundFont URL → FluidR3Mono SF3; replaced the oscillator-beep count-in + AlphaTab wooden-block metronome with the Tone.js shared-context kick (`findAlphaTabAudioContext`, `ensureKick`, `applyKickGain`, `startKickGrid`/`stopKickGrid`, async Play handler, KICK_OFFSET_SEC knob). Syntax-checked with `node --check`.
- `index.html` — re-added the `tone@14.7.77` CDN `<script>`.

**Next session should:**
- Jason: **enable GitHub Pages** (make repo public first), confirm the hosted URL plays with the new violin tone.
- Jason: **ear-test the kick** with the metronome on — is it locked to the melody? Note early/late/drift-at-loop so we can tune `KICK_OFFSET_SEC` or pick a different anchor. Verify the FluidR3 violin actually sounds better (it should, but confirm SF3 loads cleanly — watch for an AlphaTab soundfont warning in the console).
- Build the **`?tune=<slug>` URL param** for per-page embed defaults (add `slug` to `index.json`).
- If/when the tune list grows: the `index.json` auto-generator script.

### 2026-06-12 (later, live debug via Claude-in-Chrome) — both sound bugs root-caused

Debugged on Jason's actual Chrome against `localhost:8000` (Claude could click + read console/JS state, but NOT hear audio — sync verdicts are still Jason's ear).

- **"Melody is piano, not violin" — root cause found + fixed.** The soundfont swap alone did nothing because the MusicXML's instrument is literally **"Bright Piano"** — a better soundfont just gives a better piano. Fix: force `track.playbackInfo.program = 40` (Violin) for all tracks in `scoreLoaded`, then `api.loadMidiForScore()` once. `detectAndFlagPickup` no longer calls `loadMidiForScore` (the caller does it once, after the program override). **Verified in-browser:** `playbackInfo.program === 40` AND the generated MidiFile carries a program-change to 40 (the stray `0` in the event list is the metronome/aux channel). New constant `MELODY_PROGRAM = 40` (110 = Fiddle if we ever want twangier).

- **"Metronome kick is silent" — root cause found + fixed.** The first kick implementation adopted AlphaTab's AudioContext via `Tone.setContext(...)`; that **froze Tone's internal clock**, so the scheduled kicks never fired (silent, no error). Fix: **do NOT adopt AlphaTab's context** — run the kick on Tone's own context. Removed `findAlphaTabAudioContext` + the sharing block. **Verified in-browser:** with the metronome slider up and Play pressed, `Tone.Transport.state === "started"`, context "running", and the kick's `triggerAttackRelease` fired ~once per beat (counted 25 over ~6 bars). The kick now makes sound. Jason's verdict on the kick *sound*: good (it's the MetroDrone MembraneSynth).

- **Kick timing: constant ~19ms lag, not growing drift.** Measured the offset between kick triggers and melody beat-crossings over 4s: mean **+19ms** (kick slightly after the beat), spread mostly = the 4ms polling noise. Jason's ear independently: "a little behind, gap not getting bigger" — i.e. constant, which matches. Set `KICK_OFFSET_SEC = -0.02` (fire 20ms early) to compensate. The separate-context latency that sank earlier attempts is exactly this *constant* offset, which is tunable — the jitter problem from the `midiEventsPlayed` attempts does NOT appear with the Tone.Transport grid.

**State at end of night:** all fixes are on disk, **syntax-checked, NOT committed/pushed**. Pages (jkleinberg.com/...) still serves the ORIGINAL piano/no-kick version. Jason was hearing piano + a behind-kick almost certainly because he was on Pages or a cache-stale tab — the violin + the -0.02 kick compensation only appear after a **hard refresh** of localhost (plain reload caches `player.js`).

**Next session (resume here):**
1. Jason: **hard-refresh localhost** (Cmd+Shift+R). Confirm (a) melody is now a violin, (b) kick is tighter with the -0.02 compensation.
2. If kick is still slightly behind, nudge `KICK_OFFSET_SEC` more negative (e.g. -0.03/-0.04); if it now sounds early, back off toward -0.01. One dial, constant offset.
3. Once happy: **commit + push** so Pages updates.
4. Still open from earlier: `?tune=<slug>` embed param (+ `slug` in `index.json`), and the `index.json` auto-generator.

### 2026-06-13 (live debug, cont.) — violin bug ROOT-CAUSED & fixed; kick fragility found

- **Violin "still piano" — real root cause (not soundfont, not cache).** Diagnosed live in Jason's Chrome via Claude-in-Chrome. The melody channel got TWO program-changes at tick 0: `40` (Violin, from our `playbackInfo.program` override) and then `0` (Piano) — and the second won. Source of the `0`: the Sibelius export embeds an **Instrument automation** on bar 0 / beat 0 with value 0. AlphaTab emits that automation as a program-change AFTER the track program, clobbering the violin every time. Setting `playbackInfo.program` alone could never win. **Fix (shipped to disk):** in `scoreLoaded`, also rewrite every `AutomationType.Instrument` automation's `value` to `MELODY_PROGRAM` (40), then `loadMidiForScore()`. Verified: the generated MIDI now carries only program 40 on the melody channel, and Jason confirmed by ear it's a violin.
- **Violin tone nitpick (PARKED by Jason):** FluidR3's Violin has wide/heavy vibrato and a soft attack+decay, which blurs note boundaries — especially repeated same-notes. Not worth chasing now. Future levers if we revisit: try the "Slow Violin" or "Fiddle" (GM 110) preset, a different soundfont, or shortening note release. Priority: low.
- **Kick fragility found (still open):** the Tone.js kick depends on (a) the metronome slider being >0 *at the moment Play is pressed* (raising it mid-play does nothing), and (b) Tone's OWN AudioContext being resumed — which needs a real user gesture. Claude's automated clicks don't reliably resume Tone's context, so Claude can't ear-test/dial the kick well; Jason's real clicks keep it alive. The kick *sound* is good (his verdict); the timing read "a touch behind" but those tests were muddied by the slider-reset + suspended-context issues. **Open question:** whether to keep the two-engine Tone kick or move the metronome into AlphaTab's own engine (built-in metronome, or a percussion note injected into the score) for guaranteed sync — same one-engine principle as the chord-track idea below.

### Feature idea (planning) — Chord/accompaniment track with volume slider

Jason wants a chord backing track (think **Strum Machine**'s guitar comping — not expecting that quality, just *a* chord bed) with its own volume slider. Architectural recommendation: implement it as a **track inside the AlphaTab score**, NOT a separate audio engine — the whole violin+kick saga proved two engines fight on sync, while an in-score track is sample-accurate for free and AlphaTab already exposes per-track volume for the slider. Open sub-questions: where the chord data comes from (author a chord/guitar staff in the Sibelius export per tune, vs. generate from chord symbols), and how much strum realism to attempt (block chords are cheap; boom-chuck/swing strumming is a real lift). Status: idea only, not scheduled. **Feasibility confirmed:** Oh Susanna's MusicXML has 12 `<harmony>` chord symbols (D/A/G…); Orange Blossom has 0. So the plan is: read the embedded chord symbols, hold simple block triads on a **church-organ patch** (sustained, no strum authoring needed — "just enough" chordal structure to support melody learning), with its own volume slider; tunes without chord symbols simply get no organ track. Jason's framing: these are practice tracks to learn the melody, not high-end recordings; existing practice tracks stay.

### 2026-06-13 (cont.) — `?tune=<slug>` embed default SHIPPED (to disk)

Built and verified live in-browser. `music/index.json` now has a `slug` per tune (`oh-susanna`, `orange-blossom-special`). On load, `player.js` reads `?tune=<slug>` from the URL and selects that tune (falling back to the first tune if the param is missing or unknown). Verified: `?tune=orange-blossom-special` opens Orange Blossom; `?tune=bogus-typo` falls back to Oh Susanna. This is the per-page embed default for WordPress lesson pages — embed as `<iframe src="https://jkleinberg.com/fiddlehed-practice-engine/?tune=oh-susanna">` and the page opens to (and returns-on-refresh to) that tune.

**Cache note:** localhost (Python `http.server`) + Chrome cache `player.js` aggressively — a plain reload runs stale JS; a HARD reload (Cmd+Shift+R) is required to pick up edits. Bit us repeatedly. If stale assets become a problem for the live embed after pushes, add a `?v=` cache-bust to the `player.js`/soundfont URLs.

**~~STILL NOT PUSHED~~ → PUSHED by Jason.** Violin automation fix, kick on Tone's own context + live offset knob, `?tune=` embed default, and slugs are now live on jkleinberg.com.

### 2026-06-13 (cont.) — two post-deploy bug fixes (on disk, NOT yet pushed)

Jason's feedback after the push: (a) the kick drifts out of sync with the violin after a big tempo change, (b) the spacebar no longer toggles play/pause.

- **Tempo-change desync — partial fix (the two-engine tax).** Root: the kick (Tone.Transport) and the melody (AlphaTab) run on independent clocks; each big tempo move nudges them apart and the drift accumulates. We can't perfectly lock two clocks, but we can re-phase: new `reanchorKickToMelody()` reads how far the melody is through its current beat (`ticksPerBeat` is now stored globally), sets `Tone.Transport.seconds` to the same fraction, and reschedules the kick — so the next quarter-note lands on the melody's next beat. Wired to the tempo slider's **`change`** event (drag release), not `input`, to avoid re-phasing mid-drag (which would stutter). NOT ear-verified (automation can't keep Tone's context alive). **If extreme tempo swings still drift, the real fix is one-engine** — move the click into AlphaTab (built-in metronome or an injected percussion note), trading the MetroDrone MembraneSynth sound for AlphaTab's drum. Flagged as the standing "make the kick trustworthy" option.
- **Spacebar play/pause — fixed.** It used to work only because the Play button kept focus; the control rewrites broke that. Added an explicit `document` keydown handler: Space → toggle play/pause (`playerState === 1 ? pauseBtn : playBtn`).click(), `preventDefault` to stop page scroll, ignored when the tune `<select>` is focused. Logic verified in-browser by dispatching a synthetic Space event (0→1→0). Real-keypress confirmation is Jason's (automation can't inject a trusted keystroke).
- Also cleaned up a stale code comment that still described the abandoned shared-AudioContext approach.

**Next:** Jason commit + push these two fixes; confirm spacebar works with a real press and whether the tempo re-anchor holds the kick by ear. Backlog unchanged otherwise: kick robustness (cheap patch vs one-engine), chord organ track (Oh Susanna's 12 chords ready), index.json auto-gen, violin tone, AB loop, sheet music.

_(Those two fixes were pushed by Jason. Then he greenlit the one-engine kick below.)_

### 2026-06-13 (cont.) — KICK MOVED INTO ALPHATAB (the real fix). Tone.js removed.

Decision: stop fighting two clocks. The kick is now a percussion note inside the score's OWN MIDI, played by AlphaTab's synth — same clock as the violin, so it cannot drift.

**How it works (verified live in-browser):**
- Probed AlphaTab's API: `api.player.loadMidiFile(mf)` exists (load a custom MIDI into the synth), as do `alphaTab.midi.NoteOnEvent(track, tick, channel, noteKey, velocity)` / `NoteOffEvent`, and `api.player.setChannelVolume(channel, 0..1)`. AlphaTab's built-in metronome is a *synth-level* feature (not in the score MIDI), so its note can't be remapped — hence manual injection.
- `injectKickIntoPlayback()` (called once per tune-load from `playerReady`, guarded by `kickInjected` because `loadMidiFile` re-fires `playerReady`): regenerates the score MIDI via `MidiFileGenerator`, adds a kick `NoteOn`/`NoteOff` (GM note **36**, channel **9**, vel 110) on every beat (`for t = 0; t < musicalEndTick; t += ticksPerBeat`), sorts events by tick, and `loadMidiFile`s it. Verified: 65 kicks for Oh Susanna, all on the beat grid (0, 960, 1920…), EndOfTrack still last at 62400, no console errors.
- Volume: `api.player.setChannelVolume(9, slider/100)`, re-applied after each load and on Play (channel volumes reset on load).
- Count-in: AlphaTab's native `api.countInVolume` (one bar). `api.metronomeVolume` stays 0 so AlphaTab doesn't layer its own click over the injected kick. **Caveat:** the count-in click is AlphaTab's own sound, not the kick — minor polish item if it bugs Jason.
- Tempo: a single `api.playbackSpeed` now scales BOTH violin and kick (they're one MIDI). Verified live: yanked tempo to 170 BPM mid-play, playback kept advancing (52712 → 56770), no stop, no drift possible.

**What got deleted:** Tone.js CDN tag; MembraneSynth + Gain; `ensureKick`/`applyKickGain`/`scheduleKickRepeat`/`startKickGrid`/`stopKickGrid`/`reanchorKickToMelody`; the custom count-in (`countInBeats`/`countInTimers`/`countInActive`/`cancelCountIn`/`ALPHATAB_START_LATENCY_MS`); `KICK_OFFSET_SEC` + the `window.__kickOffsetSec` live knob. player.js is much smaller and simpler. Spacebar handler and the loop watchdog are unchanged.

**NOT YET VERIFIED BY EAR (Jason's call):** the FluidR3 GM kick-drum *sound* (could be a touch cheesy — fallbacks: note 35 acoustic bass drum, or 37 side-stick for something drier), and whether the AlphaTab count-in click clashes with the kick. Sync itself is guaranteed by construction.

**NOT YET PUSHED.** index.html (Tone tag removed) + js/player.js are on disk. Next: Jason commit + push, then ear-test the kick sound + count-in.

**FOLLOW-UP — kick was silent on first ear-test; root-caused + fixed + CONFIRMED WORKING (pushed).** The injected kicks fired but made no sound: channel 9 was missing the setup the melody channels get automatically — a program change (to load the kit) and a CC7 base volume. Without them the drum kit was never loaded and the channel volume sat at zero. Fix: `injectKickIntoPlayback` now also emits, at tick 0 on channel 9, a `ProgramChangeEvent(0, 0, 9, 0)` (GM standard kit — channel 9 is the percussion channel) and a `ControlChangeEvent(... VolumeCoarse, 120)` base volume; `setChannelVolume(9, slider/100)` scales on top. Jason's verdict: **works great** — kick is slightly cheesy but fine for MVP, nicely percussive with a quick attack (good for practice), and sits at a better volume with real headroom (can crank it, unlike the old Tone kick). The whole MetroDrone-kick saga is now closed: it's a sampled GM kick on AlphaTab's own clock + mixer. Pushed and live.

### 2026-06-13 (cont.) — WordPress embed shortcode + default tweaks

- **WordPress embed = shortcode (shipped).** Wrote `wordpress/practice-engine-shortcode.php`: a `[practice-engine tune="oh-susanna" height="400"]` shortcode that outputs a responsive iframe pointing at the live app (`https://jkleinberg.com/fiddlehed-practice-engine/?tune=<slug>`). Jason installed it via the **WPCode** plugin (PHP snippet, Auto Insert → Run Everywhere) and confirmed it renders on a FiddleHed page. Architecture confirmed with Jason: the player lives in GitHub (served at jkleinberg.com via Pages); the shortcode just embeds an iframe to that live URL — so **any push to the app auto-updates every embedded player**, no WordPress changes needed unless the wrapper (size/align/base URL) changes. Cross-domain (fiddlehed.com embedding jkleinberg.com) so the iframe height is fixed, not auto-resizing. Left-justify fix: iframe style `margin:1rem auto` → `margin:1rem 0`. A throwaway test draft exists at fiddlehed.com post ID 79827 (deletable).
- **Default tempo → 80 BPM.** `scoreLoaded` now starts every tune at a slow, practice-friendly 80 BPM (`playbackSpeed = 80 / originalBPM`) instead of native tempo. index.html slider default also 80.
- **Default metronome → 25%.** index.html metronome slider starts at 25% (was 0/Off) so students hear the click by default. Verified both on localhost.

**DEFERRED nicety — pickup-aware count-in.** Jason's ask: for a pickup tune like Oh Susanna, ideally you'd hear 3 count-in clicks, then the pickup enters on click 4, then the kick body from bar 1 — i.e. the count-in should OVERLAP the pickup. AlphaTab's native count-in (what we use now) is always a full bar BEFORE the music, so the pickup doesn't tuck into it. Doing it right means either injecting count-in clicks into the MIDI (blocked by no negative ticks) or shifting the whole melody by a count-in bar and recomputing loop boundaries — fiddly. Jason explicitly said skip-if-hard and is happy with the current behavior. Parked as a polish item, not MVP-critical.

**NOT YET PUSHED:** index.html (tempo 80 / metronome 25 defaults) + js/player.js (80 BPM start) + the shortcode left-justify edit. Jason to push.
