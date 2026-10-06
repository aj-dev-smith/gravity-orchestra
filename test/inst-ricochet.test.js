import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { eventTimes } from '../src/instruments/clock.js';
import { arcPos, noteHz, noteNum } from '../src/engine.js';
import {
  g, BALL_R, PLATE_T, MARGIN, DT_MAX, CLEAR, FOOT_MAX, HANG_MIN,
  makeNodes, hops, heightAux, heightCost, plateSizer, buildOrbit, marbleAt, sinceStrike, wobble, gateLift,
  closeHeadings, discDist, audit, scoreOf, ESCALATE, CLEAR as CLR, CABLE_R,
} from '../src/instruments/ricochet/solve.js';
import { glassVoice, gateClink, relayTock } from '../src/instruments/ricochet/voice.js';
import { SONGS } from '../src/songs/index.js';
import RICO from '../src/instruments/ricochet/index.js';

const ROLL_T = 2.6, START = -2.4;
const beat = 60 / RICO.demo.bpm;
const P = ROLL_T + RICO.demo.beats * beat + 1.2;         // main.js: LOOP_T = melody total + 1.2
const events = eventTimes(RICO.demo.part, { rollT: ROLL_T, beat });
const orb = buildOrbit(events, { P, start: START });
const N = orb.nodes.length;
const nxt = i => (i + 1) % N, prv = i => (i - 1 + N) % N;
const reflect = (v, n) => v.clone().addScaledVector(n, -2 * v.dot(n));
const close3 = (a, b, eps = 1e-9) => expect(a.distanceTo(b)).toBeLessThan(eps);

describe('ricochet: the node ring', () => {
  it('is monophonic, cyclic, and every hop is ≤ DT_MAX (long gaps → silent relay mirrors)', () => {
    const sum = orb.nodes.reduce((a, n) => a + n.dt, 0);
    expect(sum).toBeCloseTo(P, 9);
    for (const n of orb.nodes){ expect(n.dt).toBeGreaterThan(0); expect(n.dt).toBeLessThanOrEqual(DT_MAX + 1e-9); }
    expect(orb.nodes.filter(n => !n.relay).length).toBe(RICO.demo.part.length);
    expect(orb.nodes.some(n => n.relay)).toBe(true);           // the loop seam always needs relays
  });
  it('chords collapse to one plate (the highest), relays split a long gap evenly', () => {
    const nodes = makeNodes([{ t: 1, note: 'C4', vel: 1 }, { t: 1.02, note: 'E4', vel: 1 }, { t: 2, note: 'G4', vel: 1 }], 6);
    const notes = nodes.filter(n => !n.relay);
    expect(notes.map(n => n.note)).toEqual(['E4', 'G4']);
    const relays = nodes.filter(n => n.relay);
    expect(relays.length).toBe(Math.ceil(5 / DT_MAX) - 1);
    expect(nodes.reduce((a, n) => a + n.dt, 0)).toBeCloseTo(6, 12);
  });
});

describe('ricochet: the closed-form solve (elastic ⇒ energy conserved)', () => {
  it('every launch has exactly the speed the energy level dictates: |v| = sqrt(2g(H − h))', () => {
    for (let i = 0; i < N; i++){
      const want = Math.sqrt(2 * g * (orb.H - orb.p[i].y));
      expect(orb.v0[i].length()).toBeCloseTo(want, 9);
      expect(orb.vIn[i].length()).toBeCloseTo(want, 9);         // arrival speed too: nothing gained, nothing lost
    }
  });
  it('the horizontal reach is the forced one: d = dt·sqrt(2g(H − h) − vy²)', () => {
    for (let i = 0; i < N; i++){
      const dt = orb.nodes[i].dt, dy = orb.p[nxt(i)].y - orb.p[i].y, vy = dy / dt + .5 * g * dt;
      const rad = 2 * g * (orb.H - orb.p[i].y) - vy * vy;
      expect(rad).toBeGreaterThan(2 * g * MARGIN * .99);
      const dx = orb.p[nxt(i)].x - orb.p[i].x, dz = orb.p[nxt(i)].z - orb.p[i].z;
      expect(Math.hypot(dx, dz)).toBeCloseTo(dt * Math.sqrt(rad), 8);
    }
  });
  it('each arc lands EXACTLY on the next plate in exactly the note gap', () => {
    for (let i = 0; i < N; i++) close3(arcPos(orb.p[i], orb.v0[i], orb.nodes[i].dt), orb.p[nxt(i)], 1e-9);
  });
  it('the knot closes: the hops sum to zero (loop seam seamless)', () => {
    const s = new THREE.Vector3();
    for (let i = 0; i < N; i++) s.add(orb.p[nxt(i)].clone().sub(orb.p[i]));
    expect(s.length()).toBeLessThan(1e-9);
    // the min-norm heading solve closes an open polygon
    const d = [3, 4, 5, 2.5], phi = closeHeadings([0, 1.7, 3.1, 4.9], d);
    const ex = d.reduce((a, di, i) => a + di * Math.cos(phi[i]), 0), ez = d.reduce((a, di, i) => a + di * Math.sin(phi[i]), 0);
    expect(Math.hypot(ex, ez)).toBeLessThan(1e-10);
  });
  it('every plate is a MIRROR: reflect(vIn, n) = vOut, approached from the front, left from the front', () => {
    for (let i = 0; i < N; i++){
      close3(reflect(orb.vIn[i], orb.n[i]), orb.v0[i], 1e-9);
      expect(orb.vIn[i].dot(orb.n[i])).toBeLessThan(0);
      expect(orb.v0[i].dot(orb.n[i])).toBeGreaterThan(0);
    }
  });
  it('contact is honest: the marble touches the plate face exactly at its centre', () => {
    for (let i = 0; i < N; i++){
      const face = orb.p[i].clone().addScaledVector(orb.n[i], -BALL_R);
      expect(discDist(face, orb.c[i], orb.n[i], orb.r[i])).toBeCloseTo(PLATE_T / 2, 9);
      expect(orb.c[i].clone().sub(face).cross(orb.n[i]).length()).toBeLessThan(1e-9);   // dead centre
    }
  });
  it('the energy ceiling: every apex stays ≥ MARGIN below H; the canopy is above H', () => {
    const { apex } = hops(orb.h, orb.nodes.map(n => n.dt));
    for (const a of apex) expect(a).toBeLessThanOrEqual(orb.H - MARGIN + 1e-9);
    expect(orb.ceilY).toBeGreaterThan(orb.H + BALL_R);
  });
  it('the height relaxation uses an exact gradient', () => {
    const sz = plateSizer(orb.nodes.filter(n => !n.relay).map(n => n.note));
    const aux = heightAux(orb.nodes, n => n.relay ? .42 : sz(n.note));
    const h = orb.h.map((x, i) => x + .3 * Math.sin(i));
    const { grad } = heightCost(h, orb.nodes, aux);
    for (const i of [0, 5, 17, N - 1]){
      const e = 1e-6, hp = h.slice(), hm = h.slice(); hp[i] += e; hm[i] -= e;
      const fd = (heightCost(hp, orb.nodes, aux).f - heightCost(hm, orb.nodes, aux).f) / (2 * e);
      expect(grad[i]).toBeCloseTo(fd, 4);
    }
  });
});

describe('ricochet: the sculpture is physically clean', () => {
  const a = audit(orb.nodes, orb, { step: .01, ceil: orb.ceilY });
  it('no arc passes through any foreign plate or any cable; plates never touch; fits the footprint', () => {
    expect(a.arcPlate).toBeGreaterThan(0);
    expect(a.arcCable).toBeGreaterThan(0);
    expect(a.plates).toBeGreaterThan(0);
    expect(a.cablePlate).toBeGreaterThan(0);
    expect(a.foot).toBeLessThanOrEqual(orb.footMax + 1e-9);
    expect(orb.footMax).toBeLessThanOrEqual(FOOT_MAX * 1.12 ** ESCALATE + 1e-9);   // escalation is bounded
    expect(orb.score).toBeGreaterThanOrEqual(CLEAR);            // the coarse audit that chose this layout had margin
  });
  it('plate size encodes pitch only (the engine law): same note → same size, higher → smaller', () => {
    const notes = orb.nodes.filter(n => !n.relay);
    for (let i = 0; i < N; i++) if (!orb.nodes[i].relay) for (let j = 0; j < N; j++) if (!orb.nodes[j].relay){
      const di = noteNum(orb.nodes[i].note) - noteNum(orb.nodes[j].note);
      if (di === 0) expect(orb.r[i]).toBe(orb.r[j]);
      if (di > 0) expect(orb.r[i]).toBeLessThan(orb.r[j]);
    }
    expect(notes.length).toBeGreaterThan(10);
  });
});

describe('ricochet: time is the only state', () => {
  it('the marble is AT each plate exactly at its strike time, every loop', () => {
    for (const k of [0, 1, 3]) for (let i = 0; i < N; i++){
      let tt = orb.nodes[i].t + k * P;
      if (tt < orb.entry.tFirst) tt += P;
      close3(marbleAt(orb, tt).pos, orb.p[i], 1e-7);
    }
  });
  it('the path is continuous everywhere (count-in → drop → gate → orbit → seam)', () => {
    const en = orb.entry;
    let prev = marbleAt(orb, START).pos.clone();
    for (let t = START; t < START + 2.2 * P; t += .002){
      const q = marbleAt(orb, t).pos.clone();
      expect(q.distanceTo(prev)).toBeLessThan(.002 * 30);       // < 30 u/s × dt — no teleports
      prev = q;
    }
    close3(marbleAt(orb, en.tRel - 1e-9).pos, en.Q, 1e-6);
    close3(marbleAt(orb, en.tE - 1e-9).pos, en.E, 1e-6);
    close3(marbleAt(orb, en.tE + 1e-9).pos, en.E, 1e-6);
  });
});

describe('ricochet: the count-in (magnet → starter gate → orbit)', () => {
  const en = orb.entry;
  it('the magnet holds the marble at rest AT the energy ceiling H — the orbit\'s exact energy', () => {
    expect(en.Q.y).toBeCloseTo(orb.H, 12);
    expect(marbleAt(orb, START).phase).toBe('hang');
    expect(en.tRel).toBeGreaterThanOrEqual(START + HANG_MIN);
  });
  it('the fall arrives with exactly the orbit\'s speed, and the gate mirror sends it on with the orbit\'s velocity', () => {
    expect(en.vDrop.length()).toBeCloseTo(en.vOrb.length(), 9);
    close3(reflect(en.vDrop, en.n), en.vOrb, 1e-9);
    expect(en.vDrop.dot(en.n)).toBeLessThan(0);
    // and the gate point IS on the orbit's arc into the first note plate, on the downbeat
    const a = en.from, s = orb.nodes[a].dt - en.tau;
    close3(arcPos(orb.p[a], orb.v0[a], s), en.E, 1e-9);
    expect(en.tE + en.tau).toBeCloseTo(en.tFirst, 12);
    expect(orb.nodes[en.j].relay).toBe(false);
    expect(en.tFirst).toBeCloseTo(Math.min(...events.map(e => e.t)), 9);
  });
  it('the drop line clears every plate; the gate is parked long before the orbit comes round again', () => {
    for (let y = en.E.y + .3; y <= orb.H; y += .02)
      for (let k = 0; k < N; k++) expect(discDist(new THREE.Vector3(en.E.x, y, en.E.z), orb.c[k], orb.n[k], orb.r[k])).toBeGreaterThan(BALL_R);
    expect(gateLift(orb, en.tE)).toBe(0);
    expect(gateLift(orb, en.tE + 1.2)).toBe(1);
    expect(en.tE + 1.2).toBeLessThan(en.tE + P - en.tau);
  });
  it('no strike exists before the first downbeat (scrub-safe)', () => {
    for (let i = 0; i < N; i++) expect(sinceStrike(orb, i, en.tFirst - 1e-3)).toBe(Infinity);
    expect(sinceStrike(orb, en.j, en.tFirst + .1)).toBeCloseTo(.1, 9);
  });
  it('a struck plate\'s wobble is zero at contact and tapered to exactly zero by its next strike', () => {
    expect(wobble(0, P, .07)).toBe(0);
    expect(wobble(P, P, .07)).toBe(0);
    expect(Math.abs(wobble(P - 1e-3, P, .07))).toBeLessThan(1e-9);
    let mx = 0; for (let s = 0; s < 2; s += .001) mx = Math.max(mx, Math.abs(wobble(s, P, .07)));
    expect(mx).toBeGreaterThan(.02); expect(mx).toBeLessThan(.07);
  });
});

describe('ricochet: other parts still build honestly', () => {
  const parts = {
    dense: Array.from({ length: 24 }, (_, i) => [i * .25, ['C5', 'E5', 'G5', 'B5', 'D6', 'G5'][i % 6]]),
    sparse: [[0, 'C4'], [3, 'G4'], [6, 'E5'], [7, 'D5']],
    wide: [[0, 'C3'], [.5, 'C6'], [1, 'G3'], [1.5, 'A5'], [2, 'E4'], [3, 'F5'], [4, 'D4'], [6, 'B5']],
  };
  for (const [name, part] of Object.entries(parts)) it(`${name}: exact landings, mirrors, energy`, () => {
    const Pp = ROLL_T + 8 * beat + 1.2;
    const o = buildOrbit(eventTimes(part, { rollT: ROLL_T, beat }), { P: Pp, start: START });
    const n = o.nodes.length;
    for (let i = 0; i < n; i++){
      close3(arcPos(o.p[i], o.v0[i], o.nodes[i].dt), o.p[(i + 1) % n], 1e-8);
      close3(reflect(o.vIn[i], o.n[i]), o.v0[i], 1e-8);
      expect(o.v0[i].length()).toBeCloseTo(Math.sqrt(2 * g * (o.H - o.p[i].y)), 8);
    }
    expect(o.entry).toBeTruthy();
    expect(isFinite(o.score)).toBe(true);
    expect(o.score).toBeGreaterThan(0);                          // and the layout found is clean
  });
});

describe('ricochet: dense + repetitive parts escalate to a CLEAN layout (never ship a pass-through)', () => {
  const toPart = notes => { let b = 0; return notes.map(([n, d]) => { const e = [b, n, 1]; b += d; return e; }); };
  const solve = (part, bpm, beats) => {
    const bt = 60 / bpm, Pp = ROLL_T + beats * bt + 1.2;
    return buildOrbit(eventTimes(part, { rollT: ROLL_T, beat: bt }), { P: Pp, start: START });
  };
  const mk = SONGS['mountain-king'];
  const cases = {
    'Mountain King melody': () => solve(toPart(mk.melody), mk.bpm, mk.melody.reduce((a, n) => a + n[1], 0)),
    'a repeated note (32× A4)': () => solve(Array.from({ length: 32 }, (_, i) => [i, 'A4']), 120, 32),
  };
  for (const [name, f] of Object.entries(cases)) it(`${name}: clears every plate and stem`, () => {
    const o = f();
    expect(o.score).toBeGreaterThanOrEqual(CLR);
    const a = audit(o.nodes, o, { step: .015, ceil: o.ceilY });
    expect(Math.min(a.arcPlate, a.arcCable, a.plates, a.cablePlate)).toBeGreaterThan(0);
    expect(a.foot).toBeLessThanOrEqual(o.footMax + 1e-9);
  }, 60000);
  it('the solve is deterministic (same part → bit-identical sculpture)', () => {
    const a = f => f.p.map(p => p.toArray().join()).join('|');
    expect(a(cases['a repeated note (32× A4)']())).toBe(a(cases['a repeated note (32× A4)']()));
  }, 60000);
});

describe('ricochet: rigid stems (a tilted plate needs a member that carries torque)', () => {
  it('every stem is vertical from its weld point into the canopy, and every weld point is on the plate', () => {
    for (let i = 0; i < N; i++){
      const K = orb.rim[i];
      expect(K.y).toBeLessThan(orb.ceilY);
      expect(Math.abs(K.clone().sub(orb.c[i]).dot(orb.n[i]))).toBeLessThan(1e-9);       // in the plate's plane
      expect(K.distanceTo(orb.c[i])).toBeLessThanOrEqual(orb.r[i] + 1e-9);               // on the plate
    }
    expect(CABLE_R).toBeGreaterThanOrEqual(.02);
  });
});

describe('ricochet: voice', () => {
  it('a glass ping: finite, peak ≤ .9, ~2.2 s, silent tail, pitched at the note', () => {
    for (const note of ['G#4', 'C5', 'E6']){
      const { samples, sr } = glassVoice(note);
      expect(samples.length / sr).toBeCloseTo(2.2, 2);
      let pk = 0, finite = true; for (const x of samples){ finite &&= Number.isFinite(x); pk = Math.max(pk, Math.abs(x)); }
      expect(finite).toBe(true);
      expect(pk).toBeLessThanOrEqual(.9); expect(pk).toBeGreaterThan(.5);
      expect(samples[samples.length - 1]).toBe(0);
      // the fundamental dominates its neighbourhood (a single-bin DFT over 0.1–0.6 s)
      const pow = f => { let re = 0, im = 0; for (let i = Math.round(.1 * sr); i < .6 * sr; i++){ re += samples[i] * Math.cos(2 * Math.PI * f * i / sr); im += samples[i] * Math.sin(2 * Math.PI * f * i / sr); } return re * re + im * im; };
      const f = noteHz(note);
      expect(pow(f)).toBeGreaterThan(5 * pow(f * 1.06));
      expect(pow(f)).toBeGreaterThan(5 * pow(f / 1.06));
    }
    expect(glassVoice('C5')).toBe(glassVoice('C5'));               // cached + deterministic
    expect(gateClink().samples.length).toBeGreaterThan(1000);
    const t = relayTock();                                          // the relay mirrors' soft dark tock
    let pk = 0; for (const x of t.samples){ expect(Number.isFinite(x)).toBe(true); pk = Math.max(pk, Math.abs(x)); }
    expect(t.samples.length / t.sr).toBeLessThan(.4); expect(pk).toBeLessThanOrEqual(.5); expect(t.samples[t.samples.length - 1]).toBe(0);
  });
  it('the descriptor bakes every note it plays plus the gate clink', () => {
    const ids = RICO.voiceIds(RICO.demo.part);
    expect(ids).toContain('gate'); expect(ids).toContain('relay');
    expect(RICO.voice('relay').samples).toBeInstanceOf(Float32Array);
    for (const e of RICO.demo.part) expect(ids).toContain(e[1]);
    expect(RICO.voice('gate').samples).toBeInstanceOf(Float32Array);
  });
});

describe('ricochet: descriptor + demo', () => {
  it('follows the plugin contract', () => {
    expect(RICO.key).toBe('ricochet');
    expect(RICO.wet).toBe(true);
    expect(typeof RICO.make).toBe('function');
    expect(RICO.demo.beats % 4).toBe(0);
    expect(RICO.demo.beats).toBe(32);
  });
  it('the demo is a valid monophonic 32-beat phrase', () => {
    const beats = RICO.demo.part.map(e => e[0]);
    for (let i = 0; i < beats.length; i++){
      expect(beats[i]).toBeGreaterThanOrEqual(0); expect(beats[i]).toBeLessThan(32);
      if (i) expect(beats[i]).toBeGreaterThan(beats[i - 1]);
      expect(RICO.demo.part[i][1]).toMatch(/^[A-G]#?\d$/);
    }
  });
});
