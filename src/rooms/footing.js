/* ============================================================
   FOOTING — what a machine stands on. PURE (no THREE, no DOM).

   Machines are SET IN THE ROOM: main builds every floor (non-hung) station with floorY 0, so no
   plugin grows legs, risers or pedestals any more — its supports are the ROOM's business. Each
   machine sits on a room-styled PLINTH on the floor by default (its GROUND height), and the user
   may raise it, Rollercoaster-Tycoon style, by a LIFT:

       ground = floor + FOOT.PLINTH − low        low  = the lowest local y any SOLID part of the
       deck   = ground + lift  (lift ≥ 0)               machine reaches over the loop (main measures it)

   A machine whose lowest parts are NOT what it would stand on (the turntable's resonator tubes hang
   under its plinth) declares a descriptor staging hint `stand: <local y>` — the underside it rests on.
   Its ground is still set by `low` (the hanging parts clear the floor by the plinth), and its footing
   reaches up to deck + stand, OPEN, so what hangs stays visible.

   The supports change with height (h = support height above the floor), styled by each room:
     flush  h ≤ BANDS.flush   a plinth / base slab (every grounded machine)
     low    h ≤ BANDS.low     a riser / dais with steps
     mid    h ≤ BANDS.mid     a platform on legs / columns, braced, with a stair or ladder
     high   above             a scaffold / truss tower: bracing, a caged ladder, landings, rails
   Neighbours at about the same height (|Δtop| ≤ LOFT_DY, footprints within LOFT_GAP) above the
   flush band share ONE loft — the rear gallery becomes architecture, not N towers.
   1 u ≈ 0.677 m (xrplan U_PER_M).
   ============================================================ */

export const FOOT = {
  PLINTH: .4,                                   // the base every grounded machine stands on (≈ 27 cm)
  STEP: .35,                                    // a dais / stair step's rise (≈ 24 cm)
  BANDS: { flush: .8, low: 3.5, mid: 10 },      // support height above the floor → band (above mid: high)
  LOFT_DY: .6,                                  // neighbours whose decks are within this…
  LOFT_GAP: 3,                                  // …and whose footprints are within this share one loft
  LIFT_MAX: 24,                                 // the highest a user may raise a machine (≈ 16 m; the gallery is ≈ 19)
};

/** the support band for a support height h above the floor */
export const bandOf = h => h <= FOOT.BANDS.flush ? 'flush' : h <= FOOT.BANDS.low ? 'low' : h <= FOOT.BANDS.mid ? 'mid' : 'high';

/** the deck y at which a machine whose lowest solid part is `low` (its local y) sits on the floor's plinth */
export const groundOf = (low, floor) => floor + FOOT.PLINTH - low;

/** a user's lift, made safe: finite, 0 … LIFT_MAX (anything else is 0 — on the floor) */
export const clampLift = u => Number.isFinite(u) ? Math.max(0, Math.min(FOOT.LIFT_MAX, u)) : 0;
