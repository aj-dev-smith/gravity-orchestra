import { describe, it, expect } from 'vitest';
import { STATIONS, layoutStations, MARGIN, AUDIENCE } from '../src/instruments/stations.js';
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
const itemsFor = keys => [
  ...keys.map(k => ({ key: k, x: STATIONS[k].x, z: STATIONS[k].z, box: boxOf(STATIONS[k]) })),
  { key: 'drums', ...KIT },
];
const walls = { '1 bay': [-12, 12, -4.1, 2], '2 bays': [-22, 22, -4.1, 2.3], '3 bays': [-28, 28, -4.1, 2.3] };
const world = (solved, it) => [solved[it.key].x + it.box[0], solved[it.key].x + it.box[1], solved[it.key].z + it.box[2], solved[it.key].z + it.box[3]];
const clear = (a, b) => a[1] <= b[0] || b[1] <= a[0] || a[3] <= b[2] || b[3] <= a[2];

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
  it('a one-bay room without the turntable keeps the hand-tuned slots (the solve only moves what collides)', () => {
    const items = itemsFor(floorKeys.filter(k => k !== 'turntable'));
    const solved = layoutStations(items, walls['1 bay'], ROOM);
    for (const k of ['marimba', 'bells']) expect(solved[k]).toEqual({ x: STATIONS[k].x, z: STATIONS[k].z });
    for (const k of floorKeys.filter(k => k !== 'turntable'))                       // everyone else: a nudge, not a re-stage
      expect(Math.hypot(solved[k].x - STATIONS[k].x, solved[k].z - STATIONS[k].z), k).toBeLessThan(3);
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
});
