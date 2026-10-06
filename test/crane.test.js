import { describe, it, expect } from 'vitest';
import { SONGS } from '../src/songs/index.js';
import { padRadius, layoutPads, G, ROLL_T } from '../src/engine.js';
import { planCrane, craneAt, craneBall, CRANE } from '../src/crane.js';

/* ---------------------------------------------------------------------------
   MAGNET CRANE (paternoster) — the conserved marble's timeline must be honest:
   it reaches the magnet at the apex with zero velocity, the release free-falls
   onto pad 0 exactly on the downbeat, the whole recirculation fits the gap
   from the last strike to the next release for EVERY song, and the hand-off
   between loop balls is seamless (no teleport). Mirrors main.js buildWorld.
   --------------------------------------------------------------------------- */
const g = -G.y;
const RADIUS = { lead: .26, alto: .21, bass: .36 };
const norm = p => Array.isArray(p) ? { notes: p, delay: 0 } : { notes: p.notes, delay: p.delay || 0 };

function plansFor(song){
  const beat = 60 / song.bpm;
  const parts = [{ role: 'lead', notes: song.melody, delay: 0 }];
  if (song.alto) parts.push({ role: 'alto', ...norm(song.alto) });
  if (song.bass) parts.push({ role: 'bass', ...norm(song.bass) });
  const built = parts.map(t => {
    const pads = layoutPads(t.notes, { zBase: 0, isBass: t.role === 'bass', delayBeats: t.delay, beat,
                                        radOf: padRadius(t.notes, t.role) });
    return { ...t, pads, total: pads.reduce((s, p) => s + p.dt, 0), rollT: ROLL_T + t.delay * beat };
  });
  const P = ROLL_T + built[0].total + 1.2;
  return built.map(t => {
    const L = t.pads[t.pads.length - 1], F = t.pads[0];
    return { role: t.role, P, pl: planCrane({ g, P, rollT: t.rollT, tLast: L.t, r: RADIUS[t.role],
      last: { x: L.pos.x, z: L.pos.z }, first: { x: F.pos.x, z: F.pos.z } }) };
  });
}
const close = (a, b, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('magnet crane', () => {
  for (const [key, song] of Object.entries(SONGS)){
    for (const { role, P, pl } of plansFor(song)){
      it(`${key}/${role}: fits, docks at v=0, lands on the beat, hands off seamlessly`, () => {
        expect(pl.fits).toBe(true);
        expect(pl.Tx).toBeGreaterThanOrEqual(pl.D / CRANE.V_MAX - 1e-9);       // never a teleport
        expect(pl.hc).toBeLessThanOrEqual(CRANE.HOLD_H + 1e-9);

        // keyframes are time-ordered
        for (let i = 1; i < pl.key.length; i++) expect(pl.key[i][0]).toBeGreaterThanOrEqual(pl.key[i - 1][0] - 1e-9);

        // the vertical launch reaches the magnet at its apex with zero velocity
        const atDock = craneBall(pl, pl.C - 1e-9, 0);
        close(atDock.vy, 0, 1e-6); close(atDock.y, pl.hc, 1e-6);
        const m = craneAt(pl, pl.C);
        close(m.y - pl.r, pl.hc); close(m.x, pl.last.x); close(m.z, pl.last.z);
        // …and leaves the last pad from the contact level
        close(craneBall(pl, pl.s0, 0).y, 0);

        // the release free-falls onto pad 0 exactly at its strike (τ = rollT)
        const land = craneBall(pl, pl.rollT - 1e-9, 0);
        close(land.y, 0, 1e-5);
        close(pl.rel + Math.sqrt(2 * pl.holdH / g), pl.rollT);

        // seamless hand-off: the old ball at the next release IS the new ball hanging
        const k = 3, tHand = (k + 1) * P + pl.rel;
        const oldB = craneBall(pl, tHand - k * P - 1e-9, k * P);
        const newB = craneBall(pl, tHand - (k + 1) * P - 1e-9, (k + 1) * P);
        close(oldB.x, newB.x, 1e-6); close(oldB.y, newB.y, 1e-5); close(oldB.z, newB.z, 1e-6);

        // the crane is continuous across its own loop seam
        const a = craneAt(pl, P + pl.rel - 1e-7), b = craneAt(pl, P + pl.rel + 1e-7);
        close(a.x, b.x, 1e-4); close(a.y, b.y, 1e-4); close(a.z, b.z, 1e-4);
      });
    }
  }
});
