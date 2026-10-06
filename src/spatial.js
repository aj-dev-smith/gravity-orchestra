/* ============================================================
   SPATIAL — where a strike SOUNDS, from where it IS relative to the camera.
   PURE: no THREE, no DOM, no audio. Unit-tested in test/spatial.test.js.

   main.js projects each strike's world position into CAMERA space
   (x right, y up, −z forward — three.js convention) and hands the three
   numbers here. Out comes a tiny "placement" for the live voice:
       { pan, gain, lp }
     pan   −1..1 stereo position (StereoPannerNode), eased & clamped ±PAN_MAX —
           a room, not a hard-panned ping-pong
     gain  gentle distance rolloff (1 inside REF_DIST, never below MIN_GAIN)
     lp    air-absorption lowpass cutoff in Hz, or 0 = no filter (close voices
           stay full-band; only far ones lose a little top)
   Computed ONCE at the strike (the director cuts, the next strike follows the
   new shot — a note never swims while it rings). Audio-only: the physics,
   timing and visuals never see any of this.
   ============================================================ */

export const PAN_MAX  = .75;     // never hard-pan: the far wing still bleeds to both ears
export const PAN_EASE = 1.35;    // slope at centre (x/r → pan); the cubic eases it toward PAN_MAX
export const REF_DIST = 22;      // world units: a director close-up (~15–20 u) is "full level"
export const ROLLOFF  = .45;     // inverse-distance rolloff past REF_DIST (0 = none)
export const MIN_GAIN = .55;     // the far wing never drops more than ~5 dB
export const AIR_HZ   = 16000;   // lowpass at REF_DIST·AIR_FROM…
export const AIR_FROM = 1.25;    // …starts here (× REF_DIST); nearer = no filter at all
export const AIR_MIN  = 4200;    // …and never darker than this

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Azimuth-based pan: s = x / horizontal range (sin of the bearing, ±1 at 90°).
    Eased with a soft cubic (odd, monotone on [−1,1]) and clamped to ±PAN_MAX.
    Something behind the camera keeps its side but drifts toward centre. */
export function panFor(x, z){
  const r = Math.hypot(x, z);
  if (r < 1e-6) return 0;
  const s = clamp(x / r, -1, 1);
  const eased = s * (1 - (1 - 1 / PAN_EASE) * s * s) * PAN_EASE;   // = PAN_EASE·s − (PAN_EASE−1)·s³ ∈ [−1,1]
  return clamp(eased * PAN_MAX, -PAN_MAX, PAN_MAX);
}

/** Distance gain: 1 within REF_DIST, then inverse-distance with ROLLOFF, floored. */
export function gainFor(d){
  if (!(d > REF_DIST)) return 1;
  return Math.max(MIN_GAIN, REF_DIST / (REF_DIST + ROLLOFF * (d - REF_DIST)));
}

/** Air absorption: 0 (bypass) when near, else a cutoff falling with distance. */
export function airFor(d){
  const d0 = REF_DIST * AIR_FROM;
  if (!(d > d0)) return 0;
  return Math.round(Math.max(AIR_MIN, AIR_HZ * Math.pow(d0 / d, 1.3)));
}

/** Camera-space position → { pan, gain, lp }. */
export function spatialize(x, y, z){
  if (![x, y, z].every(Number.isFinite)) return { pan: 0, gain: 1, lp: 0 };
  const d = Math.hypot(x, y, z);
  return { pan: panFor(x, z), gain: gainFor(d), lp: airFor(d) };
}
