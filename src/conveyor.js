import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ZAXIS = new THREE.Vector3(0, 0, 1);
const YAXIS = new THREE.Vector3(0, 1, 0);
const ONES  = new THREE.Vector3(1, 1, 1);
const HUB_BACK = .3;                         // how far the carriage hub tucks behind the disc face (along −n)
const _anchor = new THREE.Vector3(), _hub = new THREE.Vector3(), _dir = new THREE.Vector3();
const _n = new THREE.Vector3();              // per-frame scratch (live pad normal, derived from its quaternion)

/* ============================================================
   CONVEYOR — the visible machine. Third render subsystem, in the
   shape of juice.js / audio.js: a thin DI'd seam, no engine reach.

   THE ONE IDEA THAT KEEPS THIS HONEST: the machine only draws what
   the math already implies. Every pad rises at a constant DESCENT
   (beltPhase's derivative is constant except at the off-screen wrap).
   So the belt is a constant-speed scroll with zero drift — no
   songTime, no physics, no state to sync. A texture scrolling at
   DESCENT and pads rising at DESCENT are slip-free forever, for free.

   Each machine builds in its track's LOCAL frame and is added under
   tr.stage, so the bay placement (Phase 0) carries it for free —
   neighbours never fight.
   ============================================================ */

export const BELT_DEPTH = -2.0;   // belt sits this far behind its OWN pads (uniform — bays
                                  // separate the tracks, so depth no longer has to stagger).
                                  // Kept shallow so the support arms stay short & tidy, with
                                  // clearance for the deepest-weaving pad's back edge.
const SLAT_WORLD  = 2.4;    // world height of one belt-texture tile (one slat cycle ≈ /4)
const WALL_MARGIN = 1.4;    // belt overhangs the pad field by this much on each side
const POST_W      = .16;    // side-frame post thickness

/* Per-voice machine styling — DATA, like the songs. Beefier bass, lighter alto. */
const MACHINE_STYLE = {                                // gauge = support-arm thickness (slim — stay out of the way)
  lead: { gauge:.11, pulleyR:.50, tint:0x9aa6bd },
  bass: { gauge:.15, pulleyR:.70, tint:0x7e8db0 },   // heavier machine
  alto: { gauge:.09, pulleyR:.42, tint:0xa99ec4 },
};

export function makeConveyorShop({ chrome, envMap, beltSpeed, bandY, reach }){
  const beltCanvas = makeBeltCanvas();                 // expensive raster, ONCE for every machine
  return { buildMachine };

  function buildMachine(track){
    const style = MACHINE_STYLE[track.role] || MACHINE_STYLE.lead;
    const wall     = buildBeltWall(track, style, beltCanvas, { chrome, envMap, bandY, reach });
    const pulleys  = buildPulleys(track, style, { chrome, bandY, reach });
    const brackets = mountBrackets(track, style, { envMap });
    const group = new THREE.Group();
    group.add(wall.group, pulleys.group, brackets.group);
    return {
      group,                                           // caller adds to tr.stage (local frame)
      update(dt){                                      // call AFTER the belt loop sets po.g.position
        wall.scroll(beltSpeed * dt);
        pulleys.spin(beltSpeed * dt);
        brackets.sync();
      },
      dispose(){ wall.dispose(); pulleys.dispose(); brackets.dispose(); },
    };
  }
}

/* ---- makeBeltCanvas → a canvas of horizontal slats (belt segments). Returned as
   a canvas so each machine wraps its own CanvasTexture → independent offset/dispose.
   Subtle/premium: a dark metallic base, evenly-spaced slats bevelled top & bottom
   so tiling + vertical scroll reads as a moving belt, not a flat gradient. ---- */
function makeBeltCanvas(){
  const w = 64, h = 128, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  const base = x.createLinearGradient(0, 0, w, 0);     // soft cross-belt sheen
  base.addColorStop(0, '#0b0d15'); base.addColorStop(.5, '#1b2030'); base.addColorStop(1, '#0b0d15');
  x.fillStyle = base; x.fillRect(0, 0, w, h);
  const N = 4, sh = h / N;                             // four slats per tile
  for (let i = 0; i < N; i++){
    const y = i * sh;
    x.fillStyle = 'rgba(140,160,200,.05)'; x.fillRect(0, y + 2, w, sh - 4);   // faint raised panel
    x.fillStyle = 'rgba(255,255,255,.07)'; x.fillRect(0, y, w, 1);            // top bevel highlight
    x.fillStyle = 'rgba(0,0,0,.5)';        x.fillRect(0, y + sh - 2, w, 2);   // bottom groove shadow
  }
  return c;
}

/* ---- buildBeltWall — the scrolling backdrop the pads ride. Local frame. ---- */
function buildBeltWall(track, style, canvas, { chrome, envMap, bandY, reach }){
  const xs = track.padObjs.map(po => po.base.x);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const cx = (minX + maxX) / 2, width = (maxX - minX) + 2 * WALL_MARGIN, height = 2 * reach;

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;                    // tile vertically so the belt is endless
  tex.repeat.set(1, height / SLAT_WORLD);
  const geo = new THREE.PlaneGeometry(width, height);  // faces +z by default — toward the pads/camera
  // Low metalness + high roughness so the slats read as a LIT matte panel rather
  // than a mirror with nothing to reflect (the env is near-black). The same texture
  // drives a faint emissive so the segments are visible from any angle — kept well
  // under the bloom threshold so the belt stays a backdrop, never a light source.
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: style.tint,
    metalness: .3, roughness: .7, envMap,
    emissive: new THREE.Color(style.tint), emissiveMap: tex, emissiveIntensity: .45 });
  const plane = new THREE.Mesh(geo, mat);
  plane.position.set(cx, bandY, BELT_DEPTH);

  const group = new THREE.Group().add(plane);
  // side frame: two thin chrome posts at the field edges, full height, just in front of the belt
  const postGeo = new THREE.BoxGeometry(POST_W, height, POST_W);
  for (const side of [-1, 1]){
    const post = new THREE.Mesh(postGeo, chrome);      // chrome is shared → exempt from disposal
    post.position.set(cx + side * (width / 2), bandY, BELT_DEPTH + .25);
    group.add(post);
  }

  return {
    group,
    scroll(d){ tex.offset.y -= d / SLAT_WORLD; },       // slats travel UP with the rising pads (verify sign live)
    dispose(){ geo.dispose(); postGeo.dispose(); tex.dispose(); },
  };
}

/* ---- buildPulleys — the drums the belt wraps, at the band's top & bottom.
   Axis along x; angular speed = linear / radius, so a fat bass drum turns slower
   than a lean alto one at the same belt speed — the machine reads as geared. Mostly
   off-screen; they're the "it's a real loop" tell when the FIXED cam pulls back. ---- */
function buildPulleys(track, style, { chrome, bandY, reach }){
  const xs = track.padObjs.map(po => po.base.x);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const cx = (minX + maxX) / 2, width = (maxX - minX) + 2 * WALL_MARGIN;
  const r = style.pulleyR;

  const geo = new THREE.CylinderGeometry(r, r, width, 16);
  geo.rotateZ(Math.PI / 2);                             // lay the drum's axis along x (baked into verts)
  const drums = [bandY + reach, bandY - reach].map(y => {
    const m = new THREE.Mesh(geo, chrome);              // chrome is shared → exempt from disposal
    m.position.set(cx, y, BELT_DEPTH);
    return m;
  });
  const group = new THREE.Group().add(...drums);

  return {
    group,
    spin(d){ const da = d / r; drums.forEach(m => m.rotation.x += da); },  // roll with the belt (verify sign live)
    dispose(){ geo.dispose(); },
  };
}

/* ---- boxBetween — a thin strut from point a to point b (the machine's vocabulary
   word). A unit box stretched to the span and rotated so its z-axis points a→b. ---- */
function boxBetween(a, b, w){
  const dir = b.clone().sub(a), len = dir.length() || 1e-3;
  const geo = new THREE.BoxGeometry(w, w, len);
  const q = new THREE.Quaternion().setFromUnitVectors(ZAXIS, dir.clone().normalize());
  return geo.applyMatrix4(new THREE.Matrix4().compose(a.clone().addScaledVector(dir, .5), q, ONES));
}

/* ---- carriageGeometry — the moving half of a mount: a hub tucked UNDER the disc and
   four short posts splaying out to the rim quadrants. Built in the pad's OWN LOCAL frame
   (disc "up" = +y, disc plane = x/z), so the carriage is just rotated by the pad's live
   quaternion at render — it self-orients to ANY tilt for free and tips WITH the disc as
   it unfolds on entry. Posts meet the rim from BEHIND (hub at −y), never crossing the
   FACE the marble bounces off. The carriage rides the pad's FULL motion — belt bob AND
   the flipper wind-up nudge — so the pad can retract to strike without out-running its
   posts (the clip the old rigid arm hit). Pad geometry is identical per note, so this
   bakes once and is shared by orientation. */
function carriageGeometry(po, gauge){
  const R = po.g.scale.x * .55 * .92;                    // rim radius (just inside the ring), world units
  const hub = new THREE.Vector3(0, -HUB_BACK, 0);        // under the disc face (back side, off the bounce)
  const geos = [];
  for (let k = 0; k < 4; k++){                           // four posts → rim quadrants (45,135,225,315°)
    const a = (k + .5) * Math.PI / 2;
    const rim = new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R);   // in the local disc plane
    geos.push(boxBetween(hub, rim, gauge * .8));
  }
  const merged = mergeGeometries(geos, false);
  geos.forEach(g => g.dispose());                        // parts are consumed into `merged`
  return merged;
}

/* ---- mountBrackets — a per-pad mount in two halves so a pad can wind up and strike
   without its supports clipping through it:
     • CARRIAGE (hub + four posts) rides the pad's full position — bob + flipper nudge —
       so the rim posts stay locked to the disc at any wind-up (no more "clip ahead").
     • SHOE stays planted on the belt at the pad's un-nudged height (po.beltY).
     • SPINE bridges shoe → hub, re-aimed and telescoped each frame, so the whole arm
       visibly tilts back with the pad as it retracts to strike.
   Dark matte metal so it recedes as structure, not chrome that sparkles. Built in the
   machine group (NOT under po.g, so no inherited scale). ---- */
function mountBrackets(track, style, { envMap }){
  const mat = new THREE.MeshStandardMaterial({ color: 0x262b36, metalness: .6, roughness: .62, envMap });
  const g = style.gauge;
  const spineGeo = new THREE.BoxGeometry(g, g, 1);                       // unit length — scaled to span each frame
  const shoeGeo  = new THREE.BoxGeometry(g * 2.4, g * 2.4, g * .6);      // bolt-plate flush on the belt
  const parts = track.padObjs.map(po => ({
    po,
    car:   new THREE.Mesh(carriageGeometry(po, g), mat),
    spine: new THREE.Mesh(spineGeo, mat),
    shoe:  new THREE.Mesh(shoeGeo, mat),
  }));
  const group = new THREE.Group();
  for (const p of parts) group.add(p.car, p.spine, p.shoe);

  return {
    group,
    sync(){                                             // belt loop already placed po.g (pos + quaternion) + po.beltY
      for (const { po, car, spine, shoe } of parts){
        const vis = po.g.visible;
        car.visible = spine.visible = shoe.visible = vis;
        if (!vis) continue;
        car.position.copy(po.g.position);               // carriage rides the pad fully (incl. wind-up nudge)
        car.quaternion.copy(po.g.quaternion);           // …and tips WITH it as the disc unfolds on entry
        _n.copy(YAXIS).applyQuaternion(po.g.quaternion);        // live pad normal (animates flat→deployed on entry)
        _anchor.set(po.base.x, po.beltY, BELT_DEPTH + g * .3);   // shoe stays planted on the belt (no nudge, no unfold)
        shoe.position.copy(_anchor);
        _hub.copy(po.g.position).addScaledVector(_n, -HUB_BACK);
        _dir.subVectors(_hub, _anchor);
        const len = _dir.length() || 1e-3;
        spine.position.copy(_anchor).addScaledVector(_dir, .5);  // midpoint
        spine.quaternion.setFromUnitVectors(ZAXIS, _dir.divideScalar(len));
        spine.scale.set(1, 1, len);                     // telescope to span shoe → hub
      }
    },
    dispose(){ mat.dispose(); spineGeo.dispose(); shoeGeo.dispose(); for (const p of parts) p.car.geometry.dispose(); },
  };
}
