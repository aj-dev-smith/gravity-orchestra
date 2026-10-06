/* ============================================================
   PHOSPHOR PLATES — every ricochet plate is a phosphorescent crystal.

   The point (the human's ask): each plate is struck EXACTLY ONCE per
   loop, and that's half the magic — but a constellation of identical
   glowing discs hides it. So the plates sit DORMANT (dim, near-clear
   glass) until the marble hits them; each strike CHARGES the crystal,
   which then releases that charge as a slow afterglow in its own hue.
   The sculpture visibly FILLS IN with the melody's history — the most
   recent plates brightest, the earliest ones fading just as the loop
   comes back round and re-charges them. No reset event, no counter:
   the glow is a pure function of songTime, like everything else.

   The physics is a LINEAR, TWO-COMPONENT phosphor (superposition) — real
   phosphors have a fast and a slow trap population. Each strike adds
       c(s) = (1 − e^{−s/RISE}) · (A·e^{−s/τf} + (1−A)·e^{−s/τs})
   s = time since that strike; τf = P/FAST_LOOPS (a vivid WAKE trailing
   the marble), τs = P/SLOW_LOOPS (a long faint MEMORY of the whole loop).
   The level at time t is the sum over every strike that has ACTUALLY
   happened (none before the count-in's first downbeat):
       L = norm · Σ_k c(s + k·P)
   c(0) = 0, so a re-charge adds nothing at the instant of contact —
   the glow is CONTINUOUS everywhere (the strike flash is what jumps,
   and it lives in index.js). norm makes the steady-state peak ≈ 1.
   Both components die geometrically per loop, so K_MAX terms is exact
   to < 1e-4 — O(1) per plate per frame.

   Hooks (index.js, three lines — merges on top of other plate work):
     import { phosphorAt, armPhosphor, paintPhosphor } from './phosphor.js';
     build():  plates.forEach(armPhosphor)                  after the plates exist
     update(): paintPhosphor(pl, phosphorAt(orb, pl.i, t), pre)
               LAST line of the per-plate loop (after every other material write).
               pre = the PRE-strike power warm-up on this plate (powered plates:
               pw.charge * pl.pw; 0 / omitted when there is none). It tints the
               disc's emissive ICE so anticipation never reads as "already struck".
   paintPhosphor works as a DELTA over whatever the loop already wrote this
   frame (flash, coil warm-up, discharge, …), so it composes with other glow
   terms. The jewel rim it charges is pl.bezelM (emissiveIntensity, additive —
   its colour is left to the discharge) when the plate has one, else pl.rimM
   (the pre-driver plate's torus rim). It never paints the voice coil.
   ============================================================ */

export const PHOS = {
  RISE: .14,            // s: the charge soaks into the crystal while the strike flash fades
  A: .7,                // fast-trap share of each charge: the bright wake behind the marble
  FAST_LOOPS: 10,       // τf = P / this
  SLOW_LOOPS: 1.6,      // τs = P / this → the long faint memory (~7% left when the loop comes round)
  HOT: 7,               // 1/s: the white-hot strike tint decays this fast back to the plate's hue
  K_MAX: 7,             // superposition terms (e^{−7·SLOW_LOOPS} is negligible)
};

/** one strike's charge response, s seconds after it */
export function charge(s, P){
  if (!(s >= 0) || !isFinite(s)) return 0;
  const { RISE, A, FAST_LOOPS, SLOW_LOOPS } = PHOS;
  return (1 - Math.exp(-s / RISE)) * (A * Math.exp(-s * FAST_LOOPS / P) + (1 - A) * Math.exp(-s * SLOW_LOOPS / P));
}

/** steady-state normaliser: 1 / Σ_k (decay part at s = k·P) — the infinite train's peak envelope */
const norm = () => {
  const { A, FAST_LOOPS: F, SLOW_LOOPS: S } = PHOS;
  return 1 / (A / (1 - Math.exp(-F)) + (1 - A) / (1 - Math.exp(-S)));
};

/** the phosphor level: s = since the latest strike (Infinity = never struck), n = how many
    strikes have happened (≥ 1, may be Infinity). Normalised so the steady-state peak ≈ 1. */
export function phosphor(s, P, n = Infinity){
  if (!(s >= 0) || !isFinite(s) || !(n >= 1)) return 0;
  let L = 0;
  for (let k = 0; k < Math.min(n, PHOS.K_MAX); k++) L += charge(s + k * P, P);
  return L * norm();
}

/** the white-hot tint of the strike (0..1): the flash that settles into the phosphor hue */
export const hotOf = s => (s >= 0 && isFinite(s)) ? Math.exp(-s * PHOS.HOT) : 0;

/** plate j at songTime t → { s, n, level, hot }. Counts only strikes that actually happened
    (nothing before the orbit's first downbeat: the whole sculpture is dormant in the count-in). */
const _o = { s: Infinity, n: 0, level: 0, hot: 0 };
export function phosphorAt(orb, j, t, out = _o){
  const P = orb.P, tj = orb.nodes[j].t;
  const abs = tj + Math.floor((t - tj) / P) * P;             // this plate's latest strike at/before t
  const first = orb.entry ? orb.entry.tFirst : -Infinity;
  if (abs < first - 1e-6){ out.s = Infinity; out.n = 0; out.level = 0; out.hot = 0; return out; }
  const s = t - abs;
  // strikes so far = 1 + whole loops between the plate's first real strike and this one
  const n = isFinite(first) ? 1 + Math.round((abs - (tj + Math.ceil((first - 1e-6 - tj) / P) * P)) / P) : Infinity;
  out.s = s; out.n = n; out.level = phosphor(s, P, n); out.hot = hotOf(s);
  return out;
}

/* ---------------- render: the glow lives IN the crystal ----------------
   No sprites, no new materials: the plate's own disc material (emissive colour +
   intensity + opacity + smoked body) and its jewel rim. Dormant = near-clear smoked
   glass with a faint rim; charged = the crystal glows from INSIDE in a SATURATED
   version of its hue. A phosphor does not get more reflective when it glows, so the
   body stays smoked (only a little albedo returns); the strike's white-hot flash is
   emissive only — no mirror pop at contact.
   Perceptual knee: emissive follows the charge linearly, but opacity/body follow
   smoothstep(KNEE0, KNEE1, L) — a mid-age plate reads "dim but alive", not "lit". */
export const LOOK = {
  DISC_DORM: .02,  DISC_LIT: 1.25,   // disc emissiveIntensity floor / per unit charge (linear)
  OP_DORM: .2,     OP_LIT: .38,      // disc opacity floor / per unit (kneed) charge
  BODY_DORM: .2,   BODY_LIT: .42,    // body albedo + reflections × this: dormant → fully lit (stays smoked)
  KNEE0: .12,      KNEE1: .85,       // the perceptual knee for opacity/body
  RIM_DORM: .16,   RIM_LIT: 1.15,    // pre-driver torus rim (× hue) floor / per unit charge
  BEZ_DORM: .08,   BEZ_LIT: 1.2,     // powered-plate bezel (jewel rim) emissiveIntensity floor / per unit charge
  RELAY: .35,                        // relays are obsidian: a faint violet-blue memory only
  HOT_MIX: .75,                      // how white the emissive goes at the instant of contact
  BASE_RIM: .7,                      // the pre-driver loop writes rim = hue × (BASE_RIM + flash)
  ENERGY0: .55,                      // stored charge ∝ hit energy: ghost note → ENERGY0, accent → 1
  PRE_TINT: 0x8fe9ff,                // ICE — the power/bus colour: a PRE-strike warm-up reads as power, not phosphor
};

const knee = L => { const x = Math.min(1, Math.max(0, (L - LOOK.KNEE0) / (LOOK.KNEE1 - LOOK.KNEE0))); return x * x * (3 - 2 * x); };

/** build-time: remember the plate's baseline so paint can work as a delta (no allocation later) */
export function armPhosphor(pl){
  const hs = { h: 0, s: 0, l: 0 };
  pl.colBase.getHSL(hs);
  pl.ph = {
    eBase: pl.discM.emissiveIntensity,          // what the update loop writes as its floor
    bezBase: pl.bezelM ? pl.bezelM.emissiveIntensity : 0,
    body: pl.discM.color.clone(),
    env: pl.discM.envMapIntensity,
    sat: pl.colBase.clone().setHSL(hs.h, 1, .5),    // the phosphor emits a SATURATED hue (no pastel)
    ice: pl.colBase.clone().setHex(LOOK.PRE_TINT),
    white: pl.colBase.clone().setRGB(1, 1, 1),
    tmp: pl.colBase.clone(),
  };
}

/** per-frame: the phosphor charge, painted over what the plate loop already wrote this frame.
    pre = the plate's PRE-strike warm-up level (0 when none) — tints the disc ICE while it dominates. */
export function paintPhosphor(pl, st, pre = 0){
  const ph = pl.ph; if (!ph) return;
  const g = pl.relay ? LOOK.RELAY : 1;
  const e = Math.min(1, Math.max(0, pl.pw ?? (pl.relay ? .45 : (pl.nd ? pl.nd.vel : 1))));
  const L = st.level * g * (LOOK.ENERGY0 + (1 - LOOK.ENERGY0) * e);   // charge ∝ hit energy
  const K = knee(L);
  // emissive colour: phosphor hue ← ICE while the (pre-strike) power warm-up dominates ← white-hot at contact
  const p = pre > 0 ? pre / (pre + L + 1e-3) : 0;
  pl.discM.emissive.copy(ph.sat).lerp(ph.ice, p).lerp(ph.white, LOOK.HOT_MIX * st.hot * g);
  pl.discM.emissiveIntensity = Math.max(0, pl.discM.emissiveIntensity + (LOOK.DISC_DORM - ph.eBase) * g + LOOK.DISC_LIT * L);
  if (!pl.relay){
    const b = LOOK.BODY_DORM + (LOOK.BODY_LIT - LOOK.BODY_DORM) * K;   // smoked glass, lit from within
    pl.discM.color.copy(ph.body).multiplyScalar(b);
    pl.discM.envMapIntensity = ph.env * b;
    pl.discM.opacity = Math.min(1, LOOK.OP_DORM + LOOK.OP_LIT * K);
  }
  // the jewel rim: dormant ember → lit ring, added onto whatever the loop wrote (flash / discharge)
  if (pl.bezelM){
    pl.bezelM.emissiveIntensity = Math.max(0, pl.bezelM.emissiveIntensity + (LOOK.BEZ_DORM - ph.bezBase) * g + LOOK.BEZ_LIT * L);
  } else if (pl.rimM){
    const c = pl.rimM.color;
    c.add(ph.tmp.copy(pl.colBase).multiplyScalar((LOOK.RIM_DORM - LOOK.BASE_RIM) * g + LOOK.RIM_LIT * L));
    c.r = Math.max(0, c.r); c.g = Math.max(0, c.g); c.b = Math.max(0, c.b);
  }
}
