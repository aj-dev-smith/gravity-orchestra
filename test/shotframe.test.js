import { describe, it, expect } from 'vitest';
import { framed, fitPref, fitWide, screenSize, project, solveShotEye, boxPts, boxDist, FRAME_FIT, FIT_PULL, UI_BOTTOM } from '../src/shotsolve.js';
import { STAGE } from '../src/rooms/common.js';

/* FRAMING: a station shot frames its station ABOVE the UI's button row (the designer's angle,
   walked back along its own line until it does), and the room's wide is fitted into the window
   the UI leaves (shotsolve fitPref / fitWide). Pure — the same math main.js and the staging audit run. */
const EYE_ROOM = { x0: -STAGE.HW + 1.5, x1: STAGE.HW - 1.5, y0: STAGE.FLOOR + 1.5, y1: STAGE.CEIL - 1.5, z0: STAGE.BACK + 1.5, z1: STAGE.FRONT - 1.5 };
const sub = (a, b) => a.map((v, i) => v - b[i]);
const unit = a => { const l = Math.hypot(...a); return a.map(v => v / l); };
const cosAng = (a, b) => { const u = unit(a), v = unit(b); return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]; };

// the measured case that motivated it: the bells' gantry under the graveyard songs' close
// {x 4.5, up 7.2, dist 12.5} framing — 3 of its 8 corners in frame, in every room
const BELLS = { box: [19.6, 32.4, -22, 15.9, -15.9, -4.1], aim: [26, 8.4, -10], pref: [22.656, 15.6, 2.858] };

describe('station framing: the designer\'s angle at the distance that frames it', () => {
  const pts = boxPts(BELLS.box, BELLS.aim[1] - 4);
  it('the old close pref crops the bells\' gantry (the regression this guards)', () => {
    expect(framed(BELLS.pref, BELLS.aim, pts)).toBeLessThan(.5);
  });
  it('fitPref walks it back along its OWN line until the gantry sits above the button row (7 of 8 box corners)', () => {
    const e = fitPref(BELLS.aim, BELLS.pref, pts);
    expect(framed(e, BELLS.aim, pts, 55, 1.5, UI_BOTTOM)).toBeGreaterThanOrEqual(FRAME_FIT);
    expect(cosAng(sub(e, BELLS.aim), sub(BELLS.pref, BELLS.aim))).toBeCloseTo(1, 9);       // never swung
    const k = Math.hypot(...sub(e, BELLS.aim)) / Math.hypot(...sub(BELLS.pref, BELLS.aim));
    expect(k).toBeGreaterThan(1); expect(k).toBeLessThanOrEqual(FIT_PULL + 1e-9);
  });
  it('a pref that already frames its station is kept exactly', () => {
    const far = BELLS.aim.map((a, i) => a + (BELLS.pref[i] - a) * 1.6);
    expect(fitPref(BELLS.aim, far, pts)).toBe(far);
  });
  it('it stops at a wall (ok → false) and keeps the best frame short of it', () => {
    const e = fitPref(BELLS.aim, BELLS.pref, pts, { ok: p => p[2] < 4 });
    expect(e[2]).toBeLessThan(4);
    expect(framed(e, BELLS.aim, pts, 55, 1.5, UI_BOTTOM)).toBeGreaterThanOrEqual(framed(BELLS.pref, BELLS.aim, pts, 55, 1.5, UI_BOTTOM));
  });
  it('framed() honours the button row: a point just above the frame bottom is out once the UI takes it', () => {
    const eye = [0, 0, 10], aim = [0, 0, 0], tv = Math.tan(55 * Math.PI / 360);
    const low = [[0, -10 * tv * .9, 0]];                                  // 5 % of the height above the bottom edge
    expect(framed(eye, aim, low)).toBe(1);
    expect(framed(eye, aim, low, 55, 1.5, UI_BOTTOM)).toBe(0);
  });
  it('solveShotEye starts from the fitted pref: in open air the bells shot frames the gantry, on the designer\'s line', () => {
    const r = solveShotEye({ aim: BELLS.aim, pref: BELLS.pref, room: EYE_ROOM, blocked: () => false, others: [], subject: pts });
    expect(r.framed).toBeGreaterThanOrEqual(FRAME_FIT);
    expect(r.az).toBe(0); expect(r.lift).toBe(0);
    expect(cosAng(sub(r.eye, BELLS.aim), sub(BELLS.pref, BELLS.aim))).toBeCloseTo(1, 9);
    // …and fit:false keeps the old behaviour (the phone's own pull-back owns its distance)
    expect(solveShotEye({ aim: BELLS.aim, pref: BELLS.pref, room: EYE_ROOM, blocked: () => false, others: [], subject: pts, fit: false }).eye.map((v, i) => v - BELLS.pref[i]).every(d => Math.abs(d) < 1e-9)).toBe(true);
  });
  it('reports the walk-back (pk) so a phone\'s own pull-back divides it out instead of stacking on it', () => {
    const r = solveShotEye({ aim: BELLS.aim, pref: BELLS.pref, room: EYE_ROOM, blocked: () => false, others: [], subject: pts });
    const k = Math.hypot(...sub(fitPref(BELLS.aim, BELLS.pref, pts), BELLS.aim)) / Math.hypot(...sub(BELLS.pref, BELLS.aim));
    expect(r.pk).toBeGreaterThan(1); expect(r.pk).toBeCloseTo(k, 9);
    expect(solveShotEye({ aim: BELLS.aim, pref: BELLS.pref, room: EYE_ROOM, blocked: () => false, others: [], subject: pts, fit: false }).pk).toBe(1);
  });
  it('the pull-back never walks the eye into a neighbour\'s air', () => {
    const wallBehind = [15, 30, -22, 30, 5, 8];                         // a machine just behind the old eye
    const r = solveShotEye({ aim: BELLS.aim, pref: BELLS.pref, room: EYE_ROOM, blocked: () => false, others: [wallBehind], subject: pts });
    expect(boxDist(r.eye, wallBehind)).toBeGreaterThan(1.2);
  });
});

describe('the room\'s wide: fitted into the window the UI leaves', () => {
  // a hall: a belt wall, a raised gallery machine, a front-row kit
  const boxes = [[-8, 8, 3, 16, -4, 2.5], [-20, -8, 14, 19, -14, -8], [6, 16, 1, 5, 12, 22], [-26, -22, -3, 14, 9, 11]];
  const pts = boxes.flatMap(b => boxPts(b));
  const dir = unit([-.15, .26, .95]);
  it('every point lands inside the window: above the button row, under the title strip, within the sides', () => {
    for (const ui of [{}, { top: .03, bottom: UI_BOTTOM }, { top: .13 }]){
      const f = fitWide(pts, dir, { aspect: 1.6, fov: 68, fill: .94, ...ui });
      const lo = -1 + 2 * (ui.bottom || 0) - 1e-6, hi = 1 - 2 * (ui.top || 0) + 1e-6;
      let ylo = Infinity, yhi = -Infinity;
      for (const p of pts){ const [sx, sy] = project(f.eye, f.aim, p, 68, 1.6);
        expect(Math.abs(sx)).toBeLessThanOrEqual(1 + 1e-6); expect(sy).toBeGreaterThanOrEqual(lo); expect(sy).toBeLessThanOrEqual(hi);
        ylo = Math.min(ylo, sy); yhi = Math.max(yhi, sy); }
      // and it is TIGHT: the subject spans most of the window's height or width (no wasted backing-off)
      const xs = pts.map(p => project(f.eye, f.aim, p, 68, 1.6)[0]);
      const spanX = (Math.max(...xs) - Math.min(...xs)) / 2, spanY = (yhi - ylo) / (hi - lo);
      expect(Math.max(spanX, spanY)).toBeGreaterThan(.85);
      expect(cosAng(sub(f.eye, f.aim), dir)).toBeCloseTo(1, 9);            // looking down −dir
    }
  });
  it('the button row lifts the subject: its lowest point sits higher in frame than without it', () => {
    const a = fitWide(pts, dir, {}), b = fitWide(pts, dir, { bottom: UI_BOTTOM });
    const low = f => Math.min(...pts.map(p => project(f.eye, f.aim, p, 68, 1.6)[1]));
    expect(low(b)).toBeGreaterThan(low(a) + .1);
  });
  it('the room clamps the eye (k < 1) and the eye stays inside it with sway room', () => {
    const room = { x0: -36.5, x1: 36.5, y0: -20.5, y1: 34.5, z0: -32.5, z1: 30 };
    const f = fitWide(pts, dir, { room, bottom: UI_BOTTOM });
    expect(f.k).toBeLessThan(1);
    expect(f.eye[2]).toBeLessThanOrEqual(room.z1 + 1e-6);
  });
  it('screenSize: a nearer box reads bigger; a box off the frame reads no bigger for it', () => {
    const b = [-1, 1, -1, 1, -1, 1];
    expect(screenSize([0, 0, 10], [0, 0, 0], b)).toBeGreaterThan(screenSize([0, 0, 20], [0, 0, 0], b));
    expect(screenSize([0, 0, 1.5], [0, 0, 0], b)).toBeLessThanOrEqual(1);
    expect(screenSize([0, 0, -10], [0, 0, -20], b)).toBe(0);              // behind the eye
  });
});
