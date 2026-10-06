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

   Layout: a horseshoe opening toward the camera (+z), the melody belt
   at the centre-back (x≈0, z≈0), the marble drums at x≈+14 (their own
   hardcoded slot, left as-is). x is RELATIVE to the belt wall's centre.
   yaw turns each station to face the middle of the horseshoe.
   ============================================================ */

export const STATIONS = {
  marimba:  { x: -15,  y: 1.5, z:  6,  yaw:  .30, w: 13, d: 7 },   // left of the belt, mirror of the drums
  bass:     { x: -30,  y: 0.0, z: -4,  yaw:  .75, w: 12, d: 8 },   // far left wing
  bells:    { x:  31,  y: 0.0, z: -4,  yaw: -.75, w: 11, d: 7 },   // far right wing
  bowls:    { x: -20,  y: -.5, z: 19,  yaw:  .95, w: 10, d: 9 },   // front-left, low
  musicbox: { x:  20,  y: -.5, z: 19,  yaw: -.95, w: 10, d: 9 },   // front-right, low
};

/* Fallback for an instrument with no named slot: park it out front, in a row. */
export function stationFor(key, i = 0){
  return STATIONS[key] || { x: -10 + 10 * i, y: 0, z: 28, yaw: 0, w: 9, d: 7 };
}
