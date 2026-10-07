/* ============================================================
   dynamics.js — ONE velocity law for every live voice that takes a 0..1 velocity
   (the drum machine's hitDrum, the belt's pluck). Pure: no audio, no DOM — tested in
   test/dynamics.test.js.

   The old drum law was a straight line with a FLOOR, amp ∝ .35 + .65·v: from v = 1 down
   to v = 0 it only spans ~9 dB, so a "pp" kick at v = .15 still sounded at −7.6 dB — the
   Mars review measured its pp opening's kick at −4 dBFS peak under −22 dB strings.

   velGain keeps that line EXACTLY from v = KNEE up (every existing groove's normal range,
   .5–1, is bit-identical in level), and below the knee bends it down in dB by a quadratic
   (the slope is continuous at the knee — no audible step in a crescendo):

       v ≥ KNEE:  g = .35 + .65·v
       v < KNEE:  g = (.35 + .65·v) · 10^(−DROP·((KNEE − v)/KNEE)² / 20)

   so .4 ≈ −0.7 dB extra, .3 −2.9, .2 −6.5, .1 −11.5, 0 −18 (−27 dB under full in all).
   A dynamics vocabulary that now means something: pp ≈ .12, p ≈ .3, mf ≈ .55, f ≈ .8, ff 1.

   The iOS <audio> sample path ignores velocity entirely (el.volume is ignored — CLAUDE.md §5):
   every sample plays full there, as it always has. Dynamics live on the webaudio path only.
   ============================================================ */

export const DYN = { FLOOR: .35, KNEE: .5, DROP: 18 };

const clamp01 = v => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 1));

/** velocity 0..1 → linear amplitude (1 at v = 1). Non-finite → full. */
export function velGain(v){
  v = clamp01(v);
  const lin = DYN.FLOOR + (1 - DYN.FLOOR) * v;
  if (v >= DYN.KNEE) return lin;
  const x = (DYN.KNEE - v) / DYN.KNEE;
  return lin * Math.pow(10, -DYN.DROP * x * x / 20);
}

/** a belt entry's velocity: ['G4', 1, .6] → .6; no 3rd element → 1 (full). Clamped 0..1. */
export const beltVel = entry => (Array.isArray(entry) && entry.length > 2 && entry[2] != null) ? clamp01(+entry[2]) : 1;

/** is this a legal belt velocity (absent, or a finite number in 0..1)? — the validators' rule */
export const okBeltVel = v => v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1);

/** the strike's VISUAL weight for a velocity (flash, sparks, shake): never invisible —
    a pp note still lights its pad, just less (.3 at v = 0, 1 at v = 1). */
export const velLook = v => .3 + .7 * clamp01(v);

/** the velocity that sounds under velGain at the level `v` sounded under the OLD floored drum law
    (.35 + .65·v) — identity from the knee up. For songs mixed before velGain bent the bottom
    (the Entertainer's brushes, the Marionette's ticking snare, the Danse's bone rattles): their
    authored balance is kept exactly; drop the wrap to let their quiet hits mean pp. Bisection
    (velGain is monotone), so pure and exact to ~1e-9. */
export function legacyVel(v){
  v = clamp01(v);
  if (v >= DYN.KNEE) return v;
  const want = DYN.FLOOR + (1 - DYN.FLOOR) * v;
  let lo = v, hi = DYN.KNEE;
  for (let i = 0; i < 40; i++){ const m = (lo + hi) / 2; if (velGain(m) < want) lo = m; else hi = m; }
  return +((lo + hi) / 2).toFixed(4);
}
/** a drum lane through legacyVel: [beat, vel] (or a bare beat = full) → [beat, legacyVel(vel)] */
export const legacyLane = hits => hits.map(h => Array.isArray(h) ? [h[0], legacyVel(h[1] ?? 1), ...h.slice(2)] : h);
