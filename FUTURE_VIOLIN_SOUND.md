# Earmarked: a better violin sound (post-beta, no date)

Context (2026-08-26): v1.21 timing is MVP-solid (median offset +3ms @160 BPM; jitter tamed by
attack normalization). The remaining "odd" quality at speed is partly TIMBRE, not timing:
the current set (nbrosowsky/tonejs-instruments) is a classical violin — sustained, vibrato-heavy
bow swells. Fast fiddle eighth notes want short détaché bows. One articulation is doing every job.

## The ladder (each step playable independently)

**1. SWAP — a better free library.** VSCO 2 Community Edition (CC0) has solo violin with
multiple dynamics/articulations; also Versilian, U-Iowa. The prep pipeline (trim → normalize →
measure onsets → table) is already built and scriptable, so a swap is a weekend.
Cheap test of how much timbre alone buys.

**2. SPLIT — articulation switching.** Two sample sets loaded: SHORT (détaché/spiccato) and
LONG (sustain). Engine picks per note at schedule time: wall-clock duration
(durBeats × 60/bpm) < ~0.35s → short sample. Add 2-3 round robins per note (alternate takes,
rotate on repeated pitches) to kill the machine-gun effect. Engine work is modest — a second
Tone.Sampler + a per-note ternary. The samples are the hard part, which is why…

**3. SELF — record Jason.** The actual fiddle sound FiddleHed teaches, played by the person
teaching it. Session shopping list: every 2-3 semitones across G3-B5ish, short bow + long bow,
2-3 takes each ≈ 60-100 short clips, one afternoon at the interface. Pipeline scripts do the
rest. This is the on-brand endgame — "practice along with Jason's fiddle" — and pairs with #2.

**4. STUDIO — pre-render whole tunes offline** (different architecture). Render each tune's
melody with a top-tier VST → ship audio per tune. Highest ceiling (real phrasing), but the
tempo slider is core to the app and time-stretching audio degrades; would need multi-tempo
renders + stretch between. Also every sheet-music edit forces a re-render. Parked unless the
sampler ceiling is truly hit.

## Recommendation when the time comes
2 + 3 together (articulation split, Jason's samples). Try 1 first only if a cheap timbre
test is wanted before booking the recording afternoon.

Mnemonic: **Swap → Split → Self → Studio.** Effort rises left to right; so does the ceiling.
