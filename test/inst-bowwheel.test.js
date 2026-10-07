import { splitBucket, BUCKET_CAP } from '../src/instruments/sustain.js';
import { describe, it, expect } from 'vitest';
import { eventTimes, lanesByNote, wrapP } from '../src/instruments/clock.js';
import {
  bowLane, laneAt, strokeAt, laneGeom, laneX, prepPart, clearances, stringLen, stringR, bowEnv, liveFrom,
  g, T_PRESS, T_UP, F_MIN, HOLD_MIN, HOLD_MAX, MIN_REPEAT, MAG_Y, CUP_Y, BALL_R, CUP_R, SPACING, MAX_STRINGS,
  WHEEL_R, WHEEL_Y, LANE_HW, PART_LIMITS, LO, HI,
} from '../src/instruments/bowwheel/solve.js';
import { bowVoice, SR } from '../src/instruments/bowwheel/voice.js';
import bowwheel from '../src/instruments/bowwheel/index.js';
import { noteHz, noteNum } from '../src/engine.js';

const ROLL_T = 2.6, START = -2.4;

/* lanes from a demo-format part */
function lanesOf(part, bpm, beats){
  const beat = 60 / bpm, P = ROLL_T + beats * beat + 1.2;
  const prep = prepPart(part).events;
  const by = lanesByNote(eventTimes(prep, { rollT: ROLL_T, beat }));
  const notes = Object.keys(by).sort((a, b) => noteNum(a) - noteNum(b));
  return { P, beat, lanes: notes.map((note, i) => {
    const G = laneGeom(note, laneX(i, notes.length));
    return { note, G, L: bowLane(by[note].map(e => ({ t: e.t, tDur: e.tDur, vel: e.vel })), P, G) };
  }) };
}
const demo = lanesOf(bowwheel.demo.part, bowwheel.demo.bpm, bowwheel.demo.beats);

/* synthetic lanes that stress each path */
const P0 = 12;
const CASES = {
  single:   [[3, 1.2]],
  sparse:   [[3, 2], [8, .5]],
  legato:   [[3, .9], [4, .9], [5, .9], [6, 2]],           // re-bows: hops
  repeats:  [[3, .2], [3.2, .2], [3.4, .3], [7, 4]],        // too close → merged
  seam:     [[.1, .5], [11.5, .6]],                          // across the loop seam
  drone:    [[2, 30]],                                       // longer than the voice: clamped
  crowded:  [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1]],   // never rests: a magnet gap is forced
  midpark:  [[1, .9], [2, .9], [3, .9], [8, 1], [10.6, 2]], // the only park is mid-loop; the seam is a hop
};
const synth = Object.fromEntries(Object.entries(CASES).map(([k, hits]) => {
  const G = laneGeom('D4', 0);
  return [k, { G, L: bowLane(hits.map(([t, d]) => ({ t, tDur: d, vel: .8 })), P0, G) }];
}));
const allLanes = [...demo.lanes.map(l => ({ ...l, P: demo.P, name: 'demo ' + l.note })),
  ...Object.entries(synth).map(([k, l]) => ({ ...l, P: P0, name: k }))];

describe('bowwheel: strokes land on the beat, honestly', () => {
  it('every live stroke: the string reaches the rim exactly at the beat, at rest, marble seated (several loops incl. the count-in)', () => {
    for (const { L, G, P, name } of allLanes){
      const live = liveFrom(L, START);
      let checked = 0;
      for (const q of L.cyc) for (let m = 0; m < 3; m++){
        const a = q.on + m * P;
        if (a < live) continue;                       // (count-in: never happened)
        const st = laneAt(L, a + 1e-9, START), pre = laneAt(L, a - 1e-4, START);
        expect(st.contact, name).toBe(true);
        expect(Math.abs(st.s - G.D), name).toBeLessThan(1e-6);
        expect(Math.abs(clearances(L, st).rim), name).toBeLessThan(1e-6);       // touching, not inside
        expect(Math.abs(pre.sv), name).toBeLessThan(.05);                        // smoothstep: at rest as it touches
        expect(pre.onCup && !pre.held, name).toBe(true);
        expect(Math.abs(st.y - (CUP_Y - G.D)), name).toBeLessThan(1e-9);         // the marble's weight is what presses
        checked++;
      }
      expect(checked, name).toBeGreaterThan(0);
    }
  });

  it('the marble lands in the cup T_PRESS before the beat, the cup at rest under it, moving INTO the cup', () => {
    for (const { L, P, name } of allLanes) for (const q of L.cyc){
      const land = q.on - T_PRESS + 5 * P;
      const a = laneAt(L, land - 1e-5, START), b = laneAt(L, land + 1e-9, START);
      expect(a.onCup, name).toBe(false);
      expect(a.vy, name).toBeLessThan(0);
      expect(Math.abs(a.s), name).toBeLessThan(1e-9);                            // cup back up and still
      expect(Math.abs(a.sv), name).toBeLessThan(1e-9);
      expect(Math.abs(b.y - CUP_Y), name).toBeLessThan(1e-9);
      expect(b.onCup, name).toBe(true);
    }
  });

  it('the string is quiet (off the rim) whenever no marble presses it; contact only during a stroke', () => {
    for (const { L, P, name } of allLanes){
      for (let t = 0; t < 2 * P; t += .003){
        const st = laneAt(L, t + 3 * P, START);
        if (!st.contact) expect(clearances(L, st).rim > -1e-9, name).toBe(true);
        if (st.contact) expect(st.phase, name).toBe('hold');
      }
    }
  });
});

describe('bowwheel: no penetration, nothing teleports', () => {
  it('marble never inside its cup or magnet, string never inside the wheel (1 ms over 2.2 loops from START)', () => {
    for (const { L, P, name } of allLanes){
      let worst = Infinity;
      for (let t = START; t < START + 2.2 * P; t += .001){
        const c = clearances(L, laneAt(L, t, START));
        worst = Math.min(worst, c.cup, c.magnet, c.rim);
      }
      expect(worst, name).toBeGreaterThan(-1e-6);
    }
  });

  it('continuous through the count-in, every kick / catch / release, and the loop seam', () => {
    for (const { L, P, name } of allLanes){
      let prev = laneAt(L, START, START);
      const h = .001;
      for (let t = START + h; t < START + 2.3 * P; t += h){
        const st = laneAt(L, t, START);
        // the fastest legal motion: the magnet kick (≈ 6 u/s) — bounded per-step deltas
        expect(Math.abs(st.y - prev.y), `${name} y @${t.toFixed(4)}`).toBeLessThan(10 * h);
        expect(Math.abs(st.s - prev.s), `${name} s @${t.toFixed(4)}`).toBeLessThan(10 * h);
        prev = st;
      }
    }
  });
});

describe('bowwheel: the flight grammar', () => {
  it('every flight is a solved arc: leaves the low cup at the kick, lands at CUP_Y after F; lossy (dashpot) + powered (coil)', () => {
    for (const { L, G, name } of allLanes) for (const q of L.cyc){
      const st0 = { ...q };
      expect(q.F, name).toBeGreaterThanOrEqual(F_MIN - 1e-9);
      // hop: y(F) = CUP_Y exactly
      if (!q.mag){
        const y = G.yLow + q.v0 * q.F - .5 * g * q.F * q.F;
        expect(Math.abs(y - CUP_Y), name).toBeLessThan(1e-9);
        expect(G.yLow + q.v0 * q.v0 / (2 * g), name).toBeLessThanOrEqual(MAG_Y + 1e-9);   // apex below the magnet
      } else {
        // magnet: arrives at the face at zero speed, waits, falls
        expect(Math.abs(q.v0 - g * G.Tr), name).toBeLessThan(1e-9);
        expect(G.yLow + q.v0 * q.v0 / (2 * g)).toBeCloseTo(MAG_Y, 9);
        expect(q.F, name).toBeGreaterThan(G.Tr + G.Tf);
      }
      expect(st0.hold, name).toBeGreaterThanOrEqual(HOLD_MIN - 1e-9);
      expect(st0.hold, name).toBeLessThanOrEqual(HOLD_MAX + 1e-9);
    }
  });

  it('long rests park at the magnet, short ones hop — both appear in the demo', () => {
    const mags = demo.lanes.flatMap(l => l.L.cyc.filter(q => q.mag)).length;
    const hops = demo.lanes.flatMap(l => l.L.cyc.filter(q => !q.mag)).length;
    expect(mags).toBeGreaterThan(0); expect(hops).toBeGreaterThan(0);
    for (const l of demo.lanes) expect(l.L.cyc.some(q => q.mag), l.note).toBe(true);    // every string waits somewhere
  });

  it('a hop clears its cup springing back up (the cup never catches the marble early)', () => {
    for (const { L, G, name } of allLanes) for (const q of L.cyc.filter(q => !q.mag)){
      for (let u = 1e-4; u < q.F; u += 1e-4){
        const y = G.yLow + q.v0 * u - .5 * g * u * u, s = u < T_UP ? G.D * (1 - (3 * (u / T_UP) ** 2 - 2 * (u / T_UP) ** 3)) : 0;
        expect(y - (CUP_Y - s), name).toBeGreaterThan(-1e-9);
      }
    }
  });

  it('the count-in waits ARMED: at START every marble hangs on its magnet, rod up, string quiet', () => {
    for (const { L, name } of allLanes){
      const st = laneAt(L, START, START);
      expect(st.held && st.y === MAG_Y && st.s === 0 && !st.contact, name).toBe(true);
      expect(strokeAt(L, START, START).live, name).toBe(false);
      expect(liveFrom(L, START), name).toBeGreaterThanOrEqual(START);
    }
  });

  it('the first loop is never silent: the armed marble drops for the first stroke it can reach, every stroke after it plays', () => {
    for (const { L, P, name } of allLanes){
      const en = liveFrom(L, START);
      const lead = L.geom.Tf + T_PRESS;
      expect(en, name).toBeGreaterThanOrEqual(START);
      for (const q of L.cyc) for (let m = -1; m < 2; m++){
        const a = q.on + m * P;
        if (a < START) continue;
        const so = strokeAt(L, a + 1e-6, START);
        if (a - lead >= START - 1e-9) expect(so.live, name + ' @' + a.toFixed(2)).toBe(true);   // reachable → it plays
        else expect(so.live, name).toBe(false);                                                 // too close to START → skipped
      }
      // the entry drop: off the magnet at rest, free fall, into the cup at rest
      const r = laneAt(L, en + 1e-6, START), f = laneAt(L, en + L.geom.Tf - 1e-6, START);
      expect(r.phase, name).toBe('fall'); expect(Math.abs(r.vy), name).toBeLessThan(1e-3);
      expect(Math.abs(f.y - CUP_Y), name).toBeLessThan(1e-3);
    }
    // the case that used to sound nothing until the mid-loop park: strokes at 1/2/3 s play in loop 1
    const { L } = synth.midpark;
    for (const a of [1, 2, 3]) expect(strokeAt(L, a + 1e-6, START).live).toBe(true);
  });

  it('a pickup (negative beat) wraps into the loop and still lands on its beat', () => {
    const beat = .5, P = ROLL_T + 16 * beat + 1.2;
    const ev = eventTimes([[-1, 'G4', .7, .8], [4, 'G4', .7, 1]], { rollT: ROLL_T, beat });
    const G = laneGeom('G4', 0), L = bowLane(ev.map(e => ({ t: e.t, tDur: e.tDur, vel: e.vel })), P, G);
    const on = wrapP(ROLL_T - beat, P);
    expect(L.cyc.some(q => Math.abs(q.on - on) < 1e-9)).toBe(true);
    const st = laneAt(L, on + P + 1e-9, START);
    expect(st.contact).toBe(true);
  });
});

describe('bowwheel: thinning & merging (robust to imported parts)', () => {
  it('same-string onsets closer than MIN_REPEAT merge into one stroke', () => {
    const L = synth.repeats.L;
    expect(L.cyc.length).toBeLessThan(4);         // 3 + 3.2 (+ 3.4) merge into one long stroke
    for (let i = 0; i < L.cyc.length; i++){
      const a = L.cyc[i], b = L.cyc[(i + 1) % L.cyc.length];
      expect(wrapP(b.on - a.on, P0)).toBeGreaterThanOrEqual(MIN_REPEAT - 1e-9);
    }
  });
  it('a lane that never rests is forced one magnet park per loop', () => {
    expect(synth.crowded.L.cyc.some(q => q.mag)).toBe(true);
  });
  it('prepPart folds range, caps strings and events, skips junk — never throws', () => {
    const junk = [[0, 'Bb4'], [1, 'C9', .5, 1], [2, 'C0'], ['x', 'C4'], null, [3, 42], [4, 'C4', 7, -1]];
    const { events, dropped } = prepPart(junk);
    expect(events.every(e => noteNum(e[1]) >= LO && noteNum(e[1]) <= HI)).toBe(true);
    expect(events.find(e => e[0] === 4)[2]).toBe(1);
    expect(dropped.bad).toBe(4); expect(dropped.range).toBe(2);
    const many = Array.from({ length: 3000 }, (_, i) => [i * .25, ['C', 'D', 'E', 'F', 'G', 'A', 'B'][i % 7] + (2 + (i % 5)), (i % 10) / 10 + .05, .5]);
    const p = prepPart(many);
    expect(new Set(p.events.map(e => e[1])).size).toBeLessThanOrEqual(MAX_STRINGS);
    expect(p.events.length).toBeLessThanOrEqual(PART_LIMITS.maxEvents);
    // and a dense import still solves (no throw, honest landing)
    const r = lanesOf(many.slice(0, 400), 120, 100);
    for (const { L } of r.lanes) for (const q of L.cyc) expect(q.F).toBeGreaterThanOrEqual(F_MIN - 1e-9);
    expect(prepPart(undefined).events).toEqual([]);
  });
  it('a dense RANDOM part (500 events, any range, odd durations) stays honest end to end', () => {
    let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const ev = Array.from({ length: 500 }, () => [r() * 64 - 2, ['C', 'C#', 'D', 'E', 'F', 'G', 'A', 'B'][Math.floor(r() * 8)] + (1 + Math.floor(r() * 7)), r(), r() * 4]);
    const { P, lanes } = lanesOf(ev, 120, 64);
    expect(lanes.length).toBeLessThanOrEqual(MAX_STRINGS);
    for (const { L, G, note } of lanes){
      let prev = null;
      for (let t = START; t < P + 4; t += .002){
        const st = laneAt(L, t, START), c = clearances(L, st);
        expect(Math.min(c.cup, c.magnet, c.rim), note).toBeGreaterThan(-1e-6);
        if (prev) expect(Math.abs(st.y - prev.y) + Math.abs(st.s - prev.s), note).toBeLessThan(.04);
        prev = st;
      }
      for (const q of L.cyc){
        const st = laneAt(L, q.on + P + 1e-9, START);
        expect(st.contact && Math.abs(st.s - G.D) < 1e-6, note).toBe(true);
      }
    }
  });
  it('PART_LIMITS mirrors the solver', () => {
    expect(PART_LIMITS.gap).toBeCloseTo(MIN_REPEAT, 3);
    expect(PART_LIMITS.pitches).toBe(MAX_STRINGS);
    expect(PART_LIMITS.maxDur).toBe(HOLD_MAX);
    expect(PART_LIMITS.lo).toBe(LO); expect(PART_LIMITS.hi).toBe(HI);
  });
});

describe('bowwheel: geometry', () => {
  it('lanes never interact: every moving part of a lane stays inside its own slab', () => {
    expect(SPACING).toBeGreaterThan(2 * LANE_HW);
    expect(LANE_HW).toBeGreaterThanOrEqual(Math.max(BALL_R, CUP_R));
    for (let n = 1; n <= MAX_STRINGS; n++){
      const xs = Array.from({ length: n }, (_, i) => laneX(i, n));
      for (let i = 1; i < n; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(SPACING, 12);
      // every string still meets the rim from above (≤ ~32° round the crown)
      expect(Math.abs(xs[n - 1]) / WHEEL_R).toBeLessThan(Math.sin(33 * Math.PI / 180));
    }
  });
  it('a string\'s size is a pure function of its note (longer + thicker = lower), never of layout', () => {
    expect(stringLen('C4')).toBeCloseTo(stringLen('C2') / 2, 9);
    expect(stringLen('A2')).toBeGreaterThan(stringLen('A3'));
    expect(stringR('A2')).toBeGreaterThan(stringR('A5'));
    expect(laneGeom('E4', -1).len).toBe(laneGeom('E4', 1.5).len);
    expect(laneGeom('E4', -1).rs).toBe(laneGeom('E4', 1.5).rs);
  });
  it('the press: rest string clears the rim by the gap, pressed touches it; wheel axle under the crown', () => {
    for (const x of [0, 1, -2]){
      const G = laneGeom('C4', x);
      expect(Math.hypot(x, G.yPress - WHEEL_Y)).toBeCloseTo(WHEEL_R + G.rs, 9);
      expect(G.D).toBeGreaterThan(.05); expect(G.D).toBeLessThan(.2);
      expect(MAG_Y - BALL_R).toBeGreaterThan(CUP_Y + BALL_R);
    }
  });
  it('the visible bow envelope exists only during the stroke', () => {
    expect(bowEnv(-.01, 1)).toBe(0); expect(bowEnv(1.01, 1)).toBe(0);
    expect(bowEnv(.5, 1)).toBeGreaterThan(.5);
  });
});

describe('bowwheel: voice', () => {
  it('is deterministic (cached), peak in (.5, .9], ends at exactly 0, < 4.5 s', () => {
    for (const id of ['A2', 'D4', 'E5', 'C7']){
      const v = bowVoice(id);
      expect(bowVoice(id)).toBe(v);
      let pk = 0; for (const x of v.samples) pk = Math.max(pk, Math.abs(x));
      expect(pk).toBeGreaterThan(.5); expect(pk).toBeLessThanOrEqual(.9);
      expect(v.samples[v.samples.length - 1]).toBe(0);
      expect(v.samples.length / v.sr).toBeLessThan(4.5);
      expect(v.sr).toBe(SR);
    }
  });
  it('sustains through HOLD_MAX (a bowed note does not decay), then the release decays to silence', () => {
    const { samples: s, sr } = bowVoice('A3');
    const rms = (a, b) => { let x = 0; for (let i = Math.round(a * sr); i < Math.round(b * sr); i++) x += s[i] * s[i]; return Math.sqrt(x / ((b - a) * sr)); };
    expect(rms(3.3, 3.8) / rms(.5, 1)).toBeGreaterThan(.5);
    const tail = [0, .1, .2, .3].map(d => rms(HOLD_MAX + d, HOLD_MAX + d + .1));
    for (let i = 1; i < tail.length; i++) expect(tail[i]).toBeLessThan(tail[i - 1]);
  });
  it('sounds its note (fundamental dominates the neighbours)', () => {
    for (const id of ['A2', 'D4', 'F5']){
      const { samples: s, sr } = bowVoice(id), f = noteHz(id);
      const mag = fr => { let re = 0, im = 0; for (let i = sr; i < 2 * sr; i++){ const p = 2 * Math.PI * fr * i / sr; re += s[i] * Math.cos(p); im += s[i] * Math.sin(p); } return Math.hypot(re, im); };
      const m0 = mag(f);
      for (const r of [.5, 1.5, Math.pow(2, 1 / 12), Math.pow(2, -1 / 12)]) expect(m0, `${id} vs ×${r.toFixed(3)}`).toBeGreaterThan(3 * mag(f * r));
    }
  });
  it('a demo song\'s whole id set bakes fast', () => {
    const { part, bpm, beats } = bowwheel.demo, beat = 60 / bpm;
    const ids = bowwheel.voiceIds(part, { beat, bpm, rollT: 2.6, P: 2.6 + beats * beat + 1.2, loopBeats: beats });
    expect(new Set(ids.map(i => splitBucket(i).base)).size).toBeLessThanOrEqual(MAX_STRINGS);   // one base per string…
    expect(ids.filter(i => splitBucket(i).hold).length).toBeLessThanOrEqual(BUCKET_CAP);        // …+ its duration buckets, capped
  });
});

describe('bowwheel: demo', () => {
  it('is a real phrase: beats % 4, every event in the loop, ≤ 12 strings', () => {
    const { part, beats } = bowwheel.demo;
    expect(beats % 4).toBe(0);
    for (const [b] of part){ expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThan(beats); }
    expect(new Set(part.map(e => e[1])).size).toBeLessThanOrEqual(MAX_STRINGS);
    expect(prepPart(part).events.length).toBe(part.length);
  });
});
