// FiddleHed Practice Engine — MVP player
// Loads one MusicXML file via AlphaTab, wires up play/pause/stop, tempo slider,
// and a metronome with count-in (both via AlphaTab's built-in clicks).

const TUNE_FILE = "music/Oh Susanna.musicxml";
const TUNE_TITLE = "Oh Susanna";

const statusEl = document.getElementById("status");
const playBtn = document.getElementById("play");
const pauseBtn = document.getElementById("pause");
const stopBtn = document.getElementById("stop");
const tempoSlider = document.getElementById("tempo");
const tempoReadout = document.getElementById("tempo-readout");
const metronomeVolumeSlider = document.getElementById("metronome-volume");
const metronomeVolumeReadout = document.getElementById("metronome-volume-readout");
const tuneTitleEl = document.getElementById("tune-title");
const container = document.getElementById("alphatab-container");

tuneTitleEl.textContent = TUNE_TITLE;

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

// Load the MusicXML file manually so we don't depend on AlphaTab's worker fetch.
(async () => {
  try {
    statusEl.textContent = "Loading tune…";
    const response = await fetch(TUNE_FILE);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    api.load(buffer);
  } catch (err) {
    console.error("Failed to load tune:", err);
    statusEl.textContent = "Failed to load tune: " + err.message;
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

api.scoreLoaded.on((score) => {
  statusEl.textContent = "Loading soundfont…";
  detectAndFlagPickup(score);
  loopStartTick = computeLoopStartTick(score);
  const tc = api.tickCache;
  if (tc && tc.masterBars && tc.masterBars.length) {
    musicalEndTick = tc.masterBars[tc.masterBars.length - 1].end;
  }

  // Initialize the tempo slider to the tune's native BPM.
  originalBPM = score.tempo || 120;
  tempoSlider.value = originalBPM;
  tempoReadout.textContent = originalBPM + " BPM";
  api.playbackSpeed = 1;
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

playBtn.addEventListener("click", () => api.play());
pauseBtn.addEventListener("click", () => api.pause());
stopBtn.addEventListener("click", () => {
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
  const normalized = v / 100;
  api.metronomeVolume = normalized;
  api.countInVolume = normalized;
}

metronomeVolumeSlider.addEventListener("input", () => {
  const v = parseInt(metronomeVolumeSlider.value, 10);
  metronomeVolumeReadout.textContent = v === 0 ? "Off" : v + "%";
  applyMetronomeVolume();
});
