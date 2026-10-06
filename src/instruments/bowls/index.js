/* ============================================================
   SINGING BOWLS — the sustained pad / chord voice.
   (mechanism + closed-form timing: solve.js · DSP: voice.js)

   One bronze bowl per pitch (size ∝ pitch: bigger = lower), glazed
   inside with the lane's glow, a shallow pool of luminous water in the
   bottom. One marble per bowl, hanging from an electromagnet on a motor-
   driven ROTOR above it. To sound a note the rotor spins up, lowers the
   marble onto the inner wall at exactly the orbit speed and lets go; the
   marble rolls round under the rim — the conical-pendulum orbit,
   v² = g·r·tanθ — for exactly the note's length, and the bowl SINGS:
   its rim flexes in the (2,0) wine-glass mode whose antinodes follow the
   ball round, the glaze brightens, the water shivers into standing
   ripples. At note-off the rotor, phase-locked, plucks it back off.
   ============================================================ */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { noteNum } from '../../engine.js';
import { eventTimes, lanesByNote, makeEdge } from '../clock.js';
import { bowlGeom, bowlLane, bowlAt, noteLane, noteAt, singEnv, THETA_RIM, THETA_ORB, RIM_NODE } from './solve.js';
import { bowlVoice } from './voice.js';

const TRAIL_N  = 26;        // ghost-trail samples per marble
const TRAIL_DT = .016;      // seconds between them
const ROW_Z    = 1.95;      // two staggered rows at z = ∓ROW_Z
const TIER     = 1.0;       // back row stands this much higher
const PED      = .35;       // pedestal height under every bowl (front row)
const GAP      = .3;        // clear air between bowls in a row
const ROD      = .14;       // magnet drop-rod length (arm → magnet top)
const BEAM_DZ  = .4;        // each row's gantry beam runs this far behind the bowl axes

/* Bake several static meshes sharing one material into ONE mesh (draw-call budget). */
function bake(meshes, mat){
  const geos = meshes.map(m => { m.updateMatrix(); const g = m.geometry.clone().applyMatrix4(m.matrix); m.geometry.dispose(); return g; });
  return new THREE.Mesh(mergeGeometries(geos), mat);
}

/* signature colour: deep violet (low bowls) → aurora aqua (high) */
function laneColor(n){
  const u = Math.min(1, Math.max(0, (n - 48) / 26));
  return new THREE.Color().setHSL(.76 - .26 * u, .9, .56);
}

const RIM_WAVE_VS = `
  float bAng = atan(-position.z, position.x);
  float bH = clamp((position.y - uY0) / (uY1 - uY0), 0.0, 1.0); bH *= bH;
  float bLip = bH * bH * bH;
  float bMode = cos(2.0 * (bAng - uPhi));
  float bD = uAmp * bH * bMode * (.78 + .22 * sin(uTime * 47.0));
  vec2 bDir = length(position.xz) > 1e-5 ? normalize(position.xz) : vec2(0.0);
  transformed.xz += bDir * bD;
  vRing = bLip * (.3 + .7 * max(bMode, 0.0));
  vLip = bLip;`;

function rimWaveMaterial(mat, U){
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'uniform float uAmp, uPhi, uTime, uY0, uY1;\nvarying float vRing, vLip;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + RIM_WAVE_VS);
    sh.fragmentShader = 'uniform float uGlow, uFlash;\nvarying float vRing, vLip;\n' + sh.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance *= 1.0 + uGlow * vRing * 5.0 + uFlash * vLip * 9.0;`);
  };
  return mat;
}

function waterMaterial(color, envMap, U){
  const mat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(.35), metalness: .3, roughness: .06,
    envMap, envMapIntensity: 1.6, emissive: color, emissiveIntensity: .22, transparent: true, opacity: .9 });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'uniform float uAmp, uPhi, uTime, uR, uKick, uSince;\nvarying float vW;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float wr = length(position.xz) / uR;
        float wa = atan(-position.z, position.x);
        // Faraday ripples: a standing ring pattern, lobed by the rim mode that drives it
        float w = uAmp * sin(wr * 15.0) * (.55 + .45 * cos(4.0 * (wa - uPhi))) * cos(uTime * 21.0) * smoothstep(0.0, .35, wr);
        // the touch-down: one ring runs in from the wall and fades
        float rf = 1.0 - uSince * 1.6, dr = wr - rf;
        float kw = uKick * exp(-dr * dr * 60.0) * cos(dr * 40.0) * exp(-uSince * 2.5);
        transformed.y += w + kw;
        vW = abs(w) / max(uAmp, 1e-4) + abs(kw) / max(uKick, 1e-4) * step(1e-5, uKick) * .8;`);
    sh.fragmentShader = 'varying float vW;\n' + sh.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance *= 1.0 + vW * 2.5;`);
  };
  return mat;
}

/* ---- one bowl: bronze outside, glowing glaze inside + over the lip, water in the well.
   Lathe profiles from the solve's own geometry, so the surface the ball rides IS the
   inner sphere Rb (contact honesty is structural). ---- */
function buildBowl(G, color, envMap, glowTex){
  const { Rb, wall, foot, cy } = G;
  const Ro = Rb + wall, SEG = 72;
  const U = { uAmp: { value: 0 }, uPhi: { value: 0 }, uTime: { value: 0 }, uY0: { value: foot }, uY1: { value: G.rimY },
              uGlow: { value: 0 }, uFlash: { value: 0 } };
  // outer shell (bronze): flat foot → outer sphere → up to the lip
  const out = [new THREE.Vector2(0, 0)];
  const footR = Ro * .5;
  out.push(new THREE.Vector2(footR, 0));
  const thF = Math.acos(Math.min(1, (cy - foot * .55) / Ro));
  for (let i = 0; i <= 26; i++){
    const th = thF + (THETA_RIM - thF) * i / 26;
    out.push(new THREE.Vector2(Ro * Math.sin(th), cy - Ro * Math.cos(th)));
  }
  const bronze = rimWaveMaterial(new THREE.MeshStandardMaterial({ color: 0xc08a4a, metalness: .92, roughness: .3, envMap,
    envMapIntensity: 1.25, emissive: color, emissiveIntensity: .0 }), U);
  const outer = new THREE.Mesh(new THREE.LatheGeometry(out, SEG), bronze);
  // inner glaze: the riding sphere from the bottom up, then rolled over the lip to the outside
  const inn = [];
  for (let i = 0; i <= 30; i++){
    const th = THETA_RIM * i / 30;
    inn.push(new THREE.Vector2(Rb * Math.sin(th), cy - Rb * Math.cos(th)));
  }
  const lipC = new THREE.Vector2((Rb + wall / 2) * Math.sin(THETA_RIM), cy - (Rb + wall / 2) * Math.cos(THETA_RIM));
  const nr = Math.sin(THETA_RIM), ny = -Math.cos(THETA_RIM);     // outward wall normal (r, y)
  const tr = Math.cos(THETA_RIM), ty = Math.sin(THETA_RIM);      // up the wall
  for (let i = 1; i <= 8; i++){                          // half-round lip, inner edge → over the top → outer edge
    const a = Math.PI * i / 8, h = wall / 2;
    inn.push(new THREE.Vector2(lipC.x + h * (-nr * Math.cos(a) + tr * Math.sin(a)), lipC.y + h * (-ny * Math.cos(a) + ty * Math.sin(a))));
  }
  // order: the lathe wants the profile ordered so normals face the viewer; render both sides
  const glaze = rimWaveMaterial(new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(.16),
    metalness: .55, roughness: .22, envMap, envMapIntensity: .4, emissive: color, emissiveIntensity: .08,
    side: THREE.DoubleSide }), U);
  const inner = new THREE.Mesh(new THREE.LatheGeometry(inn, SEG), glaze);
  // the luminous pool in the well
  const thW = .62, wR = Rb * Math.sin(thW), wY = cy - Rb * Math.cos(thW);
  const WU = { uAmp: { value: 0 }, uPhi: { value: 0 }, uTime: { value: 0 }, uR: { value: wR }, uKick: { value: 0 }, uSince: { value: 9 } };
  const wgeo = new THREE.RingGeometry(0, wR * .995, 64, 14); wgeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(wgeo, waterMaterial(color, envMap, WU));
  water.position.y = wY;
  // a soft halo hanging in the mouth of the bowl, brightening as it sings
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.position.y = G.rimY + .1; halo.scale.setScalar(G.rimR * 3.0);
  const g = new THREE.Group(); g.add(outer, inner, water, halo);
  return { g, U, WU, glaze, halo };
}

/* ---- the rotor: hub on a sliding spindle, a radial arm out to radius r, a drop rod,
   the electromagnet whose face sits exactly on the hanging marble's top, and a
   counterweight so the rotor is balanced. Local origin = the hub; +x = the arm. ---- */
function buildRotor(G, chrome, dark, glowTex, color){
  const g = new THREE.Group();
  const magH = Math.max(.14, G.rb * 1.4), magR = Math.max(.09, G.rb * 1.05);
  const drop = ROD;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .16, 16), chrome);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(G.r + .55, .055, .07), chrome);
  arm.position.x = (G.r - .55) / 2;
  const cw = new THREE.Mesh(new THREE.SphereGeometry(.11, 16, 12), dark);
  cw.position.x = -.55;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, drop, 8), chrome);
  rod.position.set(G.r, -drop / 2, 0);
  const mag = new THREE.Mesh(new THREE.CylinderGeometry(magR, magR * .92, magH, 18), chrome);
  mag.position.set(G.r, -drop - magH / 2, 0);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(magR * .86, .025, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0x331a10, emissive: new THREE.Color(0xff6a2a), emissiveIntensity: .1 }));
  coil.rotation.x = Math.PI / 2; coil.position.set(G.r, -drop - magH + .02, 0);
  const cHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff7a3a, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  cHalo.scale.setScalar(magR * 4.5); cHalo.position.copy(coil.position);
  g.add(bake([hub, arm, rod, mag], chrome), cw, coil, cHalo);
  // the hub's height above the ball centre: ball top (rb) + magnet + drop
  return { g, coil, cHalo, hubAboveBall: G.rb + magH + drop, cHaloS: magR * 4.5 };
}

/* ---- the marble's skin: a glass ball with two glowing great circles (equator + one
   meridian), so you can SEE it roll. Pure data textures (no DOM), made per build. ---- */
function marbleTextures(){
  const W = 64, H = 32, map = new Uint8Array(W * H * 4), emi = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const u = (x + .5) / W, v = (y + .5) / H;
    const d = Math.min(Math.abs(v - .5) * 2, Math.min(Math.abs(u - .25), Math.abs(u - .75)) * 4 * Math.sin(Math.PI * v));
    const band = Math.max(0, 1 - d / .14) ** 1.5;
    const i = 4 * (y * W + x);
    map[i] = 150 + 105 * band; map[i + 1] = 160 + 95 * band; map[i + 2] = 185 + 70 * band; map[i + 3] = 255;
    const e = 40 + 215 * band; emi[i] = emi[i + 1] = emi[i + 2] = e; emi[i + 3] = 255;
  }
  const mk = (data, srgb) => { const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
  return { map: mk(map, true), emi: mk(emi, false) };
}

/* ---- the marble: a glass core that ROLLS (spin group: yaw with its orbit / the rotor,
   then its own rolling angle about v̂ × n̂, a pure fn of the orbit time), a lane glow,
   and its ghost trail (one Points) ---- */
const ROLL_AXIS = new THREE.Vector3(-Math.cos(THETA_ORB), -Math.sin(THETA_ORB), 0).normalize();
function buildBall(G, color, envMap, glowTex, tex){
  const core = new THREE.Mesh(new THREE.SphereGeometry(G.rb, 28, 18), new THREE.MeshStandardMaterial({
    color: 0xffffff, map: tex.map, metalness: .35, roughness: .14, envMap, envMapIntensity: 1.2,
    emissive: color.clone().lerp(new THREE.Color(0xffffff), .15), emissiveMap: tex.emi, emissiveIntensity: .6 }));
  const spin = new THREE.Group(); spin.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: .12,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(G.rb * 6);
  const g = new THREE.Group(); g.add(spin, halo);
  const pos = new Float32Array(TRAIL_N * 3), col = new Float32Array(TRAIL_N * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const trail = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTex, size: G.rb * 7, vertexColors: true,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
  trail.frustumCulled = false;
  return { g, spin, core, halo, trail, pos, col };
}

/* ---- the WAKE: the rubbed track glowing ON THE GLAZE — a ribbon lying on the bowl's
   inner wall (sphere Rb, just proud of it) along the contact line, trailing the ball
   round. Built once in its own frame (a = 0 at the contact point, running back to
   −WAKE); per frame it is only ROTATED to the ball's angle and trimmed while the orbit
   is young — and it fades by its TRIMMED length (uGrown), so it grows out of the
   touch-down point as a soft comet tail, never a hard-edged card. ---- */
const WAKE = 2.6, WAKE_K = 64;
const WAKE_VS = `
  attribute vec3 aCol; attribute float k01, side;
  varying vec3 vC; varying float vK, vS;
  void main(){ vC = aCol; vK = k01; vS = side;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const WAKE_FS = `
  uniform float uGrown, uOp; varying vec3 vC; varying float vK, vS;
  void main(){
    float f = pow(max(0.0, 1.0 - vK / max(uGrown, 1e-3)), 1.6) * (1.0 - vS * vS);
    gl_FragColor = vec4(vC * f * uOp, 1.0); }`;
function buildWake(G, color){
  const pos = [], col = [], k01 = [], side = [], idx = [];
  const Rw = G.Rb - .012 - .006 * G.Rb;                   // just proud of the glaze
  for (let k = 0; k <= WAKE_K; k++){
    const q = k / WAKE_K, a = -WAKE * q, hw = G.rb * .6 * Math.pow(1 - q, .5) * Math.min(1, q * 30 + .35) + .004;
    const c = color.clone().lerp(new THREE.Color(0xffffff), .5 * (1 - q) ** 8).multiplyScalar(2.2);
    for (const sgn of [-1, 1]){
      const th = THETA_ORB + sgn * hw / Rw;               // across the track, along the wall
      const rr = Rw * Math.sin(th), yy = G.cy - Rw * Math.cos(th);
      pos.push(rr * Math.cos(a), yy, -rr * Math.sin(a));
      col.push(c.r, c.g, c.b); k01.push(q); side.push(sgn);
    }
    if (k){ const b = 2 * k; idx.push(b - 2, b - 1, b, b - 1, b + 1, b); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('k01', new THREE.Float32BufferAttribute(k01, 1));
  geo.setAttribute('side', new THREE.Float32BufferAttribute(side, 1));
  geo.setIndex(idx);
  const U = { uGrown: { value: 1 }, uOp: { value: 1 } };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: U, vertexShader: WAKE_VS, fragmentShader: WAKE_FS,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  return { mesh, U };
}

/* ---- layout: pitch order left → right, zig-zag across two rows when there are many.
   Bowls are spaced apart, NEVER shrunk (size is the note's). ---- */
function layout(geoms){
  const n = geoms.length, rows = n <= 4 ? 1 : 2;
  const R = geoms.map(G => G.rimR + G.wall + .05);
  const xs = [];
  for (let i = 0; i < n; i++){
    let x = i ? xs[i - 1] + .25 : 0;
    const j = i - rows;
    if (j >= 0) x = Math.max(x, xs[j] + R[j] + R[i] + GAP);
    xs.push(x);
  }
  let lo = Infinity, hi = -Infinity;
  xs.forEach((x, i) => { lo = Math.min(lo, x - R[i]); hi = Math.max(hi, x + R[i]); });
  const mid = (lo + hi) / 2;
  return geoms.map((G, i) => {
    const back = rows === 2 && i % 2 === 0;
    return { x: xs[i] - mid, z: rows === 1 ? 0 : (back ? -ROW_Z : ROW_Z), y: PED + (back ? TIER : 0), back, R: R[i] };
  });
}

export default {
  key: 'bowls',
  label: 'Singing Bowls',
  wet: true,
  lookHeight: 1.8,

  voice(id){ return bowlVoice(id); },

  make({ envMap, glowTex }){
    let lanes = [], start = -Infinity;
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: .15, envMap, envMapIntensity: 1.3 });
    const dark   = new THREE.MeshStandardMaterial({ color: 0x232733, metalness: .7, roughness: .45, envMap });
    const cloth  = new THREE.MeshStandardMaterial({ color: 0x2a1d48, metalness: 0, roughness: .95 });

    function build(part, { rollT, beat, P, start: s0, station, floorY }){
      const group = new THREE.Group();
      lanes = []; start = s0;
      const W = station?.w ?? 10, Dd = station?.d ?? 9;
      const byNote = lanesByNote(eventTimes(part, { rollT, beat }));
      const notes = Object.keys(byNote).sort((a, b) => noteNum(a) - noteNum(b));
      const geoms = notes.map(bowlGeom);
      const spots = layout(geoms);
      const tex = marbleTextures();
      const darkParts = [], chromeParts = [];
      const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };

      // ---- the deck: a dark slab with a glowing trim, the back tier, a pillar to the floor ----
      const deck = new THREE.Mesh(new THREE.BoxGeometry(W, .3, Dd), dark);
      deck.position.y = -.15; darkParts.push(deck);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(W + .04, .05, Dd + .04), new THREE.MeshStandardMaterial({
        color: 0x111122, emissive: new THREE.Color(0x8a6bff), emissiveIntensity: .7 }));
      trim.position.y = -.05; group.add(trim);
      const hasBack = spots.some(s => s.back);
      if (hasBack) darkParts.push(at(new THREE.Mesh(new THREE.BoxGeometry(W - .3, TIER, Dd / 2 - .2), dark), 0, TIER / 2, -Dd / 4 - .1));
      if (isFinite(floorY) && floorY < -1)
        darkParts.push(at(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, -floorY - .3, 24), dark), 0, (floorY - .3) / 2, 0));

      const rowsInfo = new Map();                       // row z → { lo, hi, deckY, beamY, z }
      notes.forEach((note, i) => {
        const G = geoms[i], sp = spots[i], color = laneColor(G.n);
        const evs = byNote[note];
        const ns = evs.map(e => ({ t: e.t, tDur: e.tDur, vel: e.vel }));
        const L = bowlLane(ns, P, G);
        const N = noteLane(ns, P, L);
        const deckY = sp.back ? TIER : 0, pedH = sp.y - deckY;

        const bowlG = new THREE.Group(); bowlG.position.set(sp.x, sp.y, sp.z);
        // pedestal + cushion ring the bowl sits in
        darkParts.push(at(new THREE.Mesh(new THREE.CylinderGeometry(G.Rb * .42, G.Rb * .55, pedH, 24), dark), sp.x, sp.y - pedH / 2, sp.z));
        const cush = new THREE.Mesh(new THREE.TorusGeometry(G.Rb * .52, G.Rb * .11, 10, 32), cloth);
        cush.rotation.x = Math.PI / 2; cush.position.y = G.Rb * .06;
        const bowl = buildBowl(G, color, envMap, glowTex);
        bowl.g.position.y = G.Rb * .04;                  // the foot rests in the cushion
        bowlG.add(cush, bowl.g);

        // rotor + its motor/spindle, everything in the bowl frame (axis at x = z = 0)
        const rotor = buildRotor(G, chrome, dark, glowTex, color);
        const base = bowl.g.position.y;                  // bowl-local solve coords → bowlG coords
        const hubLow = base + G.yo + rotor.hubAboveBall, hubHigh = hubLow + G.lift;
        // the motor: a short can hung from the row's gantry beam. The spindle runs right
        // through it and pokes out of the top when the rotor is raised — you SEE the lift.
        // The can's ring glows with the rotor's speed.
        const motorH = .42, motorBot = hubHigh + .22, motorTop = motorBot + motorH;
        darkParts.push(at(new THREE.Mesh(new THREE.CylinderGeometry(.19, .21, motorH, 24), dark), sp.x, sp.y + motorBot + motorH / 2, sp.z));
        chromeParts.push(at(new THREE.Mesh(new THREE.CylinderGeometry(.12, .19, .08, 24), chrome), sp.x, sp.y + motorTop + .04, sp.z));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.215, .028, 8, 32),
          new THREE.MeshStandardMaterial({ color: 0x101018, emissive: color, emissiveIntensity: .2 }));
        ring.rotation.x = Math.PI / 2; ring.position.y = motorBot + .07;
        const spLen = motorTop + .06 - hubLow;           // at the LOW stop its top just shows above the cap
        const spindle = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, spLen, 10), chrome);
        bowlG.add(ring, spindle, rotor.g);
        const row = rowsInfo.get(sp.z) || { lo: Infinity, hi: -Infinity, deckY, top: -Infinity, z: sp.z, cans: [] };
        row.lo = Math.min(row.lo, sp.x - sp.R); row.hi = Math.max(row.hi, sp.x + sp.R);
        row.top = Math.max(row.top, sp.y + motorTop); row.cans.push({ x: sp.x, y: sp.y + motorBot + motorH * .5 });
        rowsInfo.set(sp.z, row);

        const ball = buildBall(G, color, envMap, glowTex, tex);
        ball.trail.position.y = base;
        const wake = buildWake(G, color);
        wake.mesh.position.y = base;
        bowlG.add(ball.g, ball.trail, wake.mesh);
        group.add(bowlG);
        lanes.push({ note, G, L, N, color, sp, bowlG, bowl, rotor, ball, wake, ring, spindle,
          base, hubLow, spLen, edge: makeEdge(.25), phi: -Math.PI / 2, strikePos: new THREE.Vector3(),
          q: new THREE.Quaternion() });
      });

      // ---- the gantries: one chrome beam per row, behind the bowl axes, on two end posts
      // standing on that row's deck; every motor can hangs from it on a hanger + clamp ----
      for (const row of rowsInfo.values()){
        const beamY = row.top + .12, bz = row.z - BEAM_DZ;
        const px = [Math.max(-W / 2 + .1, row.lo - .14), Math.min(W / 2 - .1, row.hi + .14)];
        const len = px[1] - px[0];
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, len, 12), chrome);
        beam.rotation.z = Math.PI / 2; chromeParts.push(at(beam, (px[0] + px[1]) / 2, beamY, bz));
        for (const x of px){
          const h = beamY - row.deckY;
          chromeParts.push(at(new THREE.Mesh(new THREE.CylinderGeometry(.075, .1, h, 12), chrome), x, row.deckY + h / 2, bz));
          chromeParts.push(at(new THREE.Mesh(new THREE.SphereGeometry(.11, 14, 10), chrome), x, beamY, bz));
          darkParts.push(at(new THREE.Mesh(new THREE.CylinderGeometry(.2, .24, .06, 18), dark), x, row.deckY + .03, bz));
        }
        for (const c of row.cans){
          const h = beamY - c.y;
          chromeParts.push(at(new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, h, 8), chrome), c.x, c.y + h / 2, bz + .06));
          chromeParts.push(at(new THREE.Mesh(new THREE.BoxGeometry(.16, .12, BEAM_DZ - .12), chrome), c.x, c.y, row.z - BEAM_DZ / 2 - .03));
          chromeParts.push(at(new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .1, 12), chrome), c.x, beamY, bz));
        }
      }
      group.add(bake(darkParts, dark), bake(chromeParts, chrome));
      return group;
    }

    function update(songTime, P, dt, { started, skipStrikes, onStrike }){
      const t = started ? songTime : start;
      for (const ln of lanes){
        const { G, L, N } = ln;
        const b = bowlAt(L, t, start);

        // the strike: the marble touches the wall (note-on), once
        const c = noteAt(N, t, start);
        if (started && c.live && ln.edge.check(c.abs, c.since, skipStrikes)){
          const p = bowlAt(L, c.abs + 1e-6, start);
          ln.strikePos.set(ln.sp.x + p.x, ln.sp.y + ln.base + p.y, ln.sp.z + p.z);
          onStrike && onStrike({ note: ln.note, vel: c.rec.vel, pos: ln.strikePos.clone(), color: ln.color.getHex(),
            dur: c.rec.dur, shake: 0, sparks: 4, light: .8 });
        }
        const sing = c.live ? singEnv(c.since, c.rec.dur) * (.45 + .55 * c.rec.vel) : 0;
        const touch = c.live && c.since >= 0 ? Math.exp(-c.since * 6) * (.5 + .5 * c.rec.vel) : 0;

        // rotor + spindle + motor glow
        ln.rotor.g.position.y = ln.hubLow + b.lift;
        ln.rotor.g.rotation.y = b.angle;
        ln.spindle.position.y = ln.hubLow + b.lift + ln.spLen / 2;
        ln.ring.material.emissiveIntensity = .15 + 2.2 * Math.min(1, Math.abs(b.omegaR) / G.omega);
        let coil = 0;
        if (b.attached){ coil = 1 + (isFinite(b.sinceOff) ? 2.4 * Math.exp(-b.sinceOff * 10) : 0); }
        ln.rotor.coil.material.emissiveIntensity = .1 + 2.6 * coil;
        ln.rotor.cHalo.material.opacity = Math.min(.8, .35 * coil);

        // the marble: yaws with its orbit (or with the rotor that holds it) and rolls
        ln.ball.g.position.set(b.x, ln.base + b.y, b.z);
        ln.ball.spin.rotation.y = b.orbiting ? b.phiBall : b.angle;
        ln.ball.core.quaternion.setFromAxisAngle(ROLL_AXIS, b.roll || 0);
        ln.ball.core.material.emissiveIntensity = .6 + (b.orbiting ? .9 + 1.2 * touch : 0);
        ln.ball.halo.material.opacity = b.orbiting ? .3 + .25 * touch : .12;

        // the ghost wake: the marble's own past, re-sampled from the pure fn
        const pos = ln.ball.pos, col = ln.ball.col;
        for (let j = 0; j < TRAIL_N; j++){
          const tj = t - (j + 1) * TRAIL_DT;
          const s = tj >= start && started ? bowlAt(L, tj, start) : null;
          const f = (1 - (j + 1) / (TRAIL_N + 1)) ** 1.2;
          const k = !s ? 0 : s.orbiting ? (b.orbiting ? 0 : 1.2) : Math.min(.6, Math.abs(s.omegaR) / G.omega * .5);
          if (s){ pos[3 * j] = s.x; pos[3 * j + 1] = s.y; pos[3 * j + 2] = s.z; }
          col[3 * j] = ln.color.r * f * k; col[3 * j + 1] = ln.color.g * f * k; col[3 * j + 2] = ln.color.b * f * k;
        }
        ln.ball.trail.geometry.attributes.position.needsUpdate = true;
        ln.ball.trail.geometry.attributes.color.needsUpdate = true;

        // the wake on the glaze: only while the marble rolls; grows out of the touch-down point
        const wk = ln.wake;
        if (b.orbiting){
          wk.mesh.visible = true;
          wk.mesh.rotation.y = b.phiBall;
          const grown = Math.min(1, G.omega * b.sinceOn / WAKE);
          wk.mesh.geometry.setDrawRange(0, 6 * Math.max(1, Math.ceil(WAKE_K * grown)));
          wk.U.uGrown.value = Math.max(1e-3, grown);
          wk.U.uOp.value = 1.4 + 1.4 * sing + 2.5 * touch;
        } else wk.mesh.visible = false;

        // the bowl SINGS: the (2,0) rim mode rides with the ball — the rubbing point is a
        // radial NODE (RIM_NODE), so the wall never moves under the ball — glaze, water, halo glow
        if (b.orbiting) ln.phi = b.phiBall;
        const U = ln.bowl.U, WU = ln.bowl.WU;
        U.uAmp.value = .045 * G.rimR * sing; U.uPhi.value = ln.phi + RIM_NODE; U.uTime.value = t; U.uGlow.value = sing;
        U.uFlash.value = touch;
        WU.uAmp.value = .022 * G.rimR * sing; WU.uPhi.value = ln.phi + RIM_NODE; WU.uTime.value = t;
        WU.uKick.value = .05 * G.rimR * (c.live ? .5 + .5 * c.rec.vel : 0); WU.uSince.value = c.live && c.since >= 0 ? c.since : 9;
        ln.bowl.glaze.emissiveIntensity = .05 + .1 * sing + .45 * touch;
        ln.bowl.halo.material.opacity = .05 * sing + .1 * touch;
      }
    }

    return { build, update };
  },

  /* A slow chord progression on 8 bowls: overlapping holds (≤ 6 beats — the voice
     holds 5 s), a descending arpeggio that tumbles across the machine, re-strikes that
     merge into one continuous orbit (G4 at 15, E4 at 25, and G3 across the loop seam).
     [beat, note, vel, durBeats] */
  demo: {
    bpm: 72, beats: 32,
    part: [
      [0, 'C3', .85, 6], [0, 'G3', .7, 5.5], [0, 'E4', .6, 5], [0, 'B4', .5, 4],
      [5, 'D5', .45, 2],
      [8, 'A3', .8, 6], [8.5, 'E4', .55, 3.5], [9, 'G4', .55, 5], [10, 'D5', .45, 2.5],
      [12, 'D4', .55, 3.5], [13, 'B4', .45, 1],
      [14, 'D5', .5, .5], [14.5, 'B4', .5, .5], [15, 'G4', .55, .5], [15.5, 'E4', .6, 2.5],
      [16, 'C3', .9, 6], [16, 'G3', .7, 6], [16, 'D4', .6, 5.5], [16.5, 'B4', .55, 5.5],
      [22.5, 'E4', .5, 2], [23, 'G4', .5, 1],
      [24, 'B4', .6, 5], [24, 'D5', .5, 5], [24.5, 'A3', .6, 5], [25, 'E4', .5, 3],
      [28, 'G3', .55, 3.5], [29, 'D4', .45, 2.5],
    ],
  },
};
