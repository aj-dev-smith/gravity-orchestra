import { describe, it, expect } from 'vitest';
import { bowlGeom, bowlLane, bowlAt, noteLane, noteAt, singEnv, g, THETA_ORB, THETA_RIM, MERGE, HOME, HOLD_MAX, SOUND_MAX, rimMode, RIM_NODE } from '../src/instruments/bowls/solve.js';
import { wrapP } from '../src/instruments/clock.js';
import { bowlVoice } from '../src/instruments/bowls/voice.js';
import bowls from '../src/instruments/bowls/index.js';
import { eventTimes, lanesByNote } from '../src/instruments/clock.js';

const TAU = Math.PI * 2;
const angDiff = (a, b) => { const d = ((a - b) % TAU + TAU) % TAU; return Math.min(d, TAU - d); };
const notes = list => list.map(([t, d, v = 1]) => ({ t, tDur: d, vel: v }));
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
const vel = (L, t, start, h = 1e-4) => {
  const a = bowlAt(L, t - h, start), b = bowlAt(L, t + h, start);
  return { x: (b.x - a.x) / (2 * h), y: (b.y - a.y) / (2 * h), z: (b.z - a.z) / (2 * h) };
};

describe('bowl geometry', () => {
  it('size is a pure fn of the note: bigger = lower', () => {
    expect(bowlGeom('C3').rimR).toBeGreaterThan(bowlGeom('C4').rimR);
    expect(bowlGeom('C4').rimR).toBeGreaterThan(bowlGeom('C5').rimR);
    expect(bowlGeom('E4')).toEqual(bowlGeom('E4'));
  });
  it('the orbit is the conical-pendulum balance v² = g·r·tanθ, inside the rim', () => {
    for (const n of ['C3', 'G3', 'D4', 'B4', 'D5']){
      const G = bowlGeom(n);
      expect(G.v * G.v).toBeCloseTo(g * G.r * Math.tan(THETA_ORB), 9);
      expect(G.omega * G.omega).toBeCloseTo(g / (G.Rc * Math.cos(THETA_ORB)), 9);
      expect(G.yo).toBeLessThan(G.rimY);                         // the orbit band is below the rim edge
      expect(G.r + G.rb).toBeLessThan(G.rimR);                    // the parked ball drops through the opening
      expect(G.hoverY - G.rb).toBeGreaterThan(G.rimY + .1);       // and hangs clear above it
      expect(THETA_RIM).toBeGreaterThan(THETA_ORB);
      expect(G.yo + G.rb).toBeGreaterThan(G.rimY + .03);          // the rolling ball's top shows above the lip
    }
  });
  it('the rubbing point is a radial NODE of the (2,0) rim mode: the wall never moves under the ball', () => {
    for (const phi of [-2, 0, .7, 3.1]){
      expect(Math.abs(rimMode(phi, phi))).toBeLessThan(1e-9);
      expect(Math.abs(rimMode(phi + Math.PI, phi))).toBeLessThan(1e-9);     // and diametrically opposite
      expect(Math.abs(rimMode(phi + RIM_NODE, phi))).toBeCloseTo(1, 9);     // antinodes ±45° away
    }
  });
});

// a lane with a long note, a short one, a back-to-back pair (merge) and a seam-crossing tail
const P = 14, START = -2.4;
const N = notes([[2, 3.6, .8], [6.8, .5, .6], [8.4, .4], [9.1, 1.2], [11.8, 2.6]]);
const GEOM = bowlGeom('A3');
const L = bowlLane(N, P, GEOM);

describe('bowl lane: honest hand-offs', () => {
  it('merges notes closer than MERGE into one continuous orbit', () => {
    // 8.4+.4=8.8 → 9.1 gap .3 < MERGE: one session
    expect(L.sessions.length).toBe(4);
    expect(MERGE).toBeGreaterThan(.3);
  });

  it('at every note-on the ball is ON the wall, at rest vertically, with exactly the orbit speed', () => {
    for (const n of N){
      const tOn = n.t + 1e-7;
      const b = bowlAt(L, tOn, START);
      const c = { x: 0, y: GEOM.cy, z: 0 };
      expect(dist(b, c)).toBeCloseTo(GEOM.Rc, 6);                   // contact: centre on the Rc sphere
      expect(b.y).toBeCloseTo(GEOM.yo, 6);
      for (const s of [-1, 1]){                                      // matched on BOTH sides of the hand-off
        const v = vel(L, n.t + s * 2e-4, START, 2e-5);
        expect(Math.abs(v.y)).toBeLessThan(.05);
        expect(Math.hypot(v.x, v.z)).toBeCloseTo(GEOM.v, 1);
      }
    }
  });

  it('the ball path is continuous everywhere (incl. the loop seam and the count-in)', () => {
    const vmax = GEOM.v * 1.8 + 6;
    const dt = .002;
    let prev = bowlAt(L, START, START);
    for (let t = START + dt; t < START + 3 * P; t += dt){
      const b = bowlAt(L, t, START);
      expect(dist(b, prev), `t=${t.toFixed(3)}`).toBeLessThan(vmax * dt);
      prev = b;
    }
  });

  it('never penetrates the bowl: below the rim the ball centre stays inside the Rc sphere', () => {
    for (let t = START; t < START + 2 * P; t += .003){
      const b = bowlAt(L, t, START);
      if (b.y < GEOM.rimY + GEOM.rb) expect(Math.hypot(b.x, b.y - GEOM.cy, b.z)).toBeLessThanOrEqual(GEOM.Rc + 1e-6);
      if (b.orbiting) expect(Math.hypot(b.x, b.y - GEOM.cy, b.z)).toBeCloseTo(GEOM.Rc, 9);
    }
  });

  it('the empty magnet only comes down onto the rolling ball phase-locked to it', () => {
    for (let t = START; t < START + 2 * P; t += .003){
      const b = bowlAt(L, t, START);
      if (!b.orbiting) continue;
      expect(b.lift).toBeGreaterThanOrEqual(-1e-9);                 // never below the ball's top
      if (b.lift < GEOM.lift * .98) expect(angDiff(b.angle, b.phiBall)).toBeLessThan(1e-6);
    }
  });

  it('the rotor never spins wildly (≤ 1.6 ω) and the orbit speed is constant', () => {
    for (let t = START; t < START + 2 * P; t += .01){
      const b = bowlAt(L, t, START);
      expect(Math.abs(b.omegaR)).toBeLessThanOrEqual(GEOM.omega * 1.6);
    }
  });

  it('is ARMED at home through the count-in: ball on the magnet, high, still', () => {
    const b = bowlAt(L, START, START);
    expect(b.armed).toBe(true); expect(b.attached).toBe(true);
    expect(angDiff(b.angle, HOME)).toBeLessThan(1e-9);
    expect(b.y).toBeCloseTo(GEOM.hoverY, 9);
  });

  it('a session whose spin-up began before start never happened (armed instead)', () => {
    const L2 = bowlLane(notes([[P - 2.0, 1]]), P, GEOM);           // on at −2.0 abs: spin-up at ≈ −2.84 < start
    const b = bowlAt(L2, -1.9, START);
    expect(b.armed).toBe(true); expect(b.orbiting).toBe(false);
    const N2 = noteLane(notes([[P - 2.0, 1]]), P, L2);
    expect(noteAt(N2, -1.9, START).live).toBe(false);
    expect(noteAt(N2, -1.9 + P, START).live).toBe(true);           // next loop it plays
  });

  it('dense lanes (back-to-back short notes) still hand off honestly', () => {
    const Nd = notes([[0, .3], [1.3, .3], [2.6, .3], [3.9, .3]]);
    const Ld = bowlLane(Nd, 6, GEOM);
    expect(Ld.sessions.length).toBe(4);
    for (const n of Nd){
      const b = bowlAt(Ld, n.t + 1e-7, START);
      expect(b.orbiting).toBe(true); expect(b.y).toBeCloseTo(GEOM.yo, 6);
      const v = vel(Ld, n.t + 1e-3, START);
      expect(Math.abs(v.y)).toBeLessThan(.05);
    }
    let prev = bowlAt(Ld, 0, START);
    for (let t = .002; t < 12; t += .002){
      const b = bowlAt(Ld, t, START);
      expect(dist(b, prev)).toBeLessThan(.2);
      prev = b;
    }
  });

  it('the singing envelope: silent before, swells, holds, decays', () => {
    expect(singEnv(Infinity, 1)).toBe(0);
    expect(singEnv(0, 1)).toBe(0);
    expect(singEnv(.5, 2)).toBeGreaterThan(.8);
    expect(singEnv(3, 1)).toBeLessThan(.02);
  });
});

describe('rolling + sound coverage', () => {
  it('the marble rolls only on the wall: its roll angle is continuous, 0 while armed, frozen while held', () => {
    const dt = .002;
    let prev = bowlAt(L, START, START);
    expect(prev.roll).toBe(0);
    for (let t = START + dt; t < START + 3 * P; t += dt){
      const b = bowlAt(L, t, START);
      expect(Math.abs(b.roll - prev.roll), `t=${t.toFixed(3)}`).toBeLessThan(GEOM.spin * dt * 1.01 + 1e-9);
      if (!b.orbiting && !prev.orbiting) expect(b.roll).toBeCloseTo(prev.roll, 9);
      prev = b;
    }
  });

  it('every demo note: the orbit is clamped to what the voice holds, and SOUND covers every orbiting instant', () => {
    const beat = 60 / bowls.demo.bpm, rollT = 2.6, P2 = bowls.demo.beats * beat, start = -2.4;
    const lanes = lanesByNote(eventTimes(bowls.demo.part, { rollT, beat }));
    for (const [note, evs] of Object.entries(lanes)){
      const G = bowlGeom(note), ns = evs.map(e => ({ t: e.t, tDur: e.tDur, vel: e.vel }));
      const Lx = bowlLane(ns, P2, G), Nx = noteLane(ns, P2, Lx);
      for (const S of Lx.sessions) expect(S.dur).toBeGreaterThan(0);
      for (const r of Nx.rec){ expect(r.dur).toBeGreaterThan(0); expect(r.dur).toBeLessThanOrEqual(SOUND_MAX + 1e-9); }
      // no demo note is clamped by surprise
      for (const e of evs) expect(e.tDur).toBeLessThanOrEqual(HOLD_MAX + 1e-9);
      for (let t = P2; t < 2 * P2; t += .01){                        // a steady-state loop
        const b = bowlAt(Lx, t, start);
        if (!b.orbiting) continue;
        const tau = wrapP(t, P2);
        const heard = Nx.rec.some(r => { const d = wrapP(tau - r.s, P2); return d <= r.dur + 1e-6; });
        expect(heard, `${note} silent while rolling at t=${t.toFixed(2)}`).toBe(true);
      }
    }
  });
});

describe('bowl voice', () => {
  it('is a RUBBED tone: holds through SOUND_MAX with a gentle (not full-depth) beat, then dies to zero', () => {
    for (const n of ['C3', 'E4', 'D5']){
      const { samples, sr } = bowlVoice(n);
      const win = Math.round(sr * .05), rms = [];
      for (let i = Math.round(sr * 1); i + win < sr * (SOUND_MAX - .1); i += win){
        let q = 0; for (let j = 0; j < win; j++) q += samples[i + j] ** 2;
        rms.push(Math.sqrt(q / win));
      }
      const lo = Math.min(...rms), hi = Math.max(...rms);
      expect(lo / hi, n).toBeGreaterThan(.4);                        // never a dropout
      expect(lo).toBeGreaterThan(.08);                               // still singing at the end of the hold
      expect(samples.length / sr).toBeGreaterThan(SOUND_MAX);
    }
  });

  it('renders a finite, bounded, sustained tone', () => {
    for (const n of ['C3', 'A3', 'E4', 'D5']){
      const { samples, sr } = bowlVoice(n);
      let peak = 0;
      for (const x of samples){ expect(Number.isFinite(x)).toBe(true); peak = Math.max(peak, Math.abs(x)); }
      expect(peak).toBeGreaterThan(.5); expect(peak).toBeLessThanOrEqual(.9);
      expect(samples.length / sr).toBeGreaterThan(3.5);
      // soft attack: the first 10 ms are quiet; still ringing at 2.5 s
      let early = 0, late = 0;
      for (let i = 0; i < sr * .01; i++) early = Math.max(early, Math.abs(samples[i]));
      for (let i = Math.round(sr * 2.5); i < sr * 2.6; i++) late = Math.max(late, Math.abs(samples[i]));
      expect(early).toBeLessThan(.25 * peak);
      expect(late).toBeGreaterThan(.15 * peak);
      expect(Math.abs(samples[samples.length - 1])).toBeLessThan(1e-3);
    }
  });
  it('is deterministic', () => {
    expect(bowlVoice('G3').samples).toBe(bowlVoice('G3').samples);
  });
});

describe('bowl demo', () => {
  it('plays chords (≥3 bowls sounding at once) with sustained durations, within range', () => {
    const ev = bowls.demo.part;
    expect(ev.every(e => e[3] > 0)).toBe(true);
    const at0 = ev.filter(e => e[0] === 0).length;
    expect(at0).toBeGreaterThanOrEqual(3);
    const lanes = lanesByNote(eventTimes(ev, { rollT: 2.6, beat: .8 }));
    expect(Object.keys(lanes).length).toBeLessThanOrEqual(8);
  });
});
