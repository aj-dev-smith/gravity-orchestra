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
   melody belt at the centre-back (x≈0, z≈0; x is RELATIVE to the belt
   wall's centre). Each wing steps down in height as it comes forward,
   so from the wide stage shot (high, dead centre, z≈40) every station
   reads over the one in front of it:
       left wing                       right wing
       back   marimba  (riser, gantry)  bells    (tall gantry)
       mid    string bass               music box (lid to the wing wall)
       front  singing bowls (low)       marble drums (KIT_ROOM in
                                          marbledrums.js — not a plugin)
   Footprints never overlap each other or the belt wall (|z| ≤ 2.5 for
   x within ±12.6 at its widest). yaw turns each station toward the
   middle of the room; the director's station shots look straight down
   each station's own +z, so a yaw is also its camera angle.
   ============================================================ */

export const STATIONS = {
  marimba:  { x: -25,  y: 1.5, z: -10.5, yaw:  .75, w: 13, d: 7 },   // back-left wing, on its riser
  bells:    { x:  26,  y: 0.0, z: -10, yaw: -.6,  w: 11, d: 7 },   // back-right wing: the tall gantry
  bass:     { x: -20,  y: 0.0, z:  3.6, yaw: 1.15, w: 12, d: 8 },   // mid-left, turned to look across the room (its shot clears the marimba)
  bowls:    { x: -13,  y: -.5, z: 18,  yaw:  .8,  w: 10, d: 9 },   // front-left, low
  musicbox: { x:  25,  y: -.5, z:  3.2, yaw: -.9,  w: 10, d: 9 },   // mid-right, behind the drums, turned to the middle
  turntable: { x:  0,  y: -1.0, z: 12.5, yaw: 0, w: 14, d: 14 },  // front-centre, low: the stage camera looks down onto the spinning record, clear of the UI
  ricochet: { x:   0,  y: 15,  z: 16,  yaw:  0,   w: 16, d: 16 },  // a CHANDELIER hung high over the front-centre: the stage + wide cams look UP into it, above the band (no wall in the way, clear of every floor station)
};

/* Fallback for an instrument with no named slot: park it out front, in a row. */
export function stationFor(key, i = 0){
  return STATIONS[key] || { x: -10 + 10 * i, y: 0, z: 28, yaw: 0, w: 9, d: 7 };
}

/* PLACEMENT around a belt wall of any width. STATIONS are offsets from the wall's centre,
   laid out for a wall ≤ ~±12.6 u — but the wall is the SUM of its bays (each up to ±13 u:
   crane.js X_MAX), so a three-belt MIDI import can be 85 u wide and swallow the wings (the
   station buried in the wall, its director shot a close-up of a gold rail). A station whose
   footprint (its yawed w × d, plus a margin M) overlaps the wall's box slides straight OUT
   along x on its own side to clear the wall's edge; if the room's side wall stops it first,
   it steps BACK (a back-tier station, z < 0) or FORWARD (a mid-tier one) in z until clear.
   Pure: wall = { min: {x, z}, max: {x, z} } (world; a THREE.Box3 works), room = { HW, BACK,
   FRONT }. A rigid render-time move — nothing solved changes. Returns world { x, z }. */
export function placeStation(st, cx, wall, room, M = 1.5){
  let x = cx + st.x, z = st.z;
  if (!wall || !(wall.max.x >= wall.min.x)) return { x, z };
  const c = Math.abs(Math.cos(st.yaw)), sn = Math.abs(Math.sin(st.yaw));
  const ex = st.w / 2 * c + st.d / 2 * sn, ez = st.w / 2 * sn + st.d / 2 * c;
  const hit = (x, z) => x + ex > wall.min.x - M && x - ex < wall.max.x + M && z + ez > wall.min.z - M && z - ez < wall.max.z + M;
  if (!hit(x, z)) return { x, z };
  const side = Math.sign(st.x);
  if (side){
    const lim = room.HW - ex - .5;
    x = Math.max(-lim, Math.min(lim, side < 0 ? Math.min(x, wall.min.x - M - ex) : Math.max(x, wall.max.x + M + ex)));
  }
  if (hit(x, z)) z = st.z < 0 ? Math.max(room.BACK + ez + .5, wall.min.z - M - ez) : Math.min(room.FRONT - ez - .5, wall.max.z + M + ez);
  return { x, z };
}
