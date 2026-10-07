import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { normalizeHits, voiceIdsFor, solvePogo, pogoAt, carriageAt, ringAt, pumpOf, stringDrop, strikeSurface, crossBottom, magnetFace,
         pressX, fretX, vibLen, strZ, gauge, strTop, OPEN, STRINGS, MAX_FRET, NUT_X, BRIDGE_X, stampX, STR_DZ, STAMP_DX, HOOK_W,
         FOOT_R, POGO_TOP, H_MAG, DT_MAX, E, g, SETTLE, MIN_GAP, PART_LIMITS, LO, HI, FRET_H, PUMP_MAX, PUMP_K, PLUNGE,
         flagOf, makeId } from '../src/instruments/pogo/solve.js';
import { pogoVoice, parseId, SR } from '../src/instruments/pogo/voice.js';
import { noteNum, noteHz } from '../src/engine.js';
import { STATIONS } from '../src/instruments/stations.js';
import pogo from '../src/instruments/pogo/index.js';

const START = -2.4;
const timing = (bpm, beats) => { const beat = 60 / bpm; return { rollT: 2.6, beat, P: 2.6 + beats * beat + 1.2 }; };
const NM = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nm = m => NM[m % 12] + (Math.floor(m / 12) - 1);

/* ---- fixtures (ORIGINAL / synthetic — never a downloaded MIDI) ---- */
const DEMO = { part: pogo.demo.part, ...timing(pogo.demo.bpm, pogo.demo.beats) };
// a thrash bass line at 220 bpm: 8th-note E1 chugs (the same pitch every .136 s), a chromatic walk on
// the off-bar, octave pops — the shape of the fast rock bass the machine exists for
const ROCK = (() => {
  const p = [];
  for (let bar = 0; bar < 8; bar++){
    const b = bar * 4;
    for (let k = 0; k < 6; k++) p.push([b + k * .5, 'E1', k % 2 ? .7 : .9, .45]);
    const walk = [[31, 33], [34, 35], [33, 31], [36, 38]][bar % 4];
    p.push([b + 3, nm(walk[0]), .95, .45], [b + 3.5, nm(walk[1]), .9, .45]);
  }
  return { part: p, ...timing(220, 32) };
})();
// a slap groove at 100 bpm with 16th ghost notes, octave pops and a double stop, a pickup into the top
const SLAP = (() => {
  const p = [];
  for (let bar = 0; bar < 4; bar++){
    const b = bar * 4;
    p.push([b, 'E1:s', 1, .4], [b + .75, 'E2:s', .9, .2], [b + 1.5, 'E1:s', .8, .2], [b + 1.75, 'E1:s', .6, .2],
           [b + 2, 'G1:s', 1, .4], [b + 2.5, 'G2:s', .85, .2], [b + 3, 'A1:s', 1, .3], [b + 3.5, 'A2:s', .9, .3]);
  }
  p.push([12, 'D2', .8, 2], [12, 'A2', .8, 2], [-.5, 'B1:p', .8, .5]);
  return { part: p, ...timing(100, 16) };
})();
// junk + density: 1200 random events, notes far outside the range, chords too wide to voice
const DENSE = (() => {
  let s = 4242; const r = () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
  const p = [];
  for (let i = 0; i < 1200; i++){ const m = 12 + Math.floor(r() * 80); p.push([Math.floor(r() * 16 * 16) / 16, nm(m) + (r() < .2 ? ':s' : ''), r(), r() < .5 ? .2 : 1]); }
  p.push([3, 'nonsense'], [4, null], ['x', 'E2'], 'garbage');
  return { part: p, ...timing(160, 16) };
})();
const FIX = { demo: DEMO, rock: ROCK, slap: SLAP };
const solved = Object.fromEntries(Object.entries({ ...FIX, dense: DENSE }).map(([k, f]) => [k, solvePogo(f.part, f)]));

describe('pogo hits (tempo-free normalisation)', () => {
  it('groups simultaneous events into a hit, low → high, one id per note with its articulation', () => {
    const h = normalizeHits([[0, 'A1'], [0, 'E1:s'], [1, 'G2:p', .5], [2, 'D2:y'], [3, 'C2:sp']]);
    expect(h.map(x => x.ids)).toEqual([['E1:s', 'A1'], ['G2:p'], ['D2:y'], ['C2:s']]);
    expect(parseId('E1:s')).toEqual({ note: 'E1', flag: 's' });
    expect(flagOf('E1:yp')).toBe('y'); expect(makeId(28, 's')).toBe('E1:s');
  });
  it('folds out-of-range notes into E1–G3; a chord the four strings cannot voice keeps root + top', () => {
    const h = normalizeHits([[0, 'C0'], [1, 'C6'], [2, 'E1'], [2, 'F1'], [2, 'B1']]);
    expect(h[0].notes[0]).toBeGreaterThanOrEqual(LO); expect(h[1].notes[0]).toBeLessThanOrEqual(HI);
    expect(h[2].ids).toEqual(['E1', 'B1']);                 // E1 + F1 live only on the low E string
    expect(h[2].dropped).toBe(1);
    const wide = normalizeHits(['E2', 'F2', 'G2', 'A2', 'B2', 'C3'].map(n => [0, n]))[0];
    expect(wide.notes.length).toBeLessThanOrEqual(STRINGS);
    expect(wide.notes[0]).toBe(noteNum('E2')); expect(wide.notes[wide.notes.length - 1]).toBe(noteNum('C3'));
  });
  it('voiceIds(part) is exactly what the machine fires (any tempo)', () => {
    for (const f of Object.values(FIX)){
      const ids = new Set(voiceIdsFor(f.part));
      const fired = R => new Set(R.hits.flatMap(h => h.asg.map(a => a.id)));
      expect(fired(solvePogo(f.part, f))).toEqual(ids);
      expect(fired(solvePogo(f.part, { ...f, beat: f.beat * 1.7, P: f.P * 1.7 }))).toEqual(ids);
    }
  });
  it('degrades, never crashes: junk, density, the event cap', () => {
    expect(solved.dense.hits.length).toBeLessThanOrEqual(PART_LIMITS.maxEvents);
    expect(solved.dense.hits.length).toBeGreaterThan(100);
    expect(solvePogo([], DEMO).hits.length).toBe(0);
    expect(normalizeHits(Array.from({ length: 900 }, (_, i) => [i / 8, 'E1'])).length).toBe(PART_LIMITS.maxEvents);
  });
  it('PART_LIMITS describes the machine (for the orchestrator): E1–G3, a line + double stops, 220-bpm 8ths fit', () => {
    expect(PART_LIMITS).toMatchObject({ lo: 28, hi: 55, poly: 2, gap: MIN_GAP, strings: 4, voices: 1 });
    expect(PART_LIMITS.gap).toBeLessThanOrEqual(60 / 220 / 2);          // same-pitch 8ths at 220 bpm (.136 s)
    expect(PART_LIMITS.programs).toEqual([33, 34, 35, 36, 37, 38, 39]);
    expect(pogo.PART_LIMITS).toBe(PART_LIMITS);
    expect(STATIONS.pogo).toBeTruthy();
  });
});

describe.each(Object.keys(FIX))('pogo fingering "%s"', key => {
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
  it('is inside the drive limits: no carriage overrun, no pogo re-strike under MIN_GAP', () => {
    expect(R.stats.viol).toBe(0);
    expect(R.stats.carOver).toBe(0);
    for (const S of R.strings) for (const gp of S.D.gaps) expect(gp).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
  });
});

describe.each(Object.keys(FIX))('pogo honesty "%s"', key => {
  const R = solved[key], P = R.P;
  it('the foot lands EXACTLY on the beat, falling onto the string; the flight is honest ballistics', () => {
    for (const S of R.strings) S.D.s.forEach((s, i) => { for (const loop of [0, 1, 3]){
      const t = s + loop * P;
      const at = pogoAt(S, t + 1e-9, START), before = pogoAt(S, t - 1e-6, START), after = pogoAt(S, t + 1e-6, START);
      expect(Math.abs(at.y)).toBeLessThan(1e-6);
      expect(before.vy).toBeLessThan(0);                       // moving INTO the string …
      expect(after.vy).toBeGreaterThan(0);                     // … and away from it
      expect(after.vy + g * 1e-6).toBeCloseTo(g * Math.min(S.D.gaps[i], DT_MAX) / 2, 6);   // v0 = g·gap/2: lands at the gap
      // between strikes (an arc) the acceleration is gravity, nothing else
      const gp = S.D.gaps[i];
      if (gp <= DT_MAX){
        const h = 1e-4, u = t + gp / 2, a = (pogoAt(S, u + h, START).y - 2 * pogoAt(S, u, START).y + pogoAt(S, u - h, START).y) / (h * h);
        expect(a).toBeCloseTo(-g, 2);
      }
    } });
  });
  it('the bounce is LOSSY and the PUMP supplies the difference (Δv = vOut − e·vIn), zero at every contact', () => {
    expect(E).toBeLessThan(1);
    let worked = 0;
    for (const S of R.strings) S.D.s.forEach((s, i) => {
      const dv = S.D.vOut[i] - E * S.D.vIn[i];
      expect(pumpOf(S, i)).toBeCloseTo(Math.max(-PUMP_MAX, Math.min(PUMP_MAX, PUMP_K * dv)), 12);
      if (Math.abs(dv) > .1) worked++;
      for (const loop of [1, 2]){
        const t = s + loop * P;
        expect(Math.abs(pogoAt(S, t + 1e-9, START).pump)).toBeLessThan(1e-6);
        const mid = pogoAt(S, t + S.pumpT[i] / 2, START);       // mid-stroke: the kick is real, and has the sign of Δv
        if (Math.abs(pumpOf(S, i)) > 1e-3) expect(Math.sign(mid.pump)).toBe(Math.sign(dv));
      }
    });
    expect(worked).toBeGreaterThan(0);
  });
  it('at rest at contact: string ring tapered to 0, hook pressed and still on its fret (lifted for an open string)', () => {
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
  });
  // (plain loops track the WORST sample and assert once — one expect per sample took ~17 s per fixture)
  it('no penetration: the foot never below the string, the top cap never into its magnet, the spring never solid, the hook never cuts the string', () => {
    const worst = { foot: Infinity, cap: Infinity, spring: Infinity, pump: 0, p0: Infinity, p1: -Infinity, hook: Infinity, fret: Infinity };
    for (const S of R.strings){
      for (let t = START; t < START + 2.2 * P; t += .001){
        const p = pogoAt(S, t, START), c = carriageAt(S, t, START);
        worst.foot = Math.min(worst.foot, p.y);
        // the top cap (foot + POGO_TOP + pump) vs the magnet's face (both measured from the strike surface)
        worst.cap = Math.min(worst.cap, magnetFace(S.s, c) - (strikeSurface(S.s, c) + p.y + POGO_TOP + p.pump));
        worst.spring = Math.min(worst.spring, PLUNGE - .2 + p.pump);
        worst.pump = Math.max(worst.pump, Math.abs(p.pump));
        worst.p0 = Math.min(worst.p0, c.p); worst.p1 = Math.max(worst.p1, c.p);
        worst.hook = Math.min(worst.hook, crossBottom(S.s, c.p) - (strTop(S.s) - stringDrop(S.s, c.x, c)));
        worst.fret = Math.min(worst.fret, strTop(S.s) - stringDrop(S.s, c.x, c) - 2 * gauge(S.s) - FRET_H);
      }
    }
    expect(worst.foot).toBeGreaterThanOrEqual(-1e-9);
    expect(worst.cap).toBeGreaterThanOrEqual(-1e-9);
    expect(worst.spring).toBeGreaterThanOrEqual(.2);                // 5 turns × .04 wire: never solid
    expect(worst.pump).toBeLessThanOrEqual(PUMP_MAX + 1e-12);
    expect(worst.p0).toBeGreaterThanOrEqual(-1e-9); expect(worst.p1).toBeLessThanOrEqual(1 + 1e-9);
    expect(worst.hook).toBeGreaterThanOrEqual(-1e-9);               // the crossbar never sinks into the string under it
    expect(worst.fret).toBeGreaterThanOrEqual(-1e-9);               // the pressed string never sinks below its fret wires
  });
  it('is continuous: nothing teleports — count-in → first strike, every phase, the loop seam', () => {
    const dt = 5e-4, worst = { foot: [0], pump: [0], x: [0], p: [0] };
    const note = (k, v, at) => { if (v > worst[k][0]) worst[k] = [v, at]; };
    for (const S of R.strings){
      let a = pogoAt(S, START, START), c = carriageAt(S, START, START), sf = strikeSurface(S.s, c);
      for (let t = START + dt; t < START + 2 * P + .5; t += dt){
        const b = pogoAt(S, t, START), d = carriageAt(S, t, START), sg = strikeSurface(S.s, d);
        note('foot', Math.abs(b.y + sg - a.y - sf), `s${S.s} @${t.toFixed(4)} ${a.mode}→${b.mode}`);
        note('pump', Math.abs(b.pump - a.pump), `s${S.s} @${t.toFixed(4)}`);
        note('x', Math.abs(d.x - c.x), `s${S.s} @${t.toFixed(4)}`);
        note('p', Math.abs(d.p - c.p), `s${S.s} @${t.toFixed(4)}`);
        a = b; c = d; sf = sg;
      }
    }
    // (the foot's frame is the struck point of the string: ballistic ≤ g·DT_MAX/2 = 7.25 u/s, plus the
    //  pressed string's sag carrying it — ≤ .05 u, but ~8 u/s while a hook presses)
    expect(worst.foot[0], `foot jump ${worst.foot[1]}`).toBeLessThan(18 * dt);
    expect(worst.pump[0], `pump jump ${worst.pump[1]}`).toBeLessThan(16 * dt);
    expect(worst.x[0], `carriage jump ${worst.x[1]}`).toBeLessThan(120 * dt);
    expect(worst.p[0], `hook jump ${worst.p[1]}`).toBeLessThan(200 * dt);
  });
  it('is ARMED during the count-in: every pogo hangs still on its magnet, hooks still over their first fret', () => {
    for (const S of R.strings){
      if (!S.n) continue;
      const p = pogoAt(S, START, START);
      expect(p.armed).toBe(true);
      if (p.until > DT_MAX / 2){ expect(p.mode).toBe('hold'); expect(p.y).toBeCloseTo(H_MAG, 12); expect(p.vy).toBe(0); expect(p.pump).toBe(0); }
      const c0 = carriageAt(S, START, START), c1 = carriageAt(S, START + .05, START);
      if (c1.armed){ expect(c1.x).toBe(c0.x); expect(c1.p).toBe(c0.p); }
    }
  });
});

describe('pogo flight modes', () => {
  it('long gaps PARK on the magnet at zero speed (the pump idle); dense gaps fly a solved arc — both in the demo', () => {
    const R = solved.demo, modes = new Set();
    for (const S of R.strings) for (let t = 0; t < R.P; t += .002) modes.add(pogoAt(S, t + R.P, START).mode);
    expect([...modes].sort()).toEqual(['arc', 'drop', 'hold']);
    expect(R.stats.parked).toBeGreaterThan(0);
    const S = R.strings.find(S => S.D.gaps.some(gp => gp > DT_MAX));
    const k = S.D.gaps.findIndex(gp => gp > DT_MAX), t = S.D.s[k] + DT_MAX / 2 + R.P;
    const at = pogoAt(S, t - 1e-7, START);
    expect(Math.abs(at.vy)).toBeLessThan(1e-4); expect(at.y).toBeCloseTo(H_MAG, 6);
    expect(pogoAt(S, t + 1e-3, START).mode).toBe('hold');
    expect(pogoAt(S, t + 1e-3, START).pump).toBe(0);
  });
  it('apex height = |G|·gap²/8 (rhythm reads as height): a 220-bpm chug is a buzz, a held note a tall hop', () => {
    const S = solved.rock.strings.find(S => S.ev.some(e => e.m === 28));
    const i = S.D.gaps.findIndex(gp => Math.abs(gp - 60 / 220 / 2) < 1e-6);
    expect(i).toBeGreaterThanOrEqual(0);
    const apex = pogoAt(S, S.D.s[i] + S.D.gaps[i] / 2 + solved.rock.P, START).y;
    expect(apex).toBeCloseTo(g * S.D.gaps[i] ** 2 / 8, 6);
    expect(apex).toBeLessThan(.05);
    expect(H_MAG).toBeCloseTo(g * DT_MAX ** 2 / 8, 12);
  });
  it('a pickup (negative beat) wraps into the loop', () => {
    const R = solved.slap, h = R.hits.find(h => h.beat === -.5);
    expect(h.t).toBeCloseTo(((2.6 - .5 * SLAP.beat) % R.P + R.P) % R.P, 9);
  });
  it('the 220-bpm rock line keeps its same-pitch 8ths on ONE string (the pogo buzzes in place)', () => {
    const R = solved.rock, e1 = R.hits.filter(h => h.notes[0] === 28);
    expect(new Set(e1.map(h => h.asg[0].s)).size).toBe(1);
  });
});

describe('pogo geometry: lanes never interact; the note alone sets the shape', () => {
  it('the pogos stand on their own strings, never over a neighbour: feet, handlebars, pump cylinders clear', () => {
    expect(FOOT_R + .05).toBeLessThan(STR_DZ - gauge(0));          // a foot on its string never reaches the next string
    const zSep = STR_DZ * Math.cos(.3), axis = Math.hypot(STAMP_DX, zSep);
    expect(zSep).toBeGreaterThan(2 * .06 + .1);                     // the handlebars (along x) pass in different z slabs
    expect(axis).toBeGreaterThan(2 * .135 + .2);                    // the pump cylinders never touch
    for (let s = 1; s < STRINGS; s++) expect(strZ(s) - strZ(s - 1)).toBeCloseTo(STR_DZ, 12);
    expect(HOOK_W / 2 + .03).toBeLessThan(STR_DZ - gauge(0));
  });
  it('the x bands never overlap: carriages | pogos | bridge', () => {
    expect(pressX(MAX_FRET) + .25).toBeLessThan(stampX(0) - FOOT_R);
    expect(stampX(STRINGS - 1) + FOOT_R).toBeLessThan(BRIDGE_X - .5);
    expect(pressX(0)).toBeGreaterThan(NUT_X);
  });
  it('the pitch IS the position: luthier frets, vibrating length ∝ 1/f', () => {
    for (let s = 0; s < STRINGS; s++) for (let f = 0; f <= MAX_FRET; f++){
      const m = OPEN[s] + f;
      expect(vibLen(m, s) * noteHz(nm(m))).toBeCloseTo(vibLen(OPEN[s], s) * noteHz(nm(OPEN[s])), 6);
      if (f) expect(fretX(f)).toBeGreaterThan(fretX(f - 1));
    }
    const xs = new Map();
    for (const R of Object.values(solved)) for (const S of R.strings) for (const e of S.ev) if (e.f > 0){
      const k = `${S.s}:${e.f}`; if (xs.has(k)) expect(e.X).toBe(xs.get(k)); else xs.set(k, e.X);
    }
  });
  it('the dense junk part still solves to a continuous machine (degrades gracefully)', () => {
    const R = solved.dense, dt = 1e-3;
    for (const S of R.strings){
      for (let t = START; t < START + 1.2 * R.P; t += dt){
        const c = carriageAt(S, t, START), d = pogoAt(S, t, START);
        expect(Number.isFinite(c.x) && Number.isFinite(c.p) && Number.isFinite(d.y) && Number.isFinite(d.pump)).toBe(true);
        expect(c.x).toBeGreaterThan(NUT_X); expect(c.x).toBeLessThan(stampX(0) - FOOT_R);
        expect(d.y).toBeGreaterThanOrEqual(-1e-9); expect(d.y).toBeLessThanOrEqual(H_MAG + 1e-9);
      }
    }
  });
});

describe('pogo voice', () => {
  const ids = voiceIdsFor(DEMO.part);
  it('the demo covers every articulation', () => {
    expect(new Set(ids.map(id => parseId(id).flag))).toEqual(new Set(['', 's', 'p', 'y']));
  });
  it('bakes the whole demo fast (every unique note is pre-rendered on song load)', () => {
    const t0 = performance.now();
    for (const id of ids) pogoVoice(id);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
  it.each(ids.concat(['G3:s', 'E1:p', 'G3:y']))('"%s": deterministic, peak in (.5, .9], ends at exactly 0, ≤ 2 s, decays', id => {
    const a = pogoVoice(id), b = pogoVoice(id);
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
  it('the pitch is the note (autocorrelation), every articulation', () => {
    for (const [id, hz] of [['E1', 41.2], ['A1', 55], ['E2', 82.41], ['G3', 196], ['E1:s', 41.2], ['A2:p', 110], ['D2:y', 73.42]]){
      const { samples: x, sr } = pogoVoice(id);
      const i0 = Math.round(.1 * sr), N = Math.round(.3 * sr);
      let best = -Infinity, lag = 0;
      for (let L = Math.round(sr / 400); L < Math.round(sr / 35); L++){
        let s = 0; for (let i = 0; i < N; i++) s += x[i0 + i] * x[i0 + i + L];
        if (s > best){ best = s; lag = L; }
      }
      const f = sr / lag;
      const cents = Math.min(...[1, 2].map(k => Math.abs(1200 * Math.log2(f * k / hz))));
      expect(cents, `${id} → ${f.toFixed(1)} Hz`).toBeLessThan(30);
    }
    expect(SR).toBeGreaterThanOrEqual(22050);
  });
  it('a SLAP is brighter than a fingered note, and rings shorter', () => {
    const bright = id => {   // zero-crossing rate of the first 80 ms ≈ the attack's brightness
      const { samples: x, sr } = pogoVoice(id); let z = 0; const N = Math.round(.08 * sr);
      for (let i = 1; i < N; i++) if ((x[i] >= 0) !== (x[i - 1] >= 0)) z++;
      return z;
    };
    expect(bright('A1:s')).toBeGreaterThan(1.5 * bright('A1'));
    expect(pogoVoice('A1:s').samples.length).toBeLessThan(pogoVoice('A1').samples.length);
  });
});

describe('pogo render (headless build + update)', () => {
  it('fires every note once per loop with its baked id, inside the station; constant mesh/material count', () => {
    const inst = pogo.make({ envMap: null, glowTex: null, THREE });
    const st = STATIONS.pogo;
    const grp = inst.build(DEMO.part, { ...DEMO, start: START, station: st, floorY: -1 });
    const count = () => { let m = 0; const mats = new Set(); grp.traverse(o => { if (o.isMesh || o.isSprite){ m++; mats.add(o.material); } }); return [m, mats.size]; };
    const before = count();
    expect(before[0]).toBeLessThanOrEqual(150);
    const fired = [];
    for (let t = START; t < START + DEMO.P; t += 1 / 60) inst.update(t, DEMO.P, 1 / 60, { started: true, skipStrikes: false, onStrike: h => fired.push(h) });
    const R = solvePogo(DEMO.part, DEMO);
    expect(fired.length).toBe(R.hits.reduce((a, h) => a + h.asg.length, 0));
    const ids = new Set(voiceIdsFor(DEMO.part));
    for (const h of fired){ expect(ids.has(h.note)).toBe(true); expect(Number.isFinite(h.dur) && h.dur > 0).toBe(true); }
    expect(fired.filter(h => h.shake > 0).every(h => h.note.endsWith(':s'))).toBe(true);   // only a hard slap shakes
    expect(count()).toEqual(before);
    grp.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(grp);
    expect(b.min.x).toBeGreaterThanOrEqual(-st.w / 2 - 1e-6); expect(b.max.x).toBeLessThanOrEqual(st.w / 2 + 1e-6);
    expect(b.min.z).toBeGreaterThanOrEqual(-st.d / 2 - 1e-6); expect(b.max.z).toBeLessThanOrEqual(st.d / 2 + 1e-6);
  });
});
