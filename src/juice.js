import * as THREE from 'three';

/* ---------------- juice: trails, ripples, sparks, dust ----------------
   Pooled additive sprites that sell every impact. Time-state-free: every
   pool is a ring buffer advanced by spawn* calls and aged by updateJuice().
   glowTex is shared — the marble halos (in main) are tinted from it too. */

export function glowTexture(){                          // white; tinted per sprite
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64,64,0,64,64,64);
  g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(.35,'rgba(255,255,255,.5)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0,0,128,128);
  return new THREE.CanvasTexture(c);
}
export const glowTex = glowTexture();

const TRAIL = 46, trail = [];                            // fading trail (tinted per spawn)
let trailHead = 0;
const ripples = [];                                      // impact rings
let rippleIdx = 0;
const PARTS = 150, parts = [];                           // impact sparks
let partIdx = 0;

/* build every pool and add it to the scene (call once, after scene exists) */
export function initJuice(scene){
  for (let i=0;i<TRAIL;i++){
    const s = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex, color:0xffffff,
      blending:THREE.AdditiveBlending, depthWrite:false, transparent:true, opacity:0}));
    s.scale.set(.6,.6,1); scene.add(s); trail.push(s);
  }
  for (let i=0;i<10;i++){
    const r = new THREE.Mesh(new THREE.RingGeometry(.5,.532,48),   // thin crisp line
      new THREE.MeshBasicMaterial({blending:THREE.AdditiveBlending, transparent:true, opacity:0,
        side:THREE.DoubleSide, depthWrite:false}));
    scene.add(r); ripples.push({mesh:r, life:1, size:1, peak:.4});
  }
  for (let i=0;i<PARTS;i++){
    const s = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex, color:0xffffff,
      blending:THREE.AdditiveBlending, depthWrite:false, transparent:true, opacity:0}));
    scene.add(s); parts.push({s, vel:new THREE.Vector3(), life:1, s0:.3});
  }
  // drifting dust
  {
    const N = 900, dp = new Float32Array(N*3);
    for (let i=0;i<N;i++){
      dp[i*3]   = (Math.random()-.5)*70;
      dp[i*3+1] = 16 - Math.random()*160;                 // covers the deepest songs
      dp[i*3+2] = (Math.random()-.5)*70;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(dp,3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({map:glowTex, color:0x4455aa,
      size:.22, transparent:true, opacity:.5, blending:THREE.AdditiveBlending, depthWrite:false})));
  }
}

export function spawnBurst(pos, color, n, power){
  for (let i=0;i<n;i++){
    const p = parts[partIdx++ % PARTS];
    p.life = 0;
    p.s.position.copy(pos);
    p.s.material.color.copy(color);
    p.vel.set(Math.random()-.5, Math.random()*.95 + .3, Math.random()-.5)
       .normalize().multiplyScalar(power*(.45 + Math.random()*.85));
    p.s0 = .22 + Math.random()*.3;
  }
}

/* one trail puff at the marble's position (the .022s gating timer lives in the caller) */
export function spawnTrail(pos, color, isBass){
  const s = trail[trailHead++ % TRAIL];
  s.position.copy(pos);
  s.material.color.copy(color);
  s.material.opacity = .5;
  s.scale.setScalar(isBass ? .95 : .7);
}

/* one impact ring, oriented to the pad it struck.
   amp = launch impulse (.05..1.6): a gentle tap whispers, a big lob rings wide */
export function spawnRipple(pos, quaternion, hue, isBass, amp = .8){
  const rp = ripples[rippleIdx++ % ripples.length];
  rp.mesh.position.copy(pos);
  rp.mesh.quaternion.copy(quaternion);
  rp.mesh.rotateX(Math.PI/2);
  rp.mesh.material.color.setHSL(hue, .7, .58);
  const f = amp / 1.6;
  rp.size = (isBass ? 1.1 : .8) * (.5 + .5*f);
  rp.peak = .18 + .2*f;
  rp.life = 0;
}

/* advance trail fade, ripples, and sparks by one frame */
export function updateJuice(dt){
  trail.forEach(s => { s.material.opacity *= (1 - dt*3.2); s.scale.multiplyScalar(1 - dt*.9); });
  ripples.forEach(r => {
    if (r.life < 1){
      r.life = Math.min(1, r.life + dt*2.4);
      const e = 1 - Math.pow(1 - r.life, 3);            // cubic-out: fast attack, soft landing
      const s = r.size * (.55 + e*1.1);
      r.mesh.scale.set(s,s,s);
      r.mesh.material.opacity = (1-r.life)*(1-r.life)*r.peak;
    } else r.mesh.material.opacity = 0;
  });
  parts.forEach(p => {
    if (p.life < 1){
      p.life = Math.min(1, p.life + dt*1.9);
      p.vel.y -= 9*dt;
      p.s.position.addScaledVector(p.vel, dt);
      const o = 1 - p.life;
      p.s.material.opacity = o*o*.9;
      p.s.scale.setScalar(p.s0*(1 + p.life*.5));
    } else p.s.material.opacity = 0;
  });
}
