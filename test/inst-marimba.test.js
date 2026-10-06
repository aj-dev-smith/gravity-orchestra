import { describe, it, expect } from 'vitest';
import { eventTimes, at } from '../src/instruments/clock.js';
import { noteHz } from '../src/engine.js';
import { SONGS } from '../src/songs/index.js';
import {
  solve, keyboard, handsAt, malletAt, liftAt, flexAt, motionStats, innerExtent, modeShape, prepH,
  HEAD_R, NODE, FLEX_MAX, GAP_MIN, S_MIN, V_MAX, A_MAX, VS_MAX, AS_MAX, T_REC, E, A_ST,
  H_ARMED, TRAVEL, MAL_X, ROLL_DT, HP_MAX, Y_W, LS, PEAK,
} from '../src/instruments/marimba/solve.js';
import { marimbaVoice, layerId } from '../src/instruments/marimba/voice.js';
import marimba from '../src/instruments/marimba/index.js';

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
const PLANS = [['demo', DEMO], ['synthetic', SYN], ...SONG_PLANS];

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

  it('the head never passes through any bar (sphere vs. every bar box, flex included)', () => {
    for (const [name, plan] of [['demo', DEMO], ['synthetic', SYN], SONG_PLANS[0]]){
      const bars = plan.kb.bars;
      for (let t = plan.start; t < plan.start + plan.P + 1; t += .0015){
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
  it('prep height rises with velocity (louder = higher) and impact speed is √(2·A·H)', () => {
    expect(prepH(1, 9)).toBeGreaterThan(prepH(.5, 9));
    expect(prepH(.5, 9)).toBeGreaterThan(prepH(0, 9));
    expect(prepH(1, 9)).toBeCloseTo(HP_MAX, 9);
    for (const M of DEMO.mallets) M.strikes.forEach((s, i) => expect(M.vin[i]).toBeCloseTo(Math.sqrt(2 * A_ST * M.Hp[i]), 9));
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

  it('carriages + yokes stay within their speed / acceleration limits (unless the solver warned)', () => {
    for (const [name, plan] of PLANS){
      if (plan.warnings.some(w => /limits/.test(w))) continue;
      const m = motionStats(plan, .002);
      expect(m.v, name).toBeLessThanOrEqual(V_MAX * PEAK);
      expect(m.a, name).toBeLessThanOrEqual(A_MAX * PEAK);
      expect(m.vs, name).toBeLessThanOrEqual(VS_MAX * PEAK);
      expect(m.as, name).toBeLessThanOrEqual(AS_MAX * PEAK);
    }
  });

  it('the demo and the synthetic part need no warnings at all', () => {
    expect(DEMO.warnings).toEqual([]);
    expect(SYN.warnings).toEqual([]);
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

  it('every song with a marimba part solves (sensible warnings only)', () => {
    expect(SONG_PLANS.length).toBeGreaterThanOrEqual(3);
    for (const [name, plan] of SONG_PLANS){
      const n = plan.mallets.reduce((a, M) => a + M.strikes.length, 0);
      expect(n, name).toBeGreaterThan(20);
      for (const w of plan.warnings) expect(w, name).toMatch(/limits|cut short|dropped/);
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
  it('bakes every layer a strike (incl. a roll\'s softer alternate strokes) can ask for', () => {
    const ids = new Set(marimba.voiceIds(marimba.demo.part));
    for (const M of DEMO.mallets) for (const s of M.strikes) expect(ids.has(layerId(DEMO.kb.bars[s.bar].note, s.vel))).toBe(true);
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
