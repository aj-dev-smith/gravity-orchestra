import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { IDLE, restEnv, anticip, sway, twitch } from '../src/instruments/idle.js';
import { eventTimes, lanesByNote } from '../src/instruments/clock.js';
import { noteNum } from '../src/engine.js';
import { STATIONS } from '../src/instruments/stations.js';
import { STAGE } from '../src/rooms/common.js';

import riff from '../src/instruments/riff/index.js';
import strum from '../src/instruments/strum/index.js';
import organ from '../src/instruments/organ/index.js';
import horns from '../src/instruments/horns/index.js';
import bowwheel from '../src/instruments/bowwheel/index.js';
import dulcimer from '../src/instruments/dulcimer/index.js';
import pogo from '../src/instruments/pogo/index.js';

import { solveRiff, stampAt, latchRest, carriageAt, pressDepth, H_PARK } from '../src/instruments/riff/solve.js';
import { solvePogo, pogoAt, hangRest, H_MAG as POGO_H } from '../src/instruments/pogo/solve.js';
import { prepPart, layoutStrings, solveStrum, pickAt, dockRest } from '../src/instruments/strum/solve.js';
import { fitPart as organFit, organLane, organLadder, laneAt as organAt, heldRest as organRest, H_MAG as ORGAN_H } from '../src/instruments/organ/solve.js';
import { fitPart as hornFit, hornLane, hornAt, heldRest as hornRest } from '../src/instruments/horns/solve.js';
import { prepPart as bowPrep, laneGeom, laneX, bowLane, laneAt as bowAt, parkAt, MAG_Y } from '../src/instruments/bowwheel/solve.js';
import { fitPart as grandFit, parseNote, dulcimerLane, dulcimerAt, damperRest } from '../src/instruments/dulcimer/solve.js';
/* the floor / ceiling a station is built with — as main does: a FLOOR station is built supportless
   (floorY 0 — the room sets it on its footing), a HUNG one gets the real room (rooms/footing.js) */
const supports = st => ({ floorY: st.hang ? STAGE.FLOOR - st.y : 0, ceilY: STAGE.CEIL - st.y });

/* ============================================================
   REST-POSE PERSONALITY — the honesty contract (src/instruments/idle.js):
   idle motion is a pure fn of the lane clock, lives only inside a rest
   (the machine still, nothing touching), and is EXACTLY zero near every
   strike / catch / release — so the contact geometry is byte-identical
   with idle on or off.
   ============================================================ */
const ROLL_T = 2.6, START = -2.4, G = .2;
const timing = (bpm, beats) => { const beat = 60 / bpm; return { rollT: ROLL_T, beat, P: ROLL_T + beats * beat + 1.2 }; };

describe('idle curves', () => {
  it('restEnv: exactly 0 within the guard of either end, 1 deep inside, open-ended sides count as far', () => {
    for (const [s, u] of [[0, 5], [.1999, 5], [5, .1999], [5, 0], [-1, 5], [NaN, 5]]) expect(restEnv(s, u, .2, .4)).toBe(0);
    expect(restEnv(5, 5, .2, .4)).toBe(1);
    expect(restEnv(Infinity, Infinity, .2, .4)).toBe(1);
    expect(restEnv(Infinity, .1, .2, .4)).toBe(0);
    // smooth (zero slope) at the guard edge: a tiny step past it moves the envelope by O(h²)
    expect(restEnv(.2 + 1e-4, 5, .2, .4)).toBeLessThan(1e-6);
  });
  it('anticip rises 0 → 1 as the entrance nears; the IDLE switch kills everything', () => {
    expect(anticip(2, .9)).toBe(0);
    expect(anticip(0, .9)).toBe(1);
    expect(anticip(.45, .9)).toBeCloseTo(.5, 9);
    IDLE.on = false;
    try { expect(restEnv(5, 5)).toBe(0); expect(anticip(0)).toBe(0); }
    finally { IDLE.on = true; }
  });
  it('sway / twitch are bounded pure fns of time', () => {
    for (let t = -3; t < 30; t += .37){
      expect(Math.abs(sway(t, .4, 1))).toBeLessThanOrEqual(1);
      const w = twitch(t, .75, .3); expect(w).toBeGreaterThanOrEqual(0); expect(w).toBeLessThanOrEqual(1);
    }
  });
});

/* ---- the PURE windows: a rest window (with a non-zero envelope) only ever exists while the
   machine is genuinely at rest, and never within G of one of that lane's strikes ---- */
const sweep = (P, fn, dt = .002) => { for (let t = START; t < START + 2.2 * P; t += dt) fn(t); };
// is t within G of a strike that HAPPENS (abs time ≥ START: a loop-twin before the count-in never did)?
const near = (t, strikes, P) => strikes.some(s => { const a = s + Math.round((t - s) / P) * P; return a >= START && Math.abs(t - a) < G; });

describe('rest windows are honest rests, clear of every strike', () => {
  it('riff: a latched stamp, parked and still', () => {
    const tm = timing(riff.demo.bpm, riff.demo.beats), R = solveRiff(riff.demo.part, tm);
    let n = 0;
    for (const S of R.strings) sweep(tm.P, t => {
      const p = stampAt(S, t, START), w = latchRest(p);
      if (!w || !restEnv(w.since, w.until, .25, .45)) return;
      n++;
      expect(p.y).toBe(H_PARK); expect(p.vy).toBe(0);
      expect(near(t, S.L.s, tm.P)).toBe(false);
    });
    expect(n).toBeGreaterThan(100);
  });
  it('pogo: hanging on its magnet at the apex, still', () => {
    const tm = timing(pogo.demo.bpm, pogo.demo.beats), R = solvePogo(pogo.demo.part, tm);
    let n = 0;
    for (const S of R.strings) sweep(tm.P, t => {
      const p = pogoAt(S, t, START), w = hangRest(p);
      if (!w || !restEnv(w.since, w.until, .2, .5)) return;
      n++;
      expect(p.y).toBeCloseTo(POGO_H, 9); expect(p.vy).toBe(0); expect(p.pump).toBe(0);
      expect(near(t, S.D.s, tm.P)).toBe(false);
    });
    expect(n).toBeGreaterThan(100);
  });
  it('strum: the plectrum docked and still, clear of every crossing', () => {
    const tm = timing(strum.demo.bpm, strum.demo.beats), prep = prepPart(strum.demo.part, tm);
    const S = solveStrum(prep, tm.P, layoutStrings(prep.ids, { W: 12 }));
    const cross = S.strings.flatMap(st => st.cr.map(c => c.tc)), launches = S.passes.map(p => p.ts);
    let n = 0;
    sweep(tm.P, t => {
      const w = dockRest(S, t, START);
      if (!w || !restEnv(w.since, w.until, .2, .6)) return;
      n++;
      const q = pickAt(S, t, START);
      expect(['dock', 'armed']).toContain(q.mode); expect(q.vx).toBe(0);
      expect(near(t, cross, tm.P)).toBe(false); expect(near(t, launches, tm.P)).toBe(false);
    });
    expect(n).toBeGreaterThan(100);
  });
  it('organ: a marble held on its magnet', () => {
    const tm = timing(organ.demo.bpm, organ.demo.beats), { events } = organFit(organ.demo.part, tm), ladder = organLadder(events);
    const by = new Map(); for (const e of events) (by.get(e.pitch) || by.set(e.pitch, []).get(e.pitch)).push(e);
    let n = 0;
    for (const list of by.values()){
      const lane = organLane(list, tm.P, ladder);
      sweep(tm.P, t => {
        const st = organAt(lane, t, START), w = organRest(lane, st);
        if (!w || !restEnv(w.since, w.until, .1, .6)) return;
        n++;
        expect(st.held).toBe(true); expect(st.y).toBe(ORGAN_H); expect(st.vy).toBe(0); expect(Math.abs(st.lid)).toBeLessThan(1e-12);
        expect(near(t, lane.L.s, tm.P)).toBe(false);
      }, .004);
    }
    expect(n).toBeGreaterThan(100);
  });
  it('horns: a marble held on its magnet, the lid on its stop', () => {
    const tm = timing(horns.demo.bpm, horns.demo.beats);
    const fit = hornFit(horns.demo.part, { beat: tm.beat, loopBeats: horns.demo.beats });
    let n = 0;
    for (const evs of Object.values(lanesByNote(eventTimes(fit, tm)))){
      const lane = hornLane(evs.map(e => e.t), evs.map(e => e.vel), evs.map(e => e.dur), tm.P, { beat: tm.beat, scale: .8 });
      sweep(tm.P, t => {
        const s = hornAt(lane, t, START), w = hornRest(lane, s);
        if (!w || !restEnv(w.since, w.until, .2, .5)) return;
        n++;
        expect(s.held).toBe(true); expect(s.v).toBe(0); expect(s.lid).toBe(0); expect(s.y).toBe(lane.Hs);
        expect(near(t, lane.L.s, tm.P)).toBe(false);
      }, .004);
    }
    expect(n).toBeGreaterThan(100);
  });
  it('bowwheel: a marble parked on its magnet, the rod up, the string off the rim', () => {
    const tm = timing(bowwheel.demo.bpm, bowwheel.demo.beats), by = lanesByNote(eventTimes(bowPrep(bowwheel.demo.part).events, tm));
    const notes = Object.keys(by).sort((a, b) => noteNum(a) - noteNum(b));
    let n = 0;
    notes.forEach((note, i) => {
      const L = bowLane(by[note].map(e => ({ t: e.t, tDur: e.tDur, vel: e.vel })), tm.P, laneGeom(note, laneX(i, notes.length)));
      const ons = L.cyc.map(q => q.on);
      sweep(tm.P, t => {
        const w = parkAt(L, t, START);
        if (!w || !restEnv(w.since, w.until, .2, .5)) return;
        n++;
        const st = bowAt(L, t, START);
        expect(st.held).toBe(true); expect(st.y).toBe(MAG_Y); expect(st.s).toBe(0); expect(st.contact).toBe(false);
        expect(near(t, ons, tm.P)).toBe(false);
      }, .004);
    });
    expect(n).toBeGreaterThan(100);
  });
  it('dulcimer: the damper hover only rises while the felt rests on a silent string, never within .15 s of its landing', () => {
    const tm = timing(dulcimer.demo.bpm, dulcimer.demo.beats);
    const { part } = grandFit(dulcimer.demo.part, { maxDurBeats: 4.5 / tm.beat });
    const by = new Map();
    for (const e of eventTimes(part, tm)){ const m = parseNote(e.note).m; (by.get(m) || by.set(m, []).get(m)).push({ t: e.t, vel: e.vel, hold: e.tDur }); }
    let n = 0;
    for (const [m, ev] of by){
      const lane = dulcimerLane(ev, tm.P, { m });
      sweep(tm.P, t => {
        const w = damperRest(lane, t, START);
        if (!w || w.until < 0 || !anticip(w.until, 1)) return;
        const s = dulcimerAt(lane, t, START);
        expect(Math.abs(s.damp)).toBe(0); expect(Math.abs(s.vib)).toBe(0);            // resting felt, still string
        if (w.since < .15) return;
        n++;
      }, .004);
    }
    expect(n).toBeGreaterThan(100);
  });
});

/* ---- the RENDER: byte-identical contact poses. One lane per machine (a single pitch / a single
   string — every OTHER lane's rest would legitimately move during this lane's strike), posed with
   idle off then on at every sample: around every strike the two snapshots must be identical,
   and somewhere in the loop they must differ (the machine does idle). ---- */
function snapshot(group){
  const out = [];
  group.updateMatrixWorld(true);
  group.traverse(o => {
    out.push(...o.matrixWorld.elements);
    if (o.isInstancedMesh) out.push(...o.instanceMatrix.array);
    if (o.isPoints) out.push(...o.geometry.attributes.position.array);
  });
  return out;
}
const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

const CASES = [
  ['riff', riff, e => /^E2(:|$)/.test(e[1])],               // E2 lives on the low string only
  ['pogo', pogo, e => /^E1(:|$)/.test(e[1])],               // E1: the low string only
  ['strum', strum, () => true],                             // one plectrum: the whole demo
  ['organ', organ, e => e[1] === 'A3', false],              // the organ's idle is GLOW only (its marbles hang rigid)
  ['horns', horns, e => e[1] === 'F4'],
  ['bowwheel', bowwheel, e => e[1] === 'E5'],
  ['dulcimer', dulcimer, e => e[1] === 'G4'],
];

describe('idle never touches a contact pose (render, idle off vs on)', () => {
  for (const [key, I, keep, moves = true] of CASES){
    it(`${key}: identical within ±.06 s of every strike${moves ? '; idles somewhere in the loop' : ''}`, () => {
      const part = I.demo.part.filter(keep);
      expect(part.length).toBeGreaterThan(2);
      const tm = timing(I.demo.bpm, I.demo.beats), st = STATIONS[key];
      const inst = I.make({ envMap: null, glowTex: null, THREE });
      const group = inst.build(part, { ...tm, start: START, station: st, ...supports(st), loopBeats: I.demo.beats });
      const dt = .004, fired = [], diff = [];
      let t = START;
      try {
        for (; t < START + 1.15 * tm.P; t += dt){
          IDLE.on = false;
          inst.update(t, tm.P, dt, { started: true, skipStrikes: false, onStrike: () => fired.push(t) });
          const a = snapshot(group);
          IDLE.on = true;
          inst.update(t, tm.P, 0, { started: true, skipStrikes: true, onStrike: () => {} });
          if (!same(a, snapshot(group))) diff.push(t);
        }
      } finally { IDLE.on = true; }
      expect(fired.length).toBeGreaterThan(2);
      if (moves) expect(diff.length).toBeGreaterThan(20);      // it does idle
      else expect(diff).toEqual([]);
      const bad = diff.filter(td => fired.some(tf => td > tf - dt - .06 && td < tf + .06));
      expect(bad).toEqual([]);
    }, 60000);
  }
});

/* ---- riff: a carriage can be MID-PRESS while its stamp is latched (it moves to the next fret
   early). Wherever a hook is kinking its string, the render must be the solved pose — the hook
   never hovers off a string it is pressing. (One string per run, so any diff is that string's.) ---- */
describe('riff: the hook hover never lifts a hook off a string it presses', () => {
  it('a pressing string\'s hook is at its solved height (idle off vs on), even while its stamp is latched', () => {
    const tm = timing(riff.demo.bpm, riff.demo.beats), st = STATIONS.riff, part = riff.demo.part;
    const R = solveRiff(part, tm);
    const inst = riff.make({ envMap: null, glowTex: null, THREE });
    const group = inst.build(part, { ...tm, start: START, station: st, ...supports(st), loopBeats: riff.demo.beats });
    const hooks = []; group.traverse(o => { if (o.userData.riffHook != null) hooks[o.userData.riffHook] = o; });
    expect(hooks.filter(Boolean).length).toBe(R.strings.length);
    let hot = 0, bad = 0;
    try {
      for (let t = START; t < START + 1.15 * tm.P; t += .002){
        const live = R.strings.map((S, s) => pressDepth(s, carriageAt(S, t, START)) > 0);
        const latched = R.strings.map((S, s) => live[s] && !!latchRest(stampAt(S, t, START)));
        if (!latched.some(Boolean)) continue;
        IDLE.on = false; inst.update(t, tm.P, 0, { started: true, skipStrikes: true, onStrike: () => {} });
        const a = hooks.map(h => h.position.y);
        IDLE.on = true; inst.update(t, tm.P, 0, { started: true, skipStrikes: true, onStrike: () => {} });
        hooks.forEach((h, s) => { if (live[s]){ hot++; if (h.position.y !== a[s]) bad++; } });
      }
    } finally { IDLE.on = true; }
    expect(hot).toBeGreaterThan(5);                 // the case is real: carriages press during a latch
    expect(bad).toBe(0);
  }, 60000);
});
