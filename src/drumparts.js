import { dribbleLane, firstStrike, G } from './engine.js';
import { GM_DRUMS, normalizeHit } from './drumkit.js';

/* ============================================================
   DRUM PARTS — the pure half of the drum machine's fresh coat.
   No THREE, no DOM, no audio: layout + the timing of every part
   that REACTS (hi-hat clutch, snare wires, kick shockwave), each a
   pure fn of songTime on top of the lane's dribble schedule
   (engine.js dribble*). marbledrums.js renders what this says.
   ============================================================ */

/* Per-lane look + scale. r = head radius, ball = marble radius (mass reads as size),
   lift = contact height above the deck (toms: overridden by the staircase), kind picks
   the head builder. shell = the sparkle-lacquer base colour, flake = its metal-flake
   tint, glow = the lane's light (strike light, sparks, ghost trail, head ring). */
export const STYLE = {
  kick:      { r: 1.30, ball: .34, lift: 1.8, kind: 'drum',   shell: 0x5a0a16, flake: 0xff6a3a, glow: 0xffb066, depth: .95, chrome: true },
  snare:     { r: .72,  ball: .20, lift: 1.75, kind: 'drum',  shell: 0x0c2460, flake: 0x8fc4ff, glow: 0xbfe0ff, depth: .36 },
  clap:      { r: .58,  ball: .17, lift: 1.9, kind: 'drum',   shell: 0x3c0d55, flake: 0xff8ae0, glow: 0xffc0e8, depth: .42 },
  hat:       { r: .66,  ball: .13, lift: 2.15, kind: 'cymbal', bronze: 0xd6a656, glow: 0xfff0a8 },
  crash:     { r: .98,  ball: .16, lift: 2.75, kind: 'cymbal', bronze: 0xe2b462, glow: 0xfff6d0 },
  ride:      { r: 1.04, ball: .16, lift: 2.45, kind: 'cymbal', bronze: 0xb88a44, glow: 0xf2f8d0 },
  // the toms: a lacquer sweep down the staircase, gold at the top → deep wine at the floor
  tomHigh:   { r: .58,  ball: .18, kind: 'drum', shell: 0x6a4808, flake: 0xffd668, glow: 0xffe898, depth: .44 },
  tomHiMid:  { r: .64,  ball: .20, kind: 'drum', shell: 0x6a2c06, flake: 0xffb050, glow: 0xffdc98, depth: .48 },
  tomMid:    { r: .70,  ball: .22, kind: 'drum', shell: 0x641408, flake: 0xff8a50, glow: 0xffcc98, depth: .52 },
  tomLow:    { r: .78,  ball: .24, kind: 'drum', shell: 0x560a1e, flake: 0xff6a6a, glow: 0xffbc98, depth: .58 },
  floorHigh: { r: .90,  ball: .27, kind: 'drum', shell: 0x40082e, flake: 0xff5ab0, glow: 0xffa692, depth: .78 },
};
export const FALLBACK = STYLE.snare;
export const styleOf = lane => STYLE[lane] || FALLBACK;
export const isTom = lane => /^(tom|floor)/.test(lane);

/* ---- COMPOSITION (kit-local frame: origin = the deck top at the slot, +x right,
   +z toward the audience). The kick anchors front-centre; snare + hi-hat on the left
   like a drummer's left hand; the TOMS climb a SPIRAL STAIRCASE behind-right of the
   kick, PITCH = HEIGHT (a fill is a visible descent toward the audience); crash + ride
   on booms at the outside. The solo slot puts the belt's bay behind-left of the kit,
   so everything left of x = −4.5 stays in front of z = −3 (KEEPOUT, tested). ---- */
export const FIXED = {
  kick:  { x: 0,    z: .65 },
  snare: { x: -2.35, z: 1.15 },
  clap:  { x: -2.3, z: -1.35 },
  hat:   { x: -4.35, z: .35 },
  crash: { x: -6.35, z: -1.45 },
  ride:  { x: 6.55, z: 1.0 },
};
export const SPIRAL = {
  C: { x: 2.35, z: -2.1 },   // the newel post
  R: 2.6,                    // tom centres sit on this circle
  phi0: 1.02,                // the FLOOR tom's bearing (rad, 0 = +z toward the audience, + = toward +x)
  y0: 1.55,                  // floor-tom contact height above the deck
  rise: .66,                 // each step up the stair (one tom higher in pitch)
  gap: .26,                  // clear air between neighbouring tom hoops
};
/* The magnet ARCH — a BANDSHELL: superellipse ribs that rise from the low front rib to
   the tall back one (the back rib angled in plan to clear the staircase); a rung runs
   front→back over every magnet, sloping with the shell, and the magnet hangs from it. */
export const ARCH = { X0: 8.85, p: 4, ribs: 3, front: { top: 6.9, z: 2.85 }, back: { top: 8.7, z0: -3.0, z1: -5.9 } };
const shape = x => Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(x) / ARCH.X0), ARCH.p)), 1 / ARCH.p);
export const zBack = x => ARCH.back.z0 + (ARCH.back.z1 - ARCH.back.z0) * (x + ARCH.X0) / (2 * ARCH.X0);
/* rib k of ARCH.ribs (0 = front … last = back): its plan line z(x) and its height y(x) */
export function rib(k){
  const f = k / (ARCH.ribs - 1);
  const top = ARCH.front.top + (ARCH.back.top - ARCH.front.top) * f;
  return { f, z: x => ARCH.front.z + (zBack(x) - ARCH.front.z) * f, y: x => top * shape(x) };
}
/* the rung over (x, z): its height, sloping front → back (extrapolated past the back rib) */
export function rungY(x, z){
  const zf = ARCH.front.z, zb = zBack(x), f = (zf - z) / (zf - zb);
  return (ARCH.front.top + (ARCH.back.top - ARCH.front.top) * f) * shape(x);
}
export const KEEPOUT = { xMax: -4.5, zMax: -3.05 };   // the belt bay's corner in the solo slot

/* Toms present → their staircase seats, LOW → HIGH by membrane tone (drumkit.js). Each
   step turns by exactly the angle that keeps neighbouring hoops `gap` apart. */
export function spiralSeats(toms){
  const order = [...toms].sort((a, b) => (GM_DRUMS[a]?.tone ?? 150) - (GM_DRUMS[b]?.tone ?? 150));
  const { C, R, phi0, y0, rise, gap } = SPIRAL;
  let phi = phi0;
  return order.map((lane, k) => {
    if (k){
      const ra = styleOf(order[k - 1]).r, rb = styleOf(lane).r;
      phi += 2 * Math.asin(Math.min(1, (ra + rb + gap) / (2 * R)));
    }
    return { lane, phi, step: k, x: C.x + R * Math.sin(phi), z: C.z + R * Math.cos(phi), y: y0 + k * rise };
  });
}

/* The kit's PIECES — render units, one ball each. The two hi-hat lanes are ONE
   instrument: one pair of cymbals, one ball. Why one ball and not two: a real hi-hat
   has one striking point, and two balls sharing one head would need choreography
   (plumbing) to never meet; one ball whose schedule is the MERGED hat+hatOpen list
   is just another dribble lane — conserved, honest, free. The CLUTCH decides the
   timbre: each strike knows if it was open, the clutch is solved to be exactly there
   at the strike, and the audio lane stays 'hat' / 'hatOpen'. */
export function kitPieces(spec){
  const names = Object.keys(spec || {});
  const pieces = [];
  const hatLanes = ['hat', 'hatOpen'].filter(n => names.includes(n));
  for (const n of names){
    if (n === 'hatOpen') continue;
    if (n === 'hat') continue;
    pieces.push({ key: n, lanes: [n] });
  }
  if (hatLanes.length) pieces.push({ key: 'hat', lanes: hatLanes });
  // seats
  const toms = pieces.filter(p => isTom(p.key)).map(p => p.key);
  const seats = Object.fromEntries(spiralSeats(toms).map(s => [s.lane, s]));
  let extra = 0;
  for (const p of pieces){
    const st = styleOf(p.key);
    if (seats[p.key]){ const s = seats[p.key]; Object.assign(p, { x: s.x, z: s.z, lift: s.y, seat: s }); }
    else if (FIXED[p.key]) Object.assign(p, FIXED[p.key], { lift: st.lift });
    else { Object.assign(p, { x: -1.2 + 1.5 * extra++, z: 2.2, lift: 1.6 }); }   // an unregistered lane: the front apron
  }
  return pieces;
}

/* A piece's dribble lane + per-strike metadata (vel, audio lane, open flag). */
export function pieceLane(piece, spec, { rollT, beat, P, dtMax }){
  const hits = [];
  for (const lane of piece.lanes) for (const h of spec[lane].map(normalizeHit))
    hits.push({ t: rollT + h.beat * beat, vel: h.vel, lane });
  const L = dribbleLane(hits.map(h => h.t), P, { dtMax });
  const wrap = t => ((t % P) + P) % P;                  // the same wrap dribbleLane keys its strikes by
  const byS = new Map();
  for (const h of hits){ const k = wrap(h.t); (byS.get(k) || byS.set(k, []).get(k)).push(h); }
  const vel = [], lane = [], open = [];
  for (const s of L.s){
    const at = byS.get(s);
    const o = at.some(h => h.lane === 'hatOpen');
    open.push(o);
    lane.push(piece.key === 'hat' ? (o ? 'hatOpen' : 'hat') : piece.lanes[0]);
    vel.push(Math.max(...at.map(h => h.vel)));
  }
  return { L, vel, lane, open };
}

/* ---- the HI-HAT CLUTCH: 0 = closed, 1 = open. It sits exactly at each strike's
   state AT the strike; between two strikes of the same state it holds; between two
   that differ it moves in a short window ending ON the next strike — the pedal lifts
   just before an open hit, and an open hat rings until the pedal CHICKS it shut as the
   next closed hit lands. Armed count-in: held at the first strike's state.
   `d` = dribbleAt(L, t, start) (the same O(log n) lookup the ball uses). ---- */
export const CLUTCH = { open: .16, close: .09, frac: .7 };
export function clutchFrom(L, open, d, start = -Infinity){
  const n = L.s.length;
  if (!n) return 0;
  if (d.i < 0){
    const f = firstStrike(L, start), P = L.P;
    const k = L.s.findIndex(s => Math.abs(s - (((f % P) + P) % P)) < 1e-9);
    return open[Math.max(0, k)] ? 1 : 0;
  }
  const i = d.i, j = (i + 1) % n, a = open[i] ? 1 : 0, b = open[j] ? 1 : 0;
  if (a === b) return a;
  const w = Math.min(b ? CLUTCH.open : CLUTCH.close, L.gaps[i] * CLUTCH.frac);
  if (d.until >= w) return a;
  const u = Math.min(1, Math.max(0, 1 - d.until / w));
  return a + (b - a) * u * u * (3 - 2 * u);
}

/* ---- SNARE WIRES: the buzz envelope (0..1) of the wires under the bottom head.
   Born at zero at the strike (the wires are slack against the head until the shock
   arrives), a sharp rise, a decay, and tapered back to zero by the next strike — so
   every hit starts its own rattle from rest, no snap. v = impact speed / the lane's max. */
export const WIRES = { rise: 70, decay: 6.5 };
export function wireBuzz(since, gap, v){
  if (!(since >= 0) || !(since < gap)) return 0;
  return Math.min(1, Math.max(0, v)) * (1 - Math.exp(-since * WIRES.rise)) * Math.exp(-since * WIRES.decay)
       * (1 - since / gap) ** 2;
}

/* ---- the KICK SHOCKWAVE: each cannonball landing sends a ring across the riser floor.
   A ring is born at zero radius and zero strength at the strike, races outward and
   fades; up to SHOCK.n rings (the last n kicks) are live at once, so a new kick never
   cuts the old ring off — no snap. Only kicks that HAPPENED count (none in the armed
   count-in, none from "the previous loop" before the first strike). ---- */
export const SHOCK = { v: 7.5, life: 1.6, n: 3 };
export function shockRing(age){
  if (!(age >= 0) || age > SHOCK.life) return { r: 0, a: 0 };
  return { r: SHOCK.v * age, a: (1 - Math.exp(-age * 40)) * Math.exp(-age * 2.6) * (1 - age / SHOCK.life) };
}
/* The live rings at songTime t: [{age, k, fade}] newest first (k = strike index), from
   the same dribbleAt result the ball uses. Only SHOCK.n slots: the ring in the last slot
   FADES to zero as the next kick approaches (fade = until/gap), so it is exactly gone
   when the new ring pushes it out — dense double-kick runs never pop. */
export function shockAges(L, d, t, start = -Infinity){
  const out = [], n = L.s.length;
  if (d.i < 0 || !n) return out;
  const first = firstStrike(L, start);
  let age = d.since, k = d.i;
  for (let m = 0; m < SHOCK.n && age <= SHOCK.life; m++){
    if (t - age < first - 1e-9) break;                  // that strike never happened (before the count-in drop)
    out.push({ age, k, fade: m < SHOCK.n - 1 ? 1 : Math.max(0, Math.min(1, d.until / (d.since + d.until))) });
    k = (k - 1 + n) % n; age += L.gaps[k];
  }
  return out;
}

export const DROP_V = dtMax => -G.y * dtMax / 2;        // the armed drop's landing speed
