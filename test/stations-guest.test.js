import { describe, it, expect } from 'vitest';
import { STATIONS, SEATS, SEAT_R, STAR, layoutStations, stationFor, guestSlot, soloStar, GUEST_SEATS, GUEST_W, GUEST_D } from '../src/instruments/stations.js';
import { STAGE } from '../src/rooms/common.js';

/* THE GUEST SLOT (stations.js guestSlot): a plugin with NO STATIONS entry — a contributed machine, one
   folder and no shared edit — is placed by the room solve like the band: the first free floor SEAT,
   seen, picked LAST. Every shipped machine's slot (and so every shipped song's stage) is untouched. */
const ROOM = { x0: -STAGE.HW + 2.5, x1: STAGE.HW - 2.5, z0: STAGE.BACK + 2.5, z1: 31 };
const ENV = { bandY: 4.2, eyeY: 20 };
const it_ = (key, x, z, box, top, deck, extra = {}) => ({ key, x, z, box, top, deck, ...extra });
/* measured rooms (stations.test.js, main's built footprints) */
const R = {
  forge: { wall: [-10.9, 10.9, -4, 1.7], top: 15.8, hung: [[-5.5, 5.5, -16, -11.3]], items: [
    it_('bass', -20, 3.6, [-5.9, 5.9, -6.9, 6.9], 4.3, -5.1), it_('horns', 15.5, -11, [-7.2, 7.1, -2.6, 3.2], 2.9, -5.1),
    it_('riff', -14, -11, [-6.6, 6.7, -3.1, 3.2], .4, -5.1), it_('drums', 11, 19, [-9.2, 9.4, -2.7, 3], 6.2, -4.8)] },
  entertainer: { wall: [-10.9, 10.9, -4.1, 1.7], top: 15.9, hung: [], items: [
    it_('bass', -20, 3.6, [-5.9, 5.9, -6.9, 6.9], 4.3, -5.1), it_('dulcimer', -27.5, 17, [-5.8, 5.8, -3.9, 4.9], .5, -5.1),
    it_('horns', 15.5, -11, [-7.2, 7.1, -2.9, 3.6], 3.2, -5.1), it_('strum', -28.9, -11, [-5.6, 5.7, -2.6, 2.4], .1, -5.1),
    it_('drums', 11, 19, [-9.2, 2.8, -2.7, 2.8], 4.9, -4.8)] },
  daybreak: { wall: [-11.2, 11.2, -4.1, 2.5], top: 15.7, hung: [], items: [
    it_('bass', -20, 3.6, [-5.9, 5.9, -6.9, 6.9], 9.4), it_('bells', 26, -10, [-6.4, 6.4, -5.9, 5.9], 15.9),
    it_('bowls', -13, 18, [-6.8, 6.8, -6.8, 6.8], 4.8), it_('marimba', -25, -10.5, [-7.2, 6.7, -6.5, 7.0], 9.2),
    it_('turntable', 0, 12.5, [-8.1, 8.1, -8.1, 8.1], 8.1), it_('drums', 11, 19, [-8.8, 8.8, -4.9, 2.9], 8.4)] },
};
const GUEST_I = { key: 'zzguest', stage: { w: 8, d: 3.5 } };
const guestItem = (I = GUEST_I) => { const s = guestSlot(I); return { key: I.key, x: s.x, z: s.z, box: [-s.w / 2, s.w / 2, -s.d / 2, s.d / 2], top: 3, deck: -5.1, slot: s }; };
const solve = (r, items) => layoutStations(items, r.wall, ROOM, { ...ENV, wallTop: r.top, hung: r.hung, star: null });
const world = (s, it) => [s[it.key].x + it.box[0], s[it.key].x + it.box[1], s[it.key].z + it.box[2], s[it.key].z + it.box[3]];
const clear = (a, b) => a[1] <= b[0] || b[1] <= a[0] || a[3] <= b[2] || b[3] <= a[2];

describe('the guest slot (a plugin with no STATIONS entry)', () => {
  it('every shipped machine keeps its own STATIONS slot — the very same object', () => {
    for (const k of Object.keys(STATIONS)) expect(stationFor(k, 3, { key: k, stage: { w: 1 } })).toBe(STATIONS[k]);
  });
  it('defaults, hints, clamps', () => {
    const d = guestSlot({ key: 'x' });
    expect(d).toMatchObject({ w: GUEST_W, d: GUEST_D, yaw: 0, gallery: true, guest: true, floor: GUEST_SEATS });
    expect(guestSlot(null).floor).toEqual(GUEST_SEATS);
    const h = guestSlot({ stage: { w: 99, d: -3, yaw: .4, seats: ['wingL', 'nowhere', 'centre'] } });
    expect(h).toMatchObject({ w: 24, d: 2, yaw: .4, floor: ['wingL', 'centre'] });
    for (const s of GUEST_SEATS) expect(SEATS[s], s).toBeTruthy();
    expect(stationFor('zzguest', 0, GUEST_I)).toEqual(guestSlot(GUEST_I));
  });
  for (const [name, r] of Object.entries(R)) it(`${name}: a guest joins — every other machine keeps exactly its solved spot; the guest takes a free seat, clean`, () => {
    const before = solve(r, r.items), g = guestItem(), items = [...r.items, g], after = solve(r, items);
    for (const it of r.items) expect(after[it.key], it.key).toEqual(before[it.key]);
    expect(after[g.key].y, 'on the floor').toBeUndefined();
    expect(GUEST_SEATS.some(n => Math.hypot(after[g.key].x - SEATS[n].x, after[g.key].z - SEATS[n].z) <= SEAT_R + 1e-9), `a seat: ${JSON.stringify(after[g.key])}`).toBe(true);
    const G = world(after, g);
    expect(clear(G, r.wall)).toBe(true);
    for (const it of r.items) expect(clear(G, world(after, it)), it.key).toBe(true);
    expect(G[0] >= ROOM.x0 - 1e-9 && G[1] <= ROOM.x1 + 1e-9 && G[2] >= ROOM.z0 - 1e-9 && G[3] <= ROOM.z1 + 1e-9).toBe(true);
    expect(solve(r, items)).toEqual(after);                            // deterministic
  });
  it('a solo guest is its own STAR (front and centre — the ?solo demo); a guest with seat hints takes the first free one', () => {
    const g = guestItem();
    expect(soloStar([g])).toBe(g.key);
    expect(layoutStations([g], [-12, 12, -4.1, 2], ROOM)[g.key]).toEqual({ x: STAR.x, z: STAR.z });
    const w = guestItem({ key: 'zzguest', stage: { w: 8, d: 3.5, seats: ['wingL'] } }), kit = it_('drums', 11, 19, [-8.8, 8.8, -4.9, 2.9], 8.4);
    const s = layoutStations([w, kit], [-12, 12, -4.1, 2], ROOM, ENV)[w.key];
    expect(Math.hypot(s.x - SEATS.wingL.x, s.z - SEATS.wingL.z)).toBeLessThanOrEqual(SEAT_R);
  });
  it('without its slot (an old caller) an unknown key is still placed — the old path, unchanged', () => {
    const { slot, ...bare } = guestItem();
    const s = layoutStations([bare, it_('drums', 11, 19, [-8.8, 8.8, -4.9, 2.9], 8.4)], [-12, 12, -4.1, 2], ROOM, ENV);
    expect(Number.isFinite(s[bare.key].x) && Number.isFinite(s[bare.key].z)).toBe(true);
    expect(slot.guest).toBe(true);
  });
});
