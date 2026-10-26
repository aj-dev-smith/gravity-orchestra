/* ============================================================
   THE VOID's GROUND — PURE (no THREE, no DOM): what floats under the machines, where its runes are
   carved and where its crystals hover. src/rooms/void.js builds them; test/room-void.test.js and
   test/staging-audit.test.js hold them to it. All world units (1 u ≈ .677 m), rects as footing.js:
   a centre (x, z), half extents (hw, hd) along its own axes, a yaw (three's rotation.y).

   ISLANDS (voidIslands): a piece per standing machine (its footprint + PAD) and, given the footing
   plan (rooms/footing.js), per structure that reaches past them — a LOFT's shared deck and every
   STAIR / LADDER (+ KEEP) — and per HUNG machine whose own columns come down to the floor (the organ
   loft: + KEEP; it is not a machine — a chandelier that never reaches the floor floats, no island).
   Pieces whose raw rects come within GAP join one cluster; a cluster is ONE island: the convex hull
   of its pieces' padded corners (CCW in x, z). Islands that come within MERGE of each other are one
   LANDMASS (`group`): they are grown until they overlap SOLIDLY (by ≥ OVER) and drawn at one height,
   so their union reads as one piece of ground (never a hairline crack) — never re-hulled together
   (a hull of everything would pave the whole stage). Between landmasses: a crack of void ≥ MERGE.
   machines = how many machines stand on it; slots = their indices in machinesOf(anchors); gslots =
   every machine on its landmass.

   RUNES (runeSpots): glyphs carved round each island's rim, every RUNE.STEP along its straight
   edges — each lit by the NEAREST machine on its island (its slot), so a machine's strikes run
   round its own stretch of the rim; an island with no machine (the organ's) keeps slot −1 (the
   room's fallback glow).
   SKY ROCKS (skyRocks): a chandelier whose rods reach the ceiling hangs from an island turned over.
   CRYSTALS (crystalSpots): a few shards hovering just off each machine's own stretch of rim — near
   its deck when it stands high — that breathe and lift on its strikes. A pure fn of anchors + plan:
   every one stays CRYSTAL.CLEAR clear of every machine's solid box and of everything the machines
   stand on (footingBoxes) and off every other island; a spot that can't is dropped.
   ============================================================ */
import { accessRect, footingBoxes, toWorld } from './footing.js';

export const ISLE = {
  PAD: 1.5,            // an island reaches this far past a machine's footprint (its stone platform ≈ 1 u ≈ 70 cm, then a ledge of rock)
  GAP: .6,             // pieces whose raw rects come within this share an island…
  KEEP: .85,           // …a loft deck / stair / ladder / hung column base: this far past its rect (on the platform)
  MERGE: .8,           // islands whose hulls come within this are one landmass…
  OVER: .7,            // …grown until they overlap by this
  INSET: .5,           // the stone PLATFORM sits this far inside an island's outline (a ledge of rough rock round it)
  RIM: .14,            // the rim outline sits this far past the hull (the chamfer's lip)
};
export const RUNE = { STEP: .95, END: 1, H: .28, W: .2 };           // spacing along an edge, kept off its corners (the platform's are inset), glyph size
export const CRYSTAL = { PER: 3, OUT: 1.35, SEP: 2.4, CLEAR: 1, R: .3, MAX: 96 };

/** the machines the room lights (and floats crystals for): every standing anchor, in order, ≤ 32 */
export const machinesOf = anchors => (anchors || []).filter(a => a && a.kind !== 'hung' && a.w > 0 && a.d > 0).slice(0, 32);

const rectCorners = (r, pad = 0) => {
  const c = Math.cos(r.yaw || 0), s = Math.sin(r.yaw || 0), hw = r.hw + pad, hd = r.hd + pad;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [r.x + c * hw * u + s * hd * v, r.z - s * hw * u + c * hd * v]);
};
/* separating axes on two convex polygons grown by g / 2 each (corner lists, any winding) */
function polysMeet(pa, pb, g = 0){
  for (const P of [pa, pb]) for (let i = 0; i < P.length; i++){
    const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-9) continue;
    const ax = -(b[1] - a[1]) / L, az = (b[0] - a[0]) / L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const q of pa){ const d = q[0] * ax + q[1] * az; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const q of pb){ const d = q[0] * ax + q[1] * az; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 + g / 2 < b0 - g / 2 || b1 + g / 2 < a0 - g / 2) return false;
  }
  return true;
}
const rectsTouch = (A, B) => polysMeet(rectCorners(A), rectCorners(B), ISLE.GAP);
/** convex hull, monotone chain, CCW in (x, z) */
export function hull(pts){
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts){ while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.reverse()){ while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
/** how far (x, z) lies outside a convex CCW polygon (0 inside) */
export function outOf(H, x, z){
  let inside = true, d = Infinity;
  for (let i = 0; i < H.length; i++){
    const a = H[i], b = H[(i + 1) % H.length], ex = b[0] - a[0], ez = b[1] - a[1], L2 = ex * ex + ez * ez || 1e-12;
    if (ex * (z - a[1]) - ez * (x - a[0]) < -1e-9) inside = false;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / L2));
    d = Math.min(d, Math.hypot(x - a[0] - t * ex, z - a[1] - t * ez));
  }
  return inside ? 0 : d;
}
/** the distance from (x, z) to a turned rect (0 inside) */
export function rectDist(r, x, z){
  const c = Math.cos(r.yaw || 0), s = Math.sin(r.yaw || 0), dx = x - r.x, dz = z - r.z;
  const u = c * dx - s * dz, v = s * dx + c * dz;                // (world → the rect's own u, v)
  return Math.hypot(Math.max(0, Math.abs(u) - r.hw), Math.max(0, Math.abs(v) - r.hd));
}
const rectOf = a => ({ x: a.x, z: a.z, yaw: a.yaw || 0, hw: a.w / 2, hd: a.d / 2 });

export function voidIslands(anchors = [], plan = null){
  const F = plan?.floor ?? -5.5, pieces = [], ms = machinesOf(anchors);
  for (const a of anchors || []){
    if (!a || !(a.w > 0 && a.d > 0) || !Number.isFinite(a.x) || !Number.isFinite(a.z)) continue;
    if (a.kind !== 'hung') pieces.push({ key: a.key, machine: true, slot: ms.indexOf(a), ...rectOf(a), pad: ISLE.PAD });
    else if (Array.isArray(a.box) && a.box[2] <= F + .5) pieces.push({ key: a.key, hung: true, ...rectOf(a), pad: ISLE.KEEP });   // (its columns stand on the floor)
  }
  if (plan){
    for (const L of plan.lofts || []) pieces.push({ key: L.id, x: L.x, z: L.z, yaw: L.yaw || 0, hw: L.hw, hd: L.hd, pad: ISLE.KEEP });
    for (const U of [...(plan.pads || []), ...(plan.lofts || [])])
      if (U.access) pieces.push({ key: `${U.key || U.id}:${U.access.kind}`, ...accessRect(U, U.access), pad: ISLE.KEEP });
  }
  // clusters: raw rects within GAP…
  const par = pieces.map((_, i) => i), find = i => par[i] === i ? i : (par[i] = find(par[i]));
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) if (rectsTouch(pieces[i], pieces[j])) par[find(i)] = find(j);
  const groups = new Map();
  pieces.forEach((p, i) => { const r = find(i); groups.has(r) ? groups.get(r).push(p) : groups.set(r, [p]); });
  // (a stable order: by the first piece's place in the list — the anchors' order)
  const parts = [...groups.values()].map(g => ({ g, H: hull(g.flatMap(p => rectCorners(p, p.pad))), grow: 0 }));
  // LANDMASSES: islands within MERGE of each other, grown (both, evenly) until they overlap by OVER
  const lp = parts.map((_, i) => i), lf = i => lp[i] === i ? i : (lp[i] = lf(lp[i]));
  for (let pass = 0, changed = true; changed && pass < parts.length + 1; pass++){
    changed = false;
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++){
      const g = sepGap(parts[i].H, parts[j].H);
      if (g > ISLE.MERGE) continue;
      if (lf(i) !== lf(j)){ lp[lf(i)] = lf(j); changed = true; }
      if (g > -ISLE.OVER + 1e-6){
        const d = (g + ISLE.OVER) / 2 + .02;
        for (const P of [parts[i], parts[j]]){ P.H = grown(P.H, d); P.grow += d; }
        changed = true;
      }
    }
  }
  const gid = new Map();
  return parts.map((P, i) => {
    const r = lf(i); if (!gid.has(r)) gid.set(r, gid.size);
    const g = P.g;
    return {
      keys: g.map(p => p.key), machines: g.filter(p => p.machine).length, slots: g.filter(p => p.machine && p.slot >= 0).map(p => p.slot),
      hull: P.H, rim: grown(P.H, ISLE.RIM), group: gid.get(r), ...centroid(P.H),
    };
  }).map((I, _, all) => ({ ...I, gslots: all.filter(J => J.group === I.group).flatMap(J => J.slots) }));
}
/** two convex polygons' separation along their best axis: > 0 apart by that much, ≤ 0 overlapping (by −it) */
export function sepGap(pa, pb){
  let best = -Infinity;
  for (const P of [pa, pb]) for (let i = 0; i < P.length; i++){
    const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-9) continue;
    const ax = -(b[1] - a[1]) / L, az = (b[0] - a[0]) / L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const q of pa){ const d = q[0] * ax + q[1] * az; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const q of pb){ const d = q[0] * ax + q[1] * az; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    best = Math.max(best, b0 - a1, a0 - b1);
  }
  return best;
}
/** a convex CCW polygon grown OUTWARD by d (inset by −d), its miters capped */
export function grown(H, d){
  const n = H.length, out = [];
  for (let i = 0; i < n; i++){
    const p = H[(i + n - 1) % n], c = H[i], q = H[(i + 1) % n];
    const e0x = c[0] - p[0], e0z = c[1] - p[1], L0 = Math.hypot(e0x, e0z) || 1, e1x = q[0] - c[0], e1z = q[1] - c[1], L1 = Math.hypot(e1x, e1z) || 1;
    const n0x = e0z / L0, n0z = -e0x / L0, n1x = e1z / L1, n1z = -e1x / L1;             // (outward: the interior is on the left)
    const k = Math.min(2.5, 1 / Math.max(.2, (1 + n0x * n1x + n0z * n1z) / 2)) * d / 2;
    out.push([c[0] + (n0x + n1x) * k, c[1] + (n0z + n1z) * k]);
  }
  return out;
}
/** a polygon's area centroid + area */
export function centroid(H){
  let A = 0, cx = 0, cz = 0;
  for (let i = 0; i < H.length; i++){
    const [x0, z0] = H[i], [x1, z1] = H[(i + 1) % H.length], k = x0 * z1 - x1 * z0;
    A += k; cx += (x0 + x1) * k; cz += (z0 + z1) * k;
  }
  if (Math.abs(A) < 1e-9){ const n = H.length || 1; return { cx: H.reduce((s, p) => s + p[0], 0) / n, cz: H.reduce((s, p) => s + p[1], 0) / n, area: 0 }; }
  return { cx: cx / (3 * A), cz: cz / (3 * A), area: Math.abs(A) / 2 };
}

/* a deterministic hash of a world spot → [0, 1): a carving / a shard is a pure fn of WHERE it is, so
   moving one machine never reshuffles another island's runes */
export const hash2 = (x, z, k = 0) => { const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return s - Math.floor(s); };

/** the glyphs: straight strokes (carvable — runes were cut, not drawn) in a box 0..W × 0..1 (W ≈ .7) */
export const GLYPHS = [
  [[0, 0, 0, 1], [0, .62, .62, .95], [0, .3, .62, .63]],                               // ᚠ fehu
  [[0, 0, 0, 1], [0, 1, .66, .7], [.66, .7, .66, 0]],                                  // ᚢ uruz
  [[0, 0, 0, 1], [0, .78, .58, .5], [.58, .5, 0, .22]],                                // ᚦ thurisaz
  [[0, 0, 0, 1], [0, 1, .6, .72], [0, .7, .6, .42]],                                   // ᚨ ansuz
  [[0, 0, 0, 1], [0, 1, .58, .76], [.58, .76, 0, .52], [0, .52, .6, 0]],                // ᚱ raido
  [[.62, 1, 0, .5], [0, .5, .62, 0]],                                                  // ᚲ kaunan
  [[0, 0, .7, 1], [0, 1, .7, 0]],                                                      // ᚷ gebo
  [[0, 0, 0, 1], [0, 1, .55, .76], [.55, .76, 0, .52]],                                // ᚹ wunjo
  [[0, 0, 0, 1], [.62, 0, .62, 1], [0, .66, .62, .34]],                                // ᚺ hagalaz
  [[.32, 0, .32, 1], [0, .68, .64, .4]],                                               // ᚾ naudiz
  [[.32, 1, 0, .76], [0, .76, .32, .52], [.4, .48, .72, .24], [.72, .24, .4, 0]],       // ᛃ jera
  [[.34, 0, .34, 1], [.34, 1, .66, .8], [.34, 0, .02, .2]],                            // ᛇ eihwaz
  [[.35, 0, .35, 1], [.35, .52, 0, 1], [.35, .52, .7, 1]],                             // ᛉ algiz
  [[.62, 1, 0, .62], [0, .62, .62, .38], [.62, .38, 0, 0]],                            // ᛊ sowilo
  [[.35, 0, .35, 1], [.35, 1, 0, .7], [.35, 1, .7, .7]],                               // ᛏ tiwaz
  [[0, 0, 0, 1], [0, 1, .55, .76], [.55, .76, 0, .5], [0, .5, .55, .24], [.55, .24, 0, 0]],   // ᛒ berkanan
  [[0, 0, 0, 1], [.7, 0, .7, 1], [0, 1, .35, .62], [.35, .62, .7, 1]],                 // ᛖ ehwaz
  [[0, 0, 0, 1], [.7, 0, .7, 1], [0, 1, .7, .56], [.7, 1, 0, .56]],                    // ᛗ mannaz
  [[0, 0, 0, 1], [0, 1, .56, .7]],                                                     // ᛚ laguz
  [[.35, 1, .7, .5], [.7, .5, .35, 0], [.35, 0, 0, .5], [0, .5, .35, 1]],              // ᛜ ingwaz
  [[0, 0, 0, 1], [.78, 0, .78, 1], [0, 1, .78, 0], [0, 0, .78, 1]],                    // ᛞ dagaz
];
export const glyphOf = (x, z, k = 0) => (hash2(x, z, k) * GLYPHS.length) | 0;

/** RUNES round every island's PLATFORM (its hull inset by ISLE.INSET): [{ x, z, tx, tz, nx, nz, g, slot, isle }] —
    (x, z) on the platform's edge, t its direction (CCW), n outward; g a glyph index; slot the nearest machine's on
    its landmass (−1: none). A rune that would lie under a neighbouring island's platform (same landmass) is not
    carved: nobody would see it */
export function runeSpots(isles, anchors){
  const ms = machinesOf(anchors), out = [];
  const plat = isles.map(I => grown(I.hull, -ISLE.INSET));
  isles.forEach((I, ii) => {
    const own = (I.gslots || I.slots).map(s => [s, rectOf(ms[s])]);
    const H = plat[ii];
    for (let i = 0; i < H.length; i++){
      const a = H[i], b = H[(i + 1) % H.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.floor((L - 2 * RUNE.END) / RUNE.STEP) + 1;
      if (L < 2 * RUNE.END + .2 || n < 1) continue;
      const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L, s0 = (L - (n - 1) * RUNE.STEP) / 2;
      for (let k = 0; k < n; k++){
        const s = s0 + k * RUNE.STEP, x = a[0] + tx * s, z = a[1] + tz * s;
        if (isles.some((J, jj) => jj !== ii && J.group === I.group && outOf(plat[jj], x + tz * .05, z - tx * .05) === 0)) continue;
        let slot = -1, best = Infinity;
        for (const [sl, r] of own){ const d = rectDist(r, x, z); if (d < best - 1e-9){ best = d; slot = sl; } }
        out.push({ x, z, tx, tz, nx: tz, nz: -tx, g: glyphOf(x, z), slot, isle: ii });
      }
    }
  });
  return out;
}

/** CRYSTALS: up to CRYSTAL.PER shards per machine, hovering CRYSTAL.OUT off its own stretch of rim — at
    its island's edge, or just under its deck when it stands high — clear of everything (see the header):
    [{ x, y, z, r, slot, phase, tilt, spin }] */
export function crystalSpots(isles, anchors, plan = null){
  const ms = machinesOf(anchors), F = plan?.floor ?? -5.5, out = [];
  const solids = (anchors || []).filter(a => a && Array.isArray(a.box)).map(a => a.box);
  const env = plan ? footingBoxes(plan).map(e => e.box) : [];
  const boxGap = (b, x, y0, y1, z) => Math.hypot(Math.max(b[0] - x, 0, x - b[1]), Math.max(b[4] - z, 0, z - b[5]), Math.max(b[2] - y1, 0, y0 - b[3]));
  isles.forEach((I, ii) => {
    if (!I.slots.length) return;
    const H = I.hull, own = I.slots.map(s => [s, rectOf(ms[s])]);
    // rim samples, each owned by its nearest machine
    const samples = [];
    for (let i = 0; i < H.length; i++){
      const a = H[i], b = H[(i + 1) % H.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L, n = Math.max(1, Math.floor(L / .5));
      for (let k = 0; k < n; k++){
        const s = (k + .5) * L / n, x = a[0] + tx * s, z = a[1] + tz * s;
        let slot = -1, best = Infinity;
        for (const [sl, r] of own){ const d = rectDist(r, x, z); if (d < best - 1e-9){ best = d; slot = sl; } }
        samples.push({ x, z, nx: tz, nz: -tx, slot, d: best });
      }
    }
    for (const sl of I.slots){
      const a = ms[sl], mine = samples.filter(s => s.slot === sl).sort((p, q) => p.d - q.d || p.x - q.x || p.z - q.z), got = [];
      const raised = Number.isFinite(a.bottom) && a.bottom - F > 2.5;
      for (const s of mine){
        if (got.length >= CRYSTAL.PER) break;
        if (got.some(g => Math.hypot(g.x - s.x, g.z - s.z) < CRYSTAL.SEP)) continue;
        const h = hash2(s.x, s.z, 3), out_ = CRYSTAL.OUT + .5 * h, x = s.x + s.nx * out_, z = s.z + s.nz * out_;
        const r = CRYSTAL.R * (.75 + .5 * hash2(s.x, s.z, 5));
        const y = raised ? a.bottom - 1.3 - 1.4 * hash2(s.x, s.z, 7) : F + .35 + .9 * hash2(s.x, s.z, 7);
        const y0 = y - r * 1.6, y1 = y + r * 1.6 + .45;                           // (its body, + how high a strike lifts it)
        if (solids.some(b => boxGap(b, x, y0, y1, z) < CRYSTAL.CLEAR + r)) continue;
        if (env.some(b => boxGap(b, x, y0, y1, z) < CRYSTAL.CLEAR + r)) continue;
        if (isles.some((J, jj) => jj !== ii && outOf(J.hull, x, z) < r + .5)) continue;
        got.push({ x, y, z, r, slot: sl, phase: hash2(s.x, s.z, 11), tilt: (hash2(s.x, s.z, 13) - .5) * .5, spin: hash2(s.x, s.z, 17) * Math.PI * 2 });
      }
      out.push(...got);
    }
  });
  return out.slice(0, CRYSTAL.MAX);
}

/** how close any crystal comes to a machine's solid box or a support's envelope (the test's audit) */
export function crystalClearance(spots, anchors, plan){
  const env = plan ? footingBoxes(plan).map(e => e.box) : [];
  const solids = (anchors || []).filter(a => a && Array.isArray(a.box)).map(a => a.box);
  let worst = Infinity;
  for (const c of spots){
    const y0 = c.y - c.r * 1.6, y1 = c.y + c.r * 1.6 + .45;
    for (const b of [...solids, ...env]){
      const d = Math.hypot(Math.max(b[0] - c.x, 0, c.x - b[1]), Math.max(b[4] - c.z, 0, c.z - b[5]), Math.max(b[2] - y1, 0, y0 - b[3])) - c.r;
      worst = Math.min(worst, d);
    }
  }
  return worst;
}
/* SKY ROCKS — a hung machine whose suspension reaches the room's ceiling (its box tops out there: the
   chandelier's three rods) and that stands on no island hangs from a piece of CEILING set adrift: an
   island turned over, its dressed-stone soffit exactly where the rods end, its keel pointing up. Wide
   enough that the rods' ends (≤ .55 of its half-width out: ricochet/index.js) land well inside it.
   → island records (as voidIslands', no machines) + sky: the soffit's height, depthK: a shallower keel */
export const SKY = { REACH: .25, PAD: 1.6, MIN_R: 3, SIDES: 9, DEPTH: .55 };
export function skyRocks(anchors, { ceil = 36, floor = -5.5 } = {}){
  const out = [];
  for (const a of anchors || []){
    if (!a || a.kind !== 'hung' || !Array.isArray(a.box) || a.box[3] < ceil - SKY.REACH || a.box[2] <= floor + .5) continue;
    const R = Math.max(SKY.MIN_R, .55 * Math.max(a.w, a.d) / 2 + SKY.PAD), ph = hash2(a.x, a.z, 81) * Math.PI * 2, pts = [];
    for (let k = 0; k < SKY.SIDES; k++){
      const t = ph + k / SKY.SIDES * Math.PI * 2, r = R * (.94 + .12 * hash2(a.x + k, a.z - k, 83));
      pts.push([a.x + Math.cos(t) * r, a.z + Math.sin(t) * r]);
    }
    const H = hull(pts);
    out.push({ keys: [a.key], machines: 0, slots: [], gslots: [], hull: H, rim: grown(H, ISLE.RIM), group: `sky:${a.key}`, ...centroid(H),
      sky: Math.min(a.box[3], ceil), depthK: SKY.DEPTH });
  }
  return out;
}
export { toWorld };
