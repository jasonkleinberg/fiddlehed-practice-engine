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
  const INDEX_FILE = "music/index.json";
  const DEFAULT_BPM = 90;   // used when a tune's index.json tempo is null
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
    lessonLink: $("lesson-link"),
    tuneSearch: $("tune-search"),
    tuneSelect: $("tune-select"),
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
    let firstMeasureTicks = null; // duration of measure 1 (pickup detection)
    let lastNoteOnset = 0;      // onset of the previous (non-chord) note
    const rawNotes = [];        // { tick, durTick, midi, tieStart, tieStop }
    const chords = [];          // { tick, rootStep, rootAlter, kind }

    for (const m of measures) {
      const measureStart = cursor;
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
      if (firstMeasureTicks === null) firstMeasureTicks = cursor - measureStart;
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

    // Pickup (anacrusis): if measure 1 is shorter than a full bar, it's a
    // pickup. Score convention here writes the FINAL bar full-length, so a
    // naive loop of totalBeats adds pickupBeats of dead time at the wrap.
    // The loop should end pickupBeats early: the pickup then re-enters on the
    // final bar's last beat(s) while the held final note rings over it.
    const barTicks = beatsPerBar * tpb * (4 / beatType);
    const pickupBeats =
      firstMeasureTicks && firstMeasureTicks < barTicks
        ? firstMeasureTicks / tpb : 0;

    return {
      divisions,
      beatsPerBar,
      beatType,
      pickupBeats,
      totalBeats: cursor / tpb,
      loopBeats: cursor / tpb - pickupBeats,
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
    tunes: [],        // index.json records, sorted in course order
    current: null,    // the loaded tune's index.json record
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
      envelope: { attack: 0.0006, decay: 0.1, sustain: 0 },
    }).connect(engine.kickGain);
    // The MetroDrone patch is a short 50ms thud at C2 — fine solo, but buried
    // under violin samples + organ at unity gain. Boost the synth hard so the
    // kick can sit ON TOP of the mix at max slider (Jason: +10 wasn't enough;
    // decay also lengthened 0.05→0.1 for more body/audibility).
    engine.kick.volume.value = 16;

    engine.built = true;
  }

  // Schedule all three layers onto the Transport from the parsed score.
  function scheduleScore() {
    const s = engine.score;

    // Melody — one Part of note events.
    // MELODY LEAD: real violin samples have a soft bow-attack onset, so the
    // pitch "speaks" ~40ms after trigger. Against the instant-attack kick that
    // reads as the melody dragging, worst at fast tempos. Compensate by
    // triggering melody notes early by a fixed wall-clock lead. Clamped so the
    // first note can't be scheduled in the past. Live-tunable in the console:
    // window.__melodyLead = 0.06 (seconds).
    window.__melodyLead = window.__melodyLead ?? 0.04;
    engine.melodyPart = new Tone.Part((time, ev) => {
      const dur = ev.durBeats * (60 / Tone.Transport.bpm.value);
      const when = Math.max(time - window.__melodyLead, Tone.now());
      engine.sampler.triggerAttackRelease(
        Tone.Frequency(ev.midi, "midi").toNote(), dur, when);
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

    // Kick — one hit per PULSE, loops with the Transport. In simple meters
    // (4/4, 3/4, 2/4) the pulse is the quarter note. In compound meters
    // (6/8 jigs, 9/8 slip jigs) the felt pulse is the dotted quarter — a
    // quarter-note kick against a jig is rhythmically wrong.
    const compound = s.beatType === 8 && s.beatsPerBar % 3 === 0;
    engine.kickEventId = Tone.Transport.scheduleRepeat((time) => {
      engine.kick.triggerAttackRelease("C2", "8n", time);
    }, compound ? "4n." : "4n", "0:0:0");

    // Loop the tune. loopBeats = totalBeats minus the pickup, so the wrap
    // lands the pickup on the final bar's last beat(s) — no dead beat. Notes
    // already sounding (the held final note) keep ringing through the wrap
    // because triggerAttackRelease durations are wall-clock, not truncated.
    Tone.Transport.loop = true;
    Tone.Transport.loopStart = 0;
    Tone.Transport.loopEnd = beatToBBS(s.loopBeats);
  }

  // Tear down the previous tune's schedule so tunes never overlap.
  function clearSchedule() {
    if (engine.melodyPart) { engine.melodyPart.dispose(); engine.melodyPart = null; }
    if (engine.organPart) { engine.organPart.dispose(); engine.organPart = null; }
    if (engine.kickEventId !== null) {
      Tone.Transport.clear(engine.kickEventId);
      engine.kickEventId = null;
    }
    // Kill anything still sounding (held organ chord, ringing melody note).
    if (engine.sampler && engine.sampler.releaseAll) engine.sampler.releaseAll();
    if (engine.organ && engine.organ.releaseAll) engine.organ.releaseAll();
  }

  // =========================================================================
  // 2b. TUNE LIBRARY (index.json) + loadTune
  // =========================================================================

  // Natural sort for lesson ids like "1.13", "10.02", "4b08": digit runs are
  // zero-padded so string compare orders them numerically.
  function lessonSortKey(id) {
    return String(id)
      .split(/(\d+)/)
      .map((s) => (/^\d+$/.test(s) ? s.padStart(6, "0") : s))
      .join("");
  }
  const byCourseOrder = (a, b) =>
    a.module - b.module ||
    lessonSortKey(a.lesson_id).localeCompare(lessonSortKey(b.lesson_id));

  const tuneLabel = (r) => `${r.lesson_id} · ${r.title} (${r.key})`;

  // (Re)populate the <select>, optionally filtered, grouped by module.
  function buildSelector(filter) {
    const q = (filter || "").trim().toLowerCase();
    els.tuneSelect.innerHTML = "";
    let group = null, groupModule = null;
    for (const r of engine.tunes) {
      if (q && !`${r.title} ${r.lesson_id} ${r.key}`.toLowerCase().includes(q))
        continue;
      if (r.module !== groupModule) {
        group = document.createElement("optgroup");
        group.label = `Module ${r.module}`;
        els.tuneSelect.appendChild(group);
        groupModule = r.module;
      }
      const opt = document.createElement("option");
      opt.value = r.slug;
      opt.textContent = tuneLabel(r);
      group.appendChild(opt);
    }
    // Keep the loaded tune selected if it survived the filter.
    const cur = engine.current && engine.current.slug;
    if (cur && [...els.tuneSelect.options].some((o) => o.value === cur))
      els.tuneSelect.value = cur;
  }

  // Load a tune record: fetch + parse its XML, reset tempo, reschedule.
  // If a tune was playing, the new one starts playing from the top (no
  // extra Play click needed — audio context is already unlocked).
  let loadToken = 0;   // guards against rapid tune-switch races
  async function loadTune(rec) {
    const token = ++loadToken;
    const wasPlaying =
      typeof Tone !== "undefined" && Tone.Transport.state === "started";
    Tone.Transport.stop();
    Tone.Transport.position = 0;
    clearSchedule();
    setStatus("Loading tune…");
    try {
      const xml = await (await fetch("music/" + rec.file)).text();
      if (token !== loadToken) return;   // a newer load superseded this one
      engine.score = parseMusicXML(xml);
      engine.current = rec;

      els.title.textContent =
        `${tuneLabel(rec)} — ${engine.score.notes.length} notes, `
        + `${engine.score.chords.length} chords`;
      if (rec.videoLessonUrl) {
        els.lessonLink.href = rec.videoLessonUrl;
        els.lessonLink.style.display = "";
      } else {
        els.lessonLink.style.display = "none";
      }

      // Tempo: per-tune value from index.json, else a practice-friendly default.
      const bpm = rec.tempo || DEFAULT_BPM;
      els.tempo.value = bpm;
      els.tempoOut.textContent = `${bpm} BPM`;
      Tone.Transport.bpm.value = bpm;

      scheduleScore();

      if (els.tuneSelect.value !== rec.slug) els.tuneSelect.value = rec.slug;
      try {
        history.replaceState(null, "", "?tune=" + rec.slug);
      } catch (_) { /* file:// or exotic embed contexts — harmless */ }

      if (wasPlaying) {
        Tone.Transport.start();
        setStatus("Playing.");
      } else {
        setStatus(engine.ready ? "Ready. Press Play." : "Loading violin samples…");
        els.play.disabled = !engine.ready;
        els.pause.disabled = true;
        els.stop.disabled = true;
      }
      console.log(`[playalong] loaded ${rec.slug}:`, engine.score);
    } catch (err) {
      console.error(err);
      setStatus("Error loading tune: " + err.message);
    }
  }

  // ---- Transport controls -------------------------------------------------
  async function onPlay() {
    if (!engine.ready || !engine.melodyPart) return;
    await Tone.start();                       // unlock audio on user gesture
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

    // Tune picker: dropdown loads the tune; search box filters the dropdown.
    els.tuneSelect.addEventListener("change", () => {
      const rec = engine.tunes.find((t) => t.slug === els.tuneSelect.value);
      if (rec && rec !== engine.current) loadTune(rec);
    });
    els.tuneSearch.addEventListener("input", () =>
      buildSelector(els.tuneSearch.value));

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
      setStatus("Loading tune library…");
      const idx = await (await fetch(INDEX_FILE)).json();
      engine.tunes = idx.slice().sort(byCourseOrder);
      buildSelector("");

      buildInstruments();

      // ?tune=<slug> (the WP-embed pattern) picks the opening tune;
      // otherwise the first tune in course order.
      const slug = new URLSearchParams(location.search).get("tune");
      const rec =
        engine.tunes.find((t) => t.slug === slug) || engine.tunes[0];
      if (!rec) throw new Error("empty tune index");
      await loadTune(rec);
    } catch (err) {
      console.error(err);
      setStatus("Error: " + err.message);
    }
  }

  window.addEventListener("DOMContentLoaded", init);
  window.__engine = engine;   // for in-browser debugging
})();
