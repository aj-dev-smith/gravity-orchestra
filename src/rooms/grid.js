import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STAGE } from './common.js';
import { gridPatch } from './grid-shade.js';
import { gridFootStyle } from './grid-footing.js';
import { rippleExtra, makeRipples } from './grid-floor.js';
import { makePlot } from './grid-plot.js';
/* ============================================================
   ROOM ZERO — the GREYBOX: a dark box whose floor, walls and ceiling are one self-lit blueprint grid
   (8 u tiles, 2 u cells: grid-shade.js — a pure fn of the world point, so every surface agrees, and
   lines thin into the distance by coverage instead of shimmering). The house song opens here: it is
   the front door. Fog fades the far walls into haze.

     WHAT THE MACHINES STAND ON (grid-footing.js): the grid folded up out of the floor — graphite
       volumes carrying the floor's own cells and lines, edged in light; lattice towers drawn in light,
       glass mezzanines, ladders of light rungs. The machine's own colour is its reactive edge.
     THE FLOOR ANSWERS (grid-floor.js): a strike sends a faint ring out across the grid lines from
       under its machine, and the cells hugging that machine glow with its afterglow — the quietest
       reaction of any room: accents near the machine that plays, a pure fn of songTime.
     THE STAGE PLOT (grid-plot.js): the room's props — each standing machine's name printed on the
       floor in front of its spot, with a tape of its colour and, raised, its deck's elevation in metres.
   The walls' grid dims as it climbs (the floor is where things happen). Rooms own no lights.
   ============================================================ */

/* the June canvas grid's values, kept (its texels were used raw: these are LINEAR) */
const FIELD = [.039, .043, .082], MINOR = [.19, .25, .43], MAJOR = [.46, .64, .9];
const EMI = [.033 * .55, .08 * .55, .26 * .55];                 // its emissive (#33508c) × .55, over the texel
const mul = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
function surface({ key, hor = 0, fade = null, extra = null }){
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...FIELD), emissive: new THREE.Color().setRGB(...mul(FIELD, EMI)),
    roughness: .9, metalness: .05, side: THREE.DoubleSide });
  const U = gridPatch(m, { key, hor, fade, extra, minorW: .031, majorW: .094, minorAlb: MINOR, majorAlb: MAJOR,
    minorEmi: [mul(MINOR, EMI), 1], majorEmi: [mul(MAJOR, EMI), 1] });
  return { m, U };
}

export default {
  key: 'grid', label: 'Greybox',
  build(scene, { renderer } = {}){
    const g = new THREE.Group();
    const { HW, FLOOR, CEIL, BACK, FRONT } = STAGE;
    const W = HW * 2, D = FRONT - BACK, H = CEIL - FLOOR, MZ = (FRONT + BACK) / 2, MY = (CEIL + FLOOR) / 2;
    // the FLOOR (its shader carries the ripples), the SHELL (four walls: one draw, its lines dimming as they climb) + the ceiling
    const rip = rippleExtra();
    const floor = surface({ key: 'floor', extra: rip });
    const shell = surface({ key: 'shell', hor: 1, fade: [FLOOR + 5, CEIL, .5] });
    const plane = (w, h, rx, ry, x, y, z) => new THREE.PlaneGeometry(w, h).rotateX(rx).rotateY(ry).translate(x, y, z);
    const floorMesh = new THREE.Mesh(plane(W, D, -Math.PI / 2, 0, 0, FLOOR, MZ), floor.m);
    // the ceiling is its OWN mesh (same material: no new program) — EDIT STAGE's plan view lifts the
    // eye through it by hiding whatever sits wholly at ceiling level (stage-edit.js liftCeiling)
    const ceilMesh = new THREE.Mesh(plane(W, D, Math.PI / 2, 0, 0, CEIL, MZ), shell.m);
    const shellMesh = new THREE.Mesh(mergeGeometries([
      plane(W, H, 0, 0, 0, MY, BACK),                             // back wall
      plane(W, H, 0, Math.PI, 0, MY, FRONT),                      // front wall (behind the camera)
      plane(D, H, 0, Math.PI / 2, -HW, MY, MZ),                   // left wall
      plane(D, H, 0, -Math.PI / 2, HW, MY, MZ),                   // right wall
    ]), shell.m);
    floorMesh.name = 'grid:floor'; shellMesh.name = 'grid:shell'; ceilMesh.name = 'grid:ceiling';
    g.add(floorMesh, shellMesh, ceilMesh);

    const footing = gridFootStyle();
    const ripples = makeRipples(rip.uniforms);
    const plot = makePlot({ renderer, floor: FLOOR, room: STAGE });
    g.add(plot.mesh);
    return { group: g, ...STAGE, footing,
      fog: new THREE.FogExp2(0x07060e, .026), background: new THREE.Color(0x07060e),
      /* where the machines stand: the footing's riser tiers learn each machine's footprint; the floor's
         ripple slots are set (rooms/index.js: place runs before the footing is built) */
      place(anchors, plan){ footing.known(anchors); ripples.place(anchors, plan); plot.place(anchors, plan); },
      update(dt, songTime){ ripples.update(songTime); },
      get ripples(){ return ripples; }, get plot(){ return plot; },
      dispose(){ footing.dispose(); plot.dispose(); floor.m.dispose(); shell.m.dispose(); floorMesh.geometry.dispose(); shellMesh.geometry.dispose(); ceilMesh.geometry.dispose(); } };
  },
};
