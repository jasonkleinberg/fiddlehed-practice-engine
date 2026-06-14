/* ============================================================================
 * FiddleHed Practice Engine — 3-layer play-along prototype (Tone.js)
 * ----------------------------------------------------------------------------
 * Three synced layers on ONE Tone.Transport (one clock = sample-accurate sync):
 *   1. Melody  — Tone.Sampler, real violin samples (tonejs-instruments).
 *   2. Organ   — stacked-sine PolySynth, chords read from MusicXML <harmony>.
 *   3. Kick    — MetroDrone's Tone.MembraneSynth, one hit per beat.
 * Each layer routes through its own Tone.Gain for an independent volume slider.
 * Tempo is the Transport BPM, so all three scale together for free.
 *
 * This is a standalone prototype (playalong.html). The old AlphaTab app
 * (index.html / js/player.js) is untouched.
 * ==========================================================================*/

(() => {
  "use strict";

  // ---- Config -------------------------------------------------------------
  const TUNE_FILE = "music/Oh Susanna.musicxml";
  const VIOLIN_BASE =
    "https://cdn.jsdelivr.net/gh/nbrosowsky/tonejs-instruments/samples/violin/";
  // Confirmed-present samples (HTTP 200). Sampler interpolates the gaps.
  const VIOLIN_URLS = {
    A3: "A3.mp3", C4: "C4.mp3", E4: "E4.mp3", G4: "G4.mp3",
    A4: "A4.mp3", C5: "C5.mp3", E5: "E5.mp3", G5: "G5.mp3",
    A5: "A5.mp3", C6: "C6.mp3", E6: "E6.mp3", G6: "G6.mp3",
    A6: "A6.mp3", C7: "C7.mp3", G3: "G3.mp3",
  };

  // ---- DOM ----------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const els = {
    title: $("tune-title"),
    status: $("status"),
    play: $("play"),
    pause: $("pause"),
    stop: $("stop"),
    tempo: $("tempo"),
    tempoOut: $("tempo-readout"),
    melVol: $("melody-volume"),
    melOut: $("melody-volume-readout"),
    orgVol: $("organ-volume"),
    orgOut: $("organ-volume-readout"),
    kickVol: $("kick-volume"),
    kickOut: $("kick-volume-readout"),
  };

  function setStatus(msg) { els.status.textContent = msg; }

  // =========================================================================
  // 1. MusicXML PARSER
  //    Walks each measure in document order, tracking a global tick cursor.
  //    Emits melody notes and chord changes with onset times in QUARTER beats.
  // =========================================================================
  const STEP_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function pitchToMidi(step, alter, octave) {
    return (octave + 1) * 12 + STEP_SEMITONE[step] + (alter || 0);
  }

  function parseMusicXML(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Bad MusicXML");

    const part = doc.querySelector("part");
    const measures = [...part.querySelectorAll("measure")];

    let divisions = null;       // ticks per quarter note (locked at first read)
    let beatsPerBar = 4, beatType = 4;
    let cursor = 0;             // global position in ticks
    let lastNoteOnset = 0;      // onset of the previous (non-chord) note
    const rawNotes = [];        // { tick, durTick, midi, tieStart, tieStop }
    const chords = [];          // { tick, rootStep, rootAlter, kind }

    for (const m of measures) {
      for (const el of [...m.children]) {
        switch (el.tagName) {
          case "attributes": {
            const d = el.querySelector("divisions");
            if (d && divisions === null) divisions = parseInt(d.textContent, 10);
            const b = el.querySelector("time > beats");
            const t = el.querySelector("time > beat-type");
            if (b) beatsPerBar = parseInt(b.textContent, 10);
            if (t) beatType = parseInt(t.textContent, 10);
            break;
          }
          case "harmony": {
            const rootStep = el.querySelector("root > root-step")?.textContent;
            const rootAlter = parseInt(
              el.querySelector("root > root-alter")?.textContent || "0", 10);
            const kind = el.querySelector("kind")?.textContent || "major";
            if (rootStep) chords.push({ tick: cursor, rootStep, rootAlter, kind });
            break;
          }
          case "note": {
            const isChord = !!el.querySelector("chord");
            const isRest = !!el.querySelector("rest");
            const durTick = parseInt(
              el.querySelector("duration")?.textContent || "0", 10);
            let onset;
            if (isChord) {
              onset = lastNoteOnset;       // shares previous note's onset
            } else {
              onset = cursor;
              lastNoteOnset = cursor;
              cursor += durTick;           // advance the clock
            }
            if (!isRest) {
              const step = el.querySelector("pitch > step")?.textContent;
              const alter = parseInt(
                el.querySelector("pitch > alter")?.textContent || "0", 10);
              const octave = parseInt(
                el.querySelector("pitch > octave")?.textContent || "4", 10);
              const ties = [...el.querySelectorAll("tie")].map(
                (t) => t.getAttribute("type"));
              rawNotes.push({
                tick: onset,
                durTick,
                midi: pitchToMidi(step, alter, octave),
                tieStart: ties.includes("start"),
                tieStop: ties.includes("stop"),
              });
            }
            break;
          }
          case "backup":
            cursor -= parseInt(
              el.querySelector("duration")?.textContent || "0", 10);
            break;
          case "forward":
            cursor += parseInt(
              el.querySelector("duration")?.textContent || "0", 10);
            break;
        }
      }
    }

    if (!divisions) divisions = 256;

    // Merge tied notes: a note with tieStop folds into the open note of the
    // same pitch, extending its duration (one attack, held longer).
    const notes = [];
    for (const n of rawNotes) {
      if (n.tieStop) {
        const prev = [...notes].reverse().find(
          (p) => p.midi === n.midi && p.tieOpen);
        if (prev) {
          prev.durTick += n.durTick;
          prev.tieOpen = n.tieStart;   // stays open if this segment also starts a tie
          continue;
        }
      }
      notes.push({ ...n, tieOpen: n.tieStart });
    }

    const tpb = divisions;             // ticks per beat (quarter)
    return {
      divisions,
      beatsPerBar,
      beatType,
      totalBeats: cursor / tpb,
      notes: notes.map((n) => ({
        beat: n.tick / tpb,
        durBeats: n.durTick / tpb,
        midi: n.midi,
      })),
      chords: chords.map((c) => ({
        beat: c.tick / tpb,
        midis: chordMidis(c.rootStep, c.rootAlter, c.kind),
        label: c.rootStep + (c.rootAlter > 0 ? "#" : c.rootAlter < 0 ? "b" : "")
          + kindShort(c.kind),
      })),
    };
  }

  // Build a triad (+7th for seventh chords) one octave below middle, organ range.
  function chordMidis(rootStep, rootAlter, kind) {
    const root = pitchToMidi(rootStep, rootAlter, 3); // organ register
    const k = (kind || "").toLowerCase();
    let iv;
    if (k.includes("dim")) iv = [0, 3, 6];
    else if (k.includes("aug")) iv = [0, 4, 8];
    else if (k.includes("min")) iv = [0, 3, 7];
    else iv = [0, 4, 7];                  // major / dominant / default
    if (k.includes("seventh") || k.includes("dominant") || k.includes("-7")) {
      iv = iv.concat(k.includes("major-seventh") ? 11 : 10);
    }
    return iv.map((i) => root + i);
  }

  function kindShort(kind) {
    const k = (kind || "").toLowerCase();
    if (k.includes("min")) return "m";
    if (k.includes("dim")) return "dim";
    if (k.includes("aug")) return "aug";
    return "";
  }

  // Convert a beat position (in quarter notes) to Tone's bars:beats:sixteenths.
  // Tempo-relative, so Tone.Part reschedules correctly when BPM changes.
  function beatToBBS(beat) {
    const sixteenths = beat * 4;
    const bars = Math.floor(sixteenths / 16);
    let rem = sixteenths - bars * 16;
    const beats = Math.floor(rem / 4);
    const six = rem - beats * 4;
    return `${bars}:${beats}:${six}`;
  }

  // =========================================================================
  // 2. AUDIO ENGINE
  // =========================================================================
  const engine = {
    ready: false,
    built: false,
    score: null,
    sampler: null,
    organ: null,
    kick: null,
    melodyGain: null,
    organGain: null,
    kickGain: null,
    melodyPart: null,
    organPart: null,
    kickEventId: null,
  };

  function buildInstruments() {
    // Per-layer gain → independent volume sliders (MetroDrone Tone.Gain pattern).
    engine.melodyGain = new Tone.Gain(els.melVol.value / 100).toDestination();
    engine.organGain = new Tone.Gain(els.orgVol.value / 100).toDestination();
    engine.kickGain = new Tone.Gain(els.kickVol.value / 100).toDestination();

    // Layer 1 — violin Sampler
    engine.sampler = new Tone.Sampler({
      urls: VIOLIN_URLS,
      baseUrl: VIOLIN_BASE,
      release: 0.4,
      onload: () => {
        engine.ready = true;
        enableTransport();
        setStatus("Ready. Press Play.");
      },
    }).connect(engine.melodyGain);

    // Layer 2 — drawbar organ: stacked-sine partials, soft sustain.
    engine.organ = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine", partials: [1, 0.6, 0.4, 0.25, 0.15, 0.1] },
      envelope: { attack: 0.04, decay: 0.1, sustain: 0.9, release: 0.4 },
    }).connect(engine.organGain);
    engine.organ.volume.value = -8;   // organ sits under the melody

    // Layer 3 — MetroDrone kick (exact MembraneSynth config from that project).
    engine.kick = new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 2,
      envelope: { attack: 0.0006, decay: 0.05, sustain: 0 },
    }).connect(engine.kickGain);

    engine.built = true;
  }

  // Schedule all three layers onto the Transport from the parsed score.
  function scheduleScore() {
    const s = engine.score;

    // Melody — one Part of note events.
    engine.melodyPart = new Tone.Part((time, ev) => {
      const dur = ev.durBeats * (60 / Tone.Transport.bpm.value);
      engine.sampler.triggerAttackRelease(
        Tone.Frequency(ev.midi, "midi").toNote(), dur, time);
    }, s.notes.map((n) => [beatToBBS(n.beat), n]));
    engine.melodyPart.start(0);

    // Organ — each chord sustains until the next chord change (or tune end).
    const chordEvents = s.chords.map((c, i) => {
      const endBeat = i + 1 < s.chords.length ? s.chords[i + 1].beat : s.totalBeats;
      return { ...c, durBeats: Math.max(0.1, endBeat - c.beat) };
    });
    engine.organPart = new Tone.Part((time, ev) => {
      const dur = ev.durBeats * (60 / Tone.Transport.bpm.value);
      const names = ev.midis.map((m) => Tone.Frequency(m, "midi").toNote());
      engine.organ.triggerAttackRelease(names, dur, time);
    }, chordEvents.map((c) => [beatToBBS(c.beat), c]));
    engine.organPart.start(0);

    // Kick — one hit on every beat (quarter note), loops with the Transport.
    engine.kickEventId = Tone.Transport.scheduleRepeat((time) => {
      engine.kick.triggerAttackRelease("C2", "8n", time);
    }, "4n", "0:0:0");

    // Loop the whole tune.
    Tone.Transport.loop = true;
    Tone.Transport.loopStart = 0;
    Tone.Transport.loopEnd = beatToBBS(s.totalBeats);
  }

  // ---- Transport controls -------------------------------------------------
  async function onPlay() {
    if (!engine.ready) return;
    await Tone.start();                       // unlock audio on user gesture
    if (!engine.melodyPart) scheduleScore();  // first play only
    Tone.Transport.start();
    setStatus("Playing.");
    els.play.disabled = true;
    els.pause.disabled = false;
    els.stop.disabled = false;
  }

  function onPause() {
    Tone.Transport.pause();
    setStatus("Paused.");
    els.play.disabled = false;
    els.pause.disabled = true;
  }

  function onStop() {
    Tone.Transport.stop();
    Tone.Transport.position = 0;
    setStatus("Stopped.");
    els.play.disabled = false;
    els.pause.disabled = true;
    els.stop.disabled = true;
  }

  function enableTransport() {
    els.play.disabled = false;
  }

  // ---- Slider wiring ------------------------------------------------------
  function wireSliders() {
    els.tempo.addEventListener("input", () => {
      const bpm = parseInt(els.tempo.value, 10);
      els.tempoOut.textContent = `${bpm} BPM`;
      Tone.Transport.bpm.value = bpm;
    });

    const vol = (slider, out, getGain) => {
      slider.addEventListener("input", () => {
        const v = parseInt(slider.value, 10);
        out.textContent = `${v}%`;
        const g = getGain();
        if (g) g.gain.rampTo(v / 100, 0.03);
      });
    };
    vol(els.melVol, els.melOut, () => engine.melodyGain);
    vol(els.orgVol, els.orgOut, () => engine.organGain);
    vol(els.kickVol, els.kickOut, () => engine.kickGain);
  }

  // =========================================================================
  // 3. INIT
  // =========================================================================
  async function init() {
    wireSliders();
    els.play.addEventListener("click", onPlay);
    els.pause.addEventListener("click", onPause);
    els.stop.addEventListener("click", onStop);

    // Spacebar = play/pause (ignored while typing in a control).
    document.addEventListener("keydown", (e) => {
      if (e.code !== "Space") return;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName))
        return;
      e.preventDefault();
      (Tone.Transport.state === "started" ? els.pause : els.play).click();
    });

    Tone.Transport.bpm.value = parseInt(els.tempo.value, 10);

    try {
      setStatus("Loading tune…");
      const xml = await (await fetch(TUNE_FILE)).text();
      engine.score = parseMusicXML(xml);
      els.title.textContent =
        `${TUNE_FILE.split("/").pop().replace(/\.musicxml$/, "")} — `
        + `${engine.score.notes.length} notes, ${engine.score.chords.length} chords`;
      console.log("[playalong] parsed score:", engine.score);
      buildInstruments();
      setStatus("Loading violin samples…");
    } catch (err) {
      console.error(err);
      setStatus("Error: " + err.message);
    }
  }

  window.addEventListener("DOMContentLoaded", init);
  window.__engine = engine;   // for in-browser debugging
})();
