/* ============================================================
   MAGNET CRANE — the paternoster's CONSERVED marble (pure math, no
   THREE scene, unit-tested in test/crane.test.js).

   One marble per voice, forever. The LAST pad of the loop launches it
   STRAIGHT UP (a vertical solved arc) to an electromagnet waiting at
   exactly the apex: it arrives with v = 0 and docks. The crane carries
   it (eased traverse + winch) to hang over pad 0, holds, and releases
   so the free fall from HOLD lands on pad 0 exactly on the next loop's
   downbeat — the same landing contract as the old birth drop, solved
   backward from the beat: release = strike − √(2h/g).

   Heights are measured from the CONTACT level (the marble's centre at a
   strike, band + UP) in a track's local band frame; x/z are the pads'
   local x/z. craneAt() reports the magnet FACE (the point the marble's
   top touches), so ball centre = face − r.

   Time is the only state: everything here is a pure fn of songTime.
   ============================================================ */

export const CRANE = {
  HOLD_H:  6.54,   // hang height (ball centre) over pad 0 — above the deployed plates, under the housing lip
  PARK_H:  8.04,   // magnet FACE when parked inside the top housing (behind its window)
  PARK_Z: -1.05,   // the rail depth (inside the housing; long lobs fly in front, clear of it)
  DOCK:    .18,    // dwell after the clack before the carry starts
  MIN_HOLD: .2,    // least time it hangs still over pad 0 before a release
  V_NOM:   6,      // nominal carry speed (u/s)
  V_MAX:   25,     // fastest allowed carry (graceful degradation, never a teleport)
  MIN_RISE: .35,   // lowest catch (s of rise) the winch will go down to
};

const ease = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (u * (u * 6 - 15) + 10);   // smootherstep

/* Solve one voice's crane timeline. Times are in the ball's own clock (τ = songTime − k·P
   for the ball born at k·P); the crane repeats every P. */
export function planCrane({ g, P, rollT, tLast, last, first, r = .26, opt = {} }){
  const o = { ...CRANE, ...opt };
  const holdH = o.HOLD_H;
  const Tf = Math.sqrt(2 * holdH / g);                // release → landing on pad 0
  const rel = rollT - Tf;                             // release time (τ); pad 0 is struck at τ = rollT
  const s0 = rollT + tLast;                           // last strike
  const A = P - tLast - Tf;                           // budget: last strike → next ball's release
  const D = Math.hypot(first.x - last.x, first.z - last.z);
  let Tr = Math.sqrt(2 * holdH / g), Tx = Math.max(.9, D / o.V_NOM), d = o.DOCK, mh = o.MIN_HOLD;
  const need = () => Tr + d + Tx + mh;
  if (need() > A) Tx = Math.max(D / o.V_MAX, .35, A - Tr - d - mh);           // 1) carry faster
  if (need() > A) Tr = Math.max(o.MIN_RISE, A - d - Tx - mh);                  // 2) catch lower (winch down)
  if (need() > A){ const s = Math.max(.05, (A - Tr - Tx) / (d + mh)); d *= Math.min(1, s); mh *= Math.min(1, s); }
  const hc = .5 * g * Tr * Tr;                       // catch apex height (= holdH unless degraded)
  const C = s0 + Tr;                                 // dock time
  const carryEnd = C + d + Tx;

  // empty return trip after a release: up → retract into the housing → run back along the rail →
  // wait → extend → lower to the catch point (arrives .12 s early: the ball rises into a still magnet)
  const K1 = rel + .3;
  let tUp = .45, tIn = .4, tBack = Math.max(.6, Math.abs(first.x - last.x) / 5), tOut = .4, tDown = .45;
  const K5 = C - .12;
  const room = K5 - K1, want = tUp + tIn + tBack + tOut + tDown;
  if (want > room){ const s = Math.max(0, room) / want; tUp *= s; tIn *= s; tBack *= s; tOut *= s; tDown *= s; }
  const fx = first.x, fz = first.z, lx = last.x, lz = last.z;
  const HOLD  = { x: fx, y: holdH + r, z: fz };
  const CATCH = { x: lx, y: hc + r,   z: lz };
  const key = [
    [rel, HOLD], [K1, HOLD],
    [K1 + tUp, { x: fx, y: o.PARK_H, z: fz }],
    [K1 + tUp + tIn, { x: fx, y: o.PARK_H, z: o.PARK_Z }],
    [K1 + tUp + tIn + tBack, { x: lx, y: o.PARK_H, z: o.PARK_Z }],
    [K5 - tDown - tOut, { x: lx, y: o.PARK_H, z: o.PARK_Z }],
    [K5 - tDown, { x: lx, y: o.PARK_H, z: lz }],
    [K5, CATCH], [C + d, CATCH], [carryEnd, HOLD], [P + rel, HOLD],
  ];
  return { g, P, rollT, r, holdH, hc, Tf, Tr, Tx, dock: d, minHold: mh, rel, s0, C, carryEnd, A, D,
           fits: Tr + d + Tx + mh <= A + 1e-9, key, HOLD, CATCH, last, first };
}

/* The magnet at songTime t: face position + coil state. Before the first release it
   hangs ARMED over pad 0 (the count-in). */
export function craneAt(pl, t){
  if (t < pl.rel) return { ...pl.HOLD, coil: 1, sinceDock: 9, sinceRelease: -1, phase: 'armed' };
  const k = Math.floor((t - pl.rel) / pl.P);
  const u = t - k * pl.P;                            // ∈ [rel, rel + P)
  const K = pl.key;
  let i = 0;
  while (i < K.length - 2 && u >= K[i + 1][0]) i++;
  const [t0, a] = K[i], [t1, b] = K[i + 1];
  const e = t1 > t0 ? ease((u - t0) / (t1 - t0)) : 1;
  const pos = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, z: a.z + (b.z - a.z) * e };
  const sinceDock = u - pl.C, sinceRelease = u - pl.rel;
  const loaded = u >= pl.C;                          // docked through the next release
  const coil = loaded ? 1 : Math.max(0, 1 - (pl.C - u) / .12);   // energises as the ball arrives
  const phase = loaded ? (u < pl.C + pl.dock ? 'dock' : u < pl.carryEnd ? 'carry' : 'hold')
                       : (u < pl.C - .12 ? 'return' : 'wait');
  return { ...pos, coil, sinceDock, sinceRelease, phase };
}

/* The marble (ball CENTRE, band frame, heights from contact) in its crane phases, for the
   ball born at k·P at its own clock τ. null while it is on the belt (between the first
   landing and the last strike — the arcs own it there).
     τ < rel            → hanging armed on the magnet over pad 0
     rel ≤ τ < rollT     → free fall onto pad 0 (lands at τ = rollT, on the beat)
     s0 ≤ τ < C          → the vertical launch from the last pad up to the magnet (v → 0)
     C ≤ τ               → docked: rides the magnet (carry, hold) until the next ball's release */
export function craneBall(pl, tau, birthT){
  if (tau < pl.rel) return { x: pl.HOLD.x, y: pl.holdH, z: pl.HOLD.z, vy: 0, mode: 'hang' };
  if (tau < pl.rollT){
    const s = tau - pl.rel;
    return { x: pl.HOLD.x, y: pl.holdH - .5 * pl.g * s * s, z: pl.HOLD.z, vy: -pl.g * s, mode: 'fall' };
  }
  if (tau < pl.s0) return null;
  if (tau < pl.C){
    const u = tau - pl.s0, v0 = pl.g * pl.Tr;
    return { x: pl.last.x, y: v0 * u - .5 * pl.g * u * u, z: pl.last.z, vy: v0 - pl.g * u, mode: 'rise' };
  }
  const m = craneAt(pl, birthT + tau);
  return { x: m.x, y: m.y - pl.r, z: m.z, vy: 0, mode: 'docked' };
}
