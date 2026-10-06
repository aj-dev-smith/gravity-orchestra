import { describe, it, expect } from 'vitest';
import { solveLane, poseAt, stringDisp, stringLength, stringRadius, firstAbs, footClearance,
         g, E, H_MAX, V_MAX, BALL_R } from '../src/instruments/bass/solve.js';
import { layoutBed, laneBoxes } from '../src/instruments/bass/layout.js';
import { bassVoice } from '../src/instruments/bass/voice.js';
import { eventTimes, lanesByNote } from '../src/instruments/clock.js';
import { noteHz } from '../src/engine.js';
import bass from '../src/instruments/bass/index.js';

const P = 12;
const lanes = {
  sparse: [1, 5.5],                                  // long gaps: full drops
  mixed:  [.5, 1.1, 1.5, 3, 3.4, 9],                 // dense + long
  dense:  [0, .3, .6, .9, 1.2, 1.5, 1.8, 2.1],       // eighths at 100 bpm
  single: [4],
  pickup: [-.4, 2, 7],                               // a negative (pickup) strike wraps
};
const wrap = t => ((t % P) + P) % P;

const geoms = [{ u0: .3, Ls: 8.6 }, { u0: .7, Ls: 2.15 }, { u0: .5, Ls: 4 }];
const cases = Object.entries(lanes).flatMap(([name, times]) => geoms.map(o => [`${name} u0=${o.u0} L=${o.Ls}`, times, o]));
describe.each(cases)('bass lane "%s"', (name, times, opt) => {
  const S = solveLane(times, P, opt);
  const start = -2.4;

  it('every gap fits: contact + rise + winch + fall ≤ gap', () => {
    for (let i = 0; i < S.n; i++){
      const j = (i + 1) % S.n;
      const used = S.catchT[i] + S.W[i] + S.tf[j];
      expect(used, `gap ${i}`).toBeLessThanOrEqual(S.gaps[i] + 1e-9);
      expect(S.v[i]).toBeGreaterThan(0); expect(S.v[i]).toBeLessThanOrEqual(V_MAX + 1e-9);
    }
  });

  it('lands EXACTLY on the beat: underside at the string, falling at v, at every strike', () => {
    for (let k = 0; k < S.n; k++){
      for (const loop of [0, 1, 3]){
        const t = S.s[k] + loop * P;
        const at = poseAt(S, t + 1e-9, start), before = poseAt(S, t - 1e-6, start);
        expect(at.i).toBe(k);
        expect(Math.abs(at.y)).toBeLessThan(1e-6);
        expect(before.y).toBeGreaterThan(0);                       // arriving from above
        expect(before.mode).toBe('fall');
        expect(before.vy).toBeCloseTo(-S.v[k], 3);                 // free fall from h: v = √(2gh)
      }
    }
  });

  it('the string is AT REST at first contact (no ring left, no velocity)', () => {
    for (let k = 0; k < S.n; k++){
      const t = S.s[k] + P;
      for (const dt of [1e-4, 2e-3]){
        const p = poseAt(S, t - dt, start);
        for (const u of [.1, .25, opt.u0, .5, .75, .9]){
          const w = stringDisp(p, u, opt.u0);
          expect(Math.abs(w), `strike ${k} −${dt} u=${u}`).toBeLessThan(.002);
        }
      }
    }
  });

  it('no penetration: ball never below the string, magnet face never inside the ball', () => {
    for (let t = start; t < start + 2 * P + 3; t += .0023){
      const p = poseAt(S, t, start);
      const w = stringDisp(p, opt.u0, opt.u0);
      expect(p.y, `ball vs string @${t.toFixed(4)} ${p.mode}`).toBeGreaterThanOrEqual(w - 1e-6);
      // the ball's whole FOOTPRINT vs the ringing string (mode 2 has slope at the strike point)
      expect(footClearance(S, p), `footprint vs string @${t.toFixed(4)} ${p.mode}`).toBeGreaterThanOrEqual(-1e-6);
      expect(p.cy, `magnet vs ball @${t.toFixed(4)}`).toBeGreaterThanOrEqual(p.y - 1e-6);
      if (p.mode === 'contact') expect(Math.abs(p.y - p.def)).toBeLessThan(1e-9);   // the string carries the ball
    }
  });

  it('is lossy and the WINCH supplies the energy: vOut = e·vIn, rebound apex < drop', () => {
    for (let k = 0; k < S.n; k++){
      expect(S.vOut[k]).toBeCloseTo(E * S.v[k], 9);
      expect(S.hr[k]).toBeLessThan(S.h[k]);
      // at the catch: ball at its apex at zero speed, carriage there at zero speed
      const t = S.s[k] + P + S.catchT[k];
      const p = poseAt(S, t - 1e-7, start);
      expect(Math.abs(p.vy)).toBeLessThan(1e-4);
      expect(Math.abs(p.cvy)).toBeLessThan(1e-3);
      expect(Math.abs(p.cy - p.y)).toBeLessThan(1e-5);
    }
  });

  it('is continuous: across the loop seam, the count-in → first strike, every phase', () => {
    const dt = 4e-4;
    let prev = poseAt(S, start, start);
    for (let t = start + dt; t < start + 2 * P + 1; t += dt){
      const p = poseAt(S, t, start);
      const lim = 30 * dt;                                         // ≤ 30 u/s: no teleports
      expect(Math.abs(p.y - prev.y), `ball jump @${t.toFixed(4)}`).toBeLessThan(lim);
      expect(Math.abs(p.cy - prev.cy), `carriage jump @${t.toFixed(4)}`).toBeLessThan(lim);
      prev = p;
    }
  });

  it('is ARMED during the count-in: loaded on the magnet, then the same drop as every loop', () => {
    const first = firstAbs(S, start);
    const p = poseAt(S, start, start);
    expect(p.armed).toBe(true);
    if (first - start > S.tf[p.j] + 1e-6){ expect(p.mode).toBe('hold'); expect(p.y).toBeCloseTo(p.cy, 9); }
    const a = poseAt(S, first - .05, start), b = poseAt(S, first - .05 + P, start);
    expect(a.y).toBeCloseTo(b.y, 9);                                // armed drop ≡ steady-state drop
  });
});

describe('bass lane shapes', () => {
  it('long gaps get the full drop; a fast repeat solves a LOWER drop (the magnet waits low)', () => {
    const sparse = solveLane(lanes.sparse, P);
    sparse.h.forEach(h => expect(h).toBeCloseTo(H_MAX, 6));
    const dense = solveLane(lanes.dense, P);
    expect(Math.max(...dense.h.slice(1))).toBeLessThan(.5);
    expect(dense.h[0]).toBeGreaterThan(dense.h[1]);                  // the run's first note falls from higher
  });
  it('a pickup strike (negative beat) wraps into the loop', () => {
    const S = solveLane(lanes.pickup, P);
    expect(S.s[S.s.length - 1]).toBeCloseTo(wrap(-.4), 9);
  });
});

describe('bass ring is visible (the clearance cap does not kill it)', () => {
  it('a full-height strike rings with a real amplitude, both modes excited off-centre', () => {
    const S = solveLane(lanes.sparse, P, { u0: .3, Ls: 6 });
    expect(S.A1[0]).toBeGreaterThan(.05);
    expect(Math.abs(S.A2[0])).toBeGreaterThan(.01);
  });
});

describe('bass bed layout: lanes never interact', () => {
  const inter = (a, b) => a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3] && a[4] < b[5] && b[4] < a[5];
  const chromatic = n => Array.from({ length: n }, (_, k) => ['E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B', 'C', 'C#', 'D', 'D#'][k % 12] + (1 + Math.floor((k + 4) / 12)));
  it.each([1, 2, 6, 8, 9, 12, 16, 25])('%i chromatic lanes: no lane\'s column/rail meets another lane\'s parts; fits the station', n => {
    const W = 12, D = 8, B = layoutBed(chromatic(n), { W, D });
    expect(B.n).toBe(n);
    for (const a of B.lanes){
      const A = laneBoxes(a, B.yTop);
      for (const b of B.lanes){
        if (a === b) continue;
        const Bx = laneBoxes(b, B.yTop);
        for (const mine of ['col', 'rail']) for (const theirs of ['col', 'rail', 'str', 'post', 'nut'])
          expect(inter(A[mine], Bx[theirs]), `${a.note}.${mine} vs ${b.note}.${theirs}`).toBe(false);
      }
      // a lane's own rail stops above its own string, beside (not over) its ball column
      expect(A.rail[2]).toBeGreaterThan(a.y + 2 * BALL_R);
      expect(Math.abs(a.xRail - a.xb)).toBeGreaterThan(BALL_R);
    }
    // inside the footprint (after the uniform bed scale)
    const s = B.scale;
    for (const x of [B.spineX[0] - .2, B.spineX[1] + .2]) expect(Math.abs(x * s)).toBeLessThanOrEqual(W / 2 + 1e-9);
    for (const l of B.lanes) expect(Math.abs(l.z * s) + .5 * s).toBeLessThanOrEqual(D / 2 + 1e-9);
  });
  it('string length is the note\'s alone — never clamped by the layout', () => {
    for (const n of [3, 12, 25]) for (const l of layoutBed(chromatic(n)).lanes) expect(l.Ls).toBe(stringLength(l.note));
  });
  it('a typical 6-pitch part needs no shrink (honest scale, honest g)', () => {
    expect(layoutBed(['E1', 'G1', 'A1', 'B1', 'D2', 'E2']).scale).toBe(1);
  });
});

describe('bass geometry encodes the note only', () => {
  it('string length ∝ 1/f (an octave up = half the string)', () => {
    expect(stringLength('E1') / stringLength('E2')).toBeCloseTo(2, 6);
    expect(stringLength('A1') * noteHz('A1')).toBeCloseTo(stringLength('E1') * noteHz('E1'), 6);
    expect(stringRadius('E1')).toBeGreaterThan(stringRadius('E2'));
  });
  it('the ball clears the string ends (strings longer than the ball)', () => {
    expect(stringLength('E3')).toBeGreaterThan(4 * BALL_R);
  });
});

describe('bass voice', () => {
  const pitchOf = ({ samples, sr }, f) => {
    // autocorrelation around the expected period (±8%)
    const a = samples.subarray((sr * .15) | 0, (sr * .95) | 0);
    const T0 = sr / f;
    let best = 0, bestT = 0;
    for (let T = Math.floor(T0 * .92); T <= Math.ceil(T0 * 1.08); T++){
      let c = 0; for (let n = 0; n + T < a.length; n++) c += a[n] * a[n + T];
      if (c > best){ best = c; bestT = T; }
    }
    return sr / bestT;
  };
  it.each(['E1', 'A1', 'E2', 'B2', 'E3'])('%s is in tune, bounded, finite, ≤ 3 s', note => {
    const v = bassVoice(note);
    expect(v.samples.length / v.sr).toBeLessThanOrEqual(3);
    let peak = 0;
    for (const x of v.samples){ expect(Number.isFinite(x)).toBe(true); peak = Math.max(peak, Math.abs(x)); }
    expect(peak).toBeGreaterThan(.5); expect(peak).toBeLessThanOrEqual(.9);
    const f = noteHz(note);
    expect(Math.abs(pitchOf(v, f) / f - 1)).toBeLessThan(.012);
  });
  it.each(['E1', 'A1'])('%s reads on a phone speaker: real energy above 200 Hz', note => {
    const { samples, sr } = bassVoice(note);
    const w = 2 * Math.PI * 200 / sr, al = Math.sin(w) / (2 * .707), c = Math.cos(w);   // RBJ highpass
    const b0 = (1 + c) / 2, b1 = -(1 + c), b2 = (1 + c) / 2, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, eh = 0, ea = 0;
    for (let i = 0; i < sr * .8; i++){
      const x = samples[i], y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x; y2 = y1; y1 = y; eh += y * y; ea += x * x;
    }
    expect(Math.sqrt(eh / ea)).toBeGreaterThan(.25);
  });
  it('rings (~2 s) and ends silent', () => {
    const { samples, sr } = bassVoice('A1');
    const rms = (a, b) => { let s = 0; for (let n = a; n < b; n++) s += samples[n] ** 2; return Math.sqrt(s / (b - a)); };
    const early = rms(0, sr * .2), late = rms(sr * 1.6, sr * 1.8);
    expect(late).toBeGreaterThan(early * .01);
    expect(late).toBeLessThan(early * .5);
    expect(Math.abs(samples[samples.length - 1])).toBeLessThan(1e-3);
  });
});

describe('bass descriptor + demo', () => {
  it('is a dry voice keyed "bass" with a 16–32 beat demo', () => {
    expect(bass.key).toBe('bass'); expect(bass.wet).toBe(false);
    expect(bass.demo.beats).toBeGreaterThanOrEqual(16); expect(bass.demo.beats).toBeLessThanOrEqual(32);
  });
  it('demo: real phrase — dense runs AND long gaps, chords, dynamics; every lane solvable', () => {
    const { bpm, beats, part } = bass.demo;
    const beat = 60 / bpm, rollT = 2.6, Pd = rollT + beats * beat;
    const ev = eventTimes(part, { rollT, beat });
    const byBeat = {}; ev.forEach(e => (byBeat[e.beat] ||= []).push(e));
    expect(Object.values(byBeat).some(a => a.length > 1)).toBe(true);           // double-stops
    expect(new Set(ev.map(e => e.vel)).size).toBeGreaterThan(3);                // dynamics
    for (const [note, es] of Object.entries(lanesByNote(ev))){
      expect(noteHz(note)).toBeGreaterThan(38); expect(noteHz(note)).toBeLessThan(170);   // ~E1–E3
      const l = layoutBed(Object.keys(lanesByNote(ev))).lanes.find(x => x.note === note);
      const S = solveLane(es.map(e => e.t), Pd, { u0: l.u0, Ls: l.Ls });
      for (let i = 0; i < S.n; i++) expect(S.catchT[i] + S.W[i] + S.tf[(i + 1) % S.n]).toBeLessThanOrEqual(S.gaps[i] + 1e-9);
      // the demo lane's ball footprint never meets its ringing string
      for (let t = -2.4; t < Pd + 1; t += .002) expect(footClearance(S, poseAt(S, t, -2.4))).toBeGreaterThanOrEqual(-1e-6);
    }
    const all = ev.map(e => e.t).sort((a, b) => a - b), d = all.slice(1).map((t, k) => t - all[k]).filter(x => x > 1e-9);
    expect(Math.min(...d)).toBeLessThanOrEqual(beat / 2 + 1e-9);                // a run
    expect(Math.max(...d)).toBeGreaterThanOrEqual(2 * beat);                    // a long gap
  });
});
