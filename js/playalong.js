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
  // Version: bump on EVERY user-visible change and tell Jason the number in
  // chat — it's how he verifies a hard-refresh actually took.
  const APP_VERSION = "1.2";
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
    sections: $("sections"),
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
              const slurs = [...el.querySelectorAll("notations > slur")].map(
                (sl) => sl.getAttribute("type"));
              rawNotes.push({
                tick: onset,
                durTick,
                midi: pitchToMidi(step, alter, octave),
                tieStart: ties.includes("start"),
                tieStop: ties.includes("stop"),
                slurStarts: slurs.filter((t) => t === "start").length,
                slurStops: slurs.filter((t) => t === "stop").length,
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
          prev.slurStarts += n.slurStarts;   // fold slur marks into the merged note
          prev.slurStops += n.slurStops;
          continue;
        }
      }
      notes.push({ ...n, tieOpen: n.tieStart });
    }

    // Slur tracking: a running depth over the merged notes. If depth > 0
    // AFTER a note's own starts/stops are applied, the transition from that
    // note to the next is under a slur → play it legato (no separation).
    let slurDepth = 0;
    for (const n of notes) {
      slurDepth += (n.slurStarts || 0) - (n.slurStops || 0);
      if (slurDepth < 0) slurDepth = 0;   // guard against stray stops
      n.legatoAfter = slurDepth > 0;
    }

    const tpb = divisions;             // ticks per beat (quarter)

    // Pickup (anacrusis) — two engraving conventions in this library:
    //   1. EXPLICIT: measure 1 is shorter than a full bar (a real pickup
    //      measure). Body bars start at pickupBeats.
    //   2. EMBEDDED: measure 1 is full-length but padded with leading rests,
    //      the pickup notes at its end (how some Sibelius exports came out).
    //      Body bars start at the bar-2 downbeat.
    // In both, the final bar is written full-length, so a naive full loop
    // adds pickup-length dead time at the wrap. Fix: loop from the first
    // NOTE to (end − pickup) — the pickup re-enters on the final bar's last
    // beat(s) while the held final note rings over the wrap.
    const totalBeats = cursor / tpb;
    const barTicks = beatsPerBar * tpb * (4 / beatType);
    const barBeats = barTicks / tpb;
    const firstNoteBeat = notes.length ? notes[0].tick / tpb : 0;
    let pickupBeats = 0, loopStartBeats = 0, bodyStartBeats = 0;
    if (firstMeasureTicks && firstMeasureTicks < barTicks) {
      pickupBeats = firstMeasureTicks / tpb;            // explicit
      bodyStartBeats = pickupBeats;
    } else if (firstNoteBeat > 0 && firstNoteBeat < barBeats) {
      pickupBeats = barBeats - firstNoteBeat;           // embedded
      loopStartBeats = firstNoteBeat;                   // skip the silent rests
      bodyStartBeats = barBeats;
    }

    return {
      divisions,
      beatsPerBar,
      beatType,
      pickupBeats,
      loopStartBeats,
      bodyStartBeats,
      totalBeats,
      loopBeats: totalBeats - pickupBeats,   // loop END (start = loopStartBeats)
      notes: notes.map((n) => ({
        beat: n.tick / tpb,
        durBeats: n.durTick / tpb,
        midi: n.midi,
        legatoAfter: n.legatoAfter,
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
    section: null,    // active loop section { label, start, end } in beats
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
    // Extra scheduling headroom: melody notes trigger up to ~180ms EARLY to
    // compensate sample onsets; the default 100ms lookahead would clamp the
    // bigger leads (G4, E6). 250ms of UI latency is fine for a practice tool.
    if (Tone.context && "lookAhead" in Tone.context) Tone.context.lookAhead = 0.35;
    // Per-layer gain → independent volume sliders (MetroDrone Tone.Gain pattern).
    engine.melodyGain = new Tone.Gain(els.melVol.value / 100).toDestination();
    engine.organGain = new Tone.Gain(els.orgVol.value / 100).toDestination();
    engine.kickGain = new Tone.Gain(els.kickVol.value / 100).toDestination();

    // Layer 1 — violin Sampler
    engine.sampler = new Tone.Sampler({
      urls: VIOLIN_URLS,
      baseUrl: VIOLIN_BASE,
      release: 0.4,   // restored — 0.2 made every note ending abrupt/robotic
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
    // MEASURED SAMPLE ONSETS (2026-07-07): seconds for each violin sample's
    // amplitude envelope to reach 30% of its peak (ffmpeg/RMS analysis of the
    // actual CDN mp3s). A bowed sample "speaks" this long after triggering —
    // the source of the melody dragging. Varies 3x across samples (A3 29ms,
    // G4 110ms), so a single global lead can't be right for every note.
    const VIOLIN_ONSET = {
      G3: 0.041, A3: 0.029, C4: 0.070, E4: 0.046, G4: 0.110,
      A4: 0.075, C5: 0.075, E5: 0.064, G5: 0.064, A5: 0.058,
      C6: 0.081, E6: 0.157, G6: 0.075, A6: 0.070, C7: 0.052,
    };
    const NAME_MIDI = {};   // "G4" → 67, etc.
    for (const name of Object.keys(VIOLIN_ONSET)) {
      NAME_MIDI[name] =
        pitchToMidi(name[0], 0, parseInt(name.slice(1), 10));
    }
    // Per-note lead: nearest sample's onset, scaled by the repitch rate
    // (Sampler plays a shifted sample faster/slower, which scales its attack
    // too), plus a small global bias. Live-tunable: window.__leadBias (secs,
    // default 0.02; raise if the melody still drags, 0 to trust the table).
    // 7/7 Jason ear-test: still dragging at bias 0.02 → raised to 0.05.
    // (The 30%-of-peak onset measure likely underestimates PERCEIVED attack
    // on bowed samples; perceived onset sits nearer 50% of peak.)
    window.__leadBias = window.__leadBias ?? 0.05;
    // TEMPO-AWARE LEAD (7/7, Jason's key observation): timing sounds perfect
    // at 60 BPM but lags as tempo rises, with NO drift. Constant residual
    // error + shrinking beat = the slow bow attack occupies a growing
    // fraction of each (shorter) note, so its perceived landing point slides
    // later relative to the kick. Fix: an extra lead that is 0 at 60 BPM
    // (already right there) and grows with tempo. __leadTempo = seconds of
    // extra lead per doubling-ish of tempo (default 0.05 → +50ms at 120 BPM).
    window.__leadTempo = window.__leadTempo ?? 0.05;
    function melodyLeadFor(midi) {
      let bestName = "A4", bestD = Infinity;
      for (const name in NAME_MIDI) {
        const d = Math.abs(midi - NAME_MIDI[name]);
        if (d < bestD) { bestD = d; bestName = name; }
      }
      const rate = Math.pow(2, (midi - NAME_MIDI[bestName]) / 12);
      const tempoTerm =
        window.__leadTempo * Math.max(0, Tone.Transport.bpm.value / 60 - 1);
      return Math.min(0.25,
        VIOLIN_ONSET[bestName] / rate + window.__leadBias + tempoTerm);
    }

    // ARTICULATION: how each note ends depends on what follows it.
    //   "slur" — next transition is under a notated slur → full legato, no gap.
    //   "same" — next note is the SAME pitch, back-to-back → clear separation
    //            (otherwise repeated notes blur into one pulse).
    //   "diff" — different pitch → UNCHANGED (gap 0). Jason's 7/6 verdict:
    //            any global gap + shortened release made everything robotic;
    //            different-pitch transitions were fine as they were.
    // Gaps are wall-clock, capped as a fraction of the note so fast passages
    // never choke. Live-tunable: window.__gapSame / window.__gapDiff (secs).
    // 7/7 A/B experiment (Jason): spacing zeroed to test timing feel without
    // any articulation gaps. Restore live: window.__gapSame = 0.05
    window.__gapSame = window.__gapSame ?? 0;
    window.__gapDiff = window.__gapDiff ?? 0;
    const melodyEvents = s.notes.map((n, i) => {
      const next = s.notes[i + 1];
      let artic = "diff";
      if (n.legatoAfter) artic = "slur";
      else if (next && next.midi === n.midi
               && next.beat - (n.beat + n.durBeats) < 0.05) artic = "same";
      return [beatToBBS(n.beat), { ...n, artic }];
    });
    engine.melodyPart = new Tone.Part((time, ev) => {
      const full = ev.durBeats * (60 / Tone.Transport.bpm.value);
      let gap = 0;
      if (ev.artic === "same") gap = Math.min(window.__gapSame, full * 0.35);
      else if (ev.artic === "diff") gap = Math.min(window.__gapDiff, full * 0.2);
      const dur = Math.max(0.05, full - gap);
      const when = Math.max(time - melodyLeadFor(ev.midi), Tone.now());
      engine.sampler.triggerAttackRelease(
        Tone.Frequency(ev.midi, "midi").toNote(), dur, when);
    }, melodyEvents);
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

    // Loop the tune (Full defaults; setSection overrides for A/B parts).
    // Start = first note (skips rest-padded lead-ins); end = total − pickup,
    // so the wrap lands the pickup on the final bar's last beat(s) — no dead
    // time. Notes already sounding keep ringing through the wrap because
    // triggerAttackRelease durations are wall-clock, not truncated.
    Tone.Transport.loop = true;
    Tone.Transport.loopStart = beatToBBS(s.loopStartBeats);
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
  // 2a. SECTION LOOPS — Full / A / B / A1 / A2 / B1 / B2
  //     Fiddle tunes are mostly AABB. A = first half of the body bars,
  //     B = second half; A1/A2/B1/B2 quarter it. Buttons only appear when
  //     the bar count divides evenly. Sections exclude the pickup (the
  //     pickup plays only in Full, via the loop-overlap trick).
  // =========================================================================
  function buildSections() {
    const s = engine.score;
    const barBeats = s.beatsPerBar * (4 / s.beatType);
    const bodyStart = s.bodyStartBeats;
    const nBars = Math.round((s.totalBeats - bodyStart) / barBeats);
    const secs = [{ label: "Full", start: s.loopStartBeats, end: s.loopBeats }];
    const add = (label, fromBar, barCount) => secs.push({
      label,
      start: bodyStart + fromBar * barBeats,
      end: bodyStart + (fromBar + barCount) * barBeats,
    });
    // A/B = the tune's two parts (halves of the body). Each part then splits
    // into QUARTERS (A1–A4, usually 2 bars each on an 8-bar part) when its
    // bar count divides by 4, else halves (A1–A2), else no subdivisions.
    // (C parts would need per-tune metadata — MusicXML has no part markers.)
    if (nBars >= 4 && nBars % 2 === 0) {
      const partBars = nBars / 2;
      const parts = [["A", 0], ["B", partBars]];
      for (const [p, off] of parts) add(p, off, partBars);
      const div = partBars % 4 === 0 ? 4 : partBars % 2 === 0 ? 2 : 0;
      if (div) {
        const q = partBars / div;
        for (const [p, off] of parts)
          for (let i = 0; i < div; i++) add(p + (i + 1), off + i * q, q);
      }
    }
    return secs;
  }

  function setSection(sec) {
    engine.section = sec;
    Tone.Transport.loopStart = beatToBBS(sec.start);
    Tone.Transport.loopEnd = beatToBBS(sec.end);
    Tone.Transport.position = beatToBBS(sec.start);
    for (const b of els.sections.querySelectorAll("button"))
      b.classList.toggle("active", b.textContent === sec.label);
  }

  function renderSections() {
    const secs = buildSections();
    els.sections.innerHTML = "";
    if (secs.length > 1) {
      const lab = document.createElement("span");
      lab.className = "sections-label";
      lab.textContent = "Loop:";
      els.sections.appendChild(lab);
      for (const sec of secs) {
        const btn = document.createElement("button");
        btn.textContent = sec.label;
        btn.addEventListener("click", () => {
          setSection(sec);
          btn.blur();   // keep spacebar on play/pause, not this button
        });
        els.sections.appendChild(btn);
      }
    }
    setSection(secs[0]);   // default = Full (also sets Transport loop points)
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
      renderSections();   // rebuild loop buttons for this tune; resets to Full

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
    Tone.Transport.position =
      engine.section ? beatToBBS(engine.section.start) : 0;
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
    $("version").textContent = "v" + APP_VERSION;
    console.log("[playalong] version", APP_VERSION);
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
