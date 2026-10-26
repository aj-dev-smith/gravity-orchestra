import { FOOT, toWorld, sideNormal, accessRect } from './footing.js';
/* ============================================================
   GRAVEYARD PLACE — where the churchyard stands round its machines. PURE (no THREE, no DOM).

   The room is a crowded churchyard; the machines are set IN it (rooms/footing.js: each on its own
   stone, or as high as the user lifts it). Everything here is a pure function of the anchors and
   the footing plan, so a re-anchor (a new song, a dragged or lifted machine) re-dresses the yard
   deterministically, with no rebuild — the room only re-poses its instance pools:

     placeGraves(anchors, plan)   the GRAVES: tall ones (headstones, Celtic crosses, obelisks) stand
                                  in rows down both sides, behind the stage and along its back; any
                                  that a machine, its support (pad, loft, stair / ladder) or a hung
                                  machine's posts come within CLEAR of is RELOCATED to a reserve plot
                                  further out (the yard keeps its density — never a hole). Low ones
                                  (ledger slabs, kerbed plots, broken stubs, small crosses: under
                                  1 u, so no shot solve ever sees them) fill the gaps between the machines, wherever there is
                                  CLEAR air round them — the stage reads as set INTO the churchyard.
     votives(anchors, plan, obs)  two candles set out before each standing machine (its own: they
                                  gutter brighter on its strikes)
     answerCue / answerTiming     how the yard answers a machine: its strikes over its loudest, and
                                  envelopes that decay inside its own tempo
     footLights(plan)             the lanterns the footing style hangs (rooms/graveyard-footing.js
                                  draws their iron; the room lights their flames) — one source of
                                  truth for both: doorOf / towerOf / terraceLanterns / stairLamp
     wispsFor(anchors)            one will-o'-the-wisp per machine, hovering off its corner

   Obstacles are every standing machine's footprint (its turned rect), every hung machine that comes
   down near the floor (the organ loft's posts), and every SUPPORT as the plan turns it (supportRects:
   a pad, its stair / ladder, a loft — the rects whose AABBs are footingBoxes(plan); the AABB of a
   turned pad would push a votive metres off its face).
   1 u ≈ .677 m. Tall graves stay OUTSIDE the stage room's walls but for one back row (z ≈ −30.5): a
   relocated one goes outside them, so a song's room solids never land where another song's
   machines stand (test/fixtures/staging-rooms.json tables one song's graveyard for every song).
   ============================================================ */

export const GY = {
  CLEAR: 1,                    // the least air between a prop and a machine / its support (u)
  REACH: 8,                    // a hung machine whose box comes this near the floor is an obstacle
  LOW_H: .85,                  // the low graves stay under this (the shot solve ignores < 1 u)
  // the footing forms' shared dimensions (graveyard-footing.js draws them; lights hang from them)
  INS: .45,                    // a mausoleum's walls stand this far in from its deck's edge (the cornice overhangs)
  PLINTH: .32,                 // a mausoleum's base course
  DOOR_MIN: 1.4, DOOR_MAX: 2.2, DOOR_H: 3.3,
  ROOF: .72,                   // a mausoleum's roof slab + cornice (its walls stop this far under its deck)
  LAMP_OUT: .3,                // a wall lantern's centre, out from the wall face
  PIER_IN: 1.14,               // a mausoleum's corner pier: its inner edge, in from the face's end
};

/* deterministic PRNG (rooms/common.js's mulberry32 — copied: this module stays THREE-free) */
export function rng(seed = 1){
  let s = seed >>> 0;
  return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
/** a stable seed from a string (a pad's key: its stone cracks the same way every build) */
export function seedOf(str){ let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

/* ---- obstacles ---- */
/** the distance from (x, z) to a turned rect { x, z, hw, hd, yaw } (0 inside) */
export function rectDist(r, x, z){
  const c = Math.cos(r.yaw || 0), s = Math.sin(r.yaw || 0), dx = x - r.x, dz = z - r.z;
  const u = c * dx - s * dz, v = s * dx + c * dz;                  // (toWorld inverted)
  return Math.hypot(Math.max(Math.abs(u) - r.hw, 0), Math.max(Math.abs(v) - r.hd, 0));
}
/** everything a prop keeps clear of: machines (their turned footprints), hung machines that come down
    near the floor, every support envelope of the plan (pads, lofts, stairs, ladders — AABBs) */
export function obstaclesOf(anchors = [], plan = null, floor = -5.5){
  const out = [];
  for (const a of anchors || []){
    if (!a || !(a.w > 0 && a.d > 0) || !Number.isFinite(a.x) || !Number.isFinite(a.z)) continue;
    if (a.kind === 'hung' && Array.isArray(a.box) && a.box[2] > floor + GY.REACH) continue;   // (flies high: the chandelier)
    out.push({ key: a.key, x: a.x, z: a.z, hw: a.w / 2, hd: a.d / 2, yaw: a.kind === 'hung' ? 0 : a.yaw || 0 });
  }
  if (plan) out.push(...supportRects(plan));
  return out;
}
/** every support of the plan as the plan turns it — { key (its footingBoxes unit), kind, x, z, hw, hd, yaw }:
    a pad (not a loft's member: the loft holds it), its stair / ladder, a loft, the loft's stair / ladder.
    footingBoxes(plan) is exactly the AABBs of these; the footing style draws inside them (tested). */
export function supportRects(plan){
  const out = [];
  if (!plan) return out;
  for (const p of plan.pads){
    if (!p.loft) out.push({ key: p.key, kind: 'pad', x: p.x, z: p.z, hw: p.hw, hd: p.hd, yaw: p.yaw || 0 });
    if (p.access) out.push({ key: p.key, kind: 'access', ...accessRect(p, p.access) });
  }
  for (const L of plan.lofts){
    out.push({ key: L.id, kind: 'loft', x: L.x, z: L.z, hw: L.hw, hd: L.hd, yaw: L.yaw || 0 });
    if (L.access) out.push({ key: L.id, kind: 'access', ...accessRect(L, L.access) });
  }
  return out;
}
/** is a prop of radius r at (x, z) at least `gap` clear of every obstacle? */
export function clearOf(obs, x, z, r = 0, gap = GY.CLEAR){
  for (const o of obs) if (rectDist(o, x, z) < r + gap) return false;
  return true;
}

/* ---- the GRAVES ---- */
/* a grave plot: { x, z, kind, yaw, lean, roll, s, r (its footprint radius), candle: [dx, dz] | null }
   kinds: tall — 'head' (a round-topped headstone ≈ 1.5 × 2.1 u), 'cross' (a Celtic cross ≈ 3.9 u),
   'obelisk' (≈ 6.8 u); low (under 1 u, leaning included) — 'ledger' (a flat slab), 'plot' (a kerbed plot
   filled with moss + a low tablet), 'stub' (a headstone sunk to its shoulders, its top broken off),
   'tcross' (a small iron-age cross, leaning) — the stubs give the stage its jagged churchyard outline */
const R_OF = { head: .95, cross: .85, obelisk: 1.25, ledger: 1.66, plot: 1.72, stub: .62, tcross: .5 };   // (≥ each one's half-diagonal)
function plotAt(R, x, z, kind, yaw, candleP){
  const s = Math.min(.88 + R() * .34, kind === 'stub' || kind === 'tcross' ? 1.1 : 9);   // (a low stone stays under 1 u, leaning too)
  const g = { x, z, kind, yaw: yaw + (R() - .5) * .3, lean: (R() - .5) * (kind === 'obelisk' ? .06 : .24), roll: (R() - .5) * (kind === 'obelisk' ? .04 : .16),
    s, r: R_OF[kind] * s, candle: null };
  if (kind === 'ledger' || kind === 'plot'){ g.lean = (R() - .5) * .03; g.roll = (R() - .5) * .03; }
  if (R() < candleP) g.candle = [(R() - .5) * 1.1, (kind === 'ledger' || kind === 'plot' ? 1.9 : 1.05) * s + R() * .25];
  return g;
}
let SLOTS = null;
/** every plot the yard has (deterministic): home (tall), reserve (tall, further out), low (the stage) */
export function graveSlots(){
  if (SLOTS) return SLOTS;
  const R = rng(1031), home = [], reserve = [], low = [];
  const tallKind = (r, obelisks = true) => r < .64 ? 'head' : (r < .9 || !obelisks) ? 'cross' : 'obelisk';
  // the side fields: four rows down each side (the nearest row reads in every wide), facing the stage
  for (const side of [-1, 1]) for (let row = 0; row < 4; row++){
    const x0 = side * (43 + row * 4.5);
    for (let k = 0; k < 20; k++){
      if (R() < .1) continue;                                     // a gap in the row (a path, a lost stone)
      const z = -52 + k * 4.2 + (R() - .5) * 1.4, x = x0 + (R() - .5) * 1.1;
      home.push(plotAt(R, x, z, tallKind(R(), row > 0), side * -Math.PI / 2 * .25, row === 0 ? .42 : .22));
    }
  }
  // the back field, behind the stage room's back wall (a path up the middle from the gate)
  for (let row = 0; row < 4; row++) for (let k = 0; k < 19; k++){
    const x = -38 + k * 4.22 + (R() - .5) * 1.2, z = -37 - row * 4.5 + (R() - .5) * 1.2;
    if (Math.abs(x) < 4.5 || R() < .08) continue;
    home.push(plotAt(R, x, z, tallKind(R()), 0, row === 0 ? .4 : .18));
  }
  // one row INSIDE the stage room, along its back (the gallery's lofts move these on)
  for (let k = 0; k < 17; k++){
    const x = -35.5 + k * 4.44 + (R() - .5) * 1.1, z = -30.5 + (R() - .5) * 1.4;
    if (Math.abs(x) < 3) continue;
    home.push(plotAt(R, x, z, tallKind(R(), false), 0, .45));
  }
  // RESERVE plots (outside the stage room, in the order they fill): between the side rows, then
  // along the back fence — a displaced grave moves here, the yard stays as full as it was
  for (let k = 0; k < 18; k++) for (const side of [-1, 1]){
    const x = side * (45.25 + (k % 3) * 4.5) + (R() - .5) * .8, z = -50 + k * 4.4 + 2.1 + (R() - .5) * 1.2;
    reserve.push(plotAt(R, x, z, tallKind(R(), k % 3 > 0), side * -Math.PI / 2 * .25, .2));
  }
  for (let k = 0; k < 18; k++){
    const x = -36 + k * 4.24 + (R() - .5) * 1.2, z = -54.5 + (R() - .5) * .8;
    if (Math.abs(x) < 4.5) continue;
    reserve.push(plotAt(R, x, z, tallKind(R()), 0, .15));
  }
  // the LOW plots: a loose grid over the stage room (shown wherever the machines leave CLEAR air)
  for (let i = 0; i < 14; i++) for (let j = 0; j < 13; j++){
    const x = -34 + i * 5.2 + (R() - .5) * 1.8, z = -30 + j * 5.2 + (R() - .5) * 1.8;
    if (R() < .3) continue;
    const v = R(), kind = v < .2 ? 'stub' : v < .34 ? 'tcross' : v < .7 ? 'ledger' : 'plot';
    low.push(plotAt(R, x, z, kind, (R() - .5) * .5 + (R() < .5 ? 0 : Math.PI), .13));
  }
  return (SLOTS = { home, reserve, low });
}

/** where the graves stand round these machines: { tall: [plot], low: [plot], moved, hidden } — tall =
    every home plot that is clear + one reserve plot per displaced one (in order); low = the clear ones */
export function placeGraves(anchors = [], plan = null, { floor = -5.5, obs = null } = {}){
  const S = graveSlots(), O = obs || obstaclesOf(anchors, plan, floor);
  const ok = g => clearOf(O, g.x, g.z, g.r);
  const tall = [];
  let moved = 0;
  for (const g of S.home) if (ok(g)) tall.push(g); else moved++;
  let need = moved, hidden = 0;
  for (const g of S.reserve){ if (need <= 0) break; if (ok(g)){ tall.push(g); need--; } }
  hidden = need;                                                      // (the reserve ran out: a hole after all)
  const low = S.low.filter(ok);
  // (a candle beside a kept grave is kept only if it too is clear)
  return { tall, low, moved, hidden, obs: O };
}
/** the candles on these graves: [{ x, z, grave }] — each clear of every obstacle */
export function graveCandles(graves, obs){
  const out = [];
  for (const g of graves) if (g.candle){
    const c = Math.cos(g.yaw), s = Math.sin(g.yaw), [dx, dz] = g.candle;
    const x = g.x + c * dx + s * dz, z = g.z - s * dx + c * dz;
    if (clearOf(obs, x, z, VOTIVE_R)) out.push({ x, z, grave: g });
  }
  return out;
}

/* ---- how the yard ANSWERS a machine ---- */
/** a machine's strike cue made into the yard's: every weight over its loudest, ^.5 (a quiet machine — the
    kit's brushed hats, a music box — answers as fully as a loud one; velocity still shapes it), and its
    TEMPO: the median gap between its strikes, so a dense machine's light can decay inside it and pulse
    instead of holding a steady glow → { cue, gap, max } */
export function answerCue(cue = []){
  if (!Array.isArray(cue) || !cue.length) return { cue: [], gap: Infinity, max: 0 };
  let max = 0;
  for (const c of cue) max = Math.max(max, c.w ?? 1);
  const out = cue.map(c => ({ t: c.t, w: max > 0 ? Math.sqrt(Math.max(0, c.w ?? 1) / max) : 0 }));
  const ts = [...new Set(cue.map(c => Math.round(c.t * 1000)))].sort((a, b) => a - b), g = [];
  for (let i = 1; i < ts.length; i++) g.push((ts[i] - ts[i - 1]) / 1000);
  g.sort((a, b) => a - b);
  return { cue: out, gap: g.length ? g[g.length >> 1] : Infinity, max };
}
/** the envelopes' timing from that tempo: the flame's afterglow, the fog's (it lingers more), how early each
    leans in — every decay at most ~1.3 of the machine's own gap, so a fast run reads as pulses, never a glow */
export function answerTiming(gap){
  const c = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  return { flame: { decay: c(1.1 * gap, .18, .45), lead: c(.8 * gap, .12, .3) },
           fog: { decay: c(1.3 * gap, .25, 1.1), lead: c(.9 * gap, .12, .4) } };
}

/* ---- the machines' own lights ---- */
/** the side of a rect facing the audience most (+z), among `sides` */
function frontSide(r, sides = ['+v', '-v', '+u', '-u']){
  let best = sides[0], bz = -Infinity;
  for (const s of sides){ const [, nz] = sideNormal(r, s); if (nz > bz + 1e-9){ bz = nz; best = s; } }
  return best;
}
/* a side's local frame: along a ↦ (u, v), out o past the face */
export const onSide = (r, side) => { const k = side[0] === '+' ? 1 : -1;
  return side[1] === 'u' ? (a, o) => [k * (r.hw + o), a] : (a, o) => [a, k * (r.hd + o)]; };
const faceLen = (r, side) => side[1] === 'u' ? 2 * r.hd : 2 * r.hw;

/** two votive candles set out before each standing machine (not the belt, not on a loft): out from its
    pad's front face — or, where that is crowded, its sides, then its back — each CLEAR of everything
    (its own pad and stair too) and of the other: [{ x, z, key }] */
export const VOTIVE_R = .2;
export function votives(anchors = [], plan = null, obs = []){
  const out = [];
  if (!plan) return out;
  const OUT = GY.CLEAR + VOTIVE_R + .1;
  for (const p of plan.pads){
    if (p.fixed || p.kind === 'belt' || p.loft) continue;
    const front = frontSide(p), sides = [front, ...['+u', '-u', '+v', '-v'].filter(s => s !== front).sort((a, b) => sideNormal(p, b)[1] - sideNormal(p, a)[1])];
    const mine = [];
    for (const side of sides){
      const L = faceLen(p, side), S = onSide(p, side), h = Math.min(L / 2 - .4, 2.6);
      for (const a of [-h, h, -h / 2, h / 2, 0]){
        if (mine.length >= 2) break;
        const [u, v] = S(a, OUT), [x, z] = toWorld(p, u, v);
        if (!clearOf(obs, x, z, VOTIVE_R) || mine.some(m => Math.hypot(m.x - x, m.z - z) < 1.2)) continue;
        mine.push({ x, z, key: p.key });
      }
      if (mine.length >= 2) break;
    }
    out.push(...mine);
  }
  return out;
}

/** a MAUSOLEUM's door (mid band, solid): on the face toward the audience that its access doesn't use and
    that is long enough — { side, a, w, h } (along-centre, width, height above the base course) or null */
export function doorOf(p, floor){
  if (p.open || p.band !== 'mid') return null;
  const H = p.top - floor;
  const sides = ['+v', '-v', '+u', '-u'].filter(s => s !== p.access?.side && faceLen(p, s) - 2 * GY.INS >= GY.DOOR_MIN + 2.2);
  if (!sides.length) return null;
  const side = frontSide(p, sides), L = faceLen(p, side) - 2 * GY.INS;
  const w = Math.max(GY.DOOR_MIN, Math.min(GY.DOOR_MAX, .3 * L));
  const avail = H - GY.PLINTH - GY.ROOF - .3;                       // (base course → under the cornice, a margin)
  const h = Math.max(1.5, Math.min(GY.DOOR_H, avail - .55 * w - .12));
  const rise = Math.max(.25, Math.min(.55 * w, avail - h - .12));   // (the pointed hood: lower on a squat tomb)
  return { side, a: 0, w, h, rise };
}
/** the top of a door's pointed hood + keystone, above its base course */
export const doorApex = d => d.h + d.rise + .12;
/** its two wall lanterns (local u, y, v): between the door's surround and the corner piers (none if they
    don't fit) */
export function doorLamps(p, floor){
  const d = doorOf(p, floor); if (!d) return [];
  const half = faceLen(p, d.side) / 2, lo = d.w / 2 + .3 + .22, hi = half - GY.PIER_IN - .22;
  if (hi - lo < .3) return [];
  const a = (lo + hi) / 2, S = onSide(p, d.side), y = floor + GY.PLINTH + d.h * .74;
  return [-1, 1].map(k => { const [u, v] = S(d.a + k * a, -GY.INS + GY.LAMP_OUT); return [u, y, v]; });
}

/** a RUINED BELL TOWER (high band, solid — the gallery's other machines stand on the crypt terrace, so
    the tower is built in its language: an arcade of piers and pointed arches round every storey, a belfry
    in the top one): its storeys, the bell hung in the belfry, and the LANTERN hung in the front arch of the
    belfry nearest the middle that its ladder doesn't climb past — { yC (under its cornice), nT, tierTop(t),
    bell: { u, v, r, y (its crown) }, lamp: (local u, y, v) | null, bay: [a0, a1] (the lamp's arch, along
    the front), side } */
export const TOWER = { DECK: .5, CORN: .36, STOREY: 8 };
export function towerOf(p, floor){
  if (!p || p.open || p.band !== 'high') return null;
  const Dd = Math.max(TOWER.DECK, (p.well || 0) + .06), yC = p.top - Dd - TOWER.CORN;
  const nT = Math.max(1, Math.round((yC - floor) / TOWER.STOREY)), tierTop = t => floor + (yC - floor) * (t + 1) / nT;
  const side = frontSide(p, ['+v', '-v', '+u', '-u']), A = arcadeOf(faceLen(p, side)), hp = PIER / 2;
  const acc = p.access, lad = acc && acc.kind === 'ladder' && acc.side === side ? [acc.a0 - .6, acc.a1 + .6] : null;
  let bay = null, best = Infinity;
  for (let i = 0; i < A.length - 1; i++){
    const a0 = A[i] + hp, a1 = A[i + 1] - hp, m = (a0 + a1) / 2;
    if (a1 - a0 < 1.2) continue;
    if (lad && m + .3 > lad[0] && m - .3 < lad[1]) continue;                // (not where the climber passes)
    if (Math.abs(m) < best - 1e-9){ best = Math.abs(m); bay = [a0, a1]; }
  }
  const crown = yC - .45, S = onSide(p, side);
  let lamp = null;
  if (bay){ const [u, v] = S((bay[0] + bay[1]) / 2, -TERR.INP); lamp = [u, crown - 1.1, v]; }
  // the bell: in the middle of the belfry, clear of the pier lines (each TERR.INP + PIER/2 in from an edge)
  const room = Math.min(p.hw, p.hd) - TERR.INP - hp - .25;
  const r = Math.max(.35, Math.min(1.05, room));
  return { yC, nT, tierTop, side, bay, lamp, bell: { u: 0, v: 0, r, y: yC - .32 }, Dd };
}
/** a crypt stair's lamp post at its foot (a stair access): local (u, y, v) of the lamp */
export function stairLamp(r, floor){
  const acc = r.access; if (!acc || acc.kind !== 'stair') return null;
  const [u, v] = onSide(r, acc.side)(acc.a0 + .14, acc.out - .16);
  return [u, floor + 1.95, v];
}
/** a CRYPT TERRACE's arcade: the along-positions of a face's piers (corners included, each pier line
    TERR.INP in from the edge), ≤ BAY apart */
export const BAY = 4.6, PIER = .95, TERR = { INP: PIER / 2 + .16, LAMP_Y: 1.22 };
export function arcadeOf(len){
  const h = Math.max(0, len / 2 - TERR.INP), n = Math.max(1, Math.ceil(2 * h / BAY - 1e-9)), out = [];
  for (let i = 0; i <= n; i++) out.push(-h + 2 * h * i / n);
  return out;
}
/** which face of a terrace is its front (the ±v one facing the audience) */
export const terraceFront = L => frontSide(L, ['+v', '-v']);
/** a CRYPT TERRACE (a loft above the low band — it carries an iron fence): lanterns on its fence posts
    over every other pier of its front arcade — local (u, y, v) */
export function terraceLanterns(L){
  if (L.band === 'low') return [];
  const side = terraceFront(L), S = onSide(L, side), A = arcadeOf(2 * L.hw), out = [];
  for (let i = 0; i < A.length; i += 2){ const [u, v] = S(A[i], -.12); out.push([u, L.top + TERR.LAMP_Y, v]); }
  return out;
}

/** every lantern the footing hangs, in WORLD space: [{ x, y, z, key (the machine it answers) }] */
export function footLights(plan){
  const out = [], F = plan.floor;
  const put = (r, pt, key) => { if (!pt) return; const [x, z] = toWorld(r, pt[0], pt[2]); out.push({ x, y: pt[1], z, key }); };
  for (const p of plan.pads){
    if (p.loft || p.fixed) continue;
    for (const pt of doorLamps(p, F)) put(p, pt, p.key);
    put(p, towerOf(p, F)?.lamp, p.key);
    if (!p.open) put(p, stairLamp(p, F), p.key);
  }
  for (const L of plan.lofts){
    const members = plan.pads.filter(p => p.loft === L.id);
    const near = (x, z) => { let key = members[0]?.key, best = Infinity;
      for (const m of members){ const d = Math.hypot(m.x - x, m.z - z); if (d < best){ best = d; key = m.key; } } return key; };
    for (const pt of terraceLanterns(L)){ const [x, z] = toWorld(L, pt[0], pt[2]); out.push({ x, y: pt[1], z, key: near(x, z) }); }
    const sl = stairLamp(L, F);
    if (sl){ const [x, z] = toWorld(L, sl[0], sl[2]); out.push({ x, y: sl[1], z, key: near(x, z) }); }
  }
  return out;
}

/** one wisp per machine (standing: below; hung: after the pads): its home off the pad's outer front corner (a little above the low fog)
    and the point it drifts to as the machine plays (just off its pad's edge, at its deck) */
export function wispsFor(anchors = [], plan = null, floor = -5.5){
  const out = [];
  if (!plan) return out;
  plan.pads.forEach((p, i) => {
    if (p.kind === 'hung') return;
    const side = frontSide(p), S = onSide(p, side), L = faceLen(p, side), k = i % 2 ? 1 : -1;
    const [hu, hv] = S(k * (L / 2 + 1.4), 1.6), [tu, tv] = S(k * L / 4, .5);
    const [hx, hz] = toWorld(p, hu, hv), [tx, tz] = toWorld(p, tu, tv);
    const y0 = Math.max(floor + 2.2, Math.min(p.top + 1.2, floor + 9)) + (i % 3) * .5;
    out.push({ key: p.key, home: [hx, y0, hz], to: [tx, Math.max(floor + 1.2, p.top + .8), tz] });
  });
  // a HUNG machine (the organ loft, the chandelier, the court): its wisp waits off its front, drifts in under it
  (anchors || []).forEach((a, i) => {
    if (!a || a.kind !== 'hung' || !Array.isArray(a.box)) return;
    const [x0, x1, y0, , , z1] = a.box, cx = (x0 + x1) / 2, k = i % 2 ? 1 : -1;
    const yTo = Math.max(floor + 1.2, Math.min(y0 - .6, floor + 9));
    out.push({ key: a.key, home: [cx + k * ((x1 - x0) / 2 + 1.4), Math.max(floor + 2.2, Math.min(yTo + .8, floor + 9)), z1 + 1.6], to: [cx + k * (x1 - x0) / 4, yTo, z1 + .5] });
  });
  return out;
}

export { FOOT, accessRect };
