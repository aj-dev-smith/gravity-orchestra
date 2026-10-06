/* ============================================================
   STRING BASS — the bed layout. Pure (no THREE): notes + footprint →
   where every lane's string, strike point, carriage column and rail go.
   Unit-tested for cross-lane clearance (test/inst-bass.test.js).

   · Lanes sorted low → high; low strings at the BACK and HIGHER (theatre
     tiers: every string visible from the audience side, +z).
   · Every string's length is stringLength(note) — a pure fn of the note.
     If the bed can't fit the station, the WHOLE bed scales uniformly
     (`scale`), never one string.
   · Every string is centred (a symmetric trapezoid). Strike points ALTERNATE
     between two rows: even lanes at u = .3 (left column row, rail + gantry on
     the left), odd lanes at u = .7 (right row, rail + gantry on the right). Neighbouring lanes' ball
     columns are then far apart in x, so they can pack tighter in z; each
     lane's rail hangs from its own overhead arm IN ITS OWN z-PLANE, beside
     its column (never toward a neighbour) and stops above its own string.
   ============================================================ */
import { noteNum } from '../../engine.js';
import { stringLength, stringRadius, BALL_R, H_MAX } from './solve.js';

export const U_ROW   = [.3, .7];          // strike point per row (fraction of the string from the nut)
export const RAIL_DX = .52;               // rail beside the column, toward the row's gantry
export const HOUSE   = .31;               // carriage housing half-width
export const CAR_H   = .62;               // carriage: magnet face → top of housing
export const DZ_TIGHT = .62, DZ_WIDE = .95, DZ_MAX = 1.35;
export const COL_HALF = BALL_R + .02;      // a lane's moving column half-width (ball ⊇ housing)

/** Distance needed in z between neighbouring lanes a, b (sorted), given their columns. */
function dzNeed(a, b){
  // columns far apart in x (different rows, distinct strike points) → tight packing is safe
  const dx = Math.abs(a.xb - b.xb);
  return dx >= 2 * COL_HALF + .12 ? DZ_TIGHT : DZ_WIDE;
}

export function layoutBed(notes, { W = 12, D = 8 } = {}){
  const sorted = [...notes].sort((a, b) => noteNum(a) - noteNum(b));
  const n = sorted.length;
  const lanes = sorted.map((note, k) => {
    const Ls = stringLength(note), rs = stringRadius(note), row = k % 2, u0 = U_ROW[row];
    return { note, k, Ls, rs, row, u0, side: row ? 1 : -1 };
  });
  if (!n) return { lanes, scale: 1, xNut: 0, yTop: 0, n };
  const Lmax = Math.max(...lanes.map(l => l.Ls));
  // x: every string CENTRED on the bed (a symmetric trapezoid: long at the back, short in
  // front), its own nut block (.7) at the left end, bridge post + peg (.9) at the right;
  // strike columns fall either side of centre (row 0 left, row 1 right)
  const xNut = -Lmax / 2;
  for (const l of lanes){
    l.xNut = -l.Ls / 2; l.xR = l.Ls / 2; l.xc = 0;
    l.xb = l.xNut + l.u0 * l.Ls;                      // strike point = ball / carriage column x
    l.xRail = l.xb + l.side * RAIL_DX;
  }
  // z: pack by need, centre, then cap the spacing (sparse beds don't sprawl)
  const need = lanes.slice(1).map((l, k) => dzNeed(lanes[k], l));
  const span = need.reduce((a, b) => a + b, 0);
  const zSpan = D - 2.4;
  const grow = n > 1 ? Math.max(1, Math.min(DZ_MAX / Math.max(...need), zSpan / Math.max(span, 1e-9))) : 1;
  let z = 0; lanes[0].z = 0;
  need.forEach((d, k) => { z += d * grow; lanes[k + 1].z = z; });
  const zMid = z / 2 - .2;
  lanes.forEach(l => { l.z -= zMid; });
  // y: theatre tiers, low (k=0) at the back and highest
  const yBase = 1.5, yStep = n > 1 ? Math.min(.45, 2.2 / (n - 1)) : 0;
  lanes.forEach(l => { l.y = yBase + (n - 1 - l.k) * yStep; });
  const yTop = yBase + (n - 1) * yStep + H_MAX + 2 * BALL_R + CAR_H + .9;
  // uniform scale if the bed overflows the footprint (never per string)
  const width = Lmax + 2 * 1.35, depth = z + 2.4;
  const scale = Math.min(1, W / width, D / depth);
  // gantry spines (one per row in use): x just outside the bed ends
  const spineX = [-Lmax / 2 - 1.05, Lmax / 2 + 1.05];
  return { lanes, n, scale, xNut, yTop, Lmax, spineX, zMin: lanes[0].z, zMax: lanes[n - 1].z };
}

/* Axis-aligned boxes a lane occupies (local, unscaled) — for the clearance test.
   [xmin, xmax, ymin, ymax, zmin, zmax] */
export function laneBoxes(l, yTop){
  const col  = [l.xb - COL_HALF, l.xb + COL_HALF, l.y - .2, yTop, l.z - COL_HALF, l.z + COL_HALF];
  const rail = [Math.min(l.xb, l.xRail) - .1, Math.max(l.xb, l.xRail) + .1, l.y + .9, yTop + .3, l.z - .1, l.z + .1];
  const str  = [l.xNut, l.xR, .45, l.y + l.rs, l.z - Math.max(l.rs, .2), l.z + Math.max(l.rs, .2)];
  const post = [l.xR - .1, l.xR + .5, 0, l.y, l.z - .22, l.z + .22];
  const nut  = [l.xNut - .7, l.xNut, 0, l.y + .3, l.z - .3, l.z + .3];
  return { col, rail, str, post, nut };
}
