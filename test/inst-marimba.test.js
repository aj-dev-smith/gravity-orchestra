import { describe, it, expect } from 'vitest';
import { eventTimes } from '../src/instruments/clock.js';
import { noteHz } from '../src/engine.js';
import {
  makeLanes, ballAt, kickAt, flexAt, barTopAt, modeShape, keyboard, H, DT_MAX, g, NODE,
  KICK_MAX, PAD_T, PLUNGE, SOL_H, ROD, FLEX_MAX, effectiveStart,
} from '../src/instruments/marimba/solve.js';
import { marimbaVoice, layerId } from '../src/instruments/marimba/voice.js';
import marimba from '../src/instruments/marimba/index.js';

const ROLL_T = 2.6, BEAT = 60 / 100, START = -2.4;
const loopBeats = marimba.demo.beats;
const P = ROLL_T + loopBeats * BEAT;

// a synthetic part with every kind of lane: a dense roll (16ths), mid arcs, a long hold,
// a lone note, chords, and a pickup-style note at beat 0 that wraps the seam
const SYN = [
  ...Array.from({ length: 8 }, (_, k) => [4 + k * .25, 'E5', .4 + k * .07]),   // a roll
  [0, 'A3'], [1.5, 'A3', .6], [2.5, 'A3', .8], [9, 'A3'],                       // arcs + a hold
  [0, 'E4'], [0, 'C5'], [8, 'E4', .5], [8, 'C5', .5],                            // chords
  [6, 'G5'],                                                                      // a lone note
  [15.75, 'D4'], [0.25, 'D4'],                                                    // across the seam
];
const lanesFor = part => makeLanes(eventTimes(part, { rollT: ROLL_T, beat: BEAT }), P, START);

const LANES = [...lanesFor(SYN), ...lanesFor(marimba.demo.part)];

describe('marimba solve — lands exactly on the beat', () => {
  it('every lane is at the bar (y = 0) at each of its strikes, every loop', () => {
    for (const { L, start: START } of LANES) for (const s of L.s) for (const k of [0, 1, 2]){
      const t = s + k * P;

      const d = ballAt(L, t, START);
      if (d.i < 0) continue;                       // strikes before the first after START never happened
      expect(d.y, `t=${t}`).toBeCloseTo(0, 6);
    }
  });

  it('the first strike after the count-in is a free fall from the magnet onto the beat', () => {
    for (const { L, first, start: START } of LANES){
      const held = ballAt(L, START, START);
      if (first - START > DT_MAX / 2){                 // tail strikes inside the count-in may already be falling
        expect(held.mode).toBe('hold');
        expect(held.y).toBeCloseTo(H, 9);
      } else expect(held.mode).toBe('drop');
      const land = ballAt(L, first - 1e-6, START);
      expect(land.y).toBeLessThan(1e-4);
      expect(land.vy).toBeCloseTo(-g * DT_MAX / 2, 3);
    }
  });

  it('long gaps dock on the magnet at exactly zero speed and never rise above it', () => {
    for (const { L, start: START } of LANES){
      for (let t = START; t < START + 2 * P; t += .003){
        const d = ballAt(L, t, START);
        expect(d.y).toBeLessThanOrEqual(H + 1e-9);
        if (d.mode === 'hold'){ expect(d.vy).toBe(0); expect(d.y).toBeCloseTo(H, 9); }
      }
    }
  });

  it('the ball is continuous across the loop seam and the count-in', () => {
    for (const { L, start: START } of LANES){
      let prev = ballAt(L, START, START).y;
      for (let t = START + .001; t < START + 2.2 * P; t += .001){
        const y = ballAt(L, t, START).y;
        expect(Math.abs(y - prev), `t=${t}`).toBeLessThan(.02);   // max |v| ≈ 7.3 u/s → ≤ .0073/ms
        prev = y;
      }
    }
  });
});

describe('marimba solve — honest contact', () => {
  it('plungers and the bar flex are exactly at rest at every contact', () => {
    for (const { L, start: START } of LANES) for (const s of L.s) for (const k of [0, 1]){
      const t = s + k * P;
      if (t < START) continue;
      const d = ballAt(L, t, START);
      if (d.i < 0) continue;
      expect(kickAt(L, t, START)).toBeCloseTo(0, 9);
      expect(flexAt(L, t, START, d)).toBeCloseTo(0, 9);
    }
  });

  it('the marble never penetrates the bar (bar top ≤ ball underside, always)', () => {
    for (const { note, L, start: START } of LANES){
      for (let t = START; t < START + 2 * P; t += .0007){
        const d = ballAt(L, t, START);
        const top = barTopAt(L, t, START, d);
        expect(top, `${note} t=${t.toFixed(4)} ball=${d.y}`).toBeLessThanOrEqual(d.y + 1e-6);
      }
    }
  });

  it('the bar mode shape is the true free-free first mode: nodes at 22.4 %, ends 1.64× the centre', () => {
    expect(modeShape(.5 - NODE)).toBeCloseTo(0, 3);
    expect(modeShape(-(.5 - NODE))).toBeCloseTo(0, 3);
    expect(modeShape(0)).toBeCloseTo(-1, 9);
    expect(modeShape(.5) / -modeShape(0)).toBeCloseTo(1.645, 2);   // the ends swing against the centre
    expect(modeShape(-.5)).toBeCloseTo(modeShape(.5), 6);          // symmetric
  });

  it('the bend is a shiver, not a rubber banana (ends ≤ 40 % of the bar thickness)', () => {
    expect(FLEX_MAX * modeShape(.5)).toBeLessThanOrEqual(.4 * .15);
    for (const { L, start } of LANES) for (let t = start; t < start + P; t += .002)
      expect(Math.abs(flexAt(L, t, start))).toBeLessThanOrEqual(FLEX_MAX + 1e-12);
  });

  it('the node solenoid stack never collides with itself over the full kick travel', () => {
    let lo = 0, hi = 0;
    for (const { L, start } of LANES) for (let t = start; t < start + 2 * P; t += .001){
      const k = kickAt(L, t, start); lo = Math.min(lo, k); hi = Math.max(hi, k);
    }
    // (a strike's follow-through can overlap the next wind-up by a hair: allow 2 mm)
    expect(lo).toBeGreaterThanOrEqual(-KICK_MAX - .002);
    expect(hi).toBeLessThanOrEqual(KICK_MAX + .002);
    // y relative to the bar underside at rest; barrel spans [−PAD_T−PLUNGE−SOL_H, −PAD_T−PLUNGE]
    const barrelTop = -PAD_T - PLUNGE, barrelBot = barrelTop - SOL_H;
    for (const off of [lo, hi, -KICK_MAX, KICK_MAX]){
      const padBot = off - PAD_T, rodBot = off - PAD_T - ROD;
      expect(padBot).toBeGreaterThan(barrelTop + .005);        // the pad never bottoms on the barrel
      expect(rodBot).toBeGreaterThan(barrelBot + .005);        // the rod never pokes out under the barrel (or rail)
      expect(rodBot).toBeLessThan(barrelTop - .02);            // …and never pulls out of it
    }
  });
});

describe('marimba count-in', () => {
  it('the demo does not open with its own ending: no wrapped-tail strike sounds in the count-in', () => {
    const ev = eventTimes(marimba.demo.part, { rollT: ROLL_T, beat: BEAT });
    const s0 = effectiveStart(ev, P, START);
    expect(s0).toBeGreaterThan(START);
    for (const { L, first, start } of lanesFor(marimba.demo.part)){
      expect(start).toBe(s0);
      expect(first).toBeGreaterThanOrEqual(ROLL_T - 1e-6);     // every lane's first strike is in loop 0
      expect(ballAt(L, start, start).mode).toBe('hold');      // …and is a drop from its magnet
    }
  });
  it('a pickup still plays: the effective start never passes a real first strike', () => {
    const ev = eventTimes([[-1, 'C4'], [0, 'E4'], [15.5, 'G4']], { rollT: ROLL_T, beat: BEAT });
    const s0 = effectiveStart(ev, P, START);
    expect(s0).toBeLessThanOrEqual(ROLL_T - BEAT - DT_MAX / 2);
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
    // high bars ring shorter
    expect(marimbaVoice('C6').samples.length).toBeLessThan(marimbaVoice('C3').samples.length);
  });
  it('dies away rather than gating: the last 400 ms before the fade is already quiet', () => {
    for (const n of ['C3', 'A3', 'E5']){
      const { samples: x, sr } = marimbaVoice(n);
      let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
      let tail = 0; for (let i = x.length - Math.round(.4 * sr); i < x.length; i++) tail = Math.max(tail, Math.abs(x[i]));
      expect(20 * Math.log10(tail / pk)).toBeLessThan(-18);
    }
  });
  it('a hard strike is BRIGHTER, not just louder (the velocity layer)', () => {
    expect(layerId('E4', .9)).toBe('E4|h'); expect(layerId('E4', .5)).toBe('E4');
    const hf = x => { let d = 0, e = 0; for (let i = 1; i < 4000; i++){ d += (x[i] - x[i - 1]) ** 2; e += x[i] ** 2; } return d / e; };
    expect(hf(marimbaVoice('E4|h').samples)).toBeGreaterThan(hf(marimbaVoice('E4').samples) * 1.15);
    expect(marimba.voiceIds(marimba.demo.part)).toContain('E5|h');
    expect(marimba.voiceIds(marimba.demo.part)).toContain('E5');
  });
});

describe('marimba demo', () => {
  it('is a real phrase: runs, chords, long gaps, dynamics', () => {
    const p = marimba.demo.part;
    expect(p.length).toBeGreaterThan(30);
    const byBeat = {}; for (const e of p) (byBeat[e[0]] ||= []).push(e);
    expect(Object.values(byBeat).some(v => v.length >= 3)).toBe(true);           // a chord
    expect(new Set(p.map(e => e[2] ?? 1)).size).toBeGreaterThan(3);               // dynamics
    const lanes = lanesFor(p);
    expect(lanes.some(l => l.L.gaps.some(gp => gp < .2))).toBe(true);             // a dense roll
    expect(lanes.some(l => l.L.gaps.some(gp => gp > DT_MAX))).toBe(true);         // a magnet hold
  });
});
