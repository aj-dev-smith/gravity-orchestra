import { describe, it, expect } from 'vitest';
import { fitPart, organLane, laneAt, packetsAt, clearance, pipeGeom, layoutPipes, parseId, strikeIds, sinkDepth, tUp,
  g, RB, H_MAG, T_DOWN, S_MAX, DUR_MIN, GAP_MIN, IOI_MIN, MAX_DUR, SPEED, PACKETS, BELLOWS_R, PIPE_GAP, PART_LIMITS,
  SHORT_MAX, CONT_AT, XFADE } from '../src/instruments/organ/solve.js';
import * as THREE from 'three';
import { organVoice, SR, HOLD, LEN, C_HOLD } from '../src/instruments/organ/voice.js';
import organ from '../src/instruments/organ/index.js';
import { STATIONS } from '../src/instruments/stations.js';
import { noteHz, noteNum } from '../src/engine.js';

const START = -2.4, ROLL_T = 2.6;
/* a lane with every kind of gap: legato (RIDE), detached (HOP), long rest (PARK), a held note
   across the loop seam, and one long enough for the continuation voice */
const P = 16;
const N = [
  { t: 2.0, tDur: 1.0 }, { t: 3.08, tDur: .5 },        // gap .08 → ride
  { t: 3.98, tDur: .3 },                                // gap .4 → hop
  { t: 6.0, tDur: 4.8 },                                // gap 1.72 → park; held 4.8 s (continuation)
  { t: 11.4, tDur: .12 }, { t: 11.62, tDur: .2 },       // gaps .6 (hop), .1 (ride: re-press)
  { t: 14.5, tDur: 2.6 },                               // crosses the seam (ends at 1.1 next loop), gap .9 → park
].map(n => ({ ...n, vel: .8, timbre: 'organ', base: 'C3' }));
const L = organLane(N, P);
const lid = (t) => laneAt(L, t, START);
/* every strike that HAPPENS in the first ~2.5 loops (the seam-crossing note's previous-loop
   strike at 14.5 − P = −1.5 is after the count-in's start, so it is the lane's first) */
const STRIKES = [];
for (let k = -1; k < 3; k++) N.forEach((n, i) => { const t = n.t + k * P; if (t >= START) STRIKES.push({ t, i }); });
STRIKES.sort((a, b) => a.t - b.t);
const FIRST = STRIKES[0].t;
const abs = (k, i) => N[i].t + k * P;
const EPS = 1e-9;                                        // (sample just past the strike instant: the clock wraps in floats)

describe('organ geometry: a pure function of the note', () => {
  it('lower = taller and wider; the same note is the same pipe in any part', () => {
    const a = pipeGeom('C2'), b = pipeGeom('C4'), c = pipeGeom('C6');
    expect(a.body).toBeGreaterThan(b.body); expect(b.body).toBeGreaterThan(c.body);
    expect(a.r).toBeGreaterThan(b.r); expect(b.r).toBeGreaterThan(c.r);
    expect(a.body / c.body).toBeCloseTo(Math.pow(2, 2.2), 9);         // L ∝ f^-.55 over four octaves
    const one = layoutPipes(['E4']).pipes[0].G, many = layoutPipes(['C3', 'E4', 'G4', 'C5']).pipes.find(p => p.note === 'E4').G;
    expect(many).toEqual(one);
  });
  it('the façade: lowest pipe in the centre, alternating outward; never overlapping; lanes never touch', () => {
    for (const n of [1, 2, 7, 18, 36]){
      const notes = Array.from({ length: n }, (_, i) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][(i * 7) % 12] + (2 + Math.floor(i * 4 / 36)));
      const { pipes, span } = layoutPipes(notes);
      const byX = [...pipes].sort((p, q) => p.x - q.x);
      for (let i = 1; i < byX.length; i++){
        const dx = byX[i].x - byX[i - 1].x;
        expect(dx).toBeGreaterThanOrEqual(byX[i].G.r + byX[i - 1].G.r + PIPE_GAP - 1e-9);   // pipes clear
        expect(dx).toBeGreaterThanOrEqual(2 * BELLOWS_R + .04);                              // bellows + lids clear
        expect(dx).toBeGreaterThanOrEqual(2 * RB + .1);                                      // marbles clear
      }
      const lowest = [...pipes].sort((p, q) => noteNum(p.note) - noteNum(q.note))[0];
      expect(Math.abs(lowest.x - (byX[0].x - byX[0].G.r + byX[byX.length - 1].x + byX[byX.length - 1].G.r) / 2)).toBeLessThan(.6);
      expect(span).toBeLessThanOrEqual(STATIONS.organ.w - 1);
    }
  });
  it('the worst case (the 36 lowest pitches) still fits the loft', () => {
    const notes = Array.from({ length: 36 }, (_, i) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][i % 12] + (2 + Math.floor(i / 12)));
    expect(layoutPipes(notes).span).toBeLessThanOrEqual(STATIONS.organ.w - 1);
  });
});

describe('organ lane: honest strokes', () => {
  it('exercises every mode: ride, hop and park (and the armed drop)', () => {
    const modes = L.rec.map(r => r.mode);
    expect(modes).toContain('ride'); expect(modes).toContain('hop'); expect(modes).toContain('park');
    expect(lid(START).mode).toBe('armed');
    expect(FIRST).toBeCloseTo(14.5 - P, 12);
    expect(lid(FIRST - .1).mode).toBe('drop');
  });

  it('every note starts EXACTLY on the beat with the marble on the lid at its top, the lid at rest', () => {
    for (const { t: t0 } of STRIKES){
      const t = t0 + EPS;
      const s = lid(t);
      expect(s.mode).toBe('hold');
      expect(Math.abs(s.y)).toBeLessThan(1e-7); expect(Math.abs(s.lid)).toBeLessThan(1e-7);
      const b = lid(t0 - 1e-5);                           // just before: the lid stands still at the top…
      expect(Math.abs(b.lidV)).toBeLessThan(.05);
      expect(Math.abs(b.lid)).toBeLessThan(1e-5);
      expect(b.vy).toBeLessThanOrEqual(.05);             // …and the marble arrives moving DOWN into it (or rides it)
      expect(b.y - b.lid).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('the pipe speaks exactly while the bellows sinks: stroke s over the note, marble riding the lid', () => {
    for (let k = 0; k < 2; k++) N.forEach((n, i) => {
      const r = L.rec[i];
      for (const u of [.001, .25, .5, .75, .999]){
        const s = lid(abs(k, i) + u * r.dur + EPS);
        expect(s.sounding).toBe(true);
        expect(s.y).toBeCloseTo(s.lid, 12);
        expect(s.lid).toBeCloseTo(-r.s * u, 7);
        expect(s.lidV).toBeCloseTo(-r.s / r.dur, 9);
      }
      expect(lid(abs(k, i) + r.dur + 1e-6).sounding).toBe(false);
      expect(r.s).toBeCloseTo(sinkDepth(r.dur), 12);
    });
  });

  it('never penetrates: marble on/above the lid, never above the magnet face, over 2.3 loops', () => {
    let worst = Infinity, top = -Infinity;
    for (let t = START; t < START + 2.3 * P; t += .001){
      const s = lid(t);
      worst = Math.min(worst, s.y - s.lid); top = Math.max(top, s.y);
      expect(s.lid).toBeLessThanOrEqual(1e-9);
      expect(s.lid).toBeGreaterThanOrEqual(-S_MAX - 1e-9);
    }
    expect(worst).toBeGreaterThanOrEqual(-1e-9);
    expect(top).toBeLessThanOrEqual(H_MAG + 1e-9);
  });

  it('flights are free-fall (y″ = −g), the kick leaves the lid at v0, the lid brakes harder than g', () => {
    L.rec.forEach((r, i) => {
      if (r.mode === 'ride') return;
      const t0 = abs(1, i) + r.dur;
      const a = lid(t0 + 1e-7);
      expect(a.vy).toBeCloseTo(r.v0, 4); expect(a.lidV).toBeCloseTo(r.v0, 4);   // they leave TOGETHER: the lid kicks
      expect(r.aLid).toBeGreaterThan(g);
      expect(r.tLid).toBeLessThanOrEqual(r.D + 1e-9);                             // the lid is home before the landing
      for (const f of [.2, .5, .8]){
        const tau = f * (r.mode === 'hop' ? r.D : r.tUp), h = 1e-4, t = t0 + tau;
        const acc = (lid(t + h).y - 2 * lid(t).y + lid(t - h).y) / (h * h);
        expect(acc).toBeCloseTo(-g, 2);
        expect(clearance(L, i, tau)).toBeGreaterThan(0);
      }
    });
  });

  it('long gaps PARK on the magnet at zero speed; the release lands on the beat', () => {
    L.rec.forEach((r, i) => {
      if (r.mode !== 'park') return;
      const t0 = abs(1, i) + r.dur;
      const arrive = lid(t0 + r.tUp - 1e-6), held = lid(t0 + r.tUp + r.hold / 2);
      expect(arrive.y).toBeCloseTo(H_MAG, 4); expect(Math.abs(arrive.vy)).toBeLessThan(1e-3);
      expect(held.held).toBe(true); expect(held.vy).toBe(0); expect(held.y).toBe(H_MAG);
      expect(r.D - r.tUp - r.hold).toBeCloseTo(T_DOWN, 12);
    });
  });

  it('a HOP never reaches the magnet; the hop/park boundary is the arc that kisses it', () => {
    L.rec.forEach(r => {
      if (r.mode !== 'hop') return;
      expect(r.v0 * r.v0 / (2 * g) - r.s).toBeLessThanOrEqual(H_MAG + 1e-9);
      expect(r.D).toBeLessThanOrEqual(tUp(r.s) + T_DOWN + 1e-12);
    });
    const D = tUp(.3) + T_DOWN, v0 = (.3 + .5 * g * D * D) / D;
    expect(v0 * v0 / (2 * g) - .3).toBeCloseTo(H_MAG, 9);
  });

  it('nothing teleports: continuous through the count-in, landings, kicks, releases and the loop seam', () => {
    const dt = .0005;
    let prev = lid(START);
    for (let t = START + dt; t < START + 2.2 * P; t += dt){
      const s = lid(t);
      expect(Math.abs(s.y - prev.y)).toBeLessThan(12 * dt);     // ≤ 12 u/s anywhere (v0 ≈ 6.4 at most)
      expect(Math.abs(s.lid - prev.lid)).toBeLessThan(12 * dt);
      prev = s;
    }
  });

  it('is ARMED through the count-in: the marble hangs still on its magnet, the bellows full', () => {
    for (const t of [START, START + .25, FIRST - T_DOWN - .01]){
      const s = lid(t);
      expect(s.armed).toBe(true); expect(s.held).toBe(true); expect(s.y).toBe(H_MAG); expect(s.vy).toBe(0); expect(s.lid).toBe(0);
    }
    // the drop from the magnet lands the first note exactly
    const s = lid(FIRST - 1e-9);
    expect(s.y).toBeCloseTo(0, 6); expect(s.vy).toBeCloseTo(-g * T_DOWN, 4);
  });

  it('a pickup (negative beat) wraps into the loop and still arrives by the armed drop', () => {
    const { events } = fitPart([[-1, 'G3', .8, .5], [4, 'G3', .8, 1]], { rollT: ROLL_T, beat: .5, P: 12 });
    expect(events.map(e => e.t)).toEqual([2.1, 4.6]);
    const PL = organLane(events, 12);
    expect(laneAt(PL, 2.1 + EPS, START).mode).toBe('hold');
    expect(laneAt(PL, 2.1 - .05, START).mode).toBe('drop');
  });

  it('the light: one packet per note, its length = SPEED × duration, rising from the mouth', () => {
    const r = L.rec[6], t = abs(0, 6) + r.dur + .5;
    const pk = packetsAt(L, t, START);
    expect(pk.length).toBeLessThanOrEqual(PACKETS);
    expect(pk[0].front - pk[0].tail).toBeCloseTo(SPEED * r.dur, 9);
    expect(pk[0].tail).toBeCloseTo(SPEED * .5, 9);
    expect(packetsAt(L, FIRST - .01, START)).toEqual([]);     // nothing has sounded during the count-in
    // only notes that happened: just after the first note, ONE packet (not the previous loop's)
    expect(packetsAt(L, FIRST + .1, START).length).toBe(1);
  });
});

describe('lanes never interact', () => {
  it('each marble moves only vertically over its own bellows (x, z fixed per lane), lanes are independent', () => {
    const a = organLane([{ t: 3, tDur: 1, vel: 1, timbre: 'organ', base: 'C3' }], 12);
    const b = organLane([{ t: 3, tDur: 1, vel: 1, timbre: 'organ', base: 'C3' }], 12);
    for (let t = START; t < 20; t += .37) expect(laneAt(a, t, START)).toEqual(laneAt(b, t, START));
  });
});

describe('fitPart: imported parts degrade gracefully, never throw', () => {
  const T = { rollT: ROLL_T, beat: .5, P: 20 };
  it('survives garbage', () => {
    for (const part of [null, undefined, 'x', [], [null], [[NaN, 'C4']], [[0, 'H4']], [[0, 'E#4']], [[0, 'C4|kazoo']], [[0, 42]], [[0, 'C4', -1, -3]]])
      expect(() => fitPart(part, T)).not.toThrow();
    const { events, report } = fitPart([[0, 'C4', -1, -3], [1, 'nope'], [2, 'C4|kazoo']], T);
    expect(events.length).toBe(2); expect(events[0].vel).toBe(1); expect(events[0].tDur).toBeCloseTo(.5, 12);
    expect(events[1]).toMatchObject({ pitch: 'C4', timbre: 'organ' });       // an unknown timbre plays the organ
    expect(report.bad).toBe(1);
  });
  it('timbres via id suffix (+ aliases); the default is organ', () => {
    expect(parseId('C4')).toEqual({ pitch: 'C4', timbre: 'organ', base: 'C4' });
    expect(parseId('C#3|choir').base).toBe('C#3|choir');
    expect(parseId('A4|strings').timbre).toBe('pad');
    expect(parseId('A4|vox').timbre).toBe('choir');
  });
  it('folds out-of-range pitches by octaves into C2–C6', () => {
    const { events, report } = fitPart([[0, 'C1'], [1, 'G7'], [2, 'C4']], T);
    expect(events.map(e => e.pitch).sort()).toEqual(['C2', 'C4', 'G5'].sort());
    expect(report.folded).toBe(3);
    for (const e of events){ expect(noteNum(e.pitch)).toBeGreaterThanOrEqual(PART_LIMITS.lo); expect(noteNum(e.pitch)).toBeLessThanOrEqual(PART_LIMITS.hi); }
  });
  it('caps the pipes at 36, every pitch class kept', () => {
    const part = [];
    for (let m = 36; m <= 84; m++) part.push([m - 36, ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12] + (Math.floor(m / 12) - 1)]);
    const { events } = fitPart(part, { ...T, P: 40 });
    const pitches = new Set(events.map(e => e.pitch));
    expect(pitches.size).toBe(PART_LIMITS.pitches);
    expect(new Set([...pitches].map(p => noteNum(p) % 12)).size).toBe(12);
    expect(events.length).toBe(part.length);                   // folded, not dropped
  });
  it('per pipe: retriggers closer than IOI_MIN are thinned (seam too), strokes leave GAP_MIN', () => {
    const b = .05;                                             // a 20th of a second per beat: dense
    const part = [[0, 'C4', 1, 10], [1, 'C4'], [2, 'C4'], [3, 'C4', 1, 1], [5, 'C4', 1, 40], [97, 'C4']];
    const { events, report } = fitPart(part, { rollT: ROLL_T, beat: b, P: 5 });
    for (let i = 0; i < events.length; i++){
      const e = events[i], nx = events[(i + 1) % events.length], next = i + 1 < events.length ? nx.t : nx.t + 5;
      expect(next - e.t).toBeGreaterThanOrEqual(IOI_MIN - 1e-9);
      expect(e.t + e.tDur).toBeLessThanOrEqual(next - GAP_MIN + 1e-9);
      expect(e.tDur).toBeGreaterThanOrEqual(DUR_MIN);
    }
    expect(report.thinned).toBeGreaterThan(0);
  });
  it('durations clamp to [DUR_MIN, MAX_DUR]; a lone note leaves its own refill gap across the seam', () => {
    const { events } = fitPart([[0, 'C4', 1, 100]], { rollT: ROLL_T, beat: 1, P: 30 });
    expect(events[0].tDur).toBe(MAX_DUR);
    const { events: e2 } = fitPart([[0, 'C4', 1, 100]], { rollT: ROLL_T, beat: 1, P: 6 });
    expect(e2[0].tDur).toBeCloseTo(6 - GAP_MIN, 9);
  });
  it('≤ poly per onset (outer voices kept), ≤ maxEvents per loop', () => {
    const chord = Array.from({ length: 20 }, (_, i) => [0, ['C', 'D', 'E', 'F', 'G', 'A', 'B'][i % 7] + (3 + Math.floor(i / 7)), .5 + i / 100]);
    const { events } = fitPart(chord, T);
    expect(events.length).toBe(PART_LIMITS.poly);
    const ps = events.map(e => noteNum(e.pitch));
    expect(Math.min(...ps)).toBe(noteNum('C3')); expect(Math.max(...ps)).toBe(noteNum('A5'));
    const many = Array.from({ length: 2000 }, (_, i) => [i * .25, ['C4', 'E4', 'G4', 'B4'][i % 4], (i % 10) / 10 + .05]);
    const r = fitPart(many, { rollT: ROLL_T, beat: .5, P: 300 });
    expect(r.events.length).toBeLessThanOrEqual(PART_LIMITS.maxEvents);
  });
  it('a dense random MIDI-like part builds lanes that stay honest', () => {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const part = Array.from({ length: 900 }, () => [Math.floor(rnd() * 256) / 4, ['C', 'D', 'E', 'G', 'A'][Math.floor(rnd() * 5)] + (2 + Math.floor(rnd() * 4)), rnd(), rnd() * 6]);
    const Pd = 40;
    const { events } = fitPart(part, { rollT: ROLL_T, beat: .15, P: Pd });
    const lanes = new Map();
    for (const e of events) (lanes.get(e.pitch) || lanes.set(e.pitch, []).get(e.pitch)).push(e);
    for (const list of lanes.values()){
      const LL = organLane(list, Pd);
      for (let t = START; t < START + Pd + 3; t += .003){
        const s = laneAt(LL, t, START);
        expect(s.y - s.lid).toBeGreaterThanOrEqual(-1e-9);
        expect(s.y).toBeLessThanOrEqual(H_MAG + 1e-9);
        expect(Number.isFinite(s.y) && Number.isFinite(s.lid)).toBe(true);
      }
    }
  });
});

describe('organ voice', () => {
  const peak = a => { let p = 0; for (const x of a) p = Math.max(p, Math.abs(x)); return p; };
  const goertzel = (x, f, from, n) => { const w = 2 * Math.PI * f / SR, c = 2 * Math.cos(w); let s1 = 0, s2 = 0;
    for (let i = from; i < from + n; i++){ const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; } return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2); };
  it('renders each timbre deterministic, bounded, ending at exact zero', () => {
    for (const id of ['C2', 'A3', 'E5', 'C6', 'A3|choir', 'E5|choir', 'C3|pad', 'G5|pad']){
      const v = organVoice(id);
      expect(organVoice(id)).toBe(v);
      expect(v.sr).toBe(SR);
      expect(v.samples.length).toBe(Math.round(SR * LEN));
      expect(v.samples.length).toBeLessThan(6 * SR);
      const p = peak(v.samples);
      expect(p).toBeGreaterThan(.5); expect(p).toBeLessThanOrEqual(.9);
      expect(v.samples[v.samples.length - 1]).toBe(0);
      for (const x of v.samples) if (!Number.isFinite(x)) throw new Error('non-finite');
    }
  });
  it('SUSTAINS (an organ holds: the level at 4 s is within 3 dB of the level at 1 s), then releases', () => {
    for (const id of ['A3', 'A3|choir', 'A3|pad']){
      const x = organVoice(id).samples, rms = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
      const n = x.length, r1 = rms(SR * 1, SR * 1.2), r4 = rms(SR * 4, SR * 4.2), rEnd = rms(n - Math.round(SR * .1), n);
      expect(r4 / r1).toBeGreaterThan(.7); expect(r4 / r1).toBeLessThan(1.4);
      expect(rEnd).toBeLessThan(r4 * .1);
    }
  });
  it('sounds the note: the fundamental (or for the choir, its harmonic series) stands far above its neighbours', () => {
    for (const [id, k] of [['A3', 1], ['C5', 1], ['A3|pad', 1], ['A3|choir', 1]]){
      const x = organVoice(id).samples, f = noteHz(id.split('|')[0]) * k, n = Math.round(SR * .5), at = SR * 2;
      const on = goertzel(x, f, at, n), sharp = goertzel(x, f * Math.pow(2, 1 / 12), at, n), flat = goertzel(x, f / Math.pow(2, 1 / 12), at, n);
      expect(on).toBeGreaterThan(4 * sharp); expect(on).toBeGreaterThan(4 * flat);
    }
  });
  it('tiers: SHORT is the long render released at ~1 s; CONT is the same voice from CONT_AT, fading in', () => {
    const L4 = organVoice('E4').samples, S4 = organVoice('E4/s').samples, C4 = organVoice('E4/c').samples;
    expect(S4.length).toBeLessThan(1.5 * SR);
    for (let i = 0; i < SR; i += 997) expect(S4[i]).toBe(L4[i]);
    expect(Math.abs(S4[S4.length - 1])).toBe(0); expect(Math.abs(C4[C4.length - 1])).toBe(0); expect(Math.abs(C4[0])).toBe(0);
    expect(C4.length / SR).toBeCloseTo(C_HOLD + .7, 3);
  });
  it('the crossfade is matched: CONT at its start sounds like the LONG render at CONT_AT (level + brightness, every timbre)', () => {
    const rms = (x, i0, n) => { let q = 0; for (let i = i0; i < i0 + n; i++) q += x[i] * x[i]; return Math.sqrt(q / n); };
    const bright = (x, i0, n) => { let d = 0, q = 0; for (let i = i0 + 1; i < i0 + n; i++){ d += (x[i] - x[i - 1]) ** 2; q += x[i] * x[i]; } return Math.sqrt(d / q); };
    for (const id of ['C2', 'E4', 'A5', 'C3|pad', 'E5|pad', 'A3|choir', 'E5|choir']){
      const Lx = organVoice(id).samples, Cx = organVoice(id + '/c').samples;
      const n = Math.round(SR * .12), c = Math.round(SR * .15), a = Math.round(SR * CONT_AT) + c;   // the same instant of the performance
      const dB = 20 * Math.log10(rms(Cx, c, n) / rms(Lx, a, n));
      expect(Math.abs(dB)).toBeLessThan(id.includes('choir') ? 2 : .05);                                 // (choir vibrato / chorus beat: not identical, but matched)
      expect(Math.abs(Math.log(bright(Cx, c, n) / bright(Lx, a, n)))).toBeLessThan(.15);   // the pad's bloom has not reset
      let pk = 0; for (const v of Cx) pk = Math.max(pk, Math.abs(v));
      expect(pk).toBeLessThanOrEqual(.95);
    }
  });
  it('the continuation fires at CONT_AT under a held note — not at its strike', () => {
    const I = organ.make({ envMap: null, glowTex: null, THREE });
    const part = [[0, 'A2', .9, 8], [0, 'E4', .7, 1]], beat = .75, P = ROLL_T + 16 * beat + 1.2;
    I.build(part, { rollT: ROLL_T, beat, P, start: START, station: {}, floorY: -20 });
    const hits = [];
    for (let t = START; t < ROLL_T + 7; t += 1 / 60)
      I.update(t, P, 1 / 60, { started: t >= 0, skipStrikes: false, onStrike: h => hits.push({ t, ...h }) });
    const a2 = hits.filter(h => h.note.startsWith('A2'));
    expect(a2.map(h => h.note)).toEqual(['A2', 'A2/c']);
    expect(a2[1].t - a2[0].t).toBeGreaterThan(CONT_AT - .02);
    expect(a2[1].t - a2[0].t).toBeLessThan(CONT_AT + .05);
    expect(a2[0].dur + XFADE).toBeCloseTo(CONT_AT + XFADE, 6);               // the first voice releases as the continuation enters
    expect(a2[1].dur).toBeCloseTo(6 - CONT_AT, 6);                           // …which releases at the note's end (8 beats = 6 s)
    expect(hits.filter(h => h.note === 'E4~1').length).toBe(1);                // (a 1-beat .75 s note → the 1 s bucket)
  });
  it('the hold covers the stroke: a long note re-sources before the render runs out', () => {
    expect(CONT_AT + .12).toBeLessThan(HOLD);
    expect(CONT_AT + C_HOLD).toBeGreaterThanOrEqual(MAX_DUR);   // one continuation covers the longest note
    expect(SHORT_MAX).toBeLessThan(1.05);
    expect(strikeIds({ base: 'C4', tDur: .5 })).toEqual({ first: 'C4~0.5', cont: null });     // duration buckets (../sustain.js)
    expect(strikeIds({ base: 'C4|pad', tDur: 2 })).toEqual({ first: 'C4|pad~2', cont: null });
    expect(strikeIds({ base: 'C4|pad', tDur: 3.5 })).toEqual({ first: 'C4|pad', cont: null });  // nearer the LONG render's hold
    expect(strikeIds({ base: 'C4', tDur: 6 })).toEqual({ first: 'C4', cont: 'C4/c' });
  });
});

describe('organ demo + descriptor', () => {
  it('is a real chorale: chords (≥ 4 sounding), all three timbres, a held pedal past CONT_AT, beats in range', () => {
    const { demo } = organ;
    expect(demo.beats % 4).toBe(0);
    const b = 60 / demo.bpm;
    const timbres = new Set(demo.part.map(e => parseId(e[1]).timbre));
    expect([...timbres].sort()).toEqual(['choir', 'organ', 'pad']);
    let maxSound = 0;
    for (let q = 0; q < demo.beats; q += .25) maxSound = Math.max(maxSound, demo.part.filter(e => e[0] <= q && q < e[0] + e[3]).length);
    expect(maxSound).toBeGreaterThanOrEqual(5);
    expect(Math.max(...demo.part.map(e => e[3] * b))).toBeGreaterThan(CONT_AT + .1);
    // it fits without losing a note
    const P = ROLL_T + demo.beats * b + 1.2;
    const { events, report } = fitPart(demo.part, { rollT: ROLL_T, beat: b, P });
    expect(events.length).toBe(demo.part.length);
    expect(report.thinned + report.bad + report.droppedPitch).toBe(0);
  });
  it('the demo shows every mode: ride, hop and park', () => {
    const { demo } = organ, b = 60 / demo.bpm, P = ROLL_T + demo.beats * b + 1.2;
    const { events } = fitPart(demo.part, { rollT: ROLL_T, beat: b, P });
    const modes = new Set();
    const lanes = new Map();
    for (const e of events) (lanes.get(e.pitch) || lanes.set(e.pitch, []).get(e.pitch)).push(e);
    for (const list of lanes.values()) organLane(list, P).rec.forEach(r => modes.add(r.mode));
    expect([...modes].sort()).toEqual(['hop', 'park', 'ride']);
  });
  it('voiceIds (before any build) covers every id a strike can play, and the bake is quick', () => {
    const ids = organ.voiceIds(organ.demo.part);
    const b = 60 / organ.demo.bpm, P = ROLL_T + organ.demo.beats * b + 1.2;
    const { events } = fitPart(organ.demo.part, { rollT: ROLL_T, beat: b, P });
    for (const e of events){ const s = strikeIds(e); expect(ids).toContain(s.first); if (s.cont) expect(ids).toContain(s.cont); }
    const t0 = performance.now();
    for (const id of ids) organVoice(id);
    expect(performance.now() - t0).toBeLessThan(4000);         // (CI-loose; ~1 s on a laptop)
  });
  it('exports the routing limits as plain data', () => {
    expect(PART_LIMITS).toMatchObject({ lo: 36, hi: 84, pitches: 36, gap: IOI_MIN, sustain: true, maxDur: MAX_DUR, minDur: DUR_MIN });
    expect(Object.isFrozen(PART_LIMITS)).toBe(true);
    expect(STATIONS.organ.hang).toBe(true);
  });
});
