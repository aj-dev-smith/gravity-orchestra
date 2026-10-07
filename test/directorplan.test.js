import { describe, it, expect } from 'vitest';
import { planEdit, shotAt, rideSpan, signatureOf, PLAN } from '../src/directorplan.js';

// a synthetic room: 120 bpm (beat .5 s), 96 beats of music from t0 = 1
const beat = .5, t0 = 1, N = 96, end = t0 + N * beat;
const at = b => t0 + b * beat;
const every = (from, to, step, w = .7) => { const h = []; for (let b = from; b < to; b += step) h.push({ t: at(b), w }); return h; };
const room = () => [
  { key: 'marimba', hits: every(0, N, .5) },                       // busy all loop (an ostinato)
  { key: 'bowls', hits: every(0, N, 4) },                          // sparse but present all loop
  { key: 'drums', hits: [...every(60, 64, .25, .3).map((h, i) => ({ ...h, w: .3 + i * .04 })), { t: at(64), w: .9 }] },   // a lone roll
  { key: 'bells', hits: [...every(16, 20, 1, .8), ...every(72, 76, 1, .8)] },   // two climaxes
  { key: 'belt', belt: true, hits: every(0, N, 1) },
];
const grid = { t0, beat, end };
const secs = (p, k) => p.shares[k] * N * beat;

describe('directorplan — the edit, solved up front', () => {
  it('gives a sparse machine its big moment (the drums\' only roll gets the camera, on it)', () => {
    const p = planEdit({ voices: room(), grid });
    expect(p.shares.drums).toBeGreaterThan(0);
    const drumCut = p.cuts.find(c => c.key === 'drums');
    expect(drumCut.t).toBeGreaterThanOrEqual(at(56));
    expect(drumCut.t).toBeLessThanOrEqual(at(64));
  });

  it('caps every share — the busy machine and the belt never hog the film (the caps fit this room)', () => {
    const p = planEdit({ voices: room(), grid });
    expect(p.shares.belt ?? 0).toBeLessThanOrEqual(PLAN.CAP.belt + 1e-9);
    expect(p.shares.marimba ?? 0).toBeLessThanOrEqual(PLAN.CAP.station + 1e-9);
    expect(p.shares.stage ?? 0).toBeLessThanOrEqual(PLAN.CAP.stage + 1e-9);
  });

  it('covers every machine that plays at least once a loop', () => {
    const p = planEdit({ voices: room(), grid });
    for (const k of ['marimba', 'bowls', 'drums', 'bells', 'belt']) expect(p.shares[k] ?? 0).toBeGreaterThan(0);
  });

  it('cuts land on beats, hold ≥ MIN_HOLD (bar the grid end), and never cut to the same shot', () => {
    const p = planEdit({ voices: room(), grid });
    p.cuts.forEach((c, i) => {
      const b = (c.t - t0) / beat;
      expect(Math.abs(b - Math.round(b))).toBeLessThan(1e-6);
      const next = p.cuts[i + 1]?.t ?? end;
      if (i + 1 < p.cuts.length) expect(next - c.t).toBeGreaterThanOrEqual(PLAN.MIN_HOLD - 1e-6);
      if (i) expect(c.key).not.toBe(p.cuts[i - 1].key);
    });
  });

  it('an entrance after a long rest pulls the camera onto it', () => {
    const voices = [
      { key: 'strings', hits: every(0, N, 1) },
      { key: 'musicbox', hits: every(32, N, 1) },                  // comes in at beat 32
      { key: 'belt', belt: true, hits: every(0, N, 1) },
    ];
    const p = planEdit({ voices, grid });
    expect(shotAt(p, at(33), end)).toBe('musicbox');
  });

  it('scripted shots are fixed points — held exactly, exempt from the caps', () => {
    const p = planEdit({ voices: room(), grid, fixed: [{ t: at(8), len: 40 * beat, key: 'lead' }] });
    for (let b = 8; b < 48; b += 2) expect(shotAt(p, at(b) + .01, end)).toBe('lead');
  });

  it('a big ensemble downbeat earns the wide', () => {
    const p = planEdit({ voices: room(), grid, wides: [at(40)] });
    expect(shotAt(p, at(40) + .01, end)).toBe('stage');
  });

  it('shotAt: the roll-in and the seam are the wide; is deterministic', () => {
    const p = planEdit({ voices: room(), grid });
    expect(shotAt(p, 0, end)).toBe('stage');
    expect(shotAt(p, end + .1, end)).toBe('stage');
    expect(planEdit({ voices: room(), grid }).cuts).toEqual(p.cuts);
  });

  // ---- RIDE THE BALL (ridecam.js): a long, tall flight the director may ride ----
  const lob = { t: at(40), dt: 2.2, w: 1, role: 'bass' };       // the room's one big pedal lob (≈ 4.4 beats)

  it('rides THE big flight: a ride shot covering its launch → landing, cut on beats', () => {
    const p = planEdit({ voices: room(), grid, rides: [lob, { t: at(10), dt: .9, w: .15, role: 'lead' }] });
    expect(p.rides.length).toBe(1);
    const w = p.rides[0];
    expect(w.role).toBe('bass');
    expect(w.t0).toBeLessThanOrEqual(lob.t - .3);                 // the cut lands before the launch…
    expect(w.t1).toBeGreaterThanOrEqual(lob.t + lob.dt);          // …and holds through the landing
    for (const x of [w.t0, w.t1]) expect(Math.abs((x - t0) / beat - Math.round((x - t0) / beat))).toBeLessThan(1e-6);
    expect(w.t1 - w.t0).toBeGreaterThanOrEqual(PLAN.MIN_HOLD - 1e-6);
    expect(shotAt(p, lob.t + 1, end)).toBe('ride');
    expect(shotAt(p, w.t0 - .01, end)).not.toBe('ride');          // only its own window
    expect(shotAt(p, w.t1 + .01, end)).not.toBe('ride');
    expect(p.shares.drums ?? 0).toBeGreaterThan(0);                // the rest of the edit still covers every machine
    expect(p.shares.bells ?? 0).toBeGreaterThan(0);
  });

  it('rides are sparing: many tall flights still share at most a slice of the loop; none → no ride at all', () => {
    const many = []; for (let b = 2; b < N - 6; b += 6) many.push({ t: at(b), dt: 1.6, w: 1, role: 'lead' });
    const p = planEdit({ voices: room(), grid, rides: many });
    expect(p.rides.length).toBeGreaterThan(0);
    expect(p.shares.ride).toBeLessThanOrEqual(.25);
    expect(planEdit({ voices: room(), grid }).shares.ride).toBeUndefined();
  });

  it('a short loop rides only every rideEvery-th pass: the long-run ride share stays ≤ RIDE_LONGRUN', () => {
    const p = planEdit({ voices: room(), grid, rides: [lob] });
    expect(p.rideEvery).toBe(1);                                   // a 48 s loop: one ~4 s ride every pass
    const n = 28, g = { t0, beat, end: at(n) }, short = { ...lob, t: at(2) };    // a 14 s loop, the same lob
    const v = [{ key: 'marimba', hits: every(0, n, .5) }, { key: 'bowls', hits: every(0, n, 4) }, { key: 'belt', belt: true, hits: every(0, n, 1) }];
    const q = planEdit({ voices: v, grid: g, rides: [short] });
    expect(q.rides.length).toBe(1);
    const share = (q.rides[0].t1 - q.rides[0].t0) / (n * beat);
    expect(share).toBeGreaterThan(PLAN.RIDE_LONGRUN);
    expect(q.rideEvery).toBeGreaterThan(1);
    expect(share / q.rideEvery).toBeLessThanOrEqual(PLAN.RIDE_LONGRUN + 1e-9);
    expect(planEdit({ voices: room(), grid }).rideEvery).toBe(1);
  });

  it('a ride never overrides a scripted shot; rideSpan squeezes a very long flight to RIDE_MAX (+ the beat snap)', () => {
    const p = planEdit({ voices: room(), grid, rides: [lob], fixed: [{ t: at(38), len: 8 * beat, key: 'stage' }] });
    expect(p.rides.length).toBe(0);
    for (let b = 38; b < 46; b++) expect(shotAt(p, at(b) + .01, end)).toBe('stage');
    const w = rideSpan([{ t: at(10), dt: 6.2, w: 1, role: 'bass' }], at(8), at(30), { t0, beat, end });
    expect(w.t0).toBeLessThan(at(10));
    expect(w.t1).toBeGreaterThanOrEqual(at(10) + 6.2);
    expect(w.t1 - w.t0).toBeLessThanOrEqual(PLAN.RIDE_MAX + 2 * beat + 1e-6);
  });

  // ---- THE SIGNATURE: the machine an imported song is ABOUT (a rock band's riff) ----
  // A synthetic rock room: the riff chugs 8ths all loop through a moving power-chord figure
  // (heavy, varied, never "above its norm"); the bass pedals E under it; the drums groove and
  // FILL into every 8th bar (crescendos + tom entrances); the vocal belt sings phrases.
  const CHORDS = ['E2+B2', 'E2+B2', 'D3+A3', 'E2+B2', 'C3+G3', 'E2+B2', 'A#2+F3', 'A2+E3'];
  const rock = () => {
    const riff = [], bass = [], drums = [], belt = [], organ = [];
    for (let b = 0; b < N; b += .5) riff.push({ t: at(b), w: 1.2, id: CHORDS[(b * 2) % 8] });
    for (let b = 8; b < N; b += .5) bass.push({ t: at(b), w: .8, id: (b * 2) % 8 === 6 ? 'G1' : 'E1' });
    for (let b = 0; b < N; b += .5){
      const fill = b % 16 >= 14;                                   // the fill bar: toms, louder and louder
      drums.push({ t: at(b), w: fill ? .6 + (b % 16 - 14) * .3 : .5, id: fill ? 'tomHigh+snare' : b % 2 ? 'snare+hat' : 'kick+hat' });
    }
    for (let b = 32; b < N; b += 4) organ.push({ t: at(b), w: .7, id: 'E3+G3+B3' });   // a pad enters halfway
    for (let b = 4; b < N; b += 16) for (let k = 0; k < 10; k++) belt.push({ t: at(b + k), w: .6 });
    return [{ key: 'riff', hits: riff }, { key: 'strings', hits: bass }, { key: 'drums', perc: true, hits: drums },
            { key: 'organ', hits: organ }, { key: 'belt', belt: true, hits: belt }];
  };
  const withSig = (vs, key) => vs.map(v => v.key === key ? { ...v, signature: true } : v);

  it('signatureOf: the hook is the present, varied, heavy PITCHED machine — never the belt or the kit', () => {
    expect(signatureOf(rock(), grid)).toBe('riff');
    // the kit alone has the most varied shapes here, but percussion never competes; nor the belt
    const kitOnly = rock().filter(v => v.key !== 'riff' && v.key !== 'strings');
    expect(signatureOf(kitOnly, grid)).toBeNull();
    // a hook that plays only the last quarter of the loop is no signature (it's an entrance)
    const late = rock().map(v => v.key === 'riff' ? { ...v, hits: v.hits.filter(h => h.t >= at(72)) } : v);
    expect(signatureOf(late, grid)).not.toBe('riff');
  });

  it('signatureOf: two co-equal machines → no signature (the edit stays balanced)', () => {
    const twin = rock().map(v => v.key === 'strings' ? { ...v, hits: v.hits.map((h, i) => ({ ...h, w: 1.2, id: CHORDS[i % 8] + '+x' })) } : v);
    expect(signatureOf(twin, grid)).toBeNull();
  });

  it('without a signature the steady riff is starved; with one it gets the most screen time, inside its cap', () => {
    const plain = planEdit({ voices: rock(), grid });
    const sig = planEdit({ voices: withSig(rock(), 'riff'), grid });
    expect(plain.shares.riff ?? 0).toBeLessThan(.12);               // the symptom: the fills + entrances win every shot
    expect(Math.max(...Object.values(plain.shares))).toBe(plain.shares.drums);
    expect(sig.shares.riff).toBeGreaterThan(.25);
    expect(sig.shares.riff).toBeLessThanOrEqual(PLAN.CAP.signature + 1e-9);
    for (const [k, v] of Object.entries(sig.shares)) if (k !== 'riff') expect(v).toBeLessThan(sig.shares.riff);
    for (const k of ['strings', 'drums', 'organ', 'belt']) expect(sig.shares[k] ?? 0).toBeGreaterThan(0);   // coverage still holds
    expect(sig.shares.drums).toBeLessThanOrEqual(PLAN.CAP.station + 1e-9);
    // (this room can't fit every cap — the belt's phrases outbid the rest — but the edit overshoots no more than without)
    const over = p => Object.entries(p.shares).reduce((a, [k, v]) => a + Math.max(0, v - (k === 'belt' ? PLAN.CAP.belt : k === 'stage' ? PLAN.CAP.stage : k === 'riff' && p === sig ? PLAN.CAP.signature : PLAN.CAP.station)), 0);
    expect(over(sig)).toBeLessThanOrEqual(over(plain) + 1e-9);
    // the drums' fills still pull the camera when they happen
    expect(sig.cuts.some(c => c.key === 'drums')).toBe(true);
  });

  it('the signature\'s cap is a price: its share lands near the cap, not wherever a ×.8 pull step falls', () => {
    const p = planEdit({ voices: withSig(rock(), 'riff'), grid });
    // within one minimum-hold shot of its cap (the edit is discrete)
    expect(p.shares.riff).toBeGreaterThan(PLAN.CAP.signature - Math.round(PLAN.MIN_HOLD / beat) / N - 1e-9);
    // deterministic (a pure fn of the song data)
    expect(planEdit({ voices: withSig(rock(), 'riff'), grid }).cuts).toEqual(p.cuts);
  });

  it('a room without a signature plans exactly as before (the curated rooms are untouched)', () => {
    const vs = room();
    expect(planEdit({ voices: vs.map(v => ({ ...v, signature: false })), grid }).cuts).toEqual(planEdit({ voices: vs, grid }).cuts);
    expect(signatureOf(room(), grid)).toBeNull();                 // (hits without ids: nothing says what they play — no hook)
  });
});

