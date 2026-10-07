/* ============================================================
   XR PLAN — where you can STAND in VR, and the tour. PURE (no scene, DOM, audio, XR).

   The director already solved, at song load, where a camera should be for every machine
   (shotrig/shotsolve: eyes in clear air that SEE their subject) and the loop's whole edit
   (directorplan: shot key as a pure fn of songTime). VR re-uses both:

   - ANCHORS: every solved shot eye becomes a catwalk pad you can teleport to — your EYES
     land where the director's camera was (feet = eye − EYE_U), facing its aim. Plus the
     wide (stage) eye and one pad per belt bay, looking straight into the strike band.
     A pad that would stand inside a machine backs off along its own line toward the
     solved eye (which the solve already proved clear).
   - TOUR: the director's edit replayed as cuts between anchors — anchor id as a pure fn of
     songTime (scrub-safe, ≥ 3 s per cut by the director's own constraint).
   - SCALE: honest gravity. G is 14.5 u/s²; a real marble falls at 9.81 m/s². So one world
     unit is 9.81/14.5 m and the user's rig is scaled U_PER_M ≈ 1.48 — the falls you watch
     in the headset are true g, not a floaty diorama.
   - TELEPORT ARC: a marble throw onto the pad — a target + a launch solve (engine's own
     solveLaunch/arcPos), the same grammar as every note.
   ============================================================ */
import * as THREE from 'three';
import { G, solveLaunch, arcPos } from './engine.js';

export const G_REAL = 9.81;
export const U_PER_M = -G.y / G_REAL;              // world units per real metre (≈ 1.478) — follows G
export const EYE_M = 1.6;                          // standing eye height (local-floor) in metres
export const EYE_U = EYE_M * U_PER_M;              // … in world units (≈ 2.37)
export const PAD_R = 1.2 * U_PER_M;                // catwalk pad radius (1.2 m)
export const MIN_SEP = 2.6 * U_PER_M;              // two anchors closer than this merge (the first wins)
export const CLEAR_U = .9;                         // air kept between a pad's cylinder and any machine box
export const BELT_BACK = 10;                       // belt pad: this far in front of the belt wall (u)

const v3 = a => Array.isArray(a) ? a : [a.x, a.y, a.z];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* yaw (rotation about +y) that turns a rig's forward (−z) toward (dx, dz) */
export function yawToward(dx, dz){ return Math.atan2(-dx, -dz); }

/* does a standing user (pad of radius PAD_R at feet, head EYE_U up) sit inside a box? */
export function padHits(feet, box, clear = CLEAR_U){
  const [x, y, z] = feet, r = PAD_R + clear;
  return x > box[0] - r && x < box[1] + r && z > box[4] - r && z < box[5] + r &&
         y + EYE_U + .6 > box[2] - clear && y - .4 < box[3] + clear;
}

/* Build the teleport anchors for a song.
   shots: [{key, owner?, eye, aim, color?}] (the director's SOLVED station shots)
   wide:  {eye, aim} | null       (the stage shot)
   belts: [{role, x, z0, z1, bandY}] (each belt bay: centre x, wall front z, the strike band y)
   solids:[[x0,x1,y0,y1,z0,z1], …] (world boxes of every machine — pads must stand clear)
   room:  {x0,x1,y0,y1,z0,z1}     (feet are kept inside)
   → [{id, key, label, pos:[x,y,z] (feet), eye:[x,y,z], yaw, aim:[x,y,z], color}] — wide first. */
export function planAnchors({ shots = [], wide = null, belts = [], solids = [], room = null, pull = .85 } = {}){
  const out = [];
  const clampRoom = p => room ? [
    Math.min(room.x1 - PAD_R, Math.max(room.x0 + PAD_R, p[0])),
    Math.min(room.y1 - EYE_U - 1, Math.max(room.y0, p[1])),
    Math.min(room.z1 - PAD_R, Math.max(room.z0 + PAD_R, p[2]))] : p;
  const blocked = feet => solids.some(b => padHits(feet, b));
  const add = (key, label, eye, aim, color) => {
    eye = v3(eye); aim = v3(aim);
    // pull the eye a little toward its subject (a headset wants it closer than a lens), then
    // back off along the same line toward the solved eye until the pad stands in clear air
    let feet = null;
    for (const k of [pull, (pull + 1) / 2, 1]){
      const e = [aim[0] + (eye[0] - aim[0]) * k, aim[1] + (eye[1] - aim[1]) * k, aim[2] + (eye[2] - aim[2]) * k];
      const f = clampRoom([e[0], e[1] - EYE_U, e[2]]);
      if (!blocked(f)){ feet = f; break; }
      if (k === 1) feet = f;                        // the solved eye itself: the solve proved its line clear
    }
    if (out.some(a => dist(a.pos, feet) < MIN_SEP)) return;
    const e = [feet[0], feet[1] + EYE_U, feet[2]];
    out.push({ id: out.length, key, label, pos: feet, eye: e, aim, yaw: yawToward(aim[0] - e[0], aim[2] - e[2]), color: color || '#ffb764' });
  };
  if (wide?.eye) add('stage', 'STAGE', wide.eye, wide.aim, '#cfd6e6');
  for (const b of belts){
    const aim = [b.x, b.bandY, (b.z0 + b.z1) / 2];
    add(b.role, b.role === 'lead' ? 'BELT' : `BELT · ${b.role.toUpperCase()}`, [b.x, b.bandY + .6, b.z1 + BELT_BACK], aim, '#ffb764');
  }
  for (const s of shots) add(s.key, String(s.label || s.key).toUpperCase(), s.eye, s.aim, s.color);
  return out;
}

/* which anchor a director shot key lands on: a station's own pad; 'belt' / a belt role → that
   belt's pad (else the lead belt's); 'stage' → the wide; anything unknown → the first anchor */
export function anchorFor(key, anchors){
  if (!anchors.length) return -1;
  let a = anchors.find(x => x.key === key);
  if (!a && (key === 'belt' || key === 'all' || key === 'alto' || key === 'bass' || key === 'lead'))
    a = anchors.find(x => x.key === 'lead') || anchors.find(x => /^(alto|bass)$/.test(x.key));
  return (a || anchors[0]).id;
}

/* TOUR: the director's edit as anchor ids — a pure fn of songTime.
   shotAt(now) is the director plan's own lookup (main: shotAt(plan, wrapP(now, P), seamFrom)). */
export function tourAt(shotAt, anchors, songTime){
  return anchorFor(shotAt(songTime), anchors);
}

/* the anchor a pointing ray picks: smallest angle between the ray and the pad centre, inside
   a cone (radians); `skip` = the anchor you stand on. → id | -1 */
export function pickAnchor(anchors, origin, dir, { cone = .2, skip = -1 } = {}){
  const o = v3(origin), d = v3(dir), L = Math.hypot(...d) || 1;
  let best = -1, bestA = cone;
  for (const a of anchors){
    if (a.id === skip) continue;
    const c = [a.pos[0] - o[0], a.pos[1] + .3 - o[1], a.pos[2] - o[2]], cl = Math.hypot(...c);
    if (cl < 1e-6) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, (c[0] * d[0] + c[1] * d[1] + c[2] * d[2]) / (cl * L))));
    if (ang < bestA){ bestA = ang; best = a.id; }
  }
  return best;
}

/* The teleport arc: the solved marble throw from the hand onto the pad (honest G, world u).
   Flight time grows with distance (a long throw lobs higher), then n+1 points of arcPos. */
export function throwArc(from, to, n = 24){
  const a = new THREE.Vector3(...v3(from)), b = new THREE.Vector3(...v3(to));
  const T = Math.min(2.4, Math.max(.45, Math.sqrt(a.distanceTo(b)) * .32));
  const v0 = solveLaunch(a, b, T), pts = [];
  for (let i = 0; i <= n; i++) pts.push(arcPos(a, v0, T * i / n));
  return { T, v0, pts };
}

/* Where to put the rig (dolly) so the user's HEAD lands over the anchor's pad centre, facing
   its yaw. head = the head's offset inside the rig's local floor frame (metres, unrotated);
   the rig is scaled by `scale` and turned by the anchor yaw → {x, y, z, yaw} for the dolly. */
export function rigFor(anchor, head = [0, 0, 0], scale = U_PER_M, yaw = anchor.yaw){
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const hx = head[0] * scale, hz = head[2] * scale;
  // R_y(yaw)·(hx, hz) = (c·hx + s·hz, −s·hx + c·hz)
  return { x: anchor.pos[0] - (c * hx + s * hz), y: anchor.pos[1], z: anchor.pos[2] - (-s * hx + c * hz), yaw };
}

/* SPATIAL AUDIO in XR: a strike in the HEAD's frame (world units — rotation only: the rig's
   scale is a viewing choice, not a distance), plus the shot parameters spatial.js expects:
   tanH 1 (~90° per-eye field) and focus = head → the current pad's aim (≥ 4; 8 with no pad).
   head = {position, quaternion} (world). → {x, y, z, tanH, focus} */
const _hq = new THREE.Quaternion(), _hv = new THREE.Vector3();
export function earFrame(worldPos, head, aim = null){
  _hv.set(worldPos.x, worldPos.y, worldPos.z).sub(head.position).applyQuaternion(_hq.copy(head.quaternion).invert());
  const focus = aim ? Math.max(4, Math.hypot(aim[0] - head.position.x, aim[1] - head.position.y, aim[2] - head.position.z)) : 8;
  return { x: _hv.x, y: _hv.y, z: _hv.z, tanH: 1, focus };
}
