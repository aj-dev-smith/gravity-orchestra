import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { planFooting, footingBoxes, FOOT } from '../src/rooms/footing.js';
import { buildFooting, makeFootingMats } from '../src/rooms/footing3d.js';
import { arenaFooting, ARENA_FOOT, vuCode, frontSide } from '../src/rooms/arena-footing.js';
import { STAGE } from '../src/rooms/common.js';

/* THE METAL ARENA'S FOOTING (src/rooms/arena-footing.js): real staging gear — Litedecks, drum risers
   with an LED VU fascia, Layher scaffold, box-truss towers, truss wings — drawn into the footing kit's
   merged slots (one draw per material), never outside the plan's envelopes, its light coded per strip. */

const FL = STAGE.FLOOR, ROOMB = { x0: -STAGE.HW, x1: STAGE.HW, z0: STAGE.BACK, z1: STAGE.FRONT };
const st = (key, x, z, w, d, h = FOOT.PLINTH, extra = {}) => ({ key, kind: 'station', label: key, color: '#88aaff', x, z, yaw: 0, w, d,
  y: FL + h, bottom: FL + h, low: FL + h, box: [x - w / 2, x + w / 2, FL + h, FL + h + 5, z - d / 2, z + d / 2],
  cue: [{ t: 1 + (key.length % 3), w: 1 }, { t: 6, w: .5 }], P: 20, start: -.6, fixed: false, ...extra });
/* every band (the footing3d test's crowd): the belt, the kit, plinths, a dais, platforms (stair / ladder),
   a tower, a gallery loft and a mid loft, a turned riser, an open stand, the organ loft hung over the floor */
const CROWD = [
  { key: 'belt', kind: 'belt', color: '#ffaa55', x: 0, z: -1.17, yaw: 0, w: 21.74, d: 5.77, y: FL, bottom: FL, low: FL, box: [-10.87, 10.87, FL, 15.83, -4.05, 1.72], cue: [{ t: 3, w: 1 }], P: 20, start: -.6, fixed: true },
  { ...st('drums', 19, 19, 18, 5.5), kind: 'kit', color: '#ff8a3d', low: FL + FOOT.PLINTH - .335 },
  st('bass', -20, 5, 11.7, 7.8), st('bells', 26, -10, 10.9, 6.85),
  st('dais', -27, 20, 10, 6, 2.4), st('plat', 0, 30, 10, 6, 5), st('platL', 20, 33, 10, 6, 8), st('tower', -20, -10, 12, 6, 14),
  st('g1', -10, -24, 12, 4, 19.33), st('g2', 4.5, -24, 12, 4, 19.33), st('m1', 28, 6, 8, 5, 6), st('m2', 28, -1, 8, 5, 6.2),
  st('yawed', -30, 32, 6, 4, 3, { yaw: .6 }),
  { ...st('tt', -6, 15, 14.2, 14.1, -1.29 - FL), low: -5.1, feet: [[-5.5, -4.5, .7], [5.5, -4.5, .7], [-5.5, 4.5, .7], [5.5, 4.5, .7]], hang: [-6.25, 4.35, 4.8, 5.7] },
  { key: 'organ', kind: 'hung', x: 0, z: -13.65, yaw: 0, w: 13.16, d: 4.64, y: 16, box: [-6.58, 6.58, FL, 24.54, -15.97, -11.33], cue: [], P: 20, start: -.6, fixed: true },
];
const PLAN = planFooting(CROWD, { floor: FL, room: ROOMB }), ENV = footingBoxes(PLAN);
const MATS = makeFootingMats();
const build = (plan = PLAN, style = arenaFooting()) => buildFooting(plan, style, { mats: MATS, boxes: footingBoxes(plan) });
const meshes = f => { const out = []; f.group.traverse(o => { if (o.isMesh) out.push(o); }); return out; };
const named = (f, n) => meshes(f).find(m => m.name === 'footing:' + n);

describe('arena footing: real staging gear, drawn into the kit', () => {
  it('one draw per material slot + the light — ply, aluminium, serge, galvanised tube, timber; all tagged', () => {
    const f = build(), M = meshes(f);
    expect(M.map(m => m.name).sort()).toEqual(['footing:deck', 'footing:edge', 'footing:galv', 'footing:skirt', 'footing:steel', 'footing:wood']);
    for (const m of M) expect(m.userData.footing, m.name).toBe(true);
    // (the forms draw into the merged slots: at most one empty marker group beside the meshes)
    expect(f.group.children.filter(c => !c.isMesh).length).toBeLessThanOrEqual(1);
    for (const c of f.group.children) if (!c.isMesh) expect(c.children.length).toBe(0);
    f.dispose();
  });
  it('the style\'s aluminium IS the room\'s rig material when it hands one over (the towers are the rig\'s kit)', () => {
    const alu = new THREE.MeshStandardMaterial({ color: 0xb9bcc4, metalness: 1 });
    const style = arenaFooting({ alu }), f = build(PLAN, style);
    expect(named(f, 'steel').material).toBe(alu);
    let gone = false; alu.addEventListener('dispose', () => { gone = true; });
    f.dispose(); style.dispose();
    expect(gone).toBe(false);                                                           // (the room's to free, not the style's)
  });
  it('everything it draws stays inside the plan\'s envelopes (what the shot solve treats as solid)', () => {
    const f = build(), B = ENV.map(e => e.box);
    for (const m of meshes(f)){
      const p = m.geometry.attributes.position.array;
      let worst = 0, at = null;
      for (let i = 0; i < p.length; i += 3){
        const x = p[i], y = Math.max(p[i + 1], FL), z = p[i + 2];
        if (p[i + 1] < FL - .2){ worst = Infinity; at = [x, p[i + 1], z]; break; }
        let d = Infinity;
        for (const b of B) d = Math.min(d, Math.hypot(Math.max(b[0] - x, 0, x - b[1]), Math.max(b[2] - y, 0, y - b[3]), Math.max(b[4] - z, 0, z - b[5])));
        if (d > worst){ worst = d; at = [x, y, z]; }
      }
      expect(worst, `${m.name}: ${worst.toFixed(3)} u out at ${at && at.map(v => v.toFixed(2))}`).toBeLessThanOrEqual(.035);
    }
    f.dispose();
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
  it('its LIGHT: every strip codes a real pad slot — plain, a VU segment (slot + threshold) or glow tape', () => {
    const f = build(), k = named(f, 'edge').geometry.attributes.aPulse.array;
    const slots = new Set(PLAN.pads.map(p => p.pulse));
    const seen = { plain: new Set(), vu: new Set(), tape: 0 };
    for (const v of k){
      if (v === ARENA_FOOT.TAPE){ seen.tape++; continue; }
      const s = Math.floor(v + 1e-4), fr = v - s;
      expect(slots.has(s), `slot ${s}`).toBe(true);
      if (fr < .005) seen.plain.add(s); else { expect(fr).toBeGreaterThan(.02); expect(fr).toBeLessThan(.98); seen.vu.add(s); }
    }
    expect(seen.tape).toBeGreaterThan(0);                                               // (spike marks + nosing)
    // every RAISED support carries a VU fascia for its machine(s); every grounded one its LED line — the kit is a riser
    for (const p of PLAN.pads){
      if (p.open) continue;
      const raised = p.band !== 'flush' || p.kind === 'kit';
      expect(raised ? seen.vu.has(p.pulse) : seen.plain.has(p.pulse), `${p.key} (${p.band}${p.loft ? ' in ' + p.loft : ''})`).toBe(true);
    }
    f.dispose();
  });
  it('a VU fascia fills from the middle out (the centre segments light first)', () => {
    const n = 9, thr = Array.from({ length: n }, (_, i) => vuCode(4, i, n) - 4);
    expect(Math.min(...thr)).toBe(thr[4]);
    for (let i = 0; i < 4; i++){ expect(thr[i]).toBeGreaterThan(thr[i + 1]); expect(thr[n - 1 - i]).toBeGreaterThan(thr[n - 2 - i]); }
    for (const t of thr){ expect(t).toBeGreaterThan(.02); expect(t).toBeLessThan(.98); }
  });
  it('the fascia faces the house: the side whose outward normal points most to +z', () => {
    expect(frontSide({ x: 0, z: 0, hw: 2, hd: 1, yaw: 0 })).toBe('+v');
    expect(frontSide({ x: 0, z: 0, hw: 2, hd: 1, yaw: Math.PI / 2 })).toBe('-u');        // (local +u → world (cos, −sin): a quarter turn sends it to −z)
    expect(frontSide({ x: 0, z: 0, hw: 2, hd: 1, yaw: Math.PI })).toBe('-v');
  });
  it('a machine that dips into its base (the kit\'s pistons): solid at least that deep under it, at every height', () => {
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
    const kit = h => ({ ...st('drums', 0, 12, 18, 5.5, h), kind: 'kit', low: FL + h - .335 });
    for (const h of [FOOT.PLINTH, 2.4, 6, 14]){
      const p = planFooting([kit(h)], { floor: FL, room: ROOMB }), q = p.pads[0];
      const f = build(p);
      if (q.band === 'flush' || q.band === 'low'){
        // a closed riser from the floor: its skirt reaches the floor, its ply top closes it
        const sk = named(f, 'skirt').geometry.attributes.position.array;
        let lo = Infinity; for (let i = 1; i < sk.length; i += 3) lo = Math.min(lo, sk[i]);
        expect(lo, q.band).toBeLessThanOrEqual(FL);
        expect(Math.max(...crossing(named(f, 'deck'), q.x + .37, q.z - .21))).toBeCloseTo(q.top, 6);
      } else {
        const under = Math.min(...crossing(named(f, 'deck'), q.x + .37, q.z - .21).filter(y => y < q.top + 1e-6));
        expect(q.top - under, `${q.band}: deck ${(q.top - under).toFixed(3)} deep`).toBeGreaterThanOrEqual(q.well + .03);
      }
      f.dispose();
    }
  });
  it('Layher scaffold under a mid deck: standards on sole boards, the ring running on up as the guard rail', () => {
    const p = planFooting([st('plat', 0, 12, 10, 6, 6)], { floor: FL, room: ROOMB }), q = p.pads[0];
    expect(q.band).toBe('mid');
    const f = build(p), g = named(f, 'galv').geometry.attributes.position.array, w = named(f, 'wood').geometry.attributes.position.array;
    let top = -Infinity, low = Infinity;
    for (let i = 1; i < g.length; i += 3){ top = Math.max(top, g[i]); low = Math.min(low, g[i]); }
    expect(top).toBeCloseTo(q.top + FOOT.RAIL, 6);                                     // (guard-rail posts: the standards)
    expect(low).toBeLessThan(FL + .1);                                                  // (the jack plates sit on the boards)
    let woodLo = Infinity; for (let i = 1; i < w.length; i += 3) woodLo = Math.min(woodLo, w[i]);
    expect(woodLo).toBeLessThanOrEqual(FL);                                            // (sole boards on the floor)
    f.dispose();
  });
  it('fast: the crowd\'s footing builds in a few ms', () => {
    const style = arenaFooting();
    for (let k = 0; k < 3; k++) build(PLAN, style).dispose();
    const ms = [];
    for (let k = 0; k < 7; k++){ const f = build(PLAN, style); ms.push(f.ms); f.dispose(); }
    ms.sort((a, b) => a - b);
    expect(ms[3], `median ${ms[3].toFixed(2)} ms`).toBeLessThan(25);
  });
});
