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
    soundFont: "https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.4.3/dist/soundfont/sonivox.sf2",
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

// Plays `countInBeats` short click tones via Web Audio, then fires api.play()
// so the first note lands on beat (countInBeats + 1).
// For Oh Susanna (1-beat pickup in 4/4): 3 clicks, pickup on click 4.
// For a no-pickup tune in 4/4: 4 clicks, downbeat on click 5.
function runCustomCountIn() {
  if (countInActive) return;
  countInActive = true;

  const bpm = parseInt(tempoSlider.value, 10);
  const beatMs = 60000 / bpm;
  const beats = countInBeats;

  // Web Audio oscillator beeps — independent AudioContext just for the count-in.
  // These don't need to stay synced past the first note; AlphaTab's own metronome
  // handles all in-tune clicks.
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  for (let i = 0; i < beats; i++) {
    const t = ctx.currentTime + (i * beatMs / 1000);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // Slightly higher pitch on beat 1 so students can feel the downbeat of the count-in.
    osc.frequency.value = i === 0 ? 1047 : 880;
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  // Fire api.play() early by the AlphaTab startup latency so the pickup note
  // arrives in sync with the last count-in beat.
  const playDelay = Math.max(0, beats * beatMs - ALPHATAB_START_LATENCY_MS);
  const id = setTimeout(() => {
    if (!countInActive) return; // cancelled (e.g. Stop pressed mid-count-in)
    countInActive = false;
    api.play();
  }, playDelay);
  countInTimers.push(id);
}

playBtn.addEventListener("click", () => {
  const metronomeOn = parseInt(metronomeVolumeSlider.value, 10) > 0;
  if (metronomeOn) {
    runCustomCountIn();
  } else {
    api.play();
  }
});
pauseBtn.addEventListener("click", () => api.pause());
stopBtn.addEventListener("click", () => {
  cancelCountIn();
  api.stop();
  stopEndWatchdog();
});

tempoSlider.addEventListener("input", () => {
  const bpm = parseInt(tempoSlider.value, 10);
  tempoReadout.textContent = bpm + " BPM";
  api.playbackSpeed = bpm / originalBPM;
});

// --- Metronome ---
//
// AlphaTab's built-in click on every beat + a 1-bar count-in before the tune.
// Both ride AlphaTab's own audio clock, so they stay in sync with the melody
// by construction. One slider controls both: 0 silences everything; any
// non-zero value gives a 1-bar count-in (4 clicks in 4/4) followed by the
// tune with clicks on every beat. Click sound is a stock wooden block from
// the soundfont — not the MetroDrone kick we originally wanted, but sync is
// the MVP priority. See PROJECT_LOG for the saga.
function applyMetronomeVolume() {
  const v = parseInt(metronomeVolumeSlider.value, 10) || 0;
  api.metronomeVolume = v / 100;
  api.countInVolume = 0; // Always 0 — we handle count-in ourselves via runCustomCountIn()
}

metronomeVolumeSlider.addEventListener("input", () => {
  const v = parseInt(metronomeVolumeSlider.value, 10);
  metronomeVolumeReadout.textContent = v === 0 ? "Off" : v + "%";
  applyMetronomeVolume();
});
