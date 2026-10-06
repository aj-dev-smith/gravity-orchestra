import { describe, it, expect } from 'vitest';
import { SONGS } from '../src/songs/index.js';
import { padRadius, layoutPads, G, ROLL_T, DESCENT, solveLaunch, arcPos, beltPhase, deployPose } from '../src/engine.js';
import { planCrane, plateField, craneAt, craneBall, marbleAt, segAt, dtFree, hopLayout, minMoveT, CRANE, EV, EA } from '../src/crane.js';
import { PT, BAR } from '../src/paternoster.js';

/* ---------------------------------------------------------------------------
   MAGNET CRANE — CRANE HOPS. Every gap longer than dtFree is a hop: straight up
   to the magnet (docks at v = 0), carried, released so the free fall lands on the
   next pad exactly on its beat. The seam (last pad → next loop's pad 0) is the
   loop's last hop. These tests are the honesty contract: docking at v=0, landing
   on the beat at the contact point, no free arc above the open run, carriage
   speed/accel limits (never a teleport), the crane free for every consecutive
   hop, no magnet ever pushing through its marble, the magnet never in the
   housing steel, continuity everywhere (seam + count-in). Mirrors main.js
   buildWorld/planTrackCrane.
   --------------------------------------------------------------------------- */
const g = -G.y;
const RADIUS = { lead: .26, alto: .21, bass: .36 };
const LEAD_IN = 2.4;
const norm = p => Array.isArray(p) ? { notes: p, delay: 0 } : { notes: p.notes, delay: p.delay || 0 };

function plansFor(song){
  const beat = 60 / song.bpm;
  const parts = [{ role: 'lead', notes: song.melody, delay: 0 }];
  if (song.alto) parts.push({ role: 'alto', ...norm(song.alto) });
  if (song.bass) parts.push({ role: 'bass', ...norm(song.bass) });
  const built = parts.map(t => {
    const radOf = padRadius(t.notes, t.role);
    const pads = layoutPads(t.notes, { zBase: 0, isBass: t.role === 'bass', delayBeats: t.delay, beat, radOf, ...hopLayout(g) });
    return { ...t, radOf, pads, total: pads.reduce((s, p) => s + p.dt, 0), rollT: ROLL_T + t.delay * beat };
  });
  const P = ROLL_T + built[0].total + 1.2;
  return built.map(t => {
    const padT = t.pads.map(p => t.rollT + p.t);
    const clear = plateField({ padT, P, plate: BAR, stowZ: PT.STOW_Z, inner: PT.INNER, cull: PT.CULL,
      plates: t.pads.map(p => ({ x: p.pos.x, z: p.pos.z, s: t.radOf(p.note) / .58 })) });
    return { role: t.role, P, pads: t.pads, radOf: t.radOf, pl: planCrane({ g, P, rollT: t.rollT, r: RADIUS[t.role], clear,
      pads: t.pads.map(p => ({ t: p.t, dt: p.dt, x: p.pos.x, z: p.pos.z })) }) };
  });
}
const close = (a, b, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

/* synthetic stress tracks: long holds, back-to-back hops, squeezed hops, a giant gap */
const STRESS = {
  'back-to-back': { bpm: 90, scale: ['C'], melody: [['C4', 4], ['E4', 3], ['G4', 6], ['C5', .5], ['E4', 8], ['D4', 1], ['C4', 2]] },
  'squeezed': { bpm: 120, scale: ['C'], melody: [['C4', 3.5], ['G4', 3.5], ['E4', 3.6], ['C5', .25], ['G4', 3.5], ['C4', 3.5]] },
  'giant-gap': { bpm: 100, scale: ['C'], melody: [['C4', 1], ['E4', 300], ['G4', .5], ['C5', 1]],
                 bass: { delay: 2, notes: [['C3', 160], ['G2', 140.5]] } },
  'one-note': { bpm: 80, scale: ['C'], melody: [['C4', 8]] },
  'skim-then-lob': { bpm: 140, scale: ['C'], melody: [['C5', .25], ['D5', .25], ['E5', .25], ['F5', .25], ['G5', 6], ['C4', .5], ['E4', 7], ['G4', 2]] },
};

/* First clash between a plate of this voice and the marble while the crane owns it, or null.
   Plate = box (half-extents BAR·scale), at its belt height (beltPhase), telescoped by
   deployPose from stowed (flat on the belt, z = STOW_Z) to deployed (level, at its rest z) —
   the tilt to its catch normal is ignored, so the box is a fair stand-in. Contact level frame. */
export function plateClash(pl, pads, radOf, P, step = 1 / 120){
  const innerC = PT.INNER / DESCENT, cullC = Math.min(PT.CULL, DESCENT * P * .5 - .5) / DESCENT;
  const end = Math.min(P + pl.rel0, 150);
  for (let t = -LEAD_IN; t < end; t += step){
    const b = craneBall(pl, t, 0);
    if (!b) continue;
    for (let k = 0; k < pads.length; k++){
      const c = beltPhase(t, pl.padT[k], P);
      if (Math.abs(c) > cullC) continue;
      if (Math.abs(c) < CRANE.STRIKE_C) continue;                     // its own strike: contact, by design
      const s = radOf(pads[k].note) / .58, dep = deployPose(c, innerC, cullC);
      const hx = BAR.L / 2 * s, hy = (BAR.T / 2 + (BAR.W - BAR.T) / 2 * (1 - dep.tilt)) * s,
            hz = (BAR.W / 2 + (BAR.T - BAR.W) / 2 * (1 - dep.tilt)) * s;
      const px = pads[k].pos.x, py = DESCENT * c - .38, pz = PT.STOW_Z + (pads[k].pos.z - PT.STOW_Z) * dep.extend;
      const dx = Math.max(0, Math.abs(b.x - px) - hx), dy = Math.max(0, Math.abs(b.y - py) - hy), dz = Math.max(0, Math.abs(b.z - pz) - hz);
      if (Math.hypot(dx, dy, dz) < pl.r - .02) return { t: +t.toFixed(3), pad: k, mode: b.mode, hop: b.hop, c: +c.toFixed(2) };
    }
  }
  return null;
}

function honesty(key, role, P, pl, pads, radOf){
  it(`${key}/${role}: crane hops are honest`, () => {
    expect(pl.warnings).toEqual([]);
    expect(CRANE.LIP_C).toBeCloseTo(PT.LIP - .26, 9);
    const dtF = dtFree(g);
    // every free arc fits the open run; every longer gap (and the seam) is a hop
    pads.forEach((p, i) => {
      if (i === pads.length - 1){ expect(pl.hopAt[i]).toBeGreaterThanOrEqual(0); return; }
      if (p.dt > dtF + 1e-9) expect(pl.hopAt[i]).toBeGreaterThanOrEqual(0);
      else expect(pl.hopAt[i]).toBe(-1);
      if (pl.hopAt[i] < 0) expect(g * p.dt * p.dt / 8).toBeLessThanOrEqual(CRANE.H_FREE + 1e-9);
    });

    // keyframes are time-ordered; every move under the carriage limits (never a teleport)
    for (let i = 1; i < pl.key.length; i++){
      const [t0, a] = pl.key[i - 1], [t1, b] = pl.key[i];
      expect(t1).toBeGreaterThanOrEqual(t0 - 1e-9);
      const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (d < 1e-9) continue;
      const T = t1 - t0;
      expect(T).toBeGreaterThan(0);
      expect(EV * d / T).toBeLessThanOrEqual(CRANE.V_MAX + 1e-6);
      expect(EA * d / (T * T)).toBeLessThanOrEqual(CRANE.A_MAX + 1e-6);
    }
    expect(pl.key[pl.key.length - 1][0]).toBeCloseTo(pl.rel0 + P, 9);   // the period closes exactly

    for (const h of pl.hops){
      expect(h.H).toBeLessThanOrEqual(CRANE.HOLD_H + 1e-9);
      expect(h.H).toBeGreaterThanOrEqual(CRANE.H_MIN - 1e-9);
      // the vertical launch leaves the pad from the contact point and reaches the magnet at its apex, v = 0
      const b0 = craneBall(pl, h.s + 1e-9, 0);
      close(b0.y, 0, 1e-6); close(b0.x, pads[h.i].pos.x); close(b0.z, pads[h.i].pos.z);
      const atDock = craneBall(pl, h.C - 1e-9, 0);
      close(atDock.vy, 0, 1e-6); close(atDock.y, h.hc, 1e-6);
      // the magnet is there, still, waiting (arrived early)
      for (const t of [h.C - CRANE.LEAD_MIN, h.C]){
        const m = craneAt(pl, t);
        close(m.x, h.CATCH.x); close(m.y, h.CATCH.y); close(m.z, h.CATCH.z);
        close(m.vx, 0, 1e-6); close(m.vy, 0, 1e-6); close(m.vz, 0, 1e-6);
      }
      // docked: the marble rides the magnet face exactly
      for (let k = 0; k <= 8; k++){
        const t = h.C + (Math.min(h.rel, h.C + 30) - h.C) * k / 8.0001;
        const b = craneBall(pl, t, 0), m = craneAt(pl, t);
        expect(b.mode).toBe('docked');
        close(b.y, m.y - pl.r); close(b.x, m.x); close(b.z, m.z);
      }
      if (h.seam) continue;
      // release → free fall from rest lands on the next pad's contact point exactly on its beat
      close(h.rel + Math.sqrt(2 * h.hr / g), h.land, 1e-9);
      close(pl.padT[h.j], h.land, 1e-9);
      const m = craneAt(pl, h.rel);
      close(m.vx, 0, 1e-6); close(m.vy, 0, 1e-6); close(m.vz, 0, 1e-6);   // released from a still magnet
      const land = craneBall(pl, h.land - 1e-9, 0);
      close(land.y, 0, 1e-5); close(land.x, pads[h.j].pos.x); close(land.z, pads[h.j].pos.z);
    }

    // seamless hand-off: the old ball at the next release IS the new ball hanging
    const k = 3, tHand = (k + 1) * P + pl.rel0;
    const oldB = craneBall(pl, tHand - k * P - 1e-9, k * P);
    const newB = craneBall(pl, tHand - (k + 1) * P - 1e-9, (k + 1) * P);
    close(oldB.x, newB.x, 1e-6); close(oldB.y, newB.y, 1e-5); close(oldB.z, newB.z, 1e-6);
    // the crane is continuous across its own loop seam and out of the count-in
    for (const t of [P + pl.rel0, pl.rel0]){
      const a = craneAt(pl, t - 1e-7), b = craneAt(pl, t + 1e-7);
      close(a.x, b.x, 1e-4); close(a.y, b.y, 1e-4); close(a.z, b.z, 1e-4);
    }

    // sweep the loop (count-in → retirement) — continuity, no penetration, housing clear
    const span = Math.min(P + pl.rel0, 150), step = 1 / 240;
    const mr = Math.max(.24, pl.r * 1.15), LIPC = PT.LIP - .26;     // the lip, above the contact level
    const SKIRT_TOP = 8.2 - .26;
    let prev = marbleAt(pl, -LEAD_IN, 0), prevM = craneAt(pl, -LEAD_IN);
    for (let t = -LEAD_IN + step; t < span; t += step){
      const b = marbleAt(pl, t, 0), m = craneAt(pl, t);
      const jump = Math.hypot(b.x - prev.x, b.y - prev.y, b.z - prev.z);
      expect(jump).toBeLessThan(Math.hypot(prev.vx, prev.vy, prev.vz) * step * 1.5 + .02);
      expect(Math.hypot(m.x - prevM.x, m.y - prevM.y, m.z - prevM.z)).toBeLessThan(CRANE.V_MAX * step * 1.01 + 1e-6);
      // the marble stays in the open run — except riding the magnet's LANE, above the lip in front of the housing
      if (process.env.DBG && b.y + pl.r > LIPC + 1e-9 && !((b.mode === 'docked' || b.mode === 'hang') && b.z - pl.r > -.6)) console.log('LANE', key, role, t.toFixed(3), JSON.stringify(b));
      if (process.env.DBG && b.mode !== 'docked' && b.mode !== 'hang' && Math.hypot(b.x - m.x, b.z - m.z) < mr + pl.r && b.y + pl.r > m.y + 1e-6) console.log('PUSH', key, role, t.toFixed(3), JSON.stringify(b), JSON.stringify(m), JSON.stringify({...pl.hops[b.hop], keys: undefined}), JSON.stringify(pl.key.filter(k => Math.abs(k[0] - t) < 1.5)));
      if (b.y + pl.r > LIPC + 1e-9) expect(b.mode === 'docked' || b.mode === 'hang' ? b.z - pl.r > -.6 : false).toBe(true);
      if (b.mode !== 'docked' && b.mode !== 'hang' && Math.hypot(b.x - m.x, b.z - m.z) < mr + pl.r)
        expect(b.y + pl.r).toBeLessThanOrEqual(m.y + 1e-6);           // the magnet never pushes into its marble
      if (m.z - mr < -.6)                                             // behind the skirt face: under it or above it
        expect(m.y + CRANE.MAG_H <= LIPC + 1e-6 || m.y >= SKIRT_TOP - 1e-6).toBe(true);
      prev = b; prevM = m;
    }

    // no tone-plate on the belt ever passes through the marble while the CRANE owns it
    // (rising, docked, falling): every plate of the voice, deploy pose included
    const hit = plateClash(pl, pads, radOf, P);
    expect(hit).toBe(null);
  });
}

describe('magnet crane — hops', () => {
  for (const [key, song] of Object.entries({ ...SONGS, ...STRESS }))
    for (const { role, P, pl, pads, radOf } of plansFor(song)) honesty(key, role, P, pl, pads, radOf);

  it('free arcs are the engine\'s solved arcs (band frame = falling frame + render lift)', () => {
    const [{ pl, pads }] = plansFor(SONGS['fur-elise']);
    pads.forEach((p, i) => {
      if (pl.hopAt[i] >= 0) return;
      const v0 = solveLaunch(p.pos, pads[i + 1].pos, p.dt);
      for (const f of [.13, .5, .91]){
        const u = p.dt * f, tau = pl.padT[i] + u;
        const fall = arcPos(p.pos, v0, u);
        const band = marbleAt(pl, tau, 0);
        close(fall.y + DESCENT * tau - (p.pos.y + DESCENT * pl.padT[i]), band.y, 1e-9);
        close(fall.x, band.x, 1e-9); close(fall.z, band.z, 1e-9);
      }
    });
  });

  it('hops stop the layout growing with dt; free-arc songs lay out exactly as before', () => {
    const beat = .5, notes = [['C4', 1], ['E4', 40], ['G4', 1], ['C5', 90], ['E4', 1]];
    const radOf = padRadius(notes, 'lead');
    const a = layoutPads(notes, { zBase: 0, isBass: false, beat, radOf, ...hopLayout(g) });
    const xs = a.map(p => p.pos.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(4 * (0.9 + 2 * dtFree(g)) + 1e-6);
    const free = [['C4', 1], ['E4', 2], ['G4', 1]];
    const r2 = padRadius(free, 'lead');
    expect(layoutPads(free, { zBase: 0, isBass: false, beat, radOf: r2, ...hopLayout(g) }).map(p => p.pos.x))
      .toEqual(layoutPads(free, { zBase: 0, isBass: false, beat, radOf: r2 }).map(p => p.pos.x));
  });

  it('the early fold-back (X_MAX) leaves every hand-authored song exactly as laid out before', () => {
    for (const song of Object.values(SONGS)){
      const beat = 60 / song.bpm, notes = song.melody, radOf = padRadius(notes, 'lead');
      const a = layoutPads(notes, { zBase: 0, isBass: false, beat, radOf, hopOver: dtFree(g) });
      const b = layoutPads(notes, { zBase: 0, isBass: false, beat, radOf, ...hopLayout(g) });
      expect(b.map(p => p.pos.x)).toEqual(a.map(p => p.pos.x));
    }
  });

  it('back-to-back hops on one pad are a yo-yo: the magnet waits right there', () => {
    const [{ pl }] = plansFor(STRESS['back-to-back']);
    const yo = pl.hops.findIndex((h, k) => k > 0 && pl.hops[k - 1].j === h.i && !pl.hops[k - 1].seam);
    expect(yo).toBeGreaterThan(0);
    const a = pl.hops[yo - 1], b = pl.hops[yo];
    for (let t = a.rel; t <= b.C; t += .01){
      const m = craneAt(pl, t);
      close(m.x, a.HOLD.x, 1e-9); close(m.z, a.HOLD.z, 1e-9);
    }
  });

  it('lookups are binary searches (segAt agrees with a linear scan)', () => {
    const [{ pl }] = plansFor(SONGS['canon-in-d']);
    for (let t = pl.rollT; t < pl.padT[pl.n - 1] + 1; t += .037){
      let i = 0; while (i + 1 < pl.n && pl.padT[i + 1] <= t) i++;
      expect(segAt(pl, t)).toBe(i);
    }
    expect(minMoveT(0)).toBe(0);
  });
});
