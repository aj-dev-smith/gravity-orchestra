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
       front corners, low: the hammered DULCIMER (left, outside the bowls)
              and the BOW-WHEEL (right, past the kit) — pulled in from the
              corners so the wide shot holds them whole
       the BAND — the RIFF forge, the leaning STRUM harp, the HORNS, the POGO
              BASS rig — on the FLOOR (FLOOR FIRST, 2026-10-25), each in the first
              free one of its SEATS: the amphitheater's good spots (front and
              centre in front of the belt, front-left, front-right, the wings,
              the corners, beside the belt) — most of them the tier's own slots,
              free whenever that machine sits the song out. A seat the audience
              can't see it in (behind the kit, say) is not free. Their slots
              proper are the rear GALLERY (raised, behind the belt — see
              GALLERY_DROP): the band's riser, seen OVER the paternoster either
              side of the ORGAN loft (centre, HUNG behind the belt: its façade is
              the room's backdrop) — where they climb only when every seat is taken.
       THE STAR (the song's signature — directorplan signatureOf / song.director
              .signature): the front-and-centre floor spot (STAR), whatever its
              own slot — the machine the song is about stands nearest the audience,
              on the centre line, under the sightline to the strike band, and
              nobody else stands in its foreground.
       left wing, HUNG: the VOLLEY court — two walls trading one marble, flown
              over the marimba / bass tier, its strike plane yawed to face the
              audience's eye (AUDIENCE dx −6, z 40). It rides out with the left
              wing like the floor tiers (hangPlace); where a wide belt leaves the
              wing no room, it flies BEHIND the left bays instead, above their
              housing (flown forward it would cover the bays from the audience).
   yaw turns each station toward the middle of the room; the director's
   station shots look straight down each station's own +z, so a yaw is
   also its camera angle. A slot's `y` no longer sets a FLOOR machine's
   height (2026-10-25): main SETS every floor machine IN THE ROOM — on the
   floor's plinth at its measured ground, or lifted by the user / raised
   onto the gallery (rooms/footing.js). A HUNG one hangs off the belt's top.

   The slots below are tuned for a ONE-bay belt (≈ ±12.6 wide) and no
   turntable. A song's room is then SOLVED (layoutStations): the side
   tiers ride out with the belt's real edges (a 2–3-bay paternoster is
   ±17…±28), then each footprint — measured from the BUILT geometry, not
   guessed — is placed in priority order at the NEAREST spot to its slot
   that (a) clears the belt and everyone placed before it, (b) is inside
   the room, (c) is SEEN past the belt from the audience if it stands
   behind it, (d) if it stands in front of the bays, stays under the
   audience's sightline to the strike band (the belt is the protagonist),
   and (e) stays out of the STAR's foreground. FLOOR FIRST (AJ, 2026-10-25:
   "not everything needs to be on scaffolding in the air — you could just
   set things in the world"): every station — a gallery-born one from its
   floor home — takes a clean floor spot while one exists, giving up air
   between bounding boxes first (margin 1 → .7 → .45). Only a floor that is
   genuinely FULL opens the rear GALLERY (the fewest machines up: a station
   the belt would hide climbs up behind it instead — never a lone machine on
   a tower while the floor has room, a solo never), then, last, borrows a
   little depth. Only the stations a song USES are solved (main builds a
   station only for a part with events), so a sparse song keeps every slot.
   Pure + deterministic: one song → one stage, every time.
   ============================================================ */
import { FOOT } from '../rooms/footing.js';

export const STATIONS = {
  marimba:  { x: -25,  y: 1.5, z: -10.5, yaw:  .75, w: 13, d: 7 },   // back-left wing, on its riser
  bells:    { x:  26,  y: 0.0, z: -10, yaw: -.6,  w: 11, d: 7 },   // back-right wing: the tall gantry
  bass:     { x: -20,  y: 0.0, z:  3.6, yaw: 1.15, w: 12, d: 8 },   // mid-left, turned to look across the room (its shot clears the marimba)
  bowls:    { x: -13,  y: -.5, z: 18,  yaw:  .8,  w: 10, d: 9 },   // front-left, low
  musicbox: { x:  25,  y: -.5, z:  3.2, yaw: -.9,  w: 10, d: 9 },   // mid-right, behind the drums, turned to the middle
  // (a GALLERY slot's `floor`: the floor SEATS it takes, in order, the first free one — FLOOR FIRST: it
  //  climbs to its gallery slot only when every one of them is taken; see SEATS)
  horns:    { x:  15.5, y: 0.0, z: -11, yaw: -.15, w: 14, d: 6, gallery: true, floor: ['wingL', 'left', 'right', 'wingR', 'centre', 'cornerL', 'cornerR', 'backL', 'backR'] },   // GALLERY, right of centre: the brass rank, bells facing the audience (floor: a wing first)
  bowwheel: { x:  28,  y: 0.0, z: 15.5, yaw: 0,    w: 11, d: 10 },   // front-right corner, past the drum kit: the great wheel faces the room (its shot looks in from the side)
  turntable: { x:  0,  y: -1.0, z: 12.5, yaw: 0, w: 14, d: 14 },  // front-centre, low: the stage camera looks down onto the spinning record
  // the REAR GALLERY (see GALLERY_DROP) — the band's RISER behind the paternoster: the leaning
  // harp at the far left (over the marimba), the riff forge's backline beside it, the brass
  // right of the organ loft — each seen OVER the belt, never in front of its band
  // (on the FLOOR: front-left first, the singing bowls' spot)
  strum:    { x: -28.9, y: 0.0, z: -11, yaw:  .2,  w: 12, d: 6, gallery: true, floor: ['left', 'wingL', 'centre', 'right', 'wingR', 'cornerL', 'cornerR', 'backL', 'backR'] },
  dulcimer: { x: -27.5, y: -.5, z: 17, yaw: 0, w: 11.6, d: 10 },  // front-left corner, low: an open grand, keyboard to the audience (beside the bowls)
  // a CHANDELIER hung over the belt: x/z follow the belt wall's centre, y its top (see HANG)
  ricochet: { x:   0,  y: 16,  z:  0,  yaw:  0,   w: 16, d: 16, hang: true },
  // a flying COURT hung over the LEFT WING (x is relative to the belt centre and RIDES OUT with
  // the wing — hangPlace), yawed toward the audience's eye. y is ignored (main hangs every hung
  // station HANG_CLEAR above the belt's top housing). Footprint: the deck is ~19.5 wide and
  // 2·(ZW + 1.3) deep — ZW grows with belt speed (≤ ~7 for the densest honest line) → d 16
  volley:   { x: -24,  y: 16,  z: -4,   yaw: .45, w: 20, d: 16, hang: true },
  // the RIFF FORGE on the GALLERY like a rock band's backline: its 4×12 cab behind the neck,
  // between the harp and the organ loft (the floor's front lip is too close to the wide's lens)
  // (on the FLOOR it is the band's front man: centre, in front of the belt — low, under the band's sightline)
  riff:     { x: -14,  y: 0.0, z: -11, yaw: .1, w: 13, d: 6, gallery: true, floor: ['centre', 'left', 'right', 'wingL', 'wingR', 'cornerL', 'cornerR', 'backL', 'backR'] },
  // the POGO BASS on the GALLERY's right end, beside the brass: the rhythm section's bass rig (its
  // 8×10 behind the neck) — the backline, with the Riff Forge's half-stack on the left
  // (on the FLOOR: the left wing first, the string bass's spot — the two basses rarely share a song)
  pogo:     { x:  29.9, y: 0.0, z: -11, yaw: 0, w: 11, d: 6.4, gallery: true, floor: ['wingL', 'wingR', 'right', 'left', 'cornerR', 'cornerL', 'backL', 'backR', 'centre'] },
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
/* THE FLOOR SEATS — the amphitheater's good floor spots for the BAND (the gallery-born machines: riff,
   strum, horns, pogo), x relative to the belt's centre: most of them are the approved tier's own slots
   (free whenever that machine sits the song out), plus the front-centre spot in front of the belt and
   the front-right one the kit leaves. A gallery-born machine takes the first of ITS seats (STATIONS
   .floor, ranked) that is free: its nearest clean spot (within SEAT_R — the nudge only clears the
   neighbours) is SEEN from the audience, not hidden behind a taller machine nor hiding one (more than
   HIDE_MAX of its silhouette). It climbs onto the gallery only when every seat is taken: the floor is
   then genuinely full (the front lip, in the wide's lens, and the kit's shadow never count as floor). */
export const SEATS = {
  centre: { x: -2, z: 9.5 },        // front and centre, in front of the belt (the turntable's spot when it plays)
  left:   { x: -13, z: 16.5 },      // front-left (the singing bowls')
  right:  { x: 13, z: 16.5 },       // front-right (the kit's, when the song has none)
  wingL:  { x: -20, z: 3.6 },       // the left wing (the string bass's)
  wingR:  { x: 22.5, z: 3.5 },      // the right wing (the music box's)
  backL:  { x: -25, z: -10.5 },     // back-left, beside the belt (the marimba's)
  backR:  { x: 26, z: -10 },        // back-right, beside the belt (the bells')
  cornerL: { x: -27.5, z: 17 },     // the front corners (the grand's, the bow wheel's)
  cornerR: { x: 28, z: 15.5 },
};
export const SEAT_R = 4.5;          // a seat's nudge: how far from it a clean spot still counts as that seat
const BAND = ['riff', 'strum', 'horns', 'pogo'];   // who picks a seat first (after everyone of their priority with a slot of their own)
const HIDE_MAX = .3;                // the share of a machine's silhouette another may hide from the audience…
const HIDE_FOOT = .25;              // …above its FOOT (the lowest quarter of its height: plinth, legs — hiding that is fine)
/* …from any of the wide's EYES (x offset from the belt centre; the solved wides look from x ≈ −15 … +4,
   y ≈ 13–27, z ≈ 36–40 — the lowest eye hides the most) */
const OCC_EYES = [-15, -6, 4], OCC_EYE = 14;

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


/* THE REAR GALLERY — the amphitheater's second, upper tier, behind the belt: a station standing
   there is raised so the audience (and the wide shot, which looks down from the front) sees it OVER
   the paternoster — its deck GALLERY_DROP under the belt's top housing, a lift (rooms/footing.js:
   neighbours at one height share one LOFT; its supports reach the room floor, so its XZ footprint
   is solid to the ground and nothing may share it). FLOOR FIRST (2026-10-25): the gallery is the
   overflow, not a home — every station takes a clean floor spot while one exists at any margin (a
   gallery-born one: a free SEAT); only a floor that is genuinely FULL opens it, and then the pass
   that raises the FEWEST machines wins, then the one that needs the fewest separate structures up
   there (a machine climbs in BESIDE one already up — one loft, not two lone towers). Up there only
   a gallery-born station, or one the belt would hide from the floor; never the STAR. The kit and the
   turntable are floor-only (the kit's contacts are world; the record is meant to be looked DOWN
   onto from the front). Gallery decks keep clear of every HUNG station's footprint (the organ loft,
   the chandelier, the court) — those fly where a gallery would stand. */
export const GALLERY_DROP = 2;
const FLOOR_ONLY = new Set(['drums', 'turntable']);
/* THE STAR — the song's signature machine (main: song.director.signature, else an import's
   directorplan signatureOf) — stands at the most prominent floor spot of the director's wide: in
   front of the belt on its centre line (x relative to the belt's centre), its centre short of the
   wide's front row (main.js stageFrame keeps it WHOLE in frame), nearest the audience the strike
   band's sightline allows (a tall star steps forward until it is under it). It is placed right after
   the user's pins, and nobody placed after it may stand in its FOREGROUND — between it and the
   audience — above the audience's sightline to its BASE: the soloist is seen whole (STAR_GRAZE: the
   edges may overlap). */
export const STAR = { x: 0, z: 10 };
export const STAR_GRAZE = 1.5;

/** SOLVE the room for one song.
    items: [{ key, x, z, box: [x0, x1, z0, z1], top?, deck?, pin? }] — WORLD x/z of each floor
      station's origin at its base slot (main: belt centre + slot; a gallery-born slot: its gallery
      spot — its floor SEATS come from STATIONS[key].floor), and its footprint measured from the built geometry
      RELATIVE to that origin (already rotated by its yaw); top / deck: its world top and deck y.
    wall:  [x0, x1, z0, z1] — the belt machines' world XZ box.
    room:  { x0, x1, z0, z1 } — where a footprint may go (inside the walls, behind the camera).
    opts.wallTop — the belt's top-housing y (the gallery's reference); opts.hung — world XZ
      boxes of this song's HUNG stations (a gallery deck keeps clear of them); opts.star — the
      key of the song's STAR (front and centre; null: none).
    Returns { key: { x, z } } (world) — plus `y` (the deck's world y) for a station raised onto
    the rear GALLERY. Never touches yaw. */
export function layoutStations(items, wall, room, { margin = MARGIN, ref = WING_REF, cx = (wall[0] + wall[1]) / 2, bandY = 4.2, eyeY = 20, wallTop = 15.7, hung = [], star = null } = {}){
  const env = { ref, cx, bandY, eyeY, galleryY: wallTop - GALLERY_DROP, hung, star };
  // FLOOR FIRST: everyone on the floor — at full air, then giving up air between the footprints'
  // bounding boxes (their corners are mostly empty) — never an overlap while one of those clears
  let last = null;
  for (const m of [1, .7, .45]){
    last = solveOnce(items, wall, room, margin * m, { ...env, up: false });
    if (last.clean) return last.out;
  }
  // the floor is FULL: the GALLERY opens — the pass that raises the fewest machines wins, then the one
  // that needs the fewest separate towers up there (one loft, not two lone towers), then the most air
  let pick = null;
  for (const m of [1, .7, .45]){
    const r = solveOnce(items, wall, room, margin * m, { ...env, up: true });
    if (r.clean && (!pick || r.up < pick.up || (r.up === pick.up && r.towers < pick.towers))) pick = r;
  }
  if (pick) return pick.out;
  // …and last, a little depth toward the audience (which the wide shot pays for)
  for (const [m, dz] of [[.45, 3], [.3, 6]]){
    last = solveOnce(items, wall, { ...room, z1: room.z1 + dz }, margin * m, { ...env, up: true });
    if (last.clean) break;
  }
  return last.out;
}
function solveOnce(items, wall, room, margin, { ref, cx, bandY, eyeY, galleryY, hung, up: open, star }){
  // each station's FLOOR origins — the star's front-and-centre spot; a gallery-born slot's SEATS
  // (ranked: the first free one wins); else its slot — and its GALLERY spot (gx, gz: where it was built)
  const S = items.map(it => {
    const slot = STATIONS[it.key], born = !it.pin && !!slot?.gallery && !FLOOR_ONLY.has(it.key);
    const isStar = !it.pin && star != null && it.key === star;
    const homes = isStar ? [{ x: cx + STAR.x, z: STAR.z, star: true }]
      : born && slot.floor?.length ? slot.floor.filter(k => SEATS[k]).map(k => ({ x: cx + SEATS[k].x, z: SEATS[k].z, seat: k }))
      : [{ x: it.x, z: it.z }];
    return { ...it, prio: PRIO[it.key] ?? 50, born, star: isStar, gx: it.x, gz: it.z, homes, x: homes[0].x, z: homes[0].z };
  });
  // 1. the WINGS ride out with the belt: a floor origin beside the wall (not the front row) keeps its
  //    gap to the wall's real edge, so the tiers keep their shape on a wide belt (the star stands on
  //    the belt's centre line; a GALLERY spot stays on its line behind the belt)
  for (const s of S){
    if (s.pin || s.star) continue;                       // (a station the user PLACED — stage edit — stays put)
    for (const h of s.homes){
      if (!(h.z + s.box[2] < wall[3] + 6)) continue;     // (beside: its back edge reaches the wall's depth band)
      if (h.x < cx - 4) h.x += Math.min(0, (wall[0] - cx) + ref);
      else if (h.x > cx + 4) h.x += Math.max(0, (wall[1] - cx) - ref);
    }
    s.x = s.homes[0].x; s.z = s.homes[0].z;
  }
  const bx = (s, x = s.x, z = s.z) => [x + s.box[0], x + s.box[1], z + s.box[2], z + s.box[3]];
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
  // the STAR'S FOREGROUND (once it stands): another station in front of it — its footprint's
  // x-extent, seen from the audience, over the star's — stays under the sightline to the star's base
  let SB = null, sbase = 0;
  const clearStar = (s, b, dx, dz) => {
    if (!SB || s.star) return true;
    const zb = b[2] + dz;
    if (zb <= SB[3]) return true;                         // (beside or behind it: not its foreground)
    const k = (az - SB[3]) / (az - zb), p0 = ax + (b[0] + dx - ax) * k, p1 = ax + (b[1] + dx - ax) * k;
    if (p1 <= SB[0] + STAR_GRAZE || p0 >= SB[1] - STAR_GRAZE) return true;
    return s.top !== undefined && s.top <= sbase + (eyeY - sbase) * (zb - SB[3]) / (az - SB[3]);
  };
  // SEEN, among the machines (a gallery-born one taking a seat): the share of B's silhouette — its
  // width × height, as the audience's eye sees it — that F, standing in front of it, hides
  const hides = (F, B) => {
    const zf = F.b[2], zb = B.b[3];
    if (zf <= zb || F.top === undefined || B.top === undefined) return 0;   // (F isn't in front of B)
    const k = (az - zb) / (az - zf), y = OCC_EYE - (OCC_EYE - F.top) * k;   // (where the sightline over F's top meets B's front)
    const H = Math.max(.5, B.top - B.base), h = Math.min(1, Math.max(0, (y - B.base - HIDE_FOOT * H) / ((1 - HIDE_FOOT) * H)));
    let worst = 0;
    if (h > 0) for (const ex of OCC_EYES){
      const e = cx + ex, p0 = e + (F.b[0] - e) * k, p1 = e + (F.b[1] - e) * k;
      worst = Math.max(worst, (Math.min(p1, B.b[1]) - Math.max(p0, B.b[0])) / (B.b[1] - B.b[0]));
    }
    return worst * h;
  };
  const machines = [];                                  // (placed machines: {b, top, base})
  const hidden = (s, b, dx, dz) => {                    // (the worst share: of it, by anyone placed — or of anyone, by it)
    const me = { b: [b[0] + dx, b[1] + dx, b[2] + dz, b[3] + dz], top: s.top, base: s.base };
    let w = 0; for (const o of machines) w = Math.max(w, hides(o, me), hides(me, o));
    return w;
  };
  const inRoom = (b, dx, dz) => b[0] + dx >= room.x0 - 1e-9 && b[1] + dx <= room.x1 + 1e-9 && b[2] + dz >= room.z0 - 1e-9 && b[3] + dz <= room.z1 + 1e-9;
  const fits = (s, b, dx, dz) => inRoom(b, dx, dz) && seen(b, dx, dz) && under(s, b, dx, dz) && clearStar(s, b, dx, dz);
  // the GALLERY: behind the belt's back face (centre), clear of every hung footprint; a station
  // that isn't gallery-born only climbs up where the belt would hide it from the floor
  //  (a hung footprint casts its SHADOW back to the room's rear wall: a gallery machine behind the
  //   organ's façade or the chandelier would only show the audience the back of what hides it)
  //  (and never squeezed in against the belt's back: the full MARGIN of air behind it)
  const clearHung = (b, dx, dz) => hung.every(h => b[0] + dx >= h[1] + margin || h[0] >= b[1] + dx + margin || b[2] + dz >= h[3] + margin);
  const onGallery = (s, b, dx, dz) => inRoom(b, dx, dz) && (b[2] + b[3]) / 2 + dz < wall[2] && (b[3] + dz <= wall[2] - MARGIN || b[1] + dx <= wall[0] - margin || b[0] + dx >= wall[1] + margin)
    && (s.born || !seen(b, dx, dz)) && clearHung(b, dx, dz);
  //  (one gallery deck = one ROW: two machines up there never stand one behind the other — the
  //   front one would hide the back one — unless the room has no other clean spot left at all)
  const rowFree = (b, dx) => gal.every(g => b[0] + dx >= g[1] + margin || g[0] >= b[1] + dx + margin);
  const gal = [];
  // keep a footprint inside the room first (slide in along x, then z)
  const clampIn = b => { let dx = 0, dz = 0;
    if (b[1] > room.x1) dx = room.x1 - b[1]; if (b[0] + dx < room.x0) dx = room.x0 - b[0];
    if (b[3] > room.z1) dz = room.z1 - b[3]; if (b[2] + dz < room.z0) dz = room.z0 - b[2];
    return [dx, dz]; };
  // 2. PLACE in order — the user's pins, the star, then by priority: each footprint keeps its floor
  //    home if it is clear of the belt and of everyone already placed (by `margin`), inside the room,
  //    SEEN past the belt and out of the star's foreground — else it takes the NEAREST floor spot
  //    that is (a grid search outward from its home: the smallest move; on a crowded 3-bay floor a
  //    back-tier wing steps forward of the belt rather than hide). A gallery-born one takes the first
  //    of its SEATS with a clean, seen spot within SEAT_R. Only when the floor has no clean spot left
  //    (and the gallery is open) does a station climb onto the rear GALLERY (from its gallery spot).
  const placed = [wall];
  //  (at one priority, a station with a slot of its own before the band, which picks its seats in BAND order)
  const band = s => s.born ? 1 + (BAND.includes(s.key) ? BAND.indexOf(s.key) : BAND.length) : 0;
  const order = [...S].sort((a, b) => !!b.pin - !!a.pin || !!b.star - !!a.star || b.prio - a.prio || band(a) - band(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const offs = searchGrid();
  let clean = true, up = 0;
  for (const s of order){
    s.base = s.deck ?? (s.top === undefined ? undefined : s.top - 6);
    if (s.pin){                                         // (a machine the user parked behind the belt stands on the gallery there —
      const b = bx(s);                                  //  a gallery-born one, or one the belt would hide; a user's own height wins: main)
      if (!FLOOR_ONLY.has(s.key) && (b[2] + b[3]) / 2 < wall[2] && (STATIONS[s.key]?.gallery || !seen(b))){ s.y = galleryY; gal.push(b); }
      else machines.push({ b, top: s.top, base: s.base });
      placed.push(b); continue;
    }
    let best = null, bestHits = Infinity;
    // one search: outward from (x0, z0) — nearest first, out to `reach` — for a clean spot `ok` allows
    const search = (x0, z0, ok, reach = Infinity, least = false) => {
      const [cdx, cdz] = clampIn(bx(s, x0, z0)), ox = x0 + cdx, oz = z0 + cdz, b = bx(s, ox, oz);
      for (const [dx, dz, d] of offs){
        if (d > reach) break;
        if (!ok(b, dx, dz)) continue;
        let n = 0; for (const o of placed)
          if (b[0] + dx < o[1] + margin && o[0] < b[1] + dx + margin && b[2] + dz < o[3] + margin && o[2] < b[3] + dz + margin) n++;
        if (n === 0) return [ox + dx, oz + dz];
        if (least && n < bestHits){ bestHits = n; best = [ox + dx, oz + dz]; }   // (a floor too full to clear: least-bad)
      }
      return null;
    };
    const floorOk = (b, dx, dz) => fits(s, b, dx, dz);
    // a SEAT: its nearest clean spot within SEAT_R (the nudge only clears the neighbours) — taken unless
    // the audience can't see it there (or it would hide a neighbour): more than HIDE_MAX hidden
    const seat = (s, h) => {
      const got = search(h.x, h.z, floorOk, SEAT_R);
      return got && hidden(s, bx(s, got[0], got[1]), 0, 0) <= HIDE_MAX ? got : null;
    };
    let got = null, mode = 'floor';
    // the FLOOR: a gallery-born station takes the first of its seats that is free (seen, within SEAT_R);
    // anyone else the nearest clean spot to its home
    if (s.born) for (const h of s.homes){ if ((got = seat(s, h))) break; }
    else got = search(s.x, s.z, floorOk, Infinity, true);
    // the floor is full: the rear GALLERY ('row': a row of its own, else 'stack': behind another) —
    // BESIDE a machine already up there first (one loft, never two lone towers), else from its own spot
    if (!got && open && !FLOOR_ONLY.has(s.key) && !s.star){
      const gOk = (b, dx, dz) => onGallery(s, b, dx, dz), rOk = (b, dx, dz) => gOk(b, dx, dz) && rowFree(b, dx);
      for (const g of gal){
        for (const x of [g[1] + margin - s.box[0], g[0] - margin - s.box[1]])
          if ((got = search(x, (g[2] + g[3]) / 2 - (s.box[2] + s.box[3]) / 2, rOk, 1.5))) break;
        if (got) break;
      }
      if (got || (got = search(s.gx, s.gz, rOk))) mode = 'row';
      else if ((got = search(s.gx, s.gz, gOk))) mode = 'stack';
    }
    if (!got){                                          // no clean spot anywhere: the least-bad floor spot
      mode = 'floor'; clean = false;
      if (s.born) search(s.homes[0].x, s.homes[0].z, floorOk, Infinity, true);
      got = best;
    }
    if (got){ s.x = got[0]; s.z = got[1]; }
    else { const [cdx, cdz] = clampIn(bx(s)); s.x += cdx; s.z += cdz; }
    if (mode !== 'floor'){ s.y = galleryY; gal.push(bx(s)); up++; }
    placed.push(bx(s));
    if (mode === 'floor') machines.push({ b: bx(s), top: s.top, base: s.base });
    if (s.star){ SB = bx(s); sbase = s.base ?? 0; }
  }
  // (how many separate structures the gallery needs: machines within FOOT.LOFT_GAP share one loft — rooms/footing.js)
  const grp = gal.map((_, i) => i), root = i => grp[i] === i ? i : (grp[i] = root(grp[i]));
  for (let i = 0; i < gal.length; i++) for (let j = i + 1; j < gal.length; j++){
    const a = gal[i], b = gal[j];
    if (Math.max(a[0] - b[1], b[0] - a[1], a[2] - b[3], b[2] - a[3]) <= FOOT.LOFT_GAP) grp[root(i)] = root(j);
  }
  const towers = gal.filter((_, i) => root(i) === i).length;
  return { clean, up, towers, out: Object.fromEntries(S.map(s => [s.key, s.y === undefined ? { x: s.x, z: s.z } : { x: s.x, z: s.z, y: s.y }])) };
}
/* every (dx, dz, d) offset on a 0.5-unit grid out to 60 units, nearest first (built once) */
let _grid = null;
function searchGrid(){
  if (_grid) return _grid;
  const g = [], R = 60, st = .5;
  for (let i = -R / st; i <= R / st; i++) for (let k = -R / st; k <= R / st; k++){
    const dx = i * st, dz = k * st, d = Math.hypot(dx, dz);
    if (d <= R) g.push([dx, dz, d]);
  }
  g.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  return (_grid = g);
}
