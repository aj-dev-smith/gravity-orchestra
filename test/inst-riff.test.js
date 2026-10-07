import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { normalizeHits, voiceIdsFor, solveRiff, stampAt, carriageAt, muteAt, ringAt, hitAt, stringDrop, strikeSurface, crossBottom,
         pressX, fretX, vibLen, strZ, gauge, strTop, OPEN, STRINGS, MAX_FRET, NUT_X, BRIDGE_X, STAMP_X, stampX, MUTE_X, STR_DZ, HEAD_R,
         MUTE_R, HOOK_W, V_IN, E, H_PARK, T_PARK, T_DN, SETTLE, MIN_GAP, PART_LIMITS, LO, HI, FRET_H } from '../src/instruments/riff/solve.js';
import { riffVoice, parseId, makeId, SR } from '../src/instruments/riff/voice.js';
import { noteNum } from '../src/engine.js';
import riff from '../src/instruments/riff/index.js';

const START = -2.4;
const timing = (bpm, beats) => { const beat = 60 / bpm; return { rollT: 2.6, beat, P: 2.6 + beats * beat + 1.2 }; };

/* ---- fixtures (ORIGINAL / synthetic — never a downloaded MIDI) ---- */
const DEMO = { part: riff.demo.part, ...timing(riff.demo.bpm, riff.demo.beats) };
// a thrash rhythm riff at 220 bpm: palm-muted 8th chugs on E (same pitch every .136 s), power-chord stabs,
// a chromatic run — the shape of the fast riffs the machine exists for
const THRASH = (() => {
  const p = [], P5 = r => [r, r + 7, r + 12];
  const nm = m => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12] + (Math.floor(m / 12) - 1);
  for (let bar = 0; bar < 8; bar++){
    const b = bar * 4;
    for (let k = 0; k < 6; k++) p.push([b + k * .5, 'E2:m', .7]);
    for (const m of P5([43, 46, 45, 44][bar % 4])) p.push([b + 3, nm(m), 1, .5]);
    for (const m of P5(bar % 2 ? 47 : 41)) p.push([b + 3.5, nm(m), .95, .5]);
  }
  return { part: p, ...timing(220, 32) };
})();
// a lead lick: 16ths at 140 bpm (.107 s), single notes up the neck
const LEAD = (() => {
  const line = ['E4', 'G4', 'A4', 'B4', 'D5', 'E5', 'D5', 'B4', 'A4', 'G4', 'E4', 'D4', 'B3', 'A3', 'G3', 'E3'];
  return { part: line.map((n, i) => [i * .25, n, .8, .25]).concat([[6, 'E2'], [6, 'B2'], [6, 'E3'], [-.5, 'B3', .7]]), ...timing(140, 8) };
})();
// junk + density: 1500 random events over 16 beats, notes way outside the range, chords too wide to voice
const DENSE = (() => {
  let s = 12345; const r = () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
  const p = [];
  for (let i = 0; i < 1500; i++){
    const m = 20 + Math.floor(r() * 90);
    p.push([Math.floor(r() * 16 * 16) / 16, ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12] + (Math.floor(m / 12) - 1), r(), r() < .5 ? .2 : 1]);
  }
  p.push([3, 'nonsense'], [4, null], ['x', 'E2'], 'garbage');
  return { part: p, ...timing(160, 16) };
})();
const FIX = { demo: DEMO, thrash: THRASH, lead: LEAD };
const solved = Object.fromEntries(Object.entries({ ...FIX, dense: DENSE }).map(([k, f]) => [k, solveRiff(f.part, f)]));

describe('riff hits (tempo-free normalisation)', () => {
  it('groups simultaneous events into one chord id, low → high, with flags', () => {
    const h = normalizeHits([[0, 'E3'], [0, 'E2'], [0, 'B2'], [1, 'E2:m'], [2, 'G3:c', .5], [3, 'A2', 1, .25], [3.001, 'E3', 1, .25]]);
    expect(h.map(x => x.id)).toEqual(['E2+B2+E3', 'E2:m', 'G3:c', 'A2+E3:m']);   // durBeats ≤ .3 on every note → palm mute
    expect(parseId('E2+B2+E3:cm')).toEqual({ notes: ['E2', 'B2', 'E3'], mute: true, clean: true });
    expect(makeId(['E2'], { mute: true })).toBe('E2:m');
  });
  it('folds out-of-range notes by octaves; a chord the strings cannot voice keeps root + top', () => {
    const h = normalizeHits([[0, 'C1'], [1, 'C8'], [2, 'E2'], [2, 'F2'], [2, 'B2']]);
    expect(h[0].notes[0]).toBeGreaterThanOrEqual(LO); expect(h[1].notes[0]).toBeLessThanOrEqual(HI);
    expect(h[2].id).toBe('E2+B2');                        // E2 + F2 both live only on the low E string
    expect(h[2].dropped).toBe(1);
    const wide = normalizeHits(['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4'].map(n => [0, n]))[0];
    expect(wide.notes.length).toBeLessThanOrEqual(STRINGS);
    expect(wide.notes[0]).toBe(noteNum('C3')); expect(wide.notes[wide.notes.length - 1]).toBe(noteNum('C4'));
  });
  it('voiceIds(part) is exactly what the machine fires (any tempo)', () => {
    for (const f of [DEMO, THRASH, LEAD]){
      const R = solveRiff(f.part, f);
      expect(new Set(R.hits.map(h => h.id))).toEqual(new Set(voiceIdsFor(f.part)));
      expect(new Set(solveRiff(f.part, { ...f, beat: f.beat * 1.7, P: f.P * 1.7 }).hits.map(h => h.id))).toEqual(new Set(voiceIdsFor(f.part)));
    }
  });
  it('degrades, never crashes: junk, density, the event cap', () => {
    const R = solved.dense;
    expect(R.hits.length).toBeLessThanOrEqual(PART_LIMITS.maxEvents);
    expect(R.hits.length).toBeGreaterThan(100);
    expect(solveRiff([], DEMO).hits.length).toBe(0);
    expect(normalizeHits(Array.from({ length: 900 }, (_, i) => [i / 8, 'E2'])).length).toBe(PART_LIMITS.maxEvents);
  });
  it('PART_LIMITS describes the machine (for the orchestrator)', () => {
    expect(PART_LIMITS).toMatchObject({ lo: 40, hi: 84, poly: 6, gap: MIN_GAP, strings: 6 });
    expect(PART_LIMITS.programs).toEqual([27, 28, 29, 30]);
  });
});

describe.each(Object.keys(FIX))('riff fingering "%s"', key => {
  const R = solved[key];
  it('every note is on a real string + fret, one note per string per hit', () => {
    for (const h of R.hits){
      const used = new Set();
      for (const a of h.asg){
        expect(OPEN[a.s] + a.f).toBe(a.m);
        expect(a.f).toBeGreaterThanOrEqual(0); expect(a.f).toBeLessThanOrEqual(MAX_FRET);
        expect(used.has(a.s)).toBe(false); used.add(a.s);
      }
      expect(h.asg.length).toBe(h.notes.length);
    }
  });
  it('is inside the drive limits: no carriage overrun, no stamp re-strike under MIN_GAP', () => {
    expect(R.stats.viol).toBe(0);
    expect(R.stats.carOver).toBe(0);
    for (const S of R.strings) for (const g of S.L.gaps) expect(g).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
  });
});

describe.each(Object.keys(FIX))('riff honesty "%s"', key => {
  const R = solved[key], P = R.P;
  it('the stamp lands EXACTLY on the beat, moving into the string at V_IN; rebounds lossy at e·V_IN', () => {
    for (const S of R.strings) for (const s of S.L.s) for (const loop of [0, 1, 3]){
      const t = s + loop * P;
      const at = stampAt(S, t + 1e-9, START), before = stampAt(S, t - 1e-7, START), after = stampAt(S, t + 1e-7, START);
      expect(Math.abs(at.y)).toBeLessThan(1e-6);
      expect(before.vy).toBeCloseTo(-V_IN, 3);
      expect(after.vy).toBeCloseTo(E * V_IN, 3);
      expect(before.y).toBeGreaterThanOrEqual(0);
    }
  });
  it('at rest at contact: string ring tapered to 0, hook pressed and still on its fret (lifted for an open string), mute bar settled', () => {
    for (const S of R.strings) for (const e of S.ev) for (const loop of [1, 2]){
      const t = e.t + loop * P;
      expect(ringAt(S, t - 1e-4, START).a).toBeLessThan(1e-5);
      for (const dt of [1e-4, SETTLE * .5]){
        const c = carriageAt(S, t - dt, START);
        if (e.f > 0){
          expect(c.p, `s${S.s} f${e.f} @${t}`).toBeCloseTo(1, 9);
          expect(c.x).toBeCloseTo(pressX(e.f), 9);
          expect(Math.abs(c.vx) + Math.abs(c.vp)).toBeLessThan(1e-9);
        } else expect(c.p, `s${S.s} open @${t}`).toBeLessThan(1e-9);
      }
    }
    for (const h of R.hits) for (const loop of [1, 2]){
      const m = muteAt(R.bar, h.t + loop * P - 1e-4, START);
      expect(m.d).toBeCloseTo(h.mute ? 1 : 0, 9);
      expect(Math.abs(m.vd)).toBeLessThan(1e-9);
    }
  });
  it('no penetration: the head never below the string top or above its latch; the hook never cuts the string', () => {
    for (const S of R.strings){
      for (let t = START; t < START + 2.2 * P; t += .001){
        const p = stampAt(S, t, START);
        expect(p.y).toBeGreaterThanOrEqual(-1e-9);
        expect(p.y).toBeLessThanOrEqual(H_PARK + 1e-9);
        const c = carriageAt(S, t, START);
        expect(c.p).toBeGreaterThanOrEqual(-1e-9); expect(c.p).toBeLessThanOrEqual(1 + 1e-9);
        // the crossbar's bottom is never below the (pushed) string top under it
        expect(crossBottom(S.s, c.p) - (strTop(S.s) - stringDrop(S.s, c.x, c))).toBeGreaterThanOrEqual(-1e-9);
        // the pressed string never sinks below its fret wires
        expect(strTop(S.s) - stringDrop(S.s, c.x, c) - 2 * gauge(S.s)).toBeGreaterThanOrEqual(FRET_H - 1e-9);
      }
    }
  });
  it('is continuous: nothing teleports — count-in → first strike, every phase, the loop seam', () => {
    const dt = 5e-4;
    for (const S of R.strings){
      let a = stampAt(S, START, START), c = carriageAt(S, START, START), sf = strikeSurface(S.s, c);
      for (let t = START + dt; t < START + 2 * P + .5; t += dt){
        const b = stampAt(S, t, START), d = carriageAt(S, t, START), sg = strikeSurface(S.s, d);
        expect(Math.abs(b.y + sg - a.y - sf), `head jump s${S.s} @${t.toFixed(4)} ${a.mode}→${b.mode}`).toBeLessThan(40 * dt);
        expect(Math.abs(d.x - c.x), `carriage jump s${S.s} @${t.toFixed(4)}`).toBeLessThan(120 * dt);
        expect(Math.abs(d.p - c.p), `hook jump s${S.s} @${t.toFixed(4)}`).toBeLessThan(200 * dt);
        a = b; c = d; sf = sg;
      }
    }
    let m = muteAt(R.bar, START, START);
    for (let t = START + dt; t < START + 2 * P + .5; t += dt){ const n = muteAt(R.bar, t, START); expect(Math.abs(n.d - m.d)).toBeLessThan(40 * dt); m = n; }
  });
  it('is ARMED during the count-in: stamps on the latch, hooks still over their first fret', () => {
    for (const S of R.strings){
      if (!S.n) continue;
      const p = stampAt(S, START, START);
      expect(p.armed).toBe(true);
      if (p.until > T_DN){ expect(p.mode).toBe('hold'); expect(p.y).toBe(H_PARK); }
      const c0 = carriageAt(S, START, START), c1 = carriageAt(S, START + .05, START);
      if (c1.armed){ expect(c1.x).toBe(c0.x); expect(c1.p).toBe(c0.p); }
      // the armed drive ≡ the steady-state drive when the seam's gap parks the stamp
      const first = START + p.until, wrapGap = S.L.gaps[S.L.gaps.length - 1];
      if (wrapGap > T_PARK && p.until > T_DN){
        const x = stampAt(S, first - .1, START), y = stampAt(S, first - .1 + P, START);
        expect(x.y).toBeCloseTo(y.y, 9);
      }
    }
  });
});

describe('riff stamp modes', () => {
  it('long gaps PARK on the latch at zero speed; dense gaps fly a solved hop — both in the demo', () => {
    const modes = new Set();
    for (const S of solved.demo.strings) for (let t = 0; t < solved.demo.P; t += .002) modes.add(stampAt(S, t + solved.demo.P, START).mode);
    expect([...modes].sort()).toEqual(['arc', 'drive', 'hold', 'rise']);
    // at the latch: zero speed
    const S = solved.demo.strings.find(S => S.L.gaps.some(g => g > T_PARK));
    const k = S.L.gaps.findIndex(g => g > T_PARK), t = S.L.s[k] + .24 + solved.demo.P;
    expect(Math.abs(stampAt(S, t - 1e-7, START).vy)).toBeLessThan(1e-3);
    expect(stampAt(S, t + 1e-3, START).mode).toBe('hold');
  });
  it('apex height grows with the gap (rhythm reads as height)', () => {
    const apex = g => { const S = { L: { s: [0, g], gaps: [g, 10 - g], P: 10 } }; let m = 0; for (let t = 0; t < g; t += g / 400) m = Math.max(m, stampAt(S, t + 10).y); return m; };
    expect(apex(.07)).toBeLessThan(apex(.136)); expect(apex(.136)).toBeLessThan(apex(.3));
    expect(apex(.136)).toBeGreaterThan(.25);                // a chug is a visible hop, not a buzz
  });
  it('a pickup (negative beat) wraps into the loop', () => {
    const R = solved.lead, h = R.hits.find(h => h.beat === -.5);
    expect(h.t).toBeCloseTo(((2.6 - .5 * LEAD.beat) % R.P + R.P) % R.P, 9);
  });
});

describe('riff geometry: lanes never interact; the note alone sets the shape', () => {
  it('strings are slabs: no head, hook or ring reaches a neighbour', () => {
    expect(HEAD_R + .02).toBeLessThan(STR_DZ / 2);
    expect(HOOK_W / 2 + .03).toBeLessThan(STR_DZ - gauge(0));
    expect(.045 + gauge(0)).toBeLessThan(STR_DZ / 2);       // the widest lateral ring stays in its slab
    for (let s = 1; s < STRINGS; s++) expect(strZ(s) - strZ(s - 1)).toBeCloseTo(STR_DZ, 12);
  });
  it('the x bands never overlap: carriages | stamps | mute bar | bridge', () => {
    expect(pressX(MAX_FRET) + .21).toBeLessThan(stampX(0) - HEAD_R);
    expect(stampX(STRINGS - 1) + HEAD_R).toBeLessThan(MUTE_X - MUTE_R);
    expect(MUTE_X + MUTE_R).toBeLessThan(BRIDGE_X - .1);
    expect(pressX(0)).toBeGreaterThan(NUT_X);
  });
  it('the pitch IS the position: luthier frets, vibrating length ∝ 1/f, the same note on a string always stops in the same place', () => {
    for (let s = 0; s < STRINGS; s++) for (let f = 0; f <= MAX_FRET; f++){
      expect(vibLen(OPEN[s] + f, s) / vibLen(OPEN[s], s)).toBeCloseTo(Math.pow(2, -f / 12), 12);
      if (f) expect(fretX(f)).toBeGreaterThan(fretX(f - 1));
    }
    // across different parts and tempi, a (string, fret) always sits at the same x
    const xs = new Map();
    for (const R of Object.values(solved)) for (const S of R.strings) for (const e of S.ev) if (e.f > 0){
      const k = `${S.s}:${e.f}`; if (xs.has(k)) expect(e.X).toBe(xs.get(k)); else xs.set(k, e.X);
    }
  });
  it('the dense junk part still solves to a continuous machine (degrades gracefully)', () => {
    const R = solved.dense, dt = 1e-3;
    for (const S of R.strings){
      let a = carriageAt(S, START, START), b = stampAt(S, START, START);
      for (let t = START + dt; t < START + 1.2 * R.P; t += dt){
        const c = carriageAt(S, t, START), d = stampAt(S, t, START);
        expect(Number.isFinite(c.x) && Number.isFinite(c.p) && Number.isFinite(d.y)).toBe(true);
        // an overrun may be superhuman, but the machine stays on its neck, above its strings, under its latch
        expect(c.x).toBeGreaterThan(NUT_X); expect(c.x).toBeLessThan(stampX(0) - HEAD_R);
        expect(d.y).toBeGreaterThanOrEqual(-1e-9); expect(d.y).toBeLessThanOrEqual(H_PARK + 1e-9);
        a = c; b = d;
      }
    }
  });
});

describe('riff render (headless build + update)', () => {
  it('fires each hit once per loop with its baked id, inside the station; constant mesh/material count', () => {
    const inst = riff.make({ envMap: null, glowTex: null, THREE });
    const g = inst.build(DEMO.part, { ...DEMO, start: START, station: { w: 13, d: 6 }, floorY: -1 });
    const count = () => { let m = 0; const mats = new Set(); g.traverse(o => { if (o.isMesh || o.isSprite){ m++; mats.add(o.material); } }); return [m, mats.size]; };
    const before = count();
    expect(before[0]).toBeLessThanOrEqual(150);
    const fired = [];
    for (let t = START; t < START + DEMO.P; t += 1 / 60) inst.update(t, DEMO.P, 1 / 60, { started: true, skipStrikes: false, onStrike: h => fired.push(h) });
    const R = solveRiff(DEMO.part, DEMO);
    expect(fired.length).toBe(R.hits.length);
    const ids = new Set(voiceIdsFor(DEMO.part));
    for (const h of fired){ expect(ids.has(h.note)).toBe(true); expect(Number.isFinite(h.dur) && h.dur > 0).toBe(true); }
    expect(count()).toEqual(before);
    g.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(g);
    expect(b.min.x).toBeGreaterThanOrEqual(-6.5 - 1e-6); expect(b.max.x).toBeLessThanOrEqual(6.5 + 1e-6);
    expect(b.min.z).toBeGreaterThanOrEqual(-3 - 1e-6); expect(b.max.z).toBeLessThanOrEqual(3 + 1e-6);
  });
});

describe('riff voice', () => {
  const ids = voiceIdsFor(DEMO.part);
  it('bakes the whole demo fast (every unique hit is pre-rendered on song load)', () => {
    const t0 = performance.now();
    for (const id of ids) riffVoice(id);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
  it.each(ids.concat(['E2+B2+E3:c', 'A3:c', 'E2:cm']))('"%s": deterministic, peak in (.5, .9], ends at exactly 0, ≤ 2 s, decays', id => {
    const a = riffVoice(id), b = riffVoice(id);
    expect(a).toBe(b);
    const x = a.samples;
    let pk = 0; for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
    expect(pk).toBeGreaterThan(.5); expect(pk).toBeLessThanOrEqual(.9);
    expect(x[x.length - 1]).toBe(0);
    expect(x.length).toBeLessThanOrEqual(2 * a.sr);
    const rms = (i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += x[i] * x[i]; return Math.sqrt(s / (i1 - i0)); };
    const n = x.length;
    expect(rms(Math.floor(n * .8), n)).toBeLessThan(rms(0, Math.floor(n * .2)));
  });
  it('a palm mute is a short chug; an open chord rings', () => {
    expect(riffVoice('E2:m').samples.length).toBeLessThan(riffVoice('E2').samples.length / 3);
  });
  it('the pitch is the note (clean channel, autocorrelation)', () => {
    for (const [id, hz] of [['E2:c', 82.41], ['A3:c', 220], ['E4:c', 329.63]]){
      const { samples: x, sr } = riffVoice(id);
      const i0 = Math.round(.08 * sr), N = Math.round(.25 * sr);
      let best = 0, lag = 0;
      for (let L = Math.round(sr / 500); L < Math.round(sr / 60); L++){
        let s = 0; for (let i = 0; i < N; i++) s += x[i0 + i] * x[i0 + i + L];
        if (s > best){ best = s; lag = L; }
      }
      const f = sr / lag;
      // the strongest period may be the fundamental or (for a bright string) twice it — allow an octave alias
      const cents = Math.min(...[1, 2].map(k => Math.abs(1200 * Math.log2(f * k / hz))));
      expect(cents, `${id} → ${f.toFixed(1)} Hz`).toBeLessThan(40);
    }
    expect(SR).toBeGreaterThanOrEqual(22050);
  });
});
