/* ============================================================
   BELLOWS HORNS — pure lane geometry (no THREE).

   Every horn's shape is a PURE FUNCTION OF ITS NOTE (CLAUDE.md §7: size encodes
   register, never layout): the bell mouth widens and the throat rises as the pitch
   falls (a longer horn is a lower horn), the family follows the register (tuba /
   trombone / trumpet), a trombone's slide stands at its REAL slide position for the
   note, a valved horn presses its REAL fingering. Crowding is solved by spacing the
   lanes apart; a deck too narrow for them all scales the WHOLE bed uniformly (the
   solve scales its heights with it — gravity never does).

   Lane frame: x across (low → high), y up (y = 0 the deck's floor), z toward the
   audience. The marble's plumb line is at (0, ·, Z_B); the horn's riser at z = Z_H.
   ============================================================ */
import { noteHz, noteNum } from '../../engine.js';
import { BALL_R, H } from './solve.js';

export const DECK = .35;            // plinth top
export const BW = .82;              // bellows footprint (square)
export const Z_B = 1.55;            // the bellows + marble column (front)
export const Z_H = -.5;             // the horn riser (behind)
export const Y_LID = 1.85;          // lid top at its rest stop
export const Y_C = Y_LID + BALL_R;  // marble centre resting on the lid at rest = the contact point
export const Y_MAG = Y_C + H + BALL_R;     // magnet face (underside)
export const MAG_R = .24, MAG_H = .3;
export const Y_BEAM = Y_MAG + MAG_H + .32; // the gantry beam every magnet hangs from
export const TILT = 32 * Math.PI / 180;    // bell axis tilt from vertical, toward the audience
export const FLEX = .06;            // the bell's breath-flare (fraction of its radius) — included in the slab
export const RIM_R = .045;          // the bell's rolled rim
export const SLAB_PAD = .07;        // air each side of a lane's widest part
export const SLIDE_TOP = .45;       // the slide's top joint, this far under the throat
export const SLIDE_X = .1, SLIDE_Z = .16;  // the slide's two tubes: ±x off the riser, in front of it
export const VALVE_Y0 = Y_LID + .75, VALVE_DY = .26;   // the valve block: casings face the audience, low on the riser
export const C4 = 261.626;

export const family = m => m < 46 ? 'tba' : m < 62 ? 'tbn' : 'tpt';
const TBN = [46, 53, 58, 62, 65, 68, 70, 72, 74, 75, 77]; // Bb tenor trombone partials 2–12 (MIDI): Bb2 F3 Bb3 D4 F4 Ab4 Bb4 …
const TBA = [34, 46, 53, 58, 62, 65, 68, 70];              // BBb tuba partials: BBb1 Bb2 F3 Bb3 D4 F4 Ab4 Bb4
const TPT = [58, 65, 70, 74, 77, 80, 82, 84, 86, 87, 89]; // Bb trumpet partials (sounding): Bb3 F4 Bb4 D5 F5 Ab5 Bb5 C6 …
const below = (m, partials) => {                          // semitones down from the nearest partial at/above m
  let best = 6;
  for (const p of partials) if (p >= m && p - m < best + .01) best = p - m;
  return Math.max(0, Math.min(6, best));
};
/** The trombone slide position for MIDI m: 0 = 1st position … 6 = 7th (clawd-o-matic slidePos). */
export const slidePos = m => below(m, TBN);
const FINGER = [[], [2], [1], [1, 2], [2, 3], [1, 3], [1, 2, 3]];
/** The valves pressed for MIDI m (1-based), by its family's partial series. */
export const fingering = m => FINGER[below(m, family(m) === 'tba' ? TBA : TPT)];

/** One horn's geometry — a pure fn of the note. */
export function hornGeom(note){
  const m = noteNum(note), f = noteHz(note), r = C4 / f;
  const Rm = .06 + .42 * Math.pow(r, .5);                 // mouth radius (∝ the horn's length, softened)
  const fam = family(m);
  const g = {
    note, m, fam,
    Rm,
    Lb: 1.1 + 2.6 * Rm,                                   // bell length (throat → mouth)
    rT: .07 + .02 * Math.min(2, r),                       // throat / tubing radius
    yT: 3.5 + 1.5 * Math.pow(r, .45),                     // throat height (the riser's top)
    slide: fam === 'tbn' ? slidePos(m) : -1,
    valves: fam === 'tbn' ? [] : fingering(m),
    nValves: fam === 'tba' ? 4 : fam === 'tpt' ? 3 : 0,
  };
  // the slide hangs DOWN the front of the riser from SLIDE_TOP; its crook drops .3 per position
  g.slideLen = g.slide >= 0 ? .9 + .3 * g.slide : 0;
  g.halfW = Math.max(BW / 2 + .04, (1 + FLEX) * Rm + RIM_R, MAG_R) + SLAB_PAD;
  // the mouth (centre, in the lane's y/z plane)
  g.mouth = { y: g.yT + g.Lb * Math.cos(TILT), z: Z_H + g.Lb * Math.sin(TILT) };
  return g;
}

/** Lay the lanes across a deck of width W: x centres + the uniform bed scale. */
export function layoutHorns(notes, W = 14, { edge = .55 } = {}){
  const geo = notes.map(hornGeom);
  const total = geo.reduce((s, q) => s + 2 * q.halfW, 0);
  const scale = Math.min(1, (W - 2 * edge) / (total || 1));
  let x = -total / 2;
  const xs = geo.map(q => { const c = x + q.halfW; x += 2 * q.halfW; return c; });
  return { geo, xs, scale, total, W };                    // (xs in UNSCALED bed units)
}

/** The bell's lowest rim point (y, z) in the lane plane, including the breath flare —
    for the clearance check against the magnet gantry in front of it. */
export function bellLow(q){
  const R = (1 + FLEX) * q.Rm + RIM_R;
  return { y: q.mouth.y - R * Math.sin(TILT), z: q.mouth.z + R * Math.cos(TILT) };
}
