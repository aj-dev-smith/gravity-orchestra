import { dribbleLane, dribbleAt, dribblePiston, firstStrike, G } from './engine.js';
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
  // the hung cymbals: `lift` here = the BELL top's height (the ball lands where CYMBALS says,
  // on the cymbal's own surface there — see cymbalSurface). china is mounted INVERTED.
  crash:     { r: .98,  ball: .16, lift: 2.75, kind: 'cymbal', bronze: 0xe2b462, glow: 0xfff6d0 },
  ride:      { r: 1.04, ball: .16, lift: 2.45, kind: 'cymbal', bronze: 0xb88a44, glow: 0xf2f8d0 },
  rideBell:  { r: 1.04, ball: .14, lift: 2.45, kind: 'cymbal', bronze: 0xb88a44, glow: 0xffe2a0 },
  china:     { r: .90,  ball: .16, lift: 2.55, kind: 'cymbal', bronze: 0x9c6a2e, glow: 0xffc890, inverted: true },
  splash:    { r: .52,  ball: .12, lift: 2.85, kind: 'cymbal', bronze: 0xf0c474, glow: 0xfffbe6 },
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

/* ---- HARDWARE DIMENSIONS shared by the solve + the look (pure numbers) ---- */
export const DT_MAX = 1.2;                                // longest flown gap (s) → magnet height
export const MAG_H  = -G.y * DT_MAX * DT_MAX / 8;         // the max apex: where every magnet's face hangs
export const HW = { BASKET: .2, ROD_VIS: .22, ROD_IN: .7, SLEEVE: 1.0 };
/* a magnet's pot top, kit-local (drumlook.buildMagnet: face at the ball's top at the max apex, pot + cap .66) */
export const magnetTop = p => p.lift + MAG_H + 2 * styleOf(p.key).ball + .66;

/* ---- COMPOSITION (kit-local frame: origin = the deck top at the slot, +x right,
   +z toward the audience). The kick anchors front-centre; snare + hi-hat on the left
   like a drummer's left hand; crash + ride on booms in the back row; the TOMS climb a
   SPIRAL STAIRCASE round a post behind-right of the kick — the floor tom at its foot
   beside the kick, the high tom at the top, at the back: PITCH = HEIGHT, a fill is a
   visible descent toward the audience.
   THE BACK LINE: in the solo slot the belt bays stand behind the kit (their front face
   reaches world z ≈ 1.7–2.3 → kit-local z ≈ −3.3…−2.7), so NOTHING of the kit — deck,
   arch footings, ribs, treads, stands — goes behind BACK (tested against every drum
   song's measured belt boxes). ---- */
export const BACK = -2.6;
export const FIXED = {
  kick:  { x: 0,     z: .65 },
  snare: { x: -2.4,  z: 1.2 },
  hat:   { x: -4.45, z: .45 },
  crash: { x: -5.55, z: -1.5 },    // (cymbals: the cymbal's CENTRE — the ball strikes it per CYMBALS)
  ride:  { x: -1.65, z: -1.45 },
  china: { x: -7.15, z: 1.0 },
  splash:{ x: -3.35, z: -1.05 },
  clap:  { x: 1.95,  z: -1.75 },
};
/* boom stands for the cymbals (the stand's foot; the boom reaches over to the cymbal) */
export const STANDS = { crash: { x: -7.15, z: -.55 }, ride: { x: .35, z: -2.0 }, china: { x: -8.35, z: 2.0 }, splash: { x: -3.75, z: -2.0 } };
export const TRIPOD = .55;                                // stand tripod reach
export const SPIRAL = {
  C: { x: 4.6, z: -1.08 },   // the newel post
  R: 2.6,                    // tom centres sit on this circle
  phi0: -.9,                 // the FLOOR tom's bearing (rad, 0 = +z toward the audience, + = toward +x)
  y0: 1.55,                  // floor-tom contact height above the deck
  rise: .66,                 // each step up the stair (one tom higher in pitch)
  gap: .26,                  // clear air between neighbouring tom hoops
  post: .11,                 // newel post radius
};
/* the hi-hat's foot: pedal heel hinge, in front of the stand (kit-local offset from the hat) */
export const HAT = { OPEN: .28, heelZ: 1.55, pedalL: .7, q: { z: .43, y: .55 }, arm: .45, endY: .69, hook: 1.18 };

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
    const z = CYMBALS[n];
    // a cymbal lane strikes ITS cymbal; a lane that shares one (the ride bell) rides as a
    // guest on the host's cymbal when the host plays too — one cymbal, two balls
    pieces.push(z ? { key: n, lanes: [n], cym: z.on, host: z.on !== n && names.includes(z.on) ? z.on : null } : { key: n, lanes: [n] });
  }
  if (hatLanes.length) pieces.push({ key: 'hat', lanes: hatLanes });
  // seats
  const toms = pieces.filter(p => isTom(p.key)).map(p => p.key);
  const seats = Object.fromEntries(spiralSeats(toms).map(s => [s.lane, s]));
  let extra = 0;
  for (const p of pieces){
    const st = styleOf(p.key);
    if (seats[p.key]){ const s = seats[p.key]; Object.assign(p, { x: s.x, z: s.z, lift: s.y, seat: s }); }
    else if (p.cym){                                     // the ball's column: CYMBALS' radius + bearing off the centre
      const C = FIXED[p.cym], z = CYMBALS[p.key], R = styleOf(p.cym).r, rho = z.rho * R, bell = styleOf(p.cym).lift;
      Object.assign(p, { cx: C.x, cz: C.z, rho, dir: z.dir, bell,
        x: C.x + rho * Math.sin(z.dir), z: C.z + rho * Math.cos(z.dir), lift: bell + cymbalSurface(p.cym, rho) });
    }
    else if (FIXED[p.key]) Object.assign(p, FIXED[p.key], { lift: st.lift });
    else { Object.assign(p, { x: -1.5 * extra++, z: 3.1, lift: 1.6 }); }   // an unregistered lane: the front apron
  }
  return pieces;
}

/* ---- the STAIRCASE's own geometry (pure): where each tom's step sits, the wedge
   tread under it (bearings a0..a1, radii rIn..rOut round the post) and the riser that
   climbs to it from the step below. A tom whose step would sit at deck level stands on
   the deck on a tripod instead (the floor tom — it is the foot of the stair). ---- */
export const stepY = (lane, y) => y - styleOf(lane).depth - HW.BASKET - HW.ROD_VIS - HW.SLEEVE * .55;
export const pieceFloor = p => p.seat ? (stepY(p.key, p.lift) > .3 ? stepY(p.key, p.lift) : 0) : 0;
export function stairTreads(pieces){
  const seats = pieces.filter(p => p.seat).sort((a, b) => a.seat.step - b.seat.step);
  const { C, R, post } = SPIRAL, out = [];
  seats.forEach((p, k) => {
    const y = pieceFloor(p);
    if (!y) return;
    const prev = seats[k - 1], next = seats[k + 1], r = styleOf(p.key).r, own = Math.asin(Math.min(1, (r + .14) / R));
    const a0 = prev ? (prev.seat.phi + p.seat.phi) / 2 : p.seat.phi - own;
    const a1 = next ? (next.seat.phi + p.seat.phi) / 2 : p.seat.phi + own;
    out.push({ key: p.key, a0, a1, rIn: post + .03, rOut: R + r + .1, y, below: prev ? pieceFloor(prev) : 0, th: .14 });
  });
  return out;
}
/* plan points sampled round a tread's outline (for footprint + clearance checks) */
export function treadOutline(t, n = 8){
  const { C } = SPIRAL, pts = [];
  for (let k = 0; k <= n; k++){ const a = t.a0 + (t.a1 - t.a0) * k / n;
    pts.push([C.x + t.rOut * Math.sin(a), C.z + t.rOut * Math.cos(a)]); }
  for (const a of [t.a0, t.a1]) for (let k = 0; k <= n; k++){ const rr = t.rIn + (t.rOut - t.rIn) * k / n;
    pts.push([C.x + rr * Math.sin(a), C.z + rr * Math.cos(a)]); }
  return pts;
}
/* a piece's plan reach: its head, or the tripod/legs under it if wider (a cymbal: round its CENTRE) */
export function pieceReach(p){
  const r = styleOf(p.cym || p.key).r;
  if (styleOf(p.key).kind === 'cymbal') return r;
  return Math.max(r, pieceFloor(p) ? 0 : p.key === 'kick' ? .9 : .6);
}
/* a piece's plan DISC [x, z, r]: what it occupies on the floor plan. A cymbal's disc is
   round its centre (its ball strikes off-centre); a guest on a host's cymbal (the ride
   bell on the ride) has none of its own — the host's disc is the cymbal. */
export function pieceDisc(p){
  if (p.host) return null;
  return p.cym ? [p.cx, p.cz, pieceReach(p)] : [p.x, p.z, pieceReach(p)];
}
/* the stand a piece puts on the floor (cymbals on booms; a guest has none) */
export const pieceStand = p => (!p.host && STANDS[p.cym || p.key]) || null;

/* ---- the KIT FRAME: everything sized from the kit that is actually built. A kick +
   snare + hat gets a compact shell and deck; the full kit gets the lot. The magnet
   SHELL is a BANDSHELL that opens toward the audience: ribs FAN from one pair of
   footings on the back line (tilts 0 → forward), every point on them a circle of
   radius ρ(x) = T·shape(x) round the footing axis. A curved RUNG follows that circle
   out from the back rib over each magnet, the magnet hanging from it on a vertical
   rod — so there are no bars in front of the kit, only a canopy over it. ---- */
const SHAPE_P = 4.5;                                      // squarish: tall shoulders over the outer pieces
export const shape = u => Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(u)), SHAPE_P)), 1 / SHAPE_P);
export function kitFrame(pieces){
  const pts = [];                                         // [x, z, reach]
  for (const p of pieces){
    const D = pieceDisc(p); if (D) pts.push(D);
    const S = pieceStand(p); if (S) pts.push([S.x, S.z, TRIPOD]);
    if (p.key === 'hat') pts.push([p.x, p.z + HAT.heelZ + .1, .22]);
  }
  for (const t of stairTreads(pieces)) for (const [x, z] of treadOutline(t)) pts.push([x, z, .05]);
  if (pieces.some(p => p.seat)) pts.push([SPIRAL.C.x, SPIRAL.C.z, .3]);
  const xL = Math.min(...pts.map(q => q[0] - q[2])), xR = Math.max(...pts.map(q => q[0] + q[2]));
  const zMin = Math.min(...pts.map(q => q[1] - q[2])), zMax = Math.max(...pts.map(q => q[1] + q[2]));
  const xc = (xL + xR) / 2, X0 = (xR - xL) / 2 + .9;
  const zA = Math.max(BACK + .45, zMin - .2);             // the back line the ribs spring from
  const mags = pieces.map(p => ({ key: p.key, x: p.x, z: p.z, top: magnetTop(p) }));
  // tall enough that the shell passes over every piece's whole column (its far side,
  // where the shell has dropped most), magnet pot included
  let T = 5;
  for (const p of pieces){
    // the column to clear: the magnet's, or the whole cymbal round its centre if that reaches further
    const cols = [[p.x, p.z, .3 + (p.cym ? 0 : pieceReach(p))]];
    const D = pieceDisc(p); if (D && p.cym) cols.push([D[0], D[1], D[2] + .3]);
    for (const [x, z, rr] of cols){
      const T0 = Math.hypot(magnetTop(p) + .55, Math.max(0, z + rr - zA)) / shape((Math.abs(x - xc) + rr) / X0);
      T = Math.max(T, T0 + .1);
    }
  }
  const rho = x => T * shape((x - xc) / X0);
  const thOf = m => Math.asin(Math.max(-1, Math.min(1, (m.z - zA) / rho(m.x))));
  const thTop = Math.max(.12, ...mags.map(thOf));
  const deck = { x0: xc - X0 - .5, x1: xc + X0 + .5, z0: Math.max(BACK, Math.min(zMin, zA - .5)), z1: zMax + .45 };
  return { xc, X0, zA, T, thTop, rho, thOf, mags, deck,
           tilts: [0, .45, .8].map(f => f * thTop) };
}
/* a point on the shell at x, tilt th (0 = the vertical back rib) */
export const shellPoint = (F, x, th) => ({ x, y: F.rho(x) * Math.cos(th), z: F.zA + F.rho(x) * Math.sin(th) });
/* the rungs: one per magnet (merged with any within .35 in x), each a curved arm out
   along the shell from the back rib (th 0) to just past its farthest magnet */
export function shellRungs(F){
  const rungs = [];
  for (const m of [...F.mags].sort((a, b) => a.x - b.x)){
    const last = rungs.at(-1);
    if (last && m.x - last.x0 < .35){ last.ms.push(m); last.x = (last.x0 + m.x) / 2; }
    else rungs.push({ x0: m.x, x: m.x, ms: [m] });
  }
  for (const r of rungs){
    r.hang = r.ms.map(m => { const th = Math.asin(Math.max(-1, Math.min(1, (m.z - F.zA) / F.rho(r.x)))); return { m, th, ...shellPoint(F, r.x, th) }; });
    r.th1 = Math.max(...r.hang.map(h => h.th)) + .07;
  }
  return rungs;
}
/* The deck outline (plan, CCW from the back-left), front corners chamfered */
export function deckOutline(F){
  const { x0, x1, z0, z1 } = F.deck, c = .9, b = .35;
  return [[x0 + b, z0], [x1 - b, z0], [x1, z0 + b], [x1, z1 - c], [x1 - c, z1], [x0 + c, z1], [x0, z1 - c], [x0, z0 + b]];
}

/* ---- THE CYMBALS (pure). A cymbal is not a membrane: it hangs on a boom, its ball
   dribbles onto a ZONE of it (crash = the EDGE, ride = the BOW, ride bell = the BELL —
   the same ride cymbal, its own ball), and after each hit the cymbal SWINGS about its
   pivot (the rod tip inside the bell) as a damped pendulum — a pure fn of the time since
   the hit. Under the bell rides the CLAMP: an electromagnet ring with a felt lip that
   rises into the bell mouth. It (a) levels the cymbal just before every strike, so every
   ball lands on a cymbal at rest, exactly where the dribble solve says it is; (b) parks
   it once its natural swing has died; (c) CHOKES it when the song says (a hit's `choke`,
   drumkit normalizeHit) — the swing stops and the sound is cut. ---- */
/* which cymbal each lane strikes, where (rho = fraction of the radius) and from which
   bearing (rad round the centre, 0 = +z toward the audience: the strike faces the house) */
export const CYMBALS = {
  crash:    { on: 'crash',  rho: .82, dir: 0 },
  ride:     { on: 'ride',   rho: .60, dir: 0 },
  rideBell: { on: 'ride',   rho: .12, dir: Math.PI },
  china:    { on: 'china',  rho: .78, dir: 0 },
  splash:   { on: 'splash', rho: .74, dir: 0 },
};
/* the lathe profile (moved here from drumlook: pure numbers): bell dome, bow, thinning
   edge. top(rr) = the top surface's height below the bell top (<= 0); th(rr) = thickness. */
export function cymbalProfile(R){
  const rb = .21 * R, bellH = .085 * R + .015, bow = .1 * R;
  const top = rr => rr <= rb ? -bellH * (1 - Math.sqrt(Math.max(0, 1 - (rr / rb) ** 2)))
                             : -bellH - bow * ((rr - rb) / (R - rb) * .75 + .25 * ((rr - rb) / (R - rb)) ** 2);
  const th = rr => .03 - .018 * Math.max(0, (rr - rb) / (R - rb));
  return { rb, bellH, bow, top, th, under: bellH + .03 };
}
/* the cymbal's TOP surface at radius rr, relative to its bell-top reference (styleOf.lift).
   An inverted china is the profile flipped: a bowl whose bell points down, edge up. */
export function cymbalSurface(on, rr){
  const st = styleOf(on), P = cymbalProfile(st.r);
  return st.inverted ? P.th(rr) - P.top(rr) : P.top(rr);
}
/* its UNDERSIDE at rr (where the clamp's felt lip meets it) */
export function cymbalUnder(on, rr){
  const st = styleOf(on), P = cymbalProfile(st.r);
  return st.inverted ? -P.top(rr) : P.top(rr) - P.th(rr);
}
/* the swing pivot: the rod tip, touching the inside of the bell at the centre */
export const cymbalPivot = on => cymbalUnder(on, 0);

/* the swing + clamp knobs. Peak swing (rad) at full impact on the edge (it scales with how
   far out the strike is — a bell hit barely rocks it); the pendulum's frequency drops with
   size (f ~ 1/sqrt(r) — a big crash sways slowly, a splash shivers) and its swing decays over tau. */
export const SWING = {
  amp: { crash: .24, ride: .15, china: .22, splash: .2 },
  f: r => 2.2 / Math.sqrt(r),             // Hz
  tau: r => .55 + .45 * r,                // s
  w2: 1.37, a2: .3,                       // the cross-axis wobble (precession) — ratio + share
};
export const CLAMP = { gap: .08, lip: .9, W: .16, frac: .4, lift: .06, park: .04, choke: .05 };
export const clampLip = on => CLAMP.lip * cymbalProfile(styleOf(on).r).rb;   // the felt lip's radius

const ss = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
/* the clamp's engagement (0 = open, 1 = gripping) `s` after a strike, `gap` before the next:
   it lets go as the strike lands (the ball meets a FREE cymbal), re-grips to level it before
   the next, parks it once the swing has died, and grips at once on a choke */
export function clampAt(s, gap, tau, choke = Infinity){
  const lift = Math.min(CLAMP.lift, gap * .2);
  const W = Math.min(CLAMP.W, gap * CLAMP.frac);
  const kr = 1 - ss(s / lift);
  const kp = ss((s - (gap - W)) / (.75 * W));
  const kd = ss((s - tau * Math.log(1 / CLAMP.park)) / .15);
  const kc = choke < gap ? ss((s - choke) / CLAMP.choke) : 0;
  return Math.max(kr, kp, kd, kc);
}

/* One cymbal's swing schedule: the MERGED strikes of every lane that strikes it (the ride
   + its bell), each with its impulse (amp), bearing and choke. members: [{L, meta, rho, dir,
   vInMax}] — meta = pieceLane(). */
export function cymbalSchedule(on, members, P, { dtMax = DT_MAX } = {}){
  const R = styleOf(on).r, wrap = t => ((t % P) + P) % P;
  const all = [];
  for (const m of members) m.L.s.forEach((s, j) => all.push({ s, A: (SWING.amp[on] ?? .15) * (m.rho / R)
      * Math.min(1, m.L.vIn[j] / (m.vInMax || 1)) * (.5 + .5 * m.meta.vel[j]), dir: m.dir, choke: m.meta.choke?.[j] ?? Infinity }));
  const Lm = dribbleLane(all.map(h => h.s), P, { dtMax });
  const by = new Map();
  for (const h of all){ const k = wrap(h.s); (by.get(k) || by.set(k, []).get(k)).push(h); }
  const amp = [], dir = [], choke = [];
  Lm.s.forEach((s, j) => {
    const at = by.get(s), top = at.reduce((a, b) => (b.A > a.A ? b : a));
    amp.push(Math.min(SWING.amp[on] ?? .15, at.reduce((a, b) => a + b.A, 0)));
    dir.push(top.dir);
    const c = Math.min(...at.map(h => h.choke));
    choke.push(c < Lm.gaps[j] ? c : Infinity);
  });
  return { on, Lm, amp, dir, choke, omega: 2 * Math.PI * SWING.f(R), tau: SWING.tau(R) };
}
/* The cymbal's pose at songTime t: tilt (rx, rz — THREE's x/z rotations of the swing group
   about the pivot; the strike side dips) and the clamp's engagement k. Armed count-in:
   clamped level, waiting. Pure fn of t (O(log n) via dribbleAt). */
export function cymbalPose(C, t, start = -Infinity){
  const d = dribbleAt(C.Lm, t, start);
  if (d.i < 0) return { rx: 0, rz: 0, k: 1, i: -1, since: Infinity, until: d.until };
  const s = d.since, gap = s + d.until;
  const k = clampAt(s, gap, C.tau, C.choke[d.i]);
  const e = C.amp[d.i] * Math.exp(-s / C.tau) * (1 - k);
  const tu = e * Math.sin(C.omega * s), tw = SWING.a2 * e * Math.sin(SWING.w2 * C.omega * s);
  const dx = Math.sin(C.dir[d.i]), dz = Math.cos(C.dir[d.i]);
  // rotation.x > 0 lowers +z, rotation.z > 0 raises +x: dip the strike bearing by tu, its perpendicular by tw
  return { rx: tu * dz - tw * dx, rz: -tu * dx - tw * dz, k, i: d.i, since: s, until: d.until };
}

/* The cymbal's PISTON when more than one ball strikes it: each lane's own dribblePiston (at
   rest at its own contacts), each QUIETED to exactly zero — position and velocity — at every
   OTHER lane's contact, so whichever ball lands, it lands on a cymbal at rest where the solve
   says. One lane: just its piston. members: [{L}]. */
export const QUIET = .06;
export function cymbalPiston(members, t, start = -Infinity){
  if (members.length === 1) return dribblePiston(members[0].L, t, { start });
  let y = 0;
  for (const m of members){
    let v = dribblePiston(m.L, t, { start });
    if (!v) continue;
    for (const o of members){
      if (o === m) continue;
      const d = dribbleAt(o.L, t, start), x = Math.min(d.since, d.until);
      if (x < QUIET){ const u = x / QUIET; v *= 1 - (1 - u * u) ** 2; }
    }
    y += v;
  }
  return y;
}

/* ---- the HI-HAT LINKAGE, the way a real one works: the pedal PRESSED (toe down) =
   CLOSED, released (toe up) = OPEN. The struck TOP cymbal rides the piston (contact
   stays honest), so the BOTTOM one is the mover: its pull-tube runs down the stand to a
   ROCKER at the foot — toe down pulls the rocker's front end down, its back end lifts
   the tube, the pair closes. An extension SPRING from the rocker's front end to a hook
   on the stand returns it: stretched while the pedal is held, relaxed (open) at rest.
   `drop` = how far the tube end sits below its closed height (clutch·OPEN − piston).
   Kit-local offsets from the hat's (x, z), y above the deck. ---- */
const LINK = 2 * HAT.q.y - HAT.endY - .13;               // toe-link length: closed (pressed) pedal toe sits at y .13
export function hatLinkage(drop){
  const { q, arm, pedalL, heelZ, hook } = HAT;
  const yEnd = HAT.endY - drop;
  const sa = Math.max(-1, Math.min(1, (yEnd - q.y) / arm)), ca = Math.sqrt(1 - sa * sa);
  const end = { z: q.z - arm * ca, y: yEnd };              // the tube end (a slotted pin: z drifts a hair)
  const toe = { z: q.z + arm * ca, y: q.y - arm * sa };    // the rocker's front end
  const py = toe.y - LINK;                                  // the pedal toe, hung on a rigid link
  const pedalAng = Math.asin(Math.max(-1, Math.min(1, (py - .1) / pedalL)));
  const pedalToe = { z: heelZ - pedalL * Math.cos(pedalAng), y: py };
  return { alpha: Math.asin(sa), end, toe, pedalToe, pedalAng, spring: hook - toe.y };
}

/* A piece's dribble lane + per-strike metadata (vel, audio lane, open flag). */
export function pieceLane(piece, spec, { rollT, beat, P, dtMax }){
  const hits = [];
  for (const lane of piece.lanes) for (const h of spec[lane].map(normalizeHit))
    hits.push({ t: rollT + h.beat * beat, vel: h.vel, lane, choke: h.choke ? h.choke * beat : Infinity });
  const L = dribbleLane(hits.map(h => h.t), P, { dtMax });
  const wrap = t => ((t % P) + P) % P;                  // the same wrap dribbleLane keys its strikes by
  const byS = new Map();
  for (const h of hits){ const k = wrap(h.t); (byS.get(k) || byS.set(k, []).get(k)).push(h); }
  const vel = [], lane = [], open = [], choke = [];
  L.s.forEach((s, j) => {
    const at = byS.get(s);
    const o = at.some(h => h.lane === 'hatOpen');
    open.push(o);
    lane.push(piece.key === 'hat' ? (o ? 'hatOpen' : 'hat') : piece.lanes[0]);
    vel.push(Math.max(...at.map(h => h.vel)));
    const c = Math.min(...at.map(h => h.choke));      // (seconds after the strike; a choke past the next strike never happens)
    choke.push(c < L.gaps[j] ? c : Infinity);
  });
  return { L, vel, lane, open, choke };
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
