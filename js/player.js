// FiddleHed Practice Engine — MVP player
// Loads MusicXML files via AlphaTab, wires up play/pause/stop, tempo slider,
// tune selector dropdown, and a metronome with custom count-in.

const statusEl = document.getElementById("status");
const playBtn = document.getElementById("play");
const pauseBtn = document.getElementById("pause");
const stopBtn = document.getElementById("stop");
const tempoSlider = document.getElementById("tempo");
const tempoReadout = document.getElementById("tempo-readout");
const metronomeVolumeSlider = document.getElementById("metronome-volume");
const metronomeVolumeReadout = document.getElementById("metronome-volume-readout");
const tuneTitleEl = document.getElementById("tune-title");
const tuneSelect = document.getElementById("tune-select");
const container = document.getElementById("alphatab-container");

const api = window.atApi = new alphaTab.AlphaTabApi(container, {
  core: {
    fontDirectory: "https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.4.3/dist/font/",
  },
  player: {
    enablePlayer: true,
    enableCursor: false,
    // FluidR3Mono (MuseScore's GM soundfont) — much more expressive violin/strings
    // than AlphaTab's stock sonivox. SF3 (OGG-compressed, ~14.5MB), served from
    // jsDelivr's GitHub mirror (CORS-enabled, under the 20MB gh limit). The score's
    // existing MIDI program (Violin) selects the patch; FluidR3 also has a "Fiddle"
    // patch (GM 110) if we ever want to switch the track program.
    soundFont: "https://cdn.jsdelivr.net/gh/musescore/MuseScore@2.1/share/sound/FluidR3Mono_GM.sf3",
    scrollElement: container,
  },
  display: {
    layoutMode: alphaTab.LayoutMode.Horizontal,
  },
});

// Load tune index and populate the dropdown, then load the first tune.
async function loadTune(file, title) {
  cancelCountIn();
  api.stop();
  stopEndWatchdog();
  playBtn.disabled = true;
  pauseBtn.disabled = true;
  stopBtn.disabled = true;
  tuneTitleEl.textContent = title;
  statusEl.textContent = "Loading tune…";
  try {
    const response = await fetch("music/" + file);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    api.load(buffer);
  } catch (err) {
    console.error("Failed to load tune:", err);
    statusEl.textContent = "Failed to load tune: " + err.message;
  }
}

(async () => {
  try {
    const res = await fetch("music/index.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tunes = await res.json();

    tunes.forEach((tune, i) => {
      const opt = document.createElement("option");
      opt.value = tune.file;
      opt.textContent = tune.title;
      tuneSelect.appendChild(opt);
    });

    tuneSelect.disabled = false;
    tuneSelect.addEventListener("change", () => {
      const selected = tunes.find(t => t.file === tuneSelect.value);
      if (selected) loadTune(selected.file, selected.title);
    });

    // Load the first tune automatically.
    if (tunes.length > 0) loadTune(tunes[0].file, tunes[0].title);
  } catch (err) {
    console.error("Failed to load tune index:", err);
    statusEl.textContent = "Failed to load tune index: " + err.message;
  }
})();

// The tick at which each loop iteration restarts. Set after scoreLoaded.
// If the tune has a pickup, this is the start of bar 1 (so the pickup only
// plays on the first pass). If not, it's 0.
let loopStartTick = 0;
let musicalEndTick = 0;
// The tune's native BPM, read from the score. The tempo slider value is
// the literal BPM the student wants; playbackSpeed = desiredBPM / originalBPM.
let originalBPM = 120;
// Interval handle for the end-of-song watchdog that drives the loop.
let endWatchdog = null;
// Guard so a single end-approach triggers exactly one seek. Reset once
// playback has clearly moved back into the body of the tune.
let seekArmed = true;

// --- Custom count-in ---
// Number of count-in beats before the first note. For a pickup tune: full bar
// minus pickup beats (e.g. 3 for a 1-beat pickup in 4/4). Computed in scoreLoaded.
let countInBeats = 4;
// Active count-in timer IDs — cleared if Stop is pressed before playback starts.
let countInTimers = [];
let countInActive = false;
// AlphaTab has ~20ms of audio latency between api.play() and the first audible
// sample. We fire play() this many ms early so the pickup lands on the last beat.
const ALPHATAB_START_LATENCY_MS = 20;

api.scoreLoaded.on((score) => {
  statusEl.textContent = "Loading soundfont…";
  musicalEndTick = 0; // reset; will be set accurately in playerReady after MIDI expansion
  detectAndFlagPickup(score);
  loopStartTick = computeLoopStartTick(score);

  // Initialize the tempo slider to the tune's native BPM.
  originalBPM = score.tempo || 120;
  tempoSlider.value = originalBPM;
  tempoReadout.textContent = originalBPM + " BPM";
  api.playbackSpeed = 1;

  // Compute how many count-in beats to play before the pickup (or downbeat).
  // Use the first FULL bar (masterBars[1] if bar 0 is a pickup, else masterBars[0])
  // so the time signature reflects the actual meter.
  const hasPickup = score.masterBars[0] && score.masterBars[0].isAnacrusis;
  const refBar = score.masterBars[hasPickup ? 1 : 0];
  if (refBar) {
    const barDur = refBar.calculateDuration();
    const ticksPerBeat = barDur / refBar.timeSignatureNumerator;
    const pickupBeats = ticksPerBeat > 0 ? loopStartTick / ticksPerBeat : 0;
    countInBeats = refBar.timeSignatureNumerator - pickupBeats;
  }
});

// Default loop behavior: pickup plays once at the start of every Play session,
// then the body (bar 2 → bar 17) loops continuously until the user hits Stop.
//
// A polling watchdog at 10ms catches playback just before the natural end and
// seeks backward to `loopStartTick` mid-play. This keeps the audio context
// continuously primed and avoids the brief pause from AlphaTab's
// `playerFinished` event firing ~116ms after the last tick followed by an
// audio-engine warm-up.
//
// The 50-tick safety margin cuts ~25ms off the tail of the last note at
// native tempo (imperceptible, and helps mask soundfont release tail).
// AlphaTab's native `isLooping` is not used because its wrap destination
// depends on where the session started — incompatible with "pickup once, then
// skip".
const END_APPROACH_MARGIN_TICKS = 50;

function startEndWatchdog() {
  if (endWatchdog) return;
  seekArmed = true;
  endWatchdog = setInterval(() => {
    if (api.playerState !== 1 || !musicalEndTick) return;
    const t = api.tickPosition;
    if (seekArmed && t >= musicalEndTick - END_APPROACH_MARGIN_TICKS) {
      api.tickPosition = loopStartTick;
      seekArmed = false;
    } else if (!seekArmed && t < musicalEndTick / 2) {
      // Playback has clearly advanced past the seek; re-arm for the next wrap.
      seekArmed = true;
    }
  }, 10);
}

function stopEndWatchdog() {
  if (endWatchdog) {
    clearInterval(endWatchdog);
    endWatchdog = null;
  }
}

// Sibelius exports pickup measures as a short first bar without marking it as
// an anacrusis. AlphaTab then pads the bar out to the full time signature with
// silence, producing an audible gap between the pickup notes and bar 2. We
// detect this case (first bar shorter than its time signature) and set the
// `isAnacrusis` flag so the MIDI is regenerated without the padding.
function detectAndFlagPickup(score) {
  const firstBar = score && score.masterBars && score.masterBars[0];
  if (!firstBar || firstBar.isAnacrusis) return;

  const fullBarDuration = firstBar.calculateDuration();
  const track = score.tracks[0];
  if (!track) return;
  const bar = track.staves[0].bars[0];
  const beats = (bar.voices[0] && bar.voices[0].beats) || [];
  const actualDuration = beats.reduce((sum, b) => sum + (b.playbackDuration || 0), 0);

  if (actualDuration > 0 && actualDuration < fullBarDuration) {
    firstBar.isAnacrusis = true;
    api.loadMidiForScore();
    console.log(`[pickup] First bar is a pickup (${actualDuration}/${fullBarDuration} ticks) — flagged as anacrusis.`);
  }
}

function computeLoopStartTick(score) {
  const firstBar = score && score.masterBars && score.masterBars[0];
  if (!firstBar || !firstBar.isAnacrusis) return 0;
  // calculateDuration(true) respects the anacrusis flag — returns the actual
  // tick length of the pickup (e.g. 960 for two eighths at 960 ticks/quarter).
  return firstBar.calculateDuration(true);
}

api.soundFontLoaded.on(() => {
  statusEl.textContent = "Ready.";
  playBtn.disabled = false;
  pauseBtn.disabled = false;
  stopBtn.disabled = false;
});

api.playerReady.on(() => {
  // By playerReady, AlphaTab has generated the full MIDI with repeats expanded.
  // The tick cache now reflects the actual playback length (e.g. 8 bars × 2 for
  // a full repeat), so musicalEndTick here is the correct loop boundary.
  const tc = api.tickCache;
  if (tc && tc.masterBars && tc.masterBars.length) {
    musicalEndTick = tc.masterBars[tc.masterBars.length - 1].end;
    console.log(`[player] musicalEndTick = ${musicalEndTick} (${tc.masterBars.length} playback bars)`);
  }
  statusEl.textContent = "Ready.";
  playBtn.disabled = false;
  pauseBtn.disabled = false;
  stopBtn.disabled = false;
});

api.error.on((err) => {
  console.error("AlphaTab error:", err);
  statusEl.textContent = "Error: " + (err?.message || err);
});

api.playerStateChanged.on((e) => {
  // 0 = paused, 1 = playing
  if (e.state === 1) {
    statusEl.textContent = "Playing…";
    startEndWatchdog();
  } else {
    statusEl.textContent = "Paused.";
    stopEndWatchdog();
  }
});

function cancelCountIn() {
  countInTimers.forEach(id => clearTimeout(id));
  countInTimers = [];
  countInActive = false;
}

// ============================================================================
// Metronome — MetroDrone kick drum (Tone.js) on AlphaTab's shared AudioContext
// ============================================================================
//
// History (see PROJECT_LOG): the kick has been attempted ~5 times. The two
// documented failure modes were:
//   (1) Tone.js on its OWN AudioContext → ~30ms output-latency offset vs the
//       AlphaTab violin. Different clocks, never reconciled.
//   (2) Driving clicks off `api.midiEventsPlayed` → worker-boundary batch
//       jitter ("garage hip-hop"), uneven delivery to the main thread.
//
// This implementation targets (1) head-on: we hand Tone.js *AlphaTab's own
// AudioContext* via `Tone.setContext`, so both engines share one clock and one
// output latency — the cross-engine offset disappears by construction. Timing
// comes from Tone.Transport (a sample-accurate musical grid), NOT from polling
// or midi events, which avoids (2).
//
// HONEST CAVEAT: this was written in an environment with no audio output, so
// sync was reasoned about, not heard. The real test is Jason's ear. If the kick
// lands consistently early/late against the melody, nudge KICK_OFFSET_SEC. If it
// drifts only at loop seams, that's the watchdog re-anchor (noted below).
// The previous wooden-block metronome is one `git revert` away if this regresses.

// Single tuning knob: shift every kick by this many seconds relative to the
// melody. 0 = no shift. Positive = later, negative = earlier.
const KICK_OFFSET_SEC = 0;

let kickSynth = null;
let kickGain = null;
let toneStarted = false;
let toneContextShared = false;
let kickGridRunning = false;

// Walk AlphaTab's object graph to find the live AudioContext it plays through.
// Field names are minified, so we search by instance type rather than by key.
function findAlphaTabAudioContext(root, depth = 0, seen = new Set()) {
  if (!root || depth > 6 || seen.has(root)) return null;
  seen.add(root);
  if (typeof AudioContext !== "undefined" && root instanceof AudioContext) return root;
  if (typeof webkitAudioContext !== "undefined" && root instanceof webkitAudioContext) return root;
  let keys = [];
  try { keys = Object.keys(root); } catch (e) { return null; }
  for (const k of keys) {
    let v;
    try { v = root[k]; } catch (e) { continue; }
    if (v && typeof v === "object") {
      const found = findAlphaTabAudioContext(v, depth + 1, seen);
      if (found) return found;
    }
  }
  return null;
}

// Lazily create the kick synth, sharing AlphaTab's AudioContext if we can find it.
async function ensureKick() {
  if (!toneStarted) {
    await Tone.start();
    toneStarted = true;
  }
  if (!toneContextShared) {
    const atCtx = findAlphaTabAudioContext(api);
    if (atCtx) {
      try {
        Tone.setContext(atCtx);
        toneContextShared = true;
        console.log(`[metronome] Sharing AlphaTab AudioContext (sampleRate ${atCtx.sampleRate}, baseLatency ${atCtx.baseLatency}).`);
      } catch (e) {
        console.warn("[metronome] Could not adopt AlphaTab's AudioContext; falling back to Tone's own context — sync may drift:", e);
      }
    } else {
      console.warn("[metronome] AlphaTab AudioContext not found; using Tone's default context — sync may drift.");
    }
  }
  if (!kickSynth) {
    // Exact MetroDrone kick config (Tone.MembraneSynth → Gain → destination).
    kickGain = new Tone.Gain(0).toDestination();
    kickSynth = new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 2,
      envelope: { attack: 0.0006, decay: 0.05, sustain: 0 },
    });
    kickSynth.connect(kickGain);
  }
  applyKickGain();
}

function applyKickGain() {
  if (!kickGain) return;
  const v = parseInt(metronomeVolumeSlider.value, 10) || 0;
  // Slider 0–100 → gain 0–1 (unity at 100). Competing only with the violin, so
  // unity is plenty; raise the multiplier here if the kick is too quiet.
  kickGain.gain.value = (v / 100) * 1.0;
}

// Schedule a kick on every quarter-note via Tone.Transport. Starting the
// Transport now lays down the count-in clicks; the same grid carries straight
// into the tune. BPM is slaved to the tempo slider.
function startKickGrid() {
  if (!kickSynth) return;
  Tone.Transport.cancel();
  Tone.Transport.bpm.value = parseInt(tempoSlider.value, 10);
  Tone.Transport.scheduleRepeat((time) => {
    kickSynth.triggerAttackRelease("C2", "16n", time + KICK_OFFSET_SEC);
  }, "4n", 0);
  Tone.Transport.position = 0;
  Tone.Transport.start();
  kickGridRunning = true;
}

function stopKickGrid() {
  if (!kickGridRunning) return;
  Tone.Transport.stop();
  Tone.Transport.cancel();
  kickGridRunning = false;
}

// Play with metronome on: start the kick grid (count-in begins immediately),
// then fire api.play() after `countInBeats` so the pickup/downbeat lands on the
// final count-in beat. Fired early by the AlphaTab startup latency.
playBtn.addEventListener("click", async () => {
  const metronomeOn = parseInt(metronomeVolumeSlider.value, 10) > 0;
  if (!metronomeOn) {
    api.play();
    return;
  }
  await ensureKick();
  cancelCountIn();
  countInActive = true;
  startKickGrid();
  const bpm = parseInt(tempoSlider.value, 10);
  const beatMs = 60000 / bpm;
  const playDelay = Math.max(0, countInBeats * beatMs - ALPHATAB_START_LATENCY_MS);
  const id = setTimeout(() => {
    if (!countInActive) return; // cancelled (e.g. Stop pressed mid-count-in)
    countInActive = false;
    api.play();
  }, playDelay);
  countInTimers.push(id);
});

pauseBtn.addEventListener("click", () => {
  api.pause();
  stopKickGrid();
});
stopBtn.addEventListener("click", () => {
  cancelCountIn();
  stopKickGrid();
  api.stop();
  stopEndWatchdog();
});

tempoSlider.addEventListener("input", () => {
  const bpm = parseInt(tempoSlider.value, 10);
  tempoReadout.textContent = bpm + " BPM";
  api.playbackSpeed = bpm / originalBPM;
  if (kickGridRunning) Tone.Transport.bpm.value = bpm; // keep the kick in step live
});

metronomeVolumeSlider.addEventListener("input", () => {
  const v = parseInt(metronomeVolumeSlider.value, 10);
  metronomeVolumeReadout.textContent = v === 0 ? "Off" : v + "%";
  applyKickGain();
});
