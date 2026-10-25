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
   reaches up to deck + stand, OPEN, so what hangs stays visible. The KIT stands on its deck slab's
   underside (marbledrums KIT_STAND) in every song: its pistons stroke briefly below it — not hanging,
   dipping INTO its base — so its pad is solid and at least that deep there (its WELL: the plinth's
   .4 swallows a stroke's ≤ .33).

   The supports change with height (h = support height above the floor), styled by each room:
     flush  h ≤ BANDS.flush   a plinth / base slab (every grounded machine)
     low    h ≤ BANDS.low     a riser / dais with steps
     mid    h ≤ BANDS.mid     a platform on legs / columns, braced, with a stair or ladder
     high   above             a scaffold / truss tower: bracing, a caged ladder, landings, rails
   Neighbours at about the same height (|Δtop| ≤ LOFT_DY, footprints within LOFT_GAP) above the
   flush band share ONE loft — the rear gallery becomes architecture, not N towers.
   1 u ≈ 0.677 m (xrplan U_PER_M).

   planFooting(anchors, { floor, room }) → { floor, pads, lofts, pulses }   (the room host's anchors:
   rooms/index.js) — every machine's pad, the lofts, and per pad's `pulse` slot its strike cue (the
   reactive edge: rooms/pulse.js). All in WORLD units; a rect is a centre (x, z), half extents
   (hw, hd) along its own axes and a yaw (three's rotation.y: local +u → world (cos, −sin), local +v →
   world (sin, cos)).
     pad  { key, kind, x, z, yaw, hw, hd, top, h, band, open, well, loft, color, pulse, fixed, lift,
            access, feet, hang }   top = the world y it holds the machine at (its bottom); h = top − floor;
            open: a `stand` machine (its anchor sends FEET / HANG) with something hanging below what
            it stands on (low < bottom) — posts under its FEET ([u, v, r] in the anchor's frame; none
            known: its corners), every beam kept out of HANG ([u0, u1, v0, v1]) — down to hangY (the world
            y of the lowest part that hangs: below it a brace may cross); well: how far under
            its top any other machine reaches (top − low: the kit's pistons) — its support is solid at
            least that deep; loft: its loft's id or null; pulse: its slot in `pulses`
     loft { id, keys, x0, x1, z0, z1, x, z, hw, hd, yaw: 0, top, h, band, well, access }   a WORLD
            AABB (axis-aligned: a turned member's footprint is bounded); top = its lowest member's —
            a higher member stands on a shim; well: its deepest member's, under the loft's deck top
     access { kind: 'stair' | 'ladder', side: '+u'|'-u'|'+v'|'-v', a0, a1 (along the side), out,
              n, rise, tread (stair) | flights, cage (ladder) }   on the face at u = ±hw / v = ±hd;
            a ±u side runs along v, a ±v side along u. Placed on the first side (outer, then front
            for a stair; outer, then back for a ladder) whose envelope is clear of every other
            machine, pad, loft, access and the room's walls — or none at all.
   footingBoxes(plan) → [{ unit, keys, kind, band, box: [x0, x1, y0, y1, z0, z1] }] — the world
   ENVELOPE of every support (pad column, loft, stair / ladder, up to its rails; unit = its pad's key
   or its loft's id): what a room's style must stay inside, what the shot solve keeps an eye out of,
   and what the staging test treats as solid.
   ============================================================ */

export const FOOT = {
  PLINTH: .4,                                   // the base every grounded machine stands on (≈ 27 cm)
  STEP: .28,                                    // a stair step's greatest rise (≈ 19 cm)
  BANDS: { flush: .8, low: 3.5, mid: 10 },      // support height above the floor → band (above mid: high)
  LOFT_DY: .6,                                  // neighbours whose decks are within this…
  LOFT_GAP: 3,                                  // …and whose footprints are within this share one loft
  LIFT_MAX: 24,                                 // the highest a user may raise a machine (≈ 16 m; the gallery is ≈ 19)
  MARGIN: .35,                                  // a pad reaches this far past its machine's footprint (less by a close neighbour)
  CLEAR: .08,                                   // the least air between two pads (or a pad and another machine)
  TREAD: .42,                                   // a stair's going (≈ 28 cm)
  STAIR_W: 1.1,                                 // a stair's width (≈ 75 cm): it hugs the pad's side, landing at the top
  STAIR_MAX: 6.5,                               // a platform higher than this is climbed by ladder (its stair would run ≈ 10 u)
  CLIMB: 1,                                     // an OPEN stand lifted more than this gets a ladder (at its own height its
                                                // posts are the machine's legs: nobody climbs them)
  LADDER_W: 1.4,                                // a ladder's envelope along the face it climbs (stiles + cage)…
  LADDER_D: 1.2,                                // …and out from it
  CAGE: 5,                                      // a ladder climbing more than this gets a safety cage (≈ 3.4 m)…
  LAND_DY: 7,                                   // …and a rest landing at least every LAND_DY of climb (≈ 4.7 m)
  RAIL: 1.5,                                    // a guard rail's height over its deck (≈ 1 m)
  KERB: .12,                                    // the belt's base slab: its own posts stand in it
  MAX_PULSE: 32,                                // the reactive edge's uniform slots (machines per song)
};

/** the support band for a support height h above the floor */
export const bandOf = h => h <= FOOT.BANDS.flush ? 'flush' : h <= FOOT.BANDS.low ? 'low' : h <= FOOT.BANDS.mid ? 'mid' : 'high';

/** the deck y at which a machine whose lowest solid part is `low` (its local y) sits on the floor's plinth */
export const groundOf = (low, floor) => floor + FOOT.PLINTH - low;

/** a user's lift, made safe: finite, 0 … LIFT_MAX (anything else is 0 — on the floor) */
export const clampLift = u => Number.isFinite(u) ? Math.max(0, Math.min(FOOT.LIFT_MAX, u)) : 0;

/** does a support of this band carry guard rails round its deck? (a dais is a step up; a platform is a drop) */
export const railed = band => band === 'mid' || band === 'high';

/* ---- turned rects (x, z centre · hw, hd half extents · yaw) ---- */
/** local (u, v) of a rect → world [x, z] */
export function toWorld(r, u, v){
  const c = Math.cos(r.yaw || 0), s = Math.sin(r.yaw || 0);
  return [r.x + c * u + s * v, r.z - s * u + c * v];
}
function corners(r, pad = 0){
  const hw = r.hw + pad, hd = r.hd + pad;
  return [toWorld(r, -hw, -hd), toWorld(r, hw, -hd), toWorld(r, hw, hd), toWorld(r, -hw, hd)];
}
/** a rect's world AABB [x0, x1, z0, z1] */
export function rectAabb(r, pad = 0){
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of corners(r, pad)){ x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return [x0, x1, z0, z1];
}
/* do two turned rects come within `gap` of each other? (separating axes on the grown rects) */
function overlap(A, B, gap = 0){
  const pa = corners(A, gap / 2), pb = corners(B, gap / 2);
  for (const P of [pa, pb]) for (let i = 0; i < 2; i++){
    const ax = P[i + 1][0] - P[i][0], az = P[i + 1][1] - P[i][1];
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const q of pa){ const d = q[0] * ax + q[1] * az; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const q of pb){ const d = q[0] * ax + q[1] * az; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}
/* the air between two rects' world AABBs (≤ the true gap: a margin clipped by it never closes it) */
function gapOf(A, B){
  const a = rectAabb(A), b = rectAabb(B);
  const dx = Math.max(0, b[0] - a[1], a[0] - b[1]), dz = Math.max(0, b[2] - a[3], a[2] - b[3]);
  return Math.hypot(dx, dz);
}

/** a side's outward world normal [x, z] */
export function sideNormal(r, side){
  const c = Math.cos(r.yaw || 0), s = Math.sin(r.yaw || 0), k = side[0] === '+' ? 1 : -1;
  return side[1] === 'u' ? [k * c, -k * s] : [k * s, k * c];
}
/** an access's envelope as a rect (in its pad's / loft's frame, turned with it) */
export function accessRect(P, acc){
  const am = (acc.a0 + acc.a1) / 2, ah = (acc.a1 - acc.a0) / 2, oh = acc.out / 2, k = acc.side[0] === '+' ? 1 : -1;
  const [u, v, hu, hv] = acc.side[1] === 'u' ? [k * (P.hw + oh), am, oh, ah] : [am, k * (P.hd + oh), ah, oh];
  const [x, z] = toWorld(P, u, v);
  return { x, z, hw: hu, hd: hv, yaw: P.yaw || 0 };
}

const SIDES = ['+u', '-u', '+v', '-v'];
const rectOf = a => ({ x: a.x, z: a.z, hw: a.w / 2, hd: a.d / 2, yaw: a.yaw || 0 });

export function planFooting(anchors = [], { floor = -5.5, room = null } = {}){
  const list = (anchors || []).filter(a => a && Number.isFinite(a.x) && Number.isFinite(a.z) && a.w > 0 && a.d > 0);
  const rects = new Map(list.map(a => [a, rectOf(a)]));
  const yOf = a => Array.isArray(a.box) ? [a.box[2], a.box[3]] : [floor, Infinity];   // what an obstacle occupies in y
  const pads = [], lofts = [], pulses = [];

  // 1. A PAD per standing machine (the hung ones float over everyone: obstacles only): its footprint
  //    + a margin, clipped so it never meets another machine's footprint or that one's pad
  for (const a of list){
    if (a.kind === 'hung') continue;
    const r = rects.get(a);
    let m = FOOT.MARGIN;
    for (const b of list) if (b !== a) m = Math.min(m, (gapOf(r, rects.get(b)) - FOOT.CLEAR) / 2);
    m = Math.max(0, m);
    const top = a.kind === 'belt' ? floor : Number.isFinite(a.bottom) ? a.bottom : Number.isFinite(a.y) ? a.y : floor;
    const h = Math.max(0, top - floor);
    // what reaches below what it stands on: a `stand` machine's hanging parts must stay SEEN (open: a
    // solid pad would swallow them); anything else only dips into its base — the pad hides it (well)
    const below = !a.fixed && Number.isFinite(a.low) ? Math.max(0, top - a.low) : 0;
    const open = below > .05 && (Array.isArray(a.feet) || Array.isArray(a.hang));
    const i = pads.length;
    pads.push({ key: a.key, kind: a.kind, x: r.x, z: r.z, yaw: r.yaw, hw: r.hw + m, hd: r.hd + m, top, h, band: bandOf(h),
      open, well: open ? 0 : below, loft: null, color: a.color ?? null, pulse: Math.min(i, FOOT.MAX_PULSE - 1), fixed: !!a.fixed, lift: a.lift ?? 0,
      access: null, feet: open && Array.isArray(a.feet) && a.feet.length ? a.feet : null, hang: open ? (a.hang ?? null) : null,
      hangY: open ? a.low : null, _a: a });
    if (i < FOOT.MAX_PULSE) pulses.push({ key: a.key, cue: Array.isArray(a.cue) ? a.cue : [], P: a.P, start: a.start });
  }

  // 2. LOFTS: raised neighbours at one height share a deck (union-find, in a stable order)
  const cand = pads.filter(p => p.band !== 'flush' && !p.open && !p.fixed).sort((p, q) => p.key < q.key ? -1 : p.key > q.key ? 1 : 0);
  const par = cand.map((_, i) => i), find = i => par[i] === i ? i : (par[i] = find(par[i]));
  for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++)
    if (Math.abs(cand[i].top - cand[j].top) <= FOOT.LOFT_DY && gapOf(cand[i], cand[j]) <= FOOT.LOFT_GAP) par[find(j)] = find(i);
  const groups = new Map();
  cand.forEach((p, i) => { const g = find(i); groups.has(g) ? groups.get(g).push(p) : groups.set(g, [p]); });
  for (let g of groups.values()){
    while (g.length > 1){
      const L = loftOf(g, floor);
      // the deck + its structure stand from the floor up: nothing else may stand under or through it
      const blocked = list.some(a => !g.some(p => p._a === a) && yHit(yOf(a), [floor, L.top + FOOT.RAIL]) && overlap(L, rects.get(a), FOOT.CLEAR))
                   || pads.some(p => !g.includes(p) && overlap(L, p, FOOT.CLEAR));
      if (!blocked){ lofts.push(L); g.forEach(p => { p.loft = L.id; }); break; }
      // …else the member farthest from the group's middle stands alone, and the rest try again
      const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
      g = g.slice().sort((p, q) => Math.hypot(q.x - cx, q.z - cz) - Math.hypot(p.x - cx, p.z - cz) || (p.key < q.key ? -1 : 1)).slice(1);
    }
  }
  lofts.sort((A, B) => A.id < B.id ? -1 : 1);

  // 3. ACCESS: every raised support gets a stair or a ladder on a free side (an open stand: a ladder,
  //    once the user has lifted it off its own legs)
  const beltX = list.find(a => a.kind === 'belt')?.x ?? 0;
  const placed = [];
  const units = [...pads.filter(p => !p.loft && !p.fixed && p.band !== 'flush' && (!p.open || p.lift > FOOT.CLIMB)), ...lofts];
  for (const P of units){
    const own = P.keys ? pads.filter(p => p.loft === P.id) : [P];
    const clear = R => {
      if (room){ const [x0, x1, z0, z1] = rectAabb(R); if (x0 < room.x0 || x1 > room.x1 || z0 < room.z0 || z1 > room.z1) return false; }
      const ys = [floor, P.top + FOOT.RAIL];
      if (list.some(a => !own.some(p => p._a === a) && yHit(yOf(a), ys) && overlap(R, rects.get(a), FOOT.CLEAR))) return false;
      if (pads.some(p => !own.includes(p) && !(p.loft && p.loft === P.id) && overlap(R, p, FOOT.CLEAR))) return false;
      if (lofts.some(L => L !== P && overlap(R, L, FOOT.CLEAR))) return false;
      return !placed.some(Q => overlap(R, Q, FOOT.CLEAR));
    };
    const outer = Math.sign(P.x - beltX) || -1;
    const kinds = !P.open && (P.band === 'low' || (P.band === 'mid' && P.h <= FOOT.STAIR_MAX)) ? ['stair', 'ladder'] : ['ladder'];
    for (const kind of kinds){
      const pref = s => { const [nx, nz] = sideNormal(P, s); return nx * outer + (kind === 'stair' ? .7 : -.5) * nz; };
      const order = SIDES.slice().sort((s, t) => pref(t) - pref(s) || SIDES.indexOf(s) - SIDES.indexOf(t));
      for (const side of order){
        const acc = fitAccess(P, side, kind);
        if (!acc) continue;
        const R = accessRect(P, acc);
        if (clear(R)){ P.access = acc; placed.push(R); break; }
      }
      if (P.access) break;
    }
  }
  for (const p of pads) delete p._a;
  return { floor, pads, lofts, pulses };
}

/* the loft over a group of pads: the WORLD AABB of their footprints, at the lowest one's deck */
function loftOf(g, floor){
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = Infinity;
  for (const p of g){ const b = rectAabb(p); x0 = Math.min(x0, b[0]); x1 = Math.max(x1, b[1]); z0 = Math.min(z0, b[2]); z1 = Math.max(z1, b[3]); top = Math.min(top, p.top); }
  const keys = g.map(p => p.key).sort(), h = Math.max(0, top - floor);
  const well = Math.max(0, ...g.map(p => p.well - (p.top - top)));   // (a member on a shim dips into the shim first)
  return { id: 'loft:' + keys.join('+'), keys, x0, x1, z0, z1, x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, yaw: 0,
           top, h, band: bandOf(h), well, access: null };
}
const yHit = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 1e-6;

/* a stair or a ladder on one side of P, if the side is long enough: a STAIR hugs the side (its run
   along it, its top landing beside the deck at the side's +a end); a LADDER climbs the face (near
   the +a end of a long side, else in the middle), its flights stepping sideways at each landing */
function fitAccess(P, side, kind){
  const L = side[1] === 'u' ? 2 * P.hd : 2 * P.hw;
  if (kind === 'stair'){
    const n = Math.max(2, Math.ceil(P.h / FOOT.STEP - 1e-9)), run = (n - 1) * FOOT.TREAD + FOOT.STAIR_W;
    if (run > L - .1) return null;
    const a1 = L / 2 - .05;
    return { kind, side, a0: a1 - run, a1, out: FOOT.STAIR_W, n, rise: P.h / n, tread: FOOT.TREAD };
  }
  const flights = Math.max(1, Math.ceil(P.h / FOOT.LAND_DY - 1e-9)), span = FOOT.LADDER_W + (flights > 1 ? .9 : 0);
  if (span > L - .1) return null;
  const c = L > span + 2.5 ? L / 2 - span / 2 - .6 : 0;
  return { kind: 'ladder', side, a0: c - span / 2, a1: c + span / 2, out: FOOT.LADDER_D, flights, cage: P.h > FOOT.CAGE };
}

/** every support's world ENVELOPE (see the header) */
export function footingBoxes(plan){
  const out = [], F = plan.floor;
  const env = (r, y1) => { const [x0, x1, z0, z1] = rectAabb(r); return [x0, x1, F, y1, z0, z1]; };
  for (const p of plan.pads){
    const y1 = p.fixed ? Math.max(p.top, F + FOOT.KERB) : p.top + (railed(p.band) && !p.open ? FOOT.RAIL : 0);
    if (!p.loft) out.push({ unit: p.key, keys: [p.key], kind: 'pad', band: p.band, box: env(p, y1) });
    if (p.access) out.push({ unit: p.key, keys: [p.key], kind: 'access', band: p.band, box: env(accessRect(p, p.access), p.top + FOOT.RAIL) });
  }
  for (const L of plan.lofts){
    out.push({ unit: L.id, keys: L.keys, kind: 'loft', band: L.band, box: env(L, Math.max(L.top + (railed(L.band) ? FOOT.RAIL : 0),
      ...plan.pads.filter(p => p.loft === L.id).map(p => p.top))) });
    if (L.access) out.push({ unit: L.id, keys: L.keys, kind: 'access', band: L.band, box: env(accessRect(L, L.access), L.top + FOOT.RAIL) });
  }
  return out;
}
