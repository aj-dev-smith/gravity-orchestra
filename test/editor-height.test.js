/* STAGE EDIT — RCT-style HEIGHT (src/editor/height.js): the knob's drag → a lift, the snapping (grid,
   the floor, a neighbour's deck = a LOFT), the keys' steps, the limits, what the readout says, and ONE
   undo step per gesture (the settle). Plus the layout writes a height gesture makes (placement.js
   placeEntry) and their undo / share-link round trip. */
import { describe, it, expect } from 'vitest';
import { FOOT, bandOf } from '../src/rooms/footing.js';
import * as Ht from '../src/editor/height.js';
import * as P from '../src/editor/placement.js';
import { encodeSong, decodeSong } from '../src/share.js';
import { SONGS } from '../src/songs/index.js';

const { snapLift, stepLift, dragLift, loftTargets, liftMax, rayPlaneY, readout, makeSettle, fmtMeters, bandName, LIFT_STEP, LIFT_BIG, MAGNET, M_PER_U, TICK_U } = Ht;

describe('height — units + names', () => {
  it('metres: 1 u ≈ .677 m (the world falls at 14.5 u/s², a true 9.81 m/s² — xrplan); the pole ticks every metre', () => {
    expect(M_PER_U).toBeCloseTo(.6766, 3);
    expect(TICK_U * M_PER_U).toBeCloseTo(1, 12);
    expect(fmtMeters(0)).toBe('0 cm');
    expect(fmtMeters(LIFT_STEP)).toBe('34 cm');                 // one grid step
    expect(fmtMeters(1)).toBe('68 cm');
    expect(fmtMeters(3)).toBe('2.0 m');
    expect(fmtMeters(18.935)).toBe('12.8 m');                   // the rear gallery
    expect(fmtMeters(18.5)).toBe('12.5 m');                     // (½ u below it — a step always shows)
    expect(fmtMeters(-2)).toBe('0 cm');
  });
  it('band names follow the footing planner\'s bands (rooms/footing.js bandOf)', () => {
    for (const h of [0, .4, .8, .81, 2, 3.5, 3.6, 9.9, 10, 10.1, 24]){
      const { band, name } = bandName(h);
      expect(band).toBe(bandOf(h));
      expect(name).toBe({ flush: 'FLOOR', low: 'RISER', mid: 'PLATFORM', high: 'TOWER' }[band]);
    }
  });
  it('the readout: metres + band, AUTO when the layout decides, the loft mates by name', () => {
    expect(readout({ lift: 0, user: undefined, h: .4 })).toEqual({ value: 'ON THE FLOOR', band: 'flush', name: 'FLOOR', floor: true, auto: true, loft: '' });
    expect(readout({ lift: 0, user: 0, h: .4 }).auto).toBe(false);          // an explicit "on the floor"
    const r = readout({ lift: 3, user: 3, h: 3.4, loft: ['String Bass'] });
    expect(r).toEqual({ value: '+2.0 m', band: 'low', name: 'RISER', floor: false, auto: false, loft: 'LOFT · String Bass' });
    expect(readout({ lift: 18.935, h: 19.3, loft: ['Riff Forge', 'Marble Autoharp'] })).toMatchObject({ value: '+12.8 m', name: 'TOWER', auto: true, loft: 'LOFT · Riff Forge + Marble Autoharp' });
  });
});

describe('height — limits', () => {
  it('liftMax: FOOT.LIFT_MAX, and the machine\'s top a metre-ish under the ceiling', () => {
    expect(liftMax({})).toBe(FOOT.LIFT_MAX);
    expect(liftMax({ lift: 0, top: 0, ceil: 36 })).toBe(FOOT.LIFT_MAX);                  // a low room-high ceiling: the tower is the limit
    expect(liftMax({ lift: 0, top: 20, ceil: 36 })).toBeCloseTo(36 - Ht.CEIL_GAP - 20, 12); // a tall machine: the ceiling is
    expect(liftMax({ lift: 5, top: 25, ceil: 36 })).toBeCloseTo(5 + 36 - 1 - 25, 12);        // (from where it stands now)
    expect(liftMax({ lift: 0, top: 40, ceil: 36 })).toBe(0);                              // never below the floor
  });
  it('snapLift clamps to [0, max] — a drag can\'t sink it through the floor or push it through the roof', () => {
    expect(snapLift(-4).lift).toBe(0);
    expect(snapLift(99).lift).toBe(FOOT.LIFT_MAX);
    expect(snapLift(99, { max: 7.3 }).lift).toBe(7.3);                    // (the limit itself, off the grid)
    expect(snapLift(7.2, { max: 7.3 }).lift).toBe(7.3);
    expect(snapLift(NaN).lift).toBe(0);
  });
});

describe('height — snapping (grid, floor, a neighbour\'s deck)', () => {
  it('the ½-u grid; Shift = free', () => {
    expect(snapLift(1.2)).toEqual({ lift: 1, magnet: null });
    expect(snapLift(1.3)).toEqual({ lift: 1.5, magnet: null });
    expect(snapLift(1.3, { free: true })).toEqual({ lift: 1.3, magnet: null });
  });
  it('the FLOOR is magnetic (a smaller catch when free)', () => {
    expect(snapLift(MAGNET.floor - .01)).toEqual({ lift: 0, magnet: { kind: 'floor' } });
    expect(snapLift(.4).lift).toBe(.5);
    expect(snapLift(.15, { free: true })).toEqual({ lift: 0, magnet: { kind: 'floor' } });
    expect(snapLift(.25, { free: true }).lift).toBe(.25);
  });
  it('a neighbour\'s deck is magnetic — inside LOFT_DY they share a loft anyway; the magnet makes it exact', () => {
    const targets = [{ key: 'bass', label: 'String Bass', lift: 3.27 }];
    expect(snapLift(3.5, { targets })).toEqual({ lift: 3.27, magnet: { kind: 'loft', key: 'bass', label: 'String Bass' } });
    expect(snapLift(3.27 + FOOT.LOFT_DY - .01, { targets }).lift).toBe(3.27);
    expect(snapLift(3.27 + FOOT.LOFT_DY + .05, { targets }).lift).toBe(4);           // past the catch: the grid
    expect(snapLift(3.5, { targets, free: true }).lift).toBe(3.5);                    // free: a gentle detent only
    expect(snapLift(3.35, { targets, free: true }).lift).toBe(3.27);
    // the nearer of two; a target past the limit never catches
    const two = [{ key: 'a', lift: 3 }, { key: 'b', lift: 3.4 }];
    expect(snapLift(3.3, { targets: two }).magnet.key).toBe('b');
    expect(snapLift(3.3, { targets: [{ key: 'a', lift: 3.4 }], max: 3.3 }).lift).toBe(3.3);
  });
  it('loftTargets: only raised, closed, movable neighbours within the planner\'s reach — at their deck', () => {
    const self = { bottom0: -5.1, box: [0, 4, 0, 4] };
    const near = { key: 'bass', label: 'String Bass', top: -2.1, box: [5, 9, 0, 4], raised: true };
    expect(loftTargets(self, [near])).toEqual([{ key: 'bass', label: 'String Bass', lift: 3 }]);    // (exact: no float dust)
    const reach = FOOT.LOFT_GAP + 2 * FOOT.MARGIN;
    expect(loftTargets(self, [{ ...near, box: [4 + reach - .01, 9, 0, 4] }])).toHaveLength(1);
    expect(loftTargets(self, [{ ...near, box: [4 + reach + .01, 9, 0, 4] }])).toHaveLength(0);       // too far: no loft
    expect(loftTargets(self, [{ ...near, raised: false }])).toHaveLength(0);                          // on the floor: nothing to share
    expect(loftTargets(self, [{ ...near, open: true }])).toHaveLength(0);                             // an open stand gets posts, not a deck
    expect(loftTargets(self, [{ ...near, fixed: true }])).toHaveLength(0);
    expect(loftTargets(self, [{ ...near, top: -5.1 }])).toHaveLength(0);                              // (level with the floor plinth)
    // nearest first
    const far = { ...near, key: 'z', top: 9 }, lo = { ...near, key: 'a', top: 0 };
    expect(loftTargets(self, [far, lo]).map(t => t.key)).toEqual(['a', 'z']);
  });
});

describe('height — the knob\'s drag (pointer ray → the vertical plane through the pole → a lift)', () => {
  const eye = { x: 0, y: 12, z: 20 }, at = { x: 0, y: 0, z: 0 };
  const rayTo = (px, py, pz) => { const d = { x: px - eye.x, y: py - eye.y, z: pz - eye.z }, L = Math.hypot(d.x, d.y, d.z); return { o: eye, d: { x: d.x / L, y: d.y / L, z: d.z / L } }; };
  it('rayPlaneY: the plane faces the eye — a ray through a point on it returns that point\'s height', () => {
    for (const y of [-5, 0, 3.3, 17]){
      const { o, d } = rayTo(2, y, 0);                                     // (sideways along the plane too)
      expect(rayPlaneY(o, d, at, eye)).toBeCloseTo(y, 9);
    }
  });
  it('rayPlaneY: null when the ray runs along the plane (a look straight down it) or the plane is behind', () => {
    expect(rayPlaneY(eye, { x: 0, y: -1, z: 0 }, at, eye)).toBe(null);
    const { d } = rayTo(0, 0, 0);
    expect(rayPlaneY(eye, { x: -d.x, y: -d.y, z: -d.z }, at, eye)).toBe(null);
    expect(rayPlaneY(eye, d, { x: 0, y: 0, z: 0 }, { x: 0, y: 5, z: 0 })).toBe(null);   // (eye over the pole: no horizontal facing)
  });
  it('dragLift is RELATIVE: the lift moves with the plane point, wherever the knob was grabbed', () => {
    const y0 = rayPlaneY(...Object.values(rayTo(0, 2.9, 0)), at, eye);            // grabbed a little off the knob
    for (const [dy, want] of [[0, 2], [1.2, 3], [3.1, 5], [-1.6, .5], [-1.9, 0], [-9, 0]]){
      const y = rayPlaneY(...Object.values(rayTo(0, 2.9 + dy, 0)), at, eye);
      expect(dragLift({ lift0: 2, y0, y }).lift).toBeCloseTo(want, 9);
    }
    // free: exactly the pointer; a loft target catches on the way
    const y = rayPlaneY(...Object.values(rayTo(0, 2.9 + 1.13, 0)), at, eye);
    expect(dragLift({ lift0: 2, y0, y, free: true }).lift).toBeCloseTo(3.13, 9);
    expect(dragLift({ lift0: 2, y0, y, targets: [{ key: 'bass', lift: 3.27 }] })).toEqual({ lift: 3.27, magnet: { kind: 'loft', key: 'bass', label: undefined } });
  });
});

describe('height — the keys / ▲ ▼ steps', () => {
  it('one step = the next grid line that way; Shift = 2 u, then the grid; Home = 0 (the caller)', () => {
    expect(stepLift(0, 1).lift).toBe(.5);
    expect(stepLift(.5, 1).lift).toBe(1);
    expect(stepLift(1, -1).lift).toBe(.5);
    expect(stepLift(.5, -1)).toEqual({ lift: 0, magnet: { kind: 'floor' } });
    expect(stepLift(0, -1).lift).toBe(0);
    expect(stepLift(1.5, 1, { big: true }).lift).toBe(1.5 + LIFT_BIG);
    expect(stepLift(1.3, 1, { big: true }).lift).toBe(3.5);                    // (2 up, onto the grid)
    expect(stepLift(1, -1, { big: true }).lift).toBe(0);
  });
  it('a lift off the grid (the gallery\'s, a free drag\'s) steps ONTO the grid, not past it', () => {
    expect(stepLift(18.935, -1).lift).toBe(18.5);
    expect(stepLift(18.935, 1).lift).toBe(19);
    expect(stepLift(1.3, 1).lift).toBe(1.5);
    expect(stepLift(1.3, -1).lift).toBe(1);
  });
  it('the limit: a step that would pass it lands ON it', () => {
    expect(stepLift(7, 1, { max: 7.3 }).lift).toBe(7.3);
    expect(stepLift(7.3, 1, { max: 7.3 }).lift).toBe(7.3);
    expect(stepLift(FOOT.LIFT_MAX, 1).lift).toBe(FOOT.LIFT_MAX);
  });
  it('a neighbour\'s deck on the way is a step of its own (a loft), both ways', () => {
    const targets = [{ key: 'bass', label: 'String Bass', lift: 3.27 }];
    expect(stepLift(3, 1, { targets })).toEqual({ lift: 3.27, magnet: { kind: 'loft', key: 'bass', label: 'String Bass' } });
    expect(stepLift(3.27, 1, { targets }).lift).toBe(3.5);
    expect(stepLift(3.27, -1, { targets }).lift).toBe(3);
    expect(stepLift(4, -1, { targets }).lift).toBe(3.27);                        // (3.5 is within the deck's catch: it lands ON the deck)
    expect(stepLift(3.5, -1, { targets }).lift).toBe(3.27);
    expect(stepLift(0, 1, { big: true, targets }).lift).toBe(2);                 // a big step that lands well short of it
    expect(stepLift(1, 1, { big: true, targets }).lift).toBe(3.27);              // …one that lands inside its catch
    expect(stepLift(2, 1, { big: true, targets }).lift).toBe(3.27);              // …and one that passes it
    // the gallery: ▼ from a loft mate's deck isn't caught by that same deck
    expect(stepLift(18.935, -1, { targets: [{ key: 'strum', lift: 18.935 }] }).lift).toBe(18.5);
    expect(stepLift(18.5, 1, { targets: [{ key: 'strum', lift: 18.935 }] }).lift).toBe(18.935);
  });
});

describe('height — one undo step per gesture (the settle)', () => {
  const fake = () => { let t = 0, id = 0; const q = new Map(); return {
    set: (f, ms) => { q.set(++id, { f, at: t + ms }); return id; }, clear: h => q.delete(h),
    tick(ms){ t += ms; for (const [k, v] of [...q]) if (v.at <= t){ q.delete(k); v.f(); } }, get n(){ return q.size; } }; };
  it('a burst of taps / key repeats settles ONCE, ms after the last', () => {
    const T = fake(), S = makeSettle(700, T); let n = 0;
    S.poke(() => n++); T.tick(300); S.poke(() => n++); T.tick(300); S.poke(() => n++);
    expect(S.pending).toBe(true); T.tick(699); expect(n).toBe(0);
    T.tick(1); expect(n).toBe(1); expect(S.pending).toBe(false);
    T.tick(5000); expect(n).toBe(1);
  });
  it('flush runs a pending settle now (a new gesture, an undo, a song change); cancel drops it', () => {
    const T = fake(), S = makeSettle(700, T); let n = 0;
    S.flush(); expect(n).toBe(0);                                                // (nothing pending: nothing runs)
    S.poke(() => n++); S.flush(); expect(n).toBe(1); T.tick(1000); expect(n).toBe(1);
    S.poke(() => n++); S.cancel(); T.tick(1000); expect(n).toBe(1); expect(T.n).toBe(0);
  });
  it('the editor\'s window outlasts an OS key-repeat delay (~.5 s): a held PgUp is ONE gesture', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../src/editor/stage-edit.js', import.meta.url), 'utf8');
    expect(+src.match(/const SETTLE_MS = (\d+)/)[1]).toBeGreaterThanOrEqual(600);
  });
});

describe('height — the layout a gesture writes (placement.js placeEntry), undo, share', () => {
  const all = [{ key: 'marimba', x: 10, z: -10, yaw: .5 }, { key: 'horns', x: 25, z: -20, yaw: 0 }, { key: 'drums', x: 29, z: 19, yaw: 0 }];
  const cx = 10;
  it('the first edit pins the room as it stands; a height is the user\'s word for that machine only', () => {
    const L = P.placeEntry({}, 'marimba', { x: 0, z: -10, yaw: .5, lift: 3 }, all, { cx });
    expect(L).toEqual({ marimba: { x: 0, z: -10, yaw: .5, lift: 3 }, horns: { x: 15, z: -20, yaw: 0 }, drums: { x: 19, z: 19, yaw: 0 } });
    expect(L.horns).not.toHaveProperty('lift');                                  // (the gallery raise stays the solve's)
  });
  it('0 is kept (ON THE FLOOR outranks the gallery raise); null forgets it (AUTO); absent keeps it', () => {
    const L0 = { marimba: { x: 0, z: -10, yaw: .5, lift: 3 }, horns: { x: 15, z: -20, yaw: 0 } };
    expect(P.placeEntry(L0, 'horns', { x: 15, z: -20, yaw: 0, lift: 0 }).horns).toEqual({ x: 15, z: -20, yaw: 0, lift: 0 });
    expect(P.placeEntry(L0, 'marimba', { x: 0, z: -10, yaw: .5, lift: null }).marimba).toEqual({ x: 0, z: -10, yaw: .5 });
    expect(P.placeEntry(L0, 'marimba', { x: 4, z: -10, yaw: .5 }).marimba).toEqual({ x: 4, z: -10, yaw: .5, lift: 3 });   // a move keeps it
    // the live height wins over the stored one (mid-gesture, the machine is already there)
    expect(P.placeEntry(L0, 'marimba', { x: 4, z: -10, yaw: .5 }, [], { liftOf: k => k === 'marimba' ? 5.5 : undefined }).marimba.lift).toBe(5.5);
    expect(L0.marimba.lift).toBe(3);                                             // (pure)
    // an AUTO round trip leaves no trace of a lift in the stored / shared form
    const E = P.encodeLayout(P.placeEntry(L0, 'marimba', { x: 0, z: -10, yaw: .5, lift: null }));
    expect(E.marimba).toEqual([0, -10, .5]);
  });
  it('undo restores the layout before the gesture EXACTLY — "no user height" included', () => {
    const H = P.makeHistory(), L0 = { marimba: { x: 0, z: -10, yaw: .5 }, drums: { x: 19, z: 19, yaw: 0, lift: 2 } };
    H.push('s', L0);                                                             // (liftBegin: the layout as it was)
    let L = L0;
    for (const u of [.5, 1, 1.5, 2]) L = P.placeEntry(L, 'marimba', { x: 0, z: -10, yaw: .5, lift: u });   // (liftWrite, every step)
    expect(L.marimba.lift).toBe(2);
    const back = H.pop('s');
    expect(back).toEqual(L0); expect(back.marimba).not.toHaveProperty('lift');
    expect(H.pop('s')).toBe(null);                                               // ONE step for the whole gesture
  });
  it('heights travel in a share link and survive the trip exactly (the editor\'s own encode)', async () => {
    const L = P.placeEntry({}, 'marimba', { x: 0, z: -10, yaw: .5, lift: 3 }, all, { cx, liftOf: k => k === 'drums' ? 2 : undefined });
    const S = { ...SONGS['ode-to-joy'], stage: P.encodeLayout(L) };
    const back = await decodeSong(await encodeSong(S));
    expect(P.sanitizeLayout(back.stage)).toEqual(P.sanitizeLayout(L));
    expect(P.sanitizeLayout(back.stage).drums.lift).toBe(2);
    expect(P.sanitizeLayout(back.stage).horns).not.toHaveProperty('lift');
  });
});
