import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { planFooting, footingBoxes, FOOT } from '../src/rooms/footing.js';
import { buildFooting, makeFootingMats } from '../src/rooms/footing3d.js';
import { STAGE } from '../src/rooms/common.js';
import { gridFootStyle } from '../src/rooms/grid-footing.js';

/* GREYBOX (src/rooms/grid.js + grid-footing.js): ROOM ZERO's footing drawn in the room's
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

