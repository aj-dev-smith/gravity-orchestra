import { describe, it, expect } from 'vitest';
import { planFooting, footingBoxes, FOOT, groundOf } from '../src/rooms/footing.js';
import { buildFooting } from '../src/rooms/footing3d.js';
import { makePulse } from '../src/rooms/pulse.js';
import { STAGE } from '../src/rooms/common.js';
import { voidFootingStyle, makeVoidMats } from '../src/rooms/void-footing.js';
import { voidIslands, skyRocks, runeSpots, crystalSpots, crystalClearance, machinesOf, outOf, rectDist, sepGap, grown, ISLE, CRYSTAL } from '../src/rooms/void-isles.js';
import { islandGeometry, runeGeometry, runeSlots, litOf, crystalGeometry, fillCrystals, skyBoxes, CRYSTAL_MAX, QUIET, GROUND } from '../src/rooms/void-ground.js';
import { roomSolids } from '../src/shotrig.js';
import * as THREE from 'three';

/* THE VOID (src/rooms/void.js + void-footing.js + void-isles.js): what its machines stand on — stone that
   grows with height, written into the footing kit's merged slots, never outside the plan's envelopes —
   the islands under everything, the runes round them, the crystals that hover beside them. */

const FL = STAGE.FLOOR, ROOMB = { x0: -STAGE.HW, x1: STAGE.HW, z0: STAGE.BACK, z1: STAGE.FRONT };
const st = (key, x, z, w, d, h = FOOT.PLINTH, extra = {}) => ({ key, kind: 'station', label: key, color: '#88aaff', x, z, yaw: 0, w, d,
  y: FL + h, bottom: FL + h, low: FL + h, box: [x - w / 2, x + w / 2, FL + h, FL + h + 5, z - d / 2, z + d / 2],
  cue: [{ t: 1 + (key.length % 3), w: 1 }, { t: 6, w: .5 }], P: 20, start: -.6, fixed: false, ...extra });
/* (footing3d.test.js's crowd: every band, both lofts, stairs + ladders + a cage, a turned riser, an open stand,
   the organ loft hung over the floor) */
const CROWD = [
  { key: 'belt', kind: 'belt', color: '#ffaa55', x: 0, z: -1.17, yaw: 0, w: 21.74, d: 5.77, y: FL, bottom: FL, low: FL, box: [-10.87, 10.87, FL, 15.83, -4.05, 1.72], cue: [{ t: 3, w: 1 }], P: 20, start: -.6, fixed: true },
  { ...st('drums', 19, 19, 18, 5.5), kind: 'kit', color: '#ff8a3d' },
  st('bass', -20, 5, 11.7, 7.8), st('bells', 26, -10, 10.9, 6.85),
  st('dais', -27, 20, 10, 6, 2.4), st('plat', 0, 30, 10, 6, 5), st('platL', 20, 33, 10, 6, 8), st('tower', -20, -10, 12, 6, 14),
  st('g1', -10, -24, 12, 4, 19.33), st('g2', 4.5, -24, 12, 4, 19.33), st('m1', 28, 6, 8, 5, 6), st('m2', 28, -1, 8, 5, 6.2),
  st('yawed', -30, 32, 6, 4, 3, { yaw: .6 }),
  { ...st('tt', -6, 15, 14.2, 14.1, -1.29 - FL), low: -5.1, feet: [[-5.5, -4.5, .7], [5.5, -4.5, .7], [-5.5, 4.5, .7], [5.5, 4.5, .7]], hang: [-6.25, 4.35, 4.8, 5.7] },
  { key: 'organ', kind: 'hung', x: 0, z: -13.65, yaw: 0, w: 13.16, d: 4.64, y: 16, box: [-6.58, 6.58, FL, 24.54, -15.97, -11.33], cue: [], P: 20, start: -.6, fixed: true },
];
const PLAN = planFooting(CROWD, { floor: FL, room: ROOMB }), ENV = footingBoxes(PLAN);
const MATS = makeVoidMats(), STYLE = voidFootingStyle(MATS);
const build = (plan = PLAN, boxes = ENV) => buildFooting(plan, STYLE, { boxes });
const meshes = f => { const out = []; f.group.traverse(o => { if (o.isMesh) out.push(o); }); return out; };
/* the farthest any vertex of a footing lies outside the plan's envelopes (and how deep anything digs) */
function worstOut(f, env){
  const B = env.map(e => e.box);
  let worst = 0, at = null, name = '';
  for (const m of meshes(f)){
    const p = m.geometry.attributes.position.array;
    for (let i = 0; i < p.length; i += 3){
      const x = p[i], y = Math.max(p[i + 1], FL), z = p[i + 2];
      if (p[i + 1] < FL - .2) return { worst: Infinity, at: [x, p[i + 1], z], name: m.name };
      let d = Infinity;
      for (const b of B) d = Math.min(d, Math.hypot(Math.max(b[0] - x, 0, x - b[1]), Math.max(b[2] - y, 0, y - b[3]), Math.max(b[4] - z, 0, z - b[5])));
      if (d > worst){ worst = d; at = [x, y, z]; name = m.name; }
    }
  }
  return { worst, at, name };
}
/* a machine lifted u above its ground (as main anchors it) */
const lifted = (key, w, d, u, extra = {}) => { const g = groundOf(0, FL); return { ...st(key, 0, 12, w, d), y: g + u, bottom: g + u, low: g + u, lift: u, ...extra }; };
const ttAt = u => ({ ...st('turntable', 0, 12, 14.22, 14.12, -1.29 - FL + u), y: -.93 + u, ground: -.93, lift: u, low: -5.1 + u,
  feet: [[-5.5, -4.5, .7], [5.5, -4.5, .7], [-5.5, 4.5, .7], [5.5, 4.5, .7]], hang: [-6.25, 4.35, 4.8, 5.7] });
const kitAt = u => ({ ...lifted('drums', 18, 5.5, u), kind: 'kit', low: groundOf(0, FL) + u - .335, bottom: groundOf(0, FL) + u });
const LIFTS = [0, .5, 1.4, 2.5, 3.5, 5, 8, 10, 12, 16, 20, 24];

describe('the Void\'s footing (void-footing.js): stone that grows with height', () => {
  it('the crowd covers every band, an open stand, both lofts, a stair, a ladder and a cage', () => {
    const bands = new Set(PLAN.pads.map(p => p.open ? 'open' : p.band));
    for (const b of ['flush', 'low', 'mid', 'high', 'open']) expect(bands.has(b), b).toBe(true);
    expect(PLAN.lofts.map(L => L.band).sort()).toEqual(['high', 'mid']);
    const acc = [...PLAN.pads, ...PLAN.lofts].filter(p => p.access).map(p => p.access.kind);
    expect(acc).toContain('stair'); expect(acc).toContain('ladder');
  });
  it('one draw per slot — rock, stone, crystal, light, runes — every mesh tagged as footing, the runes in the room\'s own light', () => {
    const f = build(), M = meshes(f);
    expect(M.map(m => m.name).sort()).toEqual(['footing:base', 'footing:deck', 'footing:edge', 'footing:glow', 'footing:haze']);
    for (const m of M) expect(m.userData.footing, m.name).toBe(true);
    const mat = n => M.find(m => m.name === 'footing:' + n).material;
    expect(mat('base')).toBe(MATS.rock); expect(mat('deck')).toBe(MATS.stone); expect(mat('glow')).toBe(MATS.glow);
    expect(mat('haze')).toBe(MATS.haze); expect(mat('edge')).toBe(MATS.rune);
    expect(f.group.children.length).toBeLessThanOrEqual(6);                       // (+ the style's one empty marker)
    f.dispose();
  });
  it('everything it draws stays inside the plan\'s envelopes (what the shot solve, the glide test and XR treat as solid)', () => {
    const f = build(), r = worstOut(f, ENV);
    expect(r.worst, `${r.name}: ${r.worst.toFixed(3)} u out at ${r.at && r.at.map(v => v.toFixed(2))}`).toBeLessThanOrEqual(.035);
    f.dispose();
  });
  it('every band at every lift (0 … 24 u): a small machine, a wide one, the kit (its well), the turntable (open) — inside its envelopes', () => {
    for (const u of LIFTS) for (const a of [lifted('bells', 6, 4, u), lifted('marimba', 13, 7, u, { yaw: .4 }), kitAt(u), ttAt(u)]){
      const plan = planFooting([a], { floor: FL, room: ROOMB }), env = footingBoxes(plan), f = build(plan, env), r = worstOut(f, env);
      expect(r.worst, `${a.key} lift ${u} (${plan.pads[0].band}${plan.pads[0].open ? ' open' : ''}): ${r.name} ${r.worst.toFixed(3)} out at ${r.at && r.at.map(v => v.toFixed(2))}`).toBeLessThanOrEqual(.035);
      // a raised pad keeps its way up (an open stand at its own height: its posts are its legs)
      const p = plan.pads[0];
      if (p.band !== 'flush' && (!p.open || p.lift > FOOT.CLIMB)) expect(p.access, `${a.key} lift ${u}: a way up`).toBeTruthy();
      f.dispose();
    }
  });
  it('each merged mesh carries the envelopes of the supports it has parts in; every support is drawn', () => {
    const f = build(), all = new Set(ENV.map(e => e.box)), seen = new Set();
    for (const m of meshes(f)) if (m.name !== 'footing:edge'){
      expect(m.userData.boxes.length, m.name).toBeGreaterThan(0);
      for (const b of m.userData.boxes){ expect(all.has(b), m.name).toBe(true); seen.add(b); }
    }
    for (const e of ENV) expect(seen.has(e.box), `${e.kind} ${e.unit}`).toBe(true);
    f.dispose();
  });
  it('every face looks out: its winding agrees with its normal', () => {
    const f = build();
    for (const m of meshes(f)){
      const g = m.geometry, p = g.attributes.position.array, n = g.attributes.normal?.array, I = g.index.array;
      if (!n) continue;
      let bad = 0, tot = 0;
      for (let t = 0; t < I.length; t += 3){
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, L = Math.hypot(cx, cy, cz);
        if (L < 1e-9) continue;
        tot++; if ((cx * n[a] + cy * n[a + 1] + cz * n[a + 2]) / L < .9) bad++;          // (rock quads are a hair out of plane)
      }
      expect(bad, `${m.name}: ${bad} of ${tot}`).toBe(0);
    }
    f.dispose();
  });
  it('the runes are the machine\'s own light: a pure fn of songTime, one slot per pad, dark in the count-in', () => {
    const f = build(), edge = meshes(f).find(m => m.name === 'footing:edge'), U = edge.material.uniforms.uPulse.value;
    const P = PLAN.pulses.map(s => makePulse(s.cue, { P: s.P, start: s.start }));
    const read = t => { f.update(t); return Array.from(U.slice(0, P.length)); };
    for (const t of [-2.4, 1.05, 3.2, 6.1, 27.3]){ const got = read(t); P.forEach((p, i) => expect(got[i], `slot ${i} @${t}`).toBeCloseTo(Math.min(1, p.at(t) + .35 * p.next(t)), 6)); }
    expect(read(-2.4).every(v => v === 0)).toBe(true);
    const a = read(14.2); read(3); expect(read(14.2)).toEqual(a);
    const k = edge.geometry.attributes.aPulse.array, slots = new Set(PLAN.pads.map(p => p.pulse));
    for (const v of k) expect(slots.has(v)).toBe(true);
    // every raised machine carries runes (a flush one's light is its island's rim: void.js)
    for (const p of PLAN.pads.filter(p => p.band !== 'flush')) expect(Array.from(k).includes(p.pulse), p.key).toBe(true);
    f.dispose();
  });
  it('the kit dips into its deck: every support is solid at least its well deep under it', () => {
    const crossing = (m, x, z) => {
      const a = m.geometry.attributes.position.array, I = m.geometry.index.array, out = [];
      for (let t = 0; t < I.length; t += 3){
        const [p, q, r] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
        const d = (a[q] - a[p]) * (a[r + 2] - a[p + 2]) - (a[r] - a[p]) * (a[q + 2] - a[p + 2]);
        if (Math.abs(d) < 1e-12) continue;
        const u = ((x - a[p]) * (a[r + 2] - a[p + 2]) - (a[r] - a[p]) * (z - a[p + 2])) / d, v = ((a[q] - a[p]) * (z - a[p + 2]) - (x - a[p]) * (a[q + 2] - a[p + 2])) / d;
        if (u >= 0 && v >= 0 && u + v <= 1) out.push(a[p + 1] + u * (a[q + 1] - a[p + 1]) + v * (a[r + 1] - a[p + 1]));
      }
      return out;
    };
    for (const u of [0, 2, 6, 14]){
      const plan = planFooting([kitAt(u)], { floor: FL, room: ROOMB }), q = plan.pads[0], f = build(plan, footingBoxes(plan));
      expect(q.well).toBeCloseTo(.335, 6);
      // straight down from the top through the stone: the first surface under the top is at least the well deep
      const ys = meshes(f).filter(m => m.name === 'footing:deck').flatMap(m => crossing(m, q.x + .37, q.z - .21)).filter(y => y < q.top - 1e-6).sort((a, b) => b - a);
      const under = ys.length ? ys[0] : -Infinity;
      expect(q.top - under, `${q.band}: solid ${(q.top - under).toFixed(3)} under its top`).toBeGreaterThanOrEqual(q.well + .03);
      f.dispose();
    }
  });
  it('a lone gallery tower and the gallery loft are levitating stacks under a stone deck — no steel', () => {
    const f = build(), M = meshes(f);
    expect(M.some(m => m.name === 'footing:steel')).toBe(false);
    // the glow slot carries the stacks' cushions of light: something glows between the floor and every high deck
    const glow = M.find(m => m.name === 'footing:glow').geometry.attributes.position.array;
    for (const P of [...PLAN.pads.filter(p => p.band === 'high' && !p.loft), ...PLAN.lofts.filter(L => L.band === 'high')]){
      let n = 0;
      for (let i = 0; i < glow.length; i += 3) if (outOf([[P.x - P.hw, P.z - P.hd], [P.x + P.hw, P.z - P.hd], [P.x + P.hw, P.z + P.hd], [P.x - P.hw, P.z + P.hd]], glow[i], glow[i + 2]) < .01 && glow[i + 1] > FL + 2 && glow[i + 1] < P.top - 1) n++;
      expect(n, P.key || P.id).toBeGreaterThan(0);
    }
    f.dispose();
  });
  it('builds fast: the whole crowd in a few ms', () => {
    let ms = Infinity;
    for (let i = 0; i < 5; i++){ const t0 = performance.now(); const f = build(); ms = Math.min(ms, performance.now() - t0); f.dispose(); }
    expect(ms).toBeLessThan(25);                                                     // (warm ≈ 7 ms for this crowd; finale in the browser: __dev.footStats)
  });
});

describe('the Void\'s ground (void-isles.js): islands, runes, crystals', () => {
  const I = voidIslands(CROWD, PLAN);
  it('every machine and everything it stands on lies on ONE island; the organ\'s columns stand on one too (not a machine)', () => {
    const on = (r, what) => {
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const c = Math.cos(r.yaw || 0), s = Math.sin(r.yaw || 0); return [r.x + c * u * r.hw + s * v * r.hd, r.z - s * u * r.hw + c * v * r.hd]; });
      expect(Math.min(...I.map(isl => Math.max(...pts.map(([x, z]) => outOf(isl.hull, x, z))))), what).toBeLessThanOrEqual(1e-6);
    };
    for (const a of CROWD) on({ x: a.x, z: a.z, yaw: a.yaw, hw: a.w / 2, hd: a.d / 2 }, a.key);
    expect(I.reduce((n, isl) => n + isl.machines, 0)).toBe(CROWD.filter(a => a.kind !== 'hung').length);
    const organ = I.find(isl => isl.keys.includes('organ'));
    expect(organ).toBeTruthy();
    // a chandelier that never reaches the floor floats: no island
    const chand = { key: 'ricochet', kind: 'hung', x: 40, z: 40, yaw: 0, w: 10, d: 10, box: [35, 45, 17.7, 36, 35, 45] };
    expect(voidIslands([...CROWD, chand], PLAN).some(isl => isl.keys.includes('ricochet'))).toBe(false);
  });
  it('between LANDMASSES there is always a crack of void (≥ MERGE); the islands of one landmass overlap solidly (never a hairline crack)', () => {
    for (let i = 0; i < I.length; i++) for (let j = i + 1; j < I.length; j++){
      const g = sepGap(I[i].hull, I[j].hull), what = `${I[i].keys[0]} / ${I[j].keys[0]}: ${g.toFixed(2)}`;
      if (I[i].group === I[j].group){ if (g > -ISLE.OVER + .05){
        // (same landmass, not overlapping each other: joined THROUGH a third island)
        expect(I.some((K, k) => k !== i && k !== j && K.group === I[i].group && sepGap(K.hull, I[i].hull) <= -ISLE.OVER + .05), what).toBe(true);
      } }
      else expect(g, what).toBeGreaterThan(ISLE.MERGE - 1e-9);
    }
    // a landmass is drawn at one height (its islands' platforms coincide: no step, no z-fight); the crowd has several
    expect(new Set(I.map(i => i.group)).size).toBeGreaterThan(1);
    expect(I.length).toBeGreaterThan(new Set(I.map(i => i.group)).size);
  });
  it('the runes round every platform are lit by the NEAREST machine on its landmass (a pure fn of where they are) — none hidden under a neighbour', () => {
    const R = runeSpots(I, CROWD), ms = machinesOf(CROWD);
    expect(R.length).toBeGreaterThan(40);
    for (const r of R){
      const isl = I[r.isle];
      if (!isl.gslots.length){ expect(r.slot).toBe(-1); continue; }
      const d = s => rectDist({ x: ms[s].x, z: ms[s].z, yaw: ms[s].yaw || 0, hw: ms[s].w / 2, hd: ms[s].d / 2 }, r.x, r.z);
      for (const s of isl.gslots) expect(d(r.slot)).toBeLessThanOrEqual(d(s) + 1e-9);
      expect(outOf(grown(isl.hull, -ISLE.INSET), r.x, r.z)).toBeLessThan(1e-6);   // (on its platform's edge)
      for (const [j, J] of I.entries()) if (j !== r.isle && J.group === isl.group) expect(outOf(grown(J.hull, -ISLE.INSET), r.x + r.nx * .05, r.z + r.nz * .05)).toBeGreaterThan(0);
    }
    expect(runeSpots(voidIslands(CROWD, PLAN), CROWD)).toEqual(R);              // deterministic
  });
  it('crystals hover beside their machine\'s own stretch of rim — clear of every machine and support by CLEAR, off every other island', () => {
    const C = crystalSpots(I, CROWD, PLAN);
    expect(C.length).toBeGreaterThan(10);
    expect(crystalClearance(C, CROWD, PLAN)).toBeGreaterThanOrEqual(CRYSTAL.CLEAR - 1e-9);
    for (const c of C){
      const own = I.filter(isl => outOf(isl.hull, c.x, c.z) < c.r + .5);
      expect(own.length, 'off every island').toBe(0);
      expect(c.slot).toBeGreaterThanOrEqual(0);
    }
    // a raised machine's crystals hover near its deck, not 19 u under it
    const ms = machinesOf(CROWD), g1 = ms.findIndex(a => a.key === 'g1');
    for (const c of C.filter(c => c.slot === g1)) expect(ms[g1].bottom - c.y).toBeLessThan(3.5);
    expect(crystalSpots(voidIslands(CROWD, PLAN), CROWD, PLAN)).toEqual(C);     // deterministic
  });
});

describe('the Void\'s islands as built (void-ground.js): the floor contract, the runes\' light, the crystals', () => {
  const I = voidIslands(CROWD, PLAN), G = islandGeometry(I, { floor: FL }), lit = litOf(CROWD, I);
  const verts = g => { const p = g.attributes.position.array, out = []; for (let i = 0; i < p.length; i += 3) out.push([p[i], p[i + 1], p[i + 2]]); return out; };
  it('an island\'s top IS the floor (STAGE.FLOOR: the machines\' ground) — nothing of it rises above, its stone and rock stay inside its outline', () => {
    const top = FL;                                                               // (landmasses step DOWN a hair: none rises above)
    for (const v of verts(G.stone)) expect(v[1]).toBeLessThanOrEqual(top + 1e-6);
    for (const v of verts(G.rock)) expect(v[1]).toBeLessThanOrEqual(top - GROUND.FASC + 1e-6);
    // every vertex lies inside (or on) some island's outline
    for (const v of [...verts(G.stone), ...verts(G.rock)]) expect(Math.min(...I.map(i => outOf(i.hull, v[0], v[2])))).toBeLessThan(1e-4);
    // a landmass is one height; each island's top is a whole platform (its area ≥ its hull's inset)
    for (const i of I) expect(i.group).toBeGreaterThanOrEqual(0);
  });
  it('who lights the room: every standing machine (runeSpots\' slots), then the hung machine that stands on an island (the organ) — the last slot stays dark', () => {
    const ms = machinesOf(CROWD);
    expect(lit.slice(0, ms.length)).toEqual(ms);
    expect(lit.map(a => a.key)).toContain('organ');
    expect(lit.length).toBeLessThan(FOOT.MAX_PULSE);
    const R = runeSpots(I, CROWD), S = runeSlots(R, I, CROWD, lit);
    S.forEach((s, k) => {
      const isl = I[R[k].isle];
      if (R[k].slot >= 0) expect(s).toBe(R[k].slot);
      else expect(lit[s]?.key ?? 'quiet').toBe(isl.keys.find(key => lit.some(a => a.kind === 'hung' && a.key === key)) ?? 'quiet');
    });
    const { geometry } = runeGeometry(I, CROWD, lit, { floor: FL });
    expect(geometry.attributes.aPulse.count).toBeGreaterThan(0);
    for (const v of geometry.attributes.aPulse.array) expect(v === QUIET || (v >= 0 && v < lit.length)).toBe(true);
  });
  it('the crystals: one instanced draw, each tied to its machine\'s slot (or breathing only, hung under an island)', () => {
    const g = crystalGeometry(), { spots, count } = fillCrystals(g, I, CROWD, PLAN, lit, G.glints);
    expect(count).toBe(Math.min(CRYSTAL_MAX, spots.length + G.glints.length));
    expect(g.instanceCount).toBe(count);
    const A = g.attributes.iA.array, B = g.attributes.iB.array;
    for (let i = 0; i < count; i++){
      const mobile = B[i * 4 + 1];
      if (mobile) expect(A[i * 4 + 1]).toBeLessThan(lit.length); else expect(A[i * 4 + 1]).toBe(QUIET);
    }
    // the glints hang UNDER their islands (below the platform's slab)
    for (const q of G.glints) expect(q.y).toBeLessThan(FL - GROUND.FASC);
  });
});

describe('the Void\'s SKY ROCKS (void-isles.js skyRocks): a chandelier whose rods reach the ceiling hangs from an island turned over', () => {
  // (Daybreak's chandelier, as main anchors it: its three rods end at the ceiling, .55 of its canopy's radius out)
  const CH = { key: 'ricochet', kind: 'hung', color: '#8fe9ff', x: 0, z: -1.17, yaw: 0, w: 17.73, d: 17.73, y: 18.06, bottom: 17.72, low: 17.72,
    box: [-8.87, 8.87, 17.72, 36.03, -10.03, 7.7], cue: [{ t: 2, w: 1 }], P: 20, start: -.6, fixed: true };
  const A = [...CROWD, CH], CEIL = STAGE.CEIL, sky = skyRocks(A, { ceil: CEIL, floor: FL });
  it('only a hung machine reaching the ceiling and not the floor gets one: its soffit where the rods end, wide enough for them', () => {
    expect(sky.map(S => S.keys[0])).toEqual(['ricochet']);
    expect(sky[0].sky).toBe(CEIL);
    const soffit = grown(sky[0].hull, -(GROUND.INSET + GROUND.CH)), footR = CH.w / 2;
    for (let k = 0; k < 36; k++){
      const a = k / 36 * Math.PI * 2;
      expect(outOf(grown(soffit, -.3), CH.x + .55 * footR * Math.cos(a), CH.z + .55 * footR * Math.sin(a))).toBe(0);
    }
    expect(skyRocks([{ ...CH, box: [...CH.box.slice(0, 3), 30, ...CH.box.slice(4)] }], { ceil: CEIL, floor: FL })).toEqual([]);   // short of the ceiling
    expect(skyRocks(CROWD, { ceil: CEIL, floor: FL })).toEqual([]);                                                        // the organ stands on the floor
    expect(skyRocks(A, { ceil: CEIL, floor: FL })).toEqual(sky);                                                           // deterministic
    expect(voidIslands(A, PLAN)).toEqual(voidIslands(CROWD, PLAN));                     // not ground: the islands (and the staging audit's) are untouched
  });
  it('built: the island\'s own body turned over — nothing below its soffit, all inside its outline, every face still facing out; the floor\'s islands unchanged', () => {
    const I = voidIslands(A, PLAN), base = islandGeometry(I, { floor: FL }), G = islandGeometry(I.concat(sky), { floor: FL });
    let soffit = 0, keel = 0;
    for (const k of ['stone', 'rock']){
      const p0 = base[k].attributes.position.array, p = G[k].attributes.position.array, n = G[k].attributes.normal.array, idx = G[k].index.array;
      expect(Array.from(p.slice(0, p0.length))).toEqual(Array.from(p0));
      expect(idx.length).toBeGreaterThan(base[k].index.count);
      for (let t = base[k].index.count; t < idx.length; t += 3){
        const V = [idx[t], idx[t + 1], idx[t + 2]].map(v => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]);
        for (const v of V){ expect(v[1]).toBeGreaterThanOrEqual(CEIL - 1e-6); expect(outOf(sky[0].hull, v[0], v[2])).toBeLessThan(1e-4); }
        const u = V[1].map((x, j) => x - V[0][j]), w = V[2].map((x, j) => x - V[0][j]);
        const c = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], o = idx[t] * 3;
        expect(c[0] * n[o] + c[1] * n[o + 1] + c[2] * n[o + 2]).toBeGreaterThan(-1e-9);          // (a mirror turns faces inside out: the winding follows)
        if (k === 'stone' && n[o + 1] < -.99 && V.every(v => Math.abs(v[1] - CEIL) < 1e-6)) soffit++;
        if (k === 'rock' && n[o + 1] > .5) keel++;
      }
    }
    expect(soffit).toBeGreaterThan(0);                      // its dressed stone faces down, at the ceiling: the rods' ends meet it
    expect(keel).toBeGreaterThan(0);                        // its rock tapers up
    expect(G.glints).toEqual(base.glints);                  // nothing hangs off it
  });
  it('the shot solve sees the sky rock as its own box — never the island meshes\' floor-to-ceiling bounds (a narrow stage: the islands < 40 u)', () => {
    // (?solo=ricochet: the chandelier alone over a small belt island — one merged mesh holds both)
    const A1 = [CROWD[0], CH], I = voidIslands(A1, null), S1 = skyRocks(A1, { ceil: CEIL, floor: FL }), G = islandGeometry(I.concat(S1), { floor: FL });
    const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial();
    const boxes = skyBoxes(S1, FL);
    for (const k of ['stone', 'rock']){ const m = new THREE.Mesh(G[k], mat); m.userData.boxes = boxes; g.add(m); }
    const solids = roomSolids(g, FL);
    expect(solids.length).toBe(2);                                            // (one box per mesh that carries it)
    for (const s of solids){
      expect(s.box[2]).toBeGreaterThanOrEqual(CEIL - 1e-6);                   // its underside is the soffit: nothing of the stage is inside it
      expect(s.box[3] - s.box[2]).toBeLessThan(12);
    }
    const bare = new THREE.Group(); for (const k of ['stone', 'rock']) bare.add(new THREE.Mesh(G[k], mat));
    expect(roomSolids(bare, FL).some(s => s.box[2] < FL + 1 && s.box[3] > CEIL - 1)).toBe(true);   // (what it would be without them)
    expect(skyBoxes([], FL)).toEqual([]);
  });
  it('its runes run round its fascia, above the soffit, lit by the chandelier', () => {
    const I = voidIslands(A, PLAN).concat(sky), lit = litOf(A, I), R = runeSpots(I, A), S = runeSlots(R, I, A, lit);
    const k = lit.findIndex(a => a.key === 'ricochet');
    expect(k).toBeGreaterThanOrEqual(0);
    const mine = S.filter((_, i) => I[R[i].isle].sky != null);
    expect(mine.length).toBeGreaterThan(8);
    expect(new Set(mine)).toEqual(new Set([k]));
    const { geometry } = runeGeometry(I, A, lit, { floor: FL }), p = geometry.attributes.position.array, q = geometry.attributes.aPulse.array;
    let n = 0;
    for (let v = 0; v < q.length; v++) if (q[v] === k){
      n++; expect(p[v * 3 + 1]).toBeGreaterThan(CEIL + GROUND.CH - .05); expect(p[v * 3 + 1]).toBeLessThan(CEIL + GROUND.FASC + .05);
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe('the Void ground materials (wave 4: raised rock / stone walls catch the nebula)', () => {
  const chunk = THREE.ShaderLib.standard;
  const compile = m => { const sh = { uniforms: {}, vertexShader: chunk.vertexShader, fragmentShader: chunk.fragmentShader }; m.onBeforeCompile(sh); return sh; };
  it('rock: the under-glow AND the raised fill + rim, gated by height over the floor; stone: walls only', () => {
    const M = makeVoidMats({ floor: STAGE.FLOOR });
    const r = compile(M.rock), s = compile(M.stone);
    for (const sh of [r, s]){
      expect(sh.uniforms.uF.value).toBe(STAGE.FLOOR);
      expect(sh.vertexShader).toContain('vWy =');
      expect(sh.fragmentShader).toContain('smoothstep(uF +');                  // nothing at / under the island top changes
      expect(sh.fragmentShader).toMatch(/min\(abs\(dot\(normal, normalize\(vViewPosition\)\)\), 1\.\)/);   // (capped: no bloom blob)
    }
    expect(r.fragmentShader).toContain('uUnder');
    expect(s.fragmentShader).toContain('inverseTransformDirection(normal, viewMatrix).y');   // a stone TOP stays dark
    expect(M.rock.customProgramCacheKey()).not.toBe(M.stone.customProgramCacheKey());
    M.dispose();
  });
  it('the SKY ROCKS keep their old look: the raised gate closes under the ceiling, where every sky rock hangs', () => {
    const M = makeVoidMats({ floor: STAGE.FLOOR, ceil: STAGE.CEIL });
    for (const sh of [compile(M.rock), compile(M.stone)]){
      expect(sh.uniforms.uC.value).toBe(STAGE.CEIL);
      expect(sh.fragmentShader).toContain('(1. - smoothstep(uC - 3., uC - .5, vWy))');
    }
    // (a sky rock's built body lies at or above the ceiling — the 'built: … nothing below its soffit' test — past the close)
    M.dispose();
  });
});
