import * as THREE from 'three';

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

const BELT_DEPTH  = -2.6;   // belt sits this far behind its OWN pads (uniform — bays
                            // separate the tracks, so depth no longer has to stagger).
const SLAT_WORLD  = 2.4;    // world height of one belt-texture tile (one slat cycle ≈ /4)
const WALL_MARGIN = 1.4;    // belt overhangs the pad field by this much on each side
const POST_W      = .16;    // side-frame post thickness

/* Per-voice machine styling — DATA, like the songs. Beefier bass, lighter alto. */
const MACHINE_STYLE = {
  lead: { gauge:.22, pulleyR:.50, tint:0x9aa6bd },
  bass: { gauge:.30, pulleyR:.70, tint:0x7e8db0 },   // heavier machine
  alto: { gauge:.18, pulleyR:.42, tint:0xa99ec4 },
};

export function makeConveyorShop({ chrome, envMap, beltSpeed, bandY, reach }){
  const beltCanvas = makeBeltCanvas();                 // expensive raster, ONCE for every machine
  return { buildMachine };

  function buildMachine(track){
    const style = MACHINE_STYLE[track.role] || MACHINE_STYLE.lead;
    const wall     = buildBeltWall(track, style, beltCanvas, { chrome, envMap, bandY, reach });
    const pulleys  = buildPulleys(track, style, { chrome, bandY, reach });
    const brackets = mountBrackets(track, style, { chrome });
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

/* ---- mountBrackets — one arm per pad, clipping it to the belt so the pad visibly
   RIDES the machine. Collision-safety is built into the geometry, not policed:

     • the arm's FRONT face sits exactly at the pad centre (base.z) and runs
       BACKWARD to the belt — it never enters z > base.z, so it can't reach into
       the ball's flight path (the ball lives in front of, and arcs above, the pads).
     • it hugs the pad's own height and rides the bob, so it only occupies the pad's
       slab — never the tall gaps between pads where the arcs travel.
     • it's centred on the pad's x, so it tracks the one pad it holds.

   Built in the machine group (NOT a child of po.g) so it never inherits the pad's
   tilt/scale. One shared geometry per track: a fixed length works for every pad
   because the front face lands at base.z no matter how long the tail is — short-reach
   pads just bury more of their tail behind the belt, where it's hidden. ---- */
function mountBrackets(track, style, { chrome }){
  const ARM_LEN = 4.6;                                  // long enough to reach the deepest pad's belt; tail hides behind it
  const geo = new THREE.BoxGeometry(style.gauge, style.gauge, ARM_LEN);
  const arms = track.padObjs.map(po => {
    const m = new THREE.Mesh(geo, chrome);              // chrome is shared → exempt from disposal
    m.position.set(po.base.x, po.g.position.y, po.base.z - ARM_LEN / 2);  // front face AT the pad, tail toward the belt
    return { m, po };
  });
  const group = new THREE.Group().add(...arms.map(a => a.m));

  return {
    group,
    sync(){                                             // belt loop already placed po.g this frame — just mirror it
      for (const { m, po } of arms){ m.position.y = po.g.position.y; m.visible = po.g.visible; }
    },
    dispose(){ geo.dispose(); },
  };
}
