import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SONGS } from '../src/songs/index.js';
import { parseMidi } from '../src/midi/parse.js';
import { convertToSong } from '../src/midi/convert.js';
import { G, DESCENT, noteNum } from '../src/engine.js';
import { dtFree } from '../src/crane.js';
import { planJuggler, layoutJuggler, solveJuggler, assembleJuggler, packSolve, unpackSolve, jugglerKey,
         auditJuggler, voiceBallsAt, ballAt, carriageAt, plateAt, plateGap, contact, flipper, windT, foldPose,
         keyboard, beltVoices, segPos, segMinDist, JUGGLE } from '../src/juggle.js';
import BAKED from '../src/juggle-baked.json';

/* ---------------------------------------------------------------------------
   THE JUGGLER — the melody belt as a multiball juggling machine (src/juggle.js).
   The honesty contract: every note struck by exactly one ball, on its beat, at the
   strike line; every flight a free arc inside its window; every plate's tilt and
   stroke solved from restitution, its swing arriving at exactly that stroke, and
   out of the ball's way the moment it leaves (recoiling, then holding out only
   while nothing comes near it); no two balls, no ball and plate or plate arm, no
   ball and carriage, no two carriages ever touch; carriages within the crane's limits; balls conserved (held or flying,
   never created or lost); everything periodic in P. The catalog pins what the
   fastest songs still break, so a regression fails and an improvement passes.
   --------------------------------------------------------------------------- */
const g = -G.y;
const KINDS = ['struck', 'flights', 'limits', 'ballBall', 'crane', 'ballPlate', 'ballArm', 'late', 'carriages'];
/* what the fastest songs still break — 32nd-note runs at 142 bpm (Bald Mountain), one throw
   a hair over VH_MAX (Mars). Lower these when the solver improves; never raise them. */
const KNOWN = {
  'bald-mountain': { lead: { limits: 8 }, alto: { ballBall: 1 } },
  'mars': { lead: { limits: 1 } },
};
const counts = A => Object.fromEntries(KINDS.map(k => [k, A[k].length]));
function expectHonest(J, known = {}){
  const A = auditJuggler(J);
  A.forEach(a => {
    const c = counts(a), allow = known[a.role] || {};
    for (const k of KINDS) expect(c[k], `${a.role} ${k}`).toBeLessThanOrEqual(allow[k] || 0);
  });
  return A;
}
/* balls are conserved (each one always held or flying) and the whole machine repeats every P */
function expectConserved(J, step = .05){
  for (const V of J.voices){
    for (let t = -2; t < V.P; t += step){
      const a = voiceBallsAt(V, t);
      expect(a.length, `${V.role} balls at ${t.toFixed(2)}`).toBe(V.balls);
      const b = voiceBallsAt(V, t + V.P), ord = (p, q) => p.x - q.x || p.y - q.y || p.z - q.z;
      a.sort(ord); b.sort(ord);
      a.forEach((p, i) => expect(Math.hypot(p.x - b[i].x, p.y - b[i].y, p.z - b[i].z)).toBeLessThan(1e-6));
    }
    V.carriages.forEach((_, c) => {
      for (let t = 0; t < V.P; t += .37){
        const p = carriageAt(V, c, t), q = carriageAt(V, c, t + V.P);
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(1e-9);
      }
    });
  }
}
/* every ball of the plan is ONE ball (ballAt — what the render draws): the voice's balls at any
   moment are exactly the plan's balls, and each plate is struck by the ball the plan names */
function expectIdentity(J, step = .05){
  for (const V of J.voices){
    for (let t = 0; t < V.P; t += step){
      const all = voiceBallsAt(V, t), mine = Array.from({ length: V.balls }, (_, b) => ballAt(V, b, t));
      const ord = (p, q) => p.x - q.x || p.y - q.y || p.z - q.z;
      all.sort(ord); mine.sort(ord);
      expect(mine.length).toBe(all.length);
      mine.forEach((p, i) => expect(Math.hypot(p.x - all[i].x, p.y - all[i].y, p.z - all[i].z), `${V.role} at ${t.toFixed(2)}`).toBeLessThan(1e-9));
    }
    V.plates.forEach((p, k) => {
      const q = ballAt(V, p.ball, p.s - 1e-7);
      expect(Math.hypot(q.x - p.x, q.y, q.z - p.z), `${V.role} plate ${k}`).toBeLessThan(1e-5);
    });
  }
}
const midiSong = f => convertToSong(parseMidi(new Uint8Array(fs.readFileSync(path.join(__dirname, '../public/midi', f))))).song;

describe('contact: a smooth plate pushes along its normal, restitution sets its stroke', () => {
  const rnd = (a, b) => a + Math.random() * (b - a);
  it('n ∝ Δv, the ball approaches before and separates after, (vOut − U)·n = −e (vIn − U)·n', () => {
    for (let i = 0; i < 400; i++){
      const F1 = rnd(.22, 1.7), F2 = rnd(.22, 1.7);
      const vIn = { x: rnd(-8, 8), y: -g * F1 / 2, z: rnd(-1, 1) }, vOut = { x: rnd(-8, 8), y: g * F2 / 2, z: rnd(-1, 1) };
      const k = contact(vIn, vOut);
      const d = { x: vOut.x - vIn.x, y: vOut.y - vIn.y, z: vOut.z - vIn.z }, l = Math.hypot(d.x, d.y, d.z);
      expect(Math.abs(k.n.x - d.x / l) + Math.abs(k.n.y - d.y / l) + Math.abs(k.n.z - d.z / l)).toBeLessThan(1e-12);
      expect(Math.abs(Math.acos(k.n.y) - k.tilt)).toBeLessThan(1e-9);
      const Un = k.w + DESCENT * k.n.y, dot = v => v.x * k.n.x + v.y * k.n.y + v.z * k.n.z;
      const a = dot(vIn) - Un, b = dot(vOut) - Un;
      expect(a).toBeLessThan(0);
      expect(b).toBeGreaterThan(0);
      expect(Math.abs(b + JUGGLE.E * a)).toBeLessThan(1e-9);
      // the swing: a harder throw along n winds up further (the old pad's swing), clamped
      expect(k.amp).toBeCloseTo(Math.min(JUGGLE.AMP_MAX, Math.max(JUGGLE.AMP_MIN, JUGGLE.AMP_K * dot(vOut))), 12);
    }
  });
});

describe('flipper: winds up, swings into the ball at exactly w, then recoils faster than gravity', () => {
  const S = JUGGLE.STROKE_S, h = 1e-5;
  const d1 = (f, c) => (f(c + 1e-7) - f(c - 1e-7)) / 2e-7, d2 = (f, c) => (f(c + h) - 2 * f(c) + f(c - h)) / (h * h);
  for (const [w, amp] of [[-6, .06], [-1.5, .2], [0, .3], [2, .45], [7.5, .6]]){
    const f = c => flipper(c, w, amp), I = windT(amp);
    it(`w = ${w}, amp = ${amp}: from rest, pulled back by amp, on the plate at contact moving at w, home after`, () => {
      expect(f(-I)).toBe(0); expect(f(-I - .1)).toBe(0);
      expect(Math.abs((f(-I + 1e-7) - f(-I)) / 1e-7)).toBeLessThan(1e-4);   // the wind-up starts from rest …
      expect(f(-S)).toBeCloseTo(-amp, 12);                                    // … and pulls back by amp,
      expect(Math.abs(d1(f, -S))).toBeLessThan(1e-4);                         // at rest at the top of the swing
      expect(Math.abs(f(0))).toBeLessThan(1e-12);
      expect(Math.abs(d1(f, 0) - w)).toBeLessThan(1e-3);                      // meets the ball at exactly w
      if (w >= 0) for (let c = -I; c < 0; c += .005) expect(f(c)).toBeLessThanOrEqual(1e-12);   // never past its face first
      expect(f(JUGGLE.HOME_T)).toBe(0); expect(f(JUGGLE.HOME_T + .3)).toBe(0);
      for (const c of [-S, JUGGLE.DROP_T, JUGGLE.REST_T]) expect(Math.abs(f(c + 1e-9) - f(c - 1e-9))).toBeLessThan(1e-6);   // continuous joints
      for (const c of [.01, .025, .04]) expect(d2(f, c)).toBeLessThan(-g);   // the plate falls away from the ball
    });
  }
  it('folds once its hold is over: out until then, snapped back and flat FOLD_T later', () => {
    expect(foldPose(-.4)).toEqual({ extend: 1, tilt: 1 });
    expect(foldPose(0)).toEqual({ extend: 1, tilt: 1 });
    expect(foldPose(JUGGLE.FOLD_T)).toEqual({ extend: 0, tilt: 0 });
  });
});

describe('keyboard: a note’s lane is a pure fn of its pitch', () => {
  it('home slots climb with pitch, stay on the keyboard, and span ≥ W_MIN lanes per voice', () => {
    for (const song of Object.values(SONGS)){
      const vs = beltVoices(song), kb = keyboard(vs);
      vs.forEach((v, i) => {
        const ms = [...new Set(v.notes.map(([n]) => noteNum(n)))].sort((a, b) => a - b), hs = ms.map(kb[i].home);
        for (let k = 1; k < hs.length; k++) expect(hs[k]).toBeGreaterThanOrEqual(hs[k - 1]);
        for (const L of hs){ expect(L).toBeGreaterThanOrEqual(0); expect(L).toBeLessThan(JUGGLE.LANES); }
        expect(kb[i].width).toBeGreaterThanOrEqual(Math.min(JUGGLE.W_MIN, JUGGLE.LANES));
      });
    }
  });
});

describe('geometry kit', () => {
  it('segMinDist is exact for two free flights (relative motion under one g is a straight line)', () => {
    for (let i = 0; i < 300; i++){
      const r = () => Math.random() * 2 - 1;
      const a = { t0: 0, t1: 1 + Math.random(), x0: r() * 3, y0: 0, z0: r(), vx: r() * 5, vy: 3 + r() * 2, vz: r() };
      const b = { t0: Math.random() * .8, t1: 1.2 + Math.random(), x0: r() * 3, y0: 0, z0: r(), vx: r() * 5, vy: 3 + r() * 2, vz: r() };
      const lo = Math.max(a.t0, b.t0), hi = Math.min(a.t1, b.t1);
      let m = Infinity;
      for (let k = 0; k <= 20000; k++){
        const t = lo + (hi - lo) * k / 20000, p = segPos(a, t), q = segPos(b, t);
        m = Math.min(m, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
      }
      expect(Math.abs(segMinDist(a, b) - m)).toBeLessThan(1e-4);
    }
  });
  it('plateGap: touching on the face, clear above it, overlapping inside', () => {
    const B = { x: 0, y: 0, z: 0, q: { x: 0, y: 0, z: 0, w: 1 }, n: { x: 0, y: 1, z: 0 }, hx: .5, hy: .06, hz: .2 };
    expect(Math.abs(plateGap(B, 0, .06 + .26, 0, .26))).toBeLessThan(1e-12);
    expect(plateGap(B, .3, 1, .1, .26)).toBeCloseTo(1 - .06 - .26, 12);
    expect(plateGap(B, 0, .1, 0, .26)).toBeLessThan(0);
    expect(plateGap(B, .7, 0, 0, .26)).toBeCloseTo(.2 - .26, 12);
  });
});

describe('the audit is not vacuous', () => {
  const J = planJuggler(SONGS['canon-in-d']), V = J.voices[0];
  const insert = seg => { const i = V.segs.findIndex(q => q.t0 > seg.t0); V.segs.splice(i < 0 ? V.segs.length : i, 0, seg); V.segT0 = V.segs.map(q => q.t0); };
  const remove = seg => { V.segs.splice(V.segs.indexOf(seg), 1); V.segT0 = V.segs.map(q => q.t0); };
  it('a duplicated flight is two strikes and a ball–ball contact', () => {
    const s = V.segs.find(q => q.kind === 'flight'), dup = { ...s, z0: s.z0 + .05 };
    insert(dup);
    const A = auditJuggler(J)[0];
    remove(dup);
    expect(A.struck.length).toBe(1);
    expect(A.ballBall.length).toBeGreaterThan(0);
  });
  it('a ball resting on a held plate’s arm is a ball–arm contact', () => {
    const k = V.plates.findIndex(p => p.hold >= .3);
    expect(k).toBeGreaterThanOrEqual(0);
    const t = V.plates[k].s + .2, B = plateAt(V, k, t);
    const m = { x: (B.shoe.x + B.hub.x) / 2, y: (B.shoe.y + B.hub.y) / 2 + V.r, z: (B.shoe.z + B.hub.z) / 2 };
    const lying = { t0: t - .012, t1: t + .012, x0: m.x, y0: m.y, z0: m.z, vx: 0, vy: 0, vz: 0, kind: 'flight', a: -1, b: -1 };
    insert(lying);
    const A = auditJuggler(J)[0];
    remove(lying);
    expect(A.ballArm.some(e => e.k === k)).toBe(true);
  });
  it('a ball left lying on a plate that kicks is a ball–plate contact', () => {
    const k = V.plates.findIndex(p => p.w + DESCENT * p.n.y > 1);
    expect(k).toBeGreaterThanOrEqual(0);
    const p = V.plates[k], lying = { t0: p.s + .004, t1: p.s + .03, x0: p.x, y0: 0, z0: p.z, vx: 0, vy: 0, vz: 0, kind: 'flight', a: -1, b: -1 };
    insert(lying);
    const A = auditJuggler(J)[0];
    remove(lying);
    expect(A.ballPlate.some(e => e.k === k)).toBe(true);
  });
});

describe('the catalog: every song juggles honestly', () => {
  for (const key of Object.keys(SONGS)){
    it(key, { timeout: 60000 }, () => {
      const L = layoutJuggler(SONGS[key]), solved = solveJuggler(L), J = assembleJuggler(L, solved);
      // the BAKE (src/juggle-baked.json — what a page load uses instead of this search) is this solve + its holds
      expect(JSON.stringify(BAKED.plans[L.key]?.voices ?? null), `${key}: the bake is stale — run node scripts/juggle-bake.mjs`)
        .toBe(JSON.stringify(packSolve(solved, J)));
      expect(J.voices.length).toBe(beltVoices(SONGS[key]).length);
      for (const V of J.voices){
        expect(V.balls).toBeGreaterThan(0);
        expect(V.balls).toBeLessThanOrEqual(JUGGLE.M_MAX);
        for (const s of V.segs) if (s.kind === 'flight'){
          const F = s.t1 - s.t0;
          expect(F).toBeGreaterThanOrEqual(JUGGLE.F_HARD - 1e-9);
          expect(F).toBeLessThanOrEqual(dtFree(g) + 1e-9);
        }
        // every strike lands on its beat, at the strike line, on its plate
        for (const s of V.segs) if (s.b >= 0){
          const end = segPos(s, s.t1), p = V.plates[s.b];
          expect(Math.abs(s.t1 - p.s)).toBeLessThan(1e-9);
          expect(Math.abs(end.y)).toBeLessThan(1e-9);
          expect(Math.abs(end.x - p.x) + Math.abs(end.z - p.z)).toBeLessThan(1e-9);
        }
        // every plate holds out (whole steps, ≤ HOLD_MAX), fully out until its hold ends, folded FOLD_T later
        V.plates.forEach((p, k) => {
          expect(p.hold).toBeGreaterThanOrEqual(0); expect(p.hold).toBeLessThanOrEqual(JUGGLE.HOLD_MAX);
          expect(Math.abs(p.hold * 20 - Math.round(p.hold * 20))).toBeLessThan(1e-9);
          const out = plateAt(V, k, p.s + p.hold * .999), done = plateAt(V, k, p.s + p.hold + JUGGLE.FOLD_T + 1e-6);
          if (p.hold > 0){ expect(out.extend).toBe(1); expect(out.tilt).toBe(1); }
          if (done){ expect(done.extend).toBeLessThan(1e-9); expect(done.tilt).toBeLessThan(1e-9); }
        });
      }
      expectHonest(J, KNOWN[key]);
      expectConserved(J);
      expectIdentity(J);
    });
  }
  it('the bake holds the catalog and nothing else, and a baked plan IS the solved plan', () => {
    expect(Object.keys(BAKED.plans).sort()).toEqual(Object.values(SONGS).map(jugglerKey).sort());
    const strip = J => JSON.stringify(J.voices.map(V => [V.segs, V.plates, V.carriages.map(c => c.keys), V.pieces]));
    const song = SONGS['ode-to-joy'], a = planJuggler(song);
    const b = assembleJuggler(layoutJuggler(song), unpackSolve(BAKED.plans[jugglerKey(song)].voices));
    expect(strip(b)).toBe(strip(a));
  });
});

describe('imports and stress tracks', () => {
  for (const f of ['room-tour.mid', 'night-mallets.mid', 'canon-in-d.mid', 'piano-hands.mid', 'sketch-band.mid']){
    it(f, { timeout: 60000 }, () => {
      const J = planJuggler(midiSong(f));
      expectHonest(J);
      expectConserved(J, .1);
    });
  }
  const STRESS = {
    'back-to-back': { bpm: 90, melody: [['C4', 4], ['E4', 3], ['G4', 6], ['C5', .5], ['E4', 8], ['D4', 1], ['C4', 2]] },
    'squeezed': { bpm: 120, melody: [['C4', 3.5], ['G4', 3.5], ['E4', 3.6], ['C5', .25], ['G4', 3.5], ['C4', 3.5]] },
    'giant-gap': { bpm: 100, melody: [['C4', 1], ['E4', 300], ['G4', .5], ['C5', 1]], bass: { delay: 2, notes: [['C3', 160], ['G2', 140.5]] } },
    'one-note': { bpm: 80, melody: [['C4', 8]] },
    'skim-then-lob': { bpm: 140, melody: [['C5', .25], ['D5', .25], ['E5', .25], ['F5', .25], ['G5', 6], ['C4', .5], ['E4', 7], ['G4', 2]] },
    'leaps': { bpm: 140, melody: Array.from({ length: 24 }, (_, i) => [i % 2 ? 'C6' : 'C3', .5]) },
    'trill': { bpm: 160, melody: Array.from({ length: 32 }, (_, i) => [i % 2 ? 'D5' : 'C5', .25]) },
  };
  for (const [k, song] of Object.entries(STRESS)){
    it(k, { timeout: 30000 }, () => {
      const J = planJuggler({ scale: ['C'], ...song });
      expectHonest(J);
      expectConserved(J, .1);
    });
  }
});

describe('time is the only state', () => {
  it('the plan is a pure fn of the song', () => {
    const a = planJuggler(SONGS['ode-to-joy']), b = planJuggler(SONGS['ode-to-joy']);
    const strip = J => JSON.stringify(J.voices.map(V => [V.segs, V.plates, V.carriages.map(c => c.keys)]));
    expect(strip(a)).toBe(strip(b));
  });
  it('plates are posed only while in sight', () => {
    const J = planJuggler(SONGS['canon-in-d']), V = J.voices[0];
    for (let k = 0; k < V.plates.length; k += 5){
      const s = V.plates[k].s;
      expect(plateAt(V, k, s)).not.toBeNull();
      expect(plateAt(V, k, s + V.P / 2)).toBeNull();
    }
  });
});
