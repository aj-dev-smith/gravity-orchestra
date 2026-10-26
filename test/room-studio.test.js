import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { planFooting, footingBoxes, FOOT } from '../src/rooms/footing.js';
import { buildFooting } from '../src/rooms/footing3d.js';
import { makePulse } from '../src/rooms/pulse.js';
import { STAGE } from '../src/rooms/common.js';
import { studioFooting, openSpot, segCode, TALLY_CODE, STRIP_CODE } from '../src/rooms/studio-footing.js';
import { makeMeter, VU } from '../src/rooms/studio-vu.js';
import { LAYOUT, ATLAS_SIZE, NAMES, STENCILS, atlasUV } from '../src/rooms/studio-atlas.js';
import { micStands, obstacles, boxGap, clearOf, micBox, PROP_CLEAR, MIC } from '../src/rooms/studio-props.js';

/* MIDNIGHT STUDIO (src/rooms/studio*.js): what its machines stand on (a footing style — rug risers,
   carpeted risers, road-case piers, ground support, a mezzanine catwalk), the VU + tally panel that
   answers each machine (pure fns of songTime), and where its mic stands go (pure, clear of everything). */

const FL = STAGE.FLOOR, ROOMB = { x0: -STAGE.HW, x1: STAGE.HW, z0: STAGE.BACK, z1: STAGE.FRONT };
const st = (key, x, z, w, d, h = FOOT.PLINTH, extra = {}) => ({ key, kind: 'station', label: key, color: '#88aaff', x, z, yaw: 0, w, d,
  y: FL + h, bottom: FL + h, low: FL + h, box: [x - w / 2, x + w / 2, FL + h, FL + h + 5, z - d / 2, z + d / 2],
  cue: [{ t: 1 + (key.length % 3), w: 1 }, { t: 6, w: .5 }], P: 20, start: -.6, fixed: false, ...extra });
/* (the footing kit's own crowd — test/footing3d.test.js: every band, both lofts, stair + ladder + cage,
   a turned riser, an open stand, the organ loft hung over the floor) */
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
const STYLE = studioFooting();
STYLE.anchor(PLAN, CROWD);                                       // (the room's place() tells the style where the machines stand)
const build = (plan = PLAN) => buildFooting(plan, STYLE, { boxes: footingBoxes(plan) });
const meshes = f => { const out = []; f.group.traverse(o => { if (o.isMesh) out.push(o); }); return out; };
const inEnv = (B, x, y, z) => { let d = Infinity;
  for (const b of B) d = Math.min(d, Math.hypot(Math.max(b[0] - x, 0, x - b[1]), Math.max(b[2] - y, 0, y - b[3]), Math.max(b[4] - z, 0, z - b[5])));
  return d; };

describe('the studio footing: every band in the room\'s idiom', () => {
  it('draws the whole crowd in ≤ 5 draws: the atlas slot, three kit slots in its materials, one panel light', () => {
    const f = build(), M = meshes(f);
    expect(M.length).toBeLessThanOrEqual(5);
    expect(M.map(m => m.name)).toContain('footing:studio');
    expect(M.map(m => m.name)).toContain('footing:edge');
    for (const m of M) expect(m.userData.footing, m.name).toBe(true);
    const mats = STYLE.mats();
    expect(M.find(m => m.name === 'footing:studio').material).toBe(mats.studio);
    expect(M.find(m => m.name === 'footing:edge').material).toBe(mats.edge);         // (the VU shader: the room lights it)
    f.dispose();
  });
  it('everything it draws stays inside the plan\'s envelopes (the panel\'s LEDs, the rug, the cable tray, the stage box)', () => {
    const f = build(), B = ENV.map(e => e.box);
    for (const m of meshes(f)){
      const p = m.geometry.attributes.position.array;
      let worst = 0, at = null;
      for (let i = 0; i < p.length; i += 3){
        if (p[i + 1] < FL - .2){ worst = Infinity; at = [p[i], p[i + 1], p[i + 2]]; break; }
        const d = inEnv(B, p[i], Math.max(p[i + 1], FL), p[i + 2]);
        if (d > worst){ worst = d; at = [p[i], p[i + 1], p[i + 2]]; }
      }
      expect(worst, `${m.name}: ${worst.toFixed(3)} u out at ${at && at.map(v => v.toFixed(2))}`).toBeLessThanOrEqual(.035);
    }
    f.dispose();
  });
  it('every lifted machine at every height: still inside (a small one, a wide one, the kit, the open stand)', () => {
    for (const u of [0, .5, 1.4, 2.5, 3.5, 5, 8, 12, 16, 24]){
      const lift = a => ({ ...a, y: a.y + u, bottom: a.bottom + u, low: a.low + u, box: [a.box[0], a.box[1], a.box[2] + u, a.box[3] + u, a.box[4], a.box[5]], lift: u });
      const crowd = [CROWD[0], lift(st('bells', 26, -10, 10.9, 6.85)), lift(st('marimba', -18, 8, 16, 5.2)), lift({ ...st('drums', 19, 19, 18, 5.5), kind: 'kit', low: FL + FOOT.PLINTH - .335 }),
        lift(CROWD.find(a => a.key === 'tt'))];
      const plan = planFooting(crowd, { floor: FL, room: ROOMB }), B = footingBoxes(plan).map(e => e.box);
      STYLE.anchor(plan, crowd); const f = build(plan);
      for (const m of meshes(f)){
        const p = m.geometry.attributes.position.array;
        let worst = 0;
        for (let i = 0; i < p.length; i += 3) worst = Math.max(worst, p[i + 1] < FL - .2 ? Infinity : inEnv(B, p[i], Math.max(p[i + 1], FL), p[i + 2]));
        expect(worst, `lift ${u}: ${m.name} ${worst.toFixed(3)} u out`).toBeLessThanOrEqual(.035);
      }
      f.dispose();
    }
  });
  it('every vertex is finite and every atlas uv lands in the atlas (a cable once sampled NaN)', () => {
    const f = build();
    for (const m of meshes(f)) for (const name of ['position', 'normal', 'uv']){
      const at = m.geometry.attributes[name]; if (!at) continue;
      const atlas = name === 'uv' && m.name === 'footing:studio';                       // (the kit's slots: world uvs, repeating)
      let bad = 0; for (const v of at.array) if (!Number.isFinite(v) || (atlas && (v < 0 || v > 1))) bad++;
      expect(bad, `${m.name} ${name}`).toBe(0);
    }
    f.dispose();
  });
  it('every face looks out: its winding agrees with its normal', () => {
    const f = build();
    for (const m of meshes(f)){
      const g = m.geometry, p = g.attributes.position.array, n = g.attributes.normal?.array;
      if (!n) continue;                                                                 // (the panel light: unlit)
      const I = g.index ? g.index.array : Array.from({ length: p.length / 3 }, (_, i) => i);
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
  it('THE PANEL + THE LINE: every machine gets a tally, 12 meter segments and its coloured line, each vertex reading its own slot', () => {
    const f = build(), a = meshes(f).find(m => m.name === 'footing:edge').geometry.attributes.aPulse.array;
    const codes = [...Array.from({ length: 12 }, (_, k) => segCode(k)), TALLY_CODE, STRIP_CODE];
    const slots = new Map(PLAN.pads.map(p => [p.pulse, new Set()]));
    for (const v of a){
      const s = Math.floor(v + 1e-3), c = codes.findIndex(c => Math.abs(v - s - c) < 1e-4);   // (a Float32 attribute)
      expect(slots.has(s), `slot ${s}`).toBe(true);
      expect(c, `code ${(v - s).toFixed(5)}`).toBeGreaterThanOrEqual(0);
      slots.get(s).add(c);
    }
    for (const p of PLAN.pads){
      if (p.open && !openSpot(p)) continue;
      expect(slots.get(p.pulse).size, `${p.key}: ${slots.get(p.pulse).size} codes`).toBe(14);
    }
    f.dispose();
  });
  it('the decks\' rail gaps meet the kit\'s ladders + stairs (its gapOf, restated, still agrees)', () => {
    const top = (f, P) => { const m = meshes(f).find(m => m.name === 'footing:steel'), p = m.geometry.attributes.position.array, out = [];
      const ys = [...P.pads.filter(q => !q.loft && q.access).map(q => q.top), ...P.lofts.filter(L => L.access).map(L => L.top)].map(t => t + FOOT.RAIL);
      for (let i = 0; i < p.length; i += 3) if (ys.some(y => Math.abs(p[i + 1] - y) < 1e-4)) out.push(`${p[i].toFixed(3)},${p[i + 1].toFixed(3)},${p[i + 2].toFixed(3)}`);
      return out.sort(); };
    const a = buildFooting(PLAN, {}, { boxes: ENV }), b = build();
    const A = top(a, PLAN), B = top(b, PLAN);
    expect(B.length).toBeGreaterThan(50);
    expect(B).toEqual(A);
    a.dispose(); b.dispose();
  });
  it('FLUSH: a Persian rug on the floor shows all round each riser (inside its pad), its fringe out at the ends', () => {
    const f = build(), p = meshes(f).find(m => m.name === 'footing:studio').geometry.attributes.position.array;
    for (const pad of PLAN.pads.filter(q => q.band === 'flush' && !q.fixed && !q.open)){
      let rug = 0, out = 0;
      for (let i = 0; i < p.length; i += 3){
        if (Math.abs(p[i + 1] - (FL + .035)) > 1e-5) continue;
        const dx = Math.abs(p[i] - pad.x), dz = Math.abs(p[i + 2] - pad.z);
        if (dx > pad.hw + .01 || dz > pad.hd + .01) continue;
        const a = CROWD.find(q => q.key === pad.key);
        rug++; if (dx > a.w / 2 + .1 || dz > a.d / 2 + .1) out++;
      }
      expect(rug, pad.key).toBeGreaterThan(16); expect(out, pad.key).toBeGreaterThan(8);
    }
    f.dispose();
  });
  it('THE LINE wears its machine\'s colour; a high support\'s meter is drawn big enough to read from the wide', () => {
    const f = build(), g = meshes(f).find(m => m.name === 'footing:edge').geometry, k = g.attributes.aPulse.array, c = g.attributes.aColor.array, P = g.attributes.position.array;
    const col = new THREE.Color(), segH = new Map();
    for (let i = 0; i < k.length; i++){
      const s = Math.floor(k[i] + 1e-3), code = k[i] - s, pad = PLAN.pads.find(q => q.pulse === s);
      if (Math.abs(code - STRIP_CODE) < 1e-4){ col.set(pad.color); expect([c[3 * i], c[3 * i + 1], c[3 * i + 2]].map(v => +v.toFixed(4)), pad.key).toEqual([col.r, col.g, col.b].map(v => +v.toFixed(4))); }
      if (Math.abs(code - segCode(0)) < 1e-4){ const h = segH.get(pad.key) || [Infinity, -Infinity]; h[0] = Math.min(h[0], P[3 * i + 1]); h[1] = Math.max(h[1], P[3 * i + 1]); segH.set(pad.key, h); }
    }
    const H = key => segH.get(key)[1] - segH.get(key)[0];
    expect(H('tower')).toBeGreaterThan(2 * H('bells'));                                 // (14 u up: ≈ 2.3× a flush riser's)
    f.dispose();
  });
  it('HIGH = ground support, not a scaffold: no brace crosses the house\'s face between its towers', () => {
    const f = build(), p = meshes(f).find(m => m.name === 'footing:steel').geometry.attributes.position.array;
    const T = PLAN.pads.find(q => q.key === 'tower'), yH = T.top - .38 - .62, zf = T.z + T.hd - .6, x0 = T.x - T.hw + .6 + 2.2, x1 = T.x + T.hw - .6 - 2.2;
    expect(T.band).toBe('high'); expect(T.access?.side).not.toBe('+v');
    let hits = 0;
    for (let i = 0; i < p.length; i += 3) if (p[i] > x0 && p[i] < x1 && Math.abs(p[i + 2] - zf) < .45 && p[i + 1] > FL + 1.5 && p[i + 1] < yH - 3) hits++;
    expect(hits).toBe(0);
    f.dispose();
  });
  it('the style owns its materials: a build never disposes them, the room does', () => {
    const s = studioFooting(), m = s.mats(null, {});
    let gone = 0; for (const x of Object.values(m)) x.addEventListener('dispose', () => gone++);
    const f = buildFooting(PLAN, s, { boxes: ENV }); f.dispose();
    expect(gone).toBe(0);
    expect(s.mats()).toBe(m);                                                           // (made once)
    s.dispose(); expect(gone).toBe(Object.keys(m).length);
  });
});

describe('the open stand\'s stage box (openSpot)', () => {
  const tt = (u = 0) => ({ ...CROWD.find(a => a.key === 'tt'), lift: u, y: -1.29 + u, bottom: -1.29 + u, low: -5.1 + u });
  for (const u of [0, 6, 14]) it(`clear of every post + plate and of what hangs, on the house side, inside the pad (lift ${u})`, () => {
    const p = planFooting([tt(u)], { floor: FL, room: ROOMB }).pads[0];
    expect(p.open).toBe(true);
    const s = openSpot(p);
    expect(s).not.toBe(null);
    const u0 = s.u - s.cw / 2, u1 = s.u + s.cw / 2, v0 = s.v - s.cd / 2, v1 = s.v + s.cd / 2;
    expect(u0).toBeGreaterThanOrEqual(-p.hw); expect(u1).toBeLessThanOrEqual(p.hw);
    expect(v0).toBeGreaterThanOrEqual(-p.hd); expect(v1).toBeLessThanOrEqual(p.hd);
    for (const [fu, fv] of p.feet) expect(Math.max(u0 - fu, fu - u1, v0 - fv, fv - v1), 'a post').toBeGreaterThan(.35);
    const H = p.hang; expect(Math.max(u0 - H[1], H[0] - u1, v0 - H[3], H[2] - v1), 'the hang').toBeGreaterThan(.2);
    expect(s.side).toBe('+v');                                                          // (it faces the house)
  });
});

describe('the VU meter + tally (studio-vu.js): pure functions of songTime', () => {
  const cue = [{ t: 1, w: 1 }, { t: 1.25, w: .8 }, { t: 1.5, w: 1 }, { t: 7, w: .4 }, { t: 18.9, w: 1 }], P = 20, start = -.6;
  const m = makeMeter(cue, { P, start });
  it('silent in the count-in (before start nothing happened) — a strike at the loop\'s end never leaks into it', () => {
    for (const t of [-2.4, -1.5, -.61]){ expect(m.level(t)).toBe(0); expect(m.peak(t)).toBe(0); }
    expect(m.tally(-2.4)).toBe(0);
    expect(m.level(.5)).toBe(0);                                                        // (18.9 of the loop BEFORE never played)
    expect(m.level(20.5)).toBeGreaterThan(0);                                           // (… but it rings across the seam after loop 1)
  });
  it('scrub-exact and periodic once a loop has played', () => {
    const ts = [1.01, 1.6, 3.3, 7.2, 12, 19, 19.9];
    const a = ts.map(t => [m.level(t + P), m.peak(t + P), m.tally(t + P)]);
    m.level(55.5); m.peak(3); m.tally(-1);
    expect(ts.map(t => [m.level(t + P), m.peak(t + P), m.tally(t + P)])).toEqual(a);
    for (const t of ts) for (const f of ['level', 'peak', 'tally']) expect(m[f](t + 2 * P), `${f} @${t}`).toBeCloseTo(m[f](t + P), 12);
  });
  it('a strike lights the meter, a run pins it, then it falls; the peak holds above the level; the tally covers the phrase', () => {
    const one = makeMeter([{ t: 5, w: 1 }], { P, start });
    expect(one.level(5 + 1e-6)).toBeGreaterThan(.55); expect(one.level(5 + 1e-6)).toBeLessThan(.7);
    expect(m.level(1.5 + 1e-6)).toBeGreaterThan(.75);                                   // (three in half a second: into the amber)
    const run = makeMeter(Array.from({ length: 16 }, (_, i) => ({ t: 2 + i / 8, w: 1 })), { P, start });
    expect(run.level(3.875 + 1e-6)).toBeGreaterThan(.92);                               // (a run of 16ths pins it in the red)
    expect(m.level(3)).toBeLessThan(.05);
    for (const t of [1.2, 1.7, 1.9, 2.2]) expect(m.peak(t)).toBeGreaterThanOrEqual(m.level(t) - 1e-9);
    expect(m.peak(1.5 + VU.HOLD - .01)).toBeCloseTo(m.level(1.5 + 1e-9), 6);           // (held)
    expect(m.tally(3)).toBe(1); expect(m.tally(1.5 + VU.TALLY_HOLD + VU.TALLY_FADE + .01)).toBe(0);
    expect(m.tally(7 - .1)).toBeGreaterThan(0);                                         // (it rises before a strike after a rest)
    for (const t of [-1, 0, 1, 1.3, 2, 6.9, 7, 9.5, 19.5, 25]) for (const f of ['level', 'peak', 'tally']){
      const v = m[f](t); expect(v, `${f} @${t}`).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1);
    }
  });
  it('the tally\'s anticipation is the kit\'s makePulse (the same lead rule)', () => {
    const lead = makePulse(cue.map(c => ({ t: c.t, w: 1 })), { P, start, lead: VU.TALLY_LEAD });
    for (const t of [6.7, 6.8, 6.95, 18.7, 18.85]) expect(m.tally(t)).toBeCloseTo(Math.max(0, Math.sqrt(lead.next(t))), 9);
  });
  it('no cue, no light', () => {
    const z = makeMeter([], { P, start });
    expect([z.level(3), z.peak(3), z.tally(3)]).toEqual([0, 0, 0]);
  });
});

describe('the mic stands (studio-props.js): pure, and clear of everything', () => {
  const room = { x0: -49, x1: 49, z0: -21, z1: 40 };
  const M = micStands(CROWD, PLAN, room), OBS = obstacles(CROWD, PLAN);
  it('one boom stand per floor machine that fits (flush / low supports — never the belt, a loft, a deck or the open stand)', () => {
    const keys = M.map(s => s.key);
    expect(keys.length).toBeGreaterThan(2);
    for (const k of keys){
      const p = PLAN.pads.find(q => q.key === k);
      expect(['flush', 'low']).toContain(p.band);
      expect(p.fixed || p.loft || p.open).toBeFalsy();
    }
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('every stand keeps PROP_CLEAR from every machine (the hung organ too), every support, every other stand — inside the room', () => {
    expect(OBS.length).toBe(CROWD.length + ENV.length);
    for (const s of M){
      for (const o of OBS) expect(boxGap(s.box, o), `${s.key}`).toBeGreaterThanOrEqual(PROP_CLEAR - 1e-9);
      for (const q of M) if (q !== s) expect(boxGap(s.box, q.box)).toBeGreaterThanOrEqual(PROP_CLEAR - 1e-9);
      expect(s.box[0]).toBeGreaterThanOrEqual(room.x0); expect(s.box[1]).toBeLessThanOrEqual(room.x1);
      expect(s.box[4]).toBeGreaterThanOrEqual(room.z0); expect(s.box[5]).toBeLessThanOrEqual(room.z1);
      expect(s.box).toEqual(micBox(s.x, s.z, s.heading, FL));
    }
  });
  it('its boom reaches toward the machine it mics, on the side the house sees', () => {
    for (const s of M){
      const p = PLAN.pads.find(q => q.key === s.key);
      const dx = p.x - s.x, dz = p.z - s.z, L = Math.hypot(dx, dz);
      expect((Math.cos(s.heading) * dx + Math.sin(s.heading) * dz) / L).toBeGreaterThan(.99);
      expect(s.z, s.key).toBeGreaterThan(p.z - 1e-9);                                    // (the house is at +z)
    }
  });
  it('the room\'s own floor props are obstacles too', () => {
    const tube = M[0] && [M[0].x - .5, M[0].x + .5, FL, FL + 14, M[0].z - .5, M[0].z + .5];
    const N = micStands(CROWD, PLAN, room, [tube]);
    for (const s of N) expect(boxGap(s.box, tube)).toBeGreaterThanOrEqual(PROP_CLEAR - 1e-9);
    expect(N.find(s => s.key === M[0].key)?.x).not.toBe(M[0].x);
  });
  it('deterministic: the same anchors + plan, the same stands; none without a plan', () => {
    expect(micStands(CROWD, PLAN, room)).toEqual(M);
    expect(micStands(CROWD, null, room)).toEqual([]);
  });
  it('boxGap / clearOf', () => {
    expect(boxGap([0, 1, 0, 1, 0, 1], [2, 3, 0, 1, 0, 1])).toBeCloseTo(1, 12);
    expect(boxGap([0, 1, 0, 1, 0, 1], [.5, 3, .5, 1, -1, 2])).toBe(0);
    expect(boxGap([0, 1, 0, 1, 0, 1], [4, 5, 5, 6, 0, 1])).toBeCloseTo(5, 12);
    expect(clearOf([0, 1, 0, 1, 0, 1], [[2.5, 3, 0, 1, 0, 1]])).toBe(true);
    expect(clearOf([0, 1, 0, 1, 0, 1], [[1.5, 3, 0, 1, 0, 1]])).toBe(false);
    expect(MIC.TOP).toBeLessThan(4);                                                    // (a boom stand: ≈ 1.9 m)
  });
});

describe('the studio atlas layout', () => {
  const inside = (c, r) => c[0] >= r[0] && c[1] >= r[1] && c[0] + c[2] <= r[0] + r[2] && c[1] + c[3] <= r[1] + r[3];
  it('every region lies on the canvas and no two overlap', () => {
    const [W, H] = ATLAS_SIZE, regs = Object.entries(LAYOUT);
    for (const [k, r] of regs) expect(inside(r, [0, 0, W, H]), k).toBe(true);
    for (let i = 0; i < regs.length; i++) for (let j = i + 1; j < regs.length; j++){
      const [a, A] = regs[i], [b, B] = regs[j];
      const hit = A[0] < B[0] + B[2] && B[0] < A[0] + A[2] && A[1] < B[1] + B[3] && B[1] < A[1] + A[3];
      expect(hit, a + ' × ' + b).toBe(false);
    }
  });
  it('every name and stencil cell lies inside its own region, its uv in [0, 1]', () => {
    const R = atlasUV();
    expect(Object.keys(R.name).length).toBe(Object.keys(NAMES).length);
    expect(R.stencil.length).toBe(STENCILS.length);
    for (const [k, c] of Object.entries(R.name)) expect(inside(c.px, LAYOUT.names), 'name ' + k).toBe(true);
    R.stencil.forEach((c, i) => expect(inside(c.px, LAYOUT.stencils), 'stencil ' + i).toBe(true));
    for (const c of [...Object.values(R.name), ...R.stencil]) for (const v of [c.s0, c.s1, c.t0, c.t1]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});
