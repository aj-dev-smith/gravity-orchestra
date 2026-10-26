import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { planFooting, footingBoxes, FOOT } from '../src/rooms/footing.js';
import { buildFooting, makeFootingMats, DEFAULT_STYLE, tintStyle, footingDraws, gapOf, landings } from '../src/rooms/footing3d.js';
import { beamMat } from '../src/rooms/common.js';
import os from 'node:os';
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
  it('a room TINT (tintStyle): the kit\'s forms in the room\'s materials — made once, shared by every build, the room\'s to dispose', () => {
    const mats = makeFootingMats(), style = tintStyle({ key: 'x', base: { color: 0xfff0d8, grain: true }, steel: { color: 0x6a5c4e, metalness: .45 } });
    const a = build(style, { mats }), b = build(style, { mats });
    const mat = (f, slot) => meshes(f).find(m => m.name === 'footing:' + slot).material;
    expect(mat(a, 'base')).toBe(mat(b, 'base'));                                       // (one set per room)
    expect(mat(a, 'base').color.getHex()).toBe(0xfff0d8);
    expect(mat(a, 'base').map).toBe(mats.base.map);                                   // (the grain: the kit's own)
    expect(mat(a, 'steel').map).toBe(null);
    expect(mat(a, 'deck')).toBe(mats.deck);                                            // (a slot it leaves: the kit's)
    let gone = 0; mat(a, 'base').addEventListener('dispose', () => gone++);
    a.dispose(); b.dispose(); expect(gone).toBe(0);                                    // (never the footing's to free)
    style.dispose(); expect(gone).toBe(1);
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
  it('a machine that dips into its base (the kit\'s pistons: footing.js well) — every support is solid that deep under it', () => {
    /* the heights where a mesh's triangles cross the vertical line through (x, z) */
    const crossing = (m, x, z) => {
      const a = m.geometry.attributes.position.array, I = m.geometry.index.array, out = [];
      for (let t = 0; t < I.length; t += 3){
        const [p, q, r] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
        const d = (a[q] - a[p]) * (a[r + 2] - a[p + 2]) - (a[r] - a[p]) * (a[q + 2] - a[p + 2]);
        if (Math.abs(d) < 1e-12) continue;                                              // (a wall: seen edge-on)
        const u = ((x - a[p]) * (a[r + 2] - a[p + 2]) - (a[r] - a[p]) * (z - a[p + 2])) / d, v = ((a[q] - a[p]) * (z - a[p + 2]) - (x - a[p]) * (a[q + 2] - a[p + 2])) / d;
        if (u >= 0 && v >= 0 && u + v <= 1) out.push(a[p + 1] + u * (a[q + 1] - a[p + 1]) + v * (a[r + 1] - a[p + 1]));
      }
      return out;
    };
    const kit = (h, x = 0) => ({ ...st('drums', x, 12, 18, 5.5, h), kind: 'kit', low: FL + h - .335 });
    for (const h of [FOOT.PLINTH, 2.4, 6, 14]){
      const p = planFooting([kit(h)], { floor: FL, room: ROOMB }), q = p.pads[0];
      expect(q.open, `${h}`).toBe(false); expect(q.well).toBeCloseTo(.335, 12);
      const f = buildFooting(p, DEFAULT_STYLE, { boxes: footingBoxes(p) }), M = meshes(f);
      const at = name => M.filter(m => m.name === name).flatMap(m => crossing(m, q.x + .37, q.z - .21)).filter(y => y < q.top + 1e-6);
      if (q.band === 'flush' || q.band === 'low'){
        // concrete from the floor up under its cap: what dips sinks into the block
        const base = M.find(m => m.name === 'footing:base').geometry.attributes.position.array;
        let lo = Infinity; for (let i = 1; i < base.length; i += 3) lo = Math.min(lo, base[i]);
        expect(lo, q.band).toBeLessThanOrEqual(FL);
        expect(q.h, q.band).toBeGreaterThanOrEqual(q.well + .03);
      } else {
        // a deck plate on legs / a truss: its underside at least the well (+ a hair) under its top
        const under = Math.min(...at('footing:deck'));
        expect(q.top - under, `${q.band}: deck ${(q.top - under).toFixed(3)} deep`).toBeGreaterThanOrEqual(q.well + .03);
      }
      f.dispose();
    }
    // a loft shares the deepest member's well (a member on a shim dips into the shim first)
    const L = planFooting([kit(6, -6), { ...st('bells', 7, 12, 6, 5, 6.2) }], { floor: FL, room: ROOMB }).lofts[0];
    expect(L.keys).toEqual(['bells', 'drums']); expect(L.well).toBeCloseTo(.335, 12);
  });
  it('every face of a tower is braced — a long bay in panels (it stood on ties alone)', () => {
    const p = planFooting([st('tower', 0, 12, 14, 6, 14)], { floor: FL, room: ROOMB }), q = p.pads[0];
    expect(q.band).toBe('high');
    const f = buildFooting(p, DEFAULT_STYLE, { boxes: footingBoxes(p) });
    const a = meshes(f).find(m => m.name === 'footing:steel').geometry.attributes.position.array;
    const hv = q.hd - .6;                                                   // (the column ring: COL_IN in from the pad)
    for (const side of [-1, 1]){
      if (q.access?.side === (side > 0 ? '+v' : '-v')) continue;          // (a ladder's own steel there)
      let n = 0;
      for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i]) < .3 && Math.abs(a[i + 2] - (12 + side * hv)) < .3 && a[i + 1] > FL + 1 && a[i + 1] < q.top - 1) n++;
      expect(n, `${side > 0 ? 'front' : 'back'} face: panel joints mid-bay`).toBeGreaterThan(0);
    }
    f.dispose();
  });
  it('a tall OPEN stand is tied + X-braced in tiers — never through what hangs above its lowest part', () => {
    const tt = u => ({ ...st('turntable', 0, 12, 14.22, 14.12, -1.29 - FL + u), y: -.93 + u, ground: -.93, lift: u, low: -5.1 + u,
      feet: [[-5.5, -4.5, .7], [5.5, -4.5, .7], [-5.5, 4.5, .7], [5.5, 4.5, .7]], hang: [-6.25, 4.35, 4.8, 5.7] });
    const steelOf = u => {
      const p = planFooting([tt(u)], { floor: FL, room: ROOMB }), f = buildFooting(p, DEFAULT_STYLE, { boxes: footingBoxes(p) });
      const a = meshes(f).find(m => m.name === 'footing:steel').geometry.attributes.position.array.slice();
      f.dispose(); return { q: p.pads[0], a };
    };
    // (a bar's vertices are its ends: a tie or a brace meeting the posts at a tier line has vertices there)
    const tiesAt = (a, z, y) => { let n = 0; for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i + 2] - z) < .6 && Math.abs(a[i + 1] - y) < .1) n++; return n; };
    // at its own height: one tier (no intermediate tie anywhere)
    const lo = steelOf(0), loY = [];
    for (let i = 1; i < lo.a.length; i += 3) loY.push(lo.a[i]);
    // lifted 14: three tiers, tied between on the back face (away from the hang) and the front (below what hangs)
    const { q, a } = steelOf(14), y0 = FL + .3, y1 = q.top - .4, t1 = y0 + (y1 - y0) / 3, t2 = y0 + 2 * (y1 - y0) / 3;
    expect(q.access).toMatchObject({ kind: 'ladder' });
    for (const y of [t1, t2]){
      expect(tiesAt(a, 12 - 4.5, y), `back tie @${y.toFixed(2)}`).toBeGreaterThan(0);
      expect(tiesAt(lo.a, 12 - 4.5, y), `no tie @${y.toFixed(2)} unlifted`).toBe(0);
    }
    expect(tiesAt(a, 12 + 4.5, t1), 'front tie under the hang').toBeGreaterThan(0);
    // nothing of the stand inside what hangs: x −6.25…4.35, z 12+4.8…12+5.7, from its lowest part up to the stand
    for (let i = 0; i < a.length; i += 3){
      const x = a[i], y = a[i + 1], z = a[i + 2];
      const inside = x > -6.25 + .05 && x < 4.35 - .05 && z > 16.8 + .05 && z < 17.7 - .05 && y > q.hangY + .05 && y < q.top - .3;
      expect(inside, `steel at ${[x, y, z].map(v => v.toFixed(2))}`).toBe(false);
    }
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
    for (let k = 0; k < 9; k++){ const f = build(DEFAULT_STYLE, { mats }); ms.push(f.ms); f.dispose(); }
    ms.sort((a, b) => a - b);
    // (≈ 2–5 ms on a laptop. The FASTEST of nine — a loaded CPU slows some runs, rarely all — and no
    //  absolute bound at all while the machine is saturated: parallel suites made the median flake)
    if (os.loadavg()[0] > .75 * os.cpus().length) return;
    expect(ms[0], `fastest ${ms[0].toFixed(2)} ms (median ${ms[4].toFixed(2)})`).toBeLessThan(20);
  });
});

describe('footing kit: the style contract (hooks, what counts as a draw, the shared rules)', () => {
  it('a hook may return TRUE: handled, nothing added — the kit draws no form, the group gains no node', () => {
    const flushKeys = PLAN.pads.filter(p => p.band === 'flush' && !p.loft && !p.open).map(p => p.key);
    expect(flushKeys.length).toBeGreaterThan(0);
    const seen = [], edgeSeen = [];
    const style = { key: 'claims', flush: spec => { seen.push(spec.key); return true; }, edge: spec => { edgeSeen.push(spec.key); return spec.band === 'flush' ? true : null; } };
    const d = build(), f = build(style);
    expect(seen.sort()).toEqual(flushKeys.slice().sort());
    expect(f.group.children.every(o => o.isMesh), 'only the merged meshes').toBe(true);
    expect(f.group.children.length).toBe(d.group.children.length);
    expect(f.tris).toBeLessThan(d.tris);                                               // (the plinths + their strips are gone)
    const edgeTris = g => g.group.children.find(m => m.name === 'footing:edge').geometry.index.count / 3;
    expect(edgeTris(f)).toBeLessThan(edgeTris(d));
    d.dispose(); f.dispose();
  });
  it('the older idiom still works: an empty Group claims the form exactly like true (and draws nothing)', () => {
    const g = new THREE.Group();
    const a = build({ key: 'grp', flush: () => g }), b = build({ key: 'tru', flush: () => true });
    expect(a.tris).toBe(b.tris);
    expect(footingDraws(a.group)).toEqual(footingDraws(b.group));
    expect(a.group.children.includes(g)).toBe(true);
    a.dispose(); b.dispose();
  });
  it('footingDraws counts what the GPU draws: visible meshes with geometry — never Groups, hidden or empty meshes', () => {
    const f = build(), base = footingDraws(f.group);
    expect(base.draws).toBe(f.group.children.length);
    expect(base.tris).toBe(f.tris);
    f.group.add(new THREE.Group());                                                    // a style's marker
    const hid = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); hid.visible = false; f.group.add(hid);
    f.group.add(new THREE.Mesh(new THREE.BufferGeometry()));                           // no position: nothing to draw
    const inner = new THREE.Group(); inner.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))); f.group.add(inner);
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 3); f.group.add(im);
    expect(footingDraws(f.group)).toEqual({ draws: base.draws + 2, tris: base.tris + 12 + 36 });
    f.dispose();
  });
  it('an OPEN stand reaches the style through its band\'s hook, spec.open set (there is no `open` hook)', () => {
    const tt = PLAN.pads.find(p => p.open);
    const got = [];
    const style = { key: 'open', open: () => { throw new Error('no open hook'); } };
    style[tt.band] = spec => { got.push([spec.key, spec.open, !!spec.feet]); return null; };
    build(style).dispose();
    expect(got.find(g => g[0] === tt.key)).toEqual([tt.key, true, true]);
  });
  it('gapOf / landings are the kit\'s own rules, exported (a style\'s decks meet the kit\'s ladders)', () => {
    expect(gapOf(null)).toEqual([null, 0, 0]);
    const acc = [...PLAN.pads, ...PLAN.lofts].map(p => p.access).filter(Boolean);
    const st = acc.find(a => a.kind === 'stair'), ld = acc.find(a => a.kind === 'ladder');
    expect(gapOf(st)).toEqual([st.side, st.a1 - st.out, st.a1]);
    const [s, g0, g1] = gapOf(ld);
    expect(s).toBe(ld.side); expect(g1 - g0).toBeCloseTo(2 * .33 + .3, 6);
    const tower = PLAN.pads.find(p => p.key === 'tower'), L = landings(tower, FL);
    expect(L.length).toBe((tower.access?.flights || Math.ceil((tower.top - FL) / FOOT.LAND_DY)) - 1);
    for (const y of L){ expect(y).toBeGreaterThan(FL); expect(y).toBeLessThan(tower.top); }
  });
});

describe('footing kit: a style\'s own slot (kit.slot)', () => {
  it('a hook writes its own slot through kit.slot: one more merged mesh in the style\'s material, its envelopes the supports it wrote for', () => {
    const mat = new THREE.MeshStandardMaterial(), hit = new Set();
    const style = { key: 'own', mats: () => ({ mine: mat }), flush(spec, kit){
      const b = kit.slot('mine'); hit.add(kit.unit);
      kit.box('mine', -spec.hw, spec.hw, spec.top - .2, spec.top, -spec.hd, spec.hd);
      return b === kit.slot('mine') ? true : null; } };
    const f = build(style), m = f.group.children.find(o => o.name === 'footing:mine');
    expect(m).toBeTruthy(); expect(m.material).toBe(mat);
    expect(hit.size).toBeGreaterThan(0);
    expect(m.userData.boxes.length).toBe(hit.size);
    f.dispose(); expect(mat.userData.disposed).toBeUndefined();
  });
});

describe('room beams (common.js beamMat)', () => {
  it('the facing term is capped at 1 — MSAA-extrapolated edge samples of a thin cone can\'t blow up into a bloom blob', () => {
    const m = beamMat();
    expect(m.fragmentShader).toContain('pow(min(abs(dot(vN, vV)), 1.), uEdge)');
    expect(m.fragmentShader).not.toMatch(/pow\(abs\(dot\(vN, vV\)\)/);
    m.dispose();
  });
});
