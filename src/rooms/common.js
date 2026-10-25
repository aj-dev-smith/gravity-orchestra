import * as THREE from 'three';
/* ============================================================
   ROOMS — shared bits. A Room is deliberately THIN (docs/PLAN-staging.md):
   a coordinate frame + surfaces (floor / walls / ceiling) + bounds +
   anchor points. Nothing else. It never reaches into the engine, never
   touches the solve, and owns no lights (light count stays constant →
   no shader recompiles on a room swap); it may only re-tint the two
   global fill lights via `mood`.

   THE FLOOR CONTRACT: every room's FLOOR is the same world y (STAGE.FLOOR).
   The machines are SET ON IT (rooms/footing.js): each stands on a plinth at
   its ground height, or as high as the user lifts it — the supports are the
   room's, not the plugins' — and the belt's own posts and the hung stations'
   rods are grown at song-build time down to it. Keeping it identical across
   rooms means a room swap is a pure scenery swap — instant, mid-song, no world
   rebuild, no restarted timeline — and the supports are honest in every room.
   A room that wants a lower "ground" (the Void) puts its own surface where the
   machines stand. (Until 2026-10 the floor sat at −22, a relic of the June
   conveyor that reached far down: every machine stood on ~15 m of legs.)
   ============================================================ */

export const STAGE = { HW: 38, FLOOR: -5.5, CEIL: 36, BACK: -34, FRONT: 42 };

/* deterministic PRNG — rooms are art-directed, not random per load */
export function rng(seed = 1){
  let s = seed >>> 0;
  return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* a canvas → texture, drawn once at build. srgb for colour maps, linear for masks. */
export function canvasTex(w, h, draw, { srgb = true, repeat = null, mips = true } = {}){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  if (!mips){ t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  t.anisotropy = 4;
  return t;
}

/* soft radial blob (white → transparent): light pools, glows, haze puffs */
export function radialTex(size = 128, stops = [[0, 1], [.35, .45], [1, 0]]){
  return canvasTex(size, size, (x, w) => {
    const g = x.createRadialGradient(w/2, w/2, 0, w/2, w/2, w/2);
    stops.forEach(([o, a]) => g.addColorStop(o, `rgba(255,255,255,${a})`));
    x.fillStyle = g; x.fillRect(0, 0, w, w);
  }, { srgb: false });
}

/* vertical fade (bright at v=1 → clear at v=0, with a soft top too): light shafts / pillars */
export function shaftTex(){
  return canvasTex(64, 256, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.06, 'rgba(255,255,255,.9)');
    g.addColorStop(.45, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    const s = x.createLinearGradient(0, 0, w, 0);            // soft side edges
    s.addColorStop(0, 'rgba(0,0,0,1)'); s.addColorStop(.3, 'rgba(0,0,0,0)');
    s.addColorStop(.7, 'rgba(0,0,0,0)'); s.addColorStop(1, 'rgba(0,0,0,1)');
    x.globalCompositeOperation = 'destination-out'; x.fillStyle = s; x.fillRect(0, 0, w, h);
  }, { srgb: false });
}

/* additive, unlit, fog-free glow material (bright things read THROUGH haze) */
export function glowMat(map, color, opacity = 1, extra = {}){
  return new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide, toneMapped: true, ...extra });
}

/* Twinkling glow points (candle flames, motes, stars): ONE draw call, all animation in
   the vertex shader off a single time uniform → zero per-frame allocation. */
export function glowPoints(positions, { colors, sizes, phases, map, size = 1, flicker = .25, rate = 7, drift = 0, fog = false }){
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: map }, uScale: { value: size }, uFlicker: { value: flicker },
                uRate: { value: rate }, uDrift: { value: drift }, uBoost: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aSize; attribute float aPhase;
      uniform float uTime, uScale, uFlicker, uRate, uDrift, uBoost;
      varying vec3 vColor;
      void main(){
        vec3 p = position;
        p.y += uDrift * sin(uTime * .21 + aPhase * 3.1) * 1.4;
        p.x += uDrift * sin(uTime * .17 + aPhase * 5.3);
        float f = 1. - uFlicker * (.5 + .5 * sin(uTime * uRate + aPhase * 6.283) * sin(uTime * uRate * .53 + aPhase * 11.));
        vColor = aColor * f * uBoost;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_PointSize = aSize * uScale * (300. / -mv.z) * (.85 + .15 * f);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; varying vec3 vColor;
      void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vColor, a); }`,   // additive = SrcAlpha·One → colour × a
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

/* free every GPU resource under a group (geometries, materials, their textures) */
export function disposeTree(root){
  const seen = new Set();
  root.traverse(o => {
    if (o.geometry && !seen.has(o.geometry)){ seen.add(o.geometry); o.geometry.dispose(); }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats){
      if (seen.has(m)) continue; seen.add(m);
      for (const v of Object.values(m)) if (v && v.isTexture && !seen.has(v)){ seen.add(v); v.dispose(); }
      if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u.value && u.value.isTexture && !seen.has(u.value)){ seen.add(u.value); u.value.dispose(); }
      m.dispose();
    }
    if (o.isReflector) o.getRenderTarget().dispose();
  });
}

/* an InstancedMesh from a list of matrices (built once; static) */
export function instanced(geo, mat, mats){
  const im = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  return im;
}
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
export function trs(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1){
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

/* A volumetric-looking light BEAM / pillar for an (instanced) open cylinder whose uv.v
   runs 0 (far end) → 1 (source). Fresnel-soft edges (bright where you look through the
   middle of the cone), fading away from the source. Additive, fog-free, instance colours.
   Animate with `material.uniforms.uGain.value`. */
export function beamMat({ color = 0xffffff, gain = .35, falloff = 1.6, edge = 2 } = {}){
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uGain: { value: gain }, uFall: { value: falloff }, uEdge: { value: edge } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vC;
      void main(){
        vec4 p = vec4(position, 1.);
        vec3 n = normal;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
        #endif
        vC = vec3(1.);
        #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
        #endif
        vec4 mv = modelViewMatrix * p;
        vN = normalize(normalMatrix * n); vV = normalize(-mv.xyz); vY = uv.y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uGain, uFall, uEdge;
      varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vC;
      void main(){
        float face = pow(abs(dot(vN, vV)), uEdge);
        float a = face * pow(clamp(vY, 0., 1.), uFall) * uGain;   // (clamped: MSAA samples edge pixels at the centre, extrapolating vY < 0 → pow = NaN → bloom smears it over the frame)
        gl_FragColor = vec4(uColor * vC, a);              // additive (SrcAlpha·One) → × a once
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
