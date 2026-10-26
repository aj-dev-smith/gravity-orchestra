import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import starship, { bankAt, beatPulse, loopBeat, streakZ, skyClock, BANK, STREAK, T_WRAP } from '../src/rooms/starship.js';
import { ROOMS, ROOM_KEYS } from '../src/rooms/index.js';
import { planFooting, footingBoxes, FOOT } from '../src/rooms/footing.js';
import { buildFooting, makeFootingMats } from '../src/rooms/footing3d.js';
import { STAGE } from '../src/rooms/common.js';
import { shipFooting, lampMaterial } from '../src/rooms/starship-footing.js';
import { SHIP, makeStrikeClock, makeDeckLights, cueLight, CUE, lampLayout, deckProps, rectsWithin, deckSpots, DECK_PROPS, beaconPocket } from '../src/rooms/starship-deck.js';
import { toWorld } from '../src/rooms/footing.js';

/* The Starship deck's moving sky is a pure fn of songTime: the banking turns land on bar lines,
   are level through the loop's breath (seamless at the loop seam), and the star field is exactly
   periodic in T_WRAP (scrub-safe, no float drift over a long session). */
const ROLL_T = 2.6;
const cuesFor = (bpm, melodyBeats) => { const beat = 60 / bpm; return { rollT: ROLL_T, beat, P: ROLL_T + melodyBeats * beat + 1.2 }; };
const SONGS = [cuesFor(110.53, 112), cuesFor(94.7, 64), cuesFor(189.5, 36), cuesFor(120, 4)];

describe('starship room', () => {
  it('is registered in the room host', () => {
    expect(ROOMS).toContain(starship);
    expect(ROOM_KEYS).toContain('starship');
    expect(starship.label).toBe('Starship');
  });

  it('banking: level with no cue, bounded, level through the roll-in and at the seam', () => {
    expect(bankAt(5, null)).toBe(0);
    for (const c of SONGS){
      for (let t = -2.4; t < 3 * c.P; t += .01) expect(Math.abs(bankAt(t, c))).toBeLessThanOrEqual(BANK.roll + 1e-12);
      for (let u = 0; u < c.rollT; u += .05) expect(bankAt(u, c)).toBeCloseTo(0, 12);           // roll-in (before the downbeat)
      expect(bankAt(c.P - 1e-6, c)).toBeCloseTo(0, 9);                              // the seam
      expect(bankAt(c.P, c)).toBeCloseTo(0, 12);
    }
  });

  it('banking is periodic in the loop and continuous (C1: no snaps, no kinks)', () => {
    for (const c of SONGS){
      const h = .002;
      let prev = bankAt(-2.4, c), prevD = (prev - bankAt(-2.4 - h, c)) / h, maxStep = 0, maxDD = 0;
      for (let t = -2.4 + h; t < 2.2 * c.P; t += h){
        const b = bankAt(t, c), d = (b - prev) / h;
        maxStep = Math.max(maxStep, Math.abs(b - prev)); maxDD = Math.max(maxDD, Math.abs(d - prevD));
        prev = b; prevD = d;
        expect(bankAt(t + c.P, c)).toBeCloseTo(b, 9);
      }
      expect(maxStep).toBeLessThan(BANK.roll * .01);
      expect(maxDD).toBeLessThan(.01);
    }
  });

  it('turns start on bar lines and alternate starboard / port', () => {
    const c = SONGS[0], bar = BANK.bar * c.beat, ph = 4 * bar;
    const at = (beatPos) => bankAt(c.rollT + beatPos * c.beat, c);
    expect(at(0)).toBe(0);
    expect(at(.5)).toBeGreaterThan(0);                                              // eases in right after the downbeat
    expect(at(8)).toBeCloseTo(BANK.roll, 12);                                       // held mid-phrase
    expect(at(16)).toBeCloseTo(0, 12);                                              // level on the phrase line
    expect(at(24)).toBeCloseTo(-BANK.roll, 12);                                     // next phrase banks the other way
    expect(ph).toBeGreaterThan(0);
    // a short loop (< 8 bars) banks on 2-bar phrases; one shorter than a phrase stays level
    const short = SONGS[2]; expect(Math.abs(bankAt(short.rollT + 4 * short.beat, short))).toBeGreaterThan(0);
    const tiny = SONGS[3]; for (let t = 0; t < tiny.P; t += .05) expect(bankAt(t, tiny)).toBeCloseTo(0, 12);
  });

  it('engine beat thump is in [0, 1] and peaks on the beat', () => {
    const c = SONGS[1];
    for (let t = -2.4; t < 2 * c.P; t += .013){ const p = beatPulse(t, c); expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThanOrEqual(1); }
    expect(beatPulse(c.rollT + 3 * c.beat + 1e-9, c)).toBeCloseTo(1, 6);
  });

  it('beat-locked lights count the LOOP\'s beats: every downbeat of every loop is beat 0 (the breath never drifts them)', () => {
    for (const c of SONGS){
      expect(loopBeat(1, null)).toBeNaN();
      for (const k of [0, 1, 5, 40]) for (const j of [0, 3, 7]){
        const t = k * c.P + c.rollT + j * c.beat;
        if (j * c.beat >= c.P - c.rollT) continue;
        expect(loopBeat(t, c)).toBeCloseTo(j, 6);
        expect(beatPulse(t + 1e-9, c)).toBeCloseTo(1, 5);
      }
    }
  });

  it('star field: periodic in T_WRAP, moving aft, wrapping only inside the field', () => {
    for (const t of [-2.4, 0, 13.7, 59.99, 3600.25, 86400.5]) expect(skyClock(t)).toBeGreaterThanOrEqual(0), expect(skyClock(t)).toBeLessThan(T_WRAP);
    for (let n = STREAK.n0; n <= STREAK.n1; n++) for (const z0 of [0, 77.7, 300]){
      for (const t of [-2.4, 1.3, 47.9]){
        const z = streakZ(z0, n, t);
        expect(z).toBeGreaterThanOrEqual(STREAK.z0); expect(z).toBeLessThan(STREAK.z0 + STREAK.L);
        expect(streakZ(z0, n, t + T_WRAP)).toBeCloseTo(z, 6);                       // exactly periodic
        expect(streakZ(z0, n, t + 7 * T_WRAP)).toBeCloseTo(z, 6);
        const z2 = streakZ(z0, n, t + .01), v = n * STREAK.L / T_WRAP;
        if (z2 > z) expect(z2 - z).toBeCloseTo(v * .01, 6);                          // steady +z (aft) between wraps
      }
    }
  });
});

/* ============ the deck the machines stand on: ship hardware (starship-footing.js) + its lights (starship-deck.js) ============ */
const FL = STAGE.FLOOR, ROOMB = { x0: -STAGE.HW, x1: STAGE.HW, z0: STAGE.BACK, z1: STAGE.FRONT };
const st = (key, x, z, w, d, h = FOOT.PLINTH, extra = {}) => ({ key, kind: 'station', label: key, color: '#88aaff', x, z, yaw: 0, w, d,
  y: FL + h, bottom: FL + h, low: FL + h, box: [x - w / 2, x + w / 2, FL + h, FL + h + 5, z - d / 2, z + d / 2],
  cue: [{ t: 1 + (key.length % 3), w: 1 }, { t: 6, w: .5 }], P: 20, start: -.6, fixed: false, ...extra });
/* every band: the belt, the kit, plinths, a dais, platforms (stair / ladder), a tower, a gallery loft and a mid
   loft, a turned riser, an open stand, the organ hung over the floor (test/footing3d.test.js's crowd) */
const CROWD = [
  { key: 'belt', kind: 'belt', color: '#ffaa55', x: 0, z: -1.17, yaw: 0, w: 21.74, d: 5.77, y: FL, bottom: FL, low: FL, box: [-10.87, 10.87, FL, 15.83, -4.05, 1.72], cue: [{ t: 3, w: 1 }], P: 20, start: -.6, fixed: true },
  { ...st('drums', 19, 19, 18, 5.5), kind: 'kit', color: '#ff8a3d', low: FL + FOOT.PLINTH - .335 },
  st('bass', -20, 5, 11.7, 7.8), st('bells', 26, -10, 10.9, 6.85),
  st('dais', -27, 20, 10, 6, 2.4), st('plat', 0, 30, 10, 6, 5), st('platL', 20, 33, 10, 6, 8), st('tower', -20, -10, 12, 6, 14),
  st('g1', -10, -24, 12, 4, 19.33), st('g2', 4.5, -24, 12, 4, 19.33), st('m1', 28, 6, 8, 5, 6), st('m2', 28, -1, 8, 5, 6.2),
  st('yawed', -30, 32, 6, 4, 3, { yaw: .6 }), st('lowlift', -33, -2, 7, 4, 1.1),
  { ...st('tt', -6, 15, 14.2, 14.1, -1.29 - FL), low: -5.1, feet: [[-5.5, -4.5, .7], [5.5, -4.5, .7], [-5.5, 4.5, .7], [5.5, 4.5, .7]], hang: [-6.25, 4.35, 4.8, 5.7] },
  { key: 'organ', kind: 'hung', x: 0, z: -13.65, yaw: 0, w: 13.16, d: 4.64, y: 16, box: [-6.58, 6.58, FL, 24.54, -15.97, -11.33], cue: [], P: 20, start: -.6, fixed: true },
];
const PLAN = planFooting(CROWD, { floor: FL, room: ROOMB }), ENV = footingBoxes(PLAN);
const MATS = makeFootingMats(), LAMPS = lampMaterial();
const STYLE = shipFooting({ lamps: LAMPS });
const buildShip = (plan = PLAN, style = STYLE) => buildFooting(plan, style, { boxes: footingBoxes(plan), mats: MATS });
const meshesOf = f => { const out = []; f.group.traverse(o => { if (o.isMesh) out.push(o); }); return out; };
/* how far a point is outside the nearest of a set of boxes (0: inside one) */
const outside = (B, x, y, z) => { let d = Infinity; for (const b of B) d = Math.min(d, Math.hypot(Math.max(b[0] - x, 0, x - b[1]), Math.max(b[2] - y, 0, y - b[3]), Math.max(b[4] - z, 0, z - b[5]))); return d; };
/* the heights where a mesh's triangles cross the vertical line through (x, z) */
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

describe('starship footing: ship hardware, drawn', () => {
  it('the crowd covers every form', () => {
    const bands = new Set(PLAN.pads.map(p => p.open ? 'open' : p.band));
    for (const b of ['flush', 'low', 'mid', 'high', 'open']) expect(bands.has(b), b).toBe(true);
    expect(PLAN.lofts.map(L => L.band).sort()).toEqual(['high', 'mid']);
    const acc = [...PLAN.pads, ...PLAN.lofts].filter(p => p.access).map(p => p.access.kind);
    expect(acc).toContain('stair'); expect(acc).toContain('ladder');
    expect(PLAN.pads.some(p => p.band === 'low' && p.top - FL - .32 > 1.25)).toBe(true);    // (a scissor lift, and squat rams)
  });
  it('a few draws, whatever stands on it: a mesh per material + ONE for every machine\'s lights (no kit edge)', () => {
    const f = buildShip(), M = meshesOf(f);
    expect(M.map(m => m.name).sort()).toEqual(['footing:chrome', 'footing:deck', 'footing:grate', 'footing:hazard', 'footing:lamps', 'footing:steel']);
    expect(f.group.children.length).toBe(M.length);                              // (footStats counts children: every one draws)
    for (const m of M) expect(m.userData.footing, m.name).toBe(true);
    f.dispose();
  });
  it('everything it draws — lights too — stays inside the plan\'s envelopes (the crowd; a tall open stand + its ladder; every band lifted)', () => {
    const tt = u => ({ ...st('turntable', 0, 12, 14.22, 14.12, -1.29 - FL + u), y: -.93 + u, ground: -.93, lift: u, low: -5.1 + u,
      feet: [[-5.5, -4.5, .7], [5.5, -4.5, .7], [-5.5, 4.5, .7], [5.5, 4.5, .7]], hang: [-6.25, 4.35, 4.8, 5.7] });
    const plans = [PLAN, ...[2, 9, 20].map(u => planFooting([tt(u), st('bells', -18, 12, 10.9, 6.85, .4 + u * .6), st('marimba', 22, 12, 14, 6, .4 + u)], { floor: FL, room: ROOMB }))];
    for (const plan of plans){
    const f = buildShip(plan), B = footingBoxes(plan).map(e => e.box);
    for (const m of meshesOf(f)){
      const p = m.geometry.attributes.position.array;
      let worst = 0, at = null;
      for (let i = 0; i < p.length; i += 3){
        const d = outside(B, p[i], p[i + 1], p[i + 2]);                       // (the envelopes start AT the floor: nothing under it)
        if (d > worst){ worst = d; at = [p[i], p[i + 1], p[i + 2]]; }
      }
      expect(worst, `${m.name}: ${worst.toFixed(3)} u out at ${at && at.map(v => v.toFixed(2))}`).toBeLessThanOrEqual(.005);
    }
    f.dispose();
    }
  });
  it('every face looks out (winding agrees with its normal)', () => {
    const f = buildShip();
    for (const m of meshesOf(f)){
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
  it('the lights face out of their channels and read real slots (their machines\')', () => {
    const f = buildShip(), L = meshesOf(f).find(m => m.name === 'footing:lamps');
    const slots = new Set(PLAN.pads.map(p => p.pulse));
    for (const v of L.geometry.attributes.aSlot.array) expect(v === -1 || slots.has(v), `slot ${v}`).toBe(true);
    // every slot that strikes has lights (a running ring, or the loft's fascia) and a beacon
    const lamps = lampLayout(PLAN);
    for (const p of PLAN.pads){
      expect(lamps.some(l => l.kind === 0 && l.slot === p.pulse), `${p.key} runs`).toBe(true);
      expect(lamps.filter(l => l.kind === 1 && l.slot === p.pulse).length, `${p.key} beacon`).toBe(1);
    }
    // a lamp quad faces where it says (front-facing: seen from outside its plate)
    const pos = L.geometry.attributes.position.array, I = L.geometry.index.array;
    let flat = 0;
    for (let t = 0; t < I.length; t += 6){
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-9) flat++;
    }
    expect(flat).toBe(0);
    f.dispose();
  });
  it('a plate\'s / a dais\'s status beacon lies in a pocket let into its top (seen from above), the pocket really there', () => {
    const f = buildShip(), steel = meshesOf(f).find(m => m.name === 'footing:steel'), lamps = lampLayout(PLAN);
    let n = 0;
    for (const p of PLAN.pads){
      const bp = beaconPocket(p);
      if (!bp) continue;
      n++;
      const [x, z] = toWorld(p, bp.u, bp.v), L = lamps.find(l => l.kind === 1 && l.slot === p.pulse);
      expect(L.n, p.key).toEqual([0, 1, 0]);
      expect(Math.hypot(L.c[0] - x, L.c[2] - z), p.key).toBeLessThan(1e-9);
      expect(L.c[1]).toBeLessThan(p.top); expect(L.c[1]).toBeGreaterThan(p.top - bp.depth + .02);   // (over the pocket's floor, under the top)
      const ys = crossing(steel, x + .01, z + .01).filter(y => y < p.top + 1e-6 && y > p.top - .2);
      expect(ys.some(y => Math.abs(y - (p.top - bp.depth + .02)) < 1e-6), `${p.key}: pocket floor`).toBe(true);
    }
    expect(n).toBeGreaterThanOrEqual(5);
    f.dispose();
  });
  it('a machine that dips into its support (the kit\'s pistons: well) — the deck is solid that deep, at every height', () => {
    const kit = (h, x = 0) => ({ ...st('drums', x, 12, 18, 5.5, h), kind: 'kit', low: FL + h - .335 });
    for (const h of [FOOT.PLINTH, 1.1, 2.4, 6, 14]){
      const p = planFooting([kit(h)], { floor: FL, room: ROOMB }), q = p.pads[0];
      expect(q.well).toBeCloseTo(.335, 12);
      const f = buildShip(p), M = meshesOf(f).filter(m => m.name !== 'footing:lamps' && m.name !== 'footing:grate');
      const ys = M.flatMap(m => crossing(m, q.x + .37, q.z - .21)).filter(y => y < q.top + 1e-6).sort((a, b) => b - a);
      expect(ys[0], `${q.band}: its top`).toBeCloseTo(q.top, 6);
      if (q.band === 'flush') expect(q.h, 'a plate as deep as its well').toBeGreaterThanOrEqual(q.well + .03);
      else {
        const under = ys.find(y => y < q.top - .05);                                  // (the slab's underside: the next face down)
        expect(q.top - under, `${q.band}: deck ${(q.top - under).toFixed(3)} deep`).toBeGreaterThanOrEqual(q.well + .03);
      }
      f.dispose();
    }
  });
  it('an OPEN stand: a ram under every foot, nothing through what hangs, lifted or not', () => {
    const tt = u => ({ ...st('turntable', 0, 12, 14.22, 14.12, -1.29 - FL + u), y: -.93 + u, ground: -.93, lift: u, low: -5.1 + u,
      feet: [[-5.5, -4.5, .7], [5.5, -4.5, .7], [-5.5, 4.5, .7], [5.5, 4.5, .7]], hang: [-6.25, 4.35, 4.8, 5.7] });
    for (const u of [0, 3, 14]){
      const p = planFooting([tt(u)], { floor: FL, room: ROOMB }), q = p.pads[0], f = buildShip(p);
      expect(q.open).toBe(true);
      for (const m of meshesOf(f)){
        if (m.name === 'footing:lamps') continue;
        const a = m.geometry.attributes.position.array;
        for (let i = 0; i < a.length; i += 3){
          const x = a[i], y = a[i + 1], z = a[i + 2];
          const inside = x > -6.25 + .05 && x < 4.35 - .05 && z > 16.8 + .05 && z < 17.7 - .05 && y > q.hangY + .05 && y < q.top - .3;
          expect(inside, `${m.name} at ${[x, y, z].map(v => v.toFixed(2))} (lift ${u})`).toBe(false);
        }
      }
      // a post under each foot: steel or chrome crossing the floor within its foot's radius
      for (const [fu, fv] of q.feet){
        const hit = meshesOf(f).filter(m => m.name === 'footing:chrome' || m.name === 'footing:steel')
          .some(m => crossing(m, q.x + fu + .01, q.z + fv + .01).length);
        expect(hit, `foot ${fu},${fv} (lift ${u})`).toBe(true);
      }
      f.dispose();
    }
  });
  it('fast: the crowd\'s footing builds in a few ms (a height drag rebuilds it live)', () => {
    for (let k = 0; k < 3; k++) buildShip().dispose();
    const ms = [];
    for (let k = 0; k < 7; k++){ const f = buildShip(); ms.push(f.ms); f.dispose(); }
    ms.sort((a, b) => a - b);
    expect(ms[3], `median ${ms[3].toFixed(2)} ms`).toBeLessThan(25);
  });
  it('the style\'s materials are the room\'s: made once, never freed by a footing; the lamps\' geometry goes with its build', () => {
    const a = buildShip(), b = buildShip();
    const mat = (f, n) => meshesOf(f).find(m => m.name === n).material;
    expect(mat(a, 'footing:steel')).toBe(mat(b, 'footing:steel'));
    expect(mat(a, 'footing:lamps')).toBe(LAMPS);
    let gone = 0; mat(a, 'footing:steel').addEventListener('dispose', () => gone++);
    let geo = 0; meshesOf(a).find(m => m.name === 'footing:lamps').geometry.addEventListener('dispose', () => geo++);
    a.dispose(); b.dispose();
    expect(gone).toBe(0); expect(geo).toBe(1);
  });
});

describe('starship deck lights: a pure fn of songTime', () => {
  const CUEZ = [{ t: .5, w: 1 }, { t: 3.25, w: .4 }, { t: 3.5, w: .8 }, { t: 9.9, w: .6 }];
  const P = 12, START = -.6;
  /* brute force: every strike of every loop that happened (≥ start) */
  const all = [];
  for (let k = -2; k < 6; k++) for (const c of CUEZ){ const s = k * P + c.t; if (s >= START) all.push({ s, w: c.w }); }
  all.sort((a, b) => a.s - b.s);
  it('the strike clock: the latest two strikes + the next — exactly, across the seam; nothing before start', () => {
    const C = makeStrikeClock(CUEZ, { P, start: START }), out = new Float64Array(6);
    for (let t = -2.4; t < 40; t += .0731){
      C.read(t, out);
      const past = all.filter(e => e.s <= t), next = all.find(e => e.s > t) || null;
      const a1 = past[past.length - 1], a2 = past[past.length - 2];
      if (a1){ expect(out[0]).toBeCloseTo(t - a1.s, 9); expect(out[1]).toBe(a1.w); } else expect(out[0]).toBe(1e4);
      if (a2){ expect(out[2]).toBeCloseTo(t - a2.s, 9); expect(out[3]).toBe(a2.w); } else expect(out[2]).toBe(1e4);
      if (next){ expect(out[4]).toBeCloseTo(next.s - t, 9); expect(out[5]).toBe(next.w); }
    }
    // scrub-exact: the same t reads the same, whatever was read before
    C.read(17.3, out); const a = Array.from(out); C.read(2, out); C.read(17.3, out); expect(Array.from(out)).toEqual(a);
    // the count-in is dark
    C.read(-1, out); expect(out[0]).toBe(1e4); expect(out[2]).toBe(1e4);
    // no cue: never lit
    makeStrikeClock([], { P, start: START }).read(5, out); expect(out[0]).toBe(1e4); expect(out[4]).toBe(1e4);
  });
  it('the cue light: only before an entrance after a rest, 1 exactly at the strike', () => {
    expect(cueLight(CUE.REST + 1, 0)).toBeCloseTo(1, 12);
    expect(cueLight(CUE.REST - .01, .2)).toBe(0);                                 // (no rest: no cue)
    expect(cueLight(CUE.REST + 1, CUE.T + .01)).toBe(0);                          // (not yet)
    expect(cueLight(1e4, .3, 20)).toBeGreaterThan(0);                              // (a first entrance counts…)
    expect(cueLight(1e4, .3, -.2)).toBe(0);                                        // (…but never lights the count-in)
    expect(cueLight(1e4, .3, 1.29)).toBe(0); expect(cueLight(1e4, .3, 1.31)).toBeGreaterThan(0);
    // one soft rise, never a blink: monotone up to the entrance
    let prev = -1;
    for (let e = CUE.T; e >= 0; e -= .01){ const v = cueLight(5, e); expect(v).toBeGreaterThanOrEqual(prev - 1e-12); expect(v).toBeLessThanOrEqual(1); prev = v; }
  });
  it('every slot\'s lights, written per frame: the count-in dark, scrub-exact, never NaN', () => {
    const D = makeDeckLights(PLAN), S = new Float32Array(4 * FOOT.MAX_PULSE).fill(1e4), B = new Float32Array(4 * FOOT.MAX_PULSE);
    expect(D.n).toBe(PLAN.pulses.length);
    D.write(-1.2, S, B);
    for (const t of [-2.4, -1.2, -.61, -.3, -.01]){
      D.write(t, S, B);
      for (let i = 0; i < D.n; i++){ expect(S[4 * i + 1]).toBe(0); expect(S[4 * i + 3]).toBe(0); expect(B[4 * i]).toBe(0); expect(B[4 * i + 1], `cue ${i} at ${t}`).toBe(0); }
    }
    D.write(7.3, S, B); const a = [...S, ...B];
    D.write(2.2, S, B); D.write(7.3, S, B); expect([...S, ...B]).toEqual(a);
    expect(a.every(Number.isFinite)).toBe(true);
    // a machine that just struck: its chase starts at 0, its beacon lit
    const s0 = PLAN.pulses[0], t = s0.cue[0].t + 3 * s0.P + 1e-6;
    D.write(t, S, B); expect(S[0]).toBeCloseTo(0, 4); expect(B[0]).toBeGreaterThan(.5);
    makeDeckLights(null).write(3, S, B);                                            // (no plan: nothing to write)
  });
});

describe('starship deck furniture: clear of every machine and what it stands on', () => {
  it('rectsWithin agrees with a brute-force distance between turned rects', () => {
    const corners = r => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => { const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
      return [r.x + c * a * r.hw + s * b * r.hd, r.z - s * a * r.hw + c * b * r.hd]; });
    const segD = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); };
    const inside = (p, r) => { const c = Math.cos(r.yaw), s = Math.sin(r.yaw), dx = p[0] - r.x, dz = p[1] - r.z;
      return Math.abs(c * dx - s * dz) <= r.hw && Math.abs(s * dx + c * dz) <= r.hd; };
    const dist = (A, B) => { const a = corners(A), b = corners(B);
      if (a.some(p => inside(p, B)) || b.some(p => inside(p, A))) return 0;
      let d = Infinity; for (let i = 0; i < 4; i++) for (const p of b) d = Math.min(d, segD(p, a[i], a[(i + 1) % 4]));
      for (let i = 0; i < 4; i++) for (const p of a) d = Math.min(d, segD(p, b[i], b[(i + 1) % 4])); return d; };
    let s = 7; const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
    let agree = 0;
    for (let k = 0; k < 600; k++){
      const A = { x: R() * 10, z: R() * 10, yaw: R() * 3, hw: .3 + R() * 2, hd: .3 + R() * 2 }, B = { x: R() * 10, z: R() * 10, yaw: 0, hw: .3 + R() * 3, hd: .3 + R() * 3 };
      const d = dist(A, B);
      if (d < 1) expect(rectsWithin(A, B, 1), `${d}`).toBe(true);                   // (never misses one too close)
      if (d > Math.SQRT2 + 1e-9) expect(rectsWithin(A, B, 1), `${d}`).toBe(false);   // (square-grown corners: at most √2 · gap conservative)
      agree++;
    }
    expect(agree).toBe(600);
  });
  it('the deck\'s own spots: hatches on the plate grid inside the stage, apart; cargo outboard of it (never in a shot)', () => {
    const { hatches, cargo } = deckSpots();
    expect(deckSpots()).toEqual({ hatches, cargo });                                  // (fixed: a pure fn)
    expect(hatches.length).toBeGreaterThan(12);
    for (const h of hatches){
      expect(((h.x % 4) + 4) % 4, `${h.x}`).toBe(2); expect(((h.z % 4) + 4) % 4, `${h.z}`).toBe(2);   // (a plate's centre: between the seams)
      expect(Math.abs(h.x) + h.hw).toBeLessThanOrEqual(STAGE.HW); expect(h.z - h.hd).toBeGreaterThanOrEqual(STAGE.BACK); expect(h.z + h.hd).toBeLessThanOrEqual(STAGE.FRONT);
      for (const g of hatches) if (g !== h) expect(Math.hypot(g.x - h.x, g.z - h.z)).toBeGreaterThanOrEqual(DECK_PROPS.HATCH_GAP);
    }
    for (const c of cargo){
      expect(Math.abs(c.x) - Math.max(c.hw, c.hd), `crate at ${c.x}`).toBeGreaterThan(STAGE.HW + SHIP.CLEAR);     // (outboard of every machine + its footing)
      expect(Math.abs(c.x) + Math.max(c.hw, c.hd)).toBeLessThan(46.4 - .5);          // (inside the ship's rails)
      if (c.y > 0){ const under = cargo[cargo.indexOf(c) - 1]; expect(under.y).toBe(0); expect(Math.hypot(under.x - c.x, under.z - c.z)).toBeLessThan(.5); }
    }
    // with the crowd: every hatch that stands keeps clear; the cargo always stands
    const hv = deckProps(CROWD, PLAN, hatches), cv = deckProps(CROWD, PLAN, cargo);
    expect(hv.some(Boolean)).toBe(true); expect(hv.some(v => !v)).toBe(true);
    expect(cv.every(Boolean)).toBe(true);
  });
  it('a prop stands only where it keeps clear of every footprint (hung too) and every support', () => {
    const spots = [];
    for (let x = -36; x <= 36; x += 3) for (let z = -32; z <= 40; z += 3) spots.push({ x, z, yaw: (x + z) * .1, hw: .6, hd: .4 });
    const vis = deckProps(CROWD, PLAN, spots);
    expect(vis.length).toBe(spots.length);
    expect(vis.some(Boolean)).toBe(true); expect(vis.some(v => !v)).toBe(true);
    const rects = [...CROWD.map(a => ({ x: a.x, z: a.z, yaw: a.yaw || 0, hw: a.w / 2, hd: a.d / 2 })),
      ...ENV.map(e => ({ x: (e.box[0] + e.box[1]) / 2, z: (e.box[4] + e.box[5]) / 2, yaw: 0, hw: (e.box[1] - e.box[0]) / 2, hd: (e.box[5] - e.box[4]) / 2 }))];
    spots.forEach((sp, i) => { if (vis[i]) for (const r of rects) expect(rectsWithin(sp, r, SHIP.CLEAR)).toBe(false); });
    expect(deckProps(CROWD, PLAN, spots)).toEqual(vis);                              // (deterministic)
  });
});
