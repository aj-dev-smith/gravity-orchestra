/* ============================================================
   HEIGHT — Rollercoaster-Tycoon-style height placement in STAGE EDIT.
   Pure: no THREE, no DOM (stage-edit.js draws and drives it).

   A machine's HEIGHT is its LIFT (rooms/footing.js): u above its GROUND
   (where it sits on the floor's plinth); 0 = on the floor; the room plants
   supports under it that change form with the height (a plinth, a riser, a
   braced platform, a truss tower) and merges neighbours at one height into
   a LOFT. Select a machine and a HEIGHT HANDLE stands beside it — a pole
   from the floor with a metre scale, a knob at the height it stands at:
   drag the knob and the machine rises / sinks live.

     drag      the knob follows the pointer on a vertical plane through the
               pole, facing the eye (rayPlaneY) — relative: the lift moves by
               exactly as much height as the pointer's plane point does
     snap      LIFT_STEP (.5 u ≈ 34 cm); Shift = free. MAGNETS: the floor, and
               a neighbour's support top within its catch radius (they then
               share a LOFT: the planner decides, the readout says so)
     keys      PgUp / PgDn, ] / [  ±LIFT_STEP (Shift ±LIFT_BIG) · Home = floor
     limits    0 … FOOT.LIFT_MAX, and the machine's top CEIL_GAP under the
               ceiling (liftMax)

   Heights are SAID in metres (1 u ≈ .677 m — xrplan U_PER_M follows G) with
   the support's band: FLOOR (flush) · RISER (low) · PLATFORM (mid) · TOWER.
   ============================================================ */
import { FOOT, bandOf } from '../rooms/footing.js';

export const M_PER_U = 9.81 / 14.5;           // 1 u ≈ .677 m (the world's g is 14.5 u/s²; xrplan U_PER_M = 1 / this)
export const TICK_U = 1 / M_PER_U;            // the pole's scale: a tick every metre (≈ 1.48 u)
export const LIFT_STEP = .5;                  // the height grid (≈ 34 cm): a key, ▲ / ▼, a snapped drag
export const LIFT_BIG = 2;                    // Shift + a key / ▲ ▼ (≈ 1.35 m)
export const CEIL_GAP = 1;                    // a machine's top stays this far under the room's ceiling
export const MAGNET = {
  floor: .3,                                  // within this of 0 → ON THE FLOOR
  loft: FOOT.LOFT_DY,                         // within this of a neighbour's top → level with it (inside LOFT_DY they
                                              //  share a loft anyway: the magnet only makes it exact — no shim)
  free: .18,                                  // Shift (free): a gentle detent instead
};
export const BAND_NAME = { flush: 'FLOOR', low: 'RISER', mid: 'PLATFORM', high: 'TOWER' };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** a height in world units, said for people: "34 cm" · "2.0 m" · "12.8 m" (a ½-u step — 34 cm — always shows) */
export function fmtMeters(u){
  const m = Math.max(0, u) * M_PER_U;
  if (m < .995) return `${Math.round(m * 100)} cm`;
  return `${m.toFixed(1)} m`;
}

/** the support band for a support height h above the floor, and its friendly name */
export function bandName(h){ const band = bandOf(h); return { band, name: BAND_NAME[band] }; }

/** the highest lift a machine may take: FOOT.LIFT_MAX, and its top CEIL_GAP under the ceiling
    (lift = its lift now, top = its top's world y now, ceil = the room's ceiling y) */
export function liftMax({ lift = 0, top, ceil } = {}){
  let m = FOOT.LIFT_MAX;
  if (Number.isFinite(top) && Number.isFinite(ceil)) m = Math.min(m, lift + ceil - CEIL_GAP - top);
  return Math.max(0, m);
}

/* the air between two axis-aligned boxes [x0, x1, z0, z1] */
const aabbGap = (a, b) => Math.hypot(Math.max(0, b[0] - a[1], a[0] - b[1]), Math.max(0, b[2] - a[3], a[2] - b[3]));

/** The neighbours this machine could share a LOFT with, and the lift that puts its support top level
    with theirs. self: { bottom0 (its support top at lift 0, world y), box [x0, x1, z0, z1] (its footprint's
    bounds) }; others: [{ key, label, top (their support top), box, raised (above the flush band), open?,
    fixed? }]. Only raised, closed, movable neighbours within the planner's reach (pads grow by up to
    FOOT.MARGIN a side; LOFT_GAP between pads) — the planner has the final word (the readout reads it). */
export function loftTargets(self, others = []){
  const out = [];
  for (const o of others){
    if (!o || !o.raised || o.open || o.fixed || !Number.isFinite(o.top) || !Array.isArray(o.box)) continue;
    if (aabbGap(self.box, o.box) > FOOT.LOFT_GAP + 2 * FOOT.MARGIN) continue;
    const lift = Math.round((o.top - self.bottom0) * 1e6) / 1e6;   // (world-y noise off: a loft's lift is exact)
    if (lift > 1e-6) out.push({ key: o.key, label: o.label ?? o.key, lift });
  }
  return out.sort((a, b) => a.lift - b.lift || (a.key < b.key ? -1 : 1));
}

/** A raw lift (a dragged knob) → where it lands: clamped to [0, max]; pulled onto a MAGNET — the floor,
    or a neighbour's top (targets: loftTargets) — inside its catch radius; else onto the LIFT_STEP grid
    (free: left as it is). → { lift, magnet: null | { kind: 'floor' } | { kind: 'loft', key, label } } */
export function snapLift(raw, { max = FOOT.LIFT_MAX, free = false, targets = [] } = {}){
  const u = clamp(Number.isFinite(raw) ? raw : 0, 0, max);
  if (u <= (free ? MAGNET.free : MAGNET.floor)) return { lift: 0, magnet: { kind: 'floor' } };
  const R = free ? MAGNET.free : MAGNET.loft;
  let best = null;
  for (const t of targets){
    if (!(t.lift <= max + 1e-9)) continue;
    const d = Math.abs(u - t.lift);
    if (d <= R + 1e-9 && (!best || d < best.d)) best = { d, t };
  }
  if (best) return { lift: best.t.lift, magnet: { kind: 'loft', key: best.t.key, label: best.t.label } };
  return { lift: free ? u : gridAt(u, max), magnet: null };
}
/** The KNOB's drag → a lift: RELATIVE — the lift moves by exactly as much height as the pointer's point on
    the drag plane does since the grab (y0 → y: rayPlaneY), then snapLift. A drag never jumps on its first
    move (where the pointer grabbed the knob doesn't matter) and a slow drag is as exact as a fast one. */
export function dragLift({ lift0 = 0, y0, y, max, free = false, targets = [] } = {}){
  return snapLift(lift0 + (y - y0), { max, free, targets });
}
/* the grid point nearest u — or the limit itself, when that is nearer than the grid line past it */
const gridAt = (u, max) => { const g = Math.min(max, Math.round(u / LIFT_STEP) * LIFT_STEP); return (Math.abs(max - u) < Math.abs(g - u) ? max : g) + 0; };

/** A key / ▲ ▼ press: one step from `cur` in `dir` (±1) — to the NEXT grid line that way (a lift off the
    grid — the gallery's, a free drag's — steps onto it), or ±LIFT_BIG then the grid (big). A neighbour's
    top passed on the way (or landed on exactly) stops it there: a loft is a step of its own. Only one
    strictly on the way — a key never jumps farther than its step (the drag's magnet is the wide catch).
    Clamped to [0, max]. → { lift, magnet } like snapLift */
export function stepLift(cur, dir, { big = false, max = FOOT.LIFT_MAX, targets = [] } = {}){
  const c = clamp(Number.isFinite(cur) ? cur : 0, 0, max), s = Math.sign(dir) || 1;
  let next = big ? Math.round((c + s * LIFT_BIG) / LIFT_STEP) * LIFT_STEP
                 : (s > 0 ? Math.floor(c / LIFT_STEP + 1e-6) + 1 : Math.ceil(c / LIFT_STEP - 1e-6) - 1) * LIFT_STEP;
  next = clamp(next, 0, max);                              // (past the limit: the step lands ON it)
  // a neighbour's top on the way (strictly beyond where we are, not past where we land)
  let stop = null;
  for (const t of targets){
    const ahead = (t.lift - c) * s;
    if (ahead > 1e-6 && ahead <= Math.abs(next - c) + 1e-9 && t.lift <= max + 1e-9 && t.lift >= 0)
      if (!stop || (t.lift - c) * s < (stop.lift - c) * s) stop = t;
  }
  if (stop) return { lift: stop.lift, magnet: { kind: 'loft', key: stop.key, label: stop.label } };
  return { lift: next + 0, magnet: next === 0 ? { kind: 'floor' } : null };
}

/** Where a pointer ray (origin o, unit direction d) meets the VERTICAL plane through `at` that faces the
    eye horizontally — the knob's drag plane. → its world y, or null when the ray runs (nearly) along the
    plane (a top-down look: stage-edit falls back to the screen) or the plane is behind the eye. */
export function rayPlaneY(o, d, at, eye){
  let nx = eye.x - at.x, nz = eye.z - at.z;
  const L = Math.hypot(nx, nz);
  if (L < 1e-6) return null;
  nx /= L; nz /= L;
  const den = d.x * nx + d.z * nz;
  if (Math.abs(den) < .12) return null;                    // (grazing: the plane point would race off with a pixel)
  const t = ((at.x - o.x) * nx + (at.z - o.z) * nz) / den;
  return t > 0 ? o.y + t * d.y : null;
}

/** what the readout says: { value, band, name, loft, auto, floor }
    lift = the machine's lift now; user = the user's (undefined: the layout decides — AUTO);
    h = its support height above the floor; loft = the labels of the others on its loft (the plan's) */
export function readout({ lift = 0, user, h = 0, loft = [] } = {}){
  const { band, name } = bandName(h), floor = lift <= 1e-6;
  return {
    value: floor ? 'ON THE FLOOR' : `+${fmtMeters(lift)}`,
    band, name, floor, auto: !Number.isFinite(user),
    loft: loft.length ? `LOFT · ${loft.join(' + ')}` : '',
  };
}

/** One undo step per GESTURE: a burst of key repeats / ▲ ▼ taps settles once, `ms` after the last.
    timers are injected (tests: fake ones). → { poke(fn) — (re)arm: fn runs once the burst ends;
    flush() — run it now; cancel(); get pending } */
export function makeSettle(ms = 450, { set = (f, t) => setTimeout(f, t), clear = h => clearTimeout(h) } = {}){
  let h = null, fn = null;
  const run = () => { const f = fn; h = null; fn = null; f?.(); };
  return {
    poke(f){ fn = f; if (h !== null) clear(h); h = set(run, ms); },
    flush(){ if (h !== null){ clear(h); run(); } },
    cancel(){ if (h !== null) clear(h); h = null; fn = null; },
    get pending(){ return h !== null; },
  };
}
