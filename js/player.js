// FiddleHed Practice Engine — MVP player
// Loads one MusicXML file via AlphaTab, wires up play/pause/stop and a tempo slider.

const TUNE_FILE = "music/Oh Susanna.musicxml";
const TUNE_TITLE = "Oh Susanna";

const statusEl = document.getElementById("status");
const playBtn = document.getElementById("play");
const pauseBtn = document.getElementById("pause");
const stopBtn = document.getElementById("stop");
const tempoSlider = document.getElementById("tempo");
const tempoReadout = document.getElementById("tempo-readout");
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

api.scoreLoaded.on(() => {
  statusEl.textContent = "Loading soundfont…";
});

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
  } else {
    statusEl.textContent = "Paused.";
  }
});

playBtn.addEventListener("click", () => api.play());
pauseBtn.addEventListener("click", () => api.pause());
stopBtn.addEventListener("click", () => api.stop());

tempoSlider.addEventListener("input", () => {
  const pct = parseInt(tempoSlider.value, 10);
  tempoReadout.textContent = pct + "%";
  // AlphaTab playbackSpeed: 1.0 = original tempo
  api.playbackSpeed = pct / 100;
});
