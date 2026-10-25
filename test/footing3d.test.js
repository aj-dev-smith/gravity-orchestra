import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { planFooting, footingBoxes, FOOT } from '../src/rooms/footing.js';
import { buildFooting, makeFootingMats, DEFAULT_STYLE } from '../src/rooms/footing3d.js';
import { makePulse } from '../src/rooms/pulse.js';
import { STAGE } from '../src/rooms/common.js';

/* THE FOOTING KIT (src/rooms/footing3d.js): what it draws for a plan — merged per material, never
   outside the plan's envelopes (what the shot solve keeps an eye out of and the staging test treats
   as solid), its edge light a pure function of songTime, restyled by a room through hooks. */

const FL = STAGE.FLOOR, ROOMB = { x0: -STAGE.HW, x1: STAGE.HW, z0: STAGE.BACK, z1: STAGE.FRONT };
const st = (key, x, z, w, d, h = FOOT.PLINTH, extra = {}) => ({ key, kind: 'station', label: key, color: '#88aaff', x, z, yaw: 0, w, d,
  y: FL + h, bottom: FL + h, low: FL + h, box: [x - w / 2, x + w / 2, FL + h, FL + h + 5, z - d / 2, z + d / 2],
  cue: [{ t: 1 + (key.length % 3), w: 1 }, { t: 6, w: .5 }], P: 20, start: -.6, fixed: false, ...extra });
/* fifteen machines, every band: the belt, the kit, plinths, a dais, platforms (stair / ladder), a tower,
   a gallery loft and a mid loft, a turned riser, an open stand, the organ loft hung over the floor */
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
const build = (style = DEFAULT_STYLE, ctx = {}) => buildFooting(PLAN, style, { boxes: ENV, ...ctx });
const meshes = f => { const out = []; f.group.traverse(o => { if (o.isMesh) out.push(o); }); return out; };

describe('footing kit: the plan, drawn', () => {
  it('the crowd covers every form (so the rest of this file sees them all)', () => {
    const bands = new Set(PLAN.pads.map(p => p.open ? 'open' : p.band));
    for (const b of ['flush', 'low', 'mid', 'high', 'open']) expect(bands.has(b), b).toBe(true);
    expect(PLAN.lofts.map(L => L.band).sort()).toEqual(['high', 'mid']);
    const acc = [...PLAN.pads, ...PLAN.lofts].filter(p => p.access).map(p => p.access.kind);
    expect(acc).toContain('stair'); expect(acc).toContain('ladder');
    expect([...PLAN.pads, ...PLAN.lofts].some(p => p.access?.cage)).toBe(true);
  });
  it('one draw per material slot + one for every machine\'s edge — every mesh tagged as footing', () => {
    const f = build(), M = meshes(f);
    expect(M.length).toBeLessThanOrEqual(6);
    expect(M.map(m => m.name).sort()).toEqual(['footing:base', 'footing:deck', 'footing:edge', 'footing:steel']);
    for (const m of M) expect(m.userData.footing, m.name).toBe(true);
    expect(f.group.userData.footing).toBe(true);
    f.dispose();
  });
  it('everything it draws stays inside the plan\'s envelopes (a steel nosing\'s hair; feet buried in the floor)', () => {
    const f = build(), B = ENV.map(e => e.box);
    for (const m of meshes(f)){
      const p = m.geometry.attributes.position.array;
      let worst = 0, at = null;
      for (let i = 0; i < p.length; i += 3){
        const x = p[i], y = Math.max(p[i + 1], FL), z = p[i + 2];
        if (p[i + 1] < FL - .2) { worst = Infinity; at = [x, p[i + 1], z]; break; }    // (nothing digs deeper than a buried foot)
        let d = Infinity;
        for (const b of B) d = Math.min(d, Math.hypot(Math.max(b[0] - x, 0, x - b[1]), Math.max(b[2] - y, 0, y - b[3]), Math.max(b[4] - z, 0, z - b[5])));
        if (d > worst){ worst = d; at = [x, y, z]; }
      }
      expect(worst, `${m.name}: ${worst.toFixed(3)} u out at ${at && at.map(v => v.toFixed(2))}`).toBeLessThanOrEqual(.035);
    }
    f.dispose();
  });
  it('each merged mesh carries the envelopes of the supports it has parts in (the shot solve\'s boxes)', () => {
    const f = build(), all = new Set(ENV.map(e => e.box)), seen = new Set();
    for (const m of meshes(f)) if (m.name !== 'footing:edge'){
      expect(m.userData.boxes.length, m.name).toBeGreaterThan(0);
      for (const b of m.userData.boxes){ expect(all.has(b), m.name).toBe(true); seen.add(b); }
    }
    for (const e of ENV) expect(seen.has(e.box), `${e.kind} ${e.unit}`).toBe(true);      // (every support is drawn by someone)
    expect(meshes(f).find(m => m.name === 'footing:base').userData.boxes.length).toBeLessThan(ENV.length);   // (concrete: plinths + the dais — not the towers)
    f.dispose();
  });
  it('the edge light is a pure fn of songTime: one uniform slot per pad, afterglow + a touch of anticipation', () => {
    const f = build(), U = meshes(f).find(m => m.name === 'footing:edge').material.uniforms.uPulse.value;
    const P = PLAN.pulses.map(s => makePulse(s.cue, { P: s.P, start: s.start }));
    const read = t => { f.update(t); return Array.from(U.slice(0, P.length)); };
    for (const t of [-2.4, -.3, 1.05, 3.2, 5.9, 6.1, 27.3]){
      const got = read(t);
      P.forEach((p, i) => expect(got[i], `slot ${i} @${t}`).toBeCloseTo(Math.min(1, p.at(t) + .35 * p.next(t)), 6));
    }
    expect(read(-2.4).every(v => v === 0)).toBe(true);                                  // the count-in is dark
    const a = read(14.2); read(3); expect(read(14.2)).toEqual(a);                       // scrub-exact
    // every edge vertex reads a real slot (its pad's)
    const k = meshes(f).find(m => m.name === 'footing:edge').geometry.attributes.aPulse.array;
    const slots = new Set(PLAN.pads.map(p => p.pulse));
    for (const v of k) expect(slots.has(v)).toBe(true);
    f.dispose();
  });
  it('a room STYLE swaps a form, its light, its materials — and owns them (the footing never disposes a style\'s material)', () => {
    const base = build(), steelTris = m => m.find(x => x.name === 'footing:steel').geometry.index.count / 3;
    const mine = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    let disposed = false; mine.addEventListener('dispose', () => { disposed = true; });
    const style = {
      mats: () => ({ steel: mine }),
      high: spec => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(1, spec.h, 1), mine)); return g; },
      edge: spec => spec.key === 'bass' ? new THREE.Group() : null,
    };
    const f = build(style), M = meshes(f);
    const steel = M.find(m => m.name === 'footing:steel');
    expect(steel.material).toBe(mine);
    expect(steelTris(M)).toBeLessThan(steelTris(meshes(base)));                       // (the tower is the style's now)
    const towers = PLAN.pads.filter(p => p.band === 'high' && !p.loft && !p.open).length;
    expect(M.filter(m => m.geometry.type === 'BoxGeometry').length).toBe(towers);
    for (const m of M) expect(m.userData.footing).toBe(true);
    // the bass's own light is the style's: no edge vertex reads its slot
    const bass = PLAN.pads.find(p => p.key === 'bass').pulse;
    expect(Array.from(M.find(m => m.name === 'footing:edge').geometry.attributes.aPulse.array).includes(bass)).toBe(false);
    f.dispose(); base.dispose();
    expect(disposed).toBe(false);
  });
  it('every face looks out: its winding agrees with its normal (a flipped face would be culled away)', () => {
    const f = build();
    for (const m of meshes(f)){
      const g = m.geometry, p = g.attributes.position.array, n = g.attributes.normal?.array, I = g.index.array;
      if (!n) continue;                                                                 // (the edge: unlit)
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
  it('dispose() takes it out of the scene and frees its geometry', () => {
    const scene = new THREE.Scene(), f = build(), freed = [];
    scene.add(f.group);
    for (const m of meshes(f)) m.geometry.addEventListener('dispose', () => freed.push(m.name));
    f.dispose();
    expect(f.group.parent).toBe(null);
    expect(freed.sort()).toEqual(['footing:base', 'footing:deck', 'footing:edge', 'footing:steel']);
  });
  it('fast: a fifteen-machine song\'s footing rebuilds in a few ms (a height drag rebuilds it live)', () => {
    const mats = makeFootingMats();
    for (let k = 0; k < 3; k++) build(DEFAULT_STYLE, { mats }).dispose();               // (warm)
    const ms = [];
    for (let k = 0; k < 7; k++){ const f = build(DEFAULT_STYLE, { mats }); ms.push(f.ms); f.dispose(); }
    ms.sort((a, b) => a - b);
    expect(ms[3], `median ${ms[3].toFixed(2)} ms`).toBeLessThan(20);                   // (≈ 2–5 ms on a laptop; loose: suites share the CPU)
  });
});
