/* ============================================================
   THE MAGNET CRANE — the carriages' limits + motion primitives (pure math,
   no THREE scene; test/crane.test.js). The belt's carriages (src/juggle.js:
   one magnet CARRIAGE per ball, on a rail over its hand) are planned from
   these, and the juggler's audit holds every plan to them.

   The belt's grammar is apex ∝ dt²: a flight of F seconds between two
   strikes on the strike line peaks at |G|·F²/8 — the rhythm made visible.
   H_FREE caps it: no free flight climbs past H_FREE (5.25 → dtFree ≈ 1.70 s),
   so every flight stays in the open run under the top housing (band + PT.LIP
   7.0). A longer gap is the crane's: the ball is thrown straight up to its
   carriage's magnet (it docks at v = 0 — the clack), rides the rail, and is
   released so its free fall lands on the beat. The dwells (DOCK / MIN_HOLD /
   POST / LEAD) keep a carriage still around every catch and release.

   Every carriage move is a quintic Hermite (segEval: exactly smootherstep
   when it starts and ends at rest) whose peak speed and acceleration stay
   under V_MAX / A_MAX (minMoveT) — never a teleport. Time is the only state.

   (History: this module was the classic belt's crane PLANNER — one crane per
   voice: apex kisses, crane hops, early stows. It retired with the classic
   belt on 2026-10-24; git history has it.)
   ============================================================ */

export const CRANE = {
  H_FREE:   5.25,  // highest free-flight apex (ball centre over contact → dtFree)
  DOCK:     .18,   // a carriage dwells this long after a catch (the clack) before it moves …
  MIN_HOLD: .2,    // … hangs still this long before a release …
  POST:     .3,    // … stays put this long after a release (recoil + discharge) …
  LEAD:     .12,   // … and is in place this long before a ball rises into it
  V_MAX:    25,    // carriage speed limit (peak, u/s)
  A_MAX:    90,    // carriage acceleration limit (peak, u/s²)
};

/* The longest gap flown as a free flight (its apex is exactly H_FREE). */
export const dtFree = (g, o = CRANE) => Math.sqrt(8 * o.H_FREE / g);

export const EV = 1.875, EA = 5.7735;                  // smootherstep peak |v|·T/D and peak |a|·T²/D
const Z3 = { x: 0, y: 0, z: 0 };
/* least time a smootherstep move of length D may take under the carriage limits */
export const minMoveT = (D, o = CRANE) => D < 1e-9 ? 0 : Math.max(EV * D / o.V_MAX, Math.sqrt(EA * D / o.A_MAX));

/* One carriage move between keys [t, p, v?] (v = velocity, default at rest): the quintic
   Hermite with zero end accelerations — exactly smootherstep when both ends are at rest,
   exactly linear when it is a constant-velocity glide. */
export function segEval(k0, k1, t){
  const [t0, a, va = Z3] = k0, [t1, b, vb = Z3] = k1, T = t1 - t0;
  if (!(T > 0)) return { x: b.x, y: b.y, z: b.z, vx: vb.x, vy: vb.y, vz: vb.z };
  const u = Math.min(1, Math.max(0, (t - t0) / T)), u2 = u * u, u3 = u2 * u, u4 = u3 * u, u5 = u4 * u;
  const S = 10 * u3 - 15 * u4 + 6 * u5, dS = (30 * u2 - 60 * u3 + 30 * u4) / T;
  const h0 = T * (u - 6 * u3 + 8 * u4 - 3 * u5), d0 = 1 - 18 * u2 + 32 * u3 - 15 * u4;
  const h1 = T * (-4 * u3 + 7 * u4 - 3 * u5), d1 = -12 * u2 + 28 * u3 - 15 * u4;
  return {
    x: a.x + (b.x - a.x) * S + va.x * h0 + vb.x * h1, vx: (b.x - a.x) * dS + va.x * d0 + vb.x * d1,
    y: a.y + (b.y - a.y) * S + va.y * h0 + vb.y * h1, vy: (b.y - a.y) * dS + va.y * d0 + vb.y * d1,
    z: a.z + (b.z - a.z) * S + va.z * h0 + vb.z * h1, vz: (b.z - a.z) * dS + va.z * d0 + vb.z * d1,
  };
}
