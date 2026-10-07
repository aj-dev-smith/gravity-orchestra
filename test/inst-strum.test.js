import { describe, it, expect } from 'vitest';
import { prepPart, layoutStrings, solveStrum, pickAt, stringAt, shapeAt, damperAt, feltFace, lastSounding, firstPass,
         stringLength, stringRadius, pickU, dampU, parseId, PART_LIMITS,
         DELTA, H_TIP, R_TIP, D_DOCK, GUARD, SP_MIN, SP_MAX, V_HI, S_PICK, S_DAMP } from '../src/instruments/strum/solve.js';
import { strumVoice } from '../src/instruments/strum/voice.js';
import strum from '../src/instruments/strum/index.js';
import { noteHz } from '../src/engine.js';

const START = -2.4, ROLL_T = 2.6;
const timing = (bpm, beats) => { const beat = 60 / bpm; return { rollT: ROLL_T, beat, P: ROLL_T + beats * beat + 1.2 }; };
const solve = (part, bpm, beats, W = 12) => {
  const tm = timing(bpm, beats);
  const prep = prepPart(part, tm);
  const lay = layoutStrings(prep.ids, { W });
  return { S: solveStrum(prep, tm.P, lay), prep, lay, ...tm };
};
const demo = () => solve(strum.demo.part, strum.demo.bpm, strum.demo.beats);

/* a dense synthetic part: 16th-note strums at 120 bpm (a flip-heavy hand) */
const CH = [['E2', 'B2', 'E3', 'G#3', 'B3', 'E4'], ['A2', 'E3', 'A3', 'C#4', 'E4'], ['B2', 'F#3', 'B3', 'D#4', 'F#4']];
const dense = [];
for (let b = 0; b < 8; b += .25) CH[Math.floor(b / 2) % 3].forEach(n => dense.push([b, n, b % 1 ? .6 : .95]));
const CASES = { demo: () => demo(), dense16ths: () => solve(dense, 120, 8),
  single: () => solve([[0, 'C3'], [0, 'E3'], [0, 'G3']], 90, 4),
  pickup: () => solve([[-4.5, 'D3', .5], [-4.5, 'A3', .5], [0, 'G2'], [0, 'D3'], [0, 'G3'], [2, 'C3'], [2, 'E3'], [2, 'G3']], 100, 4) };

/* 2-D cross-section at the pick height: marble centre vs string centre (both x,n) */
const pickGap = (S, j, q, s) => Math.hypot(q.x - (S.xs[j] + s.dx * shapeAt(S, j, s, S.up[j])), q.n - s.dn * shapeAt(S, j, s, S.up[j])) - S.Rj[j];

describe.each(Object.keys(CASES))('strum solve "%s"', name => {
  const { S, P } = CASES[name]();

  it('solves without thinning anything', () => {
    expect(S.K).toBeGreaterThan(0);
    expect(S.stats.infeasible).toBe(0);
  });

  it('lands EXACTLY on the beat: each strum releases its first chord tone at the strum time', () => {
    for (const p of S.passes) for (const loop of [0, 1, 2]){
      const t = p.t + loop * P, q = pickAt(S, t, START);
      if (t < firstPass(S, START).ts) continue;
      expect(q.mode).toBe('pass');
      const f = p.d > 0 ? p.lo : p.hi;
      expect(Math.abs(q.x - (S.xs[f] + p.d * DELTA))).toBeLessThan(1e-9);
      // every string's release is where the marble is at that moment (the spread IS the flight)
      for (const c of S.strings.map(st => st.cr[p.k])){
        const j = S.strings.findIndex(st => st.cr[p.k] === c);
        const qq = pickAt(S, c.tau + loop * P, START);
        expect(Math.abs(qq.x - (S.xs[j] + p.d * DELTA)), `string ${j}`).toBeLessThan(1e-9);
        expect(qq.n).toBeCloseTo(-H_TIP, 12);
      }
    }
  });

  it('the strum spread is the marble crossing the chord: 8–30 ms between neighbouring chord tones (unless the hand is rushed)', () => {
    for (const p of S.passes){
      const taus = p.js.map(j => S.strings[j].cr[p.k].tau).sort((a, b) => a - b);
      for (let i = 1; i < taus.length; i++){
        const dt = taus[i] - taus[i - 1];
        expect(dt).toBeGreaterThan(.0015);
        if (p.v < V_HI - 1e-9 && p.v > 30.001) expect(dt).toBeLessThan(SP_MAX * 1.6 * 2.2);
      }
      if (p.js.length > 1 && p.v < V_HI - 1e-9 && p.v > 30.001){
        const lo = S.xs[p.lo], hi = S.xs[p.hi];
        const mean = (hi - lo) / (p.js.length - 1) / p.v;
        expect(mean).toBeGreaterThanOrEqual(SP_MIN - 1e-9); expect(mean).toBeLessThanOrEqual(SP_MAX + 1e-9);
      }
    }
  });

  it('strings are AT REST at first contact, and the contact is exact (string centre on the marble)', () => {
    for (let j = 0; j < S.N; j++) for (const c of S.strings[j].cr){
      const t = c.tc + P;
      for (const dt of [1e-4, 2e-3]){
        const s = stringAt(S, j, t - dt, START);
        expect(Math.abs(s.dx) + Math.abs(s.dn), `string ${j} pass ${c.k} −${dt}`).toBeLessThan(1e-6);
      }
      const mid = (c.tc + c.tau) / 2 + P, s = stringAt(S, j, mid, START), q = pickAt(S, mid, START);
      expect(s.contact).toBe(true);
      expect(Math.abs(pickGap(S, j, q, s))).toBeLessThan(1e-9);
    }
  });

  it('no penetration: marble never inside a string; felts never inside their string; felts settled at every crossing', () => {
    for (let t = START; t < START + 2.2 * P; t += 5e-4){
      const q = pickAt(S, t, START);
      for (let j = 0; j < S.N; j++){
        const s = stringAt(S, j, t, START);
        if (Math.abs(q.x - S.xs[j]) < .5) expect(pickGap(S, j, q, s), `marble × string ${j} @${t.toFixed(4)} ${q.mode}`).toBeGreaterThanOrEqual(-1e-6);
        const th = damperAt(S, j, t, START);
        const at = s.dn * shapeAt(S, j, s, S.ud[j]);
        expect(feltFace(th) - at, `felt × string ${j} @${t.toFixed(4)}`).toBeGreaterThanOrEqual(-1e-6);
      }
    }
    for (let j = 0; j < S.N; j++) for (const c of S.strings[j].cr) for (const dt of [-GUARD, 0, GUARD]){
      const t = c.tau + P + dt, th = damperAt(S, j, t, START);
      expect(Math.abs(th - (c.sigma ? 1 : 0)), `felt ${j} @ pass ${c.k} (${c.sigma ? 'open' : 'damped'})`).toBeLessThan(1e-9);
      const t2 = c.tc + P - GUARD;
      expect(Math.abs(damperAt(S, j, t2, START) - (c.sigma ? 1 : 0))).toBeLessThan(1e-9);
    }
  });

  it('continuous: nothing teleports (marble, arm, strings, felts) across the count-in and the loop seam', () => {
    const dt = 2.5e-4;
    let q0 = pickAt(S, START, START), s0 = S.xs.map((_, j) => stringAt(S, j, START, START)), f0 = S.xs.map((_, j) => damperAt(S, j, START, START));
    for (let t = START + dt; t < START + 2.1 * P; t += dt){
      const q = pickAt(S, t, START);
      expect(Math.abs(q.x - q0.x), `marble x @${t.toFixed(4)} ${q0.mode}→${q.mode}`).toBeLessThan(V_HI * dt * 1.02 + 1e-9);
      expect(Math.abs(q.n - q0.n), `arm @${t.toFixed(4)}`).toBeLessThan(10 * dt);
      // the hand's speed is continuous too (a cable drive can't jump velocity): bounded acceleration
      expect(Math.abs(q.vx - q0.vx), `marble v @${t.toFixed(4)} ${q0.mode}→${q.mode}`).toBeLessThan(V_HI * V_HI / (2 * D_DOCK) * 1.05 * dt);
      for (let j = 0; j < S.N; j++){
        const s = stringAt(S, j, t, START), f = damperAt(S, j, t, START);
        expect(Math.abs(s.dx - s0[j].dx) + Math.abs(s.dn - s0[j].dn), `string ${j} @${t.toFixed(4)}`).toBeLessThan(V_HI * dt * 1.5 + 1e-6);
        expect(Math.abs(f - f0[j]), `felt ${j} @${t.toFixed(4)}`).toBeLessThan(dt / .016 * 1.6);
        s0[j] = s; f0[j] = f;
      }
      q0 = q;
    }
  });

  it('long gaps PARK on a dock magnet at zero speed (and the return trip runs retracted behind the strings)', () => {
    for (const p of S.passes){
      const tr = p.turn;
      if (tr.type === 'flip') continue;
      const tdock = p.te + tr.Tb + P;
      const q = pickAt(S, tdock + 1e-6, START);
      expect(Math.abs(q.x - (p.Eout + p.d * D_DOCK))).toBeLessThan(1e-4);
      expect(Math.abs(q.vx)).toBeLessThan(.5);
      if (tr.type === 'ret'){
        const mid = pickAt(S, p.te + tr.T / 2 + P, START);
        if (mid.mode === 'travel') expect(mid.n).toBeLessThan(-H_TIP - R_TIP - .05);
      }
    }
  });

  it('is ARMED during the count-in: the marble waits on its dock, strings still, nothing sounds', () => {
    const fp = firstPass(S, START), q = pickAt(S, START, START);
    expect(q.armed).toBe(true);
    expect(q.vx).toBe(0);
    const p = S.passes[fp.k];
    expect(q.x).toBeCloseTo(p.Ein - p.d * D_DOCK, 9);
    for (let j = 0; j < S.N; j++){
      const s = stringAt(S, j, START + .01, START);
      expect(s.dx).toBe(0); expect(s.glow).toBe(0);
      expect(lastSounding(S, j, fp.ts - 1e-6, START)).toBe(null);
      expect(damperAt(S, j, START, START)).toBe(damperAt(S, j, Math.min(fp.ts - .36, START + .5), START));
    }
  });

  it('the felt landing is the note-off: an open crossing rings exactly until its felt lands (or the next pluck)', () => {
    for (let j = 0; j < S.N; j++) for (const c of S.strings[j].snd){
      expect(c.dur).toBeGreaterThan(0);
      if (isFinite(c.touch)){
        expect(damperAt(S, j, c.tau + c.dur + P, START)).toBe(0);
        expect(damperAt(S, j, c.tau + c.dur + P - 2e-3, START)).toBeGreaterThan(0);
      }
    }
  });
});

describe('strum: the hand', () => {
  it('plays the folk pattern as a guitarist: D D U U D U, and every turn type appears across demo + dense', () => {
    const { S } = demo();
    const bar = S.passes.slice(0, 6).map(p => p.d > 0 ? 'D' : 'U').join('');
    expect(bar).toBe('DDUUDU');
    const types = new Set([...S.passes, ...CASES.dense16ths().S.passes].map(p => p.turn.type));
    for (const t of ['flip', 'dock', 'ret']) expect(types.has(t), t).toBe(true);
    expect(new Set(S.passes.map(p => p.turn.type)).has('dock')).toBe(true);
  });

  it('a pickup (negative beat) wraps into the loop', () => {
    const { S, P } = CASES.pickup();
    expect(S.passes[S.K - 1].t).toBeCloseTo(ROLL_T - 4.5 * .6 + P, 9);
  });
});

describe('strum: lanes never interact', () => {
  it('neighbouring strings never touch, even both at full swing; a felt only ever covers its own string', () => {
    for (const n of [2, 8, 24]){
      const ids = Array.from({ length: n }, (_, i) => ['E2', 'A2', 'D3', 'G3', 'B3', 'E4', 'A4', 'D5', 'G5', 'B5', 'E6'][i % 11]);
      const lay = layoutStrings(ids, { W: 12 });
      for (let i = 1; i < n; i++){
        const gap = lay.xs[i] - lay.xs[i - 1] - 2 * DELTA - stringRadius(ids[i]) - stringRadius(ids[i - 1]);
        expect(gap).toBeGreaterThan(.08);
        // the marble's contact zone on one string ends well before the next one's begins
        const R = R_TIP + stringRadius(ids[i]);
        expect(lay.xs[i] - Math.sqrt(R * R - H_TIP * H_TIP) - (lay.xs[i - 1] + DELTA)).toBeGreaterThan(.12);
      }
      expect(lay.half * lay.scale).toBeLessThanOrEqual(6 - .2 + 1e-9);
    }
  });
});

describe('strum: geometry encodes the note only', () => {
  it('length ∝ f^−½ (E2 is twice E4), radius a pure fn of pitch, layout never changes either', () => {
    expect(stringLength('E2') / stringLength('E4')).toBeCloseTo(2, 9);
    expect(stringLength('A3') / stringLength('A4')).toBeCloseTo(Math.SQRT2, 9);
    expect(stringRadius('E2')).toBeGreaterThan(stringRadius('E4'));
    expect(stringLength('C4|n')).toBe(stringLength('C4'));
    const a = solve([[0, 'C3'], [0, 'C4']], 90, 4), b = solve(dense, 120, 8);
    expect(a.S.up[1]).toBe(pickU('C4'));
    expect(b.S.ud[0]).toBe(dampU('E2'));
    // the felt and the pick sit on every string the machine can carry
    expect(stringLength(`E6`)).toBeGreaterThan(S_DAMP + .2);
    expect(S_DAMP).toBeGreaterThan(S_PICK + .4);
  });
});

describe('strum: PART_LIMITS (robust to imported parts)', () => {
  it('a dense random 24-string import at the stated gap never needs thinning by the solver', () => {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let trial = 0; trial < 6; trial++){
      const part = [];
      const bpm = 120, gapBeats = PART_LIMITS.gap / (60 / bpm) * 1.0001;
      for (let b = 0; b < 30; b += gapBeats * (1 + Math.floor(rnd() * 2))){
        const k = 1 + Math.floor(rnd() * PART_LIMITS.poly);
        for (let i = 0; i < k; i++) part.push([b, ['E2', 'G2', 'A2', 'C3', 'D3', 'E3', 'G3', 'A3', 'C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'D6', 'E6', 'F2', 'B2', 'B4'][Math.floor(rnd() * 24)], .2 + .8 * rnd()]);
      }
      const { S } = solve(part, bpm, 32);
      expect(S.stats.infeasible, `trial ${trial}`).toBe(0);
    }
  });

  it('degrades gracefully: garbage, folding, poly and pitch budgets, huge parts — never throws', () => {
    expect(() => solve([], 100, 4)).not.toThrow();
    expect(solve([], 100, 4).S.K).toBe(0);
    const junk = solve([[0, 'H9'], [1, 'C#'], 'x', [2, 'Db4'], [3, 'C4']], 100, 4);
    expect(junk.S.K).toBe(1);
    const fold = prepPart([[0, 'C1'], [1, 'C8']], timing(100, 4));
    expect(fold.ids).toEqual(['C3', 'C6']);
    const big = prepPart(Array.from({ length: 10 }, (_, i) => [0, ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4'][i]]), timing(100, 4));
    expect(big.strums[0].notes.length).toBe(PART_LIMITS.poly);
    expect(big.strums[0].notes[0].id).toBe('C3'); expect(big.strums[0].notes[5].id).toBe('E4');
    const wide = [];
    for (let m = 40; m < 40 + 40; m++) wide.push([(m - 40) * .5, ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12] + (Math.floor(m / 12) - 1)]);
    const w = prepPart(wide, timing(100, 24));
    expect(w.ids.length).toBeLessThanOrEqual(PART_LIMITS.pitches);
    const huge = [];
    for (let b = 0; b < 400; b += .125) huge.push([b, 'E3'], [b, 'B3']);
    const h = solve(huge, 140, 400);
    expect(h.S.K).toBeLessThanOrEqual(PART_LIMITS.maxEvents);
    expect(h.S.K).toBeGreaterThan(100);
  });

  it('parses ids with a timbre suffix', () => {
    expect(parseId('F#3|n')).toEqual({ name: 'F#3', m: 54, variant: 'n' });
    expect(parseId('nope')).toBe(null);
  });
});

describe('strum: the demo', () => {
  it('is a real phrase: 32 beats, strums of 4–6 notes, every chord sounds its own tones (+ the held notes it brushes)', () => {
    expect(strum.demo.beats % 4).toBe(0);
    const { S } = demo();
    expect(S.stats.forced).toBe(0);
    for (const p of S.passes){
      expect(p.js.length).toBeGreaterThanOrEqual(1);
      for (let j = 0; j < S.N; j++){ const c = S.strings[j].cr[p.k]; expect(c.sigma).toBe(p.js.includes(j) || !!c.brush); }
    }
    expect(S.stats.brushed).toBeGreaterThan(0);          // the fingerpicked bars ring through
  });
});

describe('strum: the voice', () => {
  it('deterministic, bounded, decaying, ends in exact zero, ≤ 3 s', () => {
    for (const id of ['E2', 'G3', 'E4', 'E6', 'C4|n', 'A4|h']){
      const a = strumVoice(id), b = strumVoice(id);
      expect(a.samples).toBe(b.samples);
      const { samples, sr } = a;
      expect(samples.length / sr).toBeLessThanOrEqual(3 + 1e-9);
      let peak = 0; for (const x of samples) peak = Math.max(peak, Math.abs(x));
      expect(peak, id).toBeGreaterThan(.5); expect(peak, id).toBeLessThanOrEqual(.9);
      expect(samples[samples.length - 1]).toBe(0);
      const db = t0 => { let s = 0; const i0 = Math.round(t0 * sr), i1 = Math.round((t0 + .1) * sr);
        for (let i = i0; i < i1; i++) s += samples[i] ** 2; return 10 * Math.log10(s / (i1 - i0) + 1e-20); };
      for (let t = .2; t < samples.length / sr - .3; t += .2) expect(db(t + .2) - db(t), `${id} @${t.toFixed(1)}`).toBeLessThan(.5);
    }
  });
  it('the pitch is the note (the fundamental beats a semitone either side)', () => {
    for (const id of ['A2', 'E3', 'C4', 'G4']){
      const { samples, sr } = strumVoice(id), f = noteHz(id);
      const gz = fq => { const w = 2 * Math.PI * fq / sr; let s1 = 0, s2 = 0;
        for (let i = Math.round(sr * .1); i < Math.round(sr * .6); i++){ const s0 = samples[i] + 2 * Math.cos(w) * s1 - s2; s2 = s1; s1 = s0; }
        return s1 * s1 + s2 * s2 - 2 * Math.cos(w) * s1 * s2; };
      expect(gz(f), id).toBeGreaterThan(gz(f * Math.pow(2, 1 / 12)) * 10);
      expect(gz(f), id).toBeGreaterThan(gz(f / Math.pow(2, 1 / 12)) * 10);
    }
  });
  it('renders the demo bank in budget', () => {
    const ids = [...new Set(strum.demo.part.map(e => e[1]))].map(id => id + '|x');   // (fresh ids: no cache)
    const t0 = performance.now();
    for (const id of ids) strumVoice(id);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
