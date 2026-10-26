import { describe, it, expect } from 'vitest';
import os from 'node:os';
import * as THREE from 'three';
import { planFooting, footingBoxes, FOOT, accessRect } from '../src/rooms/footing.js';
import { buildFooting, makeFootingMats, DEFAULT_STYLE } from '../src/rooms/footing3d.js';
import { makePulse } from '../src/rooms/pulse.js';
import { STAGE } from '../src/rooms/common.js';
import { cathedralFooting, CATH, pointed } from '../src/rooms/cathedral-footing.js';
import { PROPS, CORONAS, CANDLE, obstaclesOf, placeCoronas, placePrickets, placeCandles, coronaClear, rectDist, dxz, dInf, ownDist, candleCue } from '../src/rooms/cathedral-props.js';

/* THE CATHEDRAL NAVE (src/rooms/cathedral*.js): what its machines stand on (STONE and OAK — a moulded
   plinth, a chancel dais, an arcaded tribune, clustered piers + a stair turret, a choir loft, stone
   colonnettes for an open stand), drawn inside the plan's envelopes in a handful of draws, its brass
   light a pure function of songTime. */

const FL = STAGE.FLOOR, ROOMB = { x0: -STAGE.HW, x1: STAGE.HW, z0: STAGE.BACK, z1: STAGE.FRONT };
const st = (key, x, z, w, d, h = FOOT.PLINTH, extra = {}) => ({ key, kind: 'station', label: key, color: '#88aaff', x, z, yaw: 0, w, d,
  y: FL + h, bottom: FL + h, low: FL + h, box: [x - w / 2, x + w / 2, FL + h, FL + h + 5, z - d / 2, z + d / 2],
  cue: [{ t: 1 + (key.length % 3), w: 1 }, { t: 6, w: .5 }], P: 20, start: -.6, fixed: false, ...extra });
/* (rooms' footing3d.test.js CROWD: every band, a loft per band, every access, an open stand, a hung loft) */
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
const STYLE = cathedralFooting();
const build = (plan = PLAN, ctx = {}) => buildFooting(plan, STYLE, { boxes: footingBoxes(plan), ...ctx });
const meshes = f => { const out = []; f.group.traverse(o => { if (o.isMesh) out.push(o); }); return out; };
/* how far a mesh's worst vertex lies outside the envelopes (0: inside) */
function outside(m, B){
  const p = m.geometry.attributes.position.array;
  let worst = 0, at = null;
  for (let i = 0; i < p.length; i += 3){
    const x = p[i], y = Math.max(p[i + 1], FL), z = p[i + 2];
    if (p[i + 1] < FL - .2) return { worst: Infinity, at: [x, p[i + 1], z] };
    let d = Infinity;
    for (const b of B) d = Math.min(d, Math.hypot(Math.max(b[0] - x, 0, x - b[1]), Math.max(b[2] - y, 0, y - b[3]), Math.max(b[4] - z, 0, z - b[5])));
    if (d > worst){ worst = d; at = [x, y, z]; }
  }
  return { worst, at };
}

describe('cathedral footing: stone and oak, drawn inside the plan', () => {
  it('the crowd covers every form: flush, low, mid, high, open, a mid and a high loft, stairs, ladders, a turret', () => {
    const bands = new Set(PLAN.pads.map(p => p.open ? 'open' : p.band));
    for (const b of ['flush', 'low', 'mid', 'high', 'open']) expect(bands.has(b), b).toBe(true);
    expect(PLAN.lofts.map(L => L.band).sort()).toEqual(['high', 'mid']);
    const acc = [...PLAN.pads, ...PLAN.lofts].filter(p => p.access);
    expect(acc.some(p => p.access.kind === 'stair')).toBe(true);
    expect(acc.some(p => p.access.kind === 'ladder' && p.top - FL > CATH.TURRET_MIN)).toBe(true);    // (a turret)
  });
  it('a handful of draws: limestone, oak, iron, brass, the turret glow + one for every machine\'s light — all tagged footing', () => {
    const f = build(), M = meshes(f);
    expect(M.length).toBeLessThanOrEqual(8);
    expect(f.group.children.length, 'no empty node per pad (footStats counts children as draws)').toBe(M.length);
    expect(M.map(m => m.name).sort()).toEqual(['footing:base', 'footing:brass', 'footing:deck', 'footing:edge', 'footing:glow'].sort());
    for (const m of M) expect(m.userData.footing, m.name).toBe(true);
    f.dispose();
  });
  it('everything it draws stays inside the plan\'s envelopes (the shot solve\'s boxes)', () => {
    const f = build(), B = ENV.map(e => e.box);
    for (const m of meshes(f)){
      const { worst, at } = outside(m, B);
      expect(worst, `${m.name}: ${worst.toFixed(3)} u out at ${at && at.map(v => v.toFixed(2))}`).toBeLessThanOrEqual(.035);
    }
    f.dispose();
  });
  it('…at every height a user may lift a small, a wide and a turned machine, the kit (its well), the turntable (an open stand) — and a pair that lofts', () => {
    for (const u of [0, .5, 1.4, 2.5, 3.5, 5, 8, 10, 12, 16, 20, 24]){
      const H = FOOT.PLINTH + u;
      const tt = { ...st('turntable', 22, 6, 14.22, 14.12, -1.29 - FL + u), y: -.93 + u, ground: -.93, lift: u, low: -5.1 + u,
        feet: [[-5.5, -4.5, .7], [5.5, -4.5, .7], [-5.5, 4.5, .7], [5.5, 4.5, .7]], hang: [-6.25, 4.35, 4.8, 5.7] };
      const plan = planFooting([CROWD[0], st('bells', 26, -14, 10.9, 6.85, H), st('wide', -22, 8, 13.02, 7, H, { yaw: .75 }),
        { ...st('drums', 6, 20, 18, 5.5, H), kind: 'kit', low: FL + H - .335 }, st('pairA', -14, -24, 12, 4, H), st('pairB', 0, -24, 12, 4, H + .3), tt],
        { floor: FL, room: ROOMB });
      expect(plan.pads.find(p => p.key === 'turntable').open, `lift ${u}: the turntable stands open`).toBe(true);
      const f = build(plan), B = footingBoxes(plan).map(e => e.box);
      for (const m of meshes(f)){
        const { worst, at } = outside(m, B);
        expect(worst, `lift ${u}: ${m.name} ${worst.toFixed(3)} u out at ${at && at.map(v => v.toFixed(2))}`).toBeLessThanOrEqual(.035);
      }
      if (u > .8) expect(plan.lofts.length, `lift ${u}: the pair shares a loft`).toBe(1);
      f.dispose();
    }
  });
  it('the limestone\'s TOPS are flagstones (the courses open on an up-facing face), not boards — same map, same draw', () => {
    const base = cathedralFooting().mats(null, {}).base;
    expect(base.customProgramCacheKey()).toBe('cathedral:flag-tops');
    const sh = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    base.onBeforeCompile(sh);
    expect(sh.vertexShader).toContain('vUp = objectNormal.y');
    expect(sh.fragmentShader).not.toContain('#include <map_fragment>');
    expect(sh.fragmentShader).toMatch(/vUp > \.5 \? vec2\(vMapUv\.x \+ \.37, vMapUv\.y \* \.34/);
  });
  it('every face looks out: its winding agrees with its normal', () => {
    const f = build();
    for (const m of meshes(f)){
      const g = m.geometry, p = g.attributes.position.array, n = g.attributes.normal?.array, I = g.index.array;
      if (!n) continue;
      let bad = 0;
      for (let t = 0; t < I.length; t += 3){
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, L = Math.hypot(cx, cy, cz);
        if (L > 1e-9 && (cx * n[a] + cy * n[a + 1] + cz * n[a + 2]) / L < .99) bad++;
      }
      expect(bad, m.name).toBe(0);
    }
    f.dispose();
  });
  it('the light is a pure fn of songTime: brass at rest, every pad\'s strip on its own slot, the count-in dark', () => {
    const f = build(), edge = meshes(f).find(m => m.name === 'footing:edge'), U = edge.material.uniforms.uPulse.value;
    const P = PLAN.pulses.map(s => makePulse(s.cue, { P: s.P, start: s.start }));
    for (const t of [-2.4, 1.05, 3.2, 6.1, 27.3]){
      f.update(t);
      P.forEach((p, i) => expect(U[i], `slot ${i} @${t}`).toBeCloseTo(Math.min(1, p.at(t) + .35 * p.next(t)), 6));
    }
    f.update(-2.4); expect(Array.from(U.slice(0, P.length)).every(v => v === 0)).toBe(true);
    // every standing machine has a light of its own (its slot is read by some strip)
    const slots = new Set(edge.geometry.attributes.aPulse.array);
    for (const p of PLAN.pads) expect(slots.has(p.pulse), p.key).toBe(true);
    f.dispose();
  });
  it('the kit lifted: every deck under it is solid at least its well deep', () => {
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
    for (const h of [FOOT.PLINTH, 2.4, 6, 14]){
      const p = planFooting([{ ...st('drums', 0, 12, 18, 5.5, h), kind: 'kit', low: FL + h - .335 }], { floor: FL, room: ROOMB }), q = p.pads[0];
      const f = build(p), stone = meshes(f).find(m => m.name === 'footing:base');
      if (q.band === 'flush' || q.band === 'low'){
        // a solid block from the floor up: what dips sinks into the stone
        const a = stone.geometry.attributes.position.array;
        let lo = Infinity; for (let i = 1; i < a.length; i += 3) lo = Math.min(lo, a[i]);
        expect(lo, q.band).toBeLessThanOrEqual(FL);
        expect(q.h, q.band).toBeGreaterThanOrEqual(q.well + .03);
      } else {
        // a deck on an arcade: its underside (the lowest stone over the air inside the arcade) at least the well under its top
        const ys = crossing(stone, q.x + .37, q.z - .21).filter(y => y < q.top + 1e-6 && y > FL + .05);
        expect(Math.max(...ys), `${q.band}: top`).toBeCloseTo(q.top, 5);
        const under = Math.min(...ys);
        expect(q.top - under, `${q.band}: deck ${(q.top - under).toFixed(3)} deep`).toBeGreaterThanOrEqual(q.well + .03);
      }
      f.dispose();
    }
  });
  it('an open stand (the turntable): a colonnette under every foot — nothing of it inside what hangs', () => {
    for (const u of [0, 2.5, 6, 14, 24]){
      const tt = { ...st('turntable', 0, 12, 14.22, 14.12, -1.29 - FL + u), y: -.93 + u, ground: -.93, lift: u, low: -5.1 + u,
        feet: [[-5.5, -4.5, .7], [5.5, -4.5, .7], [-5.5, 4.5, .7], [5.5, 4.5, .7]], hang: [-6.25, 4.35, 4.8, 5.7] };
      const p = planFooting([tt], { floor: FL, room: ROOMB }), q = p.pads[0], f = build(p);
      expect(q.open).toBe(true);
      const a = meshes(f).find(m => m.name === 'footing:base').geometry.attributes.position.array;
      for (const [fx, fz] of [[-5.5, 7.5], [5.5, 7.5], [-5.5, 16.5], [5.5, 16.5]]){
        let n = 0; for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i] - fx) < .9 && Math.abs(a[i + 2] - fz) < .9 && a[i + 1] > q.top - .3) n++;
        expect(n, `a head under the foot at ${fx}, ${fz} (lift ${u})`).toBeGreaterThan(0);
      }
      for (let i = 0; i < a.length; i += 3){
        const x = a[i], y = a[i + 1], z = a[i + 2];
        const inside = x > -6.25 + .05 && x < 4.35 - .05 && z > 16.8 + .05 && z < 17.7 - .05 && y > q.hangY + .05 && y < q.top - .3;
        expect(inside, `stone at ${[x, y, z].map(v => v.toFixed(2))} (lift ${u})`).toBe(false);
      }
      f.dispose();
    }
  });
  it('a tall climb is a turret inside its access rect: its ring + cap + lit slits, nothing past deck + rail', () => {
    const p = planFooting([st('tower', -20, -10, 12, 6, 14)], { floor: FL, room: ROOMB }), q = p.pads[0];
    expect(q.access).toMatchObject({ kind: 'ladder' });
    const f = build(p), R = accessRect(q, q.access), glow = meshes(f).find(m => m.name === 'footing:glow');
    expect(glow, 'the slits are lit').toBeTruthy();
    const g = glow.geometry.attributes.position.array, c = Math.cos(R.yaw), s = Math.sin(R.yaw);
    for (let i = 0; i < g.length; i += 3){                                         // (every slit's light lies in the turret's rect)
      const dx = g[i] - R.x, dz = g[i + 2] - R.z, lu = c * dx - s * dz, lv = s * dx + c * dz;
      expect(Math.abs(lu) <= R.hw + 1e-6 && Math.abs(lv) <= R.hd + 1e-6, `slit at ${g[i].toFixed(2)}, ${g[i + 2].toFixed(2)}`).toBe(true);
      expect(g[i + 1]).toBeLessThan(q.top);
    }
    f.dispose();
  });
  it('the pointed arch: equilateral at h = s√3, a semicircle at h = s', () => {
    const e = pointed(2, 2 * Math.sqrt(3)); expect(e.R).toBeCloseTo(4, 9); expect(e.xc).toBeCloseTo(2, 9);
    const c = pointed(1.5, 1.5); expect(c.R).toBeCloseTo(1.5, 9); expect(c.xc).toBeCloseTo(0, 9);
  });
  it('materials: made once per room, shared by every build, the room\'s to dispose (the footing never frees them)', () => {
    const style = cathedralFooting(), mats = makeFootingMats();
    const a = buildFooting(PLAN, style, { mats, boxes: ENV }), b = buildFooting(PLAN, style, { mats, boxes: ENV });
    const mat = (f, slot) => meshes(f).find(m => m.name === 'footing:' + slot).material;
    for (const slot of ['base', 'deck', 'brass', 'edge']) expect(mat(a, slot), slot).toBe(mat(b, slot));
    expect(mat(a, 'base')).not.toBe(mats.base);
    expect(mat(a, 'base').metalness).toBe(0);
    expect(mat(a, 'brass').metalness).toBeLessThanOrEqual(.55);
    let gone = 0; mat(a, 'base').addEventListener('dispose', () => gone++);
    a.dispose(); b.dispose(); expect(gone).toBe(0);
    style.dispose(); expect(gone).toBe(1);
  });
  it('fast: the crowd\'s footing rebuilds in a few ms — within a few × the default kit\'s (measured interleaved: suites share the CPU)', () => {
    const mats = makeFootingMats();
    for (let k = 0; k < 3; k++){ build(PLAN, { mats }).dispose(); buildFooting(PLAN, DEFAULT_STYLE, { mats, boxes: ENV }).dispose(); }
    const A = [], B = [];
    for (let k = 0; k < 15; k++){
      const a = build(PLAN, { mats }); A.push(a.ms); a.dispose();
      const b = buildFooting(PLAN, DEFAULT_STYLE, { mats, boxes: ENV }); B.push(b.ms); b.dispose();
    }
    // the FASTEST of each (a loaded machine stretches some runs, never shortens one: the min is the build's own cost)
    const a = Math.min(...A), b = Math.min(...B);
    expect(a / b, `best ${a.toFixed(2)} ms vs the kit's ${b.toFixed(2)}`).toBeLessThan(3.5);
    // (≈ 3–8 ms on a laptop; an absolute bound means nothing on a machine running nine suites at once)
    if (os.loadavg()[0] < os.cpus().length * .75) expect(a).toBeLessThan(60);
  });
});

/* ---- the props: clear of every machine and its footing by PROPS.CLEAR, a pure fn of the layout ---- */
const STAGE_RECT = { x0: -STAGE.HW, x1: STAGE.HW, z0: STAGE.BACK, z1: STAGE.FRONT };
const gapY = (a0, a1, b0, b1) => Math.max(b0 - a1, a0 - b1);                // (> 0: apart by that much)
function coronaGap([x, y, z], obs){
  let worst = Infinity;
  for (const { box: b } of obs){
    const d = dxz(x, z, b);
    // the ring: apart sideways, or above / below by CLEAR
    const ring = Math.max(d - PROPS.CORONA_R, gapY(y - PROPS.CORONA_DROP, y + PROPS.CORONA_UP, b[2], b[3]));
    // the chain (from the ring up to the vault): apart sideways, or the box entirely below the ring
    const chain = Math.max(d - .1, y - b[3]);
    worst = Math.min(worst, ring, chain);
  }
  return worst;
}
describe('cathedral props: coronas, prickets, candles — clear of the machines', () => {
  const OBS = obstaclesOf(CROWD, PLAN);
  it('the obstacles are every machine\'s box (hung ones too) and every footing envelope', () => {
    expect(OBS.length).toBe(CROWD.length + ENV.length);
    expect(OBS.some(o => o.key === 'organ')).toBe(true);
    expect(OBS.filter(o => o.foot).length).toBe(ENV.length);
  });
  it('coronas hang where they hang, unless something comes near — then raised, slid, or (never in a real layout) hidden', () => {
    const at = placeCoronas(OBS);
    at.forEach((c, i) => { expect(c, `corona ${i}`).not.toBe(null); expect(coronaGap(c, OBS), `corona ${i}`).toBeGreaterThanOrEqual(PROPS.CLEAR - 1e-9); });
    // a machine lifted right under the front-left corona: it rises above the machine (and stays clear)
    const tall = { ...st('tall', -34, 30, 8, 6, 26), box: [-38, -30, -5.5 + 26, 26.5, 27, 33] };
    const P2 = planFooting([...CROWD, tall], { floor: FL, room: ROOMB }), O2 = obstaclesOf([...CROWD, tall], P2), c2 = placeCoronas(O2);
    expect(c2[0][1], 'raised over it').toBeGreaterThan(CORONAS[0][1]);
    expect(coronaGap(c2[0], O2)).toBeGreaterThanOrEqual(PROPS.CLEAR - 1e-9);
    // a hung machine up through a corona's chain: it slides off (a hung box reaches the floor, so no height clears it)
    const hung = { key: 'chandelier', kind: 'hung', x: 34, z: -6, yaw: 0, w: 4, d: 4, y: 30, box: [32, 36, FL, 40, -8, -4], cue: [], P: 20, start: -.6, fixed: true };
    const O3 = obstaclesOf([...CROWD, hung], PLAN), c3 = placeCoronas(O3);
    expect(c3[3] === null || c3[3][0] !== CORONAS[3][0] || c3[3][2] !== CORONAS[3][2], 'slid').toBe(true);
    if (c3[3]) expect(coronaGap(c3[3], O3)).toBeGreaterThanOrEqual(PROPS.CLEAR - 1e-9);
    expect(coronaClear(...CORONAS[3], O3)).toBe(false);
  });
  it('prickets stand by the piers (outside the stage) — one a layout crowds slides along the nave', () => {
    const list = [[-40.5, 19], [40.5, 2]], ok = placePrickets(OBS, list, { floor: FL });
    expect(ok).toEqual(list);                                               // (nothing near: as they were)
    const near = [{ key: 'x', box: [38, 39.5, FL, 0, -1, 5] }];
    const moved = placePrickets(near, [[40.5, 2]], { floor: FL })[0];
    expect(moved[0]).toBe(40.5); expect(Math.abs(moved[1] - 2)).toBeGreaterThan(0);
    expect(dxz(moved[0], moved[1], near[0].box)).toBeGreaterThanOrEqual(.6 + PROPS.CLEAR);
  });
  it('two candlesticks beside every standing machine: clear of everything, of each other, inside the stage, nearer their own machine', () => {
    const avoid = [{ x: -40.5, z: 2, r: .6 }];
    const C = placeCandles(CROWD, PLAN, OBS, { room: STAGE_RECT, avoid, floor: FL });
    const standing = CROWD.filter(a => a.kind !== 'hung' && a.kind !== 'belt');
    const per = {}; for (const c of C) per[c.key] = (per[c.key] || 0) + 1;
    for (const a of standing) expect(per[a.key] || 0, a.key).toBeGreaterThanOrEqual(1);
    expect(Object.values(per).every(n => n <= PROPS.PER)).toBe(true);
    expect(C.filter(c => per[c.key] === 2).length).toBeGreaterThan(C.length * .7);   // (mostly pairs)
    expect(C.length).toBeLessThanOrEqual(PROPS.POOL);
    const slots = [...new Set(C.map(c => c.slot))].sort((a, b) => a - b);
    expect(slots).toEqual(slots.map((_, i) => i));                                 // (contiguous: a pulse each)
    expect(slots.length).toBeLessThanOrEqual(PROPS.MAX_SLOT);
    for (const c of C){
      expect(c.x >= STAGE_RECT.x0 + PROPS.STICK_R && c.x <= STAGE_RECT.x1 - PROPS.STICK_R && c.z >= STAGE_RECT.z0 + PROPS.STICK_R && c.z <= STAGE_RECT.z1 - PROPS.STICK_R, `${c.key} inside`).toBe(true);
      const mine = CROWD.find(a => a.key === c.key), myPad = PLAN.pads.find(p => p.key === c.key && !p.loft);
      for (const { key, box: b, foot, kind } of OBS){
        if (gapY(FL, FL + PROPS.STICK_H, b[2], b[3]) >= PROPS.CLEAR) continue;     // (well above it)
        // CLEAR from a support; an arm's length from a machine's box along x or z (STICK_CLEAR: what a box leaves
        // out — a record's pads — and the staging audit's box test: the stick's square misses the box grown by it).
        // Its OWN machine / pad / stair: the same, in that machine's frame (a turn swells their boxes over its flanks)
        const self = key === c.key;
        if (foot) expect(self && kind === 'pad' && myPad ? rectDist(myPad, c.x, c.z) : self && kind === 'access' && myPad?.access ? rectDist(accessRect(myPad, myPad.access), c.x, c.z) : dxz(c.x, c.z, b),
          `${c.key} candle vs ${key}`).toBeGreaterThanOrEqual(PROPS.STICK_R + PROPS.CLEAR - 1e-9);
        else expect(self ? ownDist({ x: mine.x, z: mine.z, yaw: mine.yaw, hw: mine.w / 2, hd: mine.d / 2 }, c.x, c.z) : dInf(c.x, c.z, b),
          `${c.key} candle vs ${key}`).toBeGreaterThanOrEqual(PROPS.STICK_R + PROPS.STICK_CLEAR - 1e-9);
      }
      for (const o of C) if (o !== c) expect(Math.hypot(o.x - c.x, o.z - c.z)).toBeGreaterThanOrEqual(2 * PROPS.STICK_R + PROPS.CLEAR - 1e-9);
      for (const a of avoid) expect(Math.hypot(a.x - c.x, a.z - c.z)).toBeGreaterThanOrEqual(a.r + PROPS.STICK_R + PROPS.CLEAR - 1e-9);
      // beside its own machine: nearer what it stands on than any other machine's box
      const own = CROWD.find(a => a.key === c.key), pad = PLAN.pads.find(p => p.key === c.key);
      const L = pad?.loft && PLAN.lofts.find(l => l.id === pad.loft);
      const dOwn = L ? Math.min(rectDist(pad, c.x, c.z), rectDist(L, c.x, c.z)) : rectDist(pad || { ...own, hw: own.w / 2, hd: own.d / 2 }, c.x, c.z);
      for (const b of CROWD) if (b !== own && b.kind !== 'hung') expect(dxz(c.x, c.z, b.box), `${c.key} nearer ${b.key}?`).toBeGreaterThan(dOwn);
    }
  });
  it('candles FLANK their machine (never between it and the audience), keep apart from a neighbour\'s, and leave a stair\'s landing clear', () => {
    const C = placeCandles(CROWD, PLAN, OBS, { room: STAGE_RECT, floor: FL });
    for (const c of C) for (const o of C) if (o.key !== c.key)
      expect(Math.hypot(o.x - c.x, o.z - c.z), `${c.key} vs ${o.key}`).toBeGreaterThanOrEqual(PROPS.STICK_APART - 1e-9);
    for (const c of C) for (const e of ENV) if (e.kind === 'access')
      expect(dxz(c.x, c.z, e.box), `${c.key} vs ${e.unit}'s stair / ladder`).toBeGreaterThanOrEqual(PROPS.STICK_R + PROPS.CLEAR + PROPS.LANDING - 1e-9);
    // a machine alone in the room, WHATEVER ITS YAW (a loneTurn grand, a user's turn): one stick on each of ITS
    // side faces, beside its front half (like altar candles — never off at its back corners, never out in front of
    // its front face), an arm's length from it in its own frame
    for (const yaw of [0, .55, -.6, .9, -1.2, Math.PI / 2, -Math.PI / 2, Math.PI]){
      const c = Math.cos(yaw), s = Math.sin(yaw), hx = 5 * Math.abs(c) + 3 * Math.abs(s), hz = 5 * Math.abs(s) + 3 * Math.abs(c);
      const lone = [{ ...st('solo', 0, 10, 10, 6), yaw, box: [-hx, hx, FL + .4, FL + 5.4, 10 - hz, 10 + hz] }];   // (its box: the turned rect's AABB)
      const P1 = planFooting(lone, { floor: FL, room: ROOMB });
      const L = placeCandles(lone, P1, obstaclesOf(lone, P1), { room: STAGE_RECT, floor: FL }), pad = P1.pads[0];
      expect(L.length, `yaw ${yaw}`).toBe(2);
      const loc = L.map(q => [c * (q.x - pad.x) - s * (q.z - pad.z), s * (q.x - pad.x) + c * (q.z - pad.z)]);
      expect(loc.every(([u]) => Math.abs(u) > pad.hw), `yaw ${yaw}: on its side faces`).toBe(true);
      expect(Math.sign(loc[0][0]), `yaw ${yaw}: on OPPOSITE faces`).toBe(-Math.sign(loc[1][0]));
      for (const [, v] of loc){ expect(v, `yaw ${yaw}: beside its front half`).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(pad.hd); }
      for (const q of L) expect(ownDist({ x: 0, z: 10, yaw, hw: 5, hd: 3 }, q.x, q.z)).toBeGreaterThanOrEqual(PROPS.STICK_R + PROPS.STICK_CLEAR - 1e-9);
    }
  });
  it('the candles\' cue: an event per strike — scaled to the machine\'s own loud hits, decaying within its own gap', () => {
    const P = 20, dense = Array.from({ length: 80 }, (_, i) => ({ t: i * .25, w: .3 + .1 * (i % 3) })), sparse = [{ t: 2, w: .4 }, { t: 9, w: .5 }];
    const d = candleCue(dense, P), sp = candleCue(sparse, P);
    expect(Math.max(...d.cue.map(c => c.w))).toBeCloseTo(1, 9);                   // (its own p90 → 1: a quiet part still answers)
    expect(d.decay).toBeCloseTo(Math.max(CANDLE.DECAY_MIN, CANDLE.GAP_K * .25), 9);
    expect(sp.decay).toBe(CANDLE.DECAY_MAX);
    expect(d.flash).toBeLessThan(d.decay);
    // between two strikes of a dense run the afterglow falls well below its peak (no plateau)
    const p = makePulse(d.cue, { P, start: -.6, decay: d.decay });
    expect(p.at(5.0 + .02)).toBeGreaterThan(.8 * p.at(5.0 + .005));
    expect(p.at(5.125)).toBeLessThan(.6 * p.at(5.0 + .005));
    expect(candleCue([], P).cue).toEqual([]);
    expect(candleCue(dense, P)).toEqual(d);                                       // (pure)
  });
  it('a pure fn of the layout: the same anchors + plan, the same props, whatever ran before', () => {
    const a = JSON.stringify([placeCoronas(OBS), placeCandles(CROWD, PLAN, OBS, { room: STAGE_RECT, floor: FL })]);
    placeCandles(CROWD.slice(3), planFooting(CROWD.slice(3), { floor: FL, room: ROOMB }));
    const b = JSON.stringify([placeCoronas(obstaclesOf(CROWD, PLAN)), placeCandles(CROWD, PLAN, obstaclesOf(CROWD, PLAN), { room: STAGE_RECT, floor: FL })]);
    expect(b).toBe(a);
  });
});
