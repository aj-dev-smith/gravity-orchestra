import { footingBoxes } from './footing.js';
/* ============================================================
   ARENA PROPS — where the Metal Arena's pyro stands, SOLVED FROM THE MACHINES (pure: no THREE, no DOM).

   The show's cue sheet (arena-cues.js) never changes with the layout: 8 flame projectors, 4 CO2
   cannons, the same firings. What a layout changes is WHERE they may stand. A pyro tech keeps every
   flame a safe distance from the band and the set; the room does the same, per set of anchors
   (rooms/index.js calls the room's place(anchors, plan) whenever the machines move):

     • a FLAME PROJECTOR's column (big burn, full velocity: the widest it ever gets) must clear every
       machine, every support the room built under them (footingBoxes: pads, lofts, stairs, ladders)
       and the room's own standing gear by CLEAR (1 u) — measured as the horizontal distance from the
       nozzle to each box against the column's radius at that box's top (the column flares as it
       climbs: flameR). Each L/R pair moves TOGETHER (arena-cues fires pairs: the rig stays mirrored)
       to the nearest clear spot of its own band, off the stage frame; a pair with no mirrored spot
       splits; a projector with no clear spot at all is STRUCK (it never fires: its cues fall silent
       rather than burn a machine).
     • a CO2 CANNON stays on its tower and RE-AIMS: from its home aim (in and up over the stage)
       towards straight up, the first aim whose plume — its widest envelope along the axis, CO2_ENV —
       clears everything by CLEAR. None clear → struck.
     • the BACKLINE (the amp walls flanking the blinder wall): a column that anything stands in is
       taken down.
   The envelopes mirror the shaders in arena.js (flameMat / co2Mat): change one, change both.
   Deterministic: the same anchors give the same rig, every time. 1 u ≈ .677 m.
   ============================================================ */

export const RIG = { TOWER_X: 49, TOWER_Z: [-47, 29], TOWER_W: 1.5, BALLAST: 2.5, RIG_Y: 38.5, CO2_Y: 18 };
/* the flame projectors' home spots: 4 mirrored L/R pairs (arena-cues pairs 0-1, 2-3, 4-5, 6-7 — left first) */
export const JET_HOME = [[-42, -24], [42, -24], [-42, -2], [42, -2], [-42, 20], [42, 20], [-17, -44], [17, -44]];
/* the CO2 cannons: on the towers, CO2_Y up */
export const CO2_HOME = RIG.TOWER_Z.flatMap(z => [-1, 1].map(s => [s * (RIG.TOWER_X - 1.6), z]));
export const PYRO = { NOZZLE: 1.4, BODY: .75, CLEAR: 1, PLUME_AT: 1.2 };     // (a flame unit: a ~1 m road-case box, its nozzle on top)
/* the BACKLINE: amp walls either side of the blinder wall, real 4×12 cabinets (76 cm cubes ≈ 1.12 u) */
export const AMP = { CAB: 1.12, DEEP: .54, HEAD: .4, ROWS: 4, COLS: 8, X0: 29.6, Z: -49.5 };   // (in front of the upstage haze)
export const ampColumns = () => [-1, 1].flatMap(s => Array.from({ length: AMP.COLS }, (_, c) => ({ s, c, x: s * (AMP.X0 + (c + .5) * AMP.CAB), z: AMP.Z })));

/* ---- the envelopes (arena.js shaders, at their widest: a big burn at full velocity) ---- */
/** a flame column's radius at h above its nozzle (flameMat: bulge = 2.6·(.55 + .9·uv)·1.2 over H = 24; it
    lifts off at its widest, so above H it stays that wide) */
export const flameR = h => 1.716 + 2.808 * Math.min(1, Math.max(0, h) / 24);
/** the CO2 plume's widest radius s along its axis (co2Mat: the stream, its cut, the cloud rolling on) */
export const CO2_ENV = (() => {
  const DS = .5, n = 52, env = new Float64Array(n);
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let a = 0; a <= 1.55 + 1e-9; a += .0025){                           // (fine in age: the stream shoots out ~160 u/s at first)
    const L = 18 * (1 - Math.exp(-a * 9)), lift = Math.max(0, a - .5), y0 = lift * 14, y1 = L + lift * 6;
    if (y1 - y0 < .05) continue;
    const k = 1 + .5 * ss(0, .4, a);
    for (let u = 0; u <= 1 + 1e-9; u += .0125){
      const s = y0 + (y1 - y0) * u, r = (.5 + 3.4 * u + 2.2 * lift) * k, i = Math.min(n - 1, Math.round(s / DS));
      for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < n) env[j] = Math.max(env[j], r);   // (a bin either side: conservative between samples)
    }
  }
  return { DS, r: Array.from(env) };
})();

/* ---- geometry ---- */
const dXZ = (x, z, b) => Math.hypot(Math.max(b[0] - x, 0, x - b[1]), Math.max(b[4] - z, 0, z - b[5]));
const d3 = (p, b) => Math.hypot(Math.max(b[0] - p[0], 0, p[0] - b[1]), Math.max(b[2] - p[1], 0, p[1] - b[3]), Math.max(b[4] - p[2], 0, p[2] - b[5]));
const norm = v => { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };

/** how far a flame projector at (x, z) stands clear of `boxes` ([x0,x1,y0,y1,z0,z1]) — ≥ CLEAR is clear:
    each box against the column's radius at the box's top (and never closer than the projector's own body) */
export function jetClearance(x, z, boxes, floor){
  let m = Infinity;
  for (const b of boxes){
    const r = Math.max(PYRO.BODY * Math.SQRT2, flameR(b[3] - floor - PYRO.NOZZLE));
    m = Math.min(m, dXZ(x, z, b) - r);
  }
  return m;
}
/** a cannon's home aim (in over the stage and up), turned towards straight up by k ∈ [0, 1] */
export function co2Dir(x, z, k = 0){
  const h = norm([-x * .55, 14, -z * .25 - 4]);
  return norm([h[0] * (1 - k), h[1] * (1 - k) + k, h[2] * (1 - k)]);
}
/** how far a CO2 plume (from its nozzle `src` along `dir`) stays clear of `boxes` — ≥ CLEAR is clear */
export function plumeClearance(src, dir, boxes){
  let m = Infinity;
  const o = [src[0] + dir[0] * PYRO.PLUME_AT, src[1] + dir[1] * PYRO.PLUME_AT, src[2] + dir[2] * PYRO.PLUME_AT];
  for (let i = 0; i < CO2_ENV.r.length; i++){
    const r = CO2_ENV.r[i]; if (!(r > 0)) continue;
    const s = i * CO2_ENV.DS, p = [o[0] + dir[0] * s, o[1] + dir[1] * s, o[2] + dir[2] * s];
    for (const b of boxes) m = Math.min(m, d3(p, b) - r);
  }
  return m;
}

/** the room's own standing gear the pyro must keep off: the rig towers (+ ballast), the blinder wall, the backline */
export function rigSolids(floor){
  const out = [], T = RIG.TOWER_W / 2, B = RIG.BALLAST;
  for (const z of RIG.TOWER_Z) for (const s of [-1, 1]){
    const x = s * RIG.TOWER_X;
    out.push([x - T, x + T, floor, RIG.RIG_Y + 6, z - T, z + T], [x - B, x + B, floor, floor + .5, z - B, z + B]);
  }
  out.push([-29, 29, floor, floor + 50, -59.5, -55.6]);                     // the blinder wall + its truss
  const h = AMP.CAB / 2, top = floor + AMP.ROWS * AMP.CAB + AMP.HEAD;          // the backline's walls
  for (const s of [-1, 1]){ const a = s * AMP.X0, b = s * (AMP.X0 + AMP.COLS * AMP.CAB); out.push([Math.min(a, b), Math.max(a, b), floor, top, AMP.Z - AMP.DEEP / 2, AMP.Z + AMP.DEEP / 2]); }
  return out;
}

/* candidate spots, nearest home first (ties in generation order): every one off the stage frame
   (|x| ≥ 39.5 at the sides, z ≤ −39 upstage — outside the director's eye room) */
const byDist = (home, list) => list.map((p, i) => ({ p, i, d: Math.hypot(p[0] - home[0], p[1] - home[1]) }))
  .sort((a, b) => a.d - b.d || a.i - b.i).map(e => e.p);
const SIDE_BAND = [[-38, -13], [-12.5, 8.5], [9, 25]];
function sideSpots(pair){
  const z0 = JET_HOME[2 * pair][1], [lo, hi] = SIDE_BAND[pair], out = [];
  for (const x of [42, 44.5, 39.5, 47]) for (let dz = -15; dz <= 15; dz += 2.5){
    const z = z0 + dz; if (z >= lo - 1e-9 && z <= hi + 1e-9) out.push([x, z]);
  }
  return byDist([42, z0], out);
}
function backSpots(){
  const out = [];
  for (const x of [17, 14.5, 19.5, 12, 22, 9.5, 24.5]) for (const z of [-44, -41.5, -46.5, -39, -49]) out.push([x, z]);
  return byDist([17, -44], out);
}
const SPOTS = [0, 1, 2].map(sideSpots).concat([backSpots()]);

/** where the pyro stands for these machines:
    anchors (rooms/index.js: each with a world `box` [x0,x1,y0,y1,z0,z1]) + the footing plan →
    { jets: [{x, z, live, margin, moved}] ×8, cannons: [{src, dir, k, live, margin}] ×4, amps: [{x, z, live}], boxes } */
export function planArenaProps(anchors = [], plan = null, { floor = -5.5 } = {}){
  const boxes = [];
  for (const a of anchors) if (a && Array.isArray(a.box) && a.box.length === 6 && a.box.every(Number.isFinite)) boxes.push(a.box);
  if (plan) for (const e of footingBoxes(plan)) boxes.push(e.box);
  const solid = boxes.concat(rigSolids(floor));
  const C = PYRO.CLEAR, jets = new Array(8);
  for (let pair = 0; pair < 4; pair++){
    const L = 2 * pair, R = L + 1, spots = SPOTS[pair];
    const ok = (x, z) => jetClearance(x, z, solid, floor);
    let done = false;
    for (const [x, z] of spots){                                          // the pair together (mirrored)
      const mL = ok(-x, z), mR = ok(x, z);
      if (mL >= C && mR >= C){ jets[L] = { x: -x, z, live: true, margin: mL }; jets[R] = { x, z, live: true, margin: mR }; done = true; break; }
    }
    if (!done) for (const [j, s] of [[L, -1], [R, 1]]){                   // split: each on its own
      let best = null;
      for (const [x, z] of spots){ const m = ok(s * x, z); if (m >= C){ best = { x: s * x, z, live: true, margin: m }; break; } }
      const [hx, hz] = JET_HOME[j];
      jets[j] = best || { x: hx, z: hz, live: false, margin: ok(hx, hz) };   // (struck: it never fires)
    }
  }
  for (let j = 0; j < 8; j++) jets[j].moved = jets[j].x !== JET_HOME[j][0] || jets[j].z !== JET_HOME[j][1];
  const cannons = CO2_HOME.map(([x, z]) => {
    const src = [x, floor + RIG.CO2_Y, z];
    let pick = null, last = null;
    for (const k of [0, .25, .5, .75, 1]){
      const dir = co2Dir(x, z, k), m = plumeClearance(src, dir, boxes);
      last = { src, dir, k, live: m >= C, margin: m };
      if (m >= C){ pick = last; break; }
    }
    return pick || { ...last, dir: co2Dir(x, z, 0), k: 0, live: false };
  });
  const amps = ampColumns().map(({ x, z }) => {
    const h = AMP.CAB / 2 + C, b = [x - h, x + h, floor, floor + AMP.ROWS * AMP.CAB + AMP.HEAD + C, z - AMP.DEEP / 2 - C, z + AMP.DEEP / 2 + C];
    const live = !boxes.some(o => Math.min(o[1], b[1]) > Math.max(o[0], b[0]) && Math.min(o[3], b[3]) > Math.max(o[2], b[2]) && Math.min(o[5], b[5]) > Math.max(o[4], b[4]));
    return { x, z, live };
  });
  return { jets, cannons, amps, boxes };
}
