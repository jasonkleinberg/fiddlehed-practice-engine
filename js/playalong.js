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
  const APP_VERSION = "1.22"; // pickup-inside-repeat convention (loop + sections) + 3 re-exported tunes + 4 pickup rewrites
  // CACHE-BUSTER (v1.9): tune XMLs and index.json load via fetch(), which
  // Safari caches independently of the page — a hard-refresh renews the app
  // but can keep serving STALE TUNE FILES (bit Jason on 7/15: fixed
  // Ballydesmond XML on disk, browser showed the old one). Version-stamping
  // the URLs makes every app version fetch fresh copies.
  const bust = (url) => url + "?v=" + APP_VERSION;

  // ---- Analytics (GA4 custom events) --------------------------------------
  // Added v1.17. The GA4 tag lives in playalong.html; this fires the events.
  // The beta's three bars (opened it / came back on a 2nd day / used tempo or
  // loop) are all EVENT questions -- pageviews answer none of them.
  //
  // Context is captured ONCE, right here at load, and deliberately BEFORE
  // anything can rewrite the URL:
  //   t       tester id from the beta invite link (?t=deb). The 2nd-day
  //           metric resolves per named tester, so it does not depend on
  //           localStorage -- which is unreliable for us anyway, since the
  //           app runs in a THIRD-PARTY iframe (jkleinberg.com inside
  //           fiddlehed.com) where Safari/iOS caps script-writable storage.
  //   member  '1'/'0' from the WP embed shortcode. Never a name or email.
  //   solo    the single-tune lesson-page embed (?solo=1) vs the full library.
  //   surface 'embed' inside an iframe, 'direct' standalone.
  const PE_PARAMS = new URLSearchParams(location.search);
  const PE_CONTEXT = {
    t: PE_PARAMS.get("t") || "none",
    member: PE_PARAMS.get("member") || "unknown",
    solo: PE_PARAMS.get("solo") ? "1" : "0",
    surface: (window.self !== window.top) ? "embed" : "direct",
    app_version: APP_VERSION,
  };
  const PE_LOADED_AT = Date.now();
  let pePlayStartedAt = null;   // set on first Play, for true listening time
  let pePlayed = false;

  function track(name, params) {
    try {
      if (typeof gtag !== "function") return;
      gtag("event", name, Object.assign(
        {}, PE_CONTEXT, { tune: (engine && engine.current && engine.current.slug) || "none" }, params || {}
      ));
      console.log("[track]", name, params || {});
    } catch (err) {
      // Analytics must never break the instrument.
      console.warn("[track] failed", err);
    }
  }

  // Sliders fire on every pixel of travel. Debounce so GA4 records the value
  // the student landed on, not the sixty they dragged through.
  function trackDebounced(name, params, key, delay) {
    trackDebounced.timers = trackDebounced.timers || {};
    clearTimeout(trackDebounced.timers[key]);
    trackDebounced.timers[key] = setTimeout(() => track(name, params), delay || 1200);
  }
  // -------------------------------------------------------------------------
  const INDEX_FILE = "music/index.json";
  const DEFAULT_BPM = 90;   // used when a tune's index.json tempo is null
  // v1.20: SELF-HOSTED, TRIMMED samples. The CDN mp3s carried 20-40ms of
  // leading silence plus a slow bow swell — the source of the melody-vs-kick
  // lag that compensation never fully cured (worst >100 BPM / eighth notes).
  // Each wav is the CDN sample with silence + sub-15%-of-sustain ramp cut
  // (8ms fade-in), capped at 4.5s. Residual onsets measured offline (50% of
  // early-sustain level) live in VIOLIN_ONSET below — remeasure if these
  // files ever change.
  // v1.21: TWO sample sets, A/B-switchable via URL param — append
  // &samples=v1 to compare. v1 = trimmed only (natural bow swell kept);
  // v2 (default) = trimmed + attack-normalized (every sample rises to
  // sustain level over a uniform 25ms ramp, so per-note timing jitter
  // collapses: measured onsets 11-13ms across all 15, was 9-78ms).
  const SAMPLE_SETS = {
    v1: {
      base: "samples/violin/",
      leadBias: 0.01, leadTempo: 0.02,
      onset: {
        G3: 0.015, A3: 0.009, C4: 0.035, E4: 0.017, G4: 0.078,
        A4: 0.020, C5: 0.038, E5: 0.020, G5: 0.026, A5: 0.029,
        C6: 0.055, E6: 0.046, G6: 0.015, A6: 0.009, C7: 0.023,
      },
    },
    v2: {
      base: "samples/violin-v2/",
      leadBias: 0.005, leadTempo: 0.01,
      onset: {
        G3: 0.011, A3: 0.011, C4: 0.012, E4: 0.011, G4: 0.013,
        A4: 0.012, C5: 0.013, E5: 0.012, G5: 0.012, A5: 0.012,
        C6: 0.013, E6: 0.011, G6: 0.011, A6: 0.012, C7: 0.012,
      },
    },
  };
  const SAMPLE_SET =
    new URLSearchParams(location.search).get("samples") === "v1" ? "v1" : "v2";
  const VIOLIN_BASE = SAMPLE_SETS[SAMPLE_SET].base;
  const VIOLIN_URLS = {
    A3: "A3.wav", C4: "C4.wav", E4: "E4.wav", G4: "G4.wav",
    A4: "A4.wav", C5: "C5.wav", E5: "E5.wav", G5: "G5.wav",
    A5: "A5.wav", C6: "C6.wav", E6: "E6.wav", G6: "G6.wav",
    A6: "A6.wav", C7: "C7.wav", G3: "G3.wav",
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
    scoreWrap: $("score-wrap"),
    scoreToggle: $("score-toggle"),
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

  // REPEAT / VOLTA EXPANSION (v1.7). MusicXML notates repeats as barline
  // marks; playback must EXPAND them: ‖: A :‖ plays A twice, and volta
  // brackets (1st/2nd endings) pick different bars per pass. Returns the
  // measure indices in playback order. Rules of thumb this implements:
  //   - a backward repeat jumps to the last forward repeat (or the start of
  //     the piece / the bar after the previous finished repeat section);
  //   - an ending bracket whose numbers don't include the current pass is
  //     skipped (jump past its stop barline);
  //   - a played ending with no backward repeat closes the section.
  // Nested repeats and D.C./D.S. are not handled (none in this library).
  function expandRepeats(measures) {
    const info = measures.map((m) => {
      const r = { fwd: false, back: false, times: 2,
                  endingNums: null, endingStops: false };
      for (const bl of m.querySelectorAll(":scope > barline")) {
        const rep = bl.querySelector("repeat");
        if (rep) {
          const dir = rep.getAttribute("direction");
          if (dir === "forward") r.fwd = true;
          if (dir === "backward") {
            r.back = true;
            r.times = parseInt(rep.getAttribute("times") || "2", 10) || 2;
          }
        }
        for (const end of bl.querySelectorAll("ending")) {
          const type = end.getAttribute("type");
          if (type === "start") {
            r.endingNums = (end.getAttribute("number") || "")
              .split(/[,\s]+/).filter(Boolean).map(Number);
          } else {
            r.endingStops = true;          // "stop" or "discontinue"
          }
        }
      }
      return r;
    });

    // Sibelius-export quirk (Fisher's Hornpipe): the "2nd ending" start
    // stamped on the SAME measure whose right barline is the backward
    // repeat — contradictory, since the repeat belongs inside the 1st
    // ending. Trust the repeat: that bar closes ending 1, and the real
    // 2nd ending starts at the following measure.
    for (let i = 0; i + 1 < info.length; i++) {
      const r = info[i];
      if (r.endingNums && !r.endingNums.includes(1) && r.back
          && !info[i + 1].endingNums) {
        info[i + 1].endingNums = r.endingNums;
        r.endingNums = null;
      }
    }

    // Alongside the flat playback order, record SECTION structure (v1.11):
    // each closed repeat region = one musical part (A, B, …), with the
    // playback position where each pass begins and whether it has voltas.
    // buildSections() uses this so loop buttons align with the real parts
    // (halving the played timeline breaks when parts repeat unevenly —
    // Britches: A repeats, B doesn't).
    const order = [];
    const sections = [];
    const cap = measures.length * 8 + 16;  // runaway guard
    let i = 0, repeatStart = 0, pass = 1, inEnding = false;
    let secStart = 0, passStarts = [0], hasVolta = false;
    const closeSection = () => {
      if (order.length > secStart) {
        sections.push({ startOrder: secStart, endOrder: order.length,
                        passStarts, hasVolta });
      }
      secStart = order.length;
      passStarts = [order.length];
      hasVolta = false;
    };
    while (i < measures.length && order.length < cap) {
      const m = info[i];
      if (m.fwd) repeatStart = i;
      if (m.endingNums && !m.endingNums.includes(pass)) {
        // Wrong volta for this pass — skip its bracket. The bracket ends at
        // an explicit stop barline, or (sloppy exports) where the next
        // bracket begins.
        let j = i;
        while (j < measures.length) {
          const stopHere = info[j].endingStops;
          j++;
          if (stopHere) break;
          if (j < measures.length && info[j].endingNums) break;
        }
        i = j;
        continue;
      }
      if (m.endingNums) { inEnding = true; hasVolta = true; }
      order.push(i);
      if (m.back && pass < m.times) {
        pass++;
        inEnding = false;
        i = repeatStart;                    // take the repeat
        passStarts.push(order.length);      // next measure starts a new pass
      } else {
        if (m.back || (m.endingStops && inEnding)) {
          // Passed the final ending / final repeat — section is closed.
          pass = 1;
          repeatStart = i + 1;
          inEnding = false;
          closeSection();
        }
        i++;
      }
    }
    closeSection();                          // trailing unrepeated measures
    return { order, sections };
  }

  function parseMusicXML(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Bad MusicXML");

    const part = doc.querySelector("part");
    const measures = [...part.querySelectorAll("measure")];
    const { order: playOrder, sections: playSections } = expandRepeats(measures);

    let divisions = null;       // ticks per quarter note (locked at first read)
    let beatsPerBar = 4, beatType = 4;
    let cursor = 0;             // global position in ticks
    let firstMeasureTicks = null; // duration of measure 1 (pickup detection)
    let lastRepeatEndIdx = -1;    // playInstances index of the last :| bar
    let lastRepeatEndTick = 0;
    let lastNoteOnset = 0;      // onset of the previous (non-chord) note
    const rawNotes = [];        // { tick, durTick, midi, tieStart, tieStop }
    const chords = [];          // { tick, rootStep, rootAlter, kind }
    const playInstances = [];   // { measureIdx, startTick } — playback order,
                                // incl. repeats; the sheet-music beat map
                                // needs it to light repeated bars every pass.

    for (const mi of playOrder) {
      const m = measures[mi];
      const measureStart = cursor;
      playInstances.push({ measureIdx: mi, startTick: measureStart });
      if (m.querySelector(':scope > barline > repeat[direction="backward"]'))
        lastRepeatEndIdx = playInstances.length - 1;   // v1.22, see below
      let measureMax = cursor;   // v1.19: furthest tick any voice reaches
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
            measureMax = Math.max(measureMax, cursor);   // v1.19
            cursor -= parseInt(
              el.querySelector("duration")?.textContent || "0", 10);
            break;
          case "forward":
            cursor += parseInt(
              el.querySelector("duration")?.textContent || "0", 10);
            break;
        }
      }
      // v1.19: if a backup voice ended short, snap to the longest voice —
      // otherwise the next measure starts early (kesh-jig__17.09 bar 11 bug).
      cursor = Math.max(cursor, measureMax);
      if (firstMeasureTicks === null) firstMeasureTicks = cursor - measureStart;
      if (lastRepeatEndIdx === playInstances.length - 1) lastRepeatEndTick = cursor;
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
    // v1.22: a THIRD convention — the pickup bar sits INSIDE the forward
    // repeat (Peacock Rag, Coleraine, Southwind: `|: pickup | bars… | short
    // closing bar :|`). Every pass already carries its own pickup and the
    // closing bar is short by exactly the pickup, so the timeline is whole
    // bars: loop the FULL length (no overlap trick) and let the A section
    // start on its pickup instead of clipping it to the first downbeat.
    let pickupInRepeat = false;
    if (firstMeasureTicks && firstMeasureTicks < barTicks) {
      pickupBeats = firstMeasureTicks / tpb;            // explicit
      bodyStartBeats = pickupBeats;
      const m0 = measures[playOrder[0]];
      pickupInRepeat = !![...m0.querySelectorAll(":scope > barline > repeat")]
        .find((r) => r.getAttribute("direction") === "forward");
    } else if (firstNoteBeat > 0 && firstNoteBeat < barBeats) {
      pickupBeats = barBeats - firstNoteBeat;           // embedded
      loopStartBeats = firstNoteBeat;                   // skip the silent rests
      bodyStartBeats = barBeats;
    }

    // v1.19: collapse consecutive identical chords so the organ sustains
    // instead of re-attacking every bar (chords are notated per-bar in many
    // exports). Keep any chord that lands on a section pass start so A/B
    // looping still opens with its chord sounding.
    const passStartTicks = new Set();
    for (const sec of playSections)
      for (const o of sec.passStarts)
        passStartTicks.add(
          o < playInstances.length ? playInstances[o].startTick : cursor);
    for (let i = chords.length - 1; i > 0; i--) {
      const c = chords[i], p = chords[i - 1];
      if (passStartTicks.has(c.tick)) continue;
      if (p.rootStep === c.rootStep && p.rootAlter === c.rootAlter &&
          p.kind === c.kind) chords.splice(i, 1);
    }

    return {
      divisions,
      beatsPerBar,
      beatType,
      pickupBeats,
      pickupInRepeat,
      loopStartBeats,
      bodyStartBeats,
      totalBeats,
      // loop END (start = loopStartBeats): overlap trick unless the pickup
      // already lives inside the repeat (then the timeline is whole bars).
      // A written-out final bar AFTER the last :| (Peacock Rag's closing
      // D) is an ending, not part of the form — the loop stops at the :|.
      loopBeats: pickupInRepeat
        ? (lastRepeatEndTick > 0 ? lastRepeatEndTick / tpb : totalBeats)
        : totalBeats - pickupBeats,
      playInstances: playInstances.map((p) => ({
        measureIdx: p.measureIdx,
        startBeat: p.startTick / tpb,
      })),
      // Musical parts (closed repeat regions) in PLAYED beats.
      parts: playSections.map((sec) => {
        const beatAt = (o) => o < playInstances.length
          ? playInstances[o].startTick / tpb : cursor / tpb;
        return {
          start: beatAt(sec.startOrder),
          end: beatAt(sec.endOrder),
          passStartBeats: sec.passStarts.map(beatAt),
          hasVolta: sec.hasVolta,
        };
      }),
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
    sectionsList: [], // all sections for the loaded tune ([0] = Full)
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
    // Sheet music (OSMD)
    osmd: null,       // OpenSheetMusicDisplay instance (null if CDN failed)
    scoreXml: null,   // raw MusicXML of the loaded tune (for resize re-render)
    noteMap: [],      // [{ beat, durBeats, el }] sorted by beat — beat→SVG map
    activeEls: [],    // SVG <g> elements currently painted red
    scoreHidden: false, // v1.12 memorization toggle: sheet music hidden
    scoreDirty: false,  // tune changed (or resized) while hidden → re-render on show
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
    // v1.21: per-set measured onsets (t50 of early-sustain, from file start).
    const VIOLIN_ONSET = SAMPLE_SETS[SAMPLE_SET].onset;
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
    window.__leadBias = window.__leadBias ?? SAMPLE_SETS[SAMPLE_SET].leadBias;  // per-set; console-tunable
    // TEMPO-AWARE LEAD (7/7, Jason's key observation): timing sounds perfect
    // at 60 BPM but lags as tempo rises, with NO drift. Constant residual
    // error + shrinking beat = the slow bow attack occupies a growing
    // fraction of each (shorter) note, so its perceived landing point slides
    // later relative to the kick. Fix: an extra lead that is 0 at 60 BPM
    // (already right there) and grows with tempo. __leadTempo = seconds of
    // extra lead per doubling-ish of tempo (default 0.05 → +50ms at 120 BPM).
    window.__leadTempo = window.__leadTempo ?? SAMPLE_SETS[SAMPLE_SET].leadTempo;  // per-set; console-tunable
    function melodyLeadFor(midi) {
      let bestName = "A4", bestD = Infinity;
      for (const name in NAME_MIDI) {
        const d = Math.abs(midi - NAME_MIDI[name]);
        if (d < bestD) { bestD = d; bestName = name; }
      }
      const rate = Math.pow(2, (midi - NAME_MIDI[bestName]) / 12);
      const tempoTerm =
        window.__leadTempo * Math.max(0, Tone.Transport.bpm.value / 60 - 1);
      return Math.min(0.32,   // v1.19: cap was clamping big leads at fast tempos (must stay < lookAhead 0.35)
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
    }, compound ? "4n." : "4n", beatToBBS(s.bodyStartBeats));   // v1.19: first
    // kick on the first real downbeat — silent through any pickup, and every
    // hit after lands on the barline grid instead of a pickup-length off it.

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
    const secs = [{ label: "Full", start: s.loopStartBeats, end: s.loopBeats }];

    // Subdivide one part span into quarters (or halves) of ~2-bar chunks.
    const subdivide = (label, start, end) => {
      const nBars = Math.round((end - start) / barBeats);
      const div = nBars % 4 === 0 ? 4 : nBars % 2 === 0 ? 2 : 0;
      if (!div || nBars < 4) return;
      const q = nBars / div;
      for (let i = 0; i < div; i++) {
        secs.push({
          label: label + (i + 1),
          start: start + i * q * barBeats,
          end: start + (i + 1) * q * barBeats,
        });
      }
    };

    // v1.11: parts come from the tune's REPEAT STRUCTURE (each closed repeat
    // region = one part), not from halving the played timeline — halving
    // breaks when parts repeat unevenly (Britches: A repeats, B doesn't →
    // "A" used to grab a part-and-a-half and quarters came out 3 bars).
    // Span choice per part:
    //   - no voltas: passes are identical, so use ONE pass (looping A once
    //     sounds the same as looping A-A, and chunks stay 2 bars);
    //   - with voltas: use the FULL span so 1st AND 2nd endings are covered
    //     (this is what makes e.g. Cripple Creek A4 = bar 3 + 2nd ending).
    const parts = (s.parts || []).filter((p) => p.end - p.start > 1e-6);
    if (parts.length >= 2 && parts.length <= 6) {
      const names = ["A", "B", "C", "D", "E", "F"];
      let n = 0;
      for (const p of parts) {
        // pickup only in Full — unless it's notated inside the repeat, in
        // which case every pass owns it and the part loops on it (v1.22).
        const start = s.pickupInRepeat ? p.start : Math.max(p.start, bodyStart);
        const end = (!p.hasVolta && p.passStartBeats.length > 1)
          ? p.passStartBeats[1] : p.end;
        // Skip stub "parts" (< 2 bars — usually a written-out ending bar
        // trailing a repeat); they'd steal letters and make useless loops.
        if (end - start < 2 * barBeats - 1e-6 || n >= names.length) continue;
        secs.push({ label: names[n], start, end });
        subdivide(names[n], start, end);
        n++;
      }
    } else {
      // Fallback (no/one repeat region): halve the body as before.
      const nBars = Math.round((s.totalBeats - bodyStart) / barBeats);
      if (nBars >= 4 && nBars % 2 === 0) {
        const partBars = nBars / 2;
        for (const [name, off] of [["A", 0], ["B", partBars]]) {
          const start = bodyStart + off * barBeats;
          const end = start + partBars * barBeats;
          secs.push({ label: name, start, end });
          subdivide(name, start, end);
        }
      }
    }
    // Order: parts first, then their subdivisions (A B A1..A4 B1..B4 reads
    // better than interleaved when parts differ in length).
    const rank = (l) => l === "Full" ? 0 : l.length === 1 ? 1 : 2;
    secs.sort((a, b) => rank(a.label) - rank(b.label)
      || a.label.localeCompare(b.label));
    return secs;
  }

  function setSection(sec) {
    engine.section = sec;
    Tone.Transport.loopStart = beatToBBS(sec.start);
    Tone.Transport.loopEnd = beatToBBS(sec.end);
    Tone.Transport.position = beatToBBS(sec.start);
    for (const b of els.sections.querySelectorAll("button"))
      b.classList.toggle("active", b.textContent === sec.label);
    updateSectionShade();   // mark the looping bars on the sheet music
  }

  function renderSections() {
    const secs = buildSections();
    engine.sectionsList = secs;
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
          // "Used tempo OR loop" is a beta success bar -- is the loop the draw?
          track("pe_loop_use", { section: sec.label });
          setSection(sec);
          btn.blur();   // keep spacebar on play/pause, not this button
        });
        els.sections.appendChild(btn);
      }
    }
    setSection(secs[0]);   // default = Full (also sets Transport loop points)
  }

  // =========================================================================
  // 2c. SHEET MUSIC (OpenSheetMusicDisplay)
  //     Renders the SAME MusicXML the audio engine plays, then highlights the
  //     sounding note in FiddleHed red. Sync source = Tone.Transport ticks
  //     (the musical beat), NOT the audio triggers — melody notes fire up to
  //     ~200ms early (the sample-onset lead system), and following those
  //     would make the highlight look rushed.
  //     The score is an ENHANCEMENT: any failure here (CDN down, render bug)
  //     must never break audio, so everything is wrapped defensively.
  // =========================================================================

  function buildOsmd() {
    if (typeof opensheetmusicdisplay === "undefined") return;   // CDN failed
    try {
      engine.osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(
        $("score"), {
          autoResize: false,          // we re-render + rebuild the map ourselves
          backend: "svg",
          drawTitle: false,           // the app header already shows the title
          drawSubtitle: false,
          drawComposer: false,
          drawLyricist: false,
          drawPartNames: false,
          drawFingerings: false,   // v1.8: clean score — no fingerings/tab
          drawingParameters: "compacttight",
        });
    } catch (err) {
      console.error("[sheet] OSMD init failed:", err);
      engine.osmd = null;
    }
  }

  // DISPLAY PREPROCESS (v1.8). Some Sibelius exports wrote fiddle-tab
  // fingerings ("2", "A0", "G1"…) as free-floating <words> DIRECTIONS;
  // OSMD stacks each one higher to dodge the previous → the fingering
  // staircase climbing off the page. v1.7 converted them to per-note
  // fingerings; v1.8 (Jason's call) REMOVES them entirely — the play-along
  // doubles as sheet-music reading practice, and fingering/tab views live
  // on the lesson pages instead. Also drops the "Arranged for awesome
  // fiddle students by FiddleHed" blurb those exports left floating
  // mid-score. Display-only — the source XMLs keep their fingerings for
  // lesson-page use, and the audio parser never read <words>.
  // One fingering token: optional string letter, optional Low/High mark,
  // finger number — covers "2", "A0", "G1", "L2", "H3", "AL1". Some exports
  // cram several tokens in one words element separated by tab runs
  // ("A0\t…\tD0\tL2") — treat all-token text as fingerings too.
  const FINGERING_TOKEN = /^[GDAE]?[LH]?[0-4]$/;
  const isFingeringText = (text) => {
    const toks = text.split(/\s+/).filter(Boolean);
    return toks.length > 0 && toks.every((t) => FINGERING_TOKEN.test(t));
  };
  const CREDIT_BLURB = /arranged for|fiddle students|by fiddlehed/i;
  function preprocessForDisplay(xmlText) {
    try {
      const doc = new DOMParser().parseFromString(xmlText, "application/xml");
      if (doc.querySelector("parsererror")) return xmlText;
      let changed = false;
      for (const dir of [...doc.querySelectorAll("part direction")]) {
        const words = [...dir.querySelectorAll("direction-type > words")];
        if (!words.length) continue;
        const text = words.map((w) => w.textContent || "").join(" ").trim();
        if (isFingeringText(text) || CREDIT_BLURB.test(text)) {
          dir.remove();
          changed = true;
        }
      }
      // Native per-note fingerings too, if any export has them.
      for (const f of [...doc.querySelectorAll("technical > fingering")]) {
        f.remove();
        changed = true;
      }
      // v1.19: metronome marks are player chrome, not sheet music — remove.
      for (const dir of [...doc.querySelectorAll("part direction")]) {
        if (dir.querySelector("direction-type > metronome")) {
          dir.remove();
          changed = true;
        }
      }
      // v1.19: chord symbols only where the chord CHANGES. Walk measures in
      // document order; a repeat of the previous harmony is dropped. Reset at
      // forward-repeat barlines so each repeated section reprints its chord.
      const chordSig = (h) =>
        (h.querySelector("root > root-step")?.textContent || "") + "|" +
        (h.querySelector("root > root-alter")?.textContent || "0") + "|" +
        (h.querySelector("kind")?.textContent || "major");
      for (const partEl of [...doc.querySelectorAll("part")]) {
        let last = null;
        for (const m of [...partEl.querySelectorAll(":scope > measure")]) {
          if (m.querySelector('barline > repeat[direction="forward"]')) last = null;
          for (const h of [...m.querySelectorAll(":scope > harmony")]) {
            const sig = chordSig(h);
            if (sig === last) {
              h.remove();
              changed = true;
            } else {
              last = sig;
            }
          }
        }
      }
      if (!changed) return xmlText;
      // XMLSerializer omits the XML declaration; OSMD's load() requires it.
      let out = new XMLSerializer().serializeToString(doc);
      if (!out.startsWith("<?xml"))
        out = '<?xml version="1.0" encoding="UTF-8"?>\n' + out;
      return out;
    } catch (err) {
      console.error("[sheet] display preprocess failed:", err);
      return xmlText;
    }
  }

  // Render the loaded tune's MusicXML and rebuild the beat→SVG note map.
  async function renderScore(xmlText) {
    if (!engine.osmd) return;
    engine.noteMap = [];
    engine.activeEls = [];
    // Sheet music hidden (memorization mode): OSMD can't measure a
    // display:none container, so stash the XML and render on reveal.
    if (engine.scoreHidden) {
      engine.scoreXml = preprocessForDisplay(xmlText);
      engine.scoreDirty = true;
      return;
    }
    try {
      xmlText = preprocessForDisplay(xmlText);
      engine.scoreXml = xmlText;
      await engine.osmd.load(xmlText);
      // 8 library files kept a second staff (duet/viola part) from the
      // Sibelius export. The audio engine plays only the FIRST <part>, so
      // showing the extra staff would be a silent, confusing twin. Hide all
      // but part 1 before rendering (v1.6).
      const instruments = engine.osmd.Sheet ? engine.osmd.Sheet.Instruments : [];
      for (let i = 1; i < instruments.length; i++) instruments[i].Visible = false;
      engine.osmd.render();
      if (engine.osmd.cursor) engine.osmd.cursor.hide();  // we paint notes instead
      buildNoteMap();
      updateSectionShade();   // re-apply after every render (fresh SVG)
    } catch (err) {
      // Score failure is non-fatal — audio keeps working.
      console.error("[sheet] render failed:", err);
      engine.noteMap = [];
    }
  }

  // Map every drawn note to its onset beat(s) and its SVG <g> element.
  // v1.7: walks the GRAPHIC sheet measure-by-measure (not the playback
  // iterator, whose timestamps regress at repeat back-jumps). The audio
  // timeline now EXPANDS repeats, so a note inside a repeated section is
  // entered once per pass — the same SVG element lights up on every pass.
  // playInstances (from the parser) supplies each measure's played start
  // beat(s); a note's played beat = instance start + offset in the measure.
  // Also wires click-to-seek on each note (first pass inside the active
  // section, else the note's first pass).
  function buildNoteMap() {
    const osmd = engine.osmd;
    const map = [];
    if (!osmd.GraphicSheet || !engine.score) return;
    // Group played start-beats by notated measure index.
    const starts = {};
    for (const p of engine.score.playInstances || []) {
      (starts[p.measureIdx] = starts[p.measureIdx] || []).push(p.startBeat);
    }
    const src = osmd.Sheet ? osmd.Sheet.SourceMeasures : [];
    const gms = osmd.GraphicSheet.MeasureList || [];
    for (let mi = 0; mi < gms.length; mi++) {
      const passes = starts[mi];
      if (!passes || !passes.length) continue;
      // Beat offset within the measure comes from the source timestamps.
      const measTs = src[mi] ? src[mi].AbsoluteTimestamp.RealValue * 4 : 0;
      for (const gm of gms[mi] || []) {
        if (!gm) continue;
        const inst = gm.ParentStaff && gm.ParentStaff.ParentInstrument;
        if (inst && inst.Visible === false) continue;   // hidden duet staff
        for (const se of gm.staffEntries || []) {
          const abs = se.getAbsoluteTimestamp
            ? se.getAbsoluteTimestamp().RealValue * 4
            : measTs + (se.relInMeasureTimestamp
                ? se.relInMeasureTimestamp.RealValue * 4 : 0);
          const off = abs - measTs;
          for (const gve of se.graphicalVoiceEntries || []) {
            for (const gn of gve.notes || []) {
              const sn = gn && gn.sourceNote;
              if (!sn || (sn.isRest && sn.isRest())) continue;
              let el = null;
              try {
                el = gn.getSVGGElement ? gn.getSVGGElement() : null;
              } catch (_) { /* note without graphics — skip */ }
              if (!el) continue;
              const durBeats = sn.Length ? sn.Length.RealValue * 4 : 0.25;
              const beats = passes.map((s) => s + off);
              for (const b of beats) map.push({ beat: b, durBeats, el });
              el.classList.add("pe-note-click");
              el.addEventListener("click", () => {
                const sec = engine.section;
                const target = sec
                  && beats.find((b) => b >= sec.start - 1e-6 && b < sec.end - 1e-6);
                seekToBeat(target !== undefined && target !== false
                  ? target : beats[0]);
              });
            }
          }
        }
      }
    }
    if (osmd.cursor) { osmd.cursor.reset(); osmd.cursor.hide(); }
    map.sort((a, b) => a.beat - b.beat);
    engine.noteMap = map;
    console.log(`[sheet] note map: ${map.length} entries`);
  }

  // SECTION SHADE (v1.5): a light gray band behind the bars of the active
  // loop section (A, B1, …) so you can see at a glance what's looping.
  // Notes stay full black — it's a region marker, not a dimmer. "Full" gets
  // no shade (shading the whole tune is just noise).
  // Geometry: OSMD graphical measures expose AbsolutePosition/Size in staff
  // units; 1 unit = 10px × zoom (same convention OSMD's own cursor uses).
  // Rects go in as the SVG's first children, so they paint UNDER the music.
  function updateSectionShade() {
    const osmd = engine.osmd;
    const svg = document.querySelector("#score svg");
    if (!osmd || !svg || !osmd.GraphicSheet || !osmd.Sheet) return;
    for (const r of svg.querySelectorAll(".pe-section-shade")) r.remove();
    const sec = engine.section;
    if (!sec || sec.label === "Full" || !engine.score) return;
    try {
      const u = 10 * (osmd.zoom || 1);
      const gms = osmd.GraphicSheet.MeasureList;
      // v1.7: the audio timeline expands repeats, so section start/end are
      // PLAYED beats. A notated measure is inside the section if ANY of its
      // play passes falls in the window.
      const inSection = new Set();
      for (const p of engine.score.playInstances || []) {
        if (p.startBeat >= sec.start - 1e-3 && p.startBeat < sec.end - 1e-3)
          inSection.add(p.measureIdx);
      }
      const frag = document.createDocumentFragment();
      for (let i = 0; i < gms.length; i++) {
        if (!inSection.has(i)) continue;
        for (const gm of gms[i] || []) {     // one entry per staff (we have 1)
          if (!gm || !gm.PositionAndShape) continue;
          // Hidden instruments (v1.6 duet-staff fix) still appear in the
          // graphical measure list — don't draw bands for them.
          const inst = gm.ParentStaff && gm.ParentStaff.ParentInstrument;
          if (inst && inst.Visible === false) continue;
          const bb = gm.PositionAndShape;
          const rect = document.createElementNS(
            "http://www.w3.org/2000/svg", "rect");
          rect.setAttribute("class", "pe-section-shade");
          rect.setAttribute("x", bb.AbsolutePosition.x * u);
          // Staff = 4 units tall; extend 1.5 above / 1.5 below for a band
          // that covers ledger lines without swallowing chord symbols.
          rect.setAttribute("y", (bb.AbsolutePosition.y - 1.5) * u);
          rect.setAttribute("width", bb.Size.width * u);
          rect.setAttribute("height", 7 * u);
          frag.appendChild(rect);
        }
      }
      svg.insertBefore(frag, svg.firstChild);
    } catch (err) {
      console.error("[sheet] section shade failed:", err);
    }
  }

  // Click-to-seek. If the target beat is outside the active loop section,
  // fall back to the section that contains it (preferring the current one,
  // else the tightest match, else Full) so the Transport doesn't sail past
  // its loop window.
  function seekToBeat(beat) {
    if (!engine.score) return;
    const sec = engine.section;
    if (sec && (beat < sec.start - 1e-6 || beat >= sec.end - 1e-6)) {
      const candidates = engine.sectionsList.filter(
        (s) => beat >= s.start - 1e-6 && beat < s.end - 1e-6);
      // Tightest containing section = most useful loop around the clicked spot;
      // sectionsList[0] (Full) contains everything as the fallback.
      const best = candidates.sort(
        (a, b) => (a.end - a.start) - (b.end - b.start))[0]
        || engine.sectionsList[0];
      if (best) setSection(best);
    }
    Tone.Transport.position = beatToBBS(beat);
    updateHighlight(true);   // instant feedback even while stopped
  }

  // Highlight the note(s) sounding at the current Transport position.
  // Runs from a rAF loop; cheap enough to call every frame (<200 notes).
  let lastPaintedTicks = -1;
  function updateHighlight(force) {
    if (!engine.noteMap.length) return;
    const ticks = Tone.Transport.ticks;
    if (!force && ticks === lastPaintedTicks) return;   // nothing moved
    lastPaintedTicks = ticks;
    let pos = ticks / Tone.Transport.PPQ;               // quarter-note beats

    // VISUAL DELAY (v1.4, Jason's 7/7 feedback): the highlight tracked the
    // SCHEDULED beat, but the heard note lands later — audio output latency
    // (tens of ms; much more on Bluetooth) plus the violin samples' soft bow
    // attack. Eye beat ear → felt "ahead." Shift the highlight back by a
    // wall-clock offset, converted to beats at the live tempo. Only while
    // playing — seeks and stopped-state clicks stay instant.
    // Live-tunable: window.__hlDelay (seconds). Raise if the highlight still
    // leads the sound (Bluetooth ≈ 0.25–0.35), lower toward 0 if it trails.
    window.__hlDelay = window.__hlDelay ?? 0.12;
    if (Tone.Transport.state === "started") {
      pos -= window.__hlDelay * (Tone.Transport.bpm.value / 60);
    }

    const active = [];
    for (const e of engine.noteMap) {
      if (e.beat > pos + 1e-6) break;                   // sorted — done
      if (pos < e.beat + Math.max(e.durBeats, 0.15)) active.push(e);
    }
    // Keep only the latest onset among overlaps (a long held note shouldn't
    // stay lit through the notes after it — but chords sharing an onset all light).
    const latest = active.length
      ? Math.max(...active.map((e) => e.beat)) : null;
    const els2 = active.filter((e) => e.beat === latest).map((e) => e.el);

    if (sameEls(els2, engine.activeEls)) return;
    for (const el of engine.activeEls) el.classList.remove("pe-active");
    for (const el of els2) el.classList.add("pe-active");
    engine.activeEls = els2;

    autoScroll(els2[0]);
  }

  function sameEls(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // Keep the sounding note in a comfortable vertical band while playing.
  // v1.19: but NEVER fight the user (the QA note "I have to pause the player
  // in order to scroll down"). Two rules:
  //   1. A manual scroll in the last 1.5s wins — skip.
  //   2. If the note is fully off-screen AND the user has scrolled since our
  //      last programmatic scroll, they went somewhere on purpose — stay put.
  //      (A loop-wrap teleport with no manual scroll still follows.)
  // Follow resumes automatically once the note is back in view.
  let manualScrollAt = -1, autoScrollAt = 0;
  for (const evt of ["wheel", "touchmove"])
    window.addEventListener(evt, () => { manualScrollAt = performance.now(); },
      { passive: true });
  function autoScroll(el) {
    if (!el || Tone.Transport.state !== "started") return;
    const now = performance.now();
    if (now - manualScrollAt < 1500) return;                      // rule 1
    const r = el.getBoundingClientRect();
    const offscreen = r.bottom < 0 || r.top > window.innerHeight;
    if (offscreen && manualScrollAt > autoScrollAt) return;       // rule 2
    const pad = 90;
    if (r.top < pad || r.bottom > window.innerHeight - pad) {
      autoScrollAt = now;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // The paint loop — one rAF, runs for the page's life. Highlight updates
  // whenever the Transport position changes (playing, seeking, or section
  // jumps), so a stopped app still shows where Play will start.
  function startPaintLoop() {
    (function frame() {
      try { updateHighlight(false); } catch (_) { /* never kill the loop */ }
      requestAnimationFrame(frame);
    })();
  }

  // Window resize: OSMD must re-render (new line breaks), which rebuilds the
  // SVG — so the note map and its click handlers are rebuilt too.
  let resizeTimer = null;
  function wireScoreResize() {
    window.addEventListener("resize", () => {
      if (!engine.osmd || !engine.scoreXml) return;
      if (engine.scoreHidden) { engine.scoreDirty = true; return; }
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try {
          engine.osmd.render();
          buildNoteMap();
          updateSectionShade();
          updateHighlight(true);
        } catch (err) { console.error("[sheet] resize re-render failed:", err); }
      }, 300);
    });
  }

  // v1.12: hide/show sheet music — memorization practice. Hiding is pure CSS;
  // if the tune changed (or window resized) while hidden, re-render on reveal.
  function wireScoreToggle() {
    if (!els.scoreToggle || !els.scoreWrap) return;
    els.scoreToggle.addEventListener("click", async () => {
      engine.scoreHidden = !engine.scoreHidden;
      // Is the v1.12 memorization toggle getting used at all?
      track("pe_sheet_toggle", { hidden: engine.scoreHidden ? "1" : "0" });
      els.scoreWrap.classList.toggle("score-hidden", engine.scoreHidden);
      els.scoreToggle.classList.toggle("active", engine.scoreHidden);
      els.scoreToggle.textContent =
        engine.scoreHidden ? "Show sheet music" : "Hide sheet music";
      els.scoreToggle.setAttribute("aria-pressed", String(engine.scoreHidden));
      if (!engine.scoreHidden && engine.scoreDirty) {
        engine.scoreDirty = false;
        if (engine.scoreXml) await renderScore(engine.scoreXml);
      }
    });
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
    engine.noteMap = [];      // stale SVG refs die with the old render
    engine.activeEls = [];
    setStatus("Loading tune…");
    try {
      const xml = await (await fetch(bust("music/" + rec.file))).text();
      if (token !== loadToken) return;   // a newer load superseded this one
      engine.score = parseMusicXML(xml);
      engine.current = rec;

      // Display title: just tune + key. Lesson IDs stay in the dropdown;
      // note/chord counts were debug info, retired in v1.14.
      // Key stays visible because transposition is a likely future feature.
      els.title.textContent = `${rec.title} (${rec.key})`;
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

      // Sheet music — after audio is fully set up, never blocking it.
      await renderScore(xml);
      updateHighlight(true);

      if (els.tuneSelect.value !== rec.slug) els.tuneSelect.value = rec.slug;
      try {
        // v1.17 FIX: this used to be `"?tune=" + rec.slug`, which replaced the
        // ENTIRE query string -- silently destroying ?t=<tester>, ?member= and
        // ?solo= the first time anyone changed tunes. A tester who then
        // bookmarked the rewritten URL became anonymous for the rest of the
        // beta, which would have quietly broken the one metric the beta
        // exists to measure (return on a 2nd separate day). Merge, don't clobber.
        const qs = new URLSearchParams(location.search);
        qs.set("tune", rec.slug);
        history.replaceState(null, "", "?" + qs.toString());
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
      // Which tunes actually carry the thing.
      track("pe_tune_load", { tune: rec.slug, bpm: Math.round(Tone.Transport.bpm.value) });
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
    // Play pressed is the real "used it" signal. Page views mean nothing.
    if (!pePlayStartedAt) pePlayStartedAt = Date.now();
    pePlayed = true;
    track("pe_start", {
      bpm: parseInt(els.tempo.value, 10) || 0,
      section: (engine.section && engine.section.label) || "Full",
    });
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
    track("pe_stop", {
      seconds: pePlayStartedAt ? Math.round((Date.now() - pePlayStartedAt) / 1000) : 0,
    });
    pePlayStartedAt = null;
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
      trackDebounced("pe_tempo_set", { bpm }, "tempo");
    });

    const vol = (slider, out, getGain, layer) => {
      slider.addEventListener("input", () => {
        const v = parseInt(slider.value, 10);
        out.textContent = `${v}%`;
        const g = getGain();
        if (g) g.gain.rampTo(v / 100, 0.03);
        // Worth its own event: a student who drops MELODY to 0 and leaves the
        // organ up is practising BACKUP, not the tune. That is a different
        // product being used, and we would otherwise never see it.
        trackDebounced("pe_volume_set", { layer, value: v }, "vol_" + layer);
      });
    };
    vol(els.melVol, els.melOut, () => engine.melodyGain, "melody");
    vol(els.orgVol, els.orgOut, () => engine.organGain, "organ");
    vol(els.kickVol, els.kickOut, () => engine.kickGain, "kick");
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

    buildOsmd();          // sheet-music renderer (no-op if the CDN failed)
    wireScoreResize();
    wireScoreToggle();
    startPaintLoop();

    try {
      setStatus("Loading tune library…");
      const idx = await (await fetch(bust(INDEX_FILE))).json();
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

  // Most people close the tab rather than pressing Stop, so this is the more
  // reliable session-length signal. GA4 sends event beacons on pagehide.
  window.addEventListener("pagehide", () => {
    track("pe_session_end", {
      seconds: Math.round((Date.now() - PE_LOADED_AT) / 1000),
      played: pePlayed ? "1" : "0",
    });
  });

  window.addEventListener("DOMContentLoaded", init);
  window.__engine = engine;   // for in-browser debugging
})();
