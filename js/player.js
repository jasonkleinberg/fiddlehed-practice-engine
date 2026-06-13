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
  kickInjected = false; // re-inject the kick into the new tune's MIDI
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

    tunes.forEach((tune) => {
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

    // Pick the initial tune. A `?tune=<slug>` URL param wins — this is how a
    // WordPress lesson page embeds a specific tune AND returns to it on refresh
    // (the default lives in the URL, not in browser storage, so a student who
    // wanders to another tune snaps back on reload). Missing/unknown slug falls
    // back to the first tune so an embed code typo never blanks the player.
    const requestedSlug = new URLSearchParams(window.location.search).get("tune");
    const initial = (requestedSlug && tunes.find((t) => t.slug === requestedSlug)) || tunes[0];
    if (initial) {
      tuneSelect.value = initial.file;
      loadTune(initial.file, initial.title);
    }
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
// Ticks per quarter-note beat for the current tune. Used to place the kick on
// every beat when injecting it into the score's MIDI (see injectKickIntoPlayback).
let ticksPerBeat = 0;
// Guard so the kick is injected once per tune-load (loadMidiFile re-fires
// playerReady, which would otherwise recurse). Reset in loadTune.
let kickInjected = false;
// The tune's native BPM, read from the score. The tempo slider value is
// the literal BPM the student wants; playbackSpeed = desiredBPM / originalBPM.
let originalBPM = 120;
// Interval handle for the end-of-song watchdog that drives the loop.
let endWatchdog = null;
// Guard so a single end-approach triggers exactly one seek. Reset once
// playback has clearly moved back into the body of the tune.
let seekArmed = true;

// GM program forced onto the melody track regardless of what the MusicXML asks
// for. Our Sibelius exports specify "Bright Piano" (program 1), so without this
// override every tune plays as a piano no matter how good the soundfont is.
// 40 = Violin. (41 = Viola, 42 = Cello, 110 = Fiddle if we want a twangier tone.)
const MELODY_PROGRAM = 40;

api.scoreLoaded.on((score) => {
  statusEl.textContent = "Loading soundfont…";
  musicalEndTick = 0; // reset; will be set accurately in playerReady after MIDI expansion
  detectAndFlagPickup(score);
  loopStartTick = computeLoopStartTick(score);

  // Force the melody onto a violin patch. Two things fight us here, both from
  // the Sibelius export:
  //   1. The track's playbackInfo program is piano — set it to Violin.
  //   2. The score also carries an *Instrument automation* on bar 0 beat 0 with
  //      value 0 (piano). AlphaTab emits that as a program-change AFTER the
  //      track program, so it clobbers the violin on the melody channel. We have
  //      to rewrite that automation too, or the tune always plays as piano.
  score.tracks.forEach((t) => {
    if (t.playbackInfo) t.playbackInfo.program = MELODY_PROGRAM;
    t.staves.forEach((st) => st.bars.forEach((bar) =>
      (bar.voices || []).forEach((v) => (v.beats || []).forEach((b) =>
        (b.automations || []).forEach((a) => {
          if (a.type === alphaTab.model.AutomationType.Instrument) a.value = MELODY_PROGRAM;
        })
      ))
    ));
  });
  // Regenerate the MIDI so the pickup flag, the program change, and the
  // automation rewrite all take effect. (detectAndFlagPickup no longer calls
  // this itself — see below.)
  api.loadMidiForScore();

  // Initialize the tempo slider to the tune's native BPM.
  originalBPM = score.tempo || 120;
  tempoSlider.value = originalBPM;
  tempoReadout.textContent = originalBPM + " BPM";
  api.playbackSpeed = 1;

  // Ticks per beat, from the first FULL bar (masterBars[1] if bar 0 is a pickup),
  // so the time signature reflects the actual meter. Used to place the kick.
  const hasPickup = score.masterBars[0] && score.masterBars[0].isAnacrusis;
  const refBar = score.masterBars[hasPickup ? 1 : 0];
  if (refBar) {
    ticksPerBeat = refBar.calculateDuration() / refBar.timeSignatureNumerator;
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
    // MIDI regeneration is done once by the caller (scoreLoaded) after the
    // program override, so we don't call api.loadMidiForScore() here.
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

  // Overlay the kick onto the score's MIDI now that the expanded tick range is
  // known. loadMidiFile re-fires playerReady, so guard against recursion.
  if (!kickInjected) {
    kickInjected = true;
    injectKickIntoPlayback();
  }
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

// ============================================================================
// Metronome — kick drum INSIDE AlphaTab's own engine
// ============================================================================
//
// History (see PROJECT_LOG): the kick spent many sessions in a SECOND audio
// engine (Tone.js MembraneSynth). It sounded good, but two independent clocks
// could never stay locked — it drifted on big tempo changes and its audio
// context kept suspending.
//
// What ships now: the kick is a percussion note (GM 36, channel 9) injected onto
// EVERY beat of the score's OWN MIDI, played by AlphaTab's synth from FluidR3's
// drum kit. Same MIDI, same clock, same synth as the violin — so it is
// sample-accurate by construction and CANNOT drift. Changing the tempo scales
// the kick and the melody identically (one `api.playbackSpeed`). No Tone.js, no
// offset knob, no re-anchoring, no suspended-context handling.
//
// Volume rides MIDI channel 9 via api.player.setChannelVolume. The lead-in uses
// AlphaTab's native count-in (api.countInVolume); note that its click is
// AlphaTab's own sound, not the kick (a known polish item).

const KICK_NOTE = 36; // GM Acoustic Bass Drum / kick. 35 is also a kick; 37/side-stick is drier.
const KICK_CHANNEL = 9; // GM percussion channel
const KICK_VELOCITY = 110;
const KICK_NOTE_TICKS = 30; // brief note so each hit is a clean transient

// Regenerate the score's MIDI, overlay a kick on every beat, and hand it to the
// synth. Called once per tune-load from playerReady, when the expanded tick
// range (musicalEndTick) and ticksPerBeat are both known.
function injectKickIntoPlayback() {
  if (!ticksPerBeat || !musicalEndTick) return;
  const mf = new alphaTab.midi.MidiFile();
  const gen = new alphaTab.midi.MidiFileGenerator(
    api.score, api.settings, new alphaTab.midi.AlphaSynthMidiFileHandler(mf)
  );
  gen.generate();
  let count = 0;
  for (let t = 0; t < musicalEndTick; t += ticksPerBeat) {
    mf.addEvent(new alphaTab.midi.NoteOnEvent(0, t, KICK_CHANNEL, KICK_NOTE, KICK_VELOCITY));
    mf.addEvent(new alphaTab.midi.NoteOffEvent(0, t + KICK_NOTE_TICKS, KICK_CHANNEL, KICK_NOTE, 0));
    count++;
  }
  // The synth expects events in tick order; our kicks were appended at the end.
  mf.events.sort((a, b) => a.tick - b.tick);
  api.player.loadMidiFile(mf);
  applyKickVolume();
  console.log(`[metronome] Injected ${count} kicks (note ${KICK_NOTE}, ch ${KICK_CHANNEL}) across ${musicalEndTick} ticks.`);
}

// Slider 0–100 → channel-9 volume 0–1 (0 = silent). Channel volumes reset when a
// new MIDI is loaded, so this is re-applied after every injection and on Play.
function applyKickVolume() {
  if (!api.player || !api.player.setChannelVolume) return;
  const v = parseInt(metronomeVolumeSlider.value, 10) || 0;
  api.player.setChannelVolume(KICK_CHANNEL, v / 100);
}

playBtn.addEventListener("click", () => {
  const v = parseInt(metronomeVolumeSlider.value, 10) || 0;
  // AlphaTab's native one-bar count-in when the metronome is up. metronomeVolume
  // stays 0 so AlphaTab doesn't layer its own click over our injected kick.
  api.countInVolume = v > 0 ? v / 100 : 0;
  api.metronomeVolume = 0;
  applyKickVolume();
  api.play();
});
pauseBtn.addEventListener("click", () => api.pause());
stopBtn.addEventListener("click", () => {
  api.stop();
  stopEndWatchdog();
});

tempoSlider.addEventListener("input", () => {
  const bpm = parseInt(tempoSlider.value, 10);
  tempoReadout.textContent = bpm + " BPM";
  // Scales the melody AND the kick together (they're one MIDI) — no drift.
  api.playbackSpeed = bpm / originalBPM;
});

metronomeVolumeSlider.addEventListener("input", () => {
  const v = parseInt(metronomeVolumeSlider.value, 10);
  metronomeVolumeReadout.textContent = v === 0 ? "Off" : v + "%";
  applyKickVolume();
});

// Spacebar toggles play/pause. This used to work for free because the Play
// button kept focus, but the control rewrites broke that. Bind it explicitly so
// it works no matter what's focused (except the tune dropdown, where Space
// should open the list). preventDefault stops the page from scrolling.
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" && e.key !== " ") return;
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "SELECT") return;
  e.preventDefault();
  (api.playerState === 1 ? pauseBtn : playBtn).click();
});
