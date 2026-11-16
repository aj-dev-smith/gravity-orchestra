import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FOOT, bandOf, groundOf, clampLift } from '../src/rooms/footing.js';
import { STAGE } from '../src/rooms/common.js';
import { INSTRUMENTS } from '../src/instruments/index.js';
import { STATIONS, stationFor } from '../src/instruments/stations.js';
import { glowy } from '../src/shotrig.js';
import { makeMarbleDrums, KIT_STAND } from '../src/marbledrums.js';
import { DECK_UNDER } from '../src/drumlook.js';
import { SONGS } from '../src/songs/index.js';

/* FOOTING — machines SET IN THE ROOM (src/rooms/footing.js): main builds every floor station
   supportless (floorY 0), measures its lowest SOLID part over the loop and stands it on the
   floor's plinth at its ground (deck = FLOOR + PLINTH − low), or as high as the user lifts it. */

describe('footing: the height law', () => {
  it('the floor came up (the June conveyor\'s −22 stood every machine on ~15 m of legs)', () => {
    expect(STAGE.FLOOR).toBe(-5.5);
  });
  it('ground: the deck at which the lowest part rests on the plinth', () => {
    expect(groundOf(0, STAGE.FLOOR)).toBeCloseTo(STAGE.FLOOR + FOOT.PLINTH, 12);
    expect(groundOf(-.35, STAGE.FLOOR) - .35).toBeCloseTo(STAGE.FLOOR + FOOT.PLINTH, 12);
    expect(groundOf(-4.17, -5.5)).toBeCloseTo(-.93, 12);          // the turntable: its resonator rank clears the floor by the plinth
  });
  it('bands by support height', () => {
    const { flush, low, mid } = FOOT.BANDS;
    expect([0, flush, flush + 1e-9, low, low + 1e-9, mid, mid + 1e-9, 30].map(bandOf))
      .toEqual(['flush', 'flush', 'low', 'low', 'mid', 'mid', 'high', 'high']);
  });
  it('a lift is clamped: finite, 0 … LIFT_MAX (anything else stands on the floor)', () => {
    expect([3, -2, 1e9, NaN, Infinity, undefined, null, '4'].map(clampLift)).toEqual([3, 0, FOOT.LIFT_MAX, 0, 0, 0, 0, 0]);
  });
});

/* a built machine's solid low over the loop, in its own frame — main.js solidLocal's rules:
   no glows, no unlit wire / LED batches; each part (instance) as its turned box ∩ its sphere's;
   the rest pose, 12 loop samples, and any moments it names (`at`: the kit's pistons at their deepest) */
function solidLow(group, update, P, at = []){
  const box = new THREE.Box3(), pb = new THREE.Box3(), sp = new THREE.Sphere(), im = new THREE.Matrix4();
  let low = Infinity;
  const part = (g, m) => {
    pb.copy(g.boundingBox).applyMatrix4(m); sp.copy(g.boundingSphere).applyMatrix4(m);
    low = Math.min(low, Math.max(pb.min.y, sp.center.y - sp.radius));
  };
  const take = () => {
    group.updateMatrixWorld(true);
    group.traverse(o => {
      if (!(o.isMesh || o.isInstancedMesh) || !o.geometry?.attributes.position) return;
      for (let p = o; p && p !== group; p = p.parent) if (!p.visible) return;
      const m = [].concat(o.material)[0];
      if (!m || glowy(m) || m.isMeshBasicMaterial) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (g.boundingBox.isEmpty()) return;
      if (!o.isInstancedMesh) part(g, o.matrixWorld);
      else for (let i = 0; i < o.count; i++){ o.getMatrixAt(i, im); part(g, im.premultiply(o.matrixWorld)); }
    });
  };
  update(-2.4, false); take();
  for (let k = 0; k < 12; k++){ update((k + .5) / 12 * P, true); take(); }
  for (const t of at){ update(t, true); take(); }
  return low;
}

describe('footing: every FLOOR machine rests on its own base when built supportless (floorY 0)', () => {
  const ROLL_T = 2.6;
  for (const I of INSTRUMENTS){
    if (STATIONS[I.key]?.hang) continue;                     // (hung: the organ loft, the chandelier, the court)
    it(`${I.key}: lowest solid part within .6 u under its deck${I.stand !== undefined ? ` — or it declares stand (${I.stand})` : ''}`, () => {
      const beat = 60 / I.demo.bpm, P = ROLL_T + I.demo.beats * beat + 1.2;
      const M = I.make({ envMap: null, glowTex: null, THREE });
      const group = M.build(I.demo.part, { rollT: ROLL_T, beat, P, start: -.6, station: STATIONS[I.key] || stationFor(I.key, 0, I), floorY: 0, ceilY: STAGE.CEIL, loopBeats: I.demo.beats });
      const low = solidLow(group, (t, started) => M.update(t, P, 0, { started, skipStrikes: true, onStrike(){} }), P);
      expect(Number.isFinite(low), `${I.key} has solid parts`).toBe(true);
      if (I.stand === undefined){
        // a part that hangs lower than this would leave the base floating over the plinth: declare `stand`
        expect(low, `${I.key} low ${low.toFixed(2)}`).toBeGreaterThanOrEqual(-.6);
        expect(low, `${I.key} low ${low.toFixed(2)}`).toBeLessThanOrEqual(.05);
      } else {
        expect(I.stand, `${I.key}: it rests near its base`).toBeGreaterThanOrEqual(-.6);
        expect(I.stand, `${I.key}: stand ≤ 0`).toBeLessThanOrEqual(0);
        expect(low, `${I.key}: what hangs reaches below what it stands on`).toBeLessThan(I.stand);
      }
    }, 30000);
  }
});

/* A HUNG machine TAKEN DOWN (stage edit: dragged off the belt — main builds it `standing`, floorY 0, ceilY 0)
   stands on its own base like any floor machine: no columns to the floor, no ceiling rods or cables, no floor
   marks — the room's footing holds it. The organ loft and the court stand on their decks; the chandelier on a
   TRIPOD of its own whose feet are the lowest thing it has (its plates hang free above them). */
describe('footing: a HUNG machine taken down stands on its own base (standing: no columns, rods or floor marks)', () => {
  const ROLL_T = 2.6;
  for (const I of INSTRUMENTS){
    if (!STATIONS[I.key]?.hang) continue;
    it(`${I.key}: standing, its lowest solid part is its base; hung, it reached the floor or the ceiling`, () => {
      const beat = 60 / I.demo.bpm, P = ROLL_T + I.demo.beats * beat + 1.2;
      const M = I.make({ envMap: null, glowTex: null, THREE });
      const up = (t, started) => M.update(t, P, 0, { started, skipStrikes: true, onStrike(){} });
      const box = g => { g.updateMatrixWorld(true); return new THREE.Box3().setFromObject(g); };
      const hungG = M.build(I.demo.part, { rollT: ROLL_T, beat, P, start: -.6, station: STATIONS[I.key], floorY: -20, ceilY: 30, loopBeats: I.demo.beats });
      const hung = box(hungG);
      const group = M.build(I.demo.part, { rollT: ROLL_T, beat, P, start: -.6, station: { ...STATIONS[I.key], hang: false, unhung: true }, floorY: 0, ceilY: 0, standing: true, loopBeats: I.demo.beats });
      const low = solidLow(group, up, P), all = box(group);
      expect(Number.isFinite(low), `${I.key} has solid parts`).toBe(true);
      expect(all.min.y, `${I.key}: nothing below its base (no column, no floor ring)`).toBeGreaterThanOrEqual(low - .3);
      expect(all.max.y, `${I.key}: no higher than it was`).toBeLessThanOrEqual(hung.max.y + 1e-6);
      if (hung.max.y > 29) expect(all.max.y, `${I.key}: no rods / cables up to the ceiling`).toBeLessThan(25);
      if (Number.isFinite(group.userData.base)){
        // (the tripod: its feet ARE its lowest part — nothing hangs below them, nothing floats over them)
        expect(low, `${I.key} low ${low.toFixed(2)} vs its feet ${group.userData.base.toFixed(2)}`).toBeCloseTo(group.userData.base, 1);
      } else {
        expect(low, `${I.key} low ${low.toFixed(2)}`).toBeGreaterThanOrEqual(-.6);
        expect(low, `${I.key} low ${low.toFixed(2)}`).toBeLessThanOrEqual(.05);
      }
      expect(hung.min.y < -19 || hung.max.y > 29, `${I.key}: hung, it reached the floor or the ceiling`).toBe(true);
    }, 30000);
  }
});

/* THE KIT stands on its deck slab's underside (KIT_STAND) in every song — its ground never depends on
   the groove. Its pistons stroke briefly below the slab (a kick's wind-up retracts the head, its rod
   slides down through the deck): main measures its low where each one bottoms out (lowTimes) — a
   uniform sweep caught a dip by luck and floated the slab off its plinth (backbeat, finale) */
describe('footing: the KIT stands on its deck slab — its pistons dip into the well its base keeps', () => {
  const ROLL_T = 2.6, START = -.6;
  const kitOf = S => {
    const beat = 60 / S.bpm, P = ROLL_T + S.melody.reduce((a, n) => a + n[1], 0) * beat + 1.2;
    const K = makeMarbleDrums({ envMap: null, glowTex: null });
    const group = K.build(S.drums, { rollT: ROLL_T, beat, P, cx: 0, start: START, slot: { x: 0, z: 0, y: 0 } });   // (kit-local = world)
    return { K, group, P, update: (t, started) => K.update(t, P, 0, { started, skipStrikes: true, onStrike(){} }) };
  };
  const drumSongs = Object.entries(SONGS).filter(([, S]) => S.drums && Object.keys(S.drums).length);
  it('KIT_STAND is the deck slab\'s underside (drumlook buildDeck)', () => {
    const { group } = kitOf(SONGS.backbeat);
    let slab = null;                                    // (frozen + merged by material: the slab's is its own — drumlook buildDeck's 0x15171f)
    group.traverse(o => { if (o.isMesh && [].concat(o.material)[0]?.color?.getHex() === 0x15171f) slab = o; });
    slab.geometry.computeBoundingBox();
    expect(KIT_STAND).toBe(DECK_UNDER);
    expect(slab.geometry.boundingBox.min.y).toBeCloseTo(KIT_STAND, 6);                // (float32 vertices)
    expect(slab.geometry.boundingBox.max.y).toBeCloseTo(0, 6);                       // (its top face is the deck)
  });
  it('backbeat: the low measured where every piston bottoms out is what a dense sweep of the loop finds', () => {
    const { K, group, P, update } = kitOf(SONGS.backbeat);
    const low = solidLow(group, update, P, K.lowTimes());
    const dense = solidLow(group, update, P, Array.from({ length: Math.ceil((P + 1) / .005) }, (_, k) => START + k * .005));
    expect(low, `${low.toFixed(4)} vs dense ${dense.toFixed(4)}`).toBeLessThanOrEqual(dense + 1e-3);   // (nothing the sweep sees is missed)
    expect(low).toBeGreaterThan(dense - .03);                                          // (a 5 ms sweep reads a wind-up's bottom ≲ 5 % shallow)
    expect(low, 'the pistons do dip under the slab').toBeLessThan(KIT_STAND - .05);
  }, 60000);
  for (const [k, S] of drumSongs) it(`${k}: what dips below the slab stays inside the plinth (its well < FOOT.PLINTH)`, () => {
    const { K, group, P, update } = kitOf(S);
    const low = solidLow(group, update, P, K.lowTimes());
    expect(low, `${k} low ${low.toFixed(3)}`).toBeLessThanOrEqual(KIT_STAND + 1e-9);
    expect(KIT_STAND - low, `${k}: well ${(KIT_STAND - low).toFixed(3)}`).toBeLessThan(FOOT.PLINTH - .04);
  }, 30000);
});

/* ---- THE PLANNER (planFooting): anchors → pads by height band, lofts, stairs / ladders ---- */
import { planFooting, footingBoxes, accessRect, rectAabb, railed } from '../src/rooms/footing.js';

const FL = STAGE.FLOOR, ROOM_B = { x0: -STAGE.HW, x1: STAGE.HW, z0: STAGE.BACK, z1: STAGE.FRONT };
/* a station anchor standing `h` above the floor (h = .4: on its plinth) */
const st = (key, x, z, w, d, h = FOOT.PLINTH, extra = {}) => ({ key, kind: 'station', label: key, color: '#88aaff', x, z, yaw: 0, w, d,
  y: FL + h, ground: FL + FOOT.PLINTH, lift: h - FOOT.PLINTH, bottom: FL + h, low: FL + h, box: [x - w / 2, x + w / 2, FL + h, FL + h + 5, z - d / 2, z + d / 2],
  cue: [{ t: 1, w: 1 }], P: 20, start: -.6, fixed: false, ...extra });
const beltA = { key: 'belt', kind: 'belt', label: 'Belt', color: '#ffaa55', x: 0, z: -1.17, yaw: 0, w: 21.74, d: 5.77, y: FL, ground: FL, lift: 0,
  bottom: FL, low: FL, box: [-10.87, 10.87, FL, 15.83, -4.05, 1.72], cue: [], P: 20, start: -.6, fixed: true };
const plan = (as, room = ROOM_B) => planFooting(as, { floor: FL, room });
const padOf = (p, k) => p.pads.find(q => q.key === k);
/* do two world AABBs [x0, x1, z0, z1] overlap by more than eps? */
const hit2 = (a, b, eps = 1e-6) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > eps && Math.min(a[3], b[3]) - Math.max(a[2], b[2]) > eps;

/* FINALE's anchors as main built them (grid, 2026-10-25): ten stations, the kit, the belt, the organ loft
   hung behind the belt, riff / strum / horns lifted onto the rear gallery, the turntable standing on its feet */
const GAL = 13.83;
const FINALE = [beltA,
  { ...st('drums', 19.13, 19.15, 18.47, 5.5), kind: 'kit', y: -4.76, ground: -4.76, lift: 0, low: -5.435 },   // (its slab on the plinth, its pistons' well)
  st('bass', -20, 5.1, 11.7, 7.79), st('bells', 26, -10, 10.9, 6.85), st('bowwheel', 28.1, 10.38, 11.24, 8.59),
  st('dulcimer', -27.5, 18.07, 11.55, 8.62), st('marimba', -25.18, -10.34, 13.02, 7),
  st('horns', 15.45, -20.19, 13.9, 3.75, GAL - FL), st('riff', -15.01, -22.05, 12.96, 5.35, GAL - FL), st('strum', -28.95, -21.27, 11.29, 2.7, GAL - FL),
  { ...st('turntable', -.36, 17.19, 14.22, 14.12, -1.29 - FL), y: -.93, ground: -.93, lift: 0, low: -5.1, box: [-7.47, 6.75, -5.1, 8.13, 10.13, 24.25],   // (on its own feet: lift 0)
    feet: [[-5.5, -4.5, .7], [5.5, -4.5, .7], [-5.5, 4.5, .7], [5.5, 4.5, .7]], hang: [-6.25, 4.35, 4.8, 5.7] },
  { key: 'organ', kind: 'hung', label: 'Light Organ', color: '#c08bff', x: 0, z: -13.65, yaw: 0, w: 13.16, d: 4.64, y: 16, box: [-6.58, 6.58, FL, 24.54, -15.97, -11.33], cue: [], P: 20, start: -.6, fixed: true },
];

describe('footing: the planner (planFooting)', () => {
  it('a grounded machine stands on a FLUSH plinth: its footprint + the margin, its top at the machine\'s bottom', () => {
    const p = plan([st('bass', 0, 10, 10, 6)]), q = padOf(p, 'bass');
    expect(q.band).toBe('flush');
    expect(q.top).toBeCloseTo(FL + FOOT.PLINTH, 12);
    expect(q.h).toBeCloseTo(FOOT.PLINTH, 12);
    expect([q.hw, q.hd]).toEqual([5 + FOOT.MARGIN, 3 + FOOT.MARGIN]);
    expect(q.access).toBe(null); expect(q.loft).toBe(null); expect(q.open).toBe(false);
  });
  it('the KIT: a solid plinth under its deck slab — its pistons dip into it (a WELL, never an open stand)', () => {
    const q = padOf(plan(FINALE), 'drums');
    expect(q).toMatchObject({ band: 'flush', open: false, feet: null, hang: null });
    expect(q.top).toBeCloseTo(FL + FOOT.PLINTH, 12);
    expect(q.well).toBeCloseTo(.335, 12);
    expect(q.well).toBeLessThan(q.h);                    // (the plinth swallows the stroke)
    const lifted = padOf(plan([{ ...FINALE[1], y: -4.76 + 6, ground: -4.76, lift: 6, bottom: -5.1 + 6, low: -5.435 + 6 }]), 'drums');
    expect(lifted).toMatchObject({ band: 'mid', open: false });
    expect(lifted.well).toBeCloseTo(.335, 12);
    expect(padOf(plan(FINALE), 'turntable').well).toBe(0);   // (open: what hangs is seen, not hidden)
  });
  it('the belt keeps its own posts: a flush pad AT the floor under them, fixed', () => {
    const q = padOf(plan([beltA]), 'belt');
    expect(q).toMatchObject({ band: 'flush', top: FL, h: 0, fixed: true, access: null, color: '#ffaa55' });
  });
  it('the support changes with height: plinth → dais + stair → braced platform → tower with a caged ladder', () => {
    const at = h => padOf(plan([st('m', 0, 10, 10, 6, h)]), 'm');
    expect(at(.4).band).toBe('flush');
    const lo = at(2.4);
    expect(lo.band).toBe('low'); expect(lo.access.kind).toBe('stair');
    expect(lo.access.rise).toBeLessThanOrEqual(FOOT.STEP + 1e-12);
    expect(lo.access.rise * lo.access.n).toBeCloseTo(lo.h, 12);
    const mid = at(5);
    expect(mid.band).toBe('mid'); expect(mid.access.kind).toBe('stair');
    expect(at(8).access.kind).toBe('ladder');           // (above STAIR_MAX a stair would run ≈ 10 u)
    const hi = at(20);
    expect(hi.band).toBe('high');
    expect(hi.access).toMatchObject({ kind: 'ladder', cage: true });
    expect(hi.access.flights).toBe(Math.ceil(20 / FOOT.LAND_DY));
  });
  it('a stair fits the side it hugs; a ladder climbs within its face', () => {
    for (const h of [1.2, 2.4, 3.5, 5, 6.4, 8, 12, 20]){
      const q = padOf(plan([st('m', 0, 10, 10, 6, h)]), 'm'), A = q.access, L = A.side[1] === 'u' ? 2 * q.hd : 2 * q.hw;
      expect(A.a0, `${h}`).toBeGreaterThanOrEqual(-L / 2 - 1e-9);
      expect(A.a1, `${h}`).toBeLessThanOrEqual(L / 2 + 1e-9);
      if (A.kind === 'stair') expect(A.a1 - A.a0).toBeCloseTo((A.n - 1) * FOOT.TREAD + FOOT.STAIR_W, 12);
    }
  });
  it('neighbours: pads never meet (a close neighbour clips the margin)', () => {
    const p = plan([st('a', 0, 0, 10, 6), st('b', 10.45, 0, 10, 6), st('c', 0, 6.3, 10, 6)]);
    for (const x of p.pads) for (const y of p.pads) if (x !== y) expect(hit2(rectAabb(x), rectAabb(y), -FOOT.CLEAR + 1e-9), `${x.key}×${y.key}`).toBe(false);
    expect(padOf(p, 'a').hw).toBeLessThan(5 + FOOT.MARGIN);
  });
  it('a LOFT: raised neighbours at one height share a deck (the rear gallery) — and only they', () => {
    const p = plan([st('a', -8, -20, 12, 4, 14), st('b', 5.5, -20, 12, 4, 14.3), st('c', 30, -20, 6, 4, 14), st('d', -8, 10, 12, 4, 14.9)]);
    expect(p.lofts.length).toBe(1);
    const L = p.lofts[0];
    expect(L.keys).toEqual(['a', 'b']);
    expect(L.top).toBeCloseTo(FL + 14, 12);              // its lowest member's deck (b stands on a .3 shim)
    expect(L.band).toBe('high');
    for (const k of ['a', 'b']){ const q = padOf(p, k); expect(q.loft).toBe(L.id);
      const b = rectAabb(q); expect(b[0] >= L.x0 - 1e-9 && b[1] <= L.x1 + 1e-9 && b[2] >= L.z0 - 1e-9 && b[3] <= L.z1 + 1e-9).toBe(true); }
    expect(padOf(p, 'c').loft).toBe(null);               // too far
    expect(padOf(p, 'd').loft).toBe(null);               // too far (and .9 higher)
    expect(L.access && L.access.kind).toBe('ladder');
    expect(padOf(p, 'a').access).toBe(null);             // (the loft is climbed, not its members)
  });
  it('never merges across heights, the flush band, an open stand or the belt', () => {
    expect(plan([st('a', -8, -20, 12, 4, 14), st('b', 5.5, -20, 12, 4, 14.7)]).lofts).toEqual([]);   // Δtop .7 > LOFT_DY
    expect(plan([st('a', -8, -20, 12, 4), st('b', 5.5, -20, 12, 4)]).lofts).toEqual([]);             // both on the floor
    const open = { ...st('t', 5.5, -20, 12, 4, 14), low: FL + 10, feet: [[0, 0, .5]] };
    expect(plan([st('a', -8, -20, 12, 4, 14), open]).lofts).toEqual([]);
  });
  it('a loft never swallows a machine standing between its members', () => {
    const p = plan([st('a', -9, -20, 10, 4, 14), st('b', 9, -20, 10, 4, 14), st('mid', 0, -20, 2, 2)]);
    expect(p.lofts).toEqual([]);
  });
  it('an OPEN stand: something hangs below what it stands on — posts under its feet, the hang kept clear', () => {
    const p = plan(FINALE), q = padOf(p, 'turntable');
    expect(q.open).toBe(true);
    expect(q.top).toBeCloseTo(-1.29, 12);
    expect(q.band).toBe(bandOf(-1.29 - FL));
    expect(q.feet.length).toBe(4);
    expect(q.hang).toEqual([-6.25, 4.35, 4.8, 5.7]);
    expect(q.access).toMatchObject({ kind: 'ladder' });  // (its deck stands 4.2 u over the floor, unlifted: a service ladder)
    expect(q.hangY).toBe(-5.1);                          // (what hangs reaches down to here)
  });
  it('an open stand gets a service ladder (never a stair) once its DECK stands over CLIMB above the floor — by its own height or a lift', () => {
    const tt = FINALE.find(a => a.key === 'turntable'), up = u => ({ ...tt, y: tt.y + u, bottom: tt.bottom + u, low: tt.low + u, lift: u,
      box: [tt.box[0], tt.box[1], tt.box[2] + u, tt.box[3] + u, tt.box[4], tt.box[5]] });
    // a SHORT open stand (its deck ≤ CLIMB over the floor, hanging parts a hair above it): its posts are its legs, nobody climbs them
    const shortStand = h => ({ ...tt, y: FL + h + .36, bottom: FL + h, low: FL + .1, lift: 0, box: [tt.box[0], tt.box[1], FL + .1, FL + 9, tt.box[4], tt.box[5]] });
    expect(padOf(plan([beltA, shortStand(FOOT.CLIMB)]), 'turntable')).toMatchObject({ open: true, access: null });
    expect(padOf(plan([beltA, shortStand(FOOT.CLIMB + .2)]), 'turntable')).toMatchObject({ open: true, access: { kind: 'ladder' } });
    // the turntable's own stand at lift 0 (deck ≈ 4.2 u up — the bug: the check read the LIFT, so it had none)
    expect(padOf(plan([beltA, up(0)]), 'turntable').access, 'lift 0').toMatchObject({ kind: 'ladder', cage: false });
    for (const u of [2, 6, 14]){
      const q = padOf(plan([beltA, up(u)]), 'turntable');
      expect(q.open, `${u}`).toBe(true);
      expect(q.access, `lift ${u}`).toMatchObject({ kind: 'ladder' });
      expect(q.hangY).toBeCloseTo(-5.1 + u, 12);
    }
  });
  it('FINALE: the gallery\'s riff + strum share a loft, the horns stand on their own tower — each climbed from a free side', () => {
    const p = plan(FINALE);
    expect(p.lofts.map(L => L.keys)).toEqual([['riff', 'strum']]);
    const horns = padOf(p, 'horns');
    expect(horns.band).toBe('high'); expect(horns.loft).toBe(null);
    expect(horns.access).toMatchObject({ kind: 'ladder', side: '+u', cage: true });   // its outer side (away from the belt)
    expect(p.lofts[0].access).toMatchObject({ kind: 'ladder', side: '-u' });
    for (const k of ['bass', 'bells', 'bowwheel', 'dulcimer', 'marimba', 'drums']) expect(padOf(p, k).band, k).toBe('flush');
    expect(padOf(p, 'organ')).toBe(undefined);           // (hung: an obstacle, never a pad)
  });
  it('a HUNG machine taken down is a standing anchor like any: a pad by its height band (FINALE\'s organ on a tower) — hung, none', () => {
    const organ = FINALE.find(a => a.key === 'organ');
    const down = st('organ', 30, -24, 13.16, 4.64, 18 - FL);                   // (taken down behind the right wing, at the height it hung)
    const p = plan([...FINALE.filter(a => a !== organ), down]), q = padOf(p, 'organ');
    expect(q.band).toBe('high'); expect(q.loft).toBe(null);
    expect(q.top).toBeCloseTo(18, 9);
    expect(padOf(plan(FINALE), 'organ')).toBe(undefined);                     // (hanging: an obstacle, never a pad)
    const floor = plan([...FINALE.filter(a => a !== organ), st('organ', 30, -24, 13.16, 4.64)]);
    expect(padOf(floor, 'organ').band).toBe('flush');                          // (FLOOR: on a plinth)
  });
  it('every stair / ladder stays clear of every other machine, pad, loft, access and the room\'s walls', () => {
    const cases = [FINALE,
      // a crowded floor with a few raised machines (the stairs must find free sides — or go without)
      [beltA, st('a', -20, 5, 11, 7, 2.5), st('b', -20, -6, 11, 7, 6), st('c', 20, 5, 10, 8, 9), st('d', 21, -8, 12, 6, 3.2),
        st('e', -32, 15, 8, 8, 12), st('f', 0, 18, 14, 10, 1.5), st('g', 33, 18, 7, 7, 5.5)]];
    for (const as of cases){
      const p = plan(as), boxes = [];
      for (const q of p.pads.filter(q => q.access)) boxes.push([q.key, [q.key], rectAabb(accessRect(q, q.access))]);
      for (const L of p.lofts.filter(L => L.access)) boxes.push([L.id, L.keys, rectAabb(accessRect(L, L.access))]);
      for (const [id, own, b] of boxes){
        expect(b[0] >= ROOM_B.x0 && b[1] <= ROOM_B.x1 && b[2] >= ROOM_B.z0 && b[3] <= ROOM_B.z1, `${id} in the room`).toBe(true);
        for (const a of as) if (!own.includes(a.key)) expect(hit2(b, rectAabb({ x: a.x, z: a.z, hw: a.w / 2, hd: a.d / 2, yaw: a.yaw })), `${id} × ${a.key}`).toBe(false);
        for (const q of p.pads) if (!own.includes(q.key) && !(q.loft && own.length > 1 && own.includes(q.key))) expect(hit2(b, rectAabb(q)), `${id} × pad ${q.key}`).toBe(false);
        for (const [id2, , b2] of boxes) if (id2 !== id) expect(hit2(b, b2), `${id} × ${id2}`).toBe(false);
      }
      // the second case: most raised machines got their way up
      if (as !== FINALE) expect(p.pads.filter(q => q.band !== 'flush' && !q.loft && q.access).length).toBeGreaterThanOrEqual(5);
    }
  });
  it('deterministic: the same anchors give the same plan; one pulse slot per pad, in order', () => {
    const a = plan(FINALE), b = plan(FINALE.map(x => ({ ...x })));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.pads.map(q => q.pulse)).toEqual(a.pads.map((_, i) => i));
    expect(a.pulses.map(s => s.key)).toEqual(a.pads.map(q => q.key));
    expect(a.pulses[0].cue).toBe(FINALE[0].cue);         // (the anchor's own cue: no copy)
  });
  it('footingBoxes: every support\'s envelope — from the floor to its deck (+ its rails), its stair / ladder, its loft', () => {
    const p = plan(FINALE), B = footingBoxes(p);
    for (const q of p.pads.filter(q => !q.loft)){
      const e = B.find(b => b.kind === 'pad' && b.keys[0] === q.key), r = rectAabb(q);
      expect(e.box[2]).toBe(FL);
      expect(e.box[3]).toBeCloseTo(q.fixed ? FL + FOOT.KERB : q.top + (railed(q.band) && !q.open ? FOOT.RAIL : 0), 12);
      expect(e.unit).toBe(q.key);
      expect([e.box[0], e.box[1], e.box[4], e.box[5]]).toEqual([r[0], r[1], r[2], r[3]]);
    }
    const L = p.lofts[0], e = B.find(b => b.kind === 'loft');
    expect(e.keys).toEqual(L.keys); expect(e.unit).toBe(L.id);
    expect(e.box).toEqual([L.x0, L.x1, FL, L.top + FOOT.RAIL, L.z0, L.z1]);
    expect(B.filter(b => b.kind === 'access').length).toBe(p.pads.filter(q => q.access).length + p.lofts.filter(L => L.access).length);
  });
});
