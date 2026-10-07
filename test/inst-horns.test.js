import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { eventTimes, lanesByNote, wrapP } from '../src/instruments/clock.js';
import { noteHz, noteNum } from '../src/engine.js';
import {
  hornLane, hornAt, fitPart, holdFor, voiceIdOf, breathAt, dForVel, isStab,
  PART_LIMITS, MIN_GAP, HOLD_MAX, HOLD_MIN, STAB_T, RIDE, H, g,
} from '../src/instruments/horns/solve.js';
import { hornGeom, layoutHorns, bellLow, family, slidePos, fingering, Y_BEAM, Y_MAG, MAG_H, Z_B, Z_H, BW, MAG_R } from '../src/instruments/horns/layout.js';
import { hornVoice } from '../src/instruments/horns/voice.js';
import horns from '../src/instruments/horns/index.js';

const ROLL_T = 2.6, START = -2.4;

function demoLanes(demo = horns.demo, scale = .8){
  const beat = 60 / demo.bpm, P = ROLL_T + demo.beats * beat;
  const fit = fitPart(demo.part, { beat, loopBeats: demo.beats });
  const by = lanesByNote(eventTimes(fit, { rollT: ROLL_T, beat }));
  return { P, beat, lanes: Object.entries(by).map(([note, evs]) =>
    ({ note, lane: hornLane(evs.map(e => e.t), evs.map(e => e.vel), evs.map(e => e.dur), P, { beat, scale }) })) };
}
const strikesOf = (lane, P, loops = 3) => {
  const out = [];
  for (let k = -1; k < loops + 1; k++) for (const s of lane.L.s){ const a = s + k * P; if (a >= START + 1e-6 && a < START + loops * P) out.push(a); }   // (a strike AT start never happened)
  return out.sort((a, b) => a - b);
};

/* hand-built lanes covering every path: sparse (magnet parks), dense repeats (low lobs),
   stabs, holds that eat most of the gap, a seam-crossing pair, an at-the-limit repeat */
const P = 12, BEAT = .5;
const CASES = {
  sparse: [[3, 1, 2], [9, .4, 4]],
  single: [[5, .7, 1]],
  stabs:  [[3, .9, .25], [3.5, .8, .25], [4, 1, .25], [4.5, .6, 0], [7, 1, .25]],
  holds:  [[2.7, .9, 3], [5, .3, 1.5], [6.1, .8, .5], [8, 1, 8]],
  seam:   [[.1, .8, .5], [11.6, .9, .5]],
  limit:  [[3, 1, 0], [3 + MIN_GAP, 1, 0], [3 + 2 * MIN_GAP, .5, 0]],
};
const laneOf = hits => hornLane(hits.map(h => h[0]), hits.map(h => h[1]), hits.map(h => h[2]), P, { beat: BEAT, scale: .85 });

describe('horns: every lane is honest', () => {
  for (const [name, hits] of Object.entries(CASES)){
    const lane = laneOf(hits);
    const strikes = strikesOf(lane, P);

    it(`${name}: lands exactly on the beat — the marble at the contact point, falling INTO the lid, the lid at rest`, () => {
      for (const a of strikes){
        const b = hornAt(lane, a - 1e-7, START);
        expect(Math.abs(b.y), `${name} @${a}`).toBeLessThan(1e-5);
        expect(b.v).toBeLessThan(0);                       // moving down onto the lid
        expect(b.onLid).toBe(false); expect(b.held).toBe(false);   // free at contact
        expect(b.lid).toBe(0); expect(b.lidV).toBe(0);     // the lid sits on its stop
        const c = hornAt(lane, a + 1e-7, START);
        expect(c.onLid).toBe(true); expect(c.since).toBeLessThan(1e-6);
      }
    });

    it(`${name}: the struck lid is AT REST for the last 50 ms before every contact`, () => {
      for (const a of strikes) for (const dt of [.05, .02, 1e-3, 1e-5]){
        const b = hornAt(lane, a - dt, START);
        if (b.armed && a - dt < START) continue;
        expect(b.lid).toBe(0); expect(b.lidV).toBe(0);
      }
    });

    it(`${name}: no penetration — never inside the lid, never inside the magnet; seated while riding`, () => {
      const bad = [];
      for (let t = START; t < START + 2.2 * P; t += 1e-3){
        const c = hornAt(lane, t, START);
        if (c.y - c.lid < -1e-9) bad.push(`lid @${t.toFixed(3)}`);
        if (c.y > lane.Hs + 1e-9) bad.push(`magnet @${t.toFixed(3)}`);
        if (c.onLid && Math.abs(c.y - c.lid) > 1e-12) bad.push(`unseated @${t.toFixed(3)}`);
        if (c.lid > 1e-12) bad.push(`lid past its stop @${t.toFixed(3)}`);
      }
      expect(bad.slice(0, 5), name).toEqual([]);
    });

    it(`${name}: continuous through the count-in, catches, releases and the loop seam — nothing teleports`, () => {
      const dt = 5e-4, vmax = lane.vF * 1.001;
      let prev = hornAt(lane, START, START);
      const bad = [];
      for (let t = START + dt; t < START + 2.2 * P; t += dt){
        const c = hornAt(lane, t, START);
        if (Math.abs(c.y - prev.y) >= vmax * dt + 1e-9) bad.push(`y @${t.toFixed(4)}`);
        if (Math.abs(c.lid - prev.lid) >= vmax * dt + 1e-9) bad.push(`lid @${t.toFixed(4)}`);
        prev = c;
      }
      expect(bad.slice(0, 5), name).toEqual([]);
    });

    it(`${name}: the marble stays SEATED while it rides — the lid never accelerates downward`, () => {
      const h = 1e-4;
      for (let t = START + .01; t < START + 2 * P; t += 2e-3){
        const c = hornAt(lane, t, START);
        if (!c.onLid) continue;
        const a = hornAt(lane, t + h, START), b = hornAt(lane, t - h, START);
        if (!a.onLid || !b.onLid || a.i !== c.i || b.i !== c.i) continue;
        expect((a.lidV - b.lidV) / (2 * h), `${name} @${t.toFixed(3)}`).toBeGreaterThan(-1e-6);
      }
    });

    it(`${name}: lossy landing (the lid takes ≤ RIDE of the marble's speed); the ram supplies every lob`, () => {
      lane.plan.forEach((p, i) => {
        const a = lane.L.s[i] + P;
        const pre = hornAt(lane, a - 1e-7, START), post = hornAt(lane, a + 1e-9, START);
        expect(-post.v).toBeLessThanOrEqual(RIDE * -pre.v + 1e-5);
        expect(-post.v).toBeGreaterThan(0);
        // the lid comes to rest at the bottom of its stroke exactly at note-off (the bellows empty) …
        const off = hornAt(lane, a + p.h - 1e-9, START);
        expect(off.lid).toBeCloseTo(-p.d, 6); expect(Math.abs(off.lidV)).toBeLessThan(1e-6);
        // … then the ram throws the marble off its stop at v0, from rest
        const lift = hornAt(lane, a + p.h + p.TS - 1e-9, START);
        expect(lift.lid).toBeCloseTo(0, 6); expect(lift.v).toBeCloseTo(p.v0, 4);
      });
    });
  }

  it('long gaps PARK on the magnet at zero speed; dense gaps take the lower solved lob', () => {
    const lane = laneOf(CASES.sparse);
    for (const [i, p] of lane.plan.entries()){
      expect(p.free).toBe(true); expect(p.dwell).toBeGreaterThan(.5);
      const a = lane.L.s[i] + P, tc = a + p.h + p.TS + lane.tf;
      const pre = hornAt(lane, tc - 1e-6, START), mid = hornAt(lane, tc + p.dwell / 2, START);
      expect(pre.y).toBeCloseTo(lane.Hs, 5); expect(Math.abs(pre.v)).toBeLessThan(1e-4);
      expect(mid.held).toBe(true); expect(mid.y).toBe(lane.Hs); expect(mid.v).toBe(0);
    }
    const dense = laneOf(CASES.stabs);
    expect(dense.plan.some(p => !p.free)).toBe(true);
    for (const p of dense.plan.filter(p => !p.free)) expect(p.v0 * p.v0 / (2 * g)).toBeLessThan(dense.Hs);
  });

  it('the demo shows BOTH paths, stabs and held notes', () => {
    const { lanes } = demoLanes();
    const plans = lanes.flatMap(l => l.lane.plan);
    expect(plans.some(p => p.free && p.dwell > .5)).toBe(true);
    expect(plans.some(p => !p.free)).toBe(true);
    expect(horns.demo.part.some(e => isStab(e[3]))).toBe(true);
    expect(horns.demo.part.some(e => !isStab(e[3]))).toBe(true);
  });

  it('the demo lanes are honest too (count-in, every strike, the seam)', () => {
    const { P: Pd, lanes } = demoLanes();
    for (const { note, lane } of lanes){
      for (const a of strikesOf(lane, Pd, 2)){
        const b = hornAt(lane, a - 1e-7, START);
        expect(Math.abs(b.y), note).toBeLessThan(1e-5); expect(b.lid).toBe(0); expect(b.v).toBeLessThan(0);
      }
      let prev = hornAt(lane, START, START);
      let bad = 0;                                      // (plain counters: one expect per sample is slow)
      for (let t = START + 2e-3; t < START + 1.6 * Pd; t += 2e-3){
        const c = hornAt(lane, t, START);
        if (c.y - c.lid < -1e-9 || c.y > lane.Hs + 1e-9 || Math.abs(c.y - prev.y) > lane.vF * 2e-3 * 1.001 + 1e-9) bad++;
        prev = c;
      }
      expect(bad, note).toBe(0);
    }
  });

  it('ARMED count-in: at START every lane is loaded — on its magnet, still (or, when the loop\'s tail strikes inside the count-in sooner than a full drop, already falling from it)', () => {
    let held = 0;
    for (const { lane } of demoLanes().lanes){
      const c = hornAt(lane, START, START);
      expect(c.armed).toBe(true); expect(c.breath).toBe(0); expect(c.lid).toBe(0);
      if (c.until >= lane.tf){ held++; expect(c.held).toBe(true); expect(c.y).toBe(lane.Hs); expect(c.v).toBe(0); }
      else { const s = lane.tf - c.until; expect(c.y).toBeCloseTo(lane.Hs - g * s * s / 2, 12); expect(c.v).toBeCloseTo(-g * s, 12); }
      // and it stays exactly so until the release (no creep while waiting)
      if (c.until > lane.tf + .1) expect(hornAt(lane, START + .1, START).y).toBe(lane.Hs);
    }
    expect(held).toBeGreaterThan(6);
  });

  it('a PICKUP (negative beat) wraps into the loop and still lands from the magnet', () => {
    const lane = hornLane([-1, 4], [1, .8], [1, 1], P, { beat: BEAT });
    expect(lane.L.s).toEqual([4, 11]);
    for (const a of strikesOf(lane, P)){ const b = hornAt(lane, a - 1e-7, START); expect(Math.abs(b.y)).toBeLessThan(1e-5); }
  });

  it('a lane whose first strike comes too soon after START is already falling at START (still lands)', () => {
    const lane = hornLane([-2.1 + 12], [1], [0], P, { beat: BEAT });      // first strike .3 s after START
    const c = hornAt(lane, START, START);
    expect(c.armed).toBe(true); expect(c.held).toBe(false); expect(c.v).toBeLessThan(0);
    expect(Math.abs(hornAt(lane, -2.1 - 1e-7, START).y)).toBeLessThan(1e-5);
  });
});

describe('horns: timing helpers', () => {
  it('holds: stabs speak ≤ STAB_T, held notes ≤ HOLD_MAX, always leaving the snap + lob', () => {
    expect(holdFor(.25, .5, 2)).toBeCloseTo(.125, 9);
    expect(holdFor(0, .5, 2)).toBeCloseTo(STAB_T, 9);
    expect(holdFor(.5, 1, 2)).toBe(STAB_T);
    expect(holdFor(16, .5, 20)).toBe(HOLD_MAX);
    expect(holdFor(4, .5, 1)).toBeCloseTo(1 - .12, 9);
    expect(holdFor(4, .5, MIN_GAP)).toBeCloseTo(HOLD_MIN, 9);
  });
  it('the breath: rises with the tongue, holds, exhales to 0 — never negative, 0 before the strike', () => {
    expect(breathAt(-.1, 1)).toBe(0); expect(breathAt(0, 1)).toBe(0);
    expect(breathAt(.5, 1)).toBeGreaterThan(.99);
    expect(breathAt(2, 1)).toBeLessThan(1e-4);
    expect(breathAt(Infinity, 1)).toBe(0);
  });
  it('stroke depth grows with velocity (forte = more air)', () => {
    expect(dForVel(1)).toBeGreaterThan(dForVel(.5)); expect(dForVel(.5)).toBeGreaterThan(dForVel(0));
  });
  it('voice ids: the pitch for a held note, stab:<pitch> for a stab — ending in the note (spatial voiceHz)', () => {
    expect(voiceIdOf('C4', 1)).toBe('C4'); expect(voiceIdOf('C4', .25)).toBe('stab:C4'); expect(voiceIdOf('C4', 0)).toBe('stab:C4');
    expect(/:([A-G]#?\d)$/.exec('inst:horns:' + voiceIdOf('A#3', .5))[1]).toBe('A#3');
  });
});

describe('horns: geometry encodes the note only; lanes never interact', () => {
  it('a horn is a pure fn of its note: lower = bigger mouth, taller throat, longer bell', () => {
    const lo = hornGeom('A#2'), hi = hornGeom('F5');
    expect(lo.Rm).toBeGreaterThan(hi.Rm); expect(lo.yT).toBeGreaterThan(hi.yT); expect(lo.Lb).toBeGreaterThan(hi.Lb);
    expect(hornGeom('C4')).toEqual(hornGeom('C4'));
    // the same note in two different sections: identical (only the whole bed's uniform scale differs)
    const a = layoutHorns(['C3', 'C4']), b = layoutHorns(['C2', 'D2', 'E2', 'F2', 'G2', 'A2', 'B2', 'C3', 'D3', 'E3', 'F3', 'C4']);
    expect(a.geo[1]).toEqual(b.geo[11]);
    expect(a.scale).toBe(1); expect(b.scale).toBeLessThan(1);
  });

  it('families by register; real trombone slide positions; real fingerings', () => {
    expect(family(40)).toBe('tba'); expect(family(50)).toBe('tbn'); expect(family(70)).toBe('tpt');
    expect(slidePos(58)).toBe(0); expect(slidePos(57)).toBe(1); expect(slidePos(52)).toBe(1); expect(slidePos(51)).toBe(2); expect(slidePos(40)).toBe(6); expect(slidePos(64)).toBe(1);   // Bb3 1st, A3 2nd, E3 2nd, D#3 3rd, E2 7th, E4 2nd
    expect(fingering(70)).toEqual([]); expect(fingering(69)).toEqual([2]); expect(fingering(67)).toEqual([1, 2]); expect(fingering(65)).toEqual([]); expect(fingering(64)).toEqual([2]);   // sounding Bb4 open, A4 2, G4 1+2, F4 open, E4 2
    expect(hornGeom('A#3').slide).toBe(0); expect(hornGeom('D5').valves).toEqual(fingering(74));
  });

  it('1..12 lanes: slabs are disjoint, inside the deck, every lane part inside its own slab', () => {
    const ALL = ['E2', 'A#2', 'D3', 'F3', 'G3', 'A#3', 'C4', 'D4', 'F4', 'G4', 'A#4', 'D5', 'F5', 'A5', 'D6'];
    for (let n = 1; n <= 12; n++) for (const off of [0, 3]){
      const notes = ALL.slice(off, off + n).sort((a, b) => noteNum(a) - noteNum(b));
      const W = 14, L = layoutHorns(notes, W);
      const slabs = L.geo.map((q, k) => [(L.xs[k] - q.halfW) * L.scale, (L.xs[k] + q.halfW) * L.scale]);
      for (let k = 0; k < slabs.length; k++){
        expect(slabs[k][0]).toBeGreaterThanOrEqual(-W / 2); expect(slabs[k][1]).toBeLessThanOrEqual(W / 2);
        if (k) expect(slabs[k][0]).toBeGreaterThanOrEqual(slabs[k - 1][1] - 1e-9);
        const q = L.geo[k];
        // bellows, magnet, bell (+ flare + rim) all within ±halfW of the lane's plumb line
        expect(BW / 2 + .04).toBeLessThanOrEqual(q.halfW); expect(MAG_R).toBeLessThanOrEqual(q.halfW);
        expect(q.Rm * 1.06 + .045).toBeLessThanOrEqual(q.halfW);
      }
    }
  });

  it('every bell clears the magnet gantry in front of it (its rim stays above the beam or behind it)', () => {
    for (let m = PART_LIMITS.lo; m <= PART_LIMITS.hi; m++){
      const note = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12] + (Math.floor(m / 12) - 1);
      const q = hornGeom(note), lo = bellLow(q);
      const inFront = lo.z > Z_B - .4;
      if (inFront) expect(lo.y, note).toBeGreaterThan(Y_BEAM + .2);
      expect(Z_H + q.rT).toBeLessThan(Z_B - BW / 2);        // the riser stands behind the bellows
    }
  });
});

describe('horns: imports are fitted, never crash', () => {
  it('junk is skipped; vel clamped; pitches folded into range', () => {
    const fit = fitPart([null, [1], ['x', 'C4'], [0, 'H9'], [0, 'C9', 3], [1, 'C1', -1, -2], [2, 'G4', .5, 1]], { beat: .5 });
    for (const [b, n, v, d] of fit){
      expect(Number.isFinite(b)).toBe(true);
      const m = noteNum(n); expect(m).toBeGreaterThanOrEqual(PART_LIMITS.lo); expect(m).toBeLessThanOrEqual(PART_LIMITS.hi);
      expect(v).toBeGreaterThan(0); expect(v).toBeLessThanOrEqual(1); expect(d).toBeGreaterThanOrEqual(0);
    }
    expect(fit.length).toBe(3);
  });

  it('a dense random MIDI-like part: ≤ 12 horns, same-pitch ≥ MIN_GAP (incl. the seam), ≤ maxEvents, and every lane solves honestly', () => {
    let s = 7; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const loopBeats = 64, beat = 60 / 150, Pp = ROLL_T + loopBeats * beat;
    const part = Array.from({ length: 900 }, () => [Math.floor(rnd() * loopBeats * 4) / 4, names[Math.floor(rnd() * 12)] + (2 + Math.floor(rnd() * 5)), rnd(), rnd() < .3 ? 0 : rnd() * 4]);
    const fit = fitPart(part, { beat, loopBeats });
    expect(fit.length).toBeLessThanOrEqual(PART_LIMITS.maxEvents);
    const by = lanesByNote(eventTimes(fit, { rollT: ROLL_T, beat }));
    expect(Object.keys(by).length).toBeLessThanOrEqual(PART_LIMITS.pitches);
    for (const [note, evs] of Object.entries(by)){
      const lane = hornLane(evs.map(e => e.t), evs.map(e => e.vel), evs.map(e => e.dur), Pp, { beat, scale: .75 });
      for (const gp of lane.L.gaps) expect(gp, note).toBeGreaterThanOrEqual(MIN_GAP - 1e-6);
      for (const a of strikesOf(lane, Pp, 1)){
        const b = hornAt(lane, a - 1e-7, START);
        expect(Math.abs(b.y), note).toBeLessThan(1e-5); expect(b.lid).toBe(0);
      }
      for (let t = START; t < START + Pp; t += 2e-3){
        const c = hornAt(lane, t, START);
        expect(Number.isFinite(c.y) && Number.isFinite(c.lid)).toBe(true);
        expect(c.y - c.lid).toBeGreaterThanOrEqual(-1e-9); expect(c.y).toBeLessThanOrEqual(lane.Hs + 1e-9);
      }
    }
  });

  it('PART_LIMITS is the solver\'s truth: a repeat at exactly the gap floor still lands honestly', () => {
    expect(PART_LIMITS.gap).toBe(MIN_GAP);
    expect(PART_LIMITS.maxDur).toBe(HOLD_MAX); expect(PART_LIMITS.minDur).toBe(HOLD_MIN);
    const lane = laneOf(CASES.limit);
    for (const a of strikesOf(lane, P)){ const b = hornAt(lane, a - 1e-7, START); expect(Math.abs(b.y)).toBeLessThan(1e-5); expect(b.v).toBeLessThan(0); }
  });

  it('an empty / missing part builds nothing and never throws', () => {
    expect(fitPart(undefined)).toEqual([]);
    const inst = horns.make({ envMap: null, glowTex: null, THREE });
    const grp = inst.build([], { rollT: ROLL_T, beat: .5, P: 10, start: START, station: { w: 14, d: 6 }, floorY: -1 });
    expect(grp.children.length).toBe(0);
    inst.update(0, 10, .016, { started: true, skipStrikes: false, onStrike: () => {} });
  });
});

describe('horns: the build', () => {
  const inst = horns.make({ envMap: null, glowTex: null, THREE });
  const d = horns.demo, beat = 60 / d.bpm, Pd = ROLL_T + d.beats * beat;
  const grp = inst.build(d.part, { rollT: ROLL_T, beat, P: Pd, start: START, station: { w: 14, d: 6 }, floorY: -1.5, loopBeats: d.beats });
  it('stays inside the mesh budget and the footprint; materials constant across frames', () => {
    let meshes = 0; const mats = new Set();
    grp.traverse(o => { if (o.isMesh || o.isSprite){ meshes++; mats.add(o.material); } });
    expect(meshes).toBeLessThanOrEqual(150);
    const box = new THREE.Box3().setFromObject(grp);
    expect(box.min.x).toBeGreaterThanOrEqual(-7 - 1e-6); expect(box.max.x).toBeLessThanOrEqual(7 + 1e-6);
    expect(box.min.z).toBeGreaterThanOrEqual(-3.5); expect(box.max.z).toBeLessThanOrEqual(3.5);
    const hits = []; let tEnd = START;
    for (let t = START; t < START + Pd + 1; t += 1 / 60){ inst.update(t, Pd, 1 / 60, { started: true, skipStrikes: false, onStrike: h => hits.push(h) }); tEnd = t; }
    const after = new Set(); grp.traverse(o => { if (o.isMesh || o.isSprite) after.add(o.material); });
    expect(after.size).toBe(mats.size);
    // every demo strike in the first loop fired once, with the right voice id + its hold as dur
    const fit = fitPart(d.part, { beat, loopBeats: d.beats });
    const uniq = [...new Set(fit.map(e => `${e[0]}|${e[1]}`))].map(k => ROLL_T + +k.split('|')[0] * beat);
    let expected = 0;                                   // every strike in (START, tEnd] — incl. the loop's tail inside the count-in
    for (const t of uniq) for (let k = -1; k <= 1; k++){ const a = t + k * Pd; if (a > START + 1e-6 && a <= tEnd) expected++; }
    expect(hits.length).toBe(expected);
    for (const h of hits){
      expect(horns.voiceIds(d.part)).toContain(h.note);
      expect(h.dur).toBeGreaterThan(0); expect(h.dur).toBeLessThanOrEqual(HOLD_MAX);
    }
  });
});

describe('horns: a dense random part survives the whole build', () => {
  it('500 random events: builds fast, ≤ 150 meshes, every frame finite, every strike fires with a real voice id', () => {
    let s = 11; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const loopBeats = 32, beat = 60 / 140, Pp = ROLL_T + loopBeats * beat;
    const part = Array.from({ length: 500 }, () => [Math.floor(rnd() * loopBeats * 8) / 8, names[Math.floor(rnd() * 12)] + (1 + Math.floor(rnd() * 7)), rnd() * 1.2, rnd() < .4 ? 0 : rnd() * 6]);
    const inst = horns.make({ envMap: null, glowTex: null, THREE });
    const t0 = performance.now();
    const grp = inst.build(part, { rollT: ROLL_T, beat, P: Pp, start: START, station: { w: 14, d: 6 }, floorY: -1.5, loopBeats });
    expect(performance.now() - t0).toBeLessThan(1500);
    let meshes = 0; grp.traverse(o => { if (o.isMesh || o.isSprite) meshes++; });
    expect(meshes).toBeLessThanOrEqual(150);
    const ids = new Set(horns.voiceIds(part)), hits = [];
    const t1 = performance.now(); let frames = 0;
    for (let t = START; t < START + Pp + .5; t += 1 / 60, frames++)
      inst.update(t, Pp, 1 / 60, { started: true, skipStrikes: false, onStrike: h => hits.push(h) });
    expect((performance.now() - t1) / frames).toBeLessThan(2);       // ms per frame
    grp.traverse(o => { if (o.isMesh || o.isSprite) expect(Number.isFinite(o.position.y) && Number.isFinite(o.scale.y)).toBe(true); });
    expect(hits.length).toBeGreaterThan(50);
    for (const h of hits){ expect(ids.has(h.note)).toBe(true); expect(h.dur).toBeGreaterThan(0); expect(Number.isFinite(h.pos.y)).toBe(true); }
  });
});

describe('horns: the voice', () => {
  const ids = horns.voiceIds(horns.demo.part);
  it('every demo id pre-renders fast (song-load budget)', () => {
    const t0 = performance.now();
    for (const id of ids) hornVoice(id);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(ids.some(i => i.startsWith('stab:'))).toBe(true);
  });
  it('deterministic, peak in (.5, .9], ends exactly at 0, short enough', () => {
    for (const id of ids){
      const v = hornVoice(id);
      expect(hornVoice(id)).toBe(v);
      let pk = 0; for (const x of v.samples) pk = Math.max(pk, Math.abs(x));
      expect(pk, id).toBeGreaterThan(.5); expect(pk, id).toBeLessThanOrEqual(.9);
      expect(v.samples[v.samples.length - 1]).toBe(0); expect(Math.abs(v.samples[0])).toBe(0);   // no click at either end
      expect(v.samples.length).toBeLessThan(v.sr * 3.5);
    }
  });
  it('the tuba still reads on a phone: ≥ 30 % of its energy above 200 Hz (CLAUDE.md §5)', () => {
    const goertzel = (x, sr, f, a, b) => { const w = 2 * Math.PI * f / sr, c = 2 * Math.cos(w); let s1 = 0, s2 = 0;
      for (let i = a; i < b; i++){ const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; } return s1 * s1 + s2 * s2 - c * s1 * s2; };
    for (const note of ['E2', 'G2', 'A#2']){
      const { samples, sr } = hornVoice(note), f = noteHz(note), a = Math.round(.4 * sr), b = a + Math.round(.8 * sr);
      let lo = 0, hi = 0;
      for (let k = 1; k <= 24; k++){ const e = goertzel(samples, sr, k * f, a, b); if (k * f < 200) lo += e; else hi += e; }
      expect(hi / (lo + hi), note).toBeGreaterThan(.3);   // (before the body lift: an E2 kept ~11 %)
    }
  });
  it('a stab is short; a held note sustains then exhales', () => {
    const st = hornVoice('stab:F4'), hd = hornVoice('F4');
    expect(st.samples.length / st.sr).toBeLessThan(.6);
    const rms = (v, a, b) => { let s = 0; for (let i = Math.round(a * v.sr); i < Math.round(b * v.sr); i++) s += v.samples[i] ** 2; return Math.sqrt(s / ((b - a) * v.sr)); };
    expect(rms(hd, 2, 2.4)).toBeGreaterThan(.3 * rms(hd, .2, .6));      // still speaking at 2 s
    expect(rms(hd, hd.samples.length / hd.sr - .05, hd.samples.length / hd.sr)).toBeLessThan(.02 * rms(hd, .2, .6));
  });
  it('the pitch is the note: energy sits on the harmonic series of f, not between it', () => {
    const goertzel = (x, sr, f, a, b) => { const w = 2 * Math.PI * f / sr, c = 2 * Math.cos(w); let s1 = 0, s2 = 0;
      for (let i = a; i < b; i++){ const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; } return s1 * s1 + s2 * s2 - c * s1 * s2; };
    for (const note of ['A#2', 'F3', 'C4', 'A#4', 'F5']){
      const { samples, sr } = hornVoice(note), f = noteHz(note), a = Math.round(.3 * sr), b = a + Math.round(.8 * sr);
      let on = 0, off = 0;
      for (let k = 1; k <= 4; k++){ on += goertzel(samples, sr, k * f, a, b); off += goertzel(samples, sr, (k + .5) * f, a, b); }
      expect(on / off, note).toBeGreaterThan(20);
    }
  });
});
