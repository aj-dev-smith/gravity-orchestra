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

/* ---- GLOW BATCH: a pool of additive billboards in ONE draw call ----
   The trail and the sparks used to be one THREE.Sprite (+ its own material) per puff —
   up to ~200 draw calls in a burst. This is the same billboard (a unit quad facing the
   camera, world-sized, map = glowTex, colour × opacity, additive, fogged — Sprite's own
   vertex math and fragment chunks) drawn as one instanced mesh. A spent slot has size 0
   (degenerate: no fragments). */
const BB_VERT = /* glsl */`
  attribute vec3 iPos; attribute vec4 iCol; attribute float iSize;
  varying vec2 vUv; varying vec4 vCol;
  #include <fog_pars_vertex>
  void main(){
    vUv = uv; vCol = iCol;
    vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    mvPosition.xy += position.xy * iSize;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const BB_FRAG = /* glsl */`
  uniform sampler2D map; varying vec2 vUv; varying vec4 vCol;
  #include <fog_pars_fragment>
  void main(){
    vec4 tex = texture2D(map, vUv);
    gl_FragColor = vec4(vCol.rgb * tex.rgb, vCol.a * tex.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;
function glowBatch(n){
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index; geo.setAttribute('position', quad.attributes.position); geo.setAttribute('uv', quad.attributes.uv);
  const pos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const col = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const size = new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', pos); geo.setAttribute('iCol', col); geo.setAttribute('iSize', size);
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({ vertexShader: BB_VERT, fragmentShader: BB_FRAG, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  mat.uniforms.map.value = glowTex;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;                            // instances span the room; the vertex stage culls for free
  mesh.userData.noFadeGate = true;
  return { mesh, pos: pos.array, col: col.array, size: size.array,
    set(i, p, c, a, s){ this.pos[i*3] = p.x; this.pos[i*3+1] = p.y; this.pos[i*3+2] = p.z;
      this.col[i*4] = c.r; this.col[i*4+1] = c.g; this.col[i*4+2] = c.b; this.col[i*4+3] = a; this.size[i] = s; },
    commit(){ pos.needsUpdate = col.needsUpdate = size.needsUpdate = true; } };
}

const TRAIL = 46, trail = [];                            // fading trail (tinted per spawn)
let trailHead = 0, trailB = null;
const ripples = [];                                      // impact rings
let rippleIdx = 0;
const PARTS = 150, parts = [];                           // impact sparks
let partIdx = 0, partB = null;

/* build every pool and add it to the scene (call once, after scene exists) */
export function initJuice(scene){
  trailB = glowBatch(TRAIL); partB = glowBatch(PARTS);
  scene.add(trailB.mesh, partB.mesh);
  for (let i=0;i<TRAIL;i++) trail.push({ p: new THREE.Vector3(), c: new THREE.Color(), a: 0, s: 0 });
  for (let i=0;i<10;i++){
    const r = new THREE.Mesh(new THREE.RingGeometry(.5,.532,48),   // thin crisp line
      new THREE.MeshBasicMaterial({blending:THREE.AdditiveBlending, transparent:true, opacity:0,
        side:THREE.DoubleSide, depthWrite:false}));
    scene.add(r); ripples.push({mesh:r, life:1, size:1, peak:.4});
  }
  for (let i=0;i<PARTS;i++) parts.push({ p: new THREE.Vector3(), c: new THREE.Color(), vel: new THREE.Vector3(), life: 1, s0: .3 });
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
    p.p.copy(pos);
    p.c.copy(color);
    p.vel.set(Math.random()-.5, Math.random()*.95 + .3, Math.random()-.5)
       .normalize().multiplyScalar(power*(.45 + Math.random()*.85));
    p.s0 = .22 + Math.random()*.3;
  }
}

/* one trail puff at the marble's position (the .022s gating timer lives in the caller) */
export function spawnTrail(pos, color, isBass){
  const s = trail[trailHead++ % TRAIL];
  s.p.copy(pos);
  s.c.copy(color);
  s.a = .5;
  s.s = isBass ? .95 : .7;
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
  // (a spent puff is size 0 in its batch — the whole pool is one draw call either way)
  let any = false;
  for (let i = 0; i < TRAIL; i++){ const s = trail[i];
    s.a *= (1 - dt*3.2); s.s *= (1 - dt*.9);
    const live = s.a > .004; any ||= live;
    trailB.set(i, s.p, s.c, s.a, live ? s.s : 0); }
  trailB.mesh.visible = any; trailB.commit();
  ripples.forEach(r => {
    if (r.life < 1){
      r.life = Math.min(1, r.life + dt*2.4);
      const e = 1 - Math.pow(1 - r.life, 3);            // cubic-out: fast attack, soft landing
      const s = r.size * (.55 + e*1.1);
      r.mesh.scale.set(s,s,s);
      r.mesh.material.opacity = (1-r.life)*(1-r.life)*r.peak;
      r.mesh.visible = true;
    } else { r.mesh.material.opacity = 0; r.mesh.visible = false; }
  });
  any = false;
  for (let i = 0; i < PARTS; i++){ const p = parts[i];
    if (p.life < 1){
      p.life = Math.min(1, p.life + dt*1.9);
      p.vel.y -= 9*dt;
      p.p.addScaledVector(p.vel, dt);
      const o = 1 - p.life;
      partB.set(i, p.p, p.c, o*o*.9, p.s0*(1 + p.life*.5));
      any = true;
    } else partB.size[i] = 0;
  }
  partB.mesh.visible = any; partB.commit();
}
