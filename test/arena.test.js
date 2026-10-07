import { describe, it, expect } from 'vitest';
import { solveArenaCues, lastFire, JETS, CANNONS, JET_BURN, CO2_BURN } from '../src/rooms/arena-cues.js';
import { SONGS } from '../src/songs/index.js';
import { ROLL_T } from '../src/engine.js';

/* THE METAL ARENA's cue sheet (src/rooms/arena-cues.js): pyro / CO2 / blinders solved at song
   load from the drum lanes, played back as a pure fn of songTime over a CONSTANT pool. */
const timing = S => {
  const beat = 60 / S.bpm, loopBeats = S.melody.reduce((a, n) => a + n[1], 0);
  return { beat, loopBeats, P: ROLL_T + loopBeats * beat + 1.2, rollT: ROLL_T };   // (main.js: P = ROLL_T + LOOP_T)
};
const sheet = S => solveArenaCues({ drums: S.drums, melody: S.melody, ...timing(S) });
const sepOK = (list, burn, P) => {                         // every pair of firings ≥ burn apart, across the seam too
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++){
    const d = Math.abs(list[i][0] - list[j][0]);
    if (Math.min(d, P - d) < burn - 1e-9) return false;
  }
  return true;
};

describe('arena cues: solved from the drum lanes', () => {
  const BB = { bpm: 96, melody: [['E3', 16]], drums: {
    kick: [0, 2.5, 4, 6.5, 8, 10.5, 12], snare: [2, 6, 10], crash: [[0, 1], [8, .85]], hat: [0, .5, 1, 1.5] } };

  it('a crash fires every jet + the blinders; the loop head always fires the CO2 cannons', () => {
    const r = sheet(BB), { beat } = timing(BB);
    const at = b => r.events.find(e => Math.abs(e.beat - b) < 1e-9);
    expect(at(0).kind).toBe('big');                         // crash ON the loop head: one moment, the bigger reading
    expect(at(0).jets.length).toBe(JETS);
    expect(at(0).co2.length).toBe(CANNONS);
    expect(at(8).kind).toBe('big');
    expect(r.blind.map(b => b[0])).toEqual([ROLL_T, ROLL_T + 8 * beat]);
  });

  it('downbeat kicks pop ONE mirrored pair of jets, round-robin across the rig', () => {
    const r = sheet(BB);
    const pops = r.events.filter(e => e.kind === 'pop');
    expect(pops.map(e => e.beat)).toEqual([4, 12]);         // (0 and 8 are crashes; 2.5 / 6.5 / 10.5 are off the bar line)
    for (const p of pops){ expect(p.jets.length).toBe(2); expect(p.jets[1]).toBe(p.jets[0] + 1); expect(p.jets[0] % 2).toBe(0); }
    expect(pops[0].jets[0]).not.toBe(pops[1].jets[0]);
  });

  it('a kick + snare stab pops even off the bar line', () => {
    const r = sheet({ bpm: 120, melody: [['C4', 8]], drums: { kick: [0, 3, 6], snare: [3] } });
    expect(r.events.some(e => e.beat === 3 && e.kind === 'pop')).toBe(true);
    expect(r.events.some(e => e.beat === 6)).toBe(false);    // a plain off-bar kick: nothing
  });

  it('the drums coming back in after a silent bar is a section (CO2)', () => {
    const r = sheet({ bpm: 120, melody: [['C4', 16]], drums: { kick: [[0, .3], [8, .3]], hat: [4, 5] } });
    const sec = r.events.filter(e => e.co2.length).map(e => e.beat);
    expect(sec).toEqual([0, 8]);                            // bar 2 (beats 8–12) re-enters after bar 1's hat-only bar
  });

  it('no drums: the loop head is the section and the longest holds pop', () => {
    const mel = [['C4', 1], ['E4', 3], ['G4', 1], ['C5', 2], ['A4', 1]];
    expect(sheet({ bpm: 40, melody: mel }).events.map(e => [e.beat, e.kind])).toEqual([[0, 'section'], [1, 'pop'], [5, 'pop']]);
    // at 100 bpm beat 1 is .6 s after the loop head took every jet: still burning → that pop is DROPPED, never stacked
    expect(sheet({ bpm: 100, melody: mel }).events.map(e => [e.beat, e.kind])).toEqual([[0, 'section'], [5, 'pop']]);
  });

  it('THE POOL IS CONSTANT: no device is re-fired while it burns (every song, across the seam)', () => {
    for (const [k, S] of Object.entries(SONGS)){
      const r = sheet(S), { P, loopBeats } = timing(S);
      expect(r.jets.length, k).toBe(JETS); expect(r.co2.length, k).toBe(CANNONS);
      for (const l of r.jets) expect(sepOK(l, JET_BURN, P), `${k}: a jet fired while burning`).toBe(true);
      for (const l of r.co2) expect(sepOK(l, CO2_BURN, P), `${k}: a cannon fired while blowing`).toBe(true);
      for (const e of r.events){ expect(e.beat >= 0 && e.beat < loopBeats, k).toBe(true); expect(e.vel > 0 && e.vel <= 1, k).toBe(true); }
      expect(r.events[0].beat, k).toBe(0);                  // every song gets the loop head
    }
  });

  it('is deterministic (solved once per song, the same sheet every time)', () => {
    for (const S of Object.values(SONGS)) expect(sheet(S)).toEqual(sheet(S));
  });
});

describe('arena playback: a pure fn of songTime', () => {
  const S = SONGS['mountain-king'], r = sheet(S), { P } = timing(S);
  it('age since the last firing wraps the loop like every strike, and nothing fired before the count-in', () => {
    const j = r.jets.findIndex(l => l.length);
    const u = r.jets[j][0][0];
    expect(lastFire(r.jets[j], u + .3, P, -2.4).age).toBeCloseTo(.3, 9);
    expect(lastFire(r.jets[j], u + .3 + 3 * P, P, -2.4).age).toBeCloseTo(.3, 9);    // three loops on: identical
    expect(lastFire(r.jets[j], -2.4, P, -2.4).age).toBe(Infinity);                  // the count-in: the rig is cold
    expect(lastFire([], 5, P).age).toBe(Infinity);
  });
  it('fills a caller-owned out object in place (the room reads it every frame: no allocation)', () => {
    const j = r.jets.findIndex(l => l.length), u = r.jets[j][0][0], out = { age: 0, row: null };
    expect(lastFire(r.jets[j], u + .3, P, -2.4, out)).toBe(out);
    expect(out.age).toBeCloseTo(.3, 9); expect(out.row).toBe(r.jets[j][0]);
    lastFire(r.jets[j], -2.4, P, -2.4, out);
    expect(out.age).toBe(Infinity); expect(out.row).toBe(null);
  });
  it('scrub-safe: any order of evaluation gives the same answer (no state)', () => {
    const ts = Array.from({ length: 200 }, (_, i) => -2.4 + i * .37);
    const fwd = ts.map(t => r.jets.map(l => lastFire(l, t, P, -2.4).age));
    const rev = [...ts].reverse().map(t => r.jets.map(l => lastFire(l, t, P, -2.4).age)).reverse();
    expect(rev).toEqual(fwd);
  });
});
