// SUSTAIN BUCKETS (src/instruments/sustain.js): a sustained plugin fires '<base>~<hold>' ids whose
// renders carry the release baked in, so the iOS <audio> path (no `dur` release — CLAUDE.md §5)
// stops near the note's end. Bucket choice, the id grammar, the cap, the cut itself, and every
// sustained plugin's strikes.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { bucketOf, bucketId, splitBucket, planLadder, bucketIds, allBucketIds, cutHold, relFor,
  LADDER, LADDERS, BUCKET_CAP } from '../src/instruments/sustain.js';
import organ from '../src/instruments/organ/index.js';
import bowwheel from '../src/instruments/bowwheel/index.js';
import horns from '../src/instruments/horns/index.js';
import dulcimer from '../src/instruments/dulcimer/index.js';
import bowls from '../src/instruments/bowls/index.js';
import { STATIONS } from '../src/instruments/stations.js';

describe('bucket choice', () => {
  it('picks the rung nearest in log time; the bare base when the native hold is nearer', () => {
    expect(bucketOf(.1, 4.5)).toBe(.5);                 // shorter than every rung → the shortest
    expect(bucketOf(.6, 4.5)).toBe(.5);
    expect(bucketOf(.75, 4.5)).toBe(1);                 // √(.5·1) ≈ .707 is the crossover
    expect(bucketOf(1.3, 4.5)).toBe(1);
    expect(bucketOf(1.5, 4.5)).toBe(2);
    expect(bucketOf(2.9, 4.5)).toBe(2);
    expect(bucketOf(3.1, 4.5)).toBe(0);                 // √(2·4.5) = 3 → nearer the base's own hold
    expect(bucketOf(9, 4.5)).toBe(0);
  });
  it('never picks a rung at or above the native hold (a short voice has fewer rungs)', () => {
    expect(bucketOf(1.9, 2)).toBe(0);
    expect(bucketOf(1.1, 1.2)).toBe(0);
    expect(bucketOf(.4, 1.2)).toBe(.5);
    expect(bucketOf(5, .4)).toBe(0);
  });
  it('a doubling ladder is never more than √2 off a note it buckets', () => {
    for (let d = .5; d < 2.8; d *= 1.013){
      const b = bucketOf(d, 4.5);
      if (b) expect(Math.abs(Math.log(d / b))).toBeLessThanOrEqual(Math.log(Math.SQRT2) + 1e-9);
    }
  });
  it('degenerate input → the base', () => {
    expect(bucketOf(0, 4)).toBe(0); expect(bucketOf(NaN, 4)).toBe(0); expect(bucketOf(1, 0)).toBe(0);
  });
});

describe('bucket ids', () => {
  it('round-trip through splitBucket, keeping timbre / tier / layer suffixes', () => {
    for (const base of ['C4', 'C4|choir', 'F#3|pad', 'E4:e:p', 'stab:D4']){
      for (const d of [.3, .9, 1.7]){
        const id = bucketId(base, d, 4.5), s = splitBucket(id);
        expect(s.base).toBe(base);
        expect(s.hold).toBe(bucketOf(d, 4.5));
        expect(id).toBe(`${base}~${s.hold}`);
      }
    }
    expect(splitBucket('C4')).toEqual({ base: 'C4', hold: 0 });
    expect(splitBucket('C4~x')).toEqual({ base: 'C4~x', hold: 0 });   // not a bucket
    expect(bucketId('C4', 4, 4.5)).toBe('C4');
  });
  it('planLadder coarsens until the bucket ids fit the cap, finest first', () => {
    const few = [['C4', .5], ['C4', 1], ['E4', 2]];
    expect(planLadder(few, () => 4.5)).toBe(LADDER);
    const many = [];
    for (let m = 0; m < 30; m++) for (const d of [.4, .9, 1.8]) many.push([`p${m}`, d]);
    const L = planLadder(many, () => 4.5, BUCKET_CAP);
    expect(LADDERS).toContain(L);
    expect(L.length).toBeLessThan(LADDER.length);
    expect(bucketIds(many, () => 4.5, L).filter(i => splitBucket(i).hold).length).toBeLessThanOrEqual(BUCKET_CAP);
    expect(planLadder(many, () => 4.5, 0)).toEqual([]);    // nothing fits → no buckets (bare bases, as before)
    expect(planLadder(many, () => 4.5, 0, LADDERS[2])).toBe(LADDERS[2]);   // … unless the plugin keeps a floor rung
  });
  it('a dense multi-timbre organ part keeps its staccato bucket (never below the old /s tier)', () => {
    // 36 pipes × 3 timbres, all staccato: one rung alone is > BUCKET_CAP ids — the organ floors at it
    const part = [];
    for (let i = 0; i < 108; i++) part.push([i * .5, ['C', 'D', 'E', 'F', 'G', 'A'][i % 6] + (2 + Math.floor(i / 6) % 4) + ['', '|choir', '|pad'][Math.floor(i / 36)], .8, .5]);
    const beat = .6, ids = organ.voiceIds(part, { beat, bpm: 100, rollT: 2.6, P: 2.6 + 64 * beat + 1.2, loopBeats: 64 });
    expect(ids.filter(i => !splitBucket(i).hold)).toEqual([]);   // every strike a bucket (a ~.3 s note), none the 5.2 s LONG
  });
  it('allBucketIds is each base + every rung below its native hold', () => {
    expect(allBucketIds(['C4', 'E2'], b => b === 'C4' ? 4 : 1.5).sort()).toEqual(['C4', 'C4~0.5', 'C4~1', 'C4~2', 'E2', 'E2~0.5', 'E2~1'].sort());
  });
});

describe('cutHold', () => {
  const sr = 8000, base = new Float32Array(sr * 4).map((_, i) => Math.sin(i * .05) * .7);
  it('is the base, untouched, up to the hold — then a release to exactly 0', () => {
    const c = cutHold(base, sr, 1, .3);
    expect(c.length).toBe(Math.round(sr * 1.3));
    for (let i = 0; i < sr; i++) if (c[i] !== base[i]) throw new Error(`sample ${i} changed`);
    expect(c[c.length - 1]).toBe(0);
    let prevEnv = 1;                                       // the release envelope only falls
    for (let i = sr; i < c.length - 1; i++){ const u = (i - sr) / (c.length - 1 - sr), e = Math.exp(-3 * u) * (1 - u * u); expect(e).toBeLessThanOrEqual(prevEnv + 1e-12); prevEnv = e; }
    expect(Math.abs(c[sr] - base[sr])).toBeLessThan(1e-7);     // continuous at the hold
  });
  it('a hold past the render is the render itself', () => {
    expect(cutHold(base, sr, 3.9, .3)).toBe(base);
  });
  it('relFor: short holds stop quickly, never past the voice\'s own release', () => {
    expect(relFor(.5, .7)).toBeCloseTo(.33, 6);
    expect(relFor(2, .42)).toBe(.42);
    expect(relFor(4, .3)).toBe(.3);
  });
});

// every sustained plugin: the strike fires the bucket nearest the note, its sample stops there
const ROLL_T = 2.6, START = -2.4;
const ctxOf = (bpm, beats) => { const beat = 60 / bpm; return { beat, bpm, rollT: ROLL_T, P: ROLL_T + beats * beat + 1.2, loopBeats: beats }; };
const PLUGINS = { organ, bowwheel, horns, dulcimer, bowls };
describe.each(Object.entries(PLUGINS))('%s duration buckets', (key, I) => {
  const fire = (part, ctx) => {
    const M = I.make({ envMap: null, glowTex: null, THREE });
    M.build(part, { rollT: ROLL_T, beat: ctx.beat, P: ctx.P, start: START, station: STATIONS[key], floorY: -20, ceilY: 30, loopBeats: ctx.loopBeats });
    const hits = [];
    for (let t = START; t < 2 * ctx.P; t += 1 / 60) M.update(t, ctx.P, 1 / 60, { started: t >= 0, skipStrikes: false, onStrike: h => hits.push(h) });
    return hits;
  };
  it('the demo fires bucket ids, each near its note (≤ √2 off, or the shortest rung), all baked', () => {
    for (const bpm of [I.demo.bpm, 60]){
      const ctx = ctxOf(bpm, I.demo.beats), ids = new Set(I.voiceIds(I.demo.part, ctx)), hits = fire(I.demo.part, ctx);
      const bucketed = hits.filter(h => splitBucket(h.note).hold);
      expect(bucketed.length, `${key} @${bpm}`).toBeGreaterThan(0);
      for (const h of hits) expect(ids.has(h.note), `${key} fires ${h.note}`).toBe(true);
      for (const h of bucketed){
        const b = splitBucket(h.note).hold;
        const top = LADDER[LADDER.length - 1];
        if (h.dur <= LADDER[0]) expect(b).toBe(LADDER[0]);
        else if (h.dur <= top * Math.SQRT2) expect(Math.abs(Math.log(h.dur / b)), `${h.note} for ${h.dur.toFixed(2)} s`).toBeLessThanOrEqual(Math.log(Math.SQRT2) + 1e-6);
        else expect(b, `${h.note} for ${h.dur.toFixed(2)} s`).toBe(top);   // past the top rung, still nearer it than the base's own hold
      }
    }
  });
  it('a bucket\'s sample is its base\'s, cut: same start, shorter, ends at exactly 0, rings ≤ hold + .6 s', () => {
    const ctx = ctxOf(I.demo.bpm, I.demo.beats);
    for (const id of I.voiceIds(I.demo.part, ctx)){
      const { base, hold } = splitBucket(id);
      if (!hold) continue;
      const v = I.voice(id), B = I.voice(base);
      expect(v.sr).toBe(B.sr);
      expect(v.samples.length, id).toBeLessThan(B.samples.length);
      expect(v.samples.length / v.sr, id).toBeLessThanOrEqual(hold + .6 + 1e-3);           // (the longest baked release: a tuba's exhale)
      expect(v.samples[v.samples.length - 1]).toBe(0);
      if (key !== 'horns'){                                 // (horns render the exhale natively)
        const n = Math.round(v.sr * hold * .9);
        let d = 0; for (let i = 0; i < n; i++) d = Math.max(d, Math.abs(v.samples[i] - B.samples[i]));
        expect(d, id).toBeLessThan(1e-6);
      } else {                                              // same performance, level-matched
        let pv = 0, pb = 0; for (const x of v.samples) pv = Math.max(pv, Math.abs(x)); for (const x of B.samples) pb = Math.max(pb, Math.abs(x));
        expect(Math.abs(20 * Math.log10(pv / pb)), id).toBeLessThan(1.5);
      }
    }
  });
  it('voiceHz (when given) reads the pitch through the suffix', () => {
    if (!I.voiceHz) return;
    expect(I.voiceHz('A4~0.5')).toBeCloseTo(440, 3);
    expect(I.voiceHz('A4|choir~2')).toBeCloseTo(440, 3);
  });
  it('a dense import stays inside the cap (the ladder coarsens; build and voiceIds agree)', () => {
    const part = [];
    let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 260; i++) part.push([+(r() * 63.5).toFixed(2), ['C', 'D', 'E', 'F', 'G', 'A', 'B'][i % 7] + (3 + (i % 3)), .5 + .5 * r(), +(.2 + r() * 5).toFixed(2)]);
    const ctx = ctxOf(100, 64), ids = I.voiceIds(part, ctx);
    expect(ids.filter(i => splitBucket(i).hold).length).toBeLessThanOrEqual(BUCKET_CAP);
    const set = new Set(ids);
    for (const h of fire(part, ctx)) expect(set.has(h.note), `${key} fires ${h.note}`).toBe(true);
  });
});
