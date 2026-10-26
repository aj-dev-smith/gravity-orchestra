import { footingBoxes, toWorld } from './footing.js';
/* ============================================================
   CATHEDRAL PROPS — where the nave's movable things stand, as PURE functions of what the machines
   occupy (rooms/index.js: place(anchors, plan) → these, then cathedral.js writes instance matrices; no
   rebuild). Every prop keeps PROPS.CLEAR (1 u ≈ .68 m) from every OBSTACLE: each machine's box (a hung
   one's too — the organ loft's posts reach the floor) and each footing envelope (footingBoxes: pads,
   lofts, stairs / ladders, up to their rails); a candlestick keeps STICK_CLEAR from a machine's box.
     CORONAS   the hanging candle rings: at their own spot; else RAISED (1 u steps, to CORONA_MAX);
               else slid toward their aisle / along the nave, raised again; else hidden (null).
     PRICKETS  the candle stands by the piers (x = ±40.5, outside the ±38 stage — they never meet a
               machine there, but a layout may): slid along the nave; else hidden.
     CANDLES   the room's REACTION: two brass candlesticks per standing machine, on the floor beside
               what it stands on (its pad, or the loft it shares) — its front corners first (+z faces
               the audience), then its front side, its back corners, its sides — clear of every
               obstacle, of each other and of the prickets, inside the stage. Their flames flare on
               their machine's strikes (cathedral.js, a pulse per machine: rooms/pulse.js).
   Deterministic: the same anchors + plan give the same props, in the same order.
   ============================================================ */

export const PROPS = {
  CLEAR: 1,                  // what every prop keeps from every obstacle
  CORONA_R: 3.5,             // a corona's reach (its ring 3.2 + the candles on it)
  CORONA_DROP: .5, CORONA_UP: 1.4,   // …below / above its ring (the drips; the flames)
  CORONA_MAX: 36,            // the highest a corona may hang (under the clerestory sills)
  CORONA_SLIDE: 4,           // how far one may slide toward its aisle
  STICK_R: .5,               // a candlestick's foot
  STICK_CLEAR: 2,            // what a candlestick keeps from a MACHINE's box, along x or z (boxes are how the
                             //  shot solve and the staging audit see things): an arm's length — a box is its
                             //  solid parts, and some reach past it (the turntable's record + pads ≈ 1.6 u)
  STICK_H: 4.9,              // …and its height to the flame's tip (flared)
  PER: 2,                    // candlesticks per machine
  POOL: 64,                  // the room's candlestick pool (constant)
  MAX_SLOT: 32,              // machines with candles (a pulse slot each)
};

/* the corona list the nave hangs (x, y, z — its ring's centre) */
export const CORONAS = [[-34, 24, 30], [34, 24, 30], [-34, 26, -6], [34, 26, -6], [-30, 27, -44], [30, 27, -44], [0, 32, -80], [0, 33, -118]];

/** every obstacle a prop must keep clear of: [{ key, box: [x0, x1, y0, y1, z0, z1], foot }] (foot: a
    footing envelope — what a machine stands on — not a machine) */
export function obstaclesOf(anchors = [], plan = null){
  const out = [];
  for (const a of anchors || []) if (a && Array.isArray(a.box) && a.box.every(Number.isFinite)) out.push({ key: a.key, box: a.box, foot: false });
  if (plan) for (const e of footingBoxes(plan)) out.push({ key: e.unit, box: e.box, foot: true });
  return out;
}
/* the horizontal distance from (x, z) to a box's footprint (0 inside it); dInf: the same along x or z only —
   a point dInf ≥ r away has a square of half-width r that misses the box */
export const dxz = (x, z, b) => Math.hypot(Math.max(b[0] - x, 0, x - b[1]), Math.max(b[4] - z, 0, z - b[5]));
export const dInf = (x, z, b) => Math.max(b[0] - x, 0, x - b[1], b[4] - z, z - b[5]);
const yNear = (a0, a1, b0, b1, g) => Math.min(a1, b1) + g > Math.max(a0, b0);

/** is a corona at (x, y, z) clear — its ring + candles, and its chain up to the vault? */
export function coronaClear(x, y, z, obs, clear = PROPS.CLEAR){
  for (const { box: b } of obs){
    const d = dxz(x, z, b);
    if (d < PROPS.CORONA_R + clear && yNear(y - PROPS.CORONA_DROP, y + PROPS.CORONA_UP, b[2], b[3], clear)) return false;
    if (d < .1 + clear && b[3] + clear > y) return false;                      // (its chain rises from the ring)
  }
  return true;
}
/** where each corona hangs ([x, y, z] or null: hidden) */
export function placeCoronas(obs, list = CORONAS){
  const hang = (x, y0, z) => { for (let y = y0; y <= PROPS.CORONA_MAX + 1e-9; y += 1) if (coronaClear(x, y, z, obs)) return [x, y, z]; return null; };
  return list.map(([x, y, z]) => {
    const out = Math.sign(x) || 1, S = PROPS.CORONA_SLIDE;
    for (const [dx, dz] of [[0, 0], [out * S, 0], [0, 6], [0, -6], [out * S, 6], [out * S, -6], [0, 12], [0, -12]]){
      const at = hang(x + dx, y, z + dz);
      if (at) return at;
    }
    return null;
  });
}

/** where each pricket stands ([x, z] or null): its own spot, else slid along the nave (≤ 6 u) */
export function placePrickets(obs, list, { r = .6, h = 5.6, floor = -5.5 } = {}){
  const clearAt = (x, z) => obs.every(({ box: b }) => !(yNear(floor, floor + h, b[2], b[3], 0) && dxz(x, z, b) < r + PROPS.CLEAR));
  return list.map(([x, z]) => {
    for (const dz of [0, 1.5, -1.5, 3, -3, 4.5, -4.5, 6, -6]) if (clearAt(x, z + dz)) return [x, z + dz];
    return null;
  });
}

/** the candlesticks: [{ key, slot, x, z }] — `slot` numbers the machines that have candles (its pulse);
    `room` {x0, x1, z0, z1} = where they may stand; `avoid` = [{x, z, r}] the room's own props */
export function placeCandles(anchors = [], plan = null, obs = obstaclesOf(anchors, plan), { room = null, avoid = [], floor = -5.5 } = {}){
  const pads = plan?.pads || [], lofts = plan?.lofts || [], out = [], R = PROPS.STICK_R, C = PROPS.CLEAR;
  const tall = obs.filter(({ box: b }) => yNear(floor, floor + PROPS.STICK_H, b[2], b[3], C));
  const clearAt = (x, z, also = []) => {
    if (room && (x < room.x0 + R || x > room.x1 - R || z < room.z0 + R || z > room.z1 - R)) return false;
    for (const { box: b, foot } of tall) if (foot ? dxz(x, z, b) < R + C : dInf(x, z, b) < R + PROPS.STICK_CLEAR) return false;
    for (const c of [...out, ...also]) if (Math.hypot(c.x - x, c.z - z) < 2 * R + C) return false;
    for (const a of avoid) if (Math.hypot(a.x - x, a.z - z) < a.r + R + C) return false;
    return true;
  };
  const machines = (anchors || []).filter(b => b && b.kind !== 'hung' && Array.isArray(b.box));
  let slot = 0;
  for (const a of anchors || []){
    if (!a || a.kind === 'hung' || a.kind === 'belt' || a.fixed || !(a.w > 0 && a.d > 0)) continue;
    if (slot >= PROPS.MAX_SLOT || out.length + PROPS.PER > PROPS.POOL) break;
    const S = supportOf(a, pads, lofts), others = machines.filter(b => b !== a && b.key !== a.key);
    // BESIDE its machine: nearer what it stands on than any other machine
    const mine = (x, z) => { const d = rectDist(S, x, z); return others.every(b => dxz(x, z, b.box) > d + .3); };
    const ok = (p, also) => mine(p[0], p[1]) && clearAt(p[0], p[1], also);
    let got = null;
    for (const [p, q] of pairsRound(S)){                                   // a PAIR at the two ends of one side…
      if (!ok(p, [])) continue;
      if (!ok(q, [{ x: p[0], z: p[1] }])) continue;
      got = [p, q]; break;
    }
    if (!got){                                                             // …else the best single spots
      got = [];
      for (const p of singlesRound(S)){
        if (got.length >= PROPS.PER) break;
        if (got.some(g => Math.hypot(g[0] - p[0], g[1] - p[1]) < 3.5)) continue;
        if (ok(p, got.map(g => ({ x: g[0], z: g[1] })))) got.push(p);
      }
    }
    if (!got.length) continue;
    for (const [x, z] of got) out.push({ key: a.key, slot, x, z });
    slot++;
  }
  return out;
}
/* what a machine's candles stand round: its pad; a loft member's own stretch of the loft (its x-range
   across the loft's depth — lofts are axis-aligned); a machine with no pad, its footprint */
function supportOf(a, pads, lofts){
  const p = pads.find(q => q.key === a.key);
  if (!p) return { x: a.x, z: a.z, hw: a.w / 2, hd: a.d / 2, yaw: a.yaw || 0 };
  const L = p.loft && lofts.find(l => l.id === p.loft);
  if (!L) return p;
  let x0 = Infinity, x1 = -Infinity;
  const c = Math.cos(p.yaw || 0), s = Math.sin(p.yaw || 0);
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]){ const x = p.x + c * u * p.hw + s * v * p.hd; x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  x0 = Math.max(L.x0, x0); x1 = Math.min(L.x1, x1);
  return { x: (x0 + x1) / 2, z: L.z, hw: Math.max(.5, (x1 - x0) / 2), hd: L.hd, yaw: 0 };
}
/* the distance from (x, z) to a (turned) rect */
export function rectDist(S, x, z){
  const c = Math.cos(S.yaw || 0), s = Math.sin(S.yaw || 0), dx = x - S.x, dz = z - S.z;
  const u = c * dx - s * dz, v = s * dx + c * dz;                          // (footing.js toWorld, inverted)
  return Math.hypot(Math.max(Math.abs(u) - S.hw, 0), Math.max(Math.abs(v) - S.hd, 0));
}
const RINGS = [1.6, 2.1, 2.7, 3.4, 4.3], PAIR_RINGS = RINGS.slice(0, 4);
/* a support's sides, the one facing the audience (+z) first: [side, (along t ∈ [−1, 1], ring m) → [x, z]] */
function sidesOf(S){
  const at = (u, v) => toWorld(S, u, v);
  const sides = [
    [(t, m) => at(t * (S.hw + m), S.hd + m), [Math.sin(S.yaw || 0), Math.cos(S.yaw || 0)]],          // +v
    [(t, m) => at(t * (S.hw + m), -(S.hd + m)), [-Math.sin(S.yaw || 0), -Math.cos(S.yaw || 0)]],     // −v
    [(t, m) => at(S.hw + m, t * (S.hd + m)), [Math.cos(S.yaw || 0), -Math.sin(S.yaw || 0)]],         // +u
    [(t, m) => at(-(S.hw + m), t * (S.hd + m)), [-Math.cos(S.yaw || 0), Math.sin(S.yaw || 0)]],      // −u
  ];
  return sides.map(([f, n], i) => ({ f, nz: n[1], i })).sort((a, b) => b.nz - a.nz || a.i - b.i);
}
/* candidate PAIRS: per side (front first), its two corners on the nearest rings that fit, then its
   thirds (closer together, still a pair) */
function pairsRound(S){
  const out = [], combos = [];
  for (const a of PAIR_RINGS) for (const b of PAIR_RINGS) combos.push([a, b]);
  combos.sort((p, q) => Math.max(...p) - Math.max(...q) || p[0] + p[1] - q[0] - q[1] || p[0] - q[0]);
  for (const { f } of sidesOf(S)){
    for (const [ma, mb] of combos) out.push([f(-1, ma), f(1, mb)]);
    for (const [ma, mb] of combos) out.push([f(-1 / 3, ma), f(1 / 3, mb)]);
  }
  return out;
}
/* single spots, the same order (a corner, a third) */
function singlesRound(S){
  const out = [];
  for (const m of RINGS) for (const { f } of sidesOf(S)) for (const t of [-1, 1, -1 / 3, 1 / 3]) out.push(f(t, m));
  return out;
}
