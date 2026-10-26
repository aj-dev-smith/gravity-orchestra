import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { layoutStations } from '../src/instruments/stations.js';
import { STAGE } from '../src/rooms/common.js';
import { planFooting, footingBoxes, FOOT } from '../src/rooms/footing.js';
import { planArenaProps, jetClearance, plumeClearance, flameR, CO2_ENV, co2Dir, JET_HOME, CO2_HOME, PYRO, RIG, AMP, rigSolids } from '../src/rooms/arena-props.js';

/* THE ARENA'S PYRO STANDS CLEAR OF THE MACHINES (src/rooms/arena-props.js): every flame column and CO2
   plume, at its widest, keeps CLEAR (1 u) from every machine, every support the room built under them
   and the rig — for every song's solved layout (the staging fixture, replayed as the staging audit does)
   and for layouts built to get in the way (a machine on a projector, a tower in a plume's path). */
const F = STAGE.FLOOR, C = PYRO.CLEAR;
const FIX = JSON.parse(fs.readFileSync(new URL('./fixtures/staging-rooms.json', import.meta.url))).songs;
const ROOM = { x0: -STAGE.HW + 2.5, x1: STAGE.HW - 2.5, z0: STAGE.BACK + 2.5, z1: 31 };
const FOOT_ROOM = { x0: -STAGE.HW, x1: STAGE.HW, z0: STAGE.BACK, z1: STAGE.FRONT };
/* (test/staging-audit.test.js: main's solve inputs → the solved spots → the anchors the room is told about) */
const galleryOpts = R => ({ cx: R.cx, bandY: R.bandY, eyeY: 20, wallTop: R.wall[3], hung: R.hung || (R.fixed || []).map(f => [f.box[0], f.box[1], f.box[4], f.box[5]]) });
const boxSolved = (solved, it) => { const p = solved[it.key], up = p.y === undefined ? 0 : p.y - (it.deck ?? 0);
  return [p.x + it.box[0], p.x + it.box[1], it.y0 + up, it.top + up, p.z + it.box[2], p.z + it.box[3]]; };
function anchorsOf(R){
  const w = R.wall, solved = R.items.length ? layoutStations(R.items.map(({ key, x, z, box, top }) => ({ key, x, z, box, top })),
    [w[0], w[1], w[4], w[5]], ROOM, galleryOpts(R)) : {};
  const anchors = w ? [{ key: 'belt', kind: 'belt', x: (w[0] + w[1]) / 2, z: (w[4] + w[5]) / 2, yaw: 0, w: w[1] - w[0], d: w[5] - w[4], y: F, bottom: F, low: w[2], box: w, cue: [], fixed: true }] : [];
  for (const it of R.items){
    const f = it.foot, p = solved[it.key]; if (!f || !p) continue;
    const deck = p.y ?? f.deck;
    anchors.push({ key: it.key, kind: it.key === 'drums' ? 'kit' : 'station', x: p.x + f.dx, z: p.z + f.dz, yaw: f.yaw, w: f.w, d: f.d,
      y: deck, bottom: deck + f.bot, low: deck + f.low, box: boxSolved(solved, it), feet: f.feet, hang: f.hang, cue: [], fixed: false });
  }
  for (const h of R.fixed || []) anchors.push({ key: h.key, kind: 'hung', x: (h.box[0] + h.box[1]) / 2, z: (h.box[4] + h.box[5]) / 2, yaw: 0,
    w: h.box[1] - h.box[0], d: h.box[5] - h.box[4], box: h.box, cue: [], fixed: true });
  return anchors;
}
const plan = A => planFooting(A, { floor: F, room: FOOT_ROOM });
/* a station anchor (its world box from its footprint + height) */
const st = (key, x, z, w, d, h = FOOT.PLINTH, tall = 5, extra = {}) => ({ key, kind: 'station', x, z, yaw: 0, w, d, y: F + h, bottom: F + h, low: F + h,
  box: [x - w / 2, x + w / 2, F + h, F + h + tall, z - d / 2, z + d / 2], cue: [], fixed: false, ...extra });
/* every box the pyro must clear: the machines, their footing, the rig */
const solidsOf = (A, P) => A.map(a => a.box).concat(footingBoxes(P).map(e => e.box));
function expectClear(r, A, P, what){
  const S = solidsOf(A, P);
  for (const [j, q] of r.jets.entries()) if (q.live){
    expect(jetClearance(q.x, q.z, S, F), `${what}: jet ${j} at (${q.x}, ${q.z})`).toBeGreaterThanOrEqual(C - 1e-9);
    expect(jetClearance(q.x, q.z, rigSolids(F), F), `${what}: jet ${j} in the rig`).toBeGreaterThanOrEqual(C - 1e-9);
    expect(Math.abs(q.x) >= 38.4 || q.z <= -35, `${what}: jet ${j} stays off the stage frame`).toBe(true);
  }
  for (const [c, q] of r.cannons.entries()) if (q.live) expect(plumeClearance(q.src, q.dir, S), `${what}: cannon ${c}`).toBeGreaterThanOrEqual(C - 1e-9);
}

describe('arena props: the pyro keeps its distance', () => {
  it('the envelopes are the shaders\' widest: a flame flares as it climbs, a CO2 plume widens along its axis', () => {
    expect(flameR(0)).toBeCloseTo(2.6 * .55 * 1.2, 6);                     // (flameMat: bulge at the nozzle, big burn)
    expect(flameR(24)).toBeCloseTo(2.6 * 1.45 * 1.2, 6);                   // (its crown — and it lifts off at that width)
    expect(flameR(80)).toBeCloseTo(flameR(24), 9);
    // the plume envelope covers every (age, uv) sample of co2Mat on a finer grid than it was built on
    for (let a = .003; a < 1.55; a += .0071){
      const L = 18 * (1 - Math.exp(-a * 9)), lift = Math.max(0, a - .5), y0 = lift * 14, y1 = L + lift * 6;
      const t = Math.min(1, a / .4), k = 1 + .5 * t * t * (3 - 2 * t);
      for (let u = .01; u < 1; u += .043){
        const s = y0 + (y1 - y0) * u, r = (.5 + 3.4 * u + 2.2 * lift) * k, i = Math.round(s / CO2_ENV.DS);
        expect(Math.max(CO2_ENV.r[Math.floor(s / CO2_ENV.DS)], CO2_ENV.r[Math.ceil(s / CO2_ENV.DS)]), `a ${a.toFixed(3)} uv ${u.toFixed(2)} (bin ${i})`).toBeGreaterThanOrEqual(r - 1e-9);
      }
    }
  });
  it('an empty stage keeps the home rig (the show as it always stood)', () => {
    const r = planArenaProps([], null, { floor: F });
    expect(r.jets.map(q => [q.x, q.z])).toEqual(JET_HOME);
    expect(r.jets.every(q => q.live && !q.moved)).toBe(true);
    expect(r.cannons.every(q => q.live && q.k === 0)).toBe(true);
    expect(r.cannons.map(q => [q.src[0], q.src[2]])).toEqual(CO2_HOME);
    expect(r.amps.every(a => a.live)).toBe(true);
  });
  for (const R of FIX){
    it(`${R.song}: every flame and plume clears every machine + its footing + the rig`, () => {
      const A = anchorsOf(R), P = plan(A), r = planArenaProps(A, P, { floor: F });
      expect(r.jets.every(q => q.live), 'no projector struck').toBe(true);
      expect(r.cannons.every(q => q.live), 'no cannon struck').toBe(true);
      expectClear(r, A, P, R.song);
    });
  }
  it('a machine set on a projector\'s spot: the pair moves together, mirrored, to the nearest clear spot', () => {
    const A = [st('bells', 37, -2, 9, 6)], P = plan(A), r = planArenaProps(A, P, { floor: F });
    expect(r.jets[3].moved).toBe(true);
    expect(r.jets[2].x).toBe(-r.jets[3].x); expect(r.jets[2].z).toBe(r.jets[3].z);   // (still a mirrored pair)
    for (const j of [0, 1, 4, 5, 6, 7]) expect(r.jets[j].moved, `jet ${j} stays home`).toBe(false);
    expectClear(r, A, P, 'bells on the jet');
  });
  it('a lifted machine at the frame\'s edge: its tower and ladder count (the column flares to its top)', () => {
    const A = [st('marimba', 31.5, 20, 8, 6, 24, 6)], P = plan(A);
    expect(P.pads[0].band).toBe('high');
    const r = planArenaProps(A, P, { floor: F });
    expect(r.jets.every(q => q.live)).toBe(true);
    expectClear(r, A, P, 'a tower at the edge');
  });
  it('a tower in a plume\'s path: the cannon re-aims towards straight up until it clears', () => {
    const [x, z] = CO2_HOME[2], home = co2Dir(x, z, 0), y = F + RIG.CO2_Y + 1.2 + home[1] * 14;
    const A = [st('horns', x + home[0] * 14, z + home[2] * 14, 8, 4, y - F - 3, 4)], P = plan(A);
    expect(plumeClearance([x, F + RIG.CO2_Y, z], home, solidsOf(A, P))).toBeLessThan(C);   // (the home aim would blow through it)
    const r = planArenaProps(A, P, { floor: F });
    expect(r.cannons[2].live).toBe(true); expect(r.cannons[2].k).toBeGreaterThan(0);
    expectClear(r, A, P, 'plume re-aim');
  });
  it('nowhere clear (a share link fills the house): the projector is STRUCK — it never fires — never left in the fire', () => {
    const A = [st('wall', 0, -7.5, 112, 75, FOOT.PLINTH, 30)], P = { floor: F, pads: [], lofts: [], pulses: [] };
    const r = planArenaProps(A, P, { floor: F });
    expect(r.jets.filter(q => !q.live).length).toBeGreaterThan(0);
    expectClear(r, A, P, 'a full house');                                  // (whatever still fires is clear)
    expect(r.amps.some(a => !a.live)).toBe(false);                         // (the backline stands behind the wall's box)
  });
  it('the backline takes down any amp column something stands in', () => {
    const A = [st('bass', 32, AMP.Z, 3, 2)], r = planArenaProps(A, plan(A), { floor: F });
    const down = r.amps.filter(a => !a.live);
    expect(down.length).toBeGreaterThan(0);
    for (const a of down) expect(Math.abs(a.x - 32)).toBeLessThan(3.2);
  });
  it('is deterministic (the same anchors give the same rig)', () => {
    for (const R of FIX.slice(0, 6)){ const A = anchorsOf(R), P = plan(A); expect(planArenaProps(A, P, { floor: F })).toEqual(planArenaProps(A, P, { floor: F })); }
  });
});
