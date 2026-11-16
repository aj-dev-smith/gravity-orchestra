import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { describeRoomContract, hostSmoke, KNOWN } from './helpers/room-contract.js';   // (first: it installs the fake DOM)
const { ROOMS, ROOM_KEYS, GUESTS, makeRoomHost } = await import('../src/rooms/index.js');

/* ============================================================
   THE ROOM CONTRACT over EVERY room the registry has — the seven shipped rooms and any GUEST
   (src/rooms/<key>.js, picked up by rooms/index.js's glob) — so a contributed room is covered the
   moment its file exists, with no list to edit. The checks (and the commented KNOWN exceptions of
   the shipped rooms) live in test/helpers/room-contract.js; test/scaffold-room.test.js runs the
   same checks on a freshly generated `npm run new:room` room, so the template can't rot.
   ============================================================ */

// the shipped rooms, in their R order (a guest is appended after them, never between)
const SHIPPED = ['grid', 'cathedral', 'studio', 'void', 'graveyard', 'arena', 'starship'];

describe('the room registry', () => {
  it('the shipped rooms keep their order; guests follow them sorted by key; "off" closes the R cycle', () => {
    expect(ROOMS.slice(0, SHIPPED.length).map(R => R.key)).toEqual(SHIPPED);
    expect(ROOMS.slice(SHIPPED.length)).toEqual(GUESTS);
    expect(GUESTS.map(R => R.key)).toEqual(GUESTS.map(R => R.key).sort((a, b) => a.localeCompare(b)));
    expect(ROOM_KEYS).toEqual([...ROOMS.map(R => R.key), 'off']);
    expect(new Set(ROOM_KEYS).size).toBe(ROOM_KEYS.length);
  });
  it('every src/rooms/<key>.js with a default export IS a room keyed by its file name — none is silently skipped', () => {
    const dir = new URL('../src/rooms/', import.meta.url);
    for (const f of fs.readdirSync(dir).filter(f => /^[a-z][a-z0-9]*\.js$/.test(f) && f !== 'index.js')){
      const src = fs.readFileSync(new URL(f, dir), 'utf8');
      if (!/^export default\b/m.test(src)) continue;                 // (a shared module: common, footing, footing3d, pulse)
      const k = f.slice(0, -3);
      expect(ROOMS.some(R => R.key === k), `src/rooms/${f} has a default export but no room "${k}" registered (its key must be its file name, not "off", with a build())`).toBe(true);
    }
  });
  it('every known exception names a registered room (no stale entries)', () => {
    for (const k of Object.values(KNOWN).flatMap(Object.keys)) expect(ROOM_KEYS, k).toContain(k);
  });
  it('the real room host: every room built, placed, footed and prewarmed, then cycled with R in ROOM_KEYS order', async () => {
    const { seen, warn } = await hostSmoke(makeRoomHost, ROOM_KEYS);
    expect(seen).toEqual(ROOM_KEYS);
    expect(warn.filter(w => /floor contract|prewarm/.test(w))).toEqual([]);
  });
});

for (const R of ROOMS) describeRoomContract(R);
