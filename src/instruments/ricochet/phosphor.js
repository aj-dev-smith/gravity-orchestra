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

   The physics is a LINEAR phosphor (superposition): each strike adds
   one charge response
       c(s) = (1 − e^{−s/RISE}) · e^{−s/TAU}           s = time since that strike
   (the charge soaks in over ~RISE while the white-hot strike flash
   fades, then releases exponentially with TAU = P / DECAY_LOOPS, i.e.
   ~one loop). The level at time t is the sum over every strike that
   has ACTUALLY happened (none before the count-in's first downbeat):
       L = norm · Σ_k c(s + k·P)
   c(0) = 0, so a re-charge adds nothing at the instant of contact —
   the glow is CONTINUOUS everywhere (the strike flash is what jumps,
   and it already lives in index.js). norm makes the steady-state peak
   ≈ 1. Terms die geometrically (q = e^{−P/TAU}), so K_MAX terms is
   exact to < 1e-4 — O(1) per plate per frame.

   Hooks (index.js, three lines — merges on top of other plate work):
     import { phosphorAt, armPhosphor, paintPhosphor } from './phosphor.js';
     build():  plates.forEach(armPhosphor)                  after the plates exist
     update(): paintPhosphor(pl, phosphorAt(orb, pl.i, t))  last line of the per-plate loop
   paintPhosphor works as a DELTA over whatever the loop already wrote
   this frame (flash, warm-up, …), so it composes with other glow terms.
   ============================================================ */

export const PHOS = {
  RISE: .14,            // s: the charge soaks into the crystal while the strike flash fades
  DECAY_LOOPS: 2.4,     // TAU = P / this → a plate is at ~9% by the time the loop comes round
  HOT: 7,               // 1/s: the white-hot strike tint decays this fast back to the plate's hue
  K_MAX: 6,             // superposition terms (q^6 is negligible for DECAY_LOOPS ≥ 1.5)
};

/** one strike's charge response, s seconds after it */
export function charge(s, P){
  if (!(s >= 0) || !isFinite(s)) return 0;
  return (1 - Math.exp(-s / PHOS.RISE)) * Math.exp(-s * PHOS.DECAY_LOOPS / P);
}

/** the phosphor level: s = since the latest strike (Infinity = never struck), n = how many
    strikes have happened (≥ 1, may be Infinity). Normalised so the steady-state peak ≈ 1. */
export function phosphor(s, P, n = Infinity){
  if (!(s >= 0) || !isFinite(s) || !(n >= 1)) return 0;
  const q = Math.exp(-PHOS.DECAY_LOOPS);
  let L = 0;
  for (let k = 0; k < Math.min(n, PHOS.K_MAX); k++) L += charge(s + k * P, P);
  return L * (1 - q);
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
   intensity + opacity) and its rim. Dormant = near-clear dark glass with a faint
   rim; charged = the crystal turns luminous in its hue (opacity rises with the
   charge — a lit phosphor reads as a solid body of light). */
export const LOOK = {
  DISC_DORM: .02,  DISC_LIT: 1.8,    // disc emissiveIntensity floor / per unit charge
  OP_DORM: .2,     OP_LIT: .55,      // disc opacity floor / per unit charge
  BODY_DORM: .22,                    // dormant crystal body: albedo + reflections × this (smoked, unlit)
  RIM_DORM: .16,   RIM_LIT: 1.15,    // rim brightness (× hue) floor / per unit charge
  RELAY: .35,                        // relays are obsidian: a faint violet-blue memory only
  HOT_MIX: .75,                      // how white the emissive goes at the instant of contact
  BASE_RIM: .7,                      // index.js writes rim = hue × (BASE_RIM + flash)
};

/** build-time: remember the plate's baseline so paint can work as a delta (no allocation later) */
export function armPhosphor(pl){
  pl.ph = {
    eBase: pl.discM.emissiveIntensity,          // what index.js's update writes as its floor
    opBase: pl.discM.opacity,
    body: pl.discM.color.clone(),
    env: pl.discM.envMapIntensity,
    white: pl.colBase.clone().setRGB(1, 1, 1),
    tmp: pl.colBase.clone(),
  };
}

/** per-frame: the phosphor charge, painted over what the plate loop already wrote this frame */
export function paintPhosphor(pl, st){
  const ph = pl.ph; if (!ph) return;
  const g = pl.relay ? LOOK.RELAY : 1;
  const L = st.level * g;
  // emissive: white-hot at contact → settling into the plate's own hue
  pl.discM.emissive.copy(pl.colBase).lerp(ph.white, LOOK.HOT_MIX * st.hot * g);
  pl.discM.emissiveIntensity += (LOOK.DISC_DORM - ph.eBase) * g + LOOK.DISC_LIT * L;
  if (!pl.relay){
    const b = LOOK.BODY_DORM + (1 - LOOK.BODY_DORM) * Math.min(1, L + st.hot);   // the dormant crystal is smoked glass
    pl.discM.color.copy(ph.body).multiplyScalar(b);
    pl.discM.envMapIntensity = ph.env * b;
    pl.discM.opacity = LOOK.OP_DORM + LOOK.OP_LIT * Math.min(1, L) + .3 * st.hot;
  }
  // rim: dormant ember → lit ring (added onto the flash the loop wrote)
  pl.rimM.color.add(ph.tmp.copy(pl.colBase).multiplyScalar((LOOK.RIM_DORM - LOOK.BASE_RIM) * g + LOOK.RIM_LIT * L));
}
