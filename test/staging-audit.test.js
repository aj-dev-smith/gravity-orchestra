import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { layoutStations } from '../src/instruments/stations.js';
import { solveShotEye, rayBox, boxDist, boxPts, CLEAR_RAYS } from '../src/shotsolve.js';
import { DESCENT, ROLL_T } from '../src/engine.js';
const STAGE_Y = DESCENT * ROLL_T;                                 // (main.js: the static strike band)
import { STAGE } from '../src/rooms/common.js';

/* THE STAGING AUDIT, locked in. Every song's room (all songs + the two MIDI fixtures), as
   MEASURED from the built geometry (test/fixtures/staging-rooms.json — regenerate with
   `node scripts/staging-audit.mjs --rooms grid --norun 1 --fixture test/fixtures/staging-rooms.json`
   against a dev server). For each: re-run the pure room solve (layoutStations) and the pure
   shot solve (solveShotEye) and assert
     • no two footprints overlap (station ↔ station ↔ drums ↔ the belt bays), all in the room;
     • every director station shot is CLEAR — ≤ 20 % of its 15 probe rays hit another machine
       first — its eye inside the room (with sway room) and in clear air.
   The test's occluders are the machines' 3D BOUNDING BOXES — conservative (a bandshell's box is
   solid where the real arch is air), so a shot that clears here clears the real meshes too. */
const FIX = JSON.parse(fs.readFileSync(new URL('./fixtures/staging-rooms.json', import.meta.url)));
const ROOM = { x0: -STAGE.HW + 2.5, x1: STAGE.HW - 2.5, z0: STAGE.BACK + 2.5, z1: 31 };
const EYE_ROOM = { x0: -STAGE.HW + 1.5, x1: STAGE.HW - 1.5, y0: STAGE.FLOOR + 1.5, y1: STAGE.CEIL - 1.5, z0: STAGE.BACK + 1.5, z1: STAGE.FRONT - 1.5 };
const clear2 = (a, b) => a[1] <= b[0] || b[1] <= a[0] || a[5] <= b[4] || b[5] <= a[4];
const MAX_BLOCKED = 3;                                          // 3 / 15 = 20 %

describe('staging audit: every song lays out clean and every station shot sees its station', () => {
  it('the fixture covers every song + the MIDI imports', () => {
    expect(FIX.length).toBeGreaterThanOrEqual(19);
  });
  for (const R of FIX){
    const wall = R.wall;                                        // [x0,x1,y0,y1,z0,z1]
    const solved = R.items.length ? layoutStations(R.items.map(({ key, x, z, box, top }) => ({ key, x, z, box, top })),
      [wall[0], wall[1], wall[4], wall[5]], ROOM, { cx: R.cx, bandY: R.bandY, eyeY: 20 }) : {};
    const box3 = it => { const p = solved[it.key]; return [p.x + it.box[0], p.x + it.box[1], it.y0, it.top, p.z + it.box[2], p.z + it.box[3]]; };
    const boxes = Object.fromEntries(R.items.map(it => [it.key, box3(it)]));
    for (const f of R.fixed || []) boxes[f.key] = f.box;
    boxes.belt = wall;

    it(`${R.song}: no footprint overlaps (stations, drums, belt bays), all inside the room`, () => {
      const keys = R.items.map(it => it.key);
      for (let i = 0; i < keys.length; i++){
        const a = boxes[keys[i]];
        expect(clear2(a, wall), `${keys[i]} × belt`).toBe(true);
        for (let j = i + 1; j < keys.length; j++) expect(clear2(a, boxes[keys[j]]), `${keys[i]} × ${keys[j]}`).toBe(true);
        expect(a[0] >= ROOM.x0 - 1e-9 && a[1] <= ROOM.x1 + 1e-9 && a[4] >= ROOM.z0 - 1e-9, `${keys[i]} inside the room`).toBe(true);
        expect(a[5], `${keys[i]} (a crowded floor may borrow ≤ 6 u of depth)`).toBeLessThanOrEqual(ROOM.z1 + 6 + 1e-9);
      }
    });

    if (R.shots.length) it(`${R.song}: every station shot is clear (≤ 20 % blocked), in the room, in clear air`, () => {
      for (const sh of R.shots){
        const self = boxes[sh.owner];
        const at = sh.owner in solved ? solved[sh.owner] : { x: 0, z: 0 };
        const shift = v => [v[0] + at.x, v[1], v[2] + at.z];
        const aim = shift(sh.aim), pref = shift(sh.pref);
        const others = Object.entries(boxes).filter(([k]) => k !== sh.owner).map(([, b]) => b);
        const blocked = (e, d, far) => {
          const tSelf = rayBox(e, d, self);
          let tO = Infinity; for (const b of others) tO = Math.min(tO, rayBox(e, d, b));
          return tO < Math.min(tSelf, far);
        };
        const r = solveShotEye({ aim, pref, room: EYE_ROOM, blocked, others, subject: boxPts(self, aim[1] - 4) });
        expect(r.rays, `${R.song} ${sh.key}: ${r.rays}/15 probe rays blocked (eye ${r.eye.map(v => v.toFixed(1))})`).toBeLessThanOrEqual(MAX_BLOCKED);
        const e = r.eye;
        expect(e[0] >= EYE_ROOM.x0 && e[0] <= EYE_ROOM.x1 && e[1] >= EYE_ROOM.y0 && e[1] <= EYE_ROOM.y1 && e[2] >= EYE_ROOM.z0 && e[2] <= EYE_ROOM.z1, `${sh.key} eye in the room`).toBe(true);
        for (const b of others) expect(boxDist(e, b), `${sh.key} eye in clear air`).toBeGreaterThan(1);
      }
    });
  }
  /* the belt's FOLLOW shot (camera.js all / lead / alto / bass in a full room): its offset is
     solved in the browser against the real meshes (main: solveFollow) and recorded in the
     fixture; here: it came back clean, and for a marble anywhere along the wall the eye — at
     every pull-back that aspect class uses — stands in clear air, inside the room */
  for (const R of FIX) if (R.follow) it(`${R.song}: the belt's follow eye is clear (desktop + phone)`, () => {
    expect(R.follow.rays[0], 'landscape follow: blocked probe rays').toBeLessThanOrEqual(MAX_BLOCKED);
    expect(R.follow.rays[1], 'portrait follow: blocked probe rays').toBeLessThanOrEqual(MAX_BLOCKED);
    const solved = R.items.length ? layoutStations(R.items, [R.wall[0], R.wall[1], R.wall[4], R.wall[5]], ROOM, { cx: R.cx, bandY: R.bandY, eyeY: 20 }) : {};
    const boxes = R.items.map(it => { const p = solved[it.key]; return [p.x + it.box[0], p.x + it.box[1], it.y0, it.top, p.z + it.box[2], p.z + it.box[3]]; })
      .concat((R.fixed || []).map(f => f.box));
    const zc = (R.wall[4] + R.wall[5]) / 2;
    for (const [off, backs] of [[R.follow.land, [1, 1.6]], [R.follow.portrait, [2.4, 3.2]]])
      for (let i = 0; i <= 2; i++) for (const k of backs){
        const fx = R.wall[0] + 2 + (R.wall[1] - R.wall[0] - 4) * i / 2;
        const eye = [fx + off[0] * k, STAGE_Y + off[1], zc + off[2] * k];
        for (const b of boxes) expect(boxDist(eye, b), `follow eye ${eye.map(v => v.toFixed(1))} grazes a machine`).toBeGreaterThanOrEqual(.8 - 1e-6);
      }
  });

  it('the solve is deterministic and keeps the designer\'s angle when it is already clear', () => {
    const aim = [0, 3, 0], pref = [0, 8, 15];
    const r = solveShotEye({ aim, pref, room: EYE_ROOM, blocked: () => false });
    expect(r.eye).toEqual(pref); expect(r.rays).toBe(0);
    // a wall straight between: the eye swings round it
    const wallBox = [-4, 4, -22, 12, 6, 7];
    const blk = (e, d, far) => rayBox(e, d, wallBox) < far;
    const s = solveShotEye({ aim, pref, room: EYE_ROOM, blocked: blk, others: [wallBox] });
    expect(s.rays).toBeLessThanOrEqual(CLEAR_RAYS);
    expect(solveShotEye({ aim, pref, room: EYE_ROOM, blocked: blk, others: [wallBox] })).toEqual(s);
  });
});
