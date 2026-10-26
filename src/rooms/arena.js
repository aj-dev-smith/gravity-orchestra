import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STAGE, rng, canvasTex, radialTex, glowPoints, glowMat, beamMat, instanced, trs } from './common.js';
import { solveArenaCues, lastFire, JETS, CANNONS, JET_BURN } from './arena-cues.js';
import { ARM_AT } from '../transport.js';
import { arenaFooting } from './arena-footing.js';
import { makePulse } from './pulse.js';
import { planArenaProps, JET_HOME, CO2_HOME, RIG, AMP, ampColumns, PYRO } from './arena-props.js';
/* ============================================================
   THE METAL ARENA — the machines play the big room.

   A black stage deck (painted ply, scuffed, gaffer spike marks) under a
   silver BOX-TRUSS rig on four towers; PAR CANS hung off every span —
   an amber front wash raking the machines, ice-blue BACKLIGHT pouring
   forward through the haze; a WALL OF BLINDERS upstage; amp stacks
   flanking it; tiers of dark seating rising either side, flecked with
   phone lights. The par cans are emissive lenses + additive beams +
   glow sprites — NOT lights (the room owns none: constant light count,
   no shader recompiles; the strike-light pool stays main's).

   THE SHOW IS SOLVED. At song load arena-cues.js reads the song's drum
   lanes (crash → every flame jet + the blinders; the drums coming back in
   / a density surge / the loop head → the CO2 cannons; a downbeat kick or a
   kick+snare stab → one pair of jets) into a fixed cue sheet over a
   CONSTANT pool (8 flame projectors, 4 CO2 cannons — a burning device is
   never re-fired). Playback is a pure fn of songTime: every flame column,
   every ember (each one on its own closed-form ballistic arc in the vertex
   shader — the moat, in the pyro too), every CO2 plume is an envelope of
   "seconds since that device fired", read from the sheet. Scrub anywhere
   and the fire is exactly where it must be. Before the count-in nothing
   has fired. The flames "light" the room the honest-cheap way: their
   floor pools, a soft glow at each column and the low fog warm with the burn.

   Perf: ~26 draw calls, all instanced/merged; per frame = a few dozen
   uniforms + ~45 instance colours rewritten in place, zero allocation.
   FLOOR = STAGE.FLOOR (the contract). Everything that stands is outside
   the director's eye room (|x| > 38, z < −34, or above y 36), so no
   station shot is ever blocked by the rig.
   ============================================================ */

const FOG = 0x07070b;
const HWA = 58, BACKA = -62, FRONTA = 72, CEILA = 50;   // the arena's own bounds (the stage frame is STAGE)
const RIG_Y = RIG.RIG_Y;       // bottom chord of the overhead spans: the cans hang clear above the eye room (STAGE.CEIL − 1.5)
const TS = 1.5;                // box-truss chord spacing (= segment length)
const TOWER_X = RIG.TOWER_X, TOWER_Z = RIG.TOWER_Z;
const SPAN_Z = [-47, -9, 29];  // back (backlight) · mid · front (wash)
const AMBER = 0xffa13a, ICE = 0x86d8ff, RED = 0xff3a1e, WHITE = 0xfff1d8;
// the flame projectors (4 mirrored L/R pairs — arena-cues pairs 0-1, 2-3, 4-5, 6-7) and the CO2 cannons (on
// the towers, CO2_Y up) are built at their HOME spots; place() moves them to where the machines let them stand
const JET_POS = JET_HOME, CO2_POS = CO2_HOME, CO2_Y = RIG.CO2_Y;
const START = ARM_AT;          // main's machine start (transport.js — cues.start overrides): nothing fired before it

/* ---------------- textures (drawn once) ---------------- */
function deckTex(){                      // 8×4 sheets of black-painted ply, scuffs, spike tape
  return canvasTex(1024, 1024, (x, w) => {
    const R = rng(41);
    x.fillStyle = '#0d0d10'; x.fillRect(0, 0, w, w);
    for (let i = 0; i < 1400; i++){                         // scuffs + boot marks
      const v = R(), a = .03 + R() * .07;
      x.fillStyle = v > .7 ? `rgba(70,66,62,${a})` : `rgba(0,0,0,${a * 2})`;
      x.save(); x.translate(R() * w, R() * w); x.rotate(R() * 6.28);
      x.fillRect(0, 0, 4 + R() * 40, 1 + R() * 4); x.restore();
    }
    x.strokeStyle = 'rgba(0,0,0,.55)'; x.lineWidth = 2;     // sheet seams (2 × 4 sheets per tile)
    for (let i = 0; i <= 4; i++){ x.beginPath(); x.moveTo(0, i * w / 4); x.lineTo(w, i * w / 4); x.stroke(); }
    for (let r = 0; r < 4; r++) for (let i = 0; i <= 2; i++){
      const px = (i * w / 2 + (r % 2) * w / 4) % w;
      x.beginPath(); x.moveTo(px, r * w / 4); x.lineTo(px, (r + 1) * w / 4); x.stroke();
    }
    x.strokeStyle = 'rgba(255,255,255,.02)'; x.lineWidth = 1;
    for (let i = 0; i <= 4; i++){ x.beginPath(); x.moveTo(0, i * w / 4 + 2); x.lineTo(w, i * w / 4 + 2); x.stroke(); }
    const tape = ['rgba(230,200,40,.55)', 'rgba(220,220,220,.4)', 'rgba(240,80,60,.45)'];
    for (let i = 0; i < 9; i++){                            // spike marks: little Ls and Ts of tape
      x.fillStyle = tape[i % 3];
      const px = R() * w, py = R() * w, l = 14 + R() * 18;
      x.fillRect(px, py, l, 5); x.fillRect(px, py, 5, l * (R() < .5 ? 1 : -1));
    }
  }, { repeat: [1, 1] });
}
/* the BACKLINE's atlas (one material for cabs + heads): a 4×12's front — grille cloth in a tolex frame,
   gold piping, a logo plate (u 0–.5) · plain black tolex for every other face (.5–.75) · a head's front:
   a gold control strip, knobs and the power jewel's bezel (.75–1) */
function ampTex(){
  return canvasTex(512, 256, x => {
    const R = rng(12);
    x.fillStyle = '#18171c'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 256; i += 3){ x.fillStyle = 'rgba(70,68,78,.38)'; x.fillRect(i, 0, 1, 256); x.fillRect(0, i, 256, 1); }
    x.strokeStyle = '#26252b'; x.lineWidth = 22; x.strokeRect(11, 11, 234, 234);
    x.strokeStyle = '#a8946a'; x.lineWidth = 3; x.strokeRect(24, 24, 208, 208);
    x.fillStyle = '#ddd8cc'; x.fillRect(38, 40, 52, 13);
    x.fillStyle = '#141418'; x.fillRect(256, 0, 256, 256);
    for (let i = 0; i < 700; i++){ x.fillStyle = `rgba(${R() < .5 ? '0,0,0' : '60,60,68'},${.1 + R() * .15})`; x.fillRect(256 + R() * 256, R() * 256, 1 + R() * 2, 1 + R() * 2); }
    x.fillStyle = '#a8946a'; x.fillRect(392, 96, 112, 56);
    x.fillStyle = '#26221c'; x.fillRect(396, 100, 104, 48);
    for (let k = 0; k < 6; k++){ x.fillStyle = '#c9c1aa'; x.beginPath(); x.arc(406 + k * 14, 124, 4.5, 0, 6.3); x.fill(); }
    x.fillStyle = '#3a0805'; x.beginPath(); x.arc(492, 124, 6, 0, 6.3); x.fill();
  });
}
/* a unit box whose FRONT (+z) face shows the atlas over u0..u1 and every other face the tolex */
function atlasBox(u0, u1){
  const g = new THREE.BoxGeometry(1, 1, 1), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++){
    const front = i >= 16 && i < 20, u = uv.getX(i);
    uv.setX(i, front ? u0 + (u1 - u0) * u : .52 + .2 * u);
  }
  return g;
}
function drapeTex(){                     // black velour: soft vertical folds
  return canvasTex(256, 8, (x, w, h) => {
    for (let i = 0; i < w; i++){
      const f = .5 + .5 * Math.sin(i / w * Math.PI * 2 * 9) * Math.sin(i / w * Math.PI * 2 * 2.3 + 1);
      const v = 10 + 16 * f | 0;
      x.fillStyle = `rgb(${v},${v},${v + 3})`; x.fillRect(i, 0, 1, h);
    }
  }, { repeat: [6, 1] });
}
function hazeTex(seed){
  return canvasTex(512, 256, (x, w, h) => {
    const R = rng(seed);
    x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 80; i++){
      const cx = R() * w, cy = h * (.25 + R() * .55), r = 30 + R() * 100, a = .04 + R() * .07;
      for (const ox of [-w, 0, w]){
        const g = x.createRadialGradient(cx + ox, cy, 0, cx + ox, cy, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(cx + ox - r, cy - r, 2 * r, 2 * r);
      }
    }
    x.globalCompositeOperation = 'destination-in';
    const f = x.createLinearGradient(0, 0, 0, h);
    f.addColorStop(0, 'rgba(0,0,0,0)'); f.addColorStop(.35, 'rgba(0,0,0,1)'); f.addColorStop(.85, 'rgba(0,0,0,1)'); f.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = f; x.fillRect(0, 0, w, h);
  }, { srgb: false });
}
function noiseTex(seed){                 // tileable soft noise (alpha) for the low CO2 fog
  return canvasTex(256, 256, (x, w) => {
    const R = rng(seed);
    for (let i = 0; i < 60; i++){
      const cx = R() * w, cy = R() * w, r = 14 + R() * 60, a = .05 + R() * .15;
      for (const ox of [-w, 0, w]) for (const oy of [-w, 0, w]){
        const g = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(cx + ox - r, cy + oy - r, 2 * r, 2 * r);
      }
    }
  }, { srgb: false });
}

/* ---------------- geometry ---------------- */
/* one box-truss segment along +x, length TS, centred: 4 chords + zig-zag lacing on 4 faces */
function trussSegGeo(){
  const h = TS / 2, r = .085, parts = [];
  const tube = (a, b, rad) => {
    const d = new THREE.Vector3().subVectors(b, a), L = d.length();
    const g = new THREE.CylinderGeometry(rad, rad, L, 6, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push(g);
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  for (const [y, z] of [[-h, -h], [-h, h], [h, -h], [h, h]]) tube(V(-h, y, z), V(h, y, z), r);
  // lacing: each face gets one diagonal per segment (alternating → a continuous zig-zag)
  tube(V(-h, -h, -h), V(h, h, -h), r * .55); tube(V(-h, h, h), V(h, -h, h), r * .55);
  tube(V(-h, h, -h), V(h, h, h), r * .55); tube(V(-h, -h, h), V(h, -h, -h), r * .55);
  tube(V(-h, -h, -h), V(-h, -h, h), r * .5); tube(V(-h, h, -h), V(-h, h, h), r * .5);   // a rung at each node
  return mergeGeometries(parts);
}
/* a par can: barrel + yoke + clamp, pointing down its local −y */
function parGeo(){
  return mergeGeometries([
    new THREE.CylinderGeometry(.62, .55, 1.7, 14, 1, true).translate(0, .1, 0),
    new THREE.CylinderGeometry(.66, .66, .16, 14).translate(0, -.72, 0),             // gel frame
    new THREE.CylinderGeometry(.55, .3, .4, 14).translate(0, 1.15, 0),               // the lamp housing's tail
    new THREE.BoxGeometry(.08, 1.6, .2).translate(.72, .5, 0), new THREE.BoxGeometry(.08, 1.6, .2).translate(-.72, .5, 0),
    new THREE.BoxGeometry(1.52, .1, .2).translate(0, 1.3, 0),                          // the yoke
  ].map(g => g.index ? g.toNonIndexed() : g));
}

/* static repeats that never change colour: ONE merged mesh (a draw call, and one shell-sized box
   for the shot solve instead of a solid per lamp) */
function merged(geo, mat, mats){
  const m = new THREE.Mesh(mergeGeometries(mats.map(M => geo.clone().applyMatrix4(M))), mat);
  geo.dispose();
  return m;
}

/* ---------------- the pyro shaders ---------------- */
const NOISE_GLSL = /* glsl */`
  float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(h1(i), h1(i + vec2(1, 0)), f.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p){ return .55 * vn(p) + .3 * vn(p * 2.03 + 7.) + .15 * vn(p * 4.1 + 3.); }`;
/* the flame column's envelope (shared by the column, its embers and the CPU floor glow):
   rise (.16 s) → hold → CUT at aC, then the whole column lifts off and burns out by aC + .55 */
const flameCut = big => big ? .5 : .32;
function flameLevel(age, big){
  if (!(age >= 0) || age > JET_BURN) return 0;
  const aC = flameCut(big);
  const up = Math.min(1, age / .1);
  return age < aC ? up : Math.max(0, 1 - (age - aC) / .5) ** 2;
}

function flameMat(){
  return new THREE.ShaderMaterial({
    uniforms: { uAge: { value: new Float32Array(JETS).fill(99) }, uVel: { value: new Float32Array(JETS) },
                uBig: { value: new Float32Array(JETS) }, uTime: { value: 0 } },
    vertexShader: /* glsl */`
      attribute float aJet;
      uniform float uAge[${JETS}], uVel[${JETS}], uBig[${JETS}];
      varying vec2 vUv; varying float vA, vFace, vH, vC;
      void main(){
        int j = int(aJet + .5);
        float a = uAge[j], v = uVel[j], big = uBig[j];
        float H = mix(6. + 6. * v, 13. + 11. * v, big);         // column height (u)
        float aC = mix(.32, .5, big); vC = aC;
        float top = H * sqrt(clamp(a / .16, 0., 1.));            // the fireball punches up fast, then holds
        float lift = max(0., a - aC);
        float y1 = top + lift * (16. + 10. * big);               // after the cut the column lifts off…
        float y0 = lift * (26. + 10. * big);                     // …its foot rising faster than its head
        vH = H;
        float y = mix(y0, y1, uv.y);
        float bulge = (1. + 1.6 * smoothstep(0., .45, a)) * (.55 + .9 * uv.y) * (.8 + .4 * big);
        vec3 p = vec3(position.x * bulge, y, position.z * bulge);
        vA = (a < 0. || a > ${JET_BURN.toFixed(2)} || y1 - y0 < .05) ? -1. : a;
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.);
        vec4 mv = viewMatrix * w;
        vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * vec3(position.x, 0., position.z));
        vFace = abs(dot(n, normalize(cameraPosition - w.xyz)));
        vUv = vec2(uv.x, uv.y);
        gl_Position = vA < 0. ? vec4(2., 2., 2., 1.) : projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec2 vUv; varying float vA, vFace, vH, vC;
      ${NOISE_GLSL}
      void main(){
        if (vA < 0.) discard;
        float a = vA;
        // turbulence streaming up the column (+ the column's own age so a scrub lands identically)
        float n = fbm(vec2(vUv.x * 7., vUv.y * 3.2 - a * 7.5 - uTime * .3));
        float n2 = fbm(vec2(vUv.x * 15. + 3., vUv.y * 6. - a * 13.));
        float tongues = smoothstep(.2, .8, n * .75 + n2 * .45 + .5 - vUv.y * 1.05);   // ragged licks, thinning to the crown
        float cut = clamp(1. - max(0., a - vC) * 1.6, 0., 1.);   // the heat drops at the column's own cut (a big burst holds longer)
        float edge = pow(clamp(vFace, 0., 1.), 1.3);   // (clamped: MSAA extrapolates varyings past the edge → pow(<0) = NaN → bloom smears it)
        float heat = clamp((1. - vUv.y) * 1.25 * cut + .25 * n, 0., 1.);
        vec3 col = mix(vec3(.5, .05, .0), vec3(1., .36, .04), smoothstep(.15, .6, heat));
        col = mix(col, vec3(1., .78, .4), smoothstep(.75, 1., heat) * .8);
        float alpha = tongues * edge * smoothstep(0., .08, vUv.y) * (1. - smoothstep(.75, 1., vUv.y))
                    * clamp(a / .05, 0., 1.) * clamp(1. - max(0., a - vC) / (1.1 - vC), 0., 1.);
        gl_FragColor = vec4(col * .95, alpha * .75);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
/* embers: each spark on its OWN closed-form arc from the nozzle (p0 + v·τ + ½g·τ²), τ = seconds
   since its jet fired minus a small per-spark delay — no integrator, no state */
function emberPoints(map){
  const PER = 40, n = JETS * PER, R = rng(77);
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), aJ = new Float32Array(n), aD = new Float32Array(n), aS = new Float32Array(n);
  for (let j = 0; j < JETS; j++) for (let k = 0; k < PER; k++){
    const i = j * PER + k, [x, z] = JET_POS[j], th = R() * 6.283, sp = 1.5 + R() * 5;
    pos.set([x, STAGE.FLOOR + PYRO.NOZZLE, z], i * 3);
    vel.set([Math.cos(th) * sp, 12 + R() * 16, Math.sin(th) * sp], i * 3);
    aJ[i] = j; aD[i] = R() * .3; aS[i] = .5 + R() * .9;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
  g.setAttribute('aJet', new THREE.BufferAttribute(aJ, 1));
  g.setAttribute('aDelay', new THREE.BufferAttribute(aD, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(aS, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uAge: { value: new Float32Array(JETS).fill(99) }, uVel: { value: new Float32Array(JETS) }, uMap: { value: map } },
    vertexShader: /* glsl */`
      attribute vec3 aVel; attribute float aJet, aDelay, aSize;
      uniform float uAge[${JETS}], uVel[${JETS}];
      varying float vF;
      void main(){
        int j = int(aJet + .5);
        float t = uAge[j] - aDelay, life = .95 - aDelay;
        vF = (t < 0. || t > life) ? 0. : (1. - t / life) * (.4 + .6 * uVel[j]);
        vec3 p = position + aVel * (.7 + .4 * uVel[j]) * t + vec3(0., -.5 * 22. * t * t, 0.);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_PointSize = vF > 0. ? aSize * (260. / -mv.z) : 0.;
        gl_Position = vF > 0. ? projectionMatrix * mv : vec4(2., 2., 2., 1.);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; varying float vF;
      void main(){ float a = texture2D(uMap, gl_PointCoord).a * vF;
        gl_FragColor = vec4(vec3(1., .62, .22) * 3., a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(g, m); p.frustumCulled = false;
  return p;
}
/* a CO2 plume: a jet of cold fog shot along the cannon's +y, cut at .5 s, then the cloud
   drifts on and thins — normal-blended (it is fog: it veils what's behind it) */
function co2Mat(){
  return new THREE.ShaderMaterial({
    uniforms: { uAge: { value: new Float32Array(CANNONS).fill(99) }, uVel: { value: new Float32Array(CANNONS) }, uTime: { value: 0 } },
    vertexShader: /* glsl */`
      attribute float aCan;
      uniform float uAge[${CANNONS}], uVel[${CANNONS}];
      varying vec2 vUv; varying float vA, vFace;
      void main(){
        int j = int(aCan + .5);
        float a = uAge[j], v = uVel[j];
        float L = (11. + 7. * v) * (1. - exp(-a * 9.));          // the stream shoots out…
        float lift = max(0., a - .5);
        float y0 = lift * 14.;                                   // …is cut, and the cloud rolls on
        float y1 = L + lift * 6.;
        float y = mix(y0, y1, uv.y);
        float r = (.5 + 3.4 * uv.y + 2.2 * lift) * (1. + .5 * smoothstep(0., .4, a));
        vec3 p = vec3(position.x * r, y, position.z * r);
        vA = (a < 0. || a > 1.55 || y1 - y0 < .05) ? -1. : a;
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.);
        vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * vec3(position.x, 0., position.z));
        vFace = abs(dot(n, normalize(cameraPosition - w.xyz)));
        vUv = uv;
        gl_Position = vA < 0. ? vec4(2., 2., 2., 1.) : projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec2 vUv; varying float vA, vFace;
      ${NOISE_GLSL}
      void main(){
        if (vA < 0.) discard;
        float a = vA;
        float n = fbm(vec2(vUv.x * 9., vUv.y * 3.5 - a * 5. - uTime * .2));
        float m = fbm(vec2(vUv.x * 3., vUv.y * 1.4 - a * 2.));
        float body = smoothstep(.2, 1.15, n * .8 + m * .6 + .1 - .3 * clamp(vUv.y, 0., 1.));
        float alpha = body * pow(clamp(vFace, 0., 1.), 1.1) * smoothstep(0., .1, vUv.y) * (1. - smoothstep(.7, 1., vUv.y))
                    * clamp(a / .04, 0., 1.) * clamp(1. - max(0., a - .45) / 1.1, 0., 1.) * .55;
        gl_FragColor = vec4(vec3(.86, .93, 1.) * 1.15, alpha);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

export default {
  key: 'arena', label: 'Metal Arena',
  build(scene, { envMap }){
    const group = new THREE.Group();
    const R = rng(666);
    const F = STAGE.FLOOR;

    // ---- the stage deck: black ply, far bigger than the room, fading into the dark ----
    const dT = deckTex(); dT.repeat.set(9, 9);
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(2 * HWA, FRONTA - BACKA),
      new THREE.MeshStandardMaterial({ map: dT, roughness: .5, metalness: .25, envMap, envMapIntensity: .35, color: 0xb8b8c0 }));
    deck.rotation.x = -Math.PI / 2; deck.position.set(0, F, (FRONTA + BACKA) / 2); group.add(deck);

    // ---- upstage: black velour drape + the arena's dark shell ----
    const drape = new THREE.Mesh(new THREE.PlaneGeometry(2 * HWA + 30, CEILA - F + 20),
      new THREE.MeshStandardMaterial({ map: drapeTex(), roughness: 1, metalness: 0, color: 0x9a9aa6 }));
    drape.position.set(0, (CEILA + F) / 2 + 8, BACKA); group.add(drape);

    // ---- seating tiers rising either side, dark, with phone lights in the crowd ----
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x0e0e14, roughness: .9, metalness: .1 });
    // real arena rows (a .85 m tread, a .6 m rise — a steep upper bowl), each a solid riser from the floor
    const ROWS = 24, ROW_D = 1.25, ROW_H = .9;
    const tierM = [];
    for (const s of [-1, 1]) for (let k = 0; k < ROWS; k++){
      const hgt = ROW_H * (k + 1);
      tierM.push(trs(s * (HWA + 3 + k * ROW_D), F + hgt / 2, 4, 0, 0, 0, ROW_D, hgt, 150));
    }
    group.add(instanced(new THREE.BoxGeometry(1, 1, 1), seatMat, tierM));
    const cP = [], cC = [], cS = [], cPh = [];
    for (let i = 0; i < 900; i++){
      const s = i % 2 ? 1 : -1, k = Math.floor(R() * ROWS);
      cP.push(s * (HWA + 3 + k * ROW_D + (R() - .5) * ROW_D * .7), F + ROW_H * (k + 1) + .7 + R() * .4, -64 + R() * 136);
      const warm = R() < .35;
      const b = .35 + .65 * R();
      warm ? cC.push(1 * b, .62 * b, .3 * b) : cC.push(.7 * b, .82 * b, 1 * b);
      cS.push(.32 + R() * .3); cPh.push(R());
    }
    const crowd = glowPoints(cP, { colors: cC, sizes: cS, phases: cPh, map: radialTex(32, [[0, 1], [.25, .5], [1, 0]]), flicker: .55, rate: 1.3, drift: .15 });
    group.add(crowd);

    // ---- THE BACKLINE flanking the blinder wall: walls of REAL 4×12 cabs (76 cm cubes) three high, a head
    //      on each column with a red power jewel — a column anything stands in is taken down (place) ----
    const ampMat = new THREE.MeshStandardMaterial({ map: ampTex(), roughness: .8, metalness: .05, color: 0xdadae2 });
    const tolex = new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: .7, metalness: .2, envMap, envMapIntensity: .3 });
    const AMPS = ampColumns(), headY = F + AMP.ROWS * AMP.CAB + AMP.HEAD / 2;
    const cabAt = (a, r, k = 1) => trs(a.x, F + AMP.CAB * (r + .5), a.z, 0, 0, 0, AMP.CAB * k, AMP.CAB * k, AMP.DEEP * k);
    const headAt = (a, k = 1) => trs(a.x, headY, a.z + .03, 0, 0, 0, AMP.CAB * .97 * k, AMP.HEAD * k, AMP.DEEP * .8 * k);
    const cabs = instanced(atlasBox(0, .5), ampMat, AMPS.flatMap(a => Array.from({ length: AMP.ROWS }, (_, r) => cabAt(a, r))));
    const heads = instanced(atlasBox(.75, 1), ampMat, AMPS.map(a => headAt(a)));
    group.add(cabs, heads);
    const jewelP = [], jewelC = [], jewelS = [], jewelPh = [];
    for (const a of AMPS){ jewelP.push(a.x + AMP.CAB * .44, headY, a.z + AMP.DEEP * .4 + .05); jewelC.push(1, .12, .05); jewelS.push(.22); jewelPh.push(R()); }

    // ---- the TRUSS RIG: four towers, a ring of spans + a mid span, and the blinder wall frame ----
    const alu = new THREE.MeshStandardMaterial({ color: 0xb9bcc4, metalness: 1, roughness: .32, envMap, envMapIntensity: .9 });
    // what the machines stand on (rooms/arena-footing.js): real staging gear — the same box truss as the
    // rig over them (in a half-metal aluminium: at eye level the env can't carry a full mirror)
    const FOOT_STYLE = arenaFooting({ envMap });
    const segM = [];
    const run = (a, b) => {                                   // a straight truss from a to b (segments of TS)
      const d = new THREE.Vector3().subVectors(b, a), L = d.length(), n = Math.max(1, Math.round(L / TS));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.clone().normalize());
      const e = new THREE.Euler().setFromQuaternion(q);
      for (let i = 0; i < n; i++){
        const p = a.clone().addScaledVector(d, (i + .5) / n);
        segM.push(trs(p.x, p.y, p.z, e.x, e.y, e.z, L / n / TS, 1, 1));
      }
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const top = RIG_Y + TS / 2;
    for (const z of TOWER_Z) for (const s of [-1, 1]) run(V(s * TOWER_X, F, z), V(s * TOWER_X, top + 4, z));
    for (const z of SPAN_Z) run(V(-TOWER_X, top, z), V(TOWER_X, top, z));
    for (const s of [-1, 1]) run(V(s * TOWER_X, top, TOWER_Z[0]), V(s * TOWER_X, top, TOWER_Z[1]));
    // the blinder wall: a ladder of truss upstage, behind the machines
    const BW = { x0: -26, x1: 26, z: -57, rows: [F + 12, F + 22, F + 32, F + 42] };
    for (const y of BW.rows) run(V(BW.x0 - 1, y, BW.z), V(BW.x1 + 1, y, BW.z));
    for (const x of [BW.x0 - 2, 0, BW.x1 + 2]) run(V(x, F, BW.z - 1.6), V(x, BW.rows[3] + 3, BW.z - 1.6));
    // ONE merged mesh (not ~700 instances): one draw call, and the shot solve sees the rig as the
    // hall's shell it is (it all stands outside the eye room) instead of 700 tiny solids
    const seg = trussSegGeo();
    const truss = new THREE.Mesh(mergeGeometries(segM.map(m => seg.clone().applyMatrix4(m))), alu);
    seg.dispose();
    group.add(truss);
    // tower bases (ballast plates) + corner blocks on the rig
    group.add(instanced(new THREE.BoxGeometry(5, .5, 5), tolex, TOWER_Z.flatMap(z => [-1, 1].map(s => trs(s * TOWER_X, F + .25, z)))));
    group.add(instanced(new THREE.BoxGeometry(2.1, 2.1, 2.1), alu, [...TOWER_Z, SPAN_Z[1]].flatMap(z => [-1, 1].map(s => trs(s * TOWER_X, top, z)))));

    // ---- PAR CANS: hung under the spans, each a lens + a volumetric beam + a halo (no lights) ----
    const PARS = [];
    const aim = (x, z, tx, ty, tz, col, kind) => PARS.push({ src: V(x, RIG_Y - 1.4, z), tgt: V(tx, ty, tz), col, kind });
    for (let i = 0; i < 10; i++){                             // FRONT span: the amber wash, raking upstage onto the machines
      const x = -40.5 + i * 9;
      aim(x, SPAN_Z[2], x * .78 + (R() - .5) * 4, -8, -6 + (i % 3) * 6, i % 5 === 2 ? WHITE : AMBER, 'wash');
    }
    for (let i = 0; i < 8; i++){                              // MID span: alternating amber / red specials, straight-ish down
      const x = -35 + i * 10;
      aim(x, SPAN_Z[1], x * 1.08, F, SPAN_Z[1] + (i % 2 ? 7 : -5), i % 2 ? RED : AMBER, 'mid');
    }
    for (let i = 0; i < 11; i++){                             // BACK span: the ice-blue backlight, pouring forward
      const x = -45 + i * 9;
      aim(x, SPAN_Z[0], x * .9, F, 6 + (i % 2) * 12, ICE, 'back');
    }
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++){     // SIDE spans: ice cross-light
      const z = -38 + i * 18;
      aim(s * TOWER_X, z, s * 12, F + 6, z + 4, i % 2 ? ICE : WHITE, 'side');
    }
    const beamGeo = new THREE.CylinderGeometry(.5, 5.2, 1, 24, 1, true).translate(0, -.5, 0);
    const beams = new THREE.InstancedMesh(beamGeo, beamMat({ gain: .2, falloff: 1.5, edge: 2.4 }), PARS.length);
    const parM = [], lensM = [], lensCol = [], hP = [], hC = [], hS = [], hPh = [];
    const down = V(0, -1, 0), q = new THREE.Quaternion(), e = new THREE.Euler();
    PARS.forEach((p, i) => {
      const d = p.tgt.clone().sub(p.src), len = d.length() * 1.12;
      q.setFromUnitVectors(down, d.normalize()); e.setFromQuaternion(q);
      p.e = e.clone(); p.base = new THREE.Color(p.col);
      beams.setMatrixAt(i, trs(p.src.x, p.src.y, p.src.z, e.x, e.y, e.z, 1, len, 1));
      beams.setColorAt(i, p.base);
      parM.push(trs(p.src.x, p.src.y, p.src.z, e.x, e.y, e.z));
      const lp = p.src.clone().addScaledVector(d, .85);
      lensM.push(trs(lp.x, lp.y, lp.z, e.x, e.y, e.z));
      lensCol.push(new THREE.Color(p.col));
      hP.push(lp.x, lp.y, lp.z); const c = new THREE.Color(p.col); hC.push(c.r * .5, c.g * .5, c.b * .5); hS.push(4.2); hPh.push(R());
    });
    beams.frustumCulled = false; beams.instanceColor.setUsage(THREE.DynamicDrawUsage); group.add(beams);
    // where each beam lands on the deck: a soft elliptical pool (stretched by the rake), tracking its can
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      glowMat(radialTex(128, [[0, .9], [.3, .55], [.7, .12], [1, 0]]), 0xffffff, .17, { side: THREE.FrontSide }), PARS.length);
    PARS.forEach((p, i) => {
      const d = p.tgt.clone().sub(p.src).normalize(), k = (F - p.src.y) / d.y;
      const hit = p.src.clone().addScaledVector(d, k), along = Math.hypot(d.x, d.z);
      const r = 2 * (.5 + 4.7 * k / (p.src.distanceTo(p.tgt) * 1.12)), stretch = 1 / Math.max(.35, -d.y);
      pools.setMatrixAt(i, trs(hit.x, F + .04 + i * .002, hit.z, 0, along > 1e-3 ? Math.atan2(d.x, d.z) : 0, 0, r, 1, r * stretch));
      pools.setColorAt(i, p.kind === 'mid' ? new THREE.Color(0) : p.base);     // (the mid specials light the machines, not the deck)
    });
    pools.frustumCulled = false; pools.instanceColor.setUsage(THREE.DynamicDrawUsage); group.add(pools);
    const parBody = new THREE.MeshStandardMaterial({ color: 0x141418, metalness: .7, roughness: .4, envMap, envMapIntensity: .6 });
    group.add(merged(parGeo(), parBody, parM));
    const lenses = new THREE.InstancedMesh(new THREE.CircleGeometry(.52, 18).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), lensM.length);
    lensM.forEach((m, i) => { lenses.setMatrixAt(i, m); lenses.setColorAt(i, lensCol[i].clone().multiplyScalar(3)); });
    lenses.instanceColor.setUsage(THREE.DynamicDrawUsage); group.add(lenses);
    const halos = glowPoints(hP, { colors: hC, sizes: hS, phases: hPh, map: radialTex(64, [[0, .9], [.15, .4], [.5, .06], [1, 0]]), flicker: .05, rate: 2 });
    group.add(halos);

    // ---- the BLINDER WALL: 4 rows × 9 four-lamp modules (dim filament glow at rest; a white-hot slam on cue) ----
    const blM = [], bP = [], bC = [], bS = [], bPh = [], modM = [];
    BW.rows.forEach((y, r) => { for (let c = 0; c < 9; c++){
      const x = BW.x0 + c * (BW.x1 - BW.x0) / 8;
      modM.push(trs(x, y - 1.9, BW.z + .4, 0, 0, 0, 3.3, 3.3, .9));
      for (const [dx, dy] of [[-.8, -.8], [.8, -.8], [-.8, .8], [.8, .8]]){
        blM.push(trs(x + dx, y - 1.9 + dy, BW.z + .9));
        bP.push(x + dx, y - 1.9 + dy, BW.z + 1.1); bC.push(1, .62, .3); bS.push(3.2); bPh.push(R());
      }
    } });
    group.add(merged(new THREE.BoxGeometry(1, 1, 1), tolex, modM));
    const blindMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    group.add(merged(new THREE.CircleGeometry(.62, 16), blindMat, blM));
    const blindGlow = glowPoints(bP, { colors: bC, sizes: bS, phases: bPh, map: radialTex(64, [[0, 1], [.2, .45], [.55, .06], [1, 0]]), flicker: .08, rate: 5 });
    group.add(blindGlow);
    // a broad warm bloom of the whole wall when it slams (opacity driven)
    const wallFlash = new THREE.Mesh(new THREE.PlaneGeometry(72, 46), glowMat(radialTex(128, [[0, 1], [.4, .35], [1, 0]]), 0xffd2a0, 0));
    wallFlash.position.set(0, F + 26, BW.z + 2.5); group.add(wallFlash);
    const jewels = glowPoints(jewelP, { colors: jewelC, sizes: jewelS, phases: jewelPh, map: radialTex(32), flicker: .1, rate: 1 });
    group.add(jewels);

    // ---- haze: ice-blue backlight haze hanging upstage + a thinner layer mid-stage ----
    const hazes = [];
    [[BACKA + 10, 6, .34, ICE, 11, 1.3], [-30, 2, .2, 0x7fa8ff, 23, 1.1]].forEach(([z, y, op, col, seed, sc]) => {
      const t = hazeTex(seed); t.wrapS = THREE.RepeatWrapping;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * HWA * sc, 60), glowMat(t, col, op, { fog: true }));
      m.position.set(0, y, z); group.add(m);
      hazes.push({ t, m });
    });
    // LOW FOG: the CO2 / dry-ice layer rolling over the deck (cold white, thicker upstage)
    const fogNoise = noiseTex(4); fogNoise.wrapS = fogNoise.wrapT = THREE.RepeatWrapping;
    const lowMat = (k, a) => new THREE.ShaderMaterial({
      uniforms: { uMap: { value: fogNoise }, uTime: { value: 0 }, uA: { value: a }, uK: { value: k },
                  uColor: { value: new THREE.Color(0x6f86a8) }, uWarm: { value: 0 } },
      vertexShader: /* glsl */`varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap; uniform float uTime, uA, uK, uWarm; uniform vec3 uColor; varying vec2 vW;
        void main(){
          float n1 = texture2D(uMap, vW * .012 * uK + vec2(uTime * .008, uTime * .003)).a;
          float n2 = texture2D(uMap, vW * .027 * uK + vec2(-uTime * .011, uTime * .006)).a;
          float n = smoothstep(.2, .75, n1 + .8 * n2);
          float back = .55 + .45 * smoothstep(30., -40., vW.y);            // pooled thicker upstage
          float fade = 1. - smoothstep(70., 110., length(vW - vec2(0., -8.)));
          vec3 c = mix(uColor, vec3(1., .5, .18), uWarm);                   // the flames light the fog
          gl_FragColor = vec4(c * (1. + 1.5 * uWarm), n * back * fade * uA);
        }`,
      transparent: true, depthWrite: false,
    });
    const lows = [[.9, 1, .11], [2.4, .65, .05]].map(([h, k, a]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * HWA, FRONTA - BACKA), lowMat(k, a));
      m.rotation.x = -Math.PI / 2; m.position.set(0, F + h, (FRONTA + BACKA) / 2); m.renderOrder = 2; group.add(m);
      return m;
    });

    // ---- PYRO: 8 flame projectors (black boxes, a hot nozzle), columns + embers + floor pools ----
    // (a flame unit: a black road-case box ~1 m square, its nozzle on top at PYRO.NOZZLE)
    const jetBody = instanced(new THREE.BoxGeometry(1.5, .95, 1.5).translate(0, .475, 0), tolex, JET_POS.map(([x, z]) => trs(x, F, z)));
    const jetNoz = instanced(new THREE.CylinderGeometry(.3, .4, .45, 12).translate(0, PYRO.NOZZLE - .225, 0), alu, JET_POS.map(([x, z]) => trs(x, F, z)));
    group.add(jetBody, jetNoz);
    const flameGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 12, true).translate(0, .5, 0);
    const flames = new THREE.InstancedMesh(flameGeo, flameMat(), JETS);
    flameGeo.setAttribute('aJet', new THREE.InstancedBufferAttribute(new Float32Array(JETS).map((_, j) => j), 1));
    JET_POS.forEach(([x, z], j) => flames.setMatrixAt(j, trs(x, F + PYRO.NOZZLE, z)));
    flames.frustumCulled = false; group.add(flames);
    // the fire's own glow: one big soft sprite per jet, hung at the column's heart, its level the
    // flame envelope (the honest-cheap stand-in for the light a fireball throws: no lights)
    const fgPos = new Float32Array(JETS * 3), fgJ = new Float32Array(JETS);
    JET_POS.forEach(([x, z], j) => { fgPos.set([x, F + 7, z], j * 3); fgJ[j] = j; });
    const fgGeo = new THREE.BufferGeometry();
    fgGeo.setAttribute('position', new THREE.BufferAttribute(fgPos, 3));
    fgGeo.setAttribute('aJet', new THREE.BufferAttribute(fgJ, 1));
    const fireGlow = new THREE.Points(fgGeo, new THREE.ShaderMaterial({
      uniforms: { uLvl: { value: new Float32Array(JETS) }, uMap: { value: radialTex(128, [[0, .8], [.25, .35], [.6, .08], [1, 0]]) } },
      vertexShader: /* glsl */`
        attribute float aJet; uniform float uLvl[${JETS}]; varying float vL;
        void main(){ vL = uLvl[int(aJet + .5)];
          vec4 mv = modelViewMatrix * vec4(position, 1.);
          gl_PointSize = vL > .002 ? 34. * (300. / -mv.z) : 0.;
          gl_Position = vL > .002 ? projectionMatrix * mv : vec4(2., 2., 2., 1.); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap; varying float vL;
        void main(){ gl_FragColor = vec4(vec3(1., .45, .12), texture2D(uMap, gl_PointCoord).a * vL * .55); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    fireGlow.frustumCulled = false; group.add(fireGlow);
    const emberMap = radialTex(32, [[0, 1], [.3, .6], [1, 0]]);
    const embers = emberPoints(emberMap); group.add(embers);
    const nozzleGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      glowMat(radialTex(), 0xffffff, .55, { side: THREE.FrontSide }), JETS + CANNONS);
    JET_POS.forEach(([x, z], j) => { nozzleGlow.setMatrixAt(j, trs(x, F + .06, z, 0, 0, 0, 22, 1, 22)); nozzleGlow.setColorAt(j, new THREE.Color(0)); });
    CO2_POS.forEach(([x, z], c) => { nozzleGlow.setMatrixAt(JETS + c, trs(x * .8, F + .07, z, 0, 0, 0, 26, 1, 26)); nozzleGlow.setColorAt(JETS + c, new THREE.Color(0)); });
    nozzleGlow.instanceColor.setUsage(THREE.DynamicDrawUsage); nozzleGlow.frustumCulled = false; group.add(nozzleGlow);

    // ---- CO2 CANNONS on the towers, aimed up and in over the stage ----
    const canM = [], plumeM = [];
    const UP = V(0, 1, 0);
    CO2_POS.forEach(([x, z]) => {
      const src = V(x, F + CO2_Y, z), dir = V(-x * .55, 14, -z * .25 - 4).normalize();
      q.setFromUnitVectors(UP, dir); e.setFromQuaternion(q);
      canM.push(trs(src.x, src.y, src.z, e.x, e.y, e.z));
      plumeM.push(trs(src.x + dir.x * 1.2, src.y + dir.y * 1.2, src.z + dir.z * 1.2, e.x, e.y, e.z));
    });
    const cans = instanced(mergeGeometries([new THREE.CylinderGeometry(.32, .45, 2.4, 12).toNonIndexed(),
      new THREE.CylinderGeometry(.55, .55, .9, 12).translate(0, -1.2, 0).toNonIndexed()]), alu, canM);
    group.add(cans);
    const plumeGeo = new THREE.CylinderGeometry(1, 1, 1, 18, 10, true).translate(0, .5, 0);
    plumeGeo.setAttribute('aCan', new THREE.InstancedBufferAttribute(new Float32Array(CANNONS).map((_, c) => c), 1));
    const plumes = new THREE.InstancedMesh(plumeGeo, co2Mat(), CANNONS);
    plumeM.forEach((m, c) => plumes.setMatrixAt(c, m));
    plumes.frustumCulled = false; plumes.renderOrder = 3; group.add(plumes);

    /* ---------------- playback: pure fns of songTime ---------------- */
    let sheet = null, sheetFor = null;                       // the solved cue sheet (memoized on the cues object = per song)
    const solve = cues => {
      if (cues === sheetFor) return sheet;
      sheetFor = cues;
      sheet = (cues && cues.beat && cues.P) ? solveArenaCues({ drums: cues.drums, melody: cues.melody, loopBeats: cues.loopBeats,
        beat: cues.beat, P: cues.P, rollT: cues.rollT }) : null;
      return sheet;
    };
    const fogBase = new THREE.Color(FOG), background = new THREE.Color(FOG);
    const _c = new THREE.Color();
    const _lf = { age: Infinity, row: null }, NONE = Object.freeze({ age: Infinity, row: null });   // (lastFire fills _lf in place: no per-frame allocation)
    // how much of each family's beam shows in the air: the front wash rakes AWAY from the house (you
    // see its pools and lit machines, barely its shafts); the backlight pours at you through the haze
    const BEAM_K = { wash: .3, mid: .6, back: 1, side: .7 };
    const fU = flames.material.uniforms, eU = embers.material.uniforms, pU = plumes.material.uniforms;
    const beamBase = beams.material.uniforms.uGain.value;
    const blindIdle = new THREE.Color(.22, .09, .025), blindHot = new THREE.Color(9, 7.4, 5.4);
    const hazeIdle = hazes.map(h => h.m.material.opacity);
    // in a HEADSET a blinder hit fills the whole field of view and there's no looking away from
    // the screen: the flash peaks lower (xr(on) — photosensitive comfort, same timing)
    let blindK = 1;
    const blindFlash = age => (age >= 0 && age < 1.2) ? blindK * Math.exp(-age * 4.2) : 0;
    const co2Level = age => (age >= 0 && age < 1.55) ? Math.min(1, age / .05) * Math.max(0, 1 - Math.max(0, age - .4) / 1.1) : 0;

    /* ---------------- THE MACHINES: where they stand (place) and how the room answers them ---------------- */
    // each pad's VU fascia (rooms/arena-footing.js): a fast fill + a slow ghost per pulse slot — pure
    // envelopes of songTime (rooms/pulse.js), made per set of anchors, read every frame without allocating
    const vuU = FOOT_STYLE.edgeMat.uniforms, VU = [], GHOST = [];
    // where the pyro may stand (arena-props.js): moved per set of anchors; a STRUCK device never fires
    const JET_LIVE = new Uint8Array(JETS).fill(1), CAN_LIVE = new Uint8Array(CANNONS).fill(1);
    const ePos = embers.geometry.attributes.position, gPos = fgGeo.attributes.position, PER = ePos.count / JETS;
    const jewelSize = jewels.geometry.attributes.aSize, UPV = V(0, 1, 0), _dir = new THREE.Vector3();
    let rig = null;
    function place(anchors = [], plan = null){
      VU.length = 0; GHOST.length = 0;
      for (const s of plan?.pulses || []){
        VU.push(makePulse(s.cue, { P: s.P, start: s.start, decay: .35 }));
        GHOST.push(makePulse(s.cue, { P: s.P, start: s.start, decay: 1.1 }));
      }
      vuU.uVU.value.fill(0); vuU.uGhost.value.fill(0);
      rig = planArenaProps(anchors, plan, { floor: F });
      rig.jets.forEach((d, j) => {
        const k = d.live ? 1 : 0;
        jetBody.setMatrixAt(j, trs(d.x, F, d.z, 0, 0, 0, k, k, k)); jetNoz.setMatrixAt(j, trs(d.x, F, d.z, 0, 0, 0, k, k, k));
        flames.setMatrixAt(j, trs(d.x, F + PYRO.NOZZLE, d.z));
        for (let i = 0; i < PER; i++) ePos.setXYZ(j * PER + i, d.x, F + PYRO.NOZZLE, d.z);
        gPos.setXYZ(j, d.x, F + 7, d.z);
        nozzleGlow.setMatrixAt(j, trs(d.x, F + .06, d.z, 0, 0, 0, 22, 1, 22));
        JET_LIVE[j] = d.live ? 1 : 0;
      });
      rig.cannons.forEach((d, c) => {
        const [x, y, z] = d.src, k = d.live ? 1 : 0;
        _dir.fromArray(d.dir); q.setFromUnitVectors(UPV, _dir); e.setFromQuaternion(q);
        cans.setMatrixAt(c, trs(x, y, z, e.x, e.y, e.z, k, k, k));
        plumes.setMatrixAt(c, trs(x + _dir.x * PYRO.PLUME_AT, y + _dir.y * PYRO.PLUME_AT, z + _dir.z * PYRO.PLUME_AT, e.x, e.y, e.z));
        nozzleGlow.setMatrixAt(JETS + c, trs(x + _dir.x * 12, F + .07, z + _dir.z * 12, 0, 0, 0, 26, 1, 26));   // (the cold pool under its plume)
        CAN_LIVE[c] = d.live ? 1 : 0;
      });
      rig.amps.forEach((a, i) => {
        const k = a.live ? 1 : 0;
        for (let r = 0; r < AMP.ROWS; r++) cabs.setMatrixAt(i * AMP.ROWS + r, cabAt(a, r, k));
        heads.setMatrixAt(i, headAt(a, k)); jewelSize.setX(i, .22 * k);
      });
      for (const m of [jetBody, jetNoz, flames, cans, plumes, nozzleGlow, cabs, heads]){ m.instanceMatrix.needsUpdate = true; m.boundingSphere = null; m.boundingBox = null; }
      ePos.needsUpdate = true; gPos.needsUpdate = true; jewelSize.needsUpdate = true;
    }

    return {
      group, ...STAGE, HW: HWA, BACK: BACKA, FRONT: FRONTA, CEIL: CEILA,
      place,
      props: () => rig,                                        // (dev: where the pyro stands, arena-props.js)
      fog: new THREE.FogExp2(FOG, .016), background,
      mood: { ambient: [0x2a1e1a, 1.25], hemi: [0x8ab0e8, 0x3a1a08, .75] },   // ice from above, amber bounce off the deck
      // the footing (rooms/footing3d.js): black steel stage decks on silver touring truss
      footing: FOOT_STYLE,
      update(dt, songTime, camera, energy = 0, cues = null){
        const t = songTime, S = solve(cues), start = cues && Number.isFinite(cues.start) ? cues.start : START;
        const P = cues?.P || 1, beat = cues?.beat || .5;
        // ---- the machines' VU fascias ----
        for (let i = 0; i < VU.length; i++){ vuU.uVU.value[i] = VU[i].at(t); vuU.uGhost.value[i] = GHOST[i].at(t); }
        // ---- fire ----
        let burn = 0, fog2 = 0;
        for (let j = 0; j < JETS; j++){
          const { age, row } = S && JET_LIVE[j] ? lastFire(S.jets[j], t, P, start, _lf) : NONE;
          const a = age === Infinity ? 99 : age, v = row ? row[1] : 0, big = row && row[2] ? 1 : 0;
          fU.uAge.value[j] = a; fU.uVel.value[j] = v; fU.uBig.value[j] = big;
          eU.uAge.value[j] = a; eU.uVel.value[j] = v;
          const L = flameLevel(a, big) * (.55 + .45 * v) * (big ? 1 : .6);
          burn += L;
          fireGlow.material.uniforms.uLvl.value[j] = L;
          nozzleGlow.setColorAt(j, _c.setRGB(1.6 * L, .62 * L, .2 * L));
        }
        for (let c = 0; c < CANNONS; c++){
          const { age, row } = S && CAN_LIVE[c] ? lastFire(S.co2[c], t, P, start, _lf) : NONE;
          const a = age === Infinity ? 99 : age;
          pU.uAge.value[c] = a; pU.uVel.value[c] = row ? row[1] : 0;
          const L = co2Level(a);
          fog2 += L;
          nozzleGlow.setColorAt(JETS + c, _c.setRGB(.16 * L, .2 * L, .26 * L));
        }
        nozzleGlow.instanceColor.needsUpdate = true;
        fU.uTime.value = t; pU.uTime.value = t;
        const warm = Math.min(1, burn / 3);                     // ~3 full columns = the room glowing orange
        // ---- blinders ----
        const bl = S ? lastFire(S.blind, t, P, start, _lf) : NONE;
        const B = blindFlash(bl.age) * (bl.row ? .5 + .5 * bl.row[1] : 0);
        blindMat.color.copy(blindIdle).lerp(blindHot, B);
        blindGlow.material.uniforms.uBoost.value = .07 + 2.4 * B;
        blindGlow.material.uniforms.uTime.value = t;
        wallFlash.material.opacity = .09 * B;
        // ---- par cans: a slow beat-locked chase across each span + the music's kick + the fire ----
        const bt = t / beat;
        for (let i = 0; i < PARS.length; i++){
          const p = PARS[i];
          const ph = p.kind === 'back' ? bt / 8 - i / 11 : p.kind === 'wash' ? bt / 16 + i / 10 : bt / 4 + i * .37;
          let k = .62 + .38 * (.5 + .5 * Math.cos(6.2832 * ph));
          if (p.kind === 'wash' || p.kind === 'mid') k *= 1 + .5 * warm;
          k *= 1 + .9 * B * (p.kind === 'back' ? 1 : .4);
          beams.setColorAt(i, _c.copy(p.base).multiplyScalar(k * BEAM_K[p.kind]));
          lenses.setColorAt(i, _c.copy(p.base).multiplyScalar(1.4 + 2.6 * k));
          pools.setColorAt(i, _c.copy(p.base).multiplyScalar(p.kind === 'mid' ? 0 : k * (p.kind === 'back' ? .45 : 1)));
        }
        beams.instanceColor.needsUpdate = true; lenses.instanceColor.needsUpdate = true; pools.instanceColor.needsUpdate = true;
        beams.material.uniforms.uGain.value = beamBase * (1 + .45 * energy);
        halos.material.uniforms.uTime.value = t;
        halos.material.uniforms.uBoost.value = 1 + .6 * energy + .8 * B;
        crowd.material.uniforms.uTime.value = t;
        crowd.material.uniforms.uBoost.value = 1 + 1.2 * B + .8 * warm;
        jewels.material.uniforms.uTime.value = t;
        // ---- haze + fog: the blinders lift the air; the fire only warms the low fog near the deck ----
        for (let i = 0; i < hazes.length; i++){
          const h = hazes[i];
          h.t.offset.x = t * (i % 2 ? -.005 : .004);
          // the ice backlight haze answers the kick and the blinders (the fire glows locally: fireGlow)
          h.m.material.opacity = hazeIdle[i] * (1 + .4 * energy + .8 * B);
        }
        for (const m of lows){ m.material.uniforms.uTime.value = t; m.material.uniforms.uWarm.value = .14 * warm; }
        lows[0].material.uniforms.uA.value = .11 * (1 + .6 * Math.min(1, fog2 / 2));
        const fog = scene.fog;
        if (fog){
          fog.color.copy(fogBase).lerp(_c.setRGB(.3, .3, .34), .02 * B);   // (the fire stays LOCAL: a dark house is what makes it read)
          background.copy(fog.color);
        }
      },
      xr(on){ blindK = on ? .45 : 1; },
      dispose(){ FOOT_STYLE.dispose(); },
    };
  },
};
