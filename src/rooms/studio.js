import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STAGE, rng, canvasTex, radialTex, glowPoints, glowMat, beamMat, instanced, trs } from './common.js';
/* ============================================================
   MIDNIGHT STUDIO — a sound stage after hours. A black, wet-looking
   epoxy floor that really REFLECTS (three.js Reflector, reduced-res,
   custom shader: blurred + rippled + fresnel + fogged), a glowing
   cyclorama cove at the back washed magenta→indigo with drifting haze,
   fabric acoustic panels + wooden diffusers on the walls, tall LED
   tube practicals, Edison pendants, a neon sign, and a ceiling truss
   throwing soft volumetric beams down onto the instruments.
   Perf: the reflection pass re-renders the scene into a REFL_SCALE×
   target with MSAA off; everything else is instanced. Animation =
   uniforms / texture offsets only (no per-frame allocation).
   ============================================================ */

const HW = 50, BACK = -46, FRONT = 66, CEIL = 42;
const FOG = 0x0a0916;
const REFL_SCALE = .4;            // reflection target size vs. the canvas (perf knob)

const FLOOR_SHADER = {
  name: 'StudioFloor',
  uniforms: {
    color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
    uBase: { value: new THREE.Color(0x07070c) }, uStrength: { value: .85 },
    uFogColor: { value: new THREE.Color(FOG) }, uFogDensity: { value: .02 }, uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vUv; varying vec3 vW;
    void main(){
      vUv = textureMatrix * vec4(position, 1.);
      vW = (modelMatrix * vec4(position, 1.)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec3 uBase, uFogColor; uniform float uStrength, uFogDensity; uniform vec2 uTexel;
    varying vec4 vUv; varying vec3 vW;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
    void main(){
      vec2 w = vW.xz;
      // poured-epoxy undulation: low-freq noise bends the mirror so it reads as a FLOOR, not glass
      vec2 wob = vec2(vn(w * .23), vn(w * .23 + 17.)) - .5;
      float rough = vn(w * .08 + 3.);                      // patchy gloss
      vec4 uv = vUv; uv.xy += wob * .01 * uv.w;
      vec2 r = uTexel * (1.5 + 3.5 * rough) * uv.w;
      vec3 refl = texture2DProj(tDiffuse, uv).rgb * .36
        + (texture2DProj(tDiffuse, uv + vec4( r.x, r.y, 0., 0.)).rgb + texture2DProj(tDiffuse, uv + vec4(-r.x, r.y, 0., 0.)).rgb
         + texture2DProj(tDiffuse, uv + vec4( r.x,-r.y, 0., 0.)).rgb + texture2DProj(tDiffuse, uv + vec4(-r.x,-r.y, 0., 0.)).rgb) * .16;
      // large poured tiles: hairline seams kill the reflection
      vec2 g = abs(fract(w / 8. + .5) - .5) * 8.;
      float seam = smoothstep(.0, .06, min(g.x, g.y));
      vec3 V = normalize(cameraPosition - vW);
      float fres = .3 + .7 * pow(1. - clamp(V.y, 0., 1.), 3.);
      vec3 col = uBase * (1. + .4 * vn(w * .5)) + refl * fres * uStrength * seam * (.7 + .3 * (1. - rough));
      float d = length(vW - cameraPosition);
      float f = 1. - exp(-uFogDensity * uFogDensity * d * d);
      gl_FragColor = vec4(mix(col, uFogColor, f), 1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

function cycTex(){
  return canvasTex(8, 512, (x, w, h) => {
    const g = x.createLinearGradient(0, h, 0, 0);            // bottom (v=0) → top (v=1)
    g.addColorStop(0, '#ff5aa8'); g.addColorStop(.12, '#b23cff'); g.addColorStop(.35, '#3a2a9a');
    g.addColorStop(.7, '#140f3a'); g.addColorStop(1, '#07061a');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  });
}
function hazeTex(seed){
  return canvasTex(512, 256, (x, w, h) => {
    const R = rng(seed);
    x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'lighter';
    const blob = (cx, cy, r, a) => {
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    };
    for (let i = 0; i < 70; i++){
      const cx = R() * w, cy = h * (.3 + R() * .5), r = 30 + R() * 90, a = .05 + R() * .07;
      blob(cx, cy, r, a); blob(cx - w, cy, r, a); blob(cx + w, cy, r, a);   // tile seamlessly in x
    }
    x.globalCompositeOperation = 'destination-in';           // soft top/bottom
    const fade = x.createLinearGradient(0, 0, 0, h);
    fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(.4, 'rgba(0,0,0,1)'); fade.addColorStop(.85, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = fade; x.fillRect(0, 0, w, h);
  }, { srgb: false });
}
function capsuleTex(){                                       // a long soft glow around a vertical tube
  return canvasTex(64, 256, (x, w, h) => {
    const img = x.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++){
      const u = (i + .5) / w - .5, v = (j + .5) / h - .5;
      const dv = Math.max(0, Math.abs(v) - .38) / .12;           // rounded ends
      const r = Math.hypot(u / .5, dv);
      const a = Math.exp(-r * r * 9) * .9 + Math.exp(-r * r * 60) * .4;
      const k = (j * w + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.min(255, a * 255);
    }
    x.putImageData(img, 0, 0);
  }, { srgb: false });
}
function fabricTex(){
  return canvasTex(128, 128, (x, w) => {
    const R = rng(5);
    x.fillStyle = '#808080'; x.fillRect(0, 0, w, w);
    for (let i = 0; i < 2200; i++){ const v = 100 + R() * 70 | 0;
      x.fillStyle = `rgba(${v},${v},${v},.5)`; x.fillRect(R() * w, R() * w, 1 + R() * 2, 1); }
  });
}
function neonTex(text){
  return canvasTex(1024, 256, (x, w, h) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
    x.font = 'italic 700 150px "Snell Roundhand", "Brush Script MT", cursive';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = '#ff4fa0'; x.shadowBlur = 28; x.strokeStyle = '#ff9ccc'; x.lineWidth = 9;
    x.strokeText(text, w / 2, h / 2); x.shadowBlur = 10; x.lineWidth = 3; x.strokeStyle = '#fff0f8';
    x.strokeText(text, w / 2, h / 2);
  });
}

export default {
  key: 'studio', label: 'Midnight Studio',
  build(scene, { envMap, renderer }){
    const group = new THREE.Group();
    const R = rng(9);
    const F = STAGE.FLOOR;

    // ---- the reflective floor ----
    const pr = renderer ? renderer.getPixelRatio() : 1;
    const tw = Math.max(256, Math.round(innerWidth * pr * REFL_SCALE)), th = Math.max(256, Math.round(innerHeight * pr * REFL_SCALE));
    const floor = new Reflector(new THREE.PlaneGeometry(2 * HW, FRONT - BACK), {
      shader: FLOOR_SHADER, textureWidth: tw, textureHeight: th, multisample: 0, clipBias: .003 });
    floor.material.uniforms.uTexel.value.set(1 / tw, 1 / th);
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, F, (FRONT + BACK) / 2);
    group.add(floor);

    // ---- cyclorama: a curved cove from the floor up the back wall, washed in colour ----
    const COVE = 12, cycW = 2 * HW;
    const cycMat = new THREE.MeshBasicMaterial({ map: cycTex(), color: new THREE.Color(.9, .9, .9) });
    const prof = [];                                         // (z, y) from the floor, round the cove, up the wall
    for (let i = 0; i <= 10; i++){ const a = (i / 10) * Math.PI / 2;
      prof.push([BACK + COVE - Math.sin(a) * COVE, F + COVE - Math.cos(a) * COVE]); }
    prof.push([BACK, CEIL + 4]);
    const seg = prof.map((p, i) => i ? Math.hypot(p[0] - prof[i - 1][0], p[1] - prof[i - 1][1]) : 0);
    const total = seg.reduce((a, b) => a + b, 0);
    const pos = [], uv = [], idx = [];
    let run = 0;
    prof.forEach((p, i) => {
      run += seg[i];
      pos.push(-cycW / 2, p[1], p[0], cycW / 2, p[1], p[0]); uv.push(0, run / total, 1, run / total);
      if (i){ const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    });
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    cg.setIndex(idx);
    const cycMesh = new THREE.Mesh(cg, cycMat); cycMat.side = THREE.DoubleSide;
    group.add(cycMesh);
    // ground-row glow along the cove's foot (the cyc lights)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(cycW, 16), glowMat(radialTex(128, [[0, 1], [.5, .3], [1, 0]]), 0xff4f9a, .5));
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, F + .1, BACK + COVE * .7);
    group.add(ground);

    // ---- drifting haze in front of the cyc (layered, scrolled by texture offset) ----
    const hazes = [];
    [[BACK + 8, 4, .5, 0xa070ff, 11], [BACK + 18, 0, .3, 0xff6ab8, 23], [-10, 8, .12, 0x6a8cff, 37]].forEach(([z, y, op, col, seed]) => {
      const t = hazeTex(seed); t.wrapS = THREE.RepeatWrapping;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(cycW * 1.1, 46), glowMat(t, col, op, { fog: true }));
      m.position.set(0, y, z); group.add(m); hazes.push(t);
    });

    // ---- walls: dark fabric, acoustic panels in a grid, wooden diffusers ----
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x101018, roughness: .95 });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(2 * HW, CEIL - F), wallMat);
    front.position.set(0, (CEIL + F) / 2, FRONT); front.rotation.y = Math.PI; group.add(front);
    for (const s of [-1, 1]){
      const w = new THREE.Mesh(new THREE.PlaneGeometry(FRONT - BACK, CEIL - F), wallMat);
      w.rotation.y = -s * Math.PI / 2; w.position.set(s * HW, (CEIL + F) / 2, (FRONT + BACK) / 2); group.add(w);
    }
    const ceilM = new THREE.Mesh(new THREE.PlaneGeometry(2 * HW, FRONT - BACK), wallMat);
    ceilM.rotation.x = Math.PI / 2; ceilM.position.set(0, CEIL, (FRONT + BACK) / 2); group.add(ceilM);

    const panelMat = new THREE.MeshStandardMaterial({ map: fabricTex(), roughness: 1, metalness: 0 });
    const panelM = [], panelC = [];
    const PAL = [0x2a2d3a, 0x22263a, 0x332a38, 0x1f2f33, 0x3a3030];
    for (const s of [-1, 1]) for (let iz = 0; iz < 11; iz++) for (let iy = 0; iy < 5; iy++){
      const z = BACK + 6 + iz * 9.6, y = F + 6 + iy * 11;
      if (iy === 4 || (iy === 2 && iz % 4 === 1)) continue;   // leave room for the diffusers
      panelM.push(trs(s * (HW - .5), y, z, 0, Math.PI / 2, 0, 8.6, 10, .9));
      panelC.push(new THREE.Color(PAL[(iz * 3 + iy + (s > 0)) % PAL.length]));
    }
    const panels = instanced(new THREE.BoxGeometry(1, 1, 1), panelMat, panelM);
    panelC.forEach((c, i) => panels.setColorAt(i, c));
    group.add(panels);
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: .55, metalness: .05, envMap, envMapIntensity: .3 });
    const qrdM = [];
    for (const s of [-1, 1]) for (let iz = 1; iz < 9; iz += 4) for (let i = 0; i < 11; i++) for (let j = 0; j < 12; j++){
      const dep = .3 + R() * 1.4, zc = BACK + 6 + iz * 9.6;
      qrdM.push(trs(s * (HW - dep / 2), F + 23 + j * .8, zc - 4.4 + i * .8, 0, 0, 0, dep, .74, .74));
    }
    group.add(instanced(new THREE.BoxGeometry(1, 1, 1), woodMat, qrdM));

    // ---- practicals: tall LED tube stands + Edison pendants + a neon sign ----
    const tubeCol = [0xffb36a, 0x7fc8ff, 0xff7ab8, 0xffb36a, 0x7fc8ff, 0xff7ab8, 0xffb36a, 0x7fc8ff];
    const tubeSpots = [[-44, -30], [-46, 6], [-44, 40], [44, -30], [46, 6], [44, 40], [-22, -38], [22, -38]];
    const TH = 26;
    const tubeM = [], standM = [], tubeGlowM = [], tubeGlowC = [], gP = [], gC = [], gS = [], gPh = [];
    tubeSpots.forEach(([x, z], i) => {
      tubeM.push(trs(x, F + 4 + TH / 2, z, 0, 0, 0, 1, TH, 1));
      standM.push(trs(x, F + 2, z, 0, 0, 0, 1, 4, 1));
      const c = new THREE.Color(tubeCol[i]);
      tubeGlowM.push(trs(x, F + 4 + TH / 2, z, 0, 0, 0, 7, TH + 6, 7)); tubeGlowC.push(c);
    });
    const tubes = new THREE.InstancedMesh(new THREE.CylinderGeometry(.32, .32, 1, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }), tubeM.length);
    tubeM.forEach((m, i) => { tubes.setMatrixAt(i, m); tubes.setColorAt(i, new THREE.Color(tubeCol[i]).multiplyScalar(3)); });
    group.add(tubes);
    // each tube's soft glow: crossed additive planes with a long capsule falloff (no beads)
    const tubeGlowGeo = mergeGeometries([new THREE.PlaneGeometry(1, 1), new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2)]);
    const tubeGlow = new THREE.InstancedMesh(tubeGlowGeo, glowMat(capsuleTex(), 0xffffff, .55, { fog: true }), tubeGlowM.length);
    tubeGlowM.forEach((m, i) => { tubeGlow.setMatrixAt(i, m); tubeGlow.setColorAt(i, tubeGlowC[i]); });
    group.add(tubeGlow);
    const metal = new THREE.MeshStandardMaterial({ color: 0x1a1c24, metalness: .8, roughness: .35, envMap });
    group.add(instanced(new THREE.CylinderGeometry(.12, .9, 1, 6), metal, standM));

    const bulbM = [], cordM = [];
    for (let i = 0; i < 9; i++){
      const x = -32 + i * 8, z = 26 + (i % 2) * 6, y = 27 + (i % 3) * 2.5;
      bulbM.push(trs(x, y, z)); cordM.push(trs(x, (y + CEIL) / 2, z, 0, 0, 0, 1, CEIL - y, 1));
      gP.push(x, y, z); gC.push(.8, .45, .16); gS.push(6); gPh.push(R());
    }
    const bulbs = instanced(new THREE.SphereGeometry(.45, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.7, .7) }), bulbM);
    group.add(bulbs, instanced(new THREE.CylinderGeometry(.03, .03, 1, 4), metal, cordM));
    const glows = glowPoints(gP, { colors: gC, sizes: gS, phases: gPh, map: radialTex(64, [[0, .7], [.2, .3], [.6, .05], [1, 0]]), flicker: .06, rate: 3 });
    group.add(glows);

    const neon = new THREE.Mesh(new THREE.PlaneGeometry(24, 6),
      new THREE.MeshBasicMaterial({ map: neonTex('Cascade'), color: new THREE.Color(1.8, 1.8, 1.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    neon.position.set(-HW + 2.2, F + 34, 4); neon.rotation.y = Math.PI / 2; group.add(neon);
    // a dark backing plate on stand-offs, proud of the panels + diffusers, so the sign reads clean
    const plate = new THREE.Mesh(new THREE.BoxGeometry(.25, 7.4, 25.5), new THREE.MeshStandardMaterial({ color: 0x050508, roughness: .4, metalness: .6, envMap, envMapIntensity: .4 }));
    plate.position.set(-HW + 2.0, F + 34, 4); group.add(plate);
    group.add(instanced(new THREE.CylinderGeometry(.08, .08, 1.8, 6).rotateZ(Math.PI / 2), metal,
      [[-2.6, -10], [2.6, -10], [-2.6, 10], [2.6, 10]].map(([dy, dz]) => trs(-HW + 1.05, F + 34 + dy, 4 + dz))));

    // ---- ceiling truss + volumetric beams onto the stage ----
    const trussM = [];
    for (const z of [-16, 14]) for (const dy of [0, 1.6]) for (const dz of [0, 1.6])
      trussM.push(trs(0, CEIL - 6 + dy, z + dz, 0, 0, 0, 2 * HW - 8, .18, .18));
    for (const x of [-36, 36]) for (const dy of [0, 1.6]) for (const dx of [0, 1.6])
      trussM.push(trs(x + dx, CEIL - 6 + dy, -1, 0, 0, 0, .18, .18, 32));
    group.add(instanced(new THREE.BoxGeometry(1, 1, 1), metal, trussM));
    const BEAMS = [[-30, -16, -18, 4, 0xa58bff], [-12, -16, -6, 0, 0xffb07a], [12, -16, 8, 0, 0x8fc4ff], [30, -16, 20, 2, 0xff8ac8],
                   [-24, 14, -22, -4, 0x8fc4ff], [0, 14, 0, 6, 0xffd6a0], [24, 14, 24, -4, 0xa58bff]];
    const beamGeo = new THREE.CylinderGeometry(.6, 6, 1, 24, 1, true).translate(0, -.5, 0);
    const beams = new THREE.InstancedMesh(beamGeo, beamMat({ gain: .3, falloff: 1.4, edge: 2.2 }), BEAMS.length);
    const fixM = [], lensM = [];
    const down = new THREE.Vector3(0, -1, 0), q = new THREE.Quaternion(), e = new THREE.Euler();
    BEAMS.forEach(([x, z, tx, tz, col], i) => {
      const src = new THREE.Vector3(x, CEIL - 6.5, z), tgt = new THREE.Vector3(tx, -2, tz);
      const d = tgt.clone().sub(src), len = d.length() * 1.15;
      q.setFromUnitVectors(down, d.normalize()); e.setFromQuaternion(q);
      beams.setMatrixAt(i, trs(src.x, src.y, src.z, e.x, e.y, e.z, 1, len, 1));
      beams.setColorAt(i, new THREE.Color(col));
      fixM.push(trs(src.x, src.y + .6, src.z, e.x, e.y, e.z));
      lensM.push(trs(src.x, src.y - .05, src.z, e.x, e.y, e.z));
    });
    beams.frustumCulled = false; group.add(beams);
    group.add(instanced(new THREE.CylinderGeometry(.9, .75, 1.6, 12), metal, fixM));
    group.add(instanced(new THREE.CircleGeometry(.7, 16).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.4, 3), side: THREE.DoubleSide }), lensM));

    const beamBase = beams.material.uniforms.uGain.value;
    const cycBase = cycMat.color.clone();
    return {
      group, ...STAGE, HW, BACK, FRONT, CEIL,
      fog: new THREE.FogExp2(FOG, .02), background: new THREE.Color(FOG),
      mood: { ambient: [0x1c1a30, 1.4], hemi: [0x6a64b0, 0x2a1020, .5] },
      update(dt, songTime, camera, energy = 0){
        hazes[0].offset.x = songTime * .004; hazes[1].offset.x = -songTime * .006; hazes[2].offset.x = songTime * .003;
        glows.material.uniforms.uTime.value = songTime;
        beams.material.uniforms.uGain.value = beamBase * (1 + .5 * energy);
        cycMat.color.copy(cycBase).multiplyScalar(1 + .25 * energy);
      },
      resize(w, h, pr){                                      // keep the mirror sharp across rotations / DPR changes
        const tw = Math.max(256, Math.round(w * pr * REFL_SCALE)), th = Math.max(256, Math.round(h * pr * REFL_SCALE));
        floor.getRenderTarget().setSize(tw, th);
        floor.material.uniforms.uTexel.value.set(1 / tw, 1 / th);
      },
      dispose(){},
    };
  },
};
