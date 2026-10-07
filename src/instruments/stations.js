/* ============================================================
   STATIONS — where each instrument stands in the room (PLAN-staging
   "Placement"): an origin + a yaw + a footprint, applied at RENDER
   TIME ONLY. Gravity is vertical, so translating an instrument or
   spinning it about +y is a rigid move of an already-solved world —
   the physics never knows. (Never alter a solve to place something.)

   Each instrument builds in its OWN local frame:
       +x  across the instrument (its "keyboard" axis, low → high)
       +y  up (gravity is −y, |G| = 14.5)
       +z  toward the audience / camera
       y=0 is the station's DECK TOP — stand on it, or grow legs from it
           down to `floorY` (the room floor, world y) if you're tall
   and must stay inside its footprint: |x| ≤ w/2, |z| ≤ d/2 (height is
   free). main.js wraps the instrument's group in a station group placed
   here, so instruments never hardcode world positions (the drums'
   KIT_X/KIT_Z lesson) and never collide.

   Layout: a tiered AMPHITHEATER opening toward the camera (+z), the
   melody PATERNOSTER at the centre-back (x≈0, z≈0; x is RELATIVE to the
   belt wall's centre). Each wing steps down in height as it comes
   forward, so from the wide stage shot every station reads over the one
   in front of it:
       left wing                       right wing
       back   marimba  (riser, gantry)  bells    (tall gantry)
       mid    string bass               music box (lid to the wing wall)
       front  singing bowls (low)       marble drums (KIT_ROOM in
                                          marbledrums.js — not a plugin)
       centre, front, low: the TURNTABLE (the stage camera looks down
              onto the spinning record, in front of the belt's base)
       centre, HUNG: the RICOCHET chandelier — a crown over the belt,
              its lowest plate clear above the paternoster's top housing,
              so the wide shot reads it ABOVE the strike band, never across it.
       left wing, HUNG: the VOLLEY court — two walls trading one marble, flown
              over the marimba / bass tier, its strike plane yawed to face the
              audience's eye (AUDIENCE dx −6, z 40). It rides out with the left
              wing like the floor tiers (hangPlace); where a wide belt leaves the
              wing no room, it flies BEHIND the left bays instead, above their
              housing (flown forward it would cover the bays from the audience).
   yaw turns each station toward the middle of the room; the director's
   station shots look straight down each station's own +z, so a yaw is
   also its camera angle.

   The slots below are tuned for a ONE-bay belt (≈ ±12.6 wide) and no
   turntable. A song's room is then SOLVED (layoutStations): the side
   tiers ride out with the belt's real edges (a 2–3-bay paternoster is
   ±17…±28), then each footprint — measured from the BUILT geometry, not
   guessed — is placed in priority order at the NEAREST spot to its slot
   that (a) clears the belt and everyone placed before it, (b) is inside
   the room, (c) is SEEN past the belt from the audience if it stands
   behind it, and (d) if it stands in front of the bays, stays under the
   audience's sightline to the strike band (the belt is the protagonist).
   A floor too crowded for all four (3 bays + every machine) gives up air
   between bounding boxes first, then a little depth. Pure + deterministic:
   one song → one stage, every time.
   ============================================================ */

export const STATIONS = {
  marimba:  { x: -25,  y: 1.5, z: -10.5, yaw:  .75, w: 13, d: 7 },   // back-left wing, on its riser
  bells:    { x:  26,  y: 0.0, z: -10, yaw: -.6,  w: 11, d: 7 },   // back-right wing: the tall gantry
  bass:     { x: -20,  y: 0.0, z:  3.6, yaw: 1.15, w: 12, d: 8 },   // mid-left, turned to look across the room (its shot clears the marimba)
  bowls:    { x: -13,  y: -.5, z: 18,  yaw:  .8,  w: 10, d: 9 },   // front-left, low
  musicbox: { x:  25,  y: -.5, z:  3.2, yaw: -.9,  w: 10, d: 9 },   // mid-right, behind the drums, turned to the middle
  horns:    { x:  28.5, y: 0.0, z: 26.5, yaw: 0, w: 14, d: 6 },  // front-right corner, beside the drums: the brass rank faces the audience
  turntable: { x:  0,  y: -1.0, z: 12.5, yaw: 0, w: 14, d: 14 },  // front-centre, low: the stage camera looks down onto the spinning record
  strum:    { x: -29,  y: 0.0, z: 21,  yaw:  .6,  w: 12, d: 6 },   // front-left corner, outside the bowls: the leaning harp turned to the middle
  // a CHANDELIER hung over the belt: x/z follow the belt wall's centre, y its top (see HANG)
  ricochet: { x:   0,  y: 16,  z:  0,  yaw:  0,   w: 16, d: 16, hang: true },
  // a flying COURT hung over the LEFT WING (x is relative to the belt centre and RIDES OUT with
  // the wing — hangPlace), yawed toward the audience's eye. y is ignored (main hangs every hung
  // station HANG_CLEAR above the belt's top housing). Footprint: the deck is ~19.5 wide and
  // 2·(ZW + 1.3) deep — ZW grows with belt speed (≤ ~7 for the densest honest line) → d 16
  volley:   { x: -24,  y: 16,  z: -4,   yaw: .45, w: 20, d: 16, hang: true },
  // the RIFF FORGE takes the lip of the stage like a lead guitarist: front-centre, low, its
  // 4×12 cab behind the neck (the wide shot reads it under the band's sightline)
  riff:     { x:  2,   y: -1.0, z: 26,  yaw: 0,   w: 13, d: 6 },
  // the ORGAN LOFT: a gallery flown centred BEHIND the belt (x on the belt's axis, z behind its
  // depth — clear of the chandelier's crown), above the housing like every hung station: the
  // pipe façade reads over the paternoster as the room's backdrop, its light rising into the air
  organ:    { x:   0,  y: 16,  z: -12.5, yaw: 0,  w: 20, d: 6, hang: true },
};

/* the drum machine is not a plugin, but it stands in the same amphitheater: its slot
   is KIT_ROOM (marbledrums.js); here it only needs a priority for the solve */
const PRIO = { turntable: 90, bells: 80, marimba: 80, bass: 70, musicbox: 70, drums: 60, bowls: 60 };
export const MARGIN = 1.4;          // clear air between any two footprints (and the belt wall)
export const WING_REF = 12.6;       // the belt half-width the slots above were tuned for
export const HANG_CROWN = 8;        // the centred chandelier's crown half-width: an off-centre hung station keeps clear of it
export const HANG_CLEAR = 1.8;      // a hung station's LOWEST part (plate, stem, knot) clears the belt's top housing by this
/* the audience's eye (world x offset from the belt centre, z): the wide shot looks from the
   front, a little left of centre. A BACK-tier station (behind the belt's front face) must be
   SEEN past the belt from here — its centre's sightline must clear the wall's edge — or it is
   brought forward to stand in front of the belt's depth (a 3-bay belt leaves no room beside it). */
export const AUDIENCE = { dx: -6, z: 40 };
const FORE_GRAZE = 3;               // a station may overlap the belt's outer edge (in x) this much before it counts as in front of it

/** Where a HUNG station flies this song (world x/z; main measures `box` — its footprint relative
    to its origin, rotated — from the built geometry). A centred one (|slot.x| ≤ 4: the chandelier)
    stays on the belt's axis. An off-centre one RIDES OUT with its wing exactly like the floor
    tiers (its gap to the wall's edge kept), stays inside the room, and — when the wing has no
    room left beside a wide belt (its footprint would hang over the bays: the court read as
    stacked on the belt) — flies BEHIND them instead (hung above the housing: seen over the belt,
    never across the band — flown forward it would cover the bays from the audience), in toward
    the centre as far as the chandelier's crown allows. Pure. */
export function hangPlace(slot, box, wall, room, { cx = (wall[0] + wall[1]) / 2, ref = WING_REF, margin = MARGIN } = {}){
  let x = cx + slot.x, z = (wall[2] + wall[3]) / 2 + slot.z;
  if (Math.abs(slot.x) <= 4) return { x, z };
  x += slot.x < 0 ? Math.min(0, (wall[0] - cx) + ref) : Math.max(0, (wall[1] - cx) - ref);
  x = Math.max(room.x0 - box[0], Math.min(room.x1 - box[1], x));
  const over = slot.x < 0 ? x + box[1] > wall[0] + FORE_GRAZE : x + box[0] < wall[1] - FORE_GRAZE;   // (a graze over the housing's edge is fine)
  if (over){
    // no room beside the bays: fly it BEHIND them (above the housing — hung — it never covers the
    // band from the audience) and in toward the centre, up to the centred chandelier's crown
    z = Math.max(room.z0 - box[2], Math.min(z, wall[2] - margin - box[3]));
    const inner = HANG_CROWN + margin;
    x = slot.x < 0 ? Math.max(x, cx - inner - box[1]) : Math.min(x, cx + inner - box[0]);
  }
  return { x, z };
}

/* Fallback for an instrument with no named slot: park it out front, in a row. */
export function stationFor(key, i = 0){
  return STATIONS[key] || { x: -10 + 10 * i, y: 0, z: 28, yaw: 0, w: 9, d: 7 };
}

/** SOLVE the room for one song.
    items: [{ key, x, z, box: [x0, x1, z0, z1], pin? }] — WORLD x/z of each floor station's
      origin at its base slot (main: belt centre + slot), and its footprint measured from
      the built geometry RELATIVE to that origin (already rotated by its yaw).
    wall:  [x0, x1, z0, z1] — the belt machines' world XZ box.
    room:  { x0, x1, z0, z1 } — where a footprint may go (inside the walls, behind the camera).
    Returns { key: { x, z } } (world). Never touches y or yaw. */
export function layoutStations(items, wall, room, { margin = MARGIN, ref = WING_REF, cx = (wall[0] + wall[1]) / 2, bandY = 4.2, eyeY = 20 } = {}){
  // a floor too crowded to clear at full margin (a 3-bay belt + every machine) first gives up
  // air between the footprints' bounding boxes (their corners are mostly empty), then a little
  // depth toward the audience — never an overlap while any of those clears
  let last = null;
  for (const [m, dz] of [[margin, 0], [margin * .7, 0], [margin * .45, 0], [margin * .45, 3], [margin * .3, 6]]){
    last = solveOnce(items, wall, { ...room, z1: room.z1 + dz }, m, ref, cx, bandY, eyeY);
    if (last.clean) break;
  }
  return last.out;
}
function solveOnce(items, wall, room, margin, ref, cx, bandY, eyeY){
  const S = items.map(it => ({ ...it, prio: PRIO[it.key] ?? 50 }));
  // 1. the WINGS ride out with the belt: a station beside the wall (not the front row)
  //    keeps its gap to the wall's real edge, so the tiers keep their shape on a wide belt
  for (const s of S){
    if (s.pin) continue;                                  // a station the user PLACED (stage edit) stays put
    const beside = s.z + s.box[2] < wall[3] + 6;          // its back edge reaches the wall's depth band
    if (!beside) continue;
    if (s.x < cx - 4) s.x += Math.min(0, (wall[0] - cx) + ref);
    else if (s.x > cx + 4) s.x += Math.max(0, (wall[1] - cx) - ref);
  }
  const bx = s => [s.x + s.box[0], s.x + s.box[1], s.z + s.box[2], s.z + s.box[3]];
  // LINE OF SIGHT: a footprint whose centre sits behind the wall's front face is visible only
  // if the audience's ray to its centre passes the wall's edge (else the belt bays hide it)
  const ax = cx + AUDIENCE.dx, az = AUDIENCE.z;
  const seen = (b, dx = 0, dz = 0) => {
    const xc = (b[0] + b[1]) / 2 + dx, zc = (b[2] + b[3]) / 2 + dz;
    if (zc >= wall[2]) return true;
    const xs = ax + (xc - ax) * (az - wall[3]) / (az - zc);   // where the sightline crosses the wall's front
    return xs >= wall[1] || xs <= wall[0];
  };
  // the BELT'S FOREGROUND: a station standing in front of the bays must stay under the
  // audience's sightline to the strike band (the paternoster is the protagonist — a tall
  // machine parked in front of it would hide the very thing the song is about)
  const under = (s, b, dx, dz) => {
    // (grazing the bays' outer edge by a few units is fine — it's covering a bay that isn't)
    if (s.top === undefined || b[1] + dx <= wall[0] + FORE_GRAZE || b[0] + dx >= wall[1] - FORE_GRAZE || b[3] + dz <= wall[3]) return true;
    const zp = (wall[2] + wall[3]) / 2, z = Math.max(b[2] + dz, zp);    // the pads strike mid-depth of the bays
    return s.top <= bandY + (eyeY - bandY) * (z - zp) / (az - zp);
  };
  const fits = (s, dx, dz) => { const b = bx(s);
    return b[0] + dx >= room.x0 - 1e-9 && b[1] + dx <= room.x1 + 1e-9 && b[2] + dz >= room.z0 - 1e-9 && b[3] + dz <= room.z1 + 1e-9
      && seen(b, dx, dz) && under(s, b, dx, dz); };
  // keep everything inside the room first (slide in along x, then z)
  const clampIn = s => { const b = bx(s);
    if (b[1] > room.x1) s.x -= b[1] - room.x1; if (b[0] < room.x0) s.x += room.x0 - b[0];
    if (b[3] > room.z1) s.z -= b[3] - room.z1; if (b[2] < room.z0) s.z += room.z0 - b[2]; };
  // 2. PLACE in priority order: each footprint keeps its slot if it is clear of the belt and of
  //    everyone already placed (by `margin`), inside the room and SEEN past the belt — else it
  //    takes the NEAREST spot that is (a grid search outward from its slot: the smallest move;
  //    on a crowded 3-bay floor a back-tier wing steps forward of the belt rather than hide).
  const placed = [wall];
  // (user-PINNED stations — stage edit — are placed first, exactly where the user put them;
  //  the auto-placed rest step around them)
  const order = [...S].sort((a, b) => !!b.pin - !!a.pin || b.prio - a.prio || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const offs = searchGrid();
  let clean = true;
  for (const s of order){
    if (s.pin){ placed.push(bx(s)); continue; }
    clampIn(s);
    const b = bx(s);
    const hits = (dx, dz) => { let n = 0; for (const o of placed)
      if (b[0] + dx < o[1] + margin && o[0] < b[1] + dx + margin && b[2] + dz < o[3] + margin && o[2] < b[3] + dz + margin) n++; return n; };
    let best = null, bestHits = Infinity;
    for (const [dx, dz] of offs){
      if (!fits(s, dx, dz)) continue;
      const n = hits(dx, dz);
      if (n === 0){ best = [dx, dz]; break; }
      if (n < bestHits){ bestHits = n; best = [dx, dz]; }        // (a floor too full to clear: least-bad)
    }
    if (best){ s.x += best[0]; s.z += best[1]; }
    if (bestHits < Infinity && !(best && hits(best[0], best[1]) === 0)) clean = false;
    placed.push(bx(s));
  }
  return { clean, out: Object.fromEntries(S.map(s => [s.key, { x: s.x, z: s.z }])) };
}
/* every (dx, dz) offset on a 0.5-unit grid out to 60 units, nearest first (built once) */
let _grid = null;
function searchGrid(){
  if (_grid) return _grid;
  const g = [], R = 60, st = .5;
  for (let i = -R / st; i <= R / st; i++) for (let k = -R / st; k <= R / st; k++){
    const dx = i * st, dz = k * st, d = Math.hypot(dx, dz);
    if (d <= R) g.push([dx, dz, d]);
  }
  g.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  return (_grid = g.map(([dx, dz]) => [dx, dz]));
}
