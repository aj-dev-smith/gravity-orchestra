import { describe, it, expect } from 'vitest';
import { eventTimes, lanesByNote, wrapP } from '../src/instruments/clock.js';
import {
  bellLane, bellAt, fall, rise, quarter, ampForVel, reboundAmp, clearance, ellipK, layoutBells, tubeAmp, shiverAt, hitSpeed,
  OMEGA, E, ROD, g, BALL_R, TUBE_R, HANG, FORK_X, SLAB_HW, PLANE_MIN, TIP_MAX, ROLL_K, PIVOT, A_MAX, STRIKE_DEPTH,
} from '../src/instruments/bells/solve.js';
import { bellVoice } from '../src/instruments/bells/voice.js';
import bells, { tubeLen } from '../src/instruments/bells/index.js';

const ROLL_T = 2.6, START = -2.4;

/* integrate θ'' = −(g/R)·sinθ with RK4 — the ground truth the closed form must match */
function rk4Quarter(A, dt = 2e-6){
  let th = A, w = 0, t = 0;
  const f = (th) => -OMEGA * OMEGA * Math.sin(th);
  while (th > 0){
    const k1t = w, k1w = f(th);
    const k2t = w + dt / 2 * k1w, k2w = f(th + dt / 2 * k1t);
    const k3t = w + dt / 2 * k2w, k3w = f(th + dt / 2 * k2t);
    const k4t = w + dt * k3w, k4w = f(th + dt * k3t);
    const th1 = th + dt / 6 * (k1t + 2 * k2t + 2 * k3t + k4t);
    if (th1 <= 0) return t + dt * th / (th - th1);       // linear interp of the crossing
    w += dt / 6 * (k1w + 2 * k2w + 2 * k3w + k4w); th = th1; t += dt;
  }
  return t;
}

/* a lane built from a demo-format part for one note */
function demoLanes(demo){
  const beat = 60 / demo.bpm, P = ROLL_T + demo.beats * beat;
  const by = lanesByNote(eventTimes(demo.part, { rollT: ROLL_T, beat }));
  return { P, beat, lanes: Object.entries(by).map(([note, evs]) =>
    ({ note, lane: bellLane(evs.map(e => e.t), evs.map(e => e.vel), P, { len: tubeLen(note) }) })) };
}

describe('bells: the exact pendulum', () => {
  it('elliptic K matches known values', () => {
    expect(ellipK(0)).toBeCloseTo(Math.PI / 2, 12);
    expect(ellipK(Math.sin(Math.PI / 4))).toBeCloseTo(1.8540746773, 9);
  });

  it('the closed-form quarter period matches an RK4 integration within 0.1 ms', () => {
    for (const v of [0, .3, .6, 1]){
      const A = ampForVel(v);
      expect(Math.abs(quarter(A) - rk4Quarter(A))).toBeLessThan(1e-4);
    }
  });

  it('fall() satisfies the pendulum ODE and energy, and arrives at θ=0 at the impact speed', () => {
    const A = ampForVel(1), q = quarter(A);
    for (let s = .01; s < q; s += .01){
      const [th, w] = fall(A, s);
      // energy: ½w² = ω²(cosθ − cosA)
      expect(.5 * w * w).toBeCloseTo(OMEGA * OMEGA * (Math.cos(th) - Math.cos(A)), 8);
      const h = 1e-4, a = (fall(A, s + h)[1] - fall(A, s - h)[1]) / (2 * h);
      expect(a).toBeCloseTo(-OMEGA * OMEGA * Math.sin(th), 3);
    }
    const [th0, w0] = fall(A, q);
    expect(Math.abs(th0)).toBeLessThan(1e-9);
    expect(Math.abs(w0 * ROD)).toBeCloseTo(Math.sqrt(2 * g * ROD * (1 - Math.cos(A))), 8);
  });

  it('the rebound is lossy: leaves at e·v and peaks at B at rest after quarter(B)', () => {
    const A = ampForVel(.8), B = reboundAmp(A);
    expect(rise(B, 0)[1]).toBeCloseTo(-E * fall(A, quarter(A))[1], 8);
    const [thB, wB] = rise(B, quarter(B));
    expect(thB).toBeCloseTo(B, 9); expect(Math.abs(wB)).toBeLessThan(1e-7);
  });
});

describe('bells: lanes are honest', () => {
  const P = 12;
  const cases = {
    sparse: [[3, 1], [9, .4]],
    single: [[5, .7]],
    dense:  [[3, .6], [3.35, .5], [3.7, .9], [4.1, .7], [6, 1]],
    mixed:  [[2.7, .9], [3.2, .4], [5, .8], [5.6, .6], [8, .3], [11.8, 1]],
    seam:   [[.1, .8], [11.7, .9]],              // dense across the loop seam
  };
  for (const [name, hits] of Object.entries(cases)){
    const lane = bellLane(hits.map(h => h[0]), hits.map(h => h[1]), P, { len: 7 });
    const strikesAbs = [];
    for (let k = -1; k < 4; k++) for (const s of lane.L.s){ const a = s + k * P; if (a >= START - 1e-9) strikesAbs.push(a); }
    // the count-in drop is solved from rest, so its first strike is honest too
    const first = Math.min(...strikesAbs);

    it(`${name}: every strike lands at θ = 0 exactly on the beat, swinging IN`, () => {
      for (const a of strikesAbs.filter(a => a < START + 3 * P)){
        const before = bellAt(lane, a - 1e-7, START);
        expect(Math.abs(before.th), `${name} @${a}`).toBeLessThan(1e-5);
        expect(before.w).toBeLessThan(0);                // moving toward the tube
        expect(before.latched).toBe(false);              // the marble is FREE at contact
        const after = bellAt(lane, a + 1e-7, START);
        expect(after.w).toBeGreaterThan(0);              // bounced back out
        expect(after.since).toBeLessThan(1e-6);
      }
    });

    it(`${name}: the marble is free and on the exact pendulum in the last few ms before every hit`, () => {
      for (const a of strikesAbs.filter(a => a > first && a < START + 2 * P)){
        const c = bellAt(lane, a - .02, START);
        expect(c.latched).toBe(false);
        // energy on the release orbit: ½w² = ω²(cosθ − cosA)
        const i = lane.L.s.indexOf(+wrapP(a, P).toFixed(9));
        const A = lane.A[i];
        expect(.5 * c.w * c.w).toBeCloseTo(OMEGA * OMEGA * (Math.cos(c.th) - Math.cos(A)), 6);
      }
    });

    it(`${name}: continuous everywhere (count-in, catches, releases, loop seam) — nothing teleports`, () => {
      const dt = 5e-4;
      let prev = bellAt(lane, START, START);
      for (let t = START + dt; t < START + 2.2 * P; t += dt){
        const c = bellAt(lane, t, START);
        expect(Math.abs(c.th - prev.th), `${name} θ @${t.toFixed(4)}`).toBeLessThan(8 * dt + 1e-9);
        expect(Math.abs(c.phi - prev.phi), `${name} φ @${t.toFixed(4)}`).toBeLessThan(25 * dt);
        expect(Math.abs(c.tube.psi - prev.tube.psi)).toBeLessThan(.002);
        prev = c;
      }
    });

    it(`${name}: the shoe never sits inside the marble, and the marble never enters the tube`, () => {
      const dt = 1e-3;
      let guarded = 0;
      for (let t = START; t < START + 2.2 * P; t += dt){
        const c = bellAt(lane, t, START);
        if (c.guarded) guarded++;
        expect(c.phi - c.th).toBeGreaterThanOrEqual(-1e-9);
        expect(clearance(c.th, c.tube.psi, 7, c.tube.shiver), `${name} @${t.toFixed(3)}`).toBeGreaterThan(-1e-6);
        expect(c.th).toBeLessThan(1.6);                  // never swings over the top
      }
      expect(guarded).toBe(0);                           // the solved shoe path itself is clear
    });

    it(`${name}: the latch catches at rest (free gaps) or velocity-matched (dense gaps)`, () => {
      lane.plan.forEach((p, i) => {
        const a = lane.L.s[i] + P;                       // a strike well after the count-in
        const pre = bellAt(lane, a + p.tc - 1e-6, START), post = bellAt(lane, a + p.tc + 1e-6, START);
        expect(pre.latched).toBe(false); expect(post.latched).toBe(true);
        expect(post.th).toBeCloseTo(pre.th, 4);
        expect(post.w).toBeCloseTo(pre.w, 2);
        expect(pre.phi).toBeCloseTo(pre.th, 4);          // the shoe arrived exactly at the marble
        if (p.mode === 'free') expect(Math.abs(pre.w)).toBeLessThan(1e-4);
      });
    });

    it(`${name}: the tube is at rest at every contact`, () => {
      for (const a of strikesAbs.filter(a => a > first && a < START + 2 * P)){
        const c = bellAt(lane, a - 1e-4, START);
        expect(Math.abs(c.tube.psi)).toBeLessThan(1e-7);
        expect(Math.abs(c.tube.roll)).toBeLessThan(1e-7);
        expect(Math.abs(c.tube.shiver)).toBeLessThan(1e-7);   // the bending shiver has died to exactly 0 too
      }
    });
  }

  it('the count-in: ARMED and held back at the release angle until the drop', () => {
    const lane = bellLane([4], [1], P, { len: 7 });
    const c = bellAt(lane, START, START);
    expect(c.armed).toBe(true); expect(c.latched).toBe(true);
    expect(c.th).toBeCloseTo(ampForVel(1), 9); expect(c.w).toBe(0);
  });

  it('dense gaps are thrown (motor-driven), long gaps are caught at the apex', () => {
    const lane = bellLane([3, 3.3, 8], [1, 1, 1], P, { len: 7 });
    expect(lane.plan.map(p => p.mode)).toEqual(['dense', 'free', 'free']);
  });
});

describe('bells: lanes can never touch each other (the slab rule)', () => {
  it('every lane part fits in its ±SLAB_HW slab', () => {
    expect(BALL_R).toBeLessThanOrEqual(SLAB_HW);
    expect(FORK_X + .035).toBeLessThanOrEqual(SLAB_HW);           // fork arms
    expect(FORK_X + .02 + .045).toBeLessThanOrEqual(SLAB_HW);     // the shoe crossbar (half-length + radius)
    // the tube's sideways roll: its foot never leaves the slab
    expect(TUBE_R + ROLL_K * TIP_MAX).toBeLessThanOrEqual(SLAB_HW);
    expect(PLANE_MIN).toBeGreaterThanOrEqual(2 * SLAB_HW);
  });

  it('the layout keeps swing planes ≥ PLANE_MIN apart and everything inside the towers, for 1–13 lanes', () => {
    for (let n = 1; n <= 13; n++){
      const L = layoutBells(n, 11);
      if (n > 1) expect(L.plane, `n=${n}`).toBeGreaterThanOrEqual(PLANE_MIN - 1e-9);
      const sx = Math.sin(L.yaw), xs = Array.from({ length: n }, (_, k) => L.x0 + k * L.SP);
      // the longest tube, pushed away to its max foot excursion, clears the left tower (post r .13)
      expect(xs[0] - TUBE_R - TIP_MAX * sx, `n=${n}`).toBeGreaterThan(-L.TX + .13);
      // the top striker's full reach (shoe crossbar ≈ ROD + .2 from the pivot) clears the right tower
      expect(xs[n - 1] + (TUBE_R + BALL_R + ROD + .2) * sx, `n=${n}`).toBeLessThan(L.TX - .13);
    }
    expect(layoutBells(8, 11).yaw).toBeGreaterThan(.5);            // the demo keeps the across-the-view swing
  });

  it('the tube swing is soft-capped: the foot never travels more than TIP_MAX, forte > piano', () => {
    for (const len of [3.5, 5, 7]){
      const big = tubeAmp(hitSpeed(A_MAX), len), small = tubeAmp(hitSpeed(ampForVel(0)), len);
      expect(big * (HANG + len)).toBeLessThanOrEqual(TIP_MAX + 1e-9);
      expect(big).toBeGreaterThan(small * 1.3);
    }
  });

  it('the bending shiver is zero at the strike, pushes AWAY first, and is gone by the next contact', () => {
    expect(Math.abs(shiverAt(1, 0, 1, STRIKE_DEPTH, 7))).toBe(0);
    expect(shiverAt(1, .01, 1, STRIKE_DEPTH, 7)).toBeLessThan(0);
    expect(Math.abs(shiverAt(1, .5, .5, STRIKE_DEPTH, 7))).toBe(0);
    expect(PIVOT.z).toBeCloseTo(TUBE_R + BALL_R, 12);
  });
});

describe('bells: the demo', () => {
  it('every demo lane is honest end to end (strikes on the beat, no penetration, shoe clear)', () => {
    const { P, lanes } = demoLanes(bells.demo);
    for (const { note, lane } of lanes){
      const len = tubeLen(note);
      for (let t = START; t < START + 2 * P; t += 2e-3){
        const c = bellAt(lane, t, START);
        expect(c.guarded, `${note} guard @${t}`).toBeFalsy();
        expect(clearance(c.th, c.tube.psi, len, c.tube.shiver), `${note} @${t}`).toBeGreaterThan(-1e-6);
      }
      for (const s of lane.L.s){
        const a = s + P;
        expect(Math.abs(bellAt(lane, a - 1e-7, START).th)).toBeLessThan(1e-5);
      }
    }
  });

  it('exercises both paths: dense (thrown) and free (apex catch) gaps', () => {
    const { lanes } = demoLanes(bells.demo);
    const modes = new Set(lanes.flatMap(l => l.lane.plan.map(p => p.mode)));
    expect(modes.has('dense')).toBe(true); expect(modes.has('free')).toBe(true);
  });

  it('tube length follows real chimes: L ∝ f^-1/2 (C6 is half of C4)', () => {
    expect(tubeLen('C4') / tubeLen('C6')).toBeCloseTo(2, 6);
  });
});

describe('bells: the voice', () => {
  it('renders a long, bounded, decaying, deterministic ring', () => {
    const a = bellVoice('C5'), b = bellVoice('C5');
    expect(a.samples).toBe(b.samples);
    const { samples, sr } = a;
    expect(samples.length / sr).toBeLessThanOrEqual(4.5);
    let peak = 0; for (const x of samples) peak = Math.max(peak, Math.abs(x));
    expect(peak).toBeGreaterThan(.5); expect(peak).toBeLessThanOrEqual(.9);
    const rms = (i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += samples[i] ** 2; return Math.sqrt(s / (i1 - i0)); };
    const early = rms(0, sr * .2), mid = rms(sr * 1.5, sr * 1.7), late = rms(sr * 3.5, sr * 3.7);
    expect(mid).toBeLessThan(early); expect(late).toBeLessThan(mid);
    expect(mid).toBeGreaterThan(early * .05);              // a bell RINGS — still audible after 1.5 s
    expect(samples[samples.length - 1]).toBe(0);
  });

  it('decays smoothly: no tremolo pumping, and the tail fades out gently (no chop)', () => {
    for (const id of ['C4', 'A4', 'C6']){
      const { samples, sr } = bellVoice(id);
      const db = (t0) => { let s = 0; const a = Math.round(t0 * sr), b = Math.round((t0 + .1) * sr);
        for (let i = a; i < b; i++) s += samples[i] ** 2; return 10 * Math.log10(s / (b - a) + 1e-20); };
      for (let t = .25; t < 2.8; t += .25) expect(db(t + .25) - db(t), `${id} @${t}`).toBeLessThan(1);
      // the last 0.4 s is far below the ring at 2.5 s (a long fade, not a 0.25 s chop)
      expect(db(4.0) - db(2.5)).toBeLessThan(-15);
      expect(db(3.4) - db(2.9)).toBeGreaterThan(-12);           // …and the fade itself is gradual
    }
  });

  it('the strike tone is the note: modes 4/5/6 sit at 2:3:4 of f (energy near 2f)', () => {
    const { samples, sr } = bellVoice('A4');           // f = 440 → mode 4 at 880
    const goertzel = f => { const w = 2 * Math.PI * f / sr; let s1 = 0, s2 = 0;
      for (let i = sr * .1; i < sr * .6; i++){ const s0 = samples[i] + 2 * Math.cos(w) * s1 - s2; s2 = s1; s1 = s0; }
      return s1 * s1 + s2 * s2 - 2 * Math.cos(w) * s1 * s2; };
    expect(goertzel(880)).toBeGreaterThan(goertzel(700) * 20);
    expect(goertzel(440 * 121 / 40.5)).toBeGreaterThan(goertzel(1200) * 20);
  });

  it('every demo note renders', () => {
    for (const id of new Set(bells.demo.part.map(e => e[1]))){
      const { samples } = bellVoice(id);
      expect(samples.every(Number.isFinite)).toBe(true);
    }
  });
});
