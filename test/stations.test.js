import { describe, it, expect } from 'vitest';
import { STATIONS, layoutStations, soloStar, loneTurn, MARGIN, AUDIENCE, hangPlace, WING_REF, GALLERY_DROP, SEATS, SEAT_R, STAR, STAR_GRAZE, STAR_LEAD, KIT_RISER, SEAT_RISE, riserAt, kitRiseAt } from '../src/instruments/stations.js';
import { FOOT } from '../src/rooms/footing.js';
import { KIT_ROOM } from '../src/marbledrums.js';
import { STAGE } from '../src/rooms/common.js';

/* footprint of a slot, rotated by its yaw (main measures the BUILT geometry instead) */
const boxOf = ({ w, d, yaw }) => {
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  const hx = c * w / 2 + s * d / 2, hz = s * w / 2 + c * d / 2;
  return [-hx, hx, -hz, hz];
};
const KIT = { x: KIT_ROOM.x, z: KIT_ROOM.z, box: [-8.8, 8.8, -5, 3] };   // the measured kit (riser + arc)
const ROOM = { x0: -STAGE.HW + 2.5, x1: STAGE.HW - 2.5, z0: STAGE.BACK + 2.5, z1: 31 };
const floorKeys = Object.keys(STATIONS).filter(k => !STATIONS[k].hang);
const APPROVED = ['marimba', 'bells', 'bass', 'bowls', 'musicbox', 'turntable'];   // the shipped songs' floor machines (their look is approved)
const ORGAN_1BAY = [-5.74, 5.74, -15.7, -11.1];                                   // the organ loft's measured world footprint (hung behind the belt)
const itemsFor = keys => [
  ...keys.map(k => ({ key: k, x: STATIONS[k].x, z: STATIONS[k].z, box: boxOf(STATIONS[k]) })),
  { key: 'drums', ...KIT },
];
const walls = { '1 bay': [-12, 12, -4.1, 2], '2 bays': [-22, 22, -4.1, 2.3], '3 bays': [-28, 28, -4.1, 2.3] };
const world = (solved, it) => [solved[it.key].x + it.box[0], solved[it.key].x + it.box[1], solved[it.key].z + it.box[2], solved[it.key].z + it.box[3]];
/* the SEAT a band machine stands in (within SEAT_R of one of ITS seats, x relative to the belt centre) */
const seatOf = (key, at, cx = 0) => (STATIONS[key].floor || []).find(n => Math.hypot(at.x - cx - SEATS[n].x, at.z - SEATS[n].z) <= SEAT_R + 1e-9) ?? null;
const clear = (a, b) => a[1] <= b[0] || b[1] <= a[0] || a[3] <= b[2] || b[3] <= a[2];

describe('hung stations (stations.js hangPlace)', () => {
  const hungOff = Object.keys(STATIONS).filter(k => STATIONS[k].hang && Math.abs(STATIONS[k].x) > 4);
  it('an off-centre hung footprint never hangs over the belt and stays in the room, 1–3 bays', () => {
    expect(hungOff.length).toBeGreaterThan(0);
    for (const k of hungOff) for (const [name, wall] of Object.entries(walls)){
      const box = boxOf(STATIONS[k]), at = hangPlace(STATIONS[k], box, wall, ROOM);
      const b = [at.x + box[0], at.x + box[1], at.z + box[2], at.z + box[3]];
      expect(clear([b[0] + 3, b[1] - 3, b[2], b[3]], wall), `${k} × ${name} wall`).toBe(true);   // (FORE_GRAZE: a graze over the housing's edge)
      expect(b[0]).toBeGreaterThanOrEqual(ROOM.x0 - 1e-9); expect(b[1]).toBeLessThanOrEqual(ROOM.x1 + 1e-9);
      expect(b[3]).toBeLessThanOrEqual(ROOM.z1 + 1e-9);
      // and it never crowds the centred chandelier
      const ch = STATIONS.ricochet, cb = boxOf(ch), c = hangPlace(ch, cb, wall, ROOM);
      expect(clear(b, [c.x + cb[0], c.x + cb[1], c.z + cb[2], c.z + cb[3]]), `${k} × ricochet, ${name}`).toBe(true);
    }
  });
  it('it rides out with its wing (gap to the wall edge kept) while the wing has room; the chandelier stays centred', () => {
    const v = STATIONS.volley, box = boxOf({ ...v, w: 19.5, d: 11.4 });  // the demo's measured court
    const one = hangPlace(v, box, [-WING_REF, WING_REF, -4.1, 2], ROOM), wide = hangPlace(v, box, [-12.8, 12.8, -4.1, 2], ROOM);
    expect(one).toEqual({ x: v.x, z: -1.05 + v.z });
    expect(wide.x).toBeCloseTo(v.x - (12.8 - WING_REF), 12);           // (the room's wall stops it soon after: then it flies forward)
    const far = hangPlace(v, box, walls['3 bays'], ROOM);              // no wing room: behind the bays
    expect(far.z + box[3]).toBeLessThanOrEqual(walls['3 bays'][2] - MARGIN + 1e-9);
    const ch = hangPlace(STATIONS.ricochet, boxOf(STATIONS.ricochet), walls['3 bays'], ROOM);
    expect(ch.x).toBe(0); expect(ch.z).toBeCloseTo(-.9, 12);
  });
});

describe('room staging (stations.js layoutStations)', () => {
  for (const [name, wall] of Object.entries(walls)) for (const keys of [floorKeys, floorKeys.filter(k => k !== 'turntable')]){
    const label = `${name}${keys.includes('turntable') ? ' + turntable' : ''}`;
    const items = itemsFor(keys);
    const solved = layoutStations(items, wall, ROOM);
    it(`${label}: no footprint overlaps another or the belt wall, all inside the room`, () => {
      const boxes = items.map(it => world(solved, it));
      for (let i = 0; i < boxes.length; i++){
        expect(clear(boxes[i], wall), `${items[i].key} × wall`).toBe(true);
        expect(boxes[i][0]).toBeGreaterThanOrEqual(ROOM.x0 - 1e-9); expect(boxes[i][1]).toBeLessThanOrEqual(ROOM.x1 + 1e-9);
        expect(boxes[i][2]).toBeGreaterThanOrEqual(ROOM.z0 - 1e-9); expect(boxes[i][3]).toBeLessThanOrEqual(ROOM.z1 + 1e-9);
        for (let j = i + 1; j < boxes.length; j++) expect(clear(boxes[i], boxes[j]), `${items[i].key} × ${items[j].key}`).toBe(true);
      }
    });
    it(`${label}: deterministic — one song, one stage`, () => {
      expect(layoutStations(itemsFor(keys), wall, ROOM)).toEqual(solved);
    });
  }
  it('a one-bay room without the turntable keeps the hand-tuned slots of the APPROVED tier (the solve only moves what collides)', () => {
    // every machine on stage at once: the approved amphitheater (marimba / bells / bass / bowls /
    // music box + the kit) is placed first and keeps its look; the newer machines step around it
    const items = itemsFor(floorKeys.filter(k => k !== 'turntable'));
    const solved = layoutStations(items, walls['1 bay'], ROOM);
    for (const k of ['marimba', 'bells']) expect(solved[k]).toEqual({ x: STATIONS[k].x, z: STATIONS[k].z });
    for (const k of APPROVED.filter(k => k !== 'turntable'))                        // everyone else: a nudge, not a re-stage
      expect(Math.hypot(solved[k].x - STATIONS[k].x, solved[k].z - STATIONS[k].z), k).toBeLessThan(3);
    // …and the APPROVED rooms are staged exactly as before the gallery existed: it only ever
    // takes the stations a song's floor can't (no approved machine climbs up when the floor clears)
    for (const k of APPROVED) expect(solved[k]?.y, k).toBeUndefined();
  });
  it('the newer machines\' slots are clean by design: belt + kit + every new floor machine (+ the organ loft) — the floor ones keep every slot, the BAND takes its floor SEATS (floor first: nobody climbs)', () => {
    // (2026-10-25: this room used to raise riff / strum / horns / pogo onto the gallery — lone towers
    //  with the floor half empty; floor first, each takes the first of its seats that is free)
    const keys = floorKeys.filter(k => !APPROVED.includes(k));
    expect(keys.length).toBeGreaterThanOrEqual(5);
    const solved = layoutStations(itemsFor(keys), walls['1 bay'], ROOM, { hung: [ORGAN_1BAY] });
    for (const k of keys){
      expect(solved[k].y, `${k} on the floor`).toBeUndefined();
      if (!STATIONS[k].gallery) expect({ x: solved[k].x, z: solved[k].z }, k).toEqual({ x: STATIONS[k].x, z: STATIONS[k].z });
    }
    // the band's picks, in BAND order (riff, horns, strum, pogo): the riff front and centre, the horns find the
    // front row full and take the left wing, the strum the front-right seat (the kit is up its DRUM RISER on
    // the right wing — balance 2026-10-25 — so the front-right is free), the pogo the back-left seat beside
    // the belt (polish 2026-10-25: the brass picks before the harp)
    expect(['riff', 'strum', 'horns', 'pogo'].map(k => seatOf(k, solved[k]))).toEqual(['centre', 'right', 'wingL', 'backL']);
    expect(solved.drums, 'the kit on its riser').toEqual({ x: KIT_RISER.x, z: KIT_RISER.z, lift: KIT_RISER.lift });
  });
  it('the wings ride out with a wider belt (gap to the wall edge kept), the margin is real air', () => {
    const one = layoutStations(itemsFor(floorKeys), walls['1 bay'], ROOM);
    const two = layoutStations(itemsFor(floorKeys), walls['2 bays'], ROOM);
    expect(two.bass.x).toBeLessThan(one.bass.x - 5);
    expect(two.musicbox.x).toBeGreaterThan(one.musicbox.x);
    expect(MARGIN).toBeGreaterThan(1);
  });

  /* the MEASURED rooms (main's built footprints + heights, from __dev.layout): a 3-bay MIDI
     import used to pin the bells + marimba behind the outer bays (hidden in the wide AND in
     their own shots), and a tall machine could park in front of the strike band */
  const MEASURED = {
    'canon-in-d.mid (3 bays)': { wall: [-23.8, 23.8, -4.1, 2.5], items: [
      { key: 'bass', x: -20, z: 3.6, box: [-5.9, 5.9, -6.9, 6.9], top: 9.4 }, { key: 'bells', x: 26, z: -10, box: [-6.4, 6.4, -5.9, 5.9], top: 15.9 },
      { key: 'bowls', x: -13, z: 18, box: [-6.7, 6.7, -6.8, 6.8], top: 4.2 }, { key: 'marimba', x: -25, z: -10.5, box: [-7.2, 6.7, -6.5, 7.0], top: 9.2 },
      { key: 'musicbox', x: 25, z: 3.2, box: [-6.6, 6.6, -6.7, 6.7], top: 9.1 }, { key: 'drums', x: 11, z: 19, box: [-9.5, 9.5, -4.9, 3.8], top: 8.4 }] },
    'daybreak (1 bay + turntable)': { wall: [-11.2, 11.2, -4.1, 2.5], items: [
      { key: 'bass', x: -20, z: 3.6, box: [-5.9, 5.9, -6.9, 6.9], top: 9.4 }, { key: 'bells', x: 26, z: -10, box: [-6.4, 6.4, -5.9, 5.9], top: 15.9 },
      { key: 'bowls', x: -13, z: 18, box: [-6.8, 6.8, -6.8, 6.8], top: 4.8 }, { key: 'marimba', x: -25, z: -10.5, box: [-7.2, 6.7, -6.5, 7.0], top: 9.2 },
      { key: 'musicbox', x: 25, z: 3.2, box: [-6.6, 6.6, -6.7, 6.7], top: 9.1 }, { key: 'turntable', x: 0, z: 12.5, box: [-8.1, 8.1, -8.1, 8.1], top: 8.1 },
      { key: 'drums', x: 11, z: 19, box: [-8.8, 8.8, -4.9, 2.9], top: 8.4 }] },
  };
  const BAND = 4.2, EYE = 20;
  for (const [name, { wall, items }] of Object.entries(MEASURED)) it(`${name}: no overlaps, every back-tier station seen past the belt, nothing tall in front of the band`, () => {
    const solved = layoutStations(items, wall, ROOM, { bandY: BAND, eyeY: EYE });
    const cx = (wall[0] + wall[1]) / 2, ax = cx + AUDIENCE.dx, az = AUDIENCE.z, zp = (wall[2] + wall[3]) / 2;
    const boxes = items.map(it => world(solved, it));
    boxes.forEach((b, i) => {
      const k = items[i].key;
      expect(clear(b, wall), `${k} × wall`).toBe(true);
      for (let j = i + 1; j < boxes.length; j++) expect(clear(b, boxes[j]), `${k} × ${items[j].key}`).toBe(true);
      const xc = (b[0] + b[1]) / 2, zc = (b[2] + b[3]) / 2;
      if (zc < wall[2]){                                        // behind the belt: the audience sees past its edge
        const xs = ax + (xc - ax) * (az - wall[3]) / (az - zc);
        expect(xs >= wall[1] || xs <= wall[0], `${k} hidden behind the belt`).toBe(true);
      }
      if (b[1] > wall[0] + 3 && b[0] < wall[1] - 3 && b[3] > wall[3])     // in front of the bays: under the sightline
        expect(items[i].top, `${k} hides the strike band`).toBeLessThanOrEqual(BAND + (EYE - BAND) * (Math.max(b[2], zp) - zp) / (az - zp) + 1e-9);
      expect(b[3], `${k} inside the room (a crowded floor may borrow ≤ 6 u of depth)`).toBeLessThanOrEqual(ROOM.z1 + 6 + 1e-9);
    });
  });

  /* THE GALLERY (14 machines): MEASURED footprints (__dev.layout, a synthetic song of every plugin's
     demo) — the realistic worst cases (the biggest plausible song: belt ×2 + kit + the approved four +
     two gallery machines + the organ loft; a band of only the newer machines) and the stress case
     (every machine at once, 3 bays, every hung station flown). No overlaps, everyone in the room; a
     gallery machine stands BEHIND the belt, raised to the gallery deck, never in a hung station's
     footprint or its shadow — and in the realistic rooms, in one row (nobody behind anybody). */
  const M = {
    bass: { box: [-5.9, 5.9, -6.9, 6.9], top: 9.4 }, bells: { box: [-6.4, 6.4, -5.9, 5.9], top: 15.9 },
    bowls: { box: [-6.8, 6.8, -6.8, 6.8], top: 4.9 }, bowwheel: { box: [-5.5, 5.7, -3.9, 6.7], top: 13.2 },
    dulcimer: { box: [-5.8, 5.8, -4.6, 4.9], top: 5.1 }, horns: { box: [-7.2, 7.1, -2.6, 3.2], top: 7.3 },
    marimba: { box: [-7.4, 7, -6.9, 7.2], top: 9.2 }, musicbox: { box: [-6.6, 6.6, -6.7, 6.7], top: 9.1 },
    riff: { box: [-6.6, 6.7, -3.2, 3.2], top: 5.5 }, strum: { box: [-5.9, 5.8, -3.5, 2.7], top: 7.5 }, pogo: { box: [-5.5, 5.5, -2.4, 2.4], top: 4.9 },
    turntable: { box: [-8, 8, -8, 8], top: 8.1 }, drums: { box: [-9.5, 9.5, -4.9, 3.8], top: 9.5 },
  };
  const at = k => k === 'drums' ? { key: k, x: KIT_ROOM.x, z: KIT_ROOM.z, ...M[k] } : { key: k, x: STATIONS[k].x, z: STATIONS[k].z, ...M[k] };
  const TOP = 15.7;
  const GAL = {
    'biggest plausible song (2 bays + kit + bass/marimba/bells/bowls + riff/horns + the organ loft)': {
      wall: [-17.2, 17.2, -4.1, 2.5], keys: ['bass', 'marimba', 'bells', 'bowls', 'riff', 'horns', 'drums'],
      hung: [[-5.74, 5.74, -15.7, -11.1]], strict: true },
    'a band of the newer machines (1 bay + kit + riff/horns/bowwheel/dulcimer/strum + the organ loft)': {
      wall: [-7, 7, -4.1, 2.2], keys: ['riff', 'horns', 'bowwheel', 'dulcimer', 'strum', 'drums'],
      hung: [[-5.74, 5.74, -15.7, -11.1]], strict: true },
    'stress: every machine at once, 3 bays, organ + chandelier + court flown': {
      wall: [-21.2, 21.2, -4.1, 2.2], keys: [...floorKeys, 'drums'],
      hung: [[-5.7, 5.7, -15.7, -11.1], [-8.3, 8.3, -9.2, 7.3], [-31.9, -9.4, -24.2, -5.5]], strict: false },
  };
  for (const [name, { wall, keys, hung, strict }] of Object.entries(GAL)) it(`${name}: clean, and the gallery stands behind the belt`, () => {
    const items = keys.map(at);
    const solved = layoutStations(items, wall, ROOM, { bandY: BAND, eyeY: EYE, wallTop: TOP, hung });
    const cx = (wall[0] + wall[1]) / 2, ax = cx + AUDIENCE.dx, az = AUDIENCE.z, zp = (wall[2] + wall[3]) / 2;
    const boxes = items.map(it => world(solved, it)), up = [];
    boxes.forEach((b, i) => {
      const k = items[i].key, s = solved[k];
      expect(clear(b, wall), `${k} × wall`).toBe(true);
      for (let j = i + 1; j < boxes.length; j++) expect(clear(b, boxes[j]), `${k} × ${items[j].key}`).toBe(true);
      expect(b[0] >= ROOM.x0 - 1e-9 && b[1] <= ROOM.x1 + 1e-9 && b[2] >= ROOM.z0 - 1e-9, `${k} inside the room`).toBe(true);
      expect(b[3], `${k} front edge`).toBeLessThanOrEqual(ROOM.z1 + (strict ? 0 : 6) + 1e-9);
      const xc = (b[0] + b[1]) / 2, zc = (b[2] + b[3]) / 2;
      if (s.y !== undefined){                                   // up on the GALLERY
        expect(['drums', 'turntable'], `${k} is floor-only`).not.toContain(k);
        expect(s.y).toBeCloseTo(TOP - GALLERY_DROP, 9);
        expect(zc, `${k} behind the belt`).toBeLessThan(wall[2]);
        for (const h of hung) expect(b[1] <= h[0] || h[1] <= b[0] || b[2] >= h[3], `${k} in a hung station's footprint / shadow`).toBe(true);
        up.push([k, b]);
      } else {
        if (zc < wall[2]){                                      // a floor station behind the belt: seen past its edge
          const xs = ax + (xc - ax) * (az - wall[3]) / (az - zc);
          expect(xs >= wall[1] || xs <= wall[0], `${k} hidden behind the belt`).toBe(true);
        }
        if (b[1] > wall[0] + 3 && b[0] < wall[1] - 3 && b[3] > wall[3])
          expect(items[i].top, `${k} hides the strike band`).toBeLessThanOrEqual(BAND + (EYE - BAND) * (Math.max(b[2], zp) - zp) / (az - zp) + 1e-9);
      }
    });
    if (strict){
      // FLOOR FIRST (2026-10-25 — these rooms used to raise every gallery-born machine): a realistic room
      // has floor to spare, so NOBODY climbs — the band stands on the floor: in one of its seats, or
      // (every seat taken — polish) any clean floor spot it is seen in, short of the lens
      expect(up.map(u => u[0]), 'nobody on the gallery').toEqual([]);
      for (const k of keys) if (STATIONS[k]?.gallery){
        const b = world(solved, items.find(it => it.key === k));
        expect(seatOf(k, solved[k], cx) !== null || (b[2] + b[3]) / 2 <= 21 + 1e-9, `${k} in a seat, or on the floor short of the lens`).toBe(true);
      }
      for (const k of APPROVED) if (keys.includes(k)) expect(solved[k].y, `${k} stays on the floor`).toBeUndefined();
    }
    expect(layoutStations(items, wall, ROOM, { bandY: BAND, eyeY: EYE, wallTop: TOP, hung })).toEqual(solved);   // deterministic
  });
});

/* FLOOR FIRST + THE STAR (2026-10-25). The gallery is the overflow, not the band's home: riff / strum /
   horns / pogo stand on the FLOOR in the first free one of their SEATS (seen from the audience, not
   parked behind the kit), and climb only when every seat is taken — then side by side, one loft. The
   song's STAR (its signature machine) stands front and centre, nobody in its foreground. MEASURED
   rooms: main's built footprints / tops / decks (__dev.layout, the floor at −5.5), rounded. */
describe('floor first: the band on the floor, the star front and centre (stations.js layoutStations)', () => {
  const ENV = { bandY: 4.2, eyeY: 20 };
  const it_ = (key, x, z, box, top, deck, extra = {}) => ({ key, x, z, box, top, deck, ...extra });
  const R = {
    entertainer: { wall: [-10.9, 10.9, -4.1, 1.7], top: 15.9, hung: [], items: [
      it_('bass', -20, 3.6, [-5.9, 5.9, -6.9, 6.9], 4.3, -5.1), it_('dulcimer', -27.5, 17, [-5.8, 5.8, -3.9, 4.9], .5, -5.1),
      it_('horns', 15.5, -11, [-7.2, 7.1, -2.9, 3.6], 3.2, -5.1), it_('strum', -28.9, -11, [-5.6, 5.7, -2.6, 2.4], .1, -5.1),
      it_('drums', 11, 19, [-9.2, 2.8, -2.7, 2.8], 4.9, -4.8)] },
    forge: { wall: [-10.9, 10.9, -4, 1.7], top: 15.8, hung: [[-5.5, 5.5, -16, -11.3]], items: [
      it_('bass', -20, 3.6, [-5.9, 5.9, -6.9, 6.9], 4.3, -5.1), it_('horns', 15.5, -11, [-7.2, 7.1, -2.6, 3.2], 2.9, -5.1),
      it_('riff', -14, -11, [-6.6, 6.7, -3.1, 3.2], .4, -5.1), it_('drums', 11, 19, [-9.2, 9.4, -2.7, 3], 6.2, -4.8)] },
    finale: { wall: [-10.9, 10.9, -4, 1.7], top: 15.8, hung: [[-6.6, 6.6, -16, -11.3]], items: [
      it_('bass', -20, 3.6, [-5.9, 5.9, -6.9, 6.9], 4.3, -5.1), it_('bells', 26, -10, [-6.4, 6.4, -5.9, 5.9], 10.8, -5.1),
      it_('bowwheel', 28, 15.5, [-5.6, 5.7, -3.4, 3.4], 8.4, -4.8), it_('dulcimer', -27.5, 17, [-5.8, 5.8, -3.7, 4.9], .5, -5.1),
      it_('horns', 15.5, -11, [-7.2, 7.1, -2.6, 3.2], 2.7, -5.1), it_('marimba', -25, -10.5, [-7.4, 7, -6.9, 7.2], 2.9, -4.8),
      it_('riff', -14, -11, [-6.6, 6.7, -3.1, 3.2], .4, -5.1), it_('strum', -28.9, -11, [-5.8, 5.7, -2.7, 2.2], .5, -5.1),
      it_('turntable', 0, 12.5, [-8.3, 8.3, -8.3, 8.3], 8.1, -.9), it_('drums', 11, 19, [-9.2, 9.4, -2.7, 3], 6.2, -4.8)] },
    mars: { wall: [-10.9, 10.9, -4, 1.7], top: 15.7, hung: [[-5.5, 5.5, -16, -11.3]], items: [
      it_('bowwheel', 28, 15.5, [-5.6, 5.7, -4.1, 4.1], 8.4, -4.8), it_('horns', 15.5, -11, [-7.2, 7.1, -2.7, 3.3], 3.3, -5.1),
      it_('riff', -14, -11, [-6.6, 6.7, -3.1, 3.2], .4, -5.1), it_('strum', -28.9, -11, [-5, 4.9, -3, 2.3], 2.2, -5.1),
      it_('drums', 11, 19, [-9.2, 9.4, -2.7, 3], 6.2, -4.8)] },
    'mop.mid': { wall: [-10.9, 10.9, -4, 3.3], top: 15.7, hung: [], star: 'riff', items: [
      it_('pogo', 29.9, -11, [-5.5, 5.5, -2.4, 2.1], -.2, -5.1), it_('riff', -14, -11, [-6.6, 6.7, -3.1, 3.2], .4, -5.1),
      it_('drums', 11, 19, [-9.2, 9.4, -2.7, 3], 6.2, -4.8)] },
    'alabama.mid': { wall: [-10.9, 10.9, -4, 3.3], top: 15.7, hung: [[-3.5, 3.5, -15.2, -10.5]], star: 'dulcimer', items: [
      it_('dulcimer', -27.5, 17, [-5.8, 5.8, -3.9, 4.9], .5, -5.1), it_('pogo', 29.9, -11, [-5.5, 5.5, -2.4, 2.1], -.2, -5.1),
      it_('riff', -14, -11, [-6.6, 6.7, -3.1, 3.2], .4, -5.1), it_('drums', 11, 19, [-9.2, 6.4, -2.7, 2.8], 3.3, -4.8)] },
    'pianoman.mid': { wall: [-10.9, 10.9, -4, 3.3], top: 15.7, hung: [], star: 'dulcimer', items: [
      it_('dulcimer', -27.5, 17, [-5.6, 5.6, -3.3, 4.9], .5, -5.1)] },
  };
  const solve = (r, extra = {}) => layoutStations(r.items, r.wall, ROOM, { ...ENV, wallTop: r.top, hung: r.hung, star: r.star ?? null, ...extra });
  const BAND_KEYS = ['riff', 'strum', 'horns', 'pogo'];
  // (the rows each SIDE of the belt's centre holds — a machine more than 2 u off it: 'front' past z 13, else 'back')
  const rows = (r, solved) => { const o = { L: new Set(), R: new Set() };
    for (const it of r.items){ const b = world(solved, it), xc = (b[0] + b[1]) / 2 - (r.wall[0] + r.wall[1]) / 2;
      if (Math.abs(xc) > 2) o[xc < 0 ? 'L' : 'R'].add((b[2] + b[3]) / 2 > 13 ? 'front' : 'back'); }
    return { L: [...o.L].sort(), R: [...o.R].sort() }; };

  for (const [name, r] of Object.entries(R)) it(`${name}: clean, deterministic, the band on the floor in its seats${name === 'finale' ? ' — but the floor is FULL' : ''}`, () => {
    const solved = solve(r);
    const boxes = r.items.map(it => world(solved, it));
    boxes.forEach((b, i) => {
      expect(clear(b, r.wall), `${r.items[i].key} × wall`).toBe(true);
      for (let j = i + 1; j < boxes.length; j++) expect(clear(b, boxes[j]), `${r.items[i].key} × ${r.items[j].key}`).toBe(true);
      expect(b[0] >= ROOM.x0 - 1e-9 && b[1] <= ROOM.x1 + 1e-9 && b[2] >= ROOM.z0 - 1e-9 && b[3] <= ROOM.z1 + 1e-9, `${r.items[i].key} in the room`).toBe(true);
    });
    const up = r.items.filter(it => solved[it.key].y !== undefined).map(it => it.key);
    if (name !== 'finale'){
      expect(up, 'nobody on the gallery while the floor has room').toEqual([]);
      for (const it of r.items) if (BAND_KEYS.includes(it.key) && it.key !== r.star) expect(seatOf(it.key, solved[it.key]), `${it.key} in a seat`).not.toBeNull();
    }
    expect(solve(r)).toEqual(solved);
  });

  it('THE DRUM RISER + BALANCE: The Entertainer — the kit up on the right wing, the brass centre, the harp front-right (the lighter side)', () => {
    // (2026-10-25 balance: the kit used to stand front-right, its arch covering the whole right-back wedge from
    //  the wide's eyes — the harp ended in the far corner past it. Now the drummer is behind the band: the
    //  right wing on its riser; bass + grand on the left, so the harp takes the right — the lighter side)
    const solved = solve(R.entertainer);
    expect(solved.drums).toEqual({ x: KIT_RISER.x, z: KIT_RISER.z, lift: KIT_RISER.lift });
    expect(seatOf('horns', solved.horns)).toBe('centre');
    expect(seatOf('strum', solved.strum)).toBe('right');
  });
  it('…seen from the wide\'s LOW eye (the band\'s concert-film wide, y ≈ 8): Mars\'s riff stands in the front row, never behind the kit\'s arch', () => {
    // (polish 2026-10-25: from the old single eye at y 14 the seat in front of the belt passed — the real
    //  wide, lower, showed the riff a third behind the arch)
    const solved = solve(R.mars), b = world(solved, R.mars.items.find(it => it.key === 'riff')), kit = world(solved, R.mars.items.find(it => it.key === 'drums'));
    expect(seatOf('riff', solved.riff)).toBe('centre');
    expect(b[3], 'the riff\'s front edge reaches the kit\'s row').toBeGreaterThan(kit[2]);
    expect(b[1], 'beside the kit, not behind it').toBeLessThanOrEqual(kit[0]);
    expect(seatOf('horns', solved.horns)).toBe('cornerL');
    // (balance 2026-10-25: the kit up its riser on the right wing answers the harp on the left wing — the
    //  band no longer piles up left of the kit: either side of the belt, a front machine AND a back one)
    expect(solved.drums).toEqual({ x: KIT_RISER.x, z: KIT_RISER.z, lift: KIT_RISER.lift });
    expect(seatOf('strum', solved.strum)).toBe('wingL');
    expect(rows(R.mars, solved)).toEqual({ L: ['back', 'front'], R: ['back', 'front'] });
  });

  it('Forge: no lone towers, and BALANCED — the riff front and centre, the brass front-right, the bass and the kit (on its riser) the two wings', () => {
    // (balance 2026-10-25: the horns used to take the front-left corner — bass, brass and riff all left of a
    //  front-right kit whose arch hid the right wing. The kit is the right wing now; the brass, picking with
    //  the left already holding the bass + the riff, takes the lighter side — its front-right CORNER: the
    //  'right' seat stood the bells right across the riser's front, its lit edge + VU strip, from the wide)
    const solved = solve(R.forge);
    expect(seatOf('riff', solved.riff)).toBe('centre');
    expect(seatOf('horns', solved.horns)).toBe('cornerR');
    expect(solved.drums).toEqual({ x: KIT_RISER.x, z: KIT_RISER.z, lift: KIT_RISER.lift });
    expect(rows(R.forge, solved)).toEqual({ L: ['back', 'front'], R: ['back', 'front'] });
  });
  it('THE DRUM RISER only while the band plays, only where it is seen and free — and never at the floor\'s cost', () => {
    const forge = R.forge, kit = forge.items.find(it => it.key === 'drums');
    // no band: the kit keeps its front-row slot (every approved song's stage is unchanged)
    const nb = solve({ ...forge, items: forge.items.filter(it => !STATIONS[it.key]?.gallery) });
    expect(nb.drums).toEqual({ x: kit.x, z: kit.z });
    // the wing taken (the music box plays): its own slot, on the floor (the star still clears its foreground)
    const mop = R['mop.mid'], mb = { ...mop, items: [...mop.items, it_('musicbox', 25, 3.2, [-6.6, 6.6, -6.7, 6.7], 4, -5.1)] };
    expect(solve(mb).drums.lift).toBeUndefined();
    expect(solve(mb).drums.x).toBeGreaterThan(solve({ ...mb, star: null }).drums.x);
    // the USER's height wins: a kit stood ON THE FLOOR never climbs its riser; one pinned on the wing stands on it
    const lift0 = solve({ ...mop, items: mop.items.map(it => it.key === 'drums' ? { ...it, lift: 0 } : it) });
    expect(lift0.drums.lift).toBeUndefined();
    expect(lift0.drums.z).toBeGreaterThan(10);
    const pinned = solve({ ...mop, items: mop.items.map(it => it.key === 'drums' ? { ...it, x: 23, z: 6, pin: true } : it) });
    expect(pinned.drums).toEqual({ x: 23, z: 6, lift: KIT_RISER.lift });
    // …on a WIDE belt the riser rides out with the wing (as the unpinned home does): a kit pinned THERE stands
    //  on it, one pinned at the narrow belt's riser spot (now ~5 u inside it) does not
    const wide = { ...mop, wall: [mop.wall[0] - 5, mop.wall[1] + 5, mop.wall[2], mop.wall[3]] };
    const rx = riserAt(wide.wall, { cx: 0 }).x;
    expect(rx).toBeCloseTo(KIT_RISER.x + Math.max(0, wide.wall[1] - WING_REF), 9);
    const onWide = solve({ ...wide, items: wide.items.map(it => it.key === 'drums' ? { ...it, x: rx, z: KIT_RISER.z, pin: true } : it) });
    expect(onWide.drums.lift).toBe(KIT_RISER.lift);
    if (rx - KIT_RISER.x > SEAT_R) expect(solve({ ...wide, items: wide.items.map(it => it.key === 'drums' ? { ...it, x: KIT_RISER.x, z: KIT_RISER.z, pin: true } : it) }).drums.lift).toBeUndefined();
    // kitRiseAt — what main's stage edit asks when the kit is DRAGGED (so a live move matches the reload):
    //  the riser's rise on the wing while the band plays, none off it or without the band
    const keys = mop.items.map(it => it.key);
    expect(kitRiseAt(KIT_RISER.x, KIT_RISER.z, keys, mop.wall, { cx: 0 })).toBe(KIT_RISER.lift);
    expect(kitRiseAt(-13, 16.5, keys, mop.wall, { cx: 0 })).toBe(0);
    expect(kitRiseAt(KIT_RISER.x, KIT_RISER.z, keys.filter(k => !STATIONS[k]?.gallery), mop.wall, { cx: 0 })).toBe(0);
    // (a nicer stage never costs the floor a machine: the gallery tests above — 2 bays, the big cast — keep
    //  nobody up; there the riser alone would have sent the brass up, so that floor stands without it)
  });
  it('TIERED RISERS: Sweet Home Alabama gets depth — the pogo on the left wing on the smallest riser that shows it over the riff; a front seat never rises', () => {
    // (2026-10-25: the front row was a wall of four — riff, grand, kit, pogo. Now two in front, two up behind)
    const r = R['alabama.mid'], solved = solve(r);
    expect(seatOf('pogo', solved.pogo)).toBe('wingL');
    expect(solved.pogo.lift).toBe(SEAT_RISE[0]);
    expect(solved.drums).toEqual({ x: KIT_RISER.x, z: KIT_RISER.z, lift: KIT_RISER.lift });
    const front = r.items.filter(it => { const b = world(solved, it); return (b[2] + b[3]) / 2 > 13; }).map(it => it.key).sort();
    expect(front).toEqual(['dulcimer', 'riff']);
    for (const it of r.items) if (solved[it.key].lift !== undefined) expect(solved[it.key].z, `${it.key} rises only in a back seat`).toBeLessThan(10);
  });
  it('a LONE STAR turns a three-quarter (Piano Man\'s grand — the wide would see it head-on, on the belt\'s axis); anyone else keeps its yaw', () => {
    expect(loneTurn(['dulcimer'], 'dulcimer')).toBe(STATIONS.dulcimer.turn);
    expect(Math.abs(STATIONS.dulcimer.turn)).toBeGreaterThan(.3);
    expect(loneTurn(['dulcimer', 'drums'], 'dulcimer')).toBe(0);   // (not alone)
    expect(loneTurn(['dulcimer'], null)).toBe(0);                  // (not the star: it stands at its corner, seen three-quarter already)
    expect(loneTurn(['riff'], 'riff')).toBe(0);                    // (no turn hint: a guitar reads head-on)
  });

  it('a floor that is genuinely FULL opens the gallery: the fewest climb, in one row behind the belt (Starship Groove)', () => {
    const r = R.finale, solved = solve(r);
    const up = r.items.filter(it => solved[it.key].y !== undefined);
    expect(up.map(it => it.key).sort()).toEqual(['horns', 'riff']);               // (the strum still finds a seat)
    expect(seatOf('strum', solved.strum)).toBe('left');
    // …side by side on ONE loft (rooms/footing.js: within LOFT_GAP), not two lone towers
    const [p, q] = up.map(it => world(solved, it));
    expect(Math.max(p[0] - q[1], q[0] - p[1], p[2] - q[3], q[2] - p[3]), 'one loft').toBeLessThanOrEqual(FOOT.LOFT_GAP);
    for (const k of APPROVED) if (solved[k]) expect(solved[k].y, `${k} on the floor`).toBeUndefined();
    const [a, b] = up.map(it => world(solved, it));
    for (const it of up){
      const w = world(solved, it);
      expect(solved[it.key].y).toBeCloseTo(r.top - GALLERY_DROP, 9);
      expect((w[2] + w[3]) / 2, `${it.key} behind the belt`).toBeLessThan(r.wall[2]);
      for (const h of r.hung) expect(w[1] <= h[0] || h[1] <= w[0] || w[2] >= h[3], `${it.key} in the organ's footprint / shadow`).toBe(true);
    }
    expect(a[1] <= b[0] || b[1] <= a[0], 'one row: neither behind the other').toBe(true);
  });
  it('…and a machine that climbs takes the spot BESIDE one already up (one loft — rooms/footing.js), not its own far slot', () => {
    // (a floor walled off by the user's pinned pads: only the gallery behind the belt is left — the
    //  pogo's own slot is at the far right end; beside the riff it shares the riff's loft)
    const pad = (key, x0, x1, z0, z1) => ({ key, x: (x0 + x1) / 2, z: (z0 + z1) / 2, box: [-(x1 - x0) / 2, (x1 - x0) / 2, -(z1 - z0) / 2, (z1 - z0) / 2], pin: true });
    const items = [pad('padL', ROOM.x0, -18, ROOM.z0, ROOM.z1), pad('padR', 18, ROOM.x1, ROOM.z0, ROOM.z1), pad('padF', -16.5, 16.5, 3.5, ROOM.z1),
      { key: 'riff', x: STATIONS.riff.x, z: STATIONS.riff.z, box: [-6.6, 6.7, -3.2, 3.2] }, { key: 'pogo', x: STATIONS.pogo.x, z: STATIONS.pogo.z, box: [-5.5, 5.5, -2.4, 2.4] }];
    const wall = walls['1 bay'], solved = layoutStations(items, wall, ROOM, { wallTop: 15.7 });
    expect(solved.riff.y).toBeCloseTo(15.7 - GALLERY_DROP, 9); expect(solved.pogo.y).toBeCloseTo(15.7 - GALLERY_DROP, 9);
    const a = world(solved, items[3]), b = world(solved, items[4]);
    expect(a[1] <= b[0] || b[1] <= a[0], 'one row').toBe(true);
    expect(Math.max(a[0] - b[1], b[0] - a[1], a[2] - b[3], b[2] - a[3]), 'one loft').toBeLessThanOrEqual(FOOT.LOFT_GAP);
    expect(layoutStations(items, wall, ROOM, { wallTop: 15.7 })).toEqual(solved);
  });

  it('…a loft that is ONE loft by centimetres stays one: the partner slides along its row to make room (Starship Groove, the brass a little wider)', () => {
    // (critic 2026-10-25: 2 cm more brass used to send the horns to their own far slot — two lone towers.
    //  The real limit is the room: its wall and the organ's shadow leave the pair ~0.1 u a side to spare)
    for (const grow of [.02, .05, .1]){
      const r = { ...R.finale, items: R.finale.items.map(it => it.key === 'horns' ? { ...it, box: [it.box[0] - grow, it.box[1] + grow, it.box[2], it.box[3]] } : it) };
      const solved = solve(r), up = r.items.filter(it => solved[it.key].y !== undefined);
      expect(up.map(it => it.key).sort(), `+${grow}`).toEqual(['horns', 'riff']);
      const [p, q] = up.map(it => world(solved, it));
      expect(p[1] <= q[0] || q[1] <= p[0], `+${grow}: one row`).toBe(true);
      expect(Math.max(p[0] - q[1], q[0] - p[1], p[2] - q[3], q[2] - p[3]), `+${grow}: one loft`).toBeLessThanOrEqual(FOOT.LOFT_GAP);
    }
  });
  it('the USER\'s height wins: a band machine the user stood ON THE FLOOR (lift 0) never climbs, nor leaves a partner alone up there', () => {
    // (critic 2026-10-25: Starship Groove with the riff at lift 0 stood it on the floor at its GALLERY spot,
    //  behind the belt, and left the horns alone on a 13 m tower)
    const r = { ...R.finale, items: R.finale.items.map(it => it.key === 'riff' ? { ...it, lift: 0 } : it) }, solved = solve(r);
    expect(solved.riff.y, 'the riff on the floor').toBeUndefined();
    const rb = world(solved, r.items.find(it => it.key === 'riff'));
    expect((rb[2] + rb[3]) / 2, 'in front of the belt, not hidden behind it').toBeGreaterThan(r.wall[3]);
    const up = r.items.filter(it => solved[it.key].y !== undefined).map(it => world(solved, it));
    expect(up.length === 0 || up.length >= 2, 'never ONE machine up alone').toBe(true);
    for (let i = 1; i < up.length; i++){
      const p = up[0], q = up[i];
      expect(Math.max(p[0] - q[1], q[0] - p[1], p[2] - q[3], q[2] - p[3]), 'one loft').toBeLessThanOrEqual(FOOT.LOFT_GAP);
    }
    // …and a pinned gallery-born machine the user put on the floor stays on the floor
    const pinned = layoutStations(R['mop.mid'].items.map(it => it.key === 'riff' ? { ...it, pin: true, lift: 0 } : it), R['mop.mid'].wall, ROOM, { ...ENV, wallTop: R['mop.mid'].top });
    expect(pinned.riff.y).toBeUndefined();
  });
  it('a HUNG machine taken down is just another pinned item: it stays where the user stood it, nobody overlaps it, and the spot it hung at is free', () => {
    // (Starship Groove: the organ loft taken down to the front-left floor — it stands; nothing hangs behind the belt now)
    const organ = it_('organ', -14, 24, [-6.6, 6.6, -2.3, 2.3], 3, -5.1, { pin: true, lift: 0 });
    const r = { ...R.finale, hung: [], items: [...R.finale.items, organ] }, solved = solve(r);
    expect(solved.organ).toEqual({ x: -14, z: 24 });
    const o = world(solved, organ);
    for (const it of r.items) if (it !== organ) expect(clear(world(solved, it), o), `${it.key} clear of the organ`).toBe(true);
    // …and nobody overlaps anybody (the gallery may now stand where the loft hung: no hung footprint)
    for (const a of r.items) for (const b of r.items) if (a !== b && (solved[a.key].y !== undefined) === (solved[b.key].y !== undefined))
      expect(clear(world(solved, a), world(solved, b)), `${a.key} × ${b.key}`).toBe(true);
    expect(solve(r)).toEqual(solved);                                          // (deterministic)
    // not taken down (no entry — the default): the stage is exactly as it was
    expect(solve(R.finale)).toEqual(solve({ ...R.finale }));
  });
  it('a solo never climbs: a band machine ALONE is its own star (front and centre); beside the kit it takes its FIRST seat', () => {
    for (const k of BAND_KEYS) for (const kit of [false, true]){
      const items = [{ key: k, x: STATIONS[k].x, z: STATIONS[k].z, box: boxOf(STATIONS[k]) }, ...(kit ? [{ key: 'drums', ...KIT }] : [])];
      const solved = layoutStations(items, walls['1 bay'], ROOM);
      expect(solved[k].y, `${k} solo`).toBeUndefined();
      if (kit) expect(seatOf(k, solved[k]), `${k} solo + kit`).toBe(STATIONS[k].floor[0]);
      else expect(solved[k], `${k} alone`).toEqual({ x: STAR.x, z: STAR.z });
      expect(soloStar(items), `${k}${kit ? ' + kit' : ''}`).toBe(kit ? null : k);
    }
    expect(soloStar([{ key: 'drums', ...KIT }]), 'the kit alone keeps its own slot').toBeNull();
  });

  /* the star's FOREGROUND: anyone whose back edge is in front of the star's front edge and whose
     footprint, seen from the audience, overlaps the star's (past STAR_GRAZE) stays under the
     audience's sightline to the star's base (its deck) */
  const foreground = (r, solved, star) => {
    const S = world(solved, r.items.find(it => it.key === star)), base = r.items.find(it => it.key === star).deck;
    const cx = (r.wall[0] + r.wall[1]) / 2, ax = cx + AUDIENCE.dx, az = AUDIENCE.z;
    return r.items.filter(it => it.key !== star).filter(it => {
      const b = world(solved, it);
      if (b[2] <= S[3]) return false;
      const k = (az - S[3]) / (az - b[2]), p0 = ax + (b[0] - ax) * k, p1 = ax + (b[1] - ax) * k;
      if (p1 <= S[0] + STAR_GRAZE || p0 >= S[1] - STAR_GRAZE) return false;
      return it.top > base + (ENV.eyeY - base) * (b[2] - S[3]) / (az - S[3]) + 1e-9;
    }).map(it => it.key);
  };
  for (const name of ['mop.mid', 'alabama.mid', 'pianoman.mid']) it(`THE STAR: ${name}'s signature (${R[name].star}) stands front and centre, nobody in its foreground`, () => {
    const r = R[name], solved = solve(r);
    expect(solved[r.star]).toEqual({ x: (r.wall[0] + r.wall[1]) / 2 + STAR.x, z: STAR.z });
    expect(foreground(r, solved, r.star)).toEqual([]);
    // …in the FRONT ROW: nobody stands nearer the audience than it (polish: the kit used to stand 9 u
    // nearer the lens than a star in front of the belt — the biggest thing in the wide)
    for (const it of r.items) if (it.key !== r.star){ const b = world(solved, it);
      expect((b[2] + b[3]) / 2, `${it.key} nearer the audience than the star`).toBeLessThanOrEqual(STAR.z + STAR_LEAD + 1e-9); }
    expect(solve({ ...r, star: null })[r.star], 'without a star it keeps its own slot / seat').not.toEqual(solved[r.star]);
  });
  it('THE STAR: the kit is out of its foreground (Master of Puppets: the riff in front of the belt; the kit up its riser on the right wing, the pogo the left — a power trio)', () => {
    // (before the drum riser, 2026-10-25, the kit stepped aside along the front row; it still does when its
    //  wing is taken — see 'THE DRUM RISER only while…')
    const r = R['mop.mid'], solved = solve(r);
    expect(solved.drums).toEqual({ x: KIT_RISER.x, z: KIT_RISER.z, lift: KIT_RISER.lift });
    expect(foreground(r, solved, r.star)).toEqual([]);
    expect(seatOf('pogo', solved.pogo)).toBe('wingL');
  });
  it('THE STAR: a tall one steps forward until it is under the strike band\'s sightline; it never climbs', () => {
    const bells = it_('bells', 26, -10, [-6.4, 6.4, -5.9, 5.9], 10.8, -5.1), kit = R.forge.items.find(it => it.key === 'drums');
    const r = { wall: [-10.9, 10.9, -4.1, 1.7], top: 15.9, hung: [], star: 'bells', items: [bells, kit] }, solved = solve(r);
    const b = world(solved, bells), zp = (r.wall[2] + r.wall[3]) / 2;
    expect(solved.bells.y).toBeUndefined();
    expect(solved.bells.x).toBe(STAR.x);
    expect(solved.bells.z).toBeGreaterThan(STAR.z);
    expect(bells.top).toBeLessThanOrEqual(ENV.bandY + (ENV.eyeY - ENV.bandY) * (Math.max(b[2], zp) - zp) / (AUDIENCE.z - zp) + 1e-9);
    expect(foreground(r, solved, 'bells')).toEqual([]);
  });
  it('PINS win: a pinned star stays where the user put it; a pinned band machine behind the belt stands on the gallery there (as before)', () => {
    const r = R['mop.mid'], riff = r.items.find(it => it.key === 'riff');
    const items = r.items.map(it => it.key === 'riff' ? { ...it, x: 20, z: 12, pin: true } : it);
    const solved = layoutStations(items, r.wall, ROOM, { ...ENV, wallTop: r.top, star: 'riff' });
    expect(solved.riff).toEqual({ x: 20, z: 12 });
    const back = layoutStations(r.items.map(it => it.key === 'riff' ? { ...it, pin: true } : it), r.wall, ROOM, { ...ENV, wallTop: r.top, star: 'riff' });
    expect(back.riff).toEqual({ x: riff.x, z: riff.z, y: r.top - GALLERY_DROP });
  });
});
