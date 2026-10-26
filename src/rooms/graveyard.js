import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STAGE, rng, canvasTex, radialTex, glowMat, instanced, trs } from './common.js';
import { FOOT } from './footing.js';
import { makePulse } from './pulse.js';
import { graveyardStyle } from './graveyard-footing.js';
import { GY, graveSlots, placeGraves, obstaclesOf, graveCandles, votives, footLights, wispsFor, rectDist, answerCue, answerTiming } from './graveyard-place.js';
/* ============================================================
   THE GRAVEYARD — a ruined churchyard at midnight, for October.

   A huge low moon behind the roofless chapel, rags of cloud sliding
   across it; leaning headstones, Celtic crosses and an obelisk or two
   in the moonlit grass; a crooked iron fence with spear finials; dead
   oaks clawing up past the machines; candles guttering on the graves;
   will-o'-the-wisps drifting low; bats wheeling across the moon; a
   cold green-silver GROUND FOG rolling over everything. Now and then
   sheet lightning flickers behind the chapel and every silhouette jumps
   out — ON THE MUSIC: a song lists its thunder in `song.storm` (beats; the
   thunder IS the cymbal), so the flash lands on the crash, every loop. A
   song that declares no storm gets only a rare, faint hashed rumble.
   And a song can bring the DAWN (`song.sky`: [[beat, 'night'|'dawn']]):
   the sky greys toward rose, the horizon warms, the candles and wisps
   gutter out, the ground fog thins — then night falls again across the
   loop's roll-in. Both are pure fns of songTime (no state, no allocation).

   THE MACHINES ARE SET IN THE CHURCHYARD (2026-10-25): each stands on the yard's own masonry
   (graveyard-footing.js — a ledger stone, a chest tomb, a mausoleum, a timber scaffold, a crypt
   terrace), the graves crowd round them at human scale (graveyard-place.js: a grave a machine or its
   support comes within a metre of is MOVED further out — the yard stays as full; low ledgers and
   kerbed plots fill the gaps between the machines), and the yard ANSWERS them — each a quiet accent
   by the machine that plays, a pure fn of songTime off its strike cue (rooms/pulse.js):
     · the ground fog at its foot glows in its colour and is pushed out as it strikes,
     · its votive candles, its tomb's lanterns and the candles on the graves beside it flare,
     · its own will-o'-the-wisp drifts in to it while it plays, and back out over the graves when it rests.
   place() re-poses instance pools and rewrites point buffers (no rebuild); update() writes uniforms.

   Layers, near → far: the stage (instruments on the floor contract),
   the side graves (lit, fogged), the fence, the chapel + trees (dark
   SILHOUETTES that ignore the fog, so they read against the sky), the
   moon + clouds, the sky dome (its horizon IS the fog colour, so far
   ground melts into it and the conveyor's off-screen wrap stays hidden).

   ~26 draw calls, everything instanced/merged; animation is uniforms +
   a dozen bat matrices recomposed in place — zero per-frame allocation.
   FLOOR = STAGE.FLOOR (the contract). The room owns no lights.
   ============================================================ */

const FOG = 0x0e151c;           // = the sky's horizon: far ground melts into it
const SKY_R = 140;              // sky dome radius (camera.far is 200; the stage cam sits ≤ ~50 from the origin)
const MOON = new THREE.Vector3(84, STAGE.FLOOR + 17, -122);   // low, right of the chapel: from the stage shot it hangs behind the bells' arch
                                                 // (17 u over the ground — it was placed for the old −22 floor)
const MOON_R = 15;
const N_BATS = 14;
const FENCE_Z = -58, FENCE_X = 62;
const CH_X = 30;                 // the chapel stands right of centre (the moon rises left of it)

/* the sky: zenith ink → moonlit haze at the horizon (= FOG), stars above */
function skyTex(){
  return canvasTex(2048, 1024, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#020308'); g.addColorStop(.3, '#060a12'); g.addColorStop(.46, '#0c131b');
    g.addColorStop(.5, '#0e151c'); g.addColorStop(1, '#0e151c');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    const R = rng(13);
    for (let i = 0; i < 2200; i++){                              // small, soft stars (a texel is ~.4 u on the dome)
      const sx = R() * w, sy = Math.pow(R(), 1.6) * h * .44, b = R();
      x.fillStyle = `rgba(${b > .93 ? '255,236,210' : '200,214,255'},${.15 + .55 * R() * R()})`;
      x.beginPath(); x.arc(sx, sy, b > .985 ? 1.3 : b > .9 ? .9 : .6, 0, Math.PI * 2); x.fill();
    }
    // a faint aurora-green band of haze low on the horizon (marsh light)
    const hz = x.createLinearGradient(0, h * .4, 0, h * .5);
    hz.addColorStop(0, 'rgba(60,120,100,0)'); hz.addColorStop(1, 'rgba(60,120,100,.18)');
    x.fillStyle = hz; x.fillRect(0, h * .4, w, h * .1);
  });
}

function moonTex(){
  return canvasTex(256, 256, (x, w) => {
    const c = w / 2, r = w * .46, R = rng(31);
    const g = x.createRadialGradient(c - r * .25, c - r * .25, r * .1, c, c, r);
    g.addColorStop(0, '#fbf6e4'); g.addColorStop(.75, '#d9dccb'); g.addColorStop(1, '#a9b2a6');
    x.fillStyle = g; x.beginPath(); x.arc(c, c, r, 0, Math.PI * 2); x.fill();
    x.save(); x.beginPath(); x.arc(c, c, r, 0, Math.PI * 2); x.clip();
    for (let i = 0; i < 26; i++){                                 // maria + craters
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * r * .85, cr = (i < 6 ? 18 + R() * 26 : 3 + R() * 9);
      x.fillStyle = `rgba(90,100,96,${i < 6 ? .22 : .3})`;
      x.beginPath(); x.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, cr, 0, Math.PI * 2); x.fill();
    }
    x.restore();
  });
}

/* a rag of cloud: soft noise inside an elliptical mask (no hard plane edges), blurred */
function cloudRagTex(seed){
  return canvasTex(512, 256, (x, w, h) => {
    const R = rng(seed);
    x.filter = 'blur(6px)';                                       // soft edges: no stair-steps when lit by a flash
    for (let i = 0; i < 90; i++){
      const cx = w * (.1 + .8 * R()), cy = h * (.3 + .4 * R()), r = 20 + R() * 72, a = .06 + R() * .16;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    }
    x.filter = 'none';
    x.globalCompositeOperation = 'destination-in';
    x.save(); x.translate(w / 2, h / 2); x.scale(1, h / w);
    const m = x.createRadialGradient(0, 0, 0, 0, 0, w / 2);
    m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(.6, 'rgba(0,0,0,.8)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = m; x.fillRect(-w / 2, -w / 2, w, w); x.restore();
  }, { srgb: false });
}

/* tileable soft noise (alpha) for the ground fog */
function noiseTex(seed, n = 140, big = 70){
  return canvasTex(256, 256, (x, w) => {
    const R = rng(seed);
    x.fillStyle = 'rgba(0,0,0,0)'; x.fillRect(0, 0, w, w);
    for (let i = 0; i < n; i++){
      const cx = R() * w, cy = R() * w, r = 12 + R() * big, a = .05 + R() * .16;
      for (const ox of [-w, 0, w]) for (const oy of [-w, 0, w]){
        const g = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(cx + ox - r, cy + oy - r, 2 * r, 2 * r);
      }
    }
  }, { srgb: false });
}

function groundTex(){
  return canvasTex(512, 512, (x, w) => {
    const R = rng(9);
    x.fillStyle = '#2a3a30'; x.fillRect(0, 0, w, w);
    for (let i = 0; i < 260; i++){                                // mottled earth + moss
      const v = R();
      x.fillStyle = v > .5 ? `rgba(30,44,32,${.3 + .3 * R()})` : `rgba(22,20,18,${.3 + .3 * R()})`;
      x.beginPath(); x.arc(R() * w, R() * w, 6 + R() * 26, 0, Math.PI * 2); x.fill();
    }
    x.lineWidth = 1;                                              // grass tufts
    for (let i = 0; i < 2600; i++){
      const px = R() * w, py = R() * w, l = 3 + R() * 7, a = (R() - .5) * .9;
      x.strokeStyle = `rgba(${60 + R() * 40 | 0},${84 + R() * 50 | 0},${62 + R() * 30 | 0},${.25 + .4 * R()})`;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.sin(a) * l, py - Math.cos(a) * l); x.stroke();
    }
    for (let i = 0; i < 160; i++){                                // dead leaves
      x.fillStyle = `rgba(${90 + R() * 60 | 0},${50 + R() * 30 | 0},${20},${.35 + .3 * R()})`;
      x.fillRect(R() * w, R() * w, 2 + R() * 3, 1 + R() * 2);
    }
  }, { repeat: [1, 1] });
}

function stoneTex(){
  return canvasTex(128, 256, (x, w, h) => {
    const R = rng(17);
    x.fillStyle = '#6b6f6a'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++){ const v = 70 + R() * 60 | 0;
      x.fillStyle = `rgba(${v},${v + 4},${v - 4},.35)`; x.fillRect(R() * w, R() * h, 2 + R() * 4, 2 + R() * 4); }
    for (let i = 0; i < 40; i++){                                 // lichen
      x.fillStyle = `rgba(${90 + R() * 40 | 0},${110 + R() * 40 | 0},${60},${.25 + .2 * R()})`;
      x.beginPath(); x.arc(R() * w, h * (.5 + .5 * R()), 3 + R() * 10, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = 'rgba(30,30,30,.55)';                           // an engraved inscription band
    for (let k = 0; k < 4; k++) x.fillRect(w * .22, h * (.28 + k * .07), w * (.56 - (k % 2) * .14), 3);
  });
}

function batTex(){
  return canvasTex(128, 64, (x, w, h) => {
    x.fillStyle = '#fff'; x.beginPath();
    x.moveTo(w / 2, h * .62);
    x.quadraticCurveTo(w * .42, h * .2, w * .12, h * .18);       // left wing leading edge
    x.lineTo(0, h * .45); x.quadraticCurveTo(w * .1, h * .52, w * .16, h * .74);
    x.quadraticCurveTo(w * .24, h * .6, w * .3, h * .78); x.quadraticCurveTo(w * .37, h * .64, w * .44, h * .8);
    x.lineTo(w * .56, h * .8);
    x.quadraticCurveTo(w * .63, h * .64, w * .7, h * .78); x.quadraticCurveTo(w * .76, h * .6, w * .84, h * .74);
    x.quadraticCurveTo(w * .9, h * .52, w, h * .45); x.lineTo(w * .88, h * .18);
    x.quadraticCurveTo(w * .58, h * .2, w / 2, h * .62);
    x.fill();
    x.beginPath(); x.ellipse(w / 2, h * .55, w * .05, h * .2, 0, 0, Math.PI * 2); x.fill();   // body
    x.beginPath(); x.moveTo(w * .47, h * .38); x.lineTo(w * .46, h * .26); x.lineTo(w * .5, h * .35);   // ears
    x.lineTo(w * .54, h * .26); x.lineTo(w * .53, h * .38); x.fill();
  }, { srgb: false });
}

/* the chapel ruin's west wall: dark stone with a great pointed window + two lancets cut out */
function chapelTex(){
  return canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
    // a broken top edge (the roof is long gone)
    const R = rng(5);
    x.globalCompositeOperation = 'destination-out';
    x.beginPath(); x.moveTo(0, 0); x.lineTo(0, h * .22);
    for (let i = 0; i <= 16; i++) x.lineTo(i / 16 * w, h * (.04 + .18 * Math.abs(Math.sin(i * 1.7)) * R() + (i > 6 && i < 10 ? -.03 : .06)));
    x.lineTo(w, 0); x.closePath(); x.fill();
    const lancet = (cx, bottom, wid, hgt) => {
      x.beginPath(); x.moveTo(cx - wid / 2, bottom); x.lineTo(cx - wid / 2, bottom - hgt);
      x.arc(cx + wid / 2, bottom - hgt, wid, Math.PI, Math.PI + Math.PI / 3);
      x.arc(cx - wid / 2, bottom - hgt, wid, -Math.PI / 3, 0);
      x.lineTo(cx + wid / 2, bottom); x.closePath(); x.fill();
    };
    lancet(w / 2, h * .78, w * .2, h * .3);                     // the great window
    lancet(w * .2, h * .8, w * .07, h * .26); lancet(w * .8, h * .8, w * .07, h * .26);
    x.beginPath(); x.arc(w / 2, h * .2, w * .05, 0, Math.PI * 2); x.fill();   // an oculus
    // the doorway, half collapsed
    x.fillRect(w * .44, h * .86, w * .12, h * .14);
    x.globalCompositeOperation = 'source-over';
    x.strokeStyle = '#fff'; x.lineWidth = 5;                     // surviving tracery in the great window
    x.beginPath(); x.moveTo(w / 2, h * .78); x.lineTo(w / 2, h * .38); x.stroke();
    x.beginPath(); x.arc(w / 2 - w * .05, h * .45, w * .05, Math.PI, 0); x.stroke();
  }, { srgb: false, mips: true });
}

/* a dead tree as merged tapered cylinders: trunk + recursive crooked branches */
function treeGeo(R, h0 = 34){
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const limb = (p, dir, len, r, depth) => {
    const g = new THREE.CylinderGeometry(r * .62, r, len, 5, 1).translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    g.applyQuaternion(q); g.translate(p.x, p.y, p.z);
    parts.push(g.toNonIndexed());
    if (depth <= 0 || r < .12) return;
    const end = p.clone().addScaledVector(dir, len);
    const n = depth > 2 ? 2 + (R() < .5 ? 1 : 0) : 2;
    for (let i = 0; i < n; i++){
      const d = dir.clone().add(new THREE.Vector3((R() - .5) * 1.5, (R() - .2) * .6, (R() - .5) * 1.5)).normalize();
      if (d.y < -.1) d.y = -.1;
      limb(end.clone().addScaledVector(dir, -len * .1 * R()), d.normalize(), len * (.55 + .2 * R()), r * .6, depth - 1);
    }
  };
  // a leaning, twisted trunk in two segments
  const lean = new THREE.Vector3((R() - .5) * .35, 1, (R() - .5) * .35).normalize();
  limb(new THREE.Vector3(0, 0, 0), lean, h0 * .45, 1.6, 0);
  const mid = lean.clone().multiplyScalar(h0 * .45);
  const lean2 = lean.clone().add(new THREE.Vector3((R() - .5) * .5, 0, (R() - .5) * .5)).normalize();
  limb(mid, lean2, h0 * .3, 1.05, 4);
  for (let i = 0; i < 2; i++){                                    // two big low limbs
    const d = new THREE.Vector3(Math.cos(i * 3 + R()), .7 + .3 * R(), Math.sin(i * 3 + R())).normalize();
    limb(mid.clone().multiplyScalar(.7 + .2 * i), d, h0 * .32, .8, 3);
  }
  return mergeGeometries(parts);
}

/* a pool of guttering FLAMES, each owned by a machine (aOwner: its pulse slot, −1 none): a strike makes
   it flare brighter and bigger (uPulse — the room writes it each frame). glowPoints (common.js) + owners. */
function ownedPoints(cap, { map, flicker, rate, pulse, gain = 1.4, grow = .4 }){
  const g = new THREE.BufferGeometry();
  for (const [k, n] of [['position', 3], ['aColor', 3], ['aSize', 1], ['aPhase', 1], ['aOwner', 1]])
    g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(cap * n), n));
  g.setDrawRange(0, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: map }, uScale: { value: 1 }, uFlicker: { value: flicker }, uRate: { value: rate },
                uBoost: { value: 1 }, uPulse: pulse, uGain: { value: gain }, uGrow: { value: grow } },
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aSize, aPhase, aOwner;
      uniform float uTime, uScale, uFlicker, uRate, uBoost, uGain, uGrow;
      uniform float uPulse[${FOOT.MAX_PULSE}];
      varying vec3 vColor;
      void main(){
        float k = uPulse[int(max(aOwner, 0.) + .5)] * step(-.5, aOwner);
        float f = 1. - uFlicker * (.5 + .5 * sin(uTime * uRate + aPhase * 6.283) * sin(uTime * uRate * .53 + aPhase * 11.));
        vColor = aColor * f * uBoost * (1. + uGain * k);
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        gl_PointSize = aSize * uScale * (300. / -mv.z) * (.85 + .15 * f) * (1. + uGrow * k);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; varying vec3 vColor;
      void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vColor, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}
/* the WISPS: each drifts from its home (position) toward aTo as its machine's slow envelope rises (the
   ones with no machine, aOwner −1, just drift) — brighter, and steadier, while it is drawn in */
function wispPoints(cap, { map, pulse }){
  const g = new THREE.BufferGeometry();
  for (const [k, n] of [['position', 3], ['aTo', 3], ['aColor', 3], ['aSize', 1], ['aPhase', 1], ['aOwner', 1]])
    g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(cap * n), n));
  g.setDrawRange(0, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: map }, uBoost: { value: 1 }, uPulse: pulse },
    vertexShader: /* glsl */`
      attribute vec3 aTo, aColor; attribute float aSize, aPhase, aOwner;
      uniform float uTime, uBoost; uniform float uPulse[${FOOT.MAX_PULSE}];
      varying vec3 vColor;
      void main(){
        float k = uPulse[int(max(aOwner, 0.) + .5)] * step(-.5, aOwner);
        float e = k * k * (3. - 2. * k);
        vec3 p = mix(position, aTo, .85 * e);
        float dr = 2.6 * (1. - .7 * e);
        p.y += dr * sin(uTime * .21 + aPhase * 3.1) * .55;
        p.x += dr * sin(uTime * .17 + aPhase * 5.3) * .8;
        p.z += dr * sin(uTime * .13 + aPhase * 2.3) * .5;
        float f = 1. - .75 * (1. - .6 * e) * (.5 + .5 * sin(uTime * 1.7 + aPhase * 6.283) * sin(uTime * .9 + aPhase * 11.));
        vColor = aColor * f * uBoost * (.6 + 1.3 * e);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_PointSize = aSize * (300. / -mv.z) * (.85 + .15 * f) * (1. + .35 * e);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; varying vec3 vColor;
      void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vColor, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}
/* a vertex colour over a whole geometry (the graves' stone multiplies it: the plots' mossy fill) */
function paint(g, [r, gg, b]){
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++){ c[3 * i] = r; c[3 * i + 1] = gg; c[3 * i + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
/* a tiny stable hash of a position (a candle's height, its flame's phase) */
const hash2 = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

export default {
  key: 'graveyard', label: 'Midnight Graveyard',
  build(scene, { envMap }){
    const FOOT_STYLE = graveyardStyle().warm(envMap);
    const group = new THREE.Group();
    const R = rng(1031);
    const F = STAGE.FLOOR;
    const NI = g => g.toNonIndexed();

    // ---- the sky dome (fog-free; its horizon band is the fog colour) ----
    const skyMat = new THREE.MeshBasicMaterial({ map: skyTex(), side: THREE.BackSide, fog: false, depthWrite: false });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_R, 48, 24), skyMat);
    sky.position.y = F + 6; sky.renderOrder = -10; group.add(sky);
    const skyBase = skyMat.color.clone();

    // ---- the moon, its halo, and rags of cloud across it ----
    const moonMat = new THREE.MeshBasicMaterial({ map: moonTex(), transparent: true, fog: false, depthWrite: false,
      color: new THREE.Color(1.3, 1.32, 1.22) });
    const moon = new THREE.Mesh(new THREE.PlaneGeometry(MOON_R * 2, MOON_R * 2), moonMat);
    moon.position.copy(MOON); moon.lookAt(0, 6, 40); moon.renderOrder = -9; group.add(moon);
    const haloMat = glowMat(radialTex(128, [[0, .9], [.18, .45], [.45, .12], [1, 0]]), 0x9fb8c8, .55);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(MOON_R * 7, MOON_R * 7), haloMat);
    halo.position.copy(MOON).add(new THREE.Vector3(0, 0, 1)); halo.lookAt(0, 6, 40); halo.renderOrder = -8; group.add(halo);
    const clouds = [0, 1, 2, 3].map(i => {
      const m = new THREE.MeshBasicMaterial({ alphaMap: cloudRagTex(77 + i), color: 0x1c2630, transparent: true, opacity: .8, fog: false, depthWrite: false });
      const c = new THREE.Mesh(new THREE.PlaneGeometry(70 + 20 * i, 16 + 6 * (i % 2)), m);
      c.position.set(MOON.x, MOON.y - 10 + 9 * i, MOON.z + 4 + i); c.lookAt(0, 6, 40); c.renderOrder = -7;
      group.add(c);
      return { c, m, speed: 1.1 + .45 * i, off: 37 * i, y: c.position.y };
    });

    // ---- the ground: moonlit grass + earth, far bigger than the room ----
    const gT = groundTex(); gT.wrapS = gT.wrapT = THREE.RepeatWrapping; gT.repeat.set(36, 36);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(320, 320),
      new THREE.MeshStandardMaterial({ map: gT, roughness: .95, metalness: 0, color: 0xc4d2c4 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, F, -20); group.add(ground);


    // ---- the GRAVES (graveyard-place.js says where — place()): headstones, Celtic crosses, obelisks
    //      stand round the stage; ledger slabs and kerbed plots lie low among the machines. Human scale
    //      (1 u ≈ .677 m): a headstone ≈ 1.3 m, a cross ≈ 2.4 m, an obelisk ≈ 4.5 m. One instance pool per
    //      kind, sized for every plot the yard has; place() re-poses them (no rebuild). ----
    const stone = new THREE.MeshStandardMaterial({ map: stoneTex(), color: 0xd0d6cc, roughness: .92, metalness: 0, envMap, envMapIntensity: .15 });
    const GEO = {
      head: mergeGeometries([
        new THREE.BoxGeometry(1.7, .26, .62).translate(0, .13, 0),
        new THREE.BoxGeometry(1.3, .95, .26).translate(0, .26 + .475, 0),
        new THREE.CylinderGeometry(.65, .65, .26, 16, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 1.21, 0),
      ].map(NI)),
      cross: mergeGeometries([
        new THREE.BoxGeometry(1.1, .34, .8).translate(0, .17, 0), new THREE.BoxGeometry(.8, .3, .56).translate(0, .49, 0),
        new THREE.BoxGeometry(.34, 2.9, .26).translate(0, .64 + 1.45, 0), new THREE.BoxGeometry(1.5, .32, .26).translate(0, 2.95, 0),
        new THREE.TorusGeometry(.46, .07, 6, 18).translate(0, 2.95, 0),                 // the Celtic ring
      ].map(NI)),
      obelisk: mergeGeometries([
        new THREE.BoxGeometry(1.7, .5, 1.7).translate(0, .25, 0), new THREE.BoxGeometry(1.25, .9, 1.25).translate(0, .95, 0),
        new THREE.CylinderGeometry(.36, .58, 4.6, 4, 1).rotateY(Math.PI / 4).translate(0, 1.4 + 2.3, 0),
        new THREE.ConeGeometry(.36, .7, 4).rotateY(Math.PI / 4).translate(0, 6.35, 0),
      ].map(NI)),
      ledger: mergeGeometries([                                       // (low: under 1 u, so no shot solve ever sees it)
        new THREE.BoxGeometry(1.6, .2, 2.9).translate(0, .1, 0), new THREE.BoxGeometry(1.36, .2, 2.66).translate(0, .3, 0),
      ].map(NI)),
      plot: mergeGeometries([                                         // a kerbed plot filled with moss, a low tablet at its head
        ...[new THREE.BoxGeometry(.14, .26, 3).translate(-.78, .13, 0), new THREE.BoxGeometry(.14, .26, 3).translate(.78, .13, 0),
        new THREE.BoxGeometry(1.42, .26, .14).translate(0, .13, 1.43), new THREE.BoxGeometry(1.42, .26, .14).translate(0, .13, -1.43),
        new THREE.BoxGeometry(.86, .5, .16).translate(0, .25, -1.22)].map(g => paint(g, [1, 1, 1])),
        paint(new THREE.BoxGeometry(1.42, .13, 2.72).translate(0, .065, .06), [.3, .4, .26]),   // (the grave's mossy fill)
      ].map(NI)),
      stub: mergeGeometries([                                         // a headstone sunk to its shoulders, its top broken away
        new THREE.BoxGeometry(1, .18, .5).translate(0, .09, 0),
        new THREE.BoxGeometry(.52, .6, .2).translate(-.21, .48, 0), new THREE.BoxGeometry(.44, .42, .2).translate(.27, .39, 0),
        new THREE.BoxGeometry(.18, .12, .2).translate(.05, .84 - .12, 0).rotateZ(.2),
      ].map(NI)),
      tcross: mergeGeometries([                                       // a small cross on a low step
        new THREE.BoxGeometry(.5, .16, .4).translate(0, .08, 0),
        new THREE.BoxGeometry(.13, .62, .11).translate(0, .47, 0), new THREE.BoxGeometry(.46, .11, .11).translate(0, .6, 0),
      ].map(NI)),
    };
    for (const k in GEO) if (!GEO[k].attributes.color) paint(GEO[k], [1, 1, 1]);
    const SL = graveSlots(), ALL_PLOTS = SL.home.concat(SL.reserve, SL.low);
    const POOLS = {}, graveStone = stone.clone(); graveStone.vertexColors = true;          // (+ each stone's own weathering: instance colour)
    for (const kind of Object.keys(GEO)){
      const im = new THREE.InstancedMesh(GEO[kind], graveStone, Math.max(1, ALL_PLOTS.filter(g => g.kind === kind).length));
      im.count = 0; group.add(im); POOLS[kind] = im;
    }
    const _gm = new THREE.Matrix4(), _gp = new THREE.Vector3(), _gq = new THREE.Quaternion(), _gs = new THREE.Vector3(), _ge = new THREE.Euler(), _gc = new THREE.Color();
    function poseGraves(list){
      const n = {};
      for (const k in POOLS) n[k] = 0;
      for (const g of list){
        const low = g.kind === 'ledger' || g.kind === 'plot' || g.kind === 'stub' || g.kind === 'tcross';
        _ge.set(g.lean, g.yaw, g.roll); _gq.setFromEuler(_ge); _gp.set(g.x, F - (low ? .05 : .12), g.z); _gs.setScalar(g.s);
        const i = n[g.kind]++, h = hash2(g.z, g.x), w = .8 + .3 * h;
        POOLS[g.kind].setMatrixAt(i, _gm.compose(_gp, _gq, _gs));
        POOLS[g.kind].setColorAt(i, _gc.setRGB(w * (.97 + .06 * hash2(g.x, 3.1)), w, w * (.95 + .05 * h)));
      }
      for (const k in POOLS){ const im = POOLS[k]; im.count = n[k]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; if (n[k]) im.computeBoundingSphere(); }
    }

    // ---- the iron fence: railings with spear finials round three sides of the yard, crooked ----
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: .55, roughness: .55, envMap, envMapIntensity: .5 });
    const postGeo = mergeGeometries([
      new THREE.CylinderGeometry(.05, .05, 2.9, 5).translate(0, 1.45, 0),
      new THREE.ConeGeometry(.12, .36, 4).translate(0, 3.08, 0),
    ].map(NI));
    const posts = [], rails = [];
    const fenceRun = (x0, z0, x1, z1, gap = .62) => {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(L / gap), yaw = Math.atan2(x1 - x0, z1 - z0);
      for (let i = 0; i <= n; i++){
        if (R() < .05) continue;                                      // a missing picket
        const t = i / n;
        posts.push(trs(x0 + (x1 - x0) * t, F, z0 + (z1 - z0) * t, (R() - .5) * .12, 0, (R() - .5) * .12));
      }
      for (const y of [.45, 2.55]) rails.push(trs((x0 + x1) / 2, F + y + (R() - .5) * .16, (z0 + z1) / 2, 0, yaw, (R() - .5) * .015, 1, 1, L));
    };
    fenceRun(-FENCE_X, FENCE_Z, -8, FENCE_Z); fenceRun(8, FENCE_Z, FENCE_X, FENCE_Z);   // a gate gap behind the stage
    fenceRun(-FENCE_X, FENCE_Z, -FENCE_X, 34); fenceRun(FENCE_X, FENCE_Z, FENCE_X, 34);
    group.add(instanced(postGeo, iron, posts), instanced(new THREE.BoxGeometry(.08, .08, 1), iron, rails));
    // the gate's stone piers, a lantern on each (lit by the flames below)
    group.add(instanced(mergeGeometries([new THREE.BoxGeometry(1.6, 4.4, 1.6).translate(0, 2.2, 0), new THREE.BoxGeometry(2, .3, 2).translate(0, 4.55, 0)].map(NI)),
      stone, [trs(-9.5, F, FENCE_Z), trs(9.5, F, FENCE_Z)]));

    // ---- the SILHOUETTES: chapel ruin + dead oaks, fog-free near-black against the sky ----
    const sil = new THREE.MeshBasicMaterial({ color: 0x05080b, fog: false });
    const chapelMat = new THREE.MeshBasicMaterial({ color: 0x070a0e, alphaMap: chapelTex(), alphaTest: .5, fog: false, side: THREE.DoubleSide });
    const chapel = new THREE.Mesh(new THREE.PlaneGeometry(62, 62), chapelMat);
    chapel.position.set(CH_X, F + 31, -100); group.add(chapel);
    // a broken stub of side wall + the bell-cote on the gable
    group.add(instanced(new THREE.BoxGeometry(1.6, 1, 1).translate(0, .5, 0), sil, [
      trs(CH_X + 30, F, -112, 0, 0, 0, 1, 22, 24), trs(CH_X, F + 58, -100, 0, 0, 0, 3, 9, 2.5)]));
    // a warm guttering glow inside the great window (someone left a candle in the ruin)
    const winGlow = new THREE.Mesh(new THREE.PlaneGeometry(26, 34), glowMat(radialTex(), 0xff9a46, .14));
    winGlow.position.set(CH_X, F + 33, -101.5); group.add(winGlow);
    // the lightning's sheet glow, behind the chapel and the trees (opacity driven in update)
    const flashMat = glowMat(radialTex(128, [[0, 1], [.35, .5], [1, 0]]), 0xb8d4ff, 0);
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(260, 120), flashMat);
    flash.position.set(10, F + 40, -128); flash.renderOrder = -8; group.add(flash);
    const trees = [[-64, -66, 38], [-26, -88, 30], [62, -70, 42], [74, -36, 30], [-74, -28, 34], [-4, -96, 26]];
    const treeParts = trees.map(([x, z, h], i) => treeGeo(rng(200 + i), h).translate(x, F, z));   // (already non-indexed: treeGeo merges flat parts)
    group.add(new THREE.Mesh(mergeGeometries(treeParts), sil));


    // ---- FLAMES: candles on the graves, two votives before every machine, the footing's lanterns (its
    //      iron: graveyard-footing.js), the gate's — wax stubs + guttering flames + soft halos + warm
    //      pools. Pools sized for the whole yard; place() writes them. Each flame answers its machine. ----
    const wax = new THREE.MeshStandardMaterial({ color: 0xd8cfb6, roughness: .6, emissive: 0x3a2610 });
    const CAND_CAP = ALL_PLOTS.filter(g => g.candle).length + 2 * FOOT.MAX_PULSE, LAMP_CAP = 160, FL_CAP = CAND_CAP + LAMP_CAP + 2;
    const waxIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(.09, .1, 1, 7).translate(0, .5, 0), wax, CAND_CAP);
    waxIM.count = 0; waxIM.frustumCulled = false; group.add(waxIM);
    const PULSE = { value: new Float32Array(FOOT.MAX_PULSE) }, SLOW = { value: new Float32Array(FOOT.MAX_PULSE) };
    const flame = radialTex(64, [[0, 1], [.12, .7], [.4, .12], [1, 0]]);
    const flames = ownedPoints(FL_CAP, { map: flame, flicker: .45, rate: 11, pulse: PULSE, gain: 1.6, grow: .6 });
    const halos = ownedPoints(FL_CAP, { map: radialTex(64, [[0, .55], [.25, .22], [.6, .05], [1, 0]]), flicker: .3, rate: 6, pulse: PULSE, gain: 2.2, grow: .8 });   // (the halo carries the flare: a flame's core is already white)
    group.add(flames, halos);
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      glowMat(radialTex(), 0xff8a3a, .13, { side: THREE.FrontSide }), CAND_CAP);
    pools.count = 0; pools.frustumCulled = false; group.add(pools);

    // ---- WILL-O'-THE-WISPS: cold green-blue lights drifting low over the far graves — and one for each
    //      machine, that drifts in to it while it plays (graveyard-place wispsFor) ----
    const AMB = 14, wisps = wispPoints(AMB + FOOT.MAX_PULSE, { map: flame, pulse: SLOW });
    group.add(wisps);
    {
      const A = wisps.geometry.attributes;
      for (let i = 0; i < AMB; i++){
        const side = i % 2 ? 1 : -1, x = side * (44 + R() * 14), y = F + 1.4 + R() * 3.4, z = -50 + R() * 80, c = R();
        A.position.setXYZ(i, x, y, z); A.aTo.setXYZ(i, x, y, z);
        A.aColor.setXYZ(i, .35 + .2 * c, 1, .7 + .3 * c); A.aSize.setX(i, .7 + R() * .6); A.aPhase.setX(i, R()); A.aOwner.setX(i, -1);
      }
      wisps.geometry.setDrawRange(0, AMB);
    }

    // ---- GROUND FOG: rolling layers of noise, fading with distance from the stage — and STIRRED at each
    //      machine's foot as it strikes (a glow round its pad in its colour, the noise pushed out) ----
    const fogNoise = noiseTex(4, 34, 52); fogNoise.wrapS = fogNoise.wrapT = THREE.RepeatWrapping;
    const FOG_N = 16;
    const FOG_M = {                                                   // shared by every layer (place() + update() write them)
      uMp: { value: Array.from({ length: FOG_N }, () => new THREE.Vector4()) },   // x, z, cos yaw, sin yaw
      uMe: { value: Array.from({ length: FOG_N }, () => new THREE.Vector4()) },   // half w, half d, envelope, reach (beyond it: no glow)
      uMc: { value: Array.from({ length: FOG_N }, () => new THREE.Color()) },
      uN: { value: 0 },
    };
    const fogMat = (h, k, a, stir) => new THREE.ShaderMaterial({
      uniforms: { uMap: { value: fogNoise }, uTime: { value: 0 }, uA: { value: a }, uK: { value: k },
                  uColor: { value: new THREE.Color(0x8fb4a2) }, uBoost: { value: 1 }, uStir: { value: stir }, ...FOG_M },
      vertexShader: /* glsl */`
        varying vec2 vW;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xz;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap; uniform float uTime, uA, uK, uBoost, uStir; uniform vec3 uColor;
        uniform vec4 uMp[${FOG_N}]; uniform vec4 uMe[${FOG_N}]; uniform vec3 uMc[${FOG_N}]; uniform int uN;
        varying vec2 vW;
        void main(){
          float vD = length(vW - vec2(0., -6.));                    // (per fragment: the plane has 4 vertices)
          // the machines: a strike lights the fog round its pad and pushes it out
          float g = 0.; vec3 gc = vec3(0.); vec2 push = vec2(0.);
          if (uStir > 0.) for (int i = 0; i < ${FOG_N}; i++){
            if (i >= uN) break;
            if (uMe[i].z < .003) continue;
            vec2 d = vW - uMp[i].xy;
            if (dot(d, d) > uMe[i].w * uMe[i].w) continue;         // (far from this machine: its glow is gone)
            vec2 q = vec2(uMp[i].z * d.x - uMp[i].w * d.y, uMp[i].w * d.x + uMp[i].z * d.y);
            vec2 e = abs(q) - uMe[i].xy;
            float sd = length(max(e, 0.)) + min(max(e.x, e.y), 0.);
            float w = uMe[i].z * exp(-max(sd, 0.) * .55) * smoothstep(-2.5, 0., sd);
            g += w; gc += uMc[i] * w; push += d / (length(d) + .5) * w;
          }
          vec2 P = vW - push * uStir;
          float n1 = texture2D(uMap, P * .011 * uK + vec2(uTime * .006, uTime * .002)).a;
          float n2 = texture2D(uMap, P * .023 * uK + vec2(-uTime * .009, uTime * .005)).a;
          float n = smoothstep(.22, .72, n1 + .8 * n2);
          float fade = 1. - smoothstep(85., 130., vD);              // melts into the haze far out
          float G = min(g, 1.);
          vec3 tint = g > .001 ? gc / g : uColor;
          vec3 col = mix(uColor, mix(uColor, tint, .55) * 1.7, G);
          gl_FragColor = vec4(col * uBoost, (n + .3 * G * (1. - n)) * fade * uA * (1. + .45 * G));
        }`,
      transparent: true, depthWrite: false,
    });
    const fogs = [[1.1, 1, .34, 1.6], [2.8, .7, .2, 1.1], [4.8, .45, .09, 0]].map(([h, k, a, stir]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), fogMat(h, k, a, stir));
      m.rotation.x = -Math.PI / 2; m.position.set(0, F + h, -20); m.renderOrder = 2; group.add(m);
      return m;
    });
    const STIR = fogs.map(f => f.material.uniforms.uStir.value);


    // ---- bats wheeling across the moon (instanced, matrices recomposed in place) ----
    const batMat = new THREE.MeshBasicMaterial({ color: 0x020304, alphaMap: batTex(), alphaTest: .5, side: THREE.DoubleSide, fog: false });
    const bats = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.4, 1.2), batMat, N_BATS);
    bats.frustumCulled = false; group.add(bats);
    const batP = Array.from({ length: N_BATS }, (_, i) => ({
      cx: MOON.x * .6 + (R() - .5) * 30, cy: 2 + R() * 18, cz: -64 + (R() - .5) * 36,
      rx: 16 + R() * 26, rz: 8 + R() * 14, w: (.25 + R() * .3) * (i % 3 ? 1 : -1), ph: R() * 6.283, flap: 9 + R() * 5, s: .7 + R() * .6 }));
    const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
    function updateBats(t){
      for (let i = 0; i < N_BATS; i++){
        const b = batP[i], a = b.ph + b.w * t;
        _p.set(b.cx + b.rx * Math.cos(a), b.cy + 3 * Math.sin(a * 2.3 + b.ph), b.cz + b.rz * Math.sin(a));
        const heading = Math.atan2(-b.rx * Math.sin(a) * Math.sign(b.w), b.rz * Math.cos(a) * Math.sign(b.w));
        _e.set(0, heading + Math.PI / 2, .25 * Math.sin(a * 1.7)); _q.setFromEuler(_e);
        const f = Math.sin(t * b.flap + b.ph);
        _s.set(b.s * (.45 + .55 * Math.abs(f)), b.s * (1 + .25 * f), b.s);   // wings beating (span ↔ sweep)
        bats.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      bats.instanceMatrix.needsUpdate = true;
    }
    updateBats(0);

    // ---- DAWN: a rose-grey glow low behind the chapel (opacity driven by the song's sky) ----
    const dawnMat = glowMat(radialTex(128, [[0, 1], [.4, .45], [1, 0]]), 0xd99a8c, 0);
    const dawnGlow = new THREE.Mesh(new THREE.PlaneGeometry(420, 90), dawnMat);
    dawnGlow.position.set(10, F + 6, -130); dawnGlow.renderOrder = -8; group.add(dawnGlow);
    const NIGHT_FOG = new THREE.Color(FOG), DAWN_FOG = new THREE.Color(0x3a3c48);
    const DAWN_SKY = new THREE.Color(2.6, 2.2, 2.35);             // ×the sky texture: ink → slate-rose
    const CLOUD_NIGHT = new THREE.Color(0x1c2630), CLOUD_LIT = new THREE.Color(0x9fb0c8), CLOUD_DAWN = new THREE.Color(0x6a5a66);
    const background = new THREE.Color(FOG);

    /* sheet lightning, a double flicker: d = seconds since the strike */
    const bolt = d => (d < 0 || d > .8) ? 0 : Math.exp(-d * 18) + .7 * Math.exp(-Math.max(0, d - .22) * 14) * (d > .22 ? 1 : 0);
    const hash = k => { const s = Math.sin(k * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
    const wrap = (x, P) => ((x % P) + P) % P;
    /* the song's STORM (cues.storm = beats): a flash on each, same moment every loop.
       No storm declared → a rare faint rumble (hashed 20 s windows, ~1 in 4, at half strength). */
    function lightning(t, cues){
      if (cues && cues.storm){
        const { rollT, beat, P } = cues, lt = wrap(t, P);
        let L = 0;
        for (const b of cues.storm) L = Math.max(L, bolt(wrap(lt - (rollT + b * beat), P)));
        return L;
      }
      const W = 20, k = Math.floor(t / W);
      return hash(k + 7) < .75 ? 0 : .5 * bolt(t - k * W - (3 + hash(k) * 12));
    }
    /* how far toward DAWN (0 night … 1 dawn): the phase in force at this loop beat, eased in
       over 8 beats; across the seam's roll-in night falls back in (a 2.6 s fade). */
    function dawnAt(t, cues){
      if (!cues || !cues.sky || !cues.sky.length) return 0;
      const { rollT, beat, P } = cues, lt = wrap(t, P), b = (lt - rollT) / beat;
      const sky = cues.sky;
      if (lt < rollT){                                                // the roll-in: from the loop's last phase back to the first
        const last = sky[sky.length - 1][1] === 'dawn' ? 1 : 0, first = sky[0][1] === 'dawn' ? 1 : 0;
        const u = lt / rollT, e = u * u * (3 - 2 * u);
        return last + (first - last) * e;
      }
      let k = -1;
      for (let i = 0; i < sky.length; i++) if (sky[i][0] <= b) k = i;
      if (k < 0) return sky[0][1] === 'dawn' ? 1 : 0;
      const to = sky[k][1] === 'dawn' ? 1 : 0, from = k > 0 ? (sky[k - 1][1] === 'dawn' ? 1 : 0) : 0;
      const u = Math.min(1, (b - sky[k][0]) / 8), e = u * u * (3 - 2 * u);
      return from + (to - from) * e;
    }
    let fogBase = -1;                                                 // main's density for this song (read at night)

    /* ---- PLACE: where the machines stand (rooms/index.js anchors + the footing plan) → the yard round
       them. Pure layout (graveyard-place.js) written into the pools; per machine its strike envelopes. ---- */
    const pF = [], pM = [], pS = [];                                  // per pulse slot: flame / fog / wisp envelopes
    const fogSrc = new Int32Array(FOG_N);                             // fog stir j ← the slot that drives it
    const DARK = { at: () => 0, next: () => 0 };
    let nSlot = 0, nFog = 0, props = null;
    const _c = new THREE.Color();
    /* a hung machine's floor rect (its box seen from above) — or null when it flies too high to touch the yard */
    const hungRect = a => Array.isArray(a.box) && a.box[2] < F + GY.REACH
      ? { x: (a.box[0] + a.box[1]) / 2, z: (a.box[4] + a.box[5]) / 2, yaw: 0, hw: (a.box[1] - a.box[0]) / 2, hd: (a.box[5] - a.box[4]) / 2 } : null;
    function place(anchors = [], plan = null){
      const ok = a => a && Number.isFinite(a.x) && Number.isFinite(a.z) && a.w > 0 && a.d > 0;
      const all = (anchors || []).filter(ok);
      const list = all.filter(a => a.kind !== 'hung').concat(all.filter(a => a.kind === 'hung')).slice(0, FOOT.MAX_PULSE);
      const slot = new Map();
      // each machine's answer: its cue over its own loudest strike, timed to its own tempo (graveyard-place)
      list.forEach((a, i) => {
        slot.set(a.key, i);
        const A = answerCue(a.cue), T = answerTiming(A.gap), o = { P: a.P, start: a.start };
        pF[i] = makePulse(A.cue, { ...o, ...T.flame });
        pM[i] = a.kind === 'belt' ? DARK : makePulse(A.cue, { ...o, ...T.fog });   // (the belt never rests: its fog would only glow)
        pS[i] = makePulse(A.cue, { ...o, decay: 2.6, lead: .9 });
      });
      nSlot = list.length; PULSE.value.fill(0); SLOW.value.fill(0);
      // the ghost light on the footing: each pad's strikes over its machine's loudest (graveyard-footing ghostEdge)
      const NORM = FOOT_STYLE.materials?.edge?.uniforms?.uNorm?.value;
      if (NORM){
        NORM.fill(1);
        const byKey = new Map(all.map(a => [a.key, a]));
        for (const p of plan?.pads || []){ const m = answerCue(byKey.get(p.key)?.cue).max; if (m > 0 && p.pulse < NORM.length) NORM[p.pulse] = 1 / m; }
      }
      // the fog at each machine's foot: its pad (footprint + margin) if the plan has one; a hung machine's floor rect
      const padOf = new Map((plan?.pads || []).map(p => [p.key, p]));
      let nf = 0;
      list.forEach((a, i) => {
        if (nf >= FOG_N || pM[i] === DARK) return;
        const p = a.kind === 'hung' ? hungRect(a) : padOf.get(a.key) || { x: a.x, z: a.z, yaw: a.yaw || 0, hw: a.w / 2, hd: a.d / 2 };
        if (!p) return;
        FOG_M.uMp.value[nf].set(p.x, p.z, Math.cos(p.yaw || 0), Math.sin(p.yaw || 0));
        FOG_M.uMe.value[nf].set(p.hw, p.hd, 0, Math.max(p.hw, p.hd) + 7);
        FOG_M.uMc.value[nf].set(a.color ?? 0x8fb4a2);
        fogSrc[nf++] = i;
      });
      FOG_M.uN.value = nFog = nf;
      // the graves: kept clear of every machine and support; the displaced moved further out
      const obs = obstaclesOf(anchors, plan, F), G = placeGraves(anchors, plan, { floor: F, obs }), graves = G.tall.concat(G.low);
      poseGraves(graves);
      // the flames: candles on the graves (the nearest machine within 6 u owns one), votives, lanterns, the gate
      const rects = list.map(a => (a.kind === 'hung' ? hungRect(a) : null) || { x: a.x, z: a.z, hw: a.w / 2, hd: a.d / 2, yaw: a.kind === 'hung' ? 0 : a.yaw || 0 });
      const ownerAt = (x, z) => { let best = 6, who = -1; rects.forEach((r, i) => { const d = rectDist(r, x, z); if (d < best){ best = d; who = i; } }); return who; };
      const FA = flames.geometry.attributes, HA = halos.geometry.attributes;
      let nF = 0, nW = 0;
      const lit = (x, y, z, size, col, halo, owner) => {
        if (nF >= FL_CAP) return;
        const ph = hash2(x, z);
        FA.position.setXYZ(nF, x, y, z); FA.aColor.setXYZ(nF, col[0], col[1], col[2]); FA.aSize.setX(nF, size); FA.aPhase.setX(nF, ph); FA.aOwner.setX(nF, owner);
        HA.position.setXYZ(nF, x, y + .08, z); HA.aColor.setXYZ(nF, col[0] * .42, col[1] * .32, col[2] * .27); HA.aSize.setX(nF, halo); HA.aPhase.setX(nF, (ph * 7.3) % 1); HA.aOwner.setX(nF, owner);
        nF++;
      };
      const candle = (x, z, h, thick, owner) => {
        if (nW >= CAND_CAP) return;
        waxIM.setMatrixAt(nW, trs(x, F, z, 0, 0, 0, thick, h, thick));
        pools.setMatrixAt(nW, trs(x, F + .03, z, 0, 0, 0, 3.4, 1, 3.4));
        nW++;
        lit(x, F + h + .1, z, .42, [1, .62, .26], 3.2, owner);
      };
      const GC = graveCandles(graves, obs);
      for (const c of GC) candle(c.x, c.z, .32 + .3 * hash2(c.z, c.x), 1, ownerAt(c.x, c.z));
      const VO = votives(anchors, plan, obs);
      for (const v of VO) candle(v.x, v.z, .5 + .25 * hash2(v.z, v.x), 1.45, slot.get(v.key) ?? -1);
      const FLs = plan ? footLights(plan) : [];
      for (const l of FLs) lit(l.x, l.y - .02, l.z, .62, [1, .7, .36], 4.2, slot.get(l.key) ?? -1);
      for (const x of [-9.5, 9.5]) lit(x, F + 5.1, FENCE_Z, 1, [1, .7, .35], 9, -1);
      waxIM.count = pools.count = nW;
      waxIM.instanceMatrix.needsUpdate = pools.instanceMatrix.needsUpdate = true;
      for (const k of ['position', 'aColor', 'aSize', 'aPhase', 'aOwner']){ FA[k].needsUpdate = true; HA[k].needsUpdate = true; }
      flames.geometry.setDrawRange(0, nF); halos.geometry.setDrawRange(0, nF);
      // the wisps: one per machine, its home off the machine's front corner
      const WA = wisps.geometry.attributes, WS = plan ? wispsFor(anchors, plan, F) : [];
      let nWi = AMB;
      for (const w of WS){
        const i = slot.get(w.key); if (i === undefined || nWi >= AMB + FOOT.MAX_PULSE) continue;
        _c.set(list[i].color ?? 0x8fffd8);
        const ph = hash2(w.home[0], w.home[2]);
        WA.position.setXYZ(nWi, w.home[0], w.home[1], w.home[2]); WA.aTo.setXYZ(nWi, w.to[0], w.to[1], w.to[2]);
        WA.aColor.setXYZ(nWi, .3 + .25 * _c.r, .85 + .15 * _c.g, .65 + .25 * _c.b); WA.aSize.setX(nWi, .75 + .3 * ph); WA.aPhase.setX(nWi, ph); WA.aOwner.setX(nWi, i);
        nWi++;
      }
      for (const k of ['position', 'aTo', 'aColor', 'aSize', 'aPhase', 'aOwner']) WA[k].needsUpdate = true;
      wisps.geometry.setDrawRange(0, nWi);
      props = { tall: G.tall.length, low: G.low.length, moved: G.moved, hidden: G.hidden, candles: GC.length, votives: VO.length,
                lanterns: FLs.length, flames: nF, wisps: nWi - AMB, machines: nSlot };
    }
    place();                                                          // (the bare yard, until the song's machines arrive)
    group.userData.props = () => props;                               // (dev: __dev.roomGroup().userData.props())

    return {
      group, ...STAGE, HW: FENCE_X, BACK: FENCE_Z, FRONT: 40,
      fog: new THREE.FogExp2(FOG, .017), background,
      mood: { ambient: [0x26324a, 1.6], hemi: [0x9db4e0, 0x141c16, .95] },   // cold moonlight
      // the footing (rooms/footing3d.js): ledger stones, chest tombs, mausolea, timber scaffolds, crypt terraces
      footing: FOOT_STYLE,
      place,
      /** (dev) what place() put where: graves kept / moved, candles, lanterns, wisps */
      props: () => props,
      /** the headset: the fog's per-machine stir off (a loop per fragment per eye) — the flames still answer */
      xr(on){ fogs.forEach((f, i) => { f.material.uniforms.uStir.value = on ? 0 : STIR[i]; }); },
      update(dt, songTime, camera, energy = 0, cues = null){
        const t = songTime;
        const L = lightning(t, cues), Dn = dawnAt(t, cues);
        // the machines' envelopes (pure fns of songTime): flames flare, the fog stirs, the wisps drift in
        for (let i = 0; i < nSlot; i++){
          const f = pF[i].at(t) + .35 * pF[i].next(t);
          PULSE.value[i] = f > 1 ? 1 : f;
          SLOW.value[i] = Math.max(pS[i].at(t), pS[i].next(t));
        }
        for (let j = 0; j < nFog; j++){ const q = pM[fogSrc[j]]; FOG_M.uMe.value[j].z = Math.max(q.at(t), .5 * q.next(t)); }
        flames.material.uniforms.uTime.value = t; halos.material.uniforms.uTime.value = t;
        wisps.material.uniforms.uTime.value = t;
        flames.material.uniforms.uBoost.value = (1 + .3 * energy) * (1 - .75 * Dn);   // the candles gutter at dawn
        halos.material.uniforms.uBoost.value = 1 - .8 * Dn;
        wisps.material.uniforms.uBoost.value = 1 - .95 * Dn;                          // the wisps flee the light
        for (const f of fogs) f.material.uniforms.uTime.value = t;
        for (const c of clouds){                                        // slide across the moon, fade at the ends
          const span = 150, u = ((t * c.speed + c.off) % span + span) % span;
          c.c.position.x = MOON.x - span / 2 + u;
          c.m.opacity = .75 * Math.sin(Math.PI * u / span);
          c.m.color.copy(CLOUD_NIGHT).lerp(CLOUD_DAWN, Dn).lerp(CLOUD_LIT, Math.min(1, .8 * L));   // a flash lights their rims
        }
        updateBats(t);
        skyMat.color.copy(skyBase).lerp(DAWN_SKY, Dn).multiplyScalar(1 + .7 * L);
        flashMat.opacity = .85 * L;
        dawnMat.opacity = .5 * Dn;
        moonMat.opacity = 1 - .45 * Dn;
        haloMat.opacity = (.55 + .25 * energy) * (1 - .6 * Dn) + .6 * L;
        for (const f of fogs) f.material.uniforms.uBoost.value = (1 + 1.4 * L) * (1 + .5 * Dn);
        // the shared FogExp2 (owned by the host; this room tints it while it's showing):
        // greyer and ~30 % thinner at dawn. main sets the song's density — read it at night.
        const fog = scene.fog;
        if (fog){
          if (Dn === 0 || fogBase < 0) fogBase = fog.density;
          fog.density = fogBase * (1 - .3 * Dn);
          fog.color.copy(NIGHT_FOG).lerp(DAWN_FOG, Dn);
          background.copy(fog.color);
        }
      },
      dispose(){ FOOT_STYLE.dispose(); },
    };
  },
};
