/* ============================================================
   DRUM KIT REGISTRY — the one source of truth for percussion.

   Maps a canonical drum NAME → its General-MIDI note number (so
   MIDI import is a reverse lookup: a channel-9 note → a lane) and
   its base mix GAIN (how loud the drum sits in the mix, BEFORE any
   per-hit velocity — a hat is intrinsically quieter than a kick).

   Song data only ever uses the NAMES. Audio (voice synthesis) and
   the render machine (geometry/colour) will key off the same names,
   so a new instrument grows ONE table, not four.

   This is pure data — no THREE, no audio, no DOM — so the engine
   tests, the MIDI converter, and the browser all import it freely.

   Percussion archetype, per the product vision: a STATIONARY target
   (the drum never moves) struck by MORTAL balls (one ball per hit,
   each on a closed-form arc — solveLaunch, same as the melody). The
   only thing that changes between instruments is the target and the
   launch solve. Everything is still solved up front.
   ============================================================ */

export const GM_DRUMS = {
  // name        GM    mix    (the three we voice + render first)
  kick:    { gm: 36, gain: 1.00 },   // acoustic bass drum
  snare:   { gm: 38, gain: 0.80 },   // acoustic snare
  hat:     { gm: 42, gain: 0.45 },   // closed hi-hat — quiet by nature
  // reserved — names a future kit + MIDI import already map onto:
  hatOpen: { gm: 46, gain: 0.50 },
  clap:    { gm: 39, gain: 0.70 },
  tomLow:  { gm: 45, gain: 0.80 },
  tomMid:  { gm: 47, gain: 0.80 },
  tomHigh: { gm: 50, gain: 0.80 },
  crash:   { gm: 49, gain: 0.60 },
  ride:    { gm: 51, gain: 0.50 },
};

/** The set of legal lane names — the song validator checks against this. */
export const DRUM_NAMES = new Set(Object.keys(GM_DRUMS));

/** GM note number → canonical drum name (for MIDI channel-9 import). */
export function drumByGm(gm){
  return Object.keys(GM_DRUMS).find(n => GM_DRUMS[n].gm === gm);
}

/** Normalize one hit: bare `beat` OR `[beat, velocity]` → {beat, vel}.
    Velocity is 0..1 (MIDI vel/127); absent = a full-strength hit. */
export function normalizeHit(h){
  return Array.isArray(h) ? { beat: h[0], vel: h[1] } : { beat: h, vel: 1 };
}
