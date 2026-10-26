import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { planFooting, footingBoxes, FOOT } from '../src/rooms/footing.js';
import { buildFooting, makeFootingMats } from '../src/rooms/footing3d.js';
import { STAGE } from '../src/rooms/common.js';
import { gridFootStyle } from '../src/rooms/grid-footing.js';
import { RIPPLE, strikeAges, rippleSlots, packColor, rippleExtra, makeRipples } from '../src/rooms/grid-floor.js';
import { PLOT, labelLines, labelSize, clearOf, placeLabels } from '../src/rooms/grid-plot.js';
import { layoutStations } from '../src/instruments/stations.js';
import fs from 'node:fs';

/* GREYBOX (src/rooms/grid.js + grid-footing.js + grid-floor.js + grid-plot.js): ROOM ZERO's footing drawn in the room's
   own language — graphite volumes carrying the floor's world grid, light lines — always inside the
   plan's envelopes, merged into a handful of draws. */

const FL = STAGE.FLOOR, ROOMB = { x0: -STAGE.HW, x1: STAGE.HW, z0: STAGE.BACK, z1: STAGE.FRONT };
const st = (key, x, z, w, d, h = FOOT.PLINTH, extra = {}) => ({ key, kind: 'station', label: key, color: '#88aaff', x, z, yaw: 0, w, d,
  y: FL + h, bottom: FL + h, low: FL + h, box: [x - w / 2, x + w / 2, FL + h, FL + h + 5, z - d / 2, z + d / 2],
  cue: [{ t: 1 + (key.length % 3), w: 1 }, { t: 6, w: .5 }], P: 20, start: -.6, fixed: false, ...extra });
/* every band (the footing3d test's crowd): the belt, the kit, plinths, a dais, platforms (stair / ladder), a tower,
   a gallery loft and a mid loft, a turned riser, an open stand, the organ loft hung over the floor — + a low loft */
const CROWD = [
  { key: 'belt', kind: 'belt', color: '#ffaa55', x: 0, z: -1.17, yaw: 0, w: 21.74, d: 5.77, y: FL, bottom: FL, low: FL, box: [-10.87, 10.87, FL, 15.83, -4.05, 1.72], cue: [{ t: 3, w: 1 }], P: 20, start: -.6, fixed: true },
  { ...st('drums', 19, 19, 18, 5.5), kind: 'kit', color: '#ff8a3d', low: FL + FOOT.PLINTH - .335 },
  st('bass', -20, 5, 11.7, 7.8), st('bells', 26, -10, 10.9, 6.85),
  st('dais', -27, 20, 10, 6, 2.4), st('plat', 0, 30, 10, 6, 5), st('platL', 20, 33, 10, 6, 8), st('tower', -20, -10, 12, 6, 14),
  st('g1', -10, -24, 12, 4, 19.33), st('g2', 4.5, -24, 12, 4, 19.33), st('m1', 28, 6, 8, 5, 6), st('m2', 28, -1, 8, 5, 6.2),
  st('yawed', -30, 32, 6, 4, 3, { yaw: .6 }), st('l1', 9, 12, 5, 4, 1.6), st('l2', 15, 12, 5, 4, 1.8),
  { ...st('tt', -6, 15, 14.2, 14.1, -1.29 - FL), low: -5.1, feet: [[-5.5, -4.5, .7], [5.5, -4.5, .7], [-5.5, 4.5, .7], [5.5, 4.5, .7]], hang: [-6.25, 4.35, 4.8, 5.7] },
  { key: 'organ', kind: 'hung', x: 0, z: -13.65, yaw: 0, w: 13.16, d: 4.64, y: 16, box: [-6.58, 6.58, FL, 24.54, -15.97, -11.33], cue: [], P: 20, start: -.6, fixed: true },
];
const PLAN = planFooting(CROWD, { floor: FL, room: ROOMB }), ENV = footingBoxes(PLAN);
const meshes = f => { const out = []; f.group.traverse(o => { if (o.isMesh) out.push(o); }); return out; };
const styled = () => { const s = gridFootStyle(); s.known(CROWD); return s; };
const build = (style = styled(), plan = PLAN, env = ENV) => buildFooting(plan, style, { boxes: env, mats: makeFootingMats() });

/* THE CATALOG as staged (test/fixtures/staging-rooms.json, re-solved + re-planned as test/staging-audit.test.js
   does): every song's anchors and footing plan — the real crowds the room must hold */
function catalog(){
  const FIX = JSON.parse(fs.readFileSync(new URL('./fixtures/staging-rooms.json', import.meta.url))).songs;
  const ROOM = { x0: -STAGE.HW + 2.5, x1: STAGE.HW - 2.5, z0: STAGE.BACK + 2.5, z1: 31 }, out = [];
  for (const R of FIX){
    const w = R.wall;
    if (!w) continue;
    const solved = R.items.length ? layoutStations(R.items.map(({ key, x, z, box, top }) => ({ key, x, z, box, top })), [w[0], w[1], w[4], w[5]], ROOM,
      { cx: R.cx, bandY: R.bandY, eyeY: 20, wallTop: w[3], hung: R.hung || (R.fixed || []).map(f => [f.box[0], f.box[1], f.box[4], f.box[5]]) }) : {};
    const anchors = [{ key: 'belt', kind: 'belt', label: 'Belt', color: '#ffaa55', x: (w[0] + w[1]) / 2, z: (w[4] + w[5]) / 2, yaw: 0, w: w[1] - w[0], d: w[5] - w[4], y: FL, bottom: FL, low: w[2], box: w, cue: [], fixed: true }];
    for (const it of R.items){
      const f = it.foot, p = solved[it.key];
      if (!f || !p) continue;
      const deck = p.y ?? f.deck, up = p.y === undefined ? 0 : p.y - (it.deck ?? 0);
      anchors.push({ key: it.key, kind: it.key === 'drums' ? 'kit' : 'station', label: it.key, color: '#88aaff', x: p.x + f.dx, z: p.z + f.dz, yaw: f.yaw, w: f.w, d: f.d,
        y: deck, bottom: deck + f.bot, low: deck + f.low, box: [p.x + it.box[0], p.x + it.box[1], it.y0 + up, it.top + up, p.z + it.box[2], p.z + it.box[3]], feet: f.feet, hang: f.hang, cue: [], fixed: false });
    }
    for (const h of R.fixed || []) anchors.push({ key: h.key, kind: 'hung', x: (h.box[0] + h.box[1]) / 2, z: (h.box[4] + h.box[5]) / 2, yaw: 0, w: h.box[1] - h.box[0], d: h.box[5] - h.box[4], box: h.box, cue: [], fixed: true });
    out.push({ song: R.song, anchors, plan: planFooting(anchors, { floor: FL, room: ROOMB }) });
  }
  return out;
}

/* how far a mesh's vertices stray outside the envelopes (or under the floor) */
function worstOut(m, B){
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

describe('Greybox footing: the plan, drawn in the room\'s own language', () => {
  it('the crowd covers every form (incl. a low loft, a caged ladder, a stair on a riser)', () => {
    const bands = new Set(PLAN.pads.map(p => p.open ? 'open' : p.band));
    for (const b of ['flush', 'low', 'mid', 'high', 'open']) expect(bands.has(b), b).toBe(true);
    expect(PLAN.lofts.map(L => L.band).sort()).toEqual(['high', 'low', 'mid']);
    const acc = [...PLAN.pads, ...PLAN.lofts].filter(p => p.access);
    expect(acc.some(p => p.access.kind === 'stair' && p.band === 'low')).toBe(true);
    expect(acc.some(p => p.access.kind === 'stair' && p.band === 'mid')).toBe(true);
    expect(acc.some(p => p.access.cage)).toBe(true);
  });
  it('a handful of draws: graphite, two light lines, glass + the machines\' edge — every mesh tagged footing', () => {
    const f = build(), M = meshes(f);
    expect(M.map(m => m.name).sort()).toEqual(['footing:deck', 'footing:edge', 'footing:gglass', 'footing:gline', 'footing:glace'].sort());
    for (const m of M) expect(m.userData.footing, m.name).toBe(true);
    expect(f.group.children.filter(c => !c.isMesh).length).toBeLessThanOrEqual(1);       // (the hooks' one shared empty group)
    f.dispose();
  });
  it('everything it draws stays inside the plan\'s envelopes (a nosing\'s hair; feet buried in the floor)', () => {
    const f = build(), B = ENV.map(e => e.box);
    for (const m of meshes(f)){
      const { worst, at } = worstOut(m, B);
      expect(worst, `${m.name}: ${worst.toFixed(3)} u out at ${at && at.map(v => v.toFixed(2))}`).toBeLessThanOrEqual(.035);
    }
    f.dispose();
  });
  it('the catalog (every staged song, re-planned): everything drawn inside its envelopes, ≤ 6 children', () => {
    const s = gridFootStyle(), mats = makeFootingMats();
    for (const { song, anchors, plan } of catalog()){
      s.known(anchors);
      const env = footingBoxes(plan), f = buildFooting(plan, s, { boxes: env, mats }), B = env.map(e => e.box);
      expect(f.group.children.length, song).toBeLessThanOrEqual(6);
      for (const m of meshes(f)){
        const { worst, at } = worstOut(m, B);
        expect(worst, `${song} ${m.name}: ${worst.toFixed(3)} u out at ${at && at.map(v => v.toFixed(2))}`).toBeLessThanOrEqual(.035);
      }
      f.dispose();
    }
    s.dispose();
  });
  it('lifted (every machine raised 1.6 / 6 / 14 u — risers, platforms, towers, lofts of real neighbours): still inside', () => {
    const s = gridFootStyle(), mats = makeFootingMats(), bands = new Set();
    for (const { song, anchors } of catalog().filter(c => ['daybreak-engine', 'finale', 'bald-mountain', 'campfire'].includes(c.song))) for (const u of [1.6, 6, 14]){
      const up = anchors.map(a => a.kind === 'station' || a.kind === 'kit'
        ? { ...a, y: a.y + u, bottom: a.bottom + u, low: a.low + u, box: [a.box[0], a.box[1], a.box[2] + u, a.box[3] + u, a.box[4], a.box[5]] } : a);
      const plan = planFooting(up, { floor: FL, room: ROOMB }), env = footingBoxes(plan), B = env.map(e => e.box);
      plan.pads.forEach(p => bands.add(p.open ? 'open-' + p.band : p.band)); plan.lofts.forEach(L => bands.add('loft-' + L.band));
      s.known(up);
      const f = buildFooting(plan, s, { boxes: env, mats });
      for (const m of meshes(f)){
        const { worst, at } = worstOut(m, B);
        expect(worst, `${song} +${u}: ${m.name} ${worst.toFixed(3)} u out at ${at && at.map(v => v.toFixed(2))}`).toBeLessThanOrEqual(.035);
      }
      f.dispose();
    }
    for (const b of ['low', 'mid', 'high', 'open-mid', 'open-high', 'loft-mid', 'loft-high']) expect(bands.has(b), b).toBe(true);
    s.dispose();
  });
  it('the shot solve sees every support: an OPAQUE standard mesh carries every envelope', () => {
    const f = build(), body = meshes(f).find(m => m.name === 'footing:deck');
    expect(body.material.isMeshStandardMaterial).toBe(true);
    expect(body.material.transparent).toBe(false);
    const all = new Set(body.userData.boxes);
    for (const e of ENV) expect(all.has(e.box), `${e.kind} ${e.unit}`).toBe(true);
    f.dispose();
  });
  it('every face looks out: winding agrees with its normal', () => {
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
  it('the materials are the room\'s: made once, shared by every build, never freed by a footing', () => {
    const s = styled(), a = build(s), b = build(s);
    const mat = (f, n) => meshes(f).find(m => m.name === 'footing:' + n).material;
    for (const n of ['deck', 'gline', 'glace', 'gglass']) expect(mat(a, n)).toBe(mat(b, n));
    let gone = 0; mat(a, 'deck').addEventListener('dispose', () => gone++);
    a.dispose(); b.dispose(); expect(gone).toBe(0);
    s.dispose(); expect(gone).toBe(1);
  });
  it('fast: the crowd\'s footing builds in a few ms', () => {
    const s = styled(), mats = makeFootingMats();
    for (let k = 0; k < 3; k++) buildFooting(PLAN, s, { boxes: ENV, mats }).dispose();
    const ms = [];
    for (let k = 0; k < 7; k++){ const f = buildFooting(PLAN, s, { boxes: ENV, mats }); ms.push(f.ms); f.dispose(); }
    ms.sort((a, b) => a - b);
    expect(ms[3], `median ${ms[3].toFixed(2)} ms`).toBeLessThan(20);
  });
});

/* THE FLOOR ANSWERS (grid-floor.js): rings + cells, a pure fn of songTime */
describe('Greybox floor: a strike rings out across the grid', () => {
  const P = 20, CUE = [{ t: 2, w: 1 }, { t: 2.5, w: .4 }, { t: 9, w: .8 }, { t: 19.5, w: .6 }];
  /* the reference: every strike of every loop at or after start, newest first */
  const brute = (cue, t, start, depth = 2) => {
    const all = [];
    for (let k = -3; k <= 3; k++) for (const c of cue){ const s = c.t + k * P; if (s <= t && s >= start) all.push([t - s, c.w]); }
    all.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (let k = 0; k < depth; k++) out.push(...(all[k] || [RIPPLE.AGE_NONE, 0]));
    return out;
  };
  it('strikeAges: the last two strikes, newest first — across the loop seam, nothing before start', () => {
    const f = strikeAges(CUE, { P, start: -.6 }), out = new Float64Array(4);
    for (const t of [-2.4, -.7, -.1, 0, 1.99, 2, 2.2, 2.6, 8, 9.3, 19.4, 19.6, 20.1, 21.9, 22.3, 39.7, 55.5]){
      f(t, out);
      const ref = brute(CUE, t, -.6);
      for (let k = 0; k < 4; k++) expect(out[k], `t ${t} [${k}]`).toBeCloseTo(ref[k], 9);
    }
    f(20.1, out);                                       // just past the seam: the loop's last strike, then the one before it
    expect(out[0]).toBeCloseTo(.6, 9); expect(out[1]).toBe(.6); expect(out[2]).toBeCloseTo(11.1, 9); expect(out[3]).toBe(.8);
  });
  it('strikeAges: the count-in is dark, a lone strike rings once a loop, the result lands at an offset', () => {
    const f = strikeAges(CUE, { P, start: -.6 }), out = new Float64Array(8).fill(-1);
    f(-1, out, 2);
    expect(Array.from(out)).toEqual([-1, -1, RIPPLE.AGE_NONE, 0, RIPPLE.AGE_NONE, 0, -1, -1]);
    f(2.1, out, 2);                                    // the loop's last strike wrapped to −.5: after start (−.6), so it rang
    expect(out[2]).toBeCloseTo(.1, 9); expect(out[4]).toBeCloseTo(2.6, 9);
    strikeAges(CUE, { P, start: 0 })(2.1, out, 2);     // with start 0 it never happened: no "previous"
    expect(out[2]).toBeCloseTo(.1, 9); expect(out[4]).toBe(RIPPLE.AGE_NONE); expect(out[5]).toBe(0);
    const one = strikeAges([{ t: 5, w: .7 }], { P }), o2 = new Float64Array(4);
    one(47, o2);
    expect(o2[0]).toBeCloseTo(2, 9); expect(o2[2]).toBeCloseTo(22, 9); expect(o2[1]).toBe(.7);
    const none = strikeAges([], { P }), o3 = new Float64Array(4).fill(7);
    none(3, o3); expect(Array.from(o3)).toEqual([RIPPLE.AGE_NONE, 0, RIPPLE.AGE_NONE, 0]);
  });
  it('strikeAges is scrub-exact: any order of times gives the same answers', () => {
    const f = strikeAges(CUE, { P, start: -.6 }), g = strikeAges(CUE, { P, start: -.6 });
    const ts = Array.from({ length: 200 }, (_, i) => -2.4 + i * .37), a = new Float64Array(4), b = new Float64Array(4);
    const fwd = ts.map(t => Array.from(f(t, a)));
    const rev = [...ts].reverse().map(t => Array.from(g(t, b))).reverse();
    expect(rev).toEqual(fwd);
  });

  const anchor = (key, x, z, w, d, extra = {}) => ({ key, kind: 'station', label: key, color: '#3fd0ff', x, z, yaw: 0, w, d, cue: CUE, P, start: -.6, ...extra });
  it('rippleSlots: rings leave what a machine stands on; a hung machine over another\'s stand stays quiet', () => {
    const plan = { pads: [{ key: 'a', x: 1, z: 2, hw: 4, hd: 3, yaw: .3 }], lofts: [] };
    const S = rippleSlots([
      anchor('belt', 0, 0, 20, 6, { kind: 'belt' }),
      anchor('ric', 0, 0, 8, 8, { kind: 'hung' }),                 // over the belt: the belt's floor
      anchor('organ', 0, -14, 13, 4.6, { kind: 'hung' }),          // behind it: its own floor
      anchor('a', 1.2, 2.1, 7, 5),
      anchor('mute', 9, 9, 3, 3, { cue: [] }),
    ], plan);
    expect(S.map(s => s.key)).toEqual(['belt', 'a', 'organ']);
    expect(S[1]).toMatchObject({ x: 1, z: 2, hw: 4, hd: 3, yaw: .3 });         // the pad, not the footprint
    expect(S[2]).toMatchObject({ x: 0, z: -14, hw: 6.5, hd: 2.3 });
    for (const s of S) expect(s.gain).toBeGreaterThan(0), expect(s.gain).toBeLessThanOrEqual(1);
  });
  it('rippleSlots: a constant pool (≤ RIPPLE.N ≤ FOOT.MAX_PULSE), a busy machine rings softer', () => {
    expect(RIPPLE.N).toBeLessThanOrEqual(FOOT.MAX_PULSE);
    const many = Array.from({ length: 40 }, (_, i) => anchor('m' + i, i * 3, 0, 2, 2));
    expect(rippleSlots(many).length).toBe(RIPPLE.N);
    const busy = Array.from({ length: 200 }, (_, i) => ({ t: i * .1, w: 1 }));
    const [calm, dense] = rippleSlots([anchor('calm', 0, 0, 2, 2), anchor('dense', 9, 0, 2, 2, { cue: busy })]);
    expect(calm.gain).toBe(1); expect(dense.gain).toBeLessThan(.6);
  });
  it('packColor: three bytes in one float, decoded as the shader does', () => {
    for (const hex of ['#ff8a3d', '#2fe6c0', '#000000', '#ffffff', '#3fd0ff']){
      const c = packColor(hex), r = Math.floor(c / 65536), g = Math.floor((c - r * 65536) / 256), b = c - r * 65536 - g * 256;
      expect(Math.fround(c)).toBe(c);
      const lin = new THREE.Color(hex);
      expect(Math.abs(r / 255 - lin.r)).toBeLessThan(.003); expect(Math.abs(g / 255 - lin.g)).toBeLessThan(.003); expect(Math.abs(b / 255 - lin.b)).toBeLessThan(.003);
    }
  });
  it('the live side: place writes the pool once, update is a pure fn of songTime (silent in the count-in)', () => {
    const X = rippleExtra(), R = makeRipples(X.uniforms), U = X.uniforms;
    R.place([anchor('a', 3, 4, 6, 4), anchor('b', -9, 2, 4, 4, { cue: [{ t: 7, w: 1 }] })], null);
    expect(U.rN.value).toBe(2);
    expect(Array.from(U.rA.value.slice(0, 8))).toEqual([3, 4, 3, 2, -9, 2, 2, 2]);
    const snap = () => [Array.from(U.rS.value.slice(0, 8)), Array.from(U.rB.value.slice(0, 8))];
    R.update(-1.5);
    expect(U.rS.value[1]).toBe(0); expect(U.rS.value[5]).toBe(0); expect(U.rB.value[2]).toBe(0); expect(U.rB.value[6]).toBe(0);
    R.update(9.1); const at = snap();
    R.update(33.3); R.update(-2); R.update(9.1);
    expect(snap()).toEqual(at);
    expect(U.rS.value[0]).toBeCloseTo(.1, 5); expect(U.rB.value[2]).toBeGreaterThan(.5);   // a just struck: its ring + its cells
    expect(U.rS.value[4]).toBeCloseTo(2.1, 5);
    const GL = X.head + X.body;
    for (const u of Object.keys(U)) expect(GL.includes(u), u).toBe(true);                    // every uniform is declared + read
  });
});

/* THE STAGE PLOT (grid-plot.js): the room's props — names on the floor, never in anything's way */
describe('Greybox stage plot: each machine named on the floor, clear of everything', () => {
  /* an independent check (not the SAT under test): the gap between two convex polygons */
  const corners = R => { const c = Math.cos(R.yaw || 0), s = Math.sin(R.yaw || 0);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [R.x + c * u * R.hw + s * v * R.hd, R.z - s * u * R.hw + c * v * R.hd]); };
  const inside = (P, [x, z]) => { let sgn = 0; for (let i = 0; i < 4; i++){ const a = P[i], b = P[(i + 1) % 4], c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]); if (Math.abs(c) < 1e-12) continue; if (!sgn) sgn = Math.sign(c); else if (Math.sign(c) !== sgn) return false; } return true; };
  const segDist = ([x, z], a, b) => { const ex = b[0] - a[0], ez = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez))); return Math.hypot(x - a[0] - t * ex, z - a[1] - t * ez); };
  const gap = (A, B) => {
    if (A.some(p => inside(B, p)) || B.some(p => inside(A, p))) return 0;
    let d = Infinity;
    for (const [P, Q] of [[A, B], [B, A]]) for (const p of P) for (let i = 0; i < 4; i++) d = Math.min(d, segDist(p, Q[i], Q[(i + 1) % 4]));
    return d;
  };
  const boxPoly = b => corners({ x: (b[0] + b[1]) / 2, z: (b[4] + b[5]) / 2, hw: (b[1] - b[0]) / 2, hd: (b[5] - b[4]) / 2 });
  const labelPoly = l => corners({ x: l.x, z: l.z, hw: l.w / 2, hd: l.h / 2 });
  /* what a label must clear: footprints (a hung machine's only where it reaches the floor), footing envelopes */
  const obstaclesOf = (anchors, plan) => [
    ...anchors.filter(a => a.kind !== 'hung' || a.box[2] < plan.floor + PLOT.CLEAR).map(a => ({ what: a.key, P: corners({ x: a.x, z: a.z, hw: a.w / 2, hd: a.d / 2, yaw: a.yaw }) })),
    ...anchors.filter(a => a.kind === 'hung' && a.box[2] < plan.floor + PLOT.CLEAR).map(a => ({ what: a.key + ' box', P: boxPoly(a.box) })),
    ...footingBoxes(plan).map(e => ({ what: `${e.kind} ${e.unit}`, P: boxPoly(e.box) })),
  ];
  function audit(anchors, plan, tag){
    const L = placeLabels(anchors, plan, { floor: FL, room: STAGE }), obs = obstaclesOf(anchors, plan);
    for (const l of L){
      const P = labelPoly(l);
      for (const o of obs) expect(gap(P, o.P), `${tag}: ${l.key}'s label vs ${o.what}`).toBeGreaterThanOrEqual(PLOT.CLEAR - 1e-6);
      for (const m of L) if (m !== l) expect(gap(P, labelPoly(m)), `${tag}: ${l.key} vs ${m.key}`).toBeGreaterThan(.5);
      for (const [x, z] of P){ expect(Math.abs(x)).toBeLessThanOrEqual(STAGE.HW - PLOT.WALL + 1e-9); expect(z).toBeGreaterThanOrEqual(STAGE.BACK + PLOT.WALL - 1e-9); expect(z).toBeLessThanOrEqual(STAGE.FRONT - PLOT.WALL + 1e-9); }
      expect(l.z, `${tag}: ${l.key} is never behind its machine`).toBeGreaterThanOrEqual(anchors.find(a => a.key === l.key).z - 1e-9 - Math.max(...anchors.filter(a => a.key === l.key).map(a => a.d)));
    }
    return L;
  }

  it('labelLines: the machine\'s name in capitals; a raised deck reads its elevation in metres', () => {
    expect(labelLines({ key: 'bells', label: 'Tubular Bells', y: FL + .4 }, FL)).toEqual({ name: 'TUBULAR BELLS', sub: null });
    expect(labelLines({ key: 'horns', label: 'Bellows Horns', y: FL + 19.33 }, FL)).toEqual({ name: 'BELLOWS HORNS', sub: '+13.1 m' });
    expect(labelLines({ key: 'x', y: FL + 1 }, FL)).toEqual({ name: 'X', sub: '+0.7 m' });
    const a = labelSize({ name: 'MARIMBA', sub: null }), b = labelSize({ name: 'MARIMBA', sub: '+4.2 m' });
    expect(b.w).toBe(a.w); expect(b.h).toBeGreaterThan(a.h);
  });
  it('clearOf: turned rects, apart by at least the gap', () => {
    const R = (x, z, hw, hd, yaw = 0) => { const c = Math.cos(yaw), s = Math.sin(yaw); return { x, z, ax: c, az: -s, bx: s, bz: c, ha: hw, hb: hd }; };
    expect(clearOf(R(0, 0, 1, 1), R(3, 0, 1, 1), .9)).toBe(true);
    expect(clearOf(R(0, 0, 1, 1), R(3, 0, 1, 1), 1.1)).toBe(false);
    expect(clearOf(R(0, 0, 1, 1), R(2.2, 2.2, 1, 1, Math.PI / 4), .1)).toBe(true);     // a diamond off the corner
    expect(clearOf(R(0, 0, 1, 1), R(1.9, 0, 1, 1, Math.PI / 4), 0)).toBe(false);
  });
  it('the crowd: a label per machine it can fit, each clear of every footprint, support and label — deterministic', () => {
    const L = audit(CROWD, PLAN, 'crowd');
    expect(L.length).toBeGreaterThanOrEqual(10);
    expect(L.some(l => l.key === 'organ')).toBe(false);                                          // (hung: it stands on nothing)
    expect(placeLabels(CROWD, PLAN, { floor: FL, room: STAGE })).toEqual(L);
  });
  it('the catalog (every song as staged in the fixture, re-planned): every label clear; most machines named', () => {
    let named = 0, standing = 0;
    for (const { song, anchors, plan } of catalog()){
      named += audit(anchors, plan, song).length; standing += anchors.filter(a => a.kind !== 'hung').length;
    }
    expect(standing).toBeGreaterThan(100);
    expect(named / standing, `${named} / ${standing} named`).toBeGreaterThan(.8);
  });
});
