import { describe, it, expect } from 'vitest';
import { GEOM, T, B, N, PSI_R, cylAngle, pinPhase, pinWorld, pinGeo, buildComb, tineAt,
         shapeAt, tinePoint, splitTwins, tineLen, driveTime, driveRate, driveStart, spinTime,
         damper } from '../src/instruments/musicbox/solve.js';
import { at } from '../src/instruments/clock.js';
import MB from '../src/instruments/musicbox/index.js';
import { noteHz } from '../src/engine.js';

const TAU = Math.PI * 2;
const ROLL_T = 2.6, START = -2.4;
const wrapPi = a => { a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a; };

// the demo on its solo spine (bpm, beats → beat, P like main.js: ROLL_T + beats·beat + 1.2)
const beat = 60 / MB.demo.bpm;
const P = ROLL_T + MB.demo.beats * beat + 1.2;
const comb = buildComb(MB.demo.part, { rollT: ROLL_T, beat, P });
// a stress comb: a dense 16th-note repeat (needs twins) + a lone long-gap note
const dense = [[0, 'E6'], [.25, 'E6'], [.5, 'E6'], [.75, 'E6'], [1, 'E6', .4], [2, 'C5'], [9, 'G5', .3]];
const combD = buildComb(dense, { rollT: ROLL_T, beat, P });
const allLanes = [...comb.lanes.map(l => [l, comb.omega]), ...combD.lanes.map(l => [l, combD.omega])];

describe('music box geometry', () => {
  it('tine frame is orthonormal and the tines lie roughly horizontal, pushed UP', () => {
    expect(B[0] * N[0] + B[1] * N[1]).toBeCloseTo(0, 12);
    expect(Math.hypot(...B)).toBeCloseTo(1, 12);
    expect(N[0]).toBeGreaterThan(.9);                       // +N ≈ +y: pins lift the tines
  });
  it('at the release the pin tip is exactly at the tine tip, DELTA above its rest line', () => {
    const { u, hc } = pinGeo(0);
    expect(u).toBeCloseTo(0, 12); expect(hc).toBeCloseTo(GEOM.DELTA, 12);
    expect(pinGeo(-.05).u).toBeGreaterThan(0);              // coming: under the tine
    expect(pinGeo(.05).u).toBeLessThan(0);                  // gone: past its end
  });
  it('pins only ever cross the tine line near its tip, never under the body or the plate', () => {
    for (let D = -Math.PI; D < Math.PI; D += .002){
      const { u, hc } = pinGeo(D);
      if (u > .45) expect(hc).toBeLessThan(-.02);
    }
  });
  it('tine length is a cantilever: L ∝ f^−½', () => {
    const lo = noteHz('C5');
    expect(tineLen(lo, lo)).toBeCloseTo(GEOM.L_MAX);
    expect(tineLen(4 * lo, lo)).toBeCloseTo(GEOM.L_MAX / 2);
  });
});

describe('music box timing — the cylinder IS the score', () => {
  it('every pin reaches the release angle exactly on its beat, every loop', () => {
    for (const [lane] of allLanes) for (const s of lane.L.s){
      const phi = pinPhase(s, P);
      for (const k of [-1, 0, 1, 7]) expect(wrapPi(pinWorld(phi, s + k * P, P) - PSI_R)).toBeCloseTo(0, 9);
    }
  });
  it('the drum turns exactly one revolution per loop (seamless seam)', () => {
    expect(cylAngle(P, P) - cylAngle(0, P)).toBeCloseTo(TAU, 12);
    expect(cylAngle(3 * P + .1, P) - cylAngle(3 * P - .1, P)).toBeCloseTo(cylAngle(.2, P), 12);
  });
  it('fast repeats go to twin tines; every tine\'s pins clear each other', () => {
    const e6 = combD.lanes.filter(l => l.note === 'E6');
    expect(e6.length).toBeGreaterThan(1);
    for (const [lane, om] of allLanes) if (lane.L.s.length > 1)
      for (const g of lane.L.gaps) expect(g * om).toBeGreaterThanOrEqual(GEOM.MIN_ANGLE - 1e-9);
    // and beads on one tine never overlap
    expect(GEOM.MIN_ANGLE * GEOM.R).toBeGreaterThan(2 * GEOM.BEAD);
    expect(splitTwins([0, .1, .2, .3], 10, .15).length).toBe(2);
  });
});

/* sample every lane densely over > one loop, from the count-in */
function sweep(fn, { dt = 1 / 240, loops = 1.15 } = {}){
  for (const [lane, om] of allLanes)
    for (let t = START; t < START + loops * P; t += dt) fn(lane, om, t, tineAt(lane, t, START, om));
}

describe('music box honesty — the pluck', () => {
  it('at each strike the tine is ON its pin\'s tip, and leaves it with the same velocity (C¹)', () => {
    for (const [lane, om] of allLanes) for (const s of lane.L.s){
      let ts = s; while (ts < START + 1e-6) ts += P;
      const before = tineAt(lane, ts - 1e-6, START, om), now = tineAt(lane, ts, START, om),
            after = tineAt(lane, ts + 1e-6, START, om);
      expect(now.w).toBeCloseTo(GEOM.DELTA, 4);
      expect(before.w).toBeCloseTo(GEOM.DELTA, 4);          // C0: no snap in position
      expect(before.mode).toBe('pin');
      expect(after.w).toBeCloseTo(GEOM.DELTA, 4);
      // one-sided 2nd-order derivatives (the ring is fast: a centred-offset FD would see its
      // acceleration jump, which is the honest snap, not a velocity snap)
      const h = 2e-7, w = d => tineAt(lane, ts + d, START, om).w;
      const vb = (3 * w(-h) - 4 * w(-2 * h) + w(-3 * h)) / (2 * h),
            va = (-3 * w(h) + 4 * w(2 * h) - w(3 * h)) / (2 * h);
      expect(Math.abs(vb - va)).toBeLessThan(.02);          // C¹: released with the wire's own speed
      expect(Math.abs(vb)).toBeLessThan(.5);                // …which is a slow, quasi-static drag
    }
  });

  it('no penetration: no pin ever passes through its tine', () => {
    let worst = Infinity;
    sweep((lane, om, t, st) => {
      for (const s of lane.L.s){                             // EVERY pin on this tine, not just neighbours
        const D = wrapPi(om * (t - s));
        const { u, hc } = pinGeo(D);
        if (Math.abs(D) > 1.4) continue;
        let gap;
        if (u > 0 && u < lane.len) gap = shapeAt(lane.len - u, st, lane.len) - hc;
        else continue;
        worst = Math.min(worst, gap);
      }
    });
    expect(worst).toBeGreaterThan(-1e-6);
  });

  it('the ringing tine never strikes the drum or the beads in its skin', () => {
    let worst = Infinity;
    sweep((lane, om, t, st) => {
      for (let k = 0; k <= 8; k++){
        const p = tinePoint(lane.len * (.5 + k / 16), st, lane.len);
        worst = Math.min(worst, Math.hypot(p[0], p[1]) - (GEOM.R + GEOM.BEAD));
      }
    }, { dt: 1 / 120 });
    expect(worst).toBeGreaterThan(.015);
  });

  it('motion is continuous everywhere: across strikes, the loop seam and the count-in', () => {
    const dt = 1 / 2000;
    let jump = 0;
    for (const [lane, om] of allLanes)
      for (let t = START; t < START + 1.1 * P; t += dt)
        jump = Math.max(jump, Math.abs(tineAt(lane, t + dt, START, om).w - tineAt(lane, t, START, om).w));
    expect(jump).toBeLessThan(.02);                          // < 40 u/s even at the ring's peak speed
  });

  it('ARMED before the first strike: no ring, the tine waits on its first bead', () => {
    for (const [lane, om] of allLanes){
      const c = at(lane.L, START, START);
      const st = tineAt(lane, START, START, om);
      if (c.armed){ expect(st.env).toBe(0); expect(st.mode === 'rest' || st.mode === 'pin').toBe(true); }
    }
  });

  it('dense lanes: the tine still drops visibly between plucks', () => {
    for (const lane of combD.lanes.filter(l => l.note === 'E6')){
      if (lane.L.s.length < 2) continue;
      for (let k = 0; k < lane.L.s.length; k++){
        const s0 = lane.L.s[k], g = lane.L.gaps[k];
        let lo = Infinity;
        for (let t = s0; t < s0 + g; t += 1 / 500) lo = Math.min(lo, tineAt(lane, t + P, START, combD.omega).w);
        expect(lo).toBeLessThan(GEOM.DELTA * .7);
      }
    }
  });
});

describe('music box count-in — braked, then spun up from rest', () => {
  const Ts = spinTime(START), t0 = driveStart(START, Ts);
  it('the spin-up fits the count-in and is C¹: parked → rest-start → full speed exactly at t = 0', () => {
    expect(Ts).toBeGreaterThan(0); expect(Ts).toBeLessThanOrEqual(-START);
    expect(driveTime(START, Ts)).toBe(t0);                        // parked on the brake
    expect(driveTime(-Ts, Ts)).toBeCloseTo(t0, 12);
    expect(driveRate(-Ts + 1e-9, Ts)).toBeCloseTo(0, 6);          // starts from rest
    expect(driveTime(0, Ts)).toBeCloseTo(0, 12);                  // on the score's phase…
    expect(driveRate(-1e-9, Ts)).toBeCloseTo(1, 6);               // …at full speed
    const h = 1e-6;
    let prev = -Infinity;
    for (let t = START; t < 2; t += .01){
      const g = driveTime(t, Ts);
      expect(g).toBeGreaterThanOrEqual(prev - 1e-12); prev = g;   // never runs backwards
      expect((driveTime(t + h, Ts) - driveTime(t - h, Ts)) / (2 * h)).toBeCloseTo(driveRate(t, Ts), 4);
    }
    expect(driveTime(5.5, Ts)).toBe(5.5);
  });
  it('no pin plucks during the count-in: every lane\'s first strike is at drive time ≥ 0', () => {
    for (const [lane] of allLanes) expect(at(lane.L, t0, t0).first).toBeGreaterThanOrEqual(0);
  });
  it('the tine is parked at rest/on its pin through the whole braked count-in', () => {
    for (const [lane, om] of allLanes) for (let t = START; t < 0; t += .05){
      const st = tineAt(lane, driveTime(t, Ts), t0, om);
      expect(st.env).toBe(0); expect(st.amp).toBe(0);
    }
  });
});

describe('music box damping has a visible cause', () => {
  it('the ring is only damped while the next pin is under the tine and within REACH of its rest line', () => {
    for (const [lane, om] of allLanes) for (let k = 0; k < lane.L.s.length; k++){
      const g = lane.L.gaps[k];
      for (let since = 0; since < g; since += g / 200){
        const Dn = -om * (g - since), d = damper(Dn, -om * g, lane.len), p = pinGeo(Dn);
        if (d < 1 - 1e-9){
          expect(p.u).toBeGreaterThan(0); expect(p.u).toBeLessThan(lane.len);
          expect(p.hc).toBeGreaterThan(-GEOM.REACH - 1e-9);
        }
      }
      expect(damper(-om * g, -om * g, lane.len)).toBe(1);     // free at the release (keeps it C¹)
    }
  });
  it('a lone note with a long gap rings freely for most of the gap (no uncaused taper)', () => {
    const lane = combD.lanes.find(l => l.note === 'G5'), om = combD.omega;
    const s0 = lane.L.s[0] + P;
    const a = tineAt(lane, s0 + 1.0, START, om);
    expect(a.env).toBeCloseTo(Math.exp(-lane.kd * 1.0), 9);
  });
});

describe('music box voice', () => {
  it('renders a bright, decaying tine for the whole demo range', () => {
    for (const note of ['C5', 'G5', 'C6', 'C7']){
      const { samples, sr } = MB.voice(note);
      let peak = 0, head = 0, tail = 0;
      for (let i = 0; i < samples.length; i++){
        const a = Math.abs(samples[i]); peak = Math.max(peak, a);
        if (i < sr * .1) head = Math.max(head, a);
        if (i > samples.length - sr * .1) tail = Math.max(tail, a);
      }
      expect(peak).toBeGreaterThan(.4); expect(peak).toBeLessThanOrEqual(.9);
      expect(tail).toBeLessThan(head * .05);                 // it rings down
      expect(samples[samples.length - 1]).toBeCloseTo(0, 3);
    }
  });
  it('is deterministic', () => {
    const a = MB.voice('E6').samples, b = MB.voice('E6').samples;
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i += 97) expect(a[i]).toBe(b[i]);
  });
  it('higher tines ring shorter', () => {
    expect(MB.voice('C7').samples.length).toBeLessThan(MB.voice('C5').samples.length);
  });
});

describe('music box demo', () => {
  it('is a real phrase: polyphony, dynamics, dense runs and long gaps', () => {
    const part = MB.demo.part;
    const byBeat = {};
    for (const [b] of part) byBeat[b] = (byBeat[b] || 0) + 1;
    expect(Math.max(...Object.values(byBeat))).toBeGreaterThanOrEqual(3);          // chords
    expect(new Set(part.map(e => e[2] ?? 1)).size).toBeGreaterThan(3);           // dynamics
    const beats = [...new Set(part.map(e => e[0]))].sort((a, b) => a - b);
    const gaps = beats.map((b, i) => (beats[i + 1] ?? beats[0] + MB.demo.beats) - b);
    expect(Math.min(...gaps)).toBeLessThanOrEqual(.25);                            // a dense run
    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(2);                           // a long gap
  });
});
