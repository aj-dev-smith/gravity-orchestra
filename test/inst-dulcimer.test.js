import { splitBucket, BUCKET_CAP } from '../src/instruments/sustain.js';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { eventTimes, wrapP } from '../src/instruments/clock.js';
import {
  dulcimerLane, dulcimerAt, solveGap, minGap, flight, fallTo, vHit, fitPart, parseNote, voiceIdOf, layoutStrings,
  stringLen, stringR, stringClear, damperClear, PART_LIMITS,
  g, H, E, BALL_R, Y_BOT, Y_LO, Y_HI, C_TOP, A_CUP, CUP_RIM, CUP_R, SLEEVE_R, DAMP_HW, SLAB_HW, PLANE_MIN, MAX_STRINGS,
  MAX_POLY, MAX_EVENTS, LO, HI, LIFT, STRIKE_U, LIFT_LEAD, DROP_T,
} from '../src/instruments/dulcimer/solve.js';
import { grandVoice, SR } from '../src/instruments/dulcimer/voice.js';
import grand from '../src/instruments/dulcimer/index.js';
import { STATIONS } from '../src/instruments/stations.js';

const ROLL_T = 2.6, START = -2.4;
const U_DAMP = m => 1.95 / stringLen(m);          // the damper's point along the string (index.js DAMP_BACK)

/* demo part → lanes, exactly as build() makes them */
function demoLanes(demo){
  const beat = 60 / demo.bpm, P = ROLL_T + demo.beats * beat + 1.2;
  const { part } = fitPart(demo.part, { maxDurBeats: 4.5 / beat });
  const by = new Map();
  for (const e of eventTimes(part, { rollT: ROLL_T, beat })){ const m = parseNote(e.note).m; (by.get(m) || by.set(m, []).get(m)).push({ t: e.t, vel: e.vel, hold: e.tDur }); }
  return { P, beat, lanes: [...by].map(([m, ev]) => ({ m, lane: dulcimerLane(ev, P, { m }) })) };
}
const strikesOf = (lane, P, loops = 3) => {
  const out = [];
  for (let k = -1; k <= loops; k++) for (const s of lane.L.s){ const a = s + k * P; if (a >= START - 1e-9 && a < START + loops * P) out.push(a); }
  return out.sort((a, b) => a - b);
};

describe('dulcimer: the ballistics', () => {
  it('a launch from level y arrives at the string still rising at exactly v (u² = v² + 2g(H − y))', () => {
    for (const y of [Y_BOT, Y_LO, .8, Y_HI]) for (const v of [vHit(0), vHit(.5), vHit(1)]){
      const { u, tau } = flight(y, v);
      expect(y + u * tau - .5 * g * tau * tau).toBeCloseTo(H, 10);
      expect(u - g * tau).toBeCloseTo(v, 10);
    }
  });
  it('the rebound is lossy: it leaves at e·v and falls to the catch level', () => {
    for (const y of [Y_LO, 1]){
      const v = vHit(.7), { w, tf } = fallTo(y, v);
      expect(H - E * v * tf - .5 * g * tf * tf).toBeCloseTo(y, 10);
      expect(E * v + g * tf).toBeCloseTo(w, 10);
    }
  });
  it('a harder key throws a faster hammer (dynamics = hammer speed), and the hammer always clears the cup', () => {
    expect(vHit(1)).toBeGreaterThan(vHit(0));
    expect(H - Y_HI).toBeGreaterThan(2 * BALL_R * .5);
    expect(C_TOP + CUP_RIM).toBeLessThan(H + BALL_R - .1);       // the cup's rim never reaches the string
  });
});

describe('dulcimer: lanes are honest', () => {
  const P = 12;
  const cases = {
    single: [[5, .7, 1]],
    sparse: [[3, 1, .4], [9, .3, 2]],
    dense:  [[3, .6, .2], [3.25, .5, .2], [3.5, .9, .5], [3.8, .2, .3], [6, 1, 3]],
    legato: [[2, .7, 1.5], [2.6, .6, 1.5], [3.2, .8, .4], [8, .5, 4]],
    mixed:  [[2.7, .9, .3], [3.0, .4, .1], [5, .8, 1], [5.45, .6, 1], [8, .3, .2], [11.8, 1, .6]],
    seam:   [[.1, .8, .2], [11.75, .9, .2]],                     // dense across the loop seam
    pickup: [[-.4, .8, .5], [4, .6, 1]],                         // a pickup wraps to the loop tail
  };
  for (const [name, hits] of Object.entries(cases)){
    const m = 60;
    const lane = dulcimerLane(hits.map(([t, vel, hold]) => ({ t, vel, hold })), P, { m });
    const strikes = strikesOf(lane, P);
    const first = strikes[0];

    it(`${name}: nothing thinned, every strike lands at the string exactly on the beat, rising — free at contact`, () => {
      expect(lane.dropped).toBe(0);
      for (const a of strikes){
        const before = dulcimerAt(lane, a - 1e-7, START), after = dulcimerAt(lane, a + 1e-7, START);
        expect(Math.abs(before.y - H), `${name} @${a}`).toBeLessThan(1e-5);
        expect(before.vy).toBeGreaterThan(0);                   // still rising into the string
        expect(before.seated).toBe(false);                      // a free marble, not a pushed one
        expect(after.vy).toBeLessThan(0);                       // bounced back down
        expect(after.since).toBeLessThan(1e-6);
        const i = after.i;
        expect(before.vy).toBeCloseTo(lane.v[i], 4);            // at the solved hammer speed
        expect(-after.vy).toBeCloseTo(E * lane.v[i], 4);        // lossy: e·v
      }
    });

    it(`${name}: on a pure ballistic arc (energy) in the last 20 ms before every hit`, () => {
      for (const a of strikes.filter(a => a > first)){
        const c = dulcimerAt(lane, a - .02, START);
        expect(c.seated).toBe(false);
        const v = lane.v[lane.L.s.indexOf(+wrapP(a, P).toFixed(9))];
        expect(c.vy * c.vy).toBeCloseTo(v * v + 2 * g * (H - c.y), 6);
      }
    });

    it(`${name}: continuous everywhere (count-in, catches, kicks, releases, the seam) — nothing teleports`, () => {
      const dt = 5e-4;
      let prev = dulcimerAt(lane, START, START);
      for (let t = START + dt; t < START + 2.2 * P; t += dt){
        const c = dulcimerAt(lane, t, START);
        expect(Math.abs(c.y - prev.y), `${name} y @${t.toFixed(4)}`).toBeLessThan(9 * dt);
        expect(Math.abs(c.cup - prev.cup), `${name} cup @${t.toFixed(4)}`).toBeLessThan(10 * dt);
        expect(Math.abs(c.damp - prev.damp), `${name} damper @${t.toFixed(4)}`).toBeLessThan(dt * 1.6 / Math.min(DROP_T, .06) + 1e-9);
        expect(Math.abs(c.vib - prev.vib)).toBeLessThan(.003);
        prev = c;
      }
    });

    it(`${name}: no penetration — marble on/above its cup, under its string; cup inside its stroke; felt never cuts the string`, () => {
      const dt = 1e-3;
      for (let t = START; t < START + 2.2 * P; t += dt){
        const c = dulcimerAt(lane, t, START);
        expect(c.y - c.cup, `${name} ball/cup @${t.toFixed(3)}`).toBeGreaterThanOrEqual(-1e-9);
        if (c.seated) expect(Math.abs(c.y - c.cup)).toBeLessThan(1e-12);
        expect(stringClear(c.y, c.vib), `${name} string @${t.toFixed(3)}`).toBeGreaterThanOrEqual(-1e-9);
        expect(c.cup).toBeGreaterThanOrEqual(Y_BOT - 1e-9);
        expect(c.cup).toBeLessThanOrEqual(C_TOP + 1e-9);
        expect(damperClear(c.damp, c.vib, U_DAMP(m)), `${name} damper @${t.toFixed(3)}`).toBeGreaterThanOrEqual(-1e-12);
      }
    });

    it(`${name}: the cup only PUSHES (never pulls the marble down), within the piston's limit`, () => {
      for (let t = START; t < START + 2.2 * P; t += 1e-3){
        const c = dulcimerAt(lane, t, START);
        if (!c.seated) continue;
        expect(c.cupA).toBeGreaterThanOrEqual(0);
        expect(c.cupA).toBeLessThanOrEqual(A_CUP + 1e-6);
      }
    });

    it(`${name}: the cup waits AT REST for the landing (ball velocity continuous through the catch)`, () => {
      lane.plan.forEach((p, i) => {
        const a = lane.L.s[i] + P;
        const pre = dulcimerAt(lane, a + p.tf - 1e-6, START), post = dulcimerAt(lane, a + p.tf + 1e-6, START);
        expect(pre.seated).toBe(false); expect(post.seated).toBe(true);
        expect(Math.abs(pre.cupV)).toBeLessThan(1e-6);           // the felt was still
        expect(pre.cup).toBeCloseTo(pre.y, 4);                   // and exactly where the marble arrives
        expect(post.vy).toBeCloseTo(pre.vy, 2);                  // the marble's motion is continuous
      });
    });

    it(`${name}: the string is at rest and the damper fully up at every contact`, () => {
      for (const a of strikes){
        const c = dulcimerAt(lane, a - 1e-4, START);
        expect(Math.abs(c.vib)).toBeLessThan(1e-7);
        expect(c.damp).toBe(1);
      }
    });
  }

  it('the count-in: ARMED — the marble rests in its cradle, still, the damper down', () => {
    const lane = dulcimerLane([{ t: 4, vel: 1, hold: 1 }], 12, { m: 60 });
    const c = dulcimerAt(lane, START, START);
    expect(c.armed).toBe(true); expect(c.seated).toBe(true);
    expect(c.y).toBe(Y_BOT); expect(c.vy).toBe(0); expect(c.damp).toBe(0);
  });

  it('long gaps PARK at the cradle floor at rest; fast repeats ride the repetition lever', () => {
    const lane = dulcimerLane([{ t: 3, vel: .7 }, { t: 3.3, vel: .7 }, { t: 8, vel: .7 }], 12, { m: 60 });
    expect(lane.plan.map(p => p.mode)).toEqual(['repeat', 'park', 'park']);
    const p = lane.plan[1], a = lane.L.s[1] + 12;
    const mid = dulcimerAt(lane, a + p.tf + p.T1 + p.Th / 2, START);
    expect(mid.y).toBeCloseTo(Y_BOT, 12); expect(mid.vy).toBe(0);
    expect(lane.plan[0].y).toBeGreaterThan(Y_LO);                // caught high
  });

  it('a note-off drops the damper (it rests on the string); a re-strike before the drop keeps it up', () => {
    const lane = dulcimerLane([{ t: 3, vel: .7, hold: .4 }, { t: 6, vel: .7, hold: 2 }, { t: 6.5, vel: .7, hold: .3 }], 12, { m: 60 });
    expect(dulcimerAt(lane, 12 + 3 + .2, START).damp).toBe(1);
    expect(dulcimerAt(lane, 12 + 3 + .4 + DROP_T + .01, START).damp).toBe(0);
    for (let t = 12 + 6; t < 12 + 6.5 + .3; t += .01) expect(dulcimerAt(lane, t, START).damp).toBe(1);
    expect(lane.plan[1].legato).toBe(true);
    // the dropped felt kills the string's motion and its light
    const off = dulcimerAt(lane, 12 + 3 + .4 + DROP_T + .01, START);
    expect(off.vib).toBe(0); expect(off.sing).toBe(0);
  });
});

describe('dulcimer: the repetition limit (what the orchestrator may send)', () => {
  it('PART_LIMITS.gap is honest: every velocity pair can repeat at it, a faster repeat is thinned', () => {
    for (const a of [0, .25, .5, .75, 1]) for (const b of [0, .25, .5, .75, 1]){
      expect(solveGap(PART_LIMITS.gap, vHit(a), vHit(b)), `${a}/${b}`).toBeTruthy();
      expect(minGap(vHit(a), vHit(b))).toBeLessThanOrEqual(PART_LIMITS.gap);
    }
    expect(PART_LIMITS.gap).toBeLessThan(.25);                  // 8ths at 120 bpm play
    const lane = dulcimerLane([{ t: 3, vel: .5 }, { t: 3.08, vel: .5 }, { t: 3.16, vel: .5 }, { t: 6, vel: .5 }], 12, { m: 60 });
    expect(lane.dropped).toBe(2);
    expect(lane.L.s).toEqual([3, 6]);
  });

  it('the cup\'s free glide (to the next catch level) never exceeds the piston\'s limit either', () => {
    const glideA = lane => Math.max(0, ...lane.plan.map(p => 6 * Math.abs(p.ret.b - p.ret.c) / (p.ret.g1 - p.ret.g0) ** 2));
    let worst = 0, seed = 3;
    const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let gap = PART_LIMITS.gap; gap < 1; gap += .01) for (const a of [0, 1]) for (const b of [0, 1]) for (const c of [0, 1])
      worst = Math.max(worst, glideA(dulcimerLane([{ t: 1, vel: a }, { t: 1 + gap, vel: b }, { t: 1 + 2 * gap, vel: c }], 10)));
    for (let k = 0; k < 150; k++){
      const P = 4 + R() * 20, n = 1 + Math.floor(R() * 40);
      worst = Math.max(worst, glideA(dulcimerLane(Array.from({ length: n }, () => ({ t: R() * P, vel: R(), hold: R() })), P)));
    }
    expect(worst).toBeLessThanOrEqual(A_CUP * (1 + 1e-9));
  });

  it('a pathological string (400 strikes 30 ms apart) thins in one pass and stays honest', () => {
    const P = 14, t0 = performance.now();
    const lane = dulcimerLane(Array.from({ length: 400 }, (_, i) => ({ t: 2 + i * .03, vel: (i % 7) / 6, hold: .05 })), P, { m: 70 });
    expect(performance.now() - t0).toBeLessThan(250);
    expect(lane.n).toBeGreaterThan(20);
    for (let i = 0; i < lane.n; i++) expect(lane.plan[i]).toBeTruthy();
    for (let t = START; t < START + 1.2 * P; t += 2e-3){
      const c = dulcimerAt(lane, t, START);
      expect(c.y - c.cup).toBeGreaterThanOrEqual(-1e-9);
      expect(stringClear(c.y, c.vib)).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('PART_LIMITS is the plain routing record', () => {
    expect(PART_LIMITS).toMatchObject({ lo: LO, hi: HI, pitches: MAX_STRINGS, poly: MAX_POLY, maxEvents: MAX_EVENTS, sustain: true });
    expect(Object.isFrozen(PART_LIMITS)).toBe(true);
  });
});

describe('dulcimer: fitPart makes ANY part playable (imports degrade, never crash)', () => {
  it('tolerates garbage', () => {
    const { part, warnings } = fitPart([null, [0], [1, 'H9'], [2, 'C4', NaN, -3], 'x', [3, 'Db4'], [4, 'C4', 2, 1]]);
    expect(part).toEqual([[2, 'C4', 1, 0], [4, 'C4', 1, 1]]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(fitPart(undefined).part).toEqual([]);
  });
  it('folds out-of-range pitches by octaves into A1–C7', () => {
    const { part } = fitPart([[0, 'C1'], [1, 'C8'], [2, 'G#7']]);
    expect(part.map(e => e[1])).toEqual(['C2', 'C7', 'G#6']);
    for (const e of part){ const m = parseNote(e[1]).m; expect(m).toBeGreaterThanOrEqual(LO); expect(m).toBeLessThanOrEqual(HI); }
  });
  it('a 40-pitch, 1000-event, 12-note-chord monster fits the machine', () => {
    const big = [];
    for (let i = 0; i < 1000; i++) big.push([i * .25, ['C', 'D', 'E', 'F', 'G', 'A', 'B'][i % 7] + (1 + (i * 7) % 7), .2 + (i % 5) / 6, .5]);
    for (let k = 0; k < 12; k++) big.push([3, ['C', 'E', 'G'][k % 3] + (2 + (k >> 1) % 5), .9]);
    const { part, warnings } = fitPart(big);
    expect(new Set(part.map(e => parseNote(e[1]).m)).size).toBeLessThanOrEqual(MAX_STRINGS);
    expect(part.length).toBeLessThanOrEqual(MAX_EVENTS);
    const per = new Map(); for (const e of part) per.set(e[0], (per.get(e[0]) || 0) + 1);
    expect(Math.max(...per.values())).toBeLessThanOrEqual(MAX_POLY);
    expect(warnings.length).toBeGreaterThan(1);
  });
  it('keeps the e-piano timbre flag and picks the soft layer below vel .6', () => {
    const { part } = fitPart([[0, 'C4:e', .3], [1, 'C4', .9]]);
    expect(part[0][1]).toBe('C4:e');
    expect(voiceIdOf(60, true, .3)).toBe('C4:e:p');
    expect(voiceIdOf(60, false, .9)).toBe('C4');
  });
});

describe('dulcimer: lanes can never touch (the slab rule) and geometry is the note alone', () => {
  it('every lane part fits in its ±SLAB_HW slab; slabs never overlap at any layout', () => {
    for (const r of [BALL_R, CUP_R, SLEEVE_R, DAMP_HW]) expect(r).toBeLessThanOrEqual(SLAB_HW);
    expect(PLANE_MIN).toBeGreaterThanOrEqual(2 * SLAB_HW);
    const bed = STATIONS.dulcimer.w - 1.5;                        // index.js: W − 2·(SIDE + .35)
    for (let n = 1; n <= MAX_STRINGS; n++){
      const { xs, SP } = layoutStrings(n, bed);
      if (n > 1) expect(SP, `n=${n}`).toBeGreaterThanOrEqual(PLANE_MIN - 1e-12);
      expect(xs[0] - SLAB_HW).toBeGreaterThanOrEqual(-bed / 2 - SLAB_HW - 1e-9);
      expect(xs[n - 1]).toBeLessThanOrEqual(bed / 2 + 1e-9);
    }
  });
  it('string length and gauge are pure, monotone functions of pitch (bass long + thick, treble short)', () => {
    for (let m = LO; m < HI; m++){
      expect(stringLen(m + 1)).toBeLessThan(stringLen(m));
      expect(stringR(m + 1)).toBeLessThanOrEqual(stringR(m));
    }
    expect(stringLen(60)).toBe(stringLen(60));
    // the longest string + its tail fits the station's depth behind the keys (index.js Z_F = d/2 − 2.15)
    expect(STATIONS.dulcimer.d / 2 - 2.15 - stringLen(LO) - .9).toBeGreaterThanOrEqual(-STATIONS.dulcimer.d / 2);
    // and the damper (1.95 behind the front) always lands on the speaking length, behind the strike point
    expect(1.95 + DAMP_HW).toBeLessThan(stringLen(HI));
    expect(stringLen(LO) * STRIKE_U + BALL_R + DAMP_HW).toBeLessThan(1.95);
  });
});

describe('dulcimer: the demo', () => {
  const { P, lanes } = demoLanes(grand.demo);
  it('fits the machine untouched (no folds, no thinning) on ≤ MAX_STRINGS strings', () => {
    const { part, warnings } = fitPart(grand.demo.part);
    expect(warnings).toEqual([]);
    expect(part.length).toBe(grand.demo.part.length);
    expect(lanes.length).toBeLessThanOrEqual(MAX_STRINGS);
    expect(lanes.reduce((s, l) => s + l.lane.dropped, 0)).toBe(0);
  });
  it('every demo lane is honest end to end', () => {
    for (const { m, lane } of lanes){
      for (let t = START; t < START + 1.3 * P; t += 2e-3){
        const c = dulcimerAt(lane, t, START);
        expect(c.y - c.cup).toBeGreaterThanOrEqual(-1e-9);
        expect(stringClear(c.y, c.vib)).toBeGreaterThanOrEqual(-1e-9);
        expect(damperClear(c.damp, c.vib, U_DAMP(m))).toBeGreaterThanOrEqual(-1e-12);
      }
      for (const a of strikesOf(lane, P, 2)) expect(Math.abs(dulcimerAt(lane, a - 1e-7, START).y - H)).toBeLessThan(1e-5);
    }
  });
  it('shows off both paths (cradle park + repetition lever), chords and held notes', () => {
    const modes = new Set(lanes.flatMap(l => l.lane.plan.map(p => p.mode)));
    expect(modes.has('park')).toBe(true); expect(modes.has('repeat')).toBe(true);
    const onsets = new Map(); for (const e of grand.demo.part) onsets.set(e[0], (onsets.get(e[0]) || 0) + 1);
    expect(Math.max(...onsets.values())).toBeGreaterThanOrEqual(3);
    expect(lanes.some(l => l.lane.plan.some(p => p.legato))).toBe(true);
  });

  it('build + update: every strike fires once per loop with a baked voice id and its hold as dur', () => {
    const inst = grand.make({ envMap: null, glowTex: null, THREE });
    const beat = 60 / grand.demo.bpm;
    const group = inst.build(grand.demo.part, { rollT: ROLL_T, beat, P, start: START, station: STATIONS.dulcimer, floorY: -21.5, loopBeats: grand.demo.beats });
    let meshes = 0; group.traverse(o => { if (o.isMesh || o.isPoints) meshes++; });
    expect(meshes).toBeLessThanOrEqual(40);                     // static structure merged, moving parts instanced
    const hits = [], ids = new Set(grand.voiceIds(grand.demo.part));
    for (let t = START; t < START + P; t += 1 / 60) inst.update(t, P, 1 / 60, { started: true, skipStrikes: false, onStrike: h => hits.push(h) });
    const want = lanes.reduce((s, l) => s + l.lane.n, 0);
    expect(hits.length).toBe(want);
    for (const h of hits){ expect(ids.has(h.note), h.note).toBe(true); expect(h.dur).toBeGreaterThan(0); }
    // the built bed stays inside its footprint
    const b = new THREE.Box3().setFromObject(group);
    expect(b.max.x - b.min.x).toBeLessThanOrEqual(STATIONS.dulcimer.w + 1e-6);
    expect(b.max.z).toBeLessThanOrEqual(STATIONS.dulcimer.d / 2 + 1e-6);
    expect(b.min.z).toBeGreaterThanOrEqual(-STATIONS.dulcimer.d / 2 - 1e-6);
  });
});

describe('dulcimer: the voice', () => {
  const rms = (s, a, b) => { let x = 0; for (let i = a; i < b; i++) x += s[i] * s[i]; return Math.sqrt(x / (b - a)); };
  const goertzel = (s, f, a, b) => { const w = 2 * Math.PI * f / SR, c = 2 * Math.cos(w); let s1 = 0, s2 = 0;
    for (let i = a; i < b; i++){ const s0 = s[i] + c * s1 - s2; s2 = s1; s1 = s0; } return s1 * s1 + s2 * s2 - c * s1 * s2; };

  it('deterministic, bounded, decaying, ends at exactly 0 — piano, soft layer and e-piano', () => {
    for (const id of ['C2', 'A4', 'C7', 'E4:p', 'G3:e', 'C5:e:p']){
      const a = grandVoice(id), b = grandVoice(id);
      expect(a.samples).toBe(b.samples);
      const { samples, sr } = a;
      expect(sr).toBe(SR);
      expect(samples.length / sr).toBeLessThanOrEqual(4.5);
      let peak = 0; for (const x of samples) peak = Math.max(peak, Math.abs(x));
      expect(peak, id).toBeGreaterThan(.5); expect(peak, id).toBeLessThanOrEqual(.9);
      expect(samples[samples.length - 1]).toBe(0);
      const early = rms(samples, 0, sr * .2), mid = rms(samples, sr * .6, sr * .8), late = rms(samples, samples.length - sr * .3, samples.length);
      expect(mid, id).toBeLessThan(early); expect(late, id).toBeLessThan(mid);
    }
  });

  it('the pitch is the note, the partials are stretched, and the 7th sits in the hammer\'s notch (strike at 1/7)', () => {
    const { samples } = grandVoice('A3');                         // f0 = 220
    const f0 = 220, B = 1.2e-4 * Math.pow(2, (57 - 60) / 24), fk = k => k * f0 * Math.sqrt(1 + B * k * k);
    const a = Math.round(SR * .05), b = Math.round(SR * .45);
    expect(goertzel(samples, fk(1), a, b)).toBeGreaterThan(goertzel(samples, 300, a, b) * 50);
    expect(goertzel(samples, fk(7), a, b)).toBeLessThan(goertzel(samples, fk(6), a, b));
    expect(goertzel(samples, fk(7), a, b)).toBeLessThan(goertzel(samples, fk(8), a, b));
    expect(fk(10)).toBeGreaterThan(10 * f0);                       // inharmonic stretch (stiffness)
    expect(STRIKE_U).toBeCloseTo(1 / 7, 12);
  });

  it('a soft key is darker than a hard one (brightness follows the hammer)', () => {
    const cent = s => { let num = 0, den = 0; for (let k = 1; k <= 10; k++){ const e = goertzel(s, 330 * k, 800, 8000); num += k * e; den += e; } return num / den; };
    expect(cent(grandVoice('E4:p').samples)).toBeLessThan(cent(grandVoice('E4').samples));
  });

  it('dynamics are monotone across the soft-layer crossover (vel just under SOFT never sounds louder than SOFT)', () => {
    const lvl = s => rms(s, 0, Math.round(SR * .4));
    for (const n of ['A1', 'C3', 'E4', 'C6', 'C7', 'G3:e', 'C6:e']){
      const f = grandVoice(n).samples, p = grandVoice(n.replace(/(:e)?$/, '$1:p')).samples;
      expect(.59 * lvl(p), n).toBeLessThanOrEqual(.6 * lvl(f));
    }
  });

  it('every demo id renders, and the whole demo bakes fast', () => {
    const { part, bpm, beats } = grand.demo, beat = 60 / bpm;
    const ids = grand.voiceIds(part, { beat, bpm, rollT: 2.6, P: 2.6 + beats * beat + 1.2, loopBeats: beats });
    expect(new Set(ids.map(i => splitBucket(i).base)).size).toBeLessThanOrEqual(2 * MAX_STRINGS);   // ≤ 2 layers per string…
    expect(ids.filter(i => splitBucket(i).hold).length).toBeLessThanOrEqual(BUCKET_CAP);            // …+ duration buckets, capped
    for (const id of grand.voiceIds(part)) expect(grandVoice(id).samples.every(Number.isFinite)).toBe(true);   // (the tempo-free superset too)
    for (const id of ids) expect(grandVoice(id).samples.every(Number.isFinite)).toBe(true);
  });
});
