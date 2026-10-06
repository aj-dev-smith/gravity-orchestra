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
};

/* Fallback for an instrument with no named slot: park it out front, in a row. */
export function stationFor(key, i = 0){
  return STATIONS[key] || { x: -10 + 10 * i, y: 0, z: 28, yaw: 0, w: 9, d: 7 };
}
