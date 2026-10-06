import { describe, it, expect } from 'vitest';
import { eventTimes, at } from '../src/instruments/clock.js';
import { noteHz } from '../src/engine.js';
import { SONGS } from '../src/songs/index.js';
import {
  solve, keyboard, handsAt, malletAt, liftAt, flexAt, motionStats, innerExtent, modeShape, prepH, stroke, hpWant,
  legLoad, trayBoxes, chainBand, carriageBoxes, boxesHit, wristDrive,
  HEAD_R, NODE, FLEX_MAX, GAP_MIN, S_MIN, V_MAX, A_MAX, VS_MAX, AS_MAX, T_REC, E, A_ST, A_CAP, ROLL_SUS,
  H_ARMED, TRAVEL, MAL_X, ROLL_DT, HP_MAX, Y_W, LS, PEAK, CAR_W, Y_RAIL, RAIL_X0, RAIL_X1,
} from '../src/instruments/marimba/solve.js';
import { marimbaVoice, layerId } from '../src/instruments/marimba/voice.js';
import marimba from '../src/instruments/marimba/index.js';
import { parseMidi } from '../src/midi/parse.js';
import { convertToSong } from '../src/midi/convert.js';
import { FIXTURES } from './helpers/midi-fixtures.js';

const ROLL_T = 2.6, START = -2.4;
const KB = { width: 11.2, x0: -.35 };

function planFor(part, bpm = 100, loopBeats = 16){
  const beat = 60 / bpm, P = ROLL_T + loopBeats * beat;
  const ev = eventTimes(part, { rollT: ROLL_T, beat });
  const kb = keyboard(ev.map(e => e.note), KB);
  return solve(ev, { P, start: START, kb });
}
const loopBeatsOf = s => s.melody.reduce((a, n) => a + n[1], 0);

const DEMO = planFor(marimba.demo.part, marimba.demo.bpm, marimba.demo.beats);
// a synthetic part with every kind of move: chords of 2/3/4, a fast line that crosses the
// keyboard, octave leaps, a repeated note, a unison roll, a dyad roll, a note across the seam
const SYN_PART = [
  [0, 'C3'], [0, 'G3'], [0, 'E4'], [0, 'C5'],
  ...['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5'].map((n, k) => [1 + k * .25, n, .5 + .05 * k]),
  [4, 'C3'], [4.5, 'C5'], [5, 'D3'], [5.5, 'D5'],
  [6, 'G4', .8], [6.25, 'G4', .6], [6.5, 'G4', .7],
  [8, 'E4', .6, 2],
  [11, 'C4', .7, 1.5], [11, 'A4', .7, 1.5],
  [13, 'F3'], [13, 'A3'], [13, 'F4'],
  [15.75, 'B4', .9],
];
const SYN = planFor(SYN_PART);
const SONG_PLANS = Object.entries(SONGS).filter(([, s]) => s.parts?.marimba?.length)
  .map(([k, s]) => [k, planFor(s.parts.marimba, s.bpm, loopBeatsOf(s))]);
// every MIDI fixture the importer routes to the marimba (rolls included: held notes)
const MIDI_PLANS = Object.keys(FIXTURES).map(k => [k, convertToSong(parseMidi(FIXTURES[k]()), { label: k }).song])
  .filter(([, s]) => s.parts?.marimba?.length)
  .map(([k, s]) => ['midi:' + k, planFor(s.parts.marimba, s.bpm, loopBeatsOf(s))]);
const PLANS = [['demo', DEMO], ['synthetic', SYN], ...SONG_PLANS, ...MIDI_PLANS];

/** every strike of every mallet at absolute song time, for the first two loops after start */
function strikes(plan, loops = 2){
  const out = [];
  plan.mallets.forEach((M, k) => M.strikes.forEach((s, i) => {
    for (let n = -1; n <= loops; n++){
      const t = s.t + n * plan.P;
      if (t < plan.start) continue;
      if (at(M.L, t + 1e-9, plan.start).armed) continue;   // before this lane's first strike: never happened
      out.push({ k, M, s, i, t });
    }
  }));
  return out;
}

describe('marimbist solve — contact is honest', () => {
  it('every head is EXACTLY on its bar (x, top + r, z) at each strike instant', () => {
    for (const [name, plan] of PLANS) for (const { k, s, t } of strikes(plan)){
      const p = malletAt(plan, k, t), b = plan.kb.bars[s.bar];
      expect(p.x, `${name} k${k} t=${t}`).toBeCloseTo(s.x, 7);
      expect(p.y, `${name} k${k} t=${t}`).toBeCloseTo(b.top + HEAD_R, 7);
      expect(p.z, `${name} k${k} t=${t}`).toBeCloseTo(s.z, 7);
      expect(Math.abs(s.z - b.z)).toBeLessThanOrEqual(b.len / 2 - HEAD_R);
      expect(Math.abs(s.x - b.x)).toBeLessThanOrEqual(b.w / 2 - HEAD_R + 1e-9);   // and the head fits on the bar
    }
  });

  it('the head never passes through any bar (sphere vs. every bar box, flex included) — every plan', () => {
    for (const [name, plan] of PLANS){
      const bars = plan.kb.bars, step = name === 'demo' || name === 'synthetic' ? .0015 : .004;
      for (let t = plan.start; t < plan.start + plan.P + 1; t += step){
        const hs = handsAt(plan, t);
        for (let k = 0; k < 4; k++){
          const p = malletAt(plan, k, t, hs);
          for (let i = 0; i < bars.length; i++){
            const b = bars[i];
            if (Math.abs(p.x - b.x) > b.w / 2 + HEAD_R) continue;
            const u = Math.max(-.5, Math.min(.5, (p.z - b.z) / b.len));
            const top = b.top + Math.max(0, flexAt(plan, i, t) * -modeShape(u));
            const dx = Math.max(0, Math.abs(p.x - b.x) - b.w / 2), dz = Math.max(0, Math.abs(p.z - b.z) - b.len / 2);
            const dy = Math.max(0, p.y - top, (b.top - b.thick) - p.y);
            expect(Math.hypot(dx, dy, dz), `${name} k${k} ${b.note} t=${t.toFixed(4)}`).toBeGreaterThanOrEqual(HEAD_R - 2e-4);
          }
        }
      }
    }
  });

  it('the SHAFT never passes through a bar either (the rattan, wrist → head, vs. every bar box)', () => {
    const R = .026;
    for (const [name, plan] of PLANS){
      const bars = plan.kb.bars;
      for (let t = plan.start; t < plan.start + plan.P + 1; t += .006){
        const hs = handsAt(plan, t);
        for (let k = 0; k < 4; k++){
          const p = malletAt(plan, k, t, hs);
          const L = Math.hypot(p.y - Y_W, p.z - p.zw);
          for (let f = .05; f <= (LS - HEAD_R) / LS + 1e-9; f += .1){            // up to where it enters the head
            const y = Y_W + (p.y - Y_W) * f, z = p.zw + (p.z - p.zw) * f;
            for (const b of bars){
              if (Math.abs(p.x - b.x) > b.w / 2 + R || Math.abs(z - b.z) > b.len / 2 + R) continue;
              expect(y, `${name} k${k} ${b.note} t=${t.toFixed(3)} f=${f.toFixed(2)}`).toBeGreaterThan(b.top + FLEX_MAX * 1.65 + R);
            }
          }
          expect(L).toBeCloseTo(LS, 9);
        }
      }
    }
  });

  it('lift is exactly 0 at contact and > 0 everywhere else nearby', () => {
    for (const [, plan] of PLANS) for (const { M, t } of strikes(plan, 1)){
      expect(liftAt(plan, M, t)).toBeCloseTo(0, 9);
      expect(Math.abs(flexAt(plan, M.strikes[0].bar, t))).toBeLessThan(.08);
      expect(liftAt(plan, M, t - .004)).toBeGreaterThan(0);
      expect(liftAt(plan, M, t + .004)).toBeGreaterThan(0);
    }
  });
});

describe('marimbist solve — the stroke is real', () => {
  it('prep height rises with velocity (louder = higher): a slow stroke drops from hpWant at the rated throw', () => {
    expect(prepH(1, 9)).toBeGreaterThan(prepH(.5, 9));
    expect(prepH(.5, 9)).toBeGreaterThan(prepH(0, 9));
    expect(prepH(1, 9)).toBeCloseTo(HP_MAX, 9);
    for (const v of [0, .3, .7, 1]){ const k = stroke(v, 9); expect(k.A).toBeCloseTo(A_ST, 9); expect(k.vin).toBeCloseTo(Math.sqrt(2 * A_ST * hpWant(v)), 9); }
  });

  it('IMPACT SPEED IS THE LOUDNESS: every strike lands at √(2·A_ST·hpWant(vel)) — a fast one by a WHIP — or sounds only as hard as it lands', () => {
    let whips = 0;
    for (const [name, plan] of PLANS) for (const M of plan.mallets) M.strikes.forEach((s, i) => {
      const vWant = Math.sqrt(2 * A_ST * hpWant(s.vel));
      expect(M.vin[i], `${name} k${M.k} #${i}`).toBeCloseTo(vWant * M.velOut[i] / Math.max(1e-12, s.vel), 9);   // vin/vWant = velOut/vel
      expect(M.velOut[i]).toBeLessThanOrEqual(s.vel + 1e-12);
      expect(M.A[i]).toBeGreaterThanOrEqual(A_ST - 1e-9); expect(M.A[i]).toBeLessThanOrEqual(A_CAP + 1e-9);
      expect(M.vin[i]).toBeCloseTo(2 * M.Hp[i] / M.Td[i], 9);                    // the down-stroke: from rest at Hp, constant A
      expect(M.vin[i]).toBeCloseTo(Math.sqrt(2 * M.A[i] * M.Hp[i]), 9);
      if (M.A[i] > A_ST * 1.01) whips++;
    });
    expect(whips).toBeGreaterThan(20);                                              // fast passages really do whip
    // and in the whole catalog the wrist never runs out of whip: the sound is the authored velocity
    for (const [name, plan] of PLANS) for (const M of plan.mallets) M.strikes.forEach((s, i) =>
      expect(M.velOut[i] / s.vel, `${name} k${M.k}`).toBeGreaterThan(.97));
  });

  it('the wrist coil shows the whip: a whipped stroke drives its coil harder than a full-height one', () => {
    const pick = whip => { for (const M of DEMO.mallets) for (let i = 0; i < M.strikes.length; i++)
      if ((M.A[i] > 1.5 * A_ST) === whip && M.strikes[i].t > 1) return [M, i]; };
    const drive = ([M, i]) => wristDrive(DEMO, M, M.strikes[i].t + DEMO.P - 1e-4);
    expect(drive(pick(true))).toBeGreaterThan(drive(pick(false)) * 1.2);
  });

  it('down-stroke arrives at the impact speed; the rebound leaves at only E of it (lossy)', () => {
    const h = 1e-5;
    for (const { M, i, t } of strikes(DEMO, 1)){
      const vIn = (liftAt(DEMO, M, t - h) - liftAt(DEMO, M, t - 2 * h)) / h;
      const vOut = (liftAt(DEMO, M, t + 2 * h) - liftAt(DEMO, M, t + h)) / h;
      expect(-vIn / M.vin[i]).toBeCloseTo(1, 2);
      expect(vOut / M.vin[i]).toBeCloseTo(E, 2);
    }
  });

  it('a mallet never re-strikes faster than it can recover', () => {
    for (const [, plan] of PLANS) for (const M of plan.mallets) if (M.L && M.L.s.length > 1)
      for (const g of M.L.gaps) expect(g).toBeGreaterThanOrEqual(T_REC - 1e-9);
  });

  it('the bar shiver is exactly 0 at every contact and never more than a shiver', () => {
    for (const [, plan] of PLANS){
      for (const { s, t } of strikes(plan, 1)) expect(flexAt(plan, s.bar, t)).toBeCloseTo(0, 9);
      for (let t = plan.start; t < plan.start + plan.P; t += .01)
        for (let i = 0; i < plan.bars.length; i += 3) for (const u of [0, .25, .5])
          expect(Math.abs(flexAt(plan, i, t) * modeShape(u))).toBeLessThanOrEqual(FLEX_MAX * 1.65 + 1e-12);
    }
  });
});

describe('marimbist solve — two hands, never crossing', () => {
  it('hands never cross: inner extents always ≥ the minimum gap', () => {
    for (const [name, plan] of PLANS) expect(motionStats(plan, .004).gap, name).toBeGreaterThanOrEqual(GAP_MIN - 1e-9);
  });

  it('every yoke stays in range (both heads apart, at most the tongs\' reach) and inside the towers', () => {
    for (const [name, plan] of PLANS){
      const m = motionStats(plan, .004);
      expect(m.sLo, name).toBeGreaterThanOrEqual(S_MIN - 2e-3);
      expect(m.sHi, name).toBeLessThanOrEqual(plan.rig.sMax + 2e-3);
      for (let t = plan.start; t < plan.start + plan.P; t += .01){
        const hs = handsAt(plan, t);
        for (const h of hs){
          expect(h.cx - h.s / 2).toBeGreaterThanOrEqual(MAL_X[0] - 2e-3);
          expect(h.cx + h.s / 2).toBeLessThanOrEqual(MAL_X[1] + 2e-3);
        }
      }
    }
  });

  it('carriages + yokes stay within their speed / acceleration limits — every plan, the catalog and the MIDI fixtures', () => {
    for (const [name, plan] of PLANS){
      expect(plan.warnings.join(), name).not.toMatch(/limits/);
      const m = motionStats(plan, .002);
      expect(m.v, name).toBeLessThanOrEqual(V_MAX * PEAK);
      expect(m.a, name).toBeLessThanOrEqual(A_MAX * PEAK);
      expect(m.vs, name).toBeLessThanOrEqual(VS_MAX * PEAK);
      expect(m.as, name).toBeLessThanOrEqual(AS_MAX * PEAK);
    }
  });

  it('the demo, the synthetic part and every catalog song need no warnings at all', () => {
    for (const [name, plan] of [['demo', DEMO], ['synthetic', SYN], ...SONG_PLANS]) expect(plan.warnings, name).toEqual([]);
  });

  it('the beam prices a leg exactly: legLoad (closed form) = the sampled peak of the quintic', () => {
    const rnd = (a => () => (a = (a * 16807) % 2147483647) / 2147483647)(7);
    for (let n = 0; n < 300; n++){
      const sg = { t0: 0, t1: .05 + rnd(), x0: rnd() * 4 - 2, x1: rnd() * 4 - 2, v0: rnd() * 20 - 10, v1: rnd() * 20 - 10 };
      const T = sg.t1, a0 = T * sg.v0, a1 = T * sg.v1, D = sg.x0 - sg.x1;
      let e = 0;
      for (let k = 0; k <= 4000; k++){
        const u = k / 4000, u2 = u * u, u3 = u2 * u, u4 = u3 * u;
        const vel = ((-30 * u2 + 60 * u3 - 30 * u4) * D + (1 - 18 * u2 + 32 * u3 - 15 * u4) * a0 + (-12 * u2 + 28 * u3 - 15 * u4) * a1) / T;
        const acc = ((-60 * u + 180 * u2 - 120 * u3) * D + (-36 * u + 96 * u2 - 60 * u3) * a0 + (-24 * u + 84 * u2 - 60 * u3) * a1) / (T * T);
        e = Math.max(e, Math.abs(vel) / 12, Math.abs(acc) / 240);
      }
      expect(legLoad(sg, 12, 240)).toBeCloseTo(e, 3);
    }
  });
});

describe('marimbist allocation', () => {
  it('a 4-note chord: the low two go to the left hand, the high two to the right', () => {
    const p = planFor([[0, 'C3'], [0, 'G3'], [0, 'E4'], [0, 'C5']]);
    const note = k => p.kb.bars[p.mallets[k].strikes[0].bar].note;
    expect([0, 1, 2, 3].map(note)).toEqual(['C3', 'G3', 'E4', 'C5']);
  });

  it('more than four notes: the inner voices are dropped, with a warning', () => {
    const p = planFor([[0, 'C3'], [0, 'E3'], [0, 'G3'], [0, 'C4'], [0, 'E4'], [0, 'G4']]);
    expect(p.mallets.reduce((a, M) => a + M.strikes.length, 0)).toBe(4);
    expect(p.warnings.join()).toMatch(/4 mallets/);
  });

  it('a fast line across the whole keyboard hands off between the hands', () => {
    for (const [plan, b0, b1, n] of [[SYN, 1, 3.3, 10], [DEMO, 8, 11.9, 15]]){
      const run = plan.mallets.map(M => M.strikes.filter(s => { const b = (s.t - ROLL_T) / .6; return b >= b0 - 1e-6 && b < b1; }).length);
      expect(run[0] + run[1]).toBeGreaterThan(1);
      expect(run[2] + run[3]).toBeGreaterThan(1);
      expect(run.reduce((a, b) => a + b)).toBe(n);
    }
  });

  it('leaps alternate low/high: the low notes are left-hand, the high notes right-hand', () => {
    const hand = note => SYN.mallets.findIndex(M => M.strikes.some(s => {
      const b = (s.t - ROLL_T) / .6; return b >= 4 - 1e-6 && b < 6 - 1e-6 && SYN.kb.bars[s.bar].note === note; })) >> 1;
    expect(hand('C3')).toBe(0); expect(hand('D3')).toBe(0); expect(hand('C5')).toBe(1); expect(hand('D5')).toBe(1);
  });

  it('a long note becomes a ROLL: alternating mallets, every stroke re-strikes the bar', () => {
    const t0 = ROLL_T + 8 * .6, t1 = t0 + 2 * .6;
    const st = SYN.mallets.flatMap(M => M.strikes.filter(s => s.t >= t0 - 1e-9 && s.t < t1).map(s => ({ ...s, k: M.k })))
      .sort((a, b) => a.t - b.t);
    expect(st.length).toBeGreaterThanOrEqual(Math.round(1.2 / ROLL_DT) - 2);
    expect(new Set(st.map(s => s.k >> 1)).size).toBe(1);                  // one hand
    for (let i = 1; i < st.length; i++){
      expect(st[i].k).not.toBe(st[i - 1].k);                              // alternating mallets
      expect(SYN.kb.bars[st[i].bar].note).toBe('E4');                      // on the one bar
    }
    const bar = SYN.bars[st[0].bar];
    expect(bar.hits.filter(h => h.t >= t0 - 1e-9 && h.t < t1).length).toBe(st.length);   // each one sounds
  });

  it('a rolled dyad: each hand alternates between its own mallets', () => {
    const t0 = ROLL_T + 11 * .6, t1 = t0 + 1.5 * .6;
    for (const h of [0, 1]){
      const ks = [h * 2, h * 2 + 1].map(k => SYN.mallets[k].strikes.filter(s => s.t >= t0 - 1e-9 && s.t < t1).length);
      expect(ks[0]).toBeGreaterThan(3); expect(ks[1]).toBeGreaterThan(3);
      expect(Math.abs(ks[0] - ks[1])).toBeLessThanOrEqual(1);
    }
  });

  it('a roll is a real roll: the ATTACK strikes the whole chord at once, the tremolo sustains it softer', () => {
    const t0 = ROLL_T + 22 * .6;                                          // demo: A4 + E5 rolled (one hand, a dyad)
    const at0 = DEMO.mallets.flatMap(M => M.strikes.filter(s => Math.abs(s.t - t0) < 1e-6).map(s => DEMO.kb.bars[s.bar].note));
    expect(at0.sort()).toEqual(['A4', 'E5']);
    const sus = DEMO.mallets.flatMap(M => M.strikes.filter(s => s.roll && s.t > t0 + 1e-6 && s.t < t0 + 1.5 * .6));
    expect(sus.length).toBeGreaterThan(8);
    for (const s of sus) expect(s.vel).toBeLessThanOrEqual(.8 * (ROLL_SUS + .1) + 1e-9);
  });

  it('two hands rolling at once INTERLEAVE (a four-mallet roll), never strike in unison', () => {
    const t0 = ROLL_T + 28 * .6, t1 = t0 + 3 * .6;                      // demo: the final A-minor chord, all four mallets
    const per = [0, 1].map(h => [h * 2, h * 2 + 1].flatMap(k => DEMO.mallets[k].strikes
      .filter(s => s.t > t0 + 1e-6 && s.t < t1).map(s => s.t)));
    expect(per[0].length).toBeGreaterThan(8); expect(per[1].length).toBeGreaterThan(8);
    for (const a of per[0]) for (const b of per[1]) expect(Math.abs(a - b)).toBeGreaterThan(.02);
  });

  it('a tight pair (natural against its neighbouring sharp, on a wide keyboard) is struck off-centre, never below the tightest grip', () => {
    const wide = { width: 11.2, x0: -.35 };
    const ev = eventTimes([[0, 'C3'], [0, 'B6'], [0, 'C7'], [2, 'E4'], [2, 'F4'], [2, 'F#4'], [4, 'A3', .8, 2]], { rollT: ROLL_T, beat: .6 });
    const kb = keyboard(ev.map(e => e.note), wide), plan = solve(ev, { P: ROLL_T + 8 * .6, start: START, kb });
    expect(kb.slot).toBeLessThan(.4);
    expect(motionStats(plan, .004).sLo).toBeGreaterThanOrEqual(S_MIN - 2e-3);
    for (const M of plan.mallets) for (const s of M.strikes){
      const b = kb.bars[s.bar];
      expect(Math.abs(s.x - b.x)).toBeLessThanOrEqual(b.w / 2 - HEAD_R + 1e-9);
    }
  });

  it('every song with a marimba part solves (sensible warnings only)', () => {
    expect(SONG_PLANS.length).toBeGreaterThanOrEqual(3);
    for (const [name, plan] of SONG_PLANS){
      const n = plan.mallets.reduce((a, M) => a + M.strikes.length, 0);
      expect(n, name).toBeGreaterThan(20);
      for (const w of plan.warnings) expect(w, name).toMatch(/cut short|dropped/);
      const reach = plan.warnings.map(w => /more than its limits.*×(\d+)/.exec(w)?.[1] ?? (/more than its limits/.test(w) ? 1 : 0)).reduce((a, b) => a + +b, 0);
      expect(reach / n, name).toBeLessThan(.03);                          // ≤ 3 % of notes are beyond the rig
    }
  });
});

describe('marimbist count-in + seam', () => {
  it('at the count-in the hands are PARKED at the rail ends with every mallet raised', () => {
    for (const [, plan] of PLANS){
      const hs = handsAt(plan, plan.start);
      expect(hs[0].cx).toBeCloseTo(TRAVEL[0] + .3, 9);
      expect(hs[1].cx).toBeCloseTo(TRAVEL[1] - .3, 9);
      for (const M of plan.mallets) expect(liftAt(plan, M, plan.start)).toBeCloseTo(H_ARMED, 9);
    }
  });

  it('everything is continuous: from the count-in, through the first strikes, across the loop seam', () => {
    for (const [name, plan] of [['demo', DEMO], ['synthetic', SYN], ...SONG_PLANS]){
      let prev = [0, 1, 2, 3].map(k => malletAt(plan, k, plan.start));
      const t1 = plan.start + plan.P + 1.5;
      for (let t = plan.start + .001; t < t1; t += .001){
        const hs = handsAt(plan, t);
        const cur = [0, 1, 2, 3].map(k => malletAt(plan, k, t, hs));
        for (let k = 0; k < 4; k++){
          const d = Math.hypot(cur[k].x - prev[k].x, cur[k].y - prev[k].y, cur[k].z - prev[k].z);
          // head speed ≤ carriage + yoke + stroke (≈ 12 + 8 + 13 u/s) → ≤ .05 per ms; a warned plan may exceed
          if (!plan.warnings.length) expect(d, `${name} k${k} t=${t.toFixed(3)}`).toBeLessThan(.05);
          else expect(d, `${name} k${k} t=${t.toFixed(3)}`).toBeLessThan(.1);
        }
        prev = cur;
      }
    }
  });

  it('the solved performance is periodic: pose at t and t + P agree after the first loop', () => {
    for (const [, plan] of PLANS){
      const t0 = Math.max(...plan.mallets.map(M => M.L ? at(M.L, plan.start, plan.start).first : plan.start)) + .01;
      for (let t = t0; t < t0 + plan.P; t += .37){
        const a = malletAt(plan, 3, t), b = malletAt(plan, 3, t + plan.P);
        expect(a.x).toBeCloseTo(b.x, 6); expect(a.y).toBeCloseTo(b.y, 6); expect(a.z).toBeCloseTo(b.z, 6);
      }
    }
  });

  it('the head is a rigid shaft-length from its wrist pivot, always', () => {
    for (let t = DEMO.start; t < DEMO.start + DEMO.P; t += .05) for (let k = 0; k < 4; k++){
      const p = malletAt(DEMO, k, t);
      expect(Math.hypot(p.y - Y_W, p.z - p.zw)).toBeCloseTo(LS, 9);
    }
  });
});

describe('the gantry — solid never passes through solid', () => {
  const tray = trayBoxes();
  it('a carriage (a saddle under the beam) never touches the chain tray, either drag chain, or the other carriage — anywhere on the rail', () => {
    for (let cx = TRAVEL[0]; cx <= TRAVEL[1] + 1e-9; cx += .05) for (const h of [0, 1]){
      for (const part of carriageBoxes(h, cx)){
        for (const b of tray) expect(boxesHit(part, b), `h${h} ${part.name} × tray ${b.name} @${cx.toFixed(2)}`).toBe(false);
        for (const c of [0, 1]) for (const run of [0, 1]){
          if (c === h && run === 1 && part.name === 'arm') continue;          // the arm is where its own chain ends
          expect(boxesHit(part, chainBand(c, run)), `h${h} ${part.name} × chain${c}/${run} @${cx.toFixed(2)}`).toBe(false);
        }
        expect(part.max[1] <= Y_RAIL + .14 + 1e-9 || ['post', 'arm'].includes(part.name), part.name).toBe(true);   // nothing on the beam top but the bracket
      }
      // the other hand at its closest (carriage bodies a GAP_MIN apart)
      const o = h ? cx - CAR_W - GAP_MIN : cx + CAR_W + GAP_MIN;
      for (const a of carriageBoxes(h, cx)) for (const b of carriageBoxes(1 - h, o)) expect(boxesHit(a, b)).toBe(false);
    }
  });
  it('the drag chains lie IN the tray: on its floor, between its walls, and clear of each other', () => {
    for (const h of [0, 1]) for (const run of [0, 1]){
      const c = chainBand(h, run);
      for (const b of tray) expect(boxesHit(c, b), `chain${h}/${run} × ${b.name}`).toBe(false);
      expect(boxesHit(c, chainBand(1 - h, run))).toBe(false);
      expect(c.min[0]).toBeGreaterThanOrEqual(RAIL_X0 - .1 - 1e-9); expect(c.max[0]).toBeLessThanOrEqual(RAIL_X1 + .1 + 1e-9);
    }
  });
});

describe('marimba keyboard', () => {
  const kb = keyboard(['C3', 'A5', 'F#4']);
  it('runs C → C chromatic, low → high along +x, inside the footprint', () => {
    expect(kb.bars[0].note).toBe('C3');
    expect(kb.bars[kb.bars.length - 1].note).toBe('C6');
    const nat = kb.bars.filter(b => b.natural);
    for (let i = 1; i < nat.length; i++) expect(nat[i].x).toBeGreaterThan(nat[i - 1].x);
    for (const b of kb.bars){
      expect(Math.abs(b.x) + b.w / 2).toBeLessThanOrEqual(6.5);
      expect(Math.abs(b.z) + b.len / 2).toBeLessThanOrEqual(3.5);
    }
  });
  it('bar length follows the free-free law (L ∝ f^−½), resonators ∝ 1/f', () => {
    const c3 = kb.bars.find(b => b.note === 'C3'), c4 = kb.bars.find(b => b.note === 'C4');
    expect(c3.len / c4.len).toBeCloseTo(Math.sqrt(noteHz('C4') / noteHz('C3')), 6);
    expect(c3.res / c4.res).toBeCloseTo(2, 6);
  });
  it('neighbouring bars in a row never overlap', () => {
    for (const row of [kb.bars.filter(b => b.natural), kb.bars.filter(b => !b.natural)])
      for (let i = 1; i < row.length; i++)
        expect(row[i].x - row[i - 1].x).toBeGreaterThan((row[i].w + row[i - 1].w) / 2);
  });
  it('the bar mode shape is the true free-free first mode: nodes at 22.4 %, ends 1.64× the centre', () => {
    expect(modeShape(.5 - NODE)).toBeCloseTo(0, 3);
    expect(modeShape(-(.5 - NODE))).toBeCloseTo(0, 3);
    expect(modeShape(0)).toBeCloseTo(-1, 9);
    expect(modeShape(.5) / -modeShape(0)).toBeCloseTo(1.645, 2);
    expect(FLEX_MAX * modeShape(.5)).toBeLessThanOrEqual(.4 * .15);
  });
  it('the inner-extent guard is symmetric about the hands', () => {
    expect(innerExtent(0, 0, 1)).toBeCloseTo(-innerExtent(1, 0, 1), 12);
  });
});

describe('marimba voice', () => {
  it('renders deterministic, bounded, ringing samples across the range', () => {
    for (const n of ['C3', 'G3', 'C4', 'E5', 'C6']){
      const a = marimbaVoice(n), b = marimbaVoice(n);
      expect(a.samples).toBe(b.samples);
      let peak = 0; for (const x of a.samples){ expect(Number.isFinite(x)).toBe(true); peak = Math.max(peak, Math.abs(x)); }
      expect(peak).toBeGreaterThan(.5); expect(peak).toBeLessThanOrEqual(.9);
      expect(a.samples.length / a.sr).toBeLessThanOrEqual(3.01);
      expect(Math.abs(a.samples[a.samples.length - 1])).toBeLessThan(1e-4);
    }
    expect(marimbaVoice('C6').samples.length).toBeLessThan(marimbaVoice('C3').samples.length);
  });
  it('a hard strike is BRIGHTER, not just louder (the velocity layer)', () => {
    expect(layerId('E4', .9)).toBe('E4|h'); expect(layerId('E4', .5)).toBe('E4');
    const hf = x => { let d = 0, e = 0; for (let i = 1; i < 4000; i++){ d += (x[i] - x[i - 1]) ** 2; e += x[i] ** 2; } return d / e; };
    expect(hf(marimbaVoice('E4|h').samples)).toBeGreaterThan(hf(marimbaVoice('E4').samples) * 1.15);
  });
  it('bakes every layer a strike (incl. a roll\'s softer strokes and a short whip) can SOUND', () => {
    for (const [plan, part] of [[DEMO, marimba.demo.part], ...SONG_PLANS.map(([k, p]) => [p, SONGS[k].parts.marimba])]){
      const ids = new Set(marimba.voiceIds(part));
      for (const M of plan.mallets) M.strikes.forEach((s, i) => expect(ids.has(layerId(plan.kb.bars[s.bar].note, M.velOut[i]))).toBe(true));
    }
  });
});

describe('marimba demo', () => {
  it('shows off: 4-note chords, a fast line, leaps, rolls, dynamics', () => {
    const p = marimba.demo.part;
    const byBeat = {}; for (const e of p) (byBeat[e[0]] ||= []).push(e);
    expect(Object.values(byBeat).some(v => v.length === 4)).toBe(true);
    expect(p.some(e => (e[3] ?? 0) >= 1)).toBe(true);
    expect(new Set(p.map(e => e[2] ?? 1)).size).toBeGreaterThan(5);
    expect(marimba.demo.beats % 4).toBe(0);
    for (const e of p){ expect(e[0]).toBeGreaterThanOrEqual(0); expect(e[0]).toBeLessThan(marimba.demo.beats); }
  });
});
