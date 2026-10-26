import * as THREE from 'three';
import { STAGE } from './common.js';
import { gridFootStyle } from './grid-footing.js';
/* ROOM ZERO — the greybox dev room: a grid-walled box around the static band,
   extracted verbatim from main.js. The grid is procedural; an emissiveMap of the
   same grid self-lights the lines so they read in the dark (and feed bloom a touch).
   Fog fades the far walls into haze, which keeps the conveyor wrap / ball death hidden.
   WHAT THE MACHINES STAND ON (grid-footing.js): the grid folded up out of the floor — graphite
   volumes carrying the floor's own cells and lines, edged in light; lattice towers drawn in light,
   glass mezzanines, ladders of light rungs. The machine's own colour is its reactive edge. */
function gridTex(){
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#0a0b15'; x.fillRect(0,0,S,S);
  const N = 4, step = S/N;                                // 4 minor cells per tile
  x.strokeStyle = 'rgba(86,120,205,.5)'; x.lineWidth = 1;
  for (let i=1;i<N;i++){ const p = i*step;
    x.beginPath(); x.moveTo(p,0); x.lineTo(p,S); x.stroke();
    x.beginPath(); x.moveTo(0,p); x.lineTo(S,p); x.stroke(); }
  x.strokeStyle = 'rgba(130,180,255,.9)'; x.lineWidth = 3; // bright major line at the tile edge
  x.strokeRect(0,0,S,S);
  return new THREE.CanvasTexture(c);
}

export default {
  key: 'grid', label: 'Greybox',
  build(){
    const g = new THREE.Group();
    const base = gridTex();
    const TILE = 8;                                         // world-u per grid tile → 2u minor cells
    const panel = (w, h) => {
      const t = base.clone(); t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w/TILE, h/TILE);
      const m = new THREE.MeshStandardMaterial({
        map:t, emissive:0x33508c, emissiveMap:t, emissiveIntensity:.55,
        roughness:.9, metalness:.05, side:THREE.DoubleSide });
      return new THREE.Mesh(new THREE.PlaneGeometry(w,h), m);
    };
    const { HW, FLOOR, CEIL, BACK, FRONT } = STAGE;
    const W = HW*2, D = FRONT-BACK, H = CEIL-FLOOR, MZ = (FRONT+BACK)/2, MY = (CEIL+FLOOR)/2;
    const add = (m, rx, ry, x, y, z) => { m.rotation.x = rx; m.rotation.y = ry; m.position.set(x,y,z); g.add(m); };
    add(panel(W, D), -Math.PI/2, 0, 0, FLOOR, MZ);         // floor
    add(panel(W, D),  Math.PI/2, 0, 0, CEIL,  MZ);         // ceiling
    add(panel(W, H), 0, 0,        0, MY, BACK);            // back wall
    add(panel(W, H), 0, Math.PI,  0, MY, FRONT);           // front wall (behind the camera)
    add(panel(D, H), 0,  Math.PI/2, -HW, MY, MZ);          // left wall
    add(panel(D, H), 0, -Math.PI/2,  HW, MY, MZ);          // right wall
    const footing = gridFootStyle();
    return { group: g, ...STAGE, footing,
      fog: new THREE.FogExp2(0x07060e, .026), background: new THREE.Color(0x07060e),
      place(anchors){ footing.known(anchors); },          // (the riser tiers learn each machine's footprint)
      dispose(){ base.dispose(); footing.dispose(); } };
  },
};
