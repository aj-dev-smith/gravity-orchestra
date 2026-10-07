import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STAGE, rng, canvasTex, radialTex, beamMat, instanced, trs } from './common.js';
/* ============================================================
   STARSHIP DECK — the stage is the open deck of a ship cruising through
   deep space (animusic.md §4 R2). A plated hull deck with railings, a
   ribbed glass canopy arching overhead and closing in a bow dome behind
   the belt, two engine nacelles slung outboard on pylons whose coil rings
   chase and glow with the music, and, outside, space streaming past.

   TIME IS THE ONLY STATE. Every moving thing outside is a pure function of
   songTime: the star streaks and the nebula banks advance as
   z = z0 + v·t (mod L), with every speed an integer multiple of L/T_WRAP so
   the field is EXACTLY periodic in T_WRAP — the CPU hands the shader
   songTime mod T_WRAP in double precision, so a scrub, a long session or a
   loop seam never jitters or snaps.

   BANKING (render-time only): the ship rolls gently into a turn on phrase
   bar lines and levels out on the next — `bankAt(songTime, cues)`, a pure
   C2 fn of the loop-local beat, level across the loop's breath so the seam
   is seamless. It is the SKY that tilts (sky dome + star field + nebula
   rotate about the ship's axis), never the deck: the instruments' frame,
   their physics and every solved contact stay exactly where they are.

   Floor contract: the deck top IS STAGE.FLOOR. The canopy rises far above
   STAGE.CEIL and every long rib / rail spans > 40 u (the shot solve reads
   them as the hall's shell, not standing obstacles); the glass is a
   transparent shader (never an occluder). Owns no lights.
   Perf: ~21 draw calls, all instanced/merged; per frame = a handful of
   uniforms + 72 instance colours. No allocation.
   ============================================================ */

const F = STAGE.FLOOR;
const FOG = 0x05070f;
const DECK_X = 48;                 // deck half-width (stations live inside |x| ≤ 35.5)
const DECK_Z0 = -44, DECK_Z1 = 46; // canopy/bow seam … stern
const BOW = 22;                    // bow dome depth beyond DECK_Z0
const CAN_B = 70;                  // canopy height (semi-axis): apex at F + 70 = 48, far above STAGE.CEIL
const CAN_Z1 = 26;                 // the canopy's open stern end (the audience camera sits aft of it)
const AXIS = new THREE.Vector3(0, 5, -4);   // the ship's roll axis (≈ the strike band, mid-deck)

/* ---- the moving sky: periodic wrap ---- */
export const T_WRAP = 60;          // every speed is n·L/T_WRAP (integer n) → periodic in T_WRAP s
export const STREAK = { z0: -210, L: 340, r0: 80, r1: 190, n0: 5, n1: 13 };
export const NEB = { z0: -230, L: 360, r0: 140, r1: 185 };
/* songTime mod T_WRAP, in [0, T_WRAP) (double precision on the CPU → the shader gets a small float) */
export const skyClock = t => ((t % T_WRAP) + T_WRAP) % T_WRAP;
/* a streak's z at songTime (the shader's formula, for tests): periodic in T_WRAP by construction */
export function streakZ(z0, n, t, { z0: zmin, L } = STREAK){
  const v = n * L / T_WRAP, u = (z0 - zmin + v * skyClock(t)) % L;
  return zmin + (u < 0 ? u + L : u);
}

/* ---- banking on bar lines ---- */
export const BANK = { roll: .1, yaw: .32, bar: 4 };   // ~5.7° roll, coordinated nose-yaw ∝ roll, 4-beat bars
const s5 = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (u * (u * 6 - 15) + 10);   // smootherstep (C2)
/* bank (radians of roll) at songTime. Phrases of 4 bars (2 on a short loop): each phrase that
   fits wholly inside the loop eases INTO a turn across its first bar, holds, and eases OUT across
   its last — level on every phrase line, and level through the breath → continuous at the seam.
   Turns alternate starboard / port. Pure: same songTime, same bank. */
export function bankAt(songTime, cues){
  if (!cues || !(cues.beat > 0) || !(cues.P > 0)) return 0;
  const { rollT = 0, beat, P } = cues;
  const u = ((songTime % P) + P) % P, b = (u - rollT) / beat;
  const span = (P - rollT) / beat;                         // beats from the downbeat to the seam
  const ph = span >= 8 * BANK.bar ? 4 * BANK.bar : 2 * BANK.bar;
  if (b < 0) return 0;
  const k = Math.floor(b / ph);
  if ((k + 1) * ph > span + 1e-9) return 0;                 // a partial last phrase stays level
  const x = b - k * ph, e = BANK.bar;
  const s = k % 2 ? -1 : 1;
  return s * BANK.roll * (x < e ? s5(x / e) : x > ph - e ? s5((ph - x) / e) : 1);
}
/* loop-local beat count at songTime (negative in the roll-in). The loop P = roll-in + the song's
   beats + a breath that is NOT a whole number of beats, so anything that pulses on the beat must
   count from the loop's own downbeat — counting from songTime 0 drifts off the music after loop 1. */
export function loopBeat(songTime, cues){
  if (!cues || !(cues.beat > 0) || !(cues.P > 0)) return NaN;
  const { rollT = 0, beat, P } = cues;
  return ((((songTime % P) + P) % P) - rollT) / beat;
}
/* the beat thump for the engines: 1 on each beat, decaying (0 before the downbeat) */
export function beatPulse(songTime, cues){
  const b = loopBeat(songTime, cues);
  if (!(b >= 0)) return 0;
  return Math.exp(-(b - Math.floor(b)) * 5);
}

/* ---------------- textures ---------------- */
function skyTex(){
  return canvasTex(2048, 1024, (x, w, h) => {
    const R = rng(404);
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#010208'); g.addColorStop(.45, '#04071a'); g.addColorStop(.52, '#071030');
    g.addColorStop(.6, '#040818'); g.addColorStop(1, '#010206');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'lighter';
    const blob = (cx, cy, rx, ry, col, a) => {
      for (const ox of [-w, 0, w]){
        x.save(); x.translate(cx + ox, cy); x.scale(rx / ry, 1);
        const gr = x.createRadialGradient(0, 0, 0, 0, 0, ry);
        gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
        x.fillStyle = gr; x.beginPath(); x.arc(0, 0, ry, 0, Math.PI * 2); x.fill(); x.restore();
      }
    };
    // a tilted galactic band: teal dust with warm amber knots (distinct from the Void's violet river)
    const cols = ['40,140,190', '30,90,170', '60,190,200', '230,140,70', '200,90,60'];
    for (let i = 0; i < 300; i++){
      const u = R(), cx = u * w, cy = h * (.5 + .16 * Math.sin(u * Math.PI * 2 + .7) + (R() - .5) * .1);
      const c = R() < .2 ? cols[3 + (R() * 2 | 0)] : cols[R() * 3 | 0];
      blob(cx, cy, 50 + R() * 150, 20 + R() * 60, c, .018 + R() * .04);
    }
    for (let i = 0; i < 70; i++){                            // dark lanes through the band
      const u = R(); x.globalCompositeOperation = 'source-over';
      const cx = u * w, cy = h * (.5 + .16 * Math.sin(u * Math.PI * 2 + .7) + (R() - .5) * .04);
      blob(cx, cy, 80 + R() * 120, 6 + R() * 10, '2,3,10', .25);
      x.globalCompositeOperation = 'lighter';
    }
    for (let i = 0; i < 7000; i++){
      const sx = R() * w, sy = R() * h, b = R();
      const c = b > .97 ? '255,215,170' : b > .9 ? '180,210,255' : '230,236,255';
      x.fillStyle = `rgba(${c},${.2 + .8 * R() * R()})`;
      const s = b > .988 ? 2.4 : b > .9 ? 1.4 : .9; x.fillRect(sx, sy, s, s);
      if (b > .994) blob(sx, sy, 8, 8, c, .3);
    }
    x.globalCompositeOperation = 'source-over';
    // a gas giant low in the sky ahead (seen through the bow dome); banking swings it
    const px = w * .67, py = h * .6, pr = 80;
    const pg = x.createRadialGradient(px + pr * .5, py - pr * .35, pr * .05, px, py, pr);
    pg.addColorStop(0, '#f2c58a'); pg.addColorStop(.35, '#b0663a'); pg.addColorStop(.75, '#3a1a14'); pg.addColorStop(1, '#0a0508');
    x.save(); x.beginPath(); x.arc(px, py, pr, 0, Math.PI * 2); x.clip();
    x.fillStyle = pg; x.fillRect(px - pr, py - pr, 2 * pr, 2 * pr);
    for (let i = 0; i < 18; i++){                            // cloud belts
      x.fillStyle = `rgba(${R() < .5 ? '255,200,150' : '90,40,30'},${.05 + R() * .08})`;
      x.fillRect(px - pr, py - pr + i * pr * 2 / 18 + R() * 4, 2 * pr, 3 + R() * 8);
    }
    const sh = x.createRadialGradient(px - pr * .7, py + pr * .5, pr * .2, px - pr * .3, py + pr * .2, pr * 1.3);   // night side
    sh.addColorStop(0, 'rgba(0,0,6,.95)'); sh.addColorStop(.6, 'rgba(0,0,6,.6)'); sh.addColorStop(1, 'rgba(0,0,6,0)');
    x.fillStyle = sh; x.fillRect(px - pr, py - pr, 2 * pr, 2 * pr); x.restore();
    x.globalCompositeOperation = 'lighter';
    blob(px + pr * .2, py - pr * .1, pr * 1.25, pr * 1.25, '255,170,110', .06);   // atmosphere limb glow
  });
}

/* plated deck: panels, seams, rivets, hazard edging; the EMISSIVE map carries the inlaid light strips */
function deckTex(R){
  const draw = emissive => (x, w) => {
    x.fillStyle = emissive ? '#000' : '#232833'; x.fillRect(0, 0, w, w);
    const n = 4, s = w / n;
    if (!emissive){
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++){
        const v = 36 + R() * 14 | 0;
        x.fillStyle = `rgb(${v},${v + 3},${v + 9})`; x.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
        x.fillStyle = 'rgba(255,255,255,.04)';                       // brushed sheen streaks
        for (let k = 0; k < 14; k++) x.fillRect(i * s + 6, j * s + 6 + R() * (s - 12), s - 12, 1);
        x.fillStyle = 'rgba(0,0,0,.55)';                            // rivets
        for (const [a, b] of [[10, 10], [s - 12, 10], [10, s - 12], [s - 12, s - 12]]) x.fillRect(i * s + a, j * s + b, 3, 3);
      }
      x.strokeStyle = 'rgba(4,5,8,.95)'; x.lineWidth = 4;
      for (let i = 0; i <= n; i++){ x.beginPath(); x.moveTo(i * s, 0); x.lineTo(i * s, w); x.stroke();
        x.beginPath(); x.moveTo(0, i * s); x.lineTo(w, i * s); x.stroke(); }
    }
    // inlaid light strips: one long seam across the tile, short dashes at the cross seam
    x.fillStyle = emissive ? 'rgba(90,200,255,1)' : 'rgba(60,110,140,1)';
    x.fillRect(0, w / 2 - 2, w, 4);
    for (let i = 0; i < 8; i++) x.fillRect(w / 2 - 2, i * w / 8 + 10, 4, w / 16);
  };
  return { map: canvasTex(512, 512, draw(false)), emi: canvasTex(512, 512, draw(true)) };
}

function puffTex(){                                       // a soft lumpy nebula bank (alpha only)
  return canvasTex(256, 256, (x, w) => {
    const R = rng(9);
    for (let i = 0; i < 46; i++){
      const a = R() * Math.PI * 2, r = Math.pow(R(), .7) * w * .3;
      const cx = w / 2 + Math.cos(a) * r, cy = w / 2 + Math.sin(a) * r * .7, rr = 18 + R() * 50;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, `rgba(255,255,255,${.06 + R() * .1})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(cx - rr, cy - rr, 2 * rr, 2 * rr);
    }
    const e = x.createRadialGradient(w / 2, w / 2, w * .3, w / 2, w / 2, w / 2);   // never a hard square edge
    e.addColorStop(0, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,1)');
    x.globalCompositeOperation = 'destination-out'; x.fillStyle = e; x.fillRect(0, 0, w, w);
  }, { srgb: false });
}

/* ---------------- moving-sky materials (instanced, all motion in the vertex shader) ---------------- */
function streakMat(){
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uBlur: { value: .1 }, uGain: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec3 aBase; attribute float aN; attribute vec3 aCol; attribute float aSize;
      uniform float uT, uBlur;
      varying vec3 vC; varying float vA;
      void main(){
        float v = aN * ${(STREAK.L / T_WRAP).toFixed(6)};
        float z = ${STREAK.z0.toFixed(1)} + mod(aBase.z + v * uT, ${STREAK.L.toFixed(1)});
        vec3 head = aBase; head.z = z;
        float len = v * uBlur;
        vec3 hw = (modelMatrix * vec4(head, 1.)).xyz;
        vec3 tw = (modelMatrix * vec4(head - vec3(0., 0., len), 1.)).xyz;
        vec3 p = mix(hw, tw, position.x);
        vec3 d = normalize(hw - tw), toC = cameraPosition - p;
        float dist = length(toC);
        vec3 side = normalize(cross(d, toC / dist) + vec3(1e-5, 0., 0.));
        p += side * position.y * max(.12, dist * .0016) * aSize;
        // fade in after the wrap (far ahead), out as it nears the wrap behind; fade with distance
        float zl = z - ${STREAK.z0.toFixed(1)};
        float wrapF = smoothstep(0., 60., zl) * (1. - smoothstep(${(STREAK.L - 40).toFixed(1)}, ${STREAK.L.toFixed(1)}, zl));
        float far = 1. - smoothstep(150., 195., dist);
        vA = wrapF * far * (1. - position.x);                       // bright head → clear tail
        vC = aCol;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: /* glsl */`
      uniform float uGain; varying vec3 vC; varying float vA;
      void main(){ gl_FragColor = vec4(vC * uGain, vA); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
  });
}
function nebulaMat(map){
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uMap: { value: map }, uGain: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec3 aBase; attribute float aN; attribute vec3 aCol; attribute float aSize; attribute float aRot;
      uniform float uT;
      varying vec3 vC; varying float vA; varying vec2 vUv;
      void main(){
        float z = ${NEB.z0.toFixed(1)} + mod(aBase.z + aN * ${(NEB.L / T_WRAP).toFixed(6)} * uT, ${NEB.L.toFixed(1)});
        vec3 c = aBase; c.z = z;
        vec4 mv = modelViewMatrix * vec4(c, 1.);
        float cs = cos(aRot), sn = sin(aRot);
        vec2 q = vec2(cs * position.x - sn * position.y, sn * position.x + cs * position.y);
        mv.xy += q * aSize;
        float zl = z - ${NEB.z0.toFixed(1)};
        float dist = length(mv.xyz);
        vA = smoothstep(0., 90., zl) * (1. - smoothstep(${(NEB.L - 90).toFixed(1)}, ${NEB.L.toFixed(1)}, zl)) * (1. - smoothstep(170., 198., dist));
        vC = aCol; vUv = position.xy + .5;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform float uGain; varying vec3 vC; varying float vA; varying vec2 vUv;
      void main(){ gl_FragColor = vec4(vC * uGain, texture2D(uMap, vUv).a * vA); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
  });
}
/* the canopy glass: fresnel sheen + faint panel lattice; additive, so it only ever adds light */
function glassMat(){
  return new THREE.ShaderMaterial({
    uniforms: { uGain: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      void main(){ vW = (modelMatrix * vec4(position, 1.)).xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.); }`,
    fragmentShader: /* glsl */`
      uniform float uGain; varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float f = 1. - abs(dot(normalize(vN), V));
        vec2 g = abs(fract(vUv * vec2(16., 6.)) - .5);
        float lat = smoothstep(.47, .5, max(g.x, g.y));
        float a = (pow(f, 7.) * .28 + .008 + lat * .018) * uGain;
        gl_FragColor = vec4(mix(vec3(.35, .75, 1.), vec3(.6, .5, 1.), vUv.y), a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
  });
}

/* an indexed (u, v) surface patch */
function surf(nu, nv, f){
  const pos = [], uv = [], idx = [], p = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++){
    f(i / nu, j / nv, p); pos.push(p.x, p.y, p.z); uv.push(i / nu, j / nv);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++){
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/* canopy: elliptic cylinder x = A cosθ, y = F + B sinθ (θ ∈ [0, π]) from DECK_Z0 to CAN_Z1,
   closed ahead by a half-ellipsoid bow dome to DECK_Z0 − BOW */
const CA = DECK_X;
const canopyAt = (th, z, p) => p.set(CA * Math.cos(th), F + CAN_B * Math.sin(th), z);
const domeAt = (th, ph, p) => p.set(CA * Math.cos(th) * Math.cos(ph), F + CAN_B * Math.sin(th) * Math.cos(ph), DECK_Z0 - BOW * Math.sin(ph));

/* the deck's plan outline (x, z): a stern with chamfered corners, straight sides, a bow ellipse */
function outline(){
  const pts = [[-DECK_X + 8, DECK_Z1], [DECK_X - 8, DECK_Z1], [DECK_X, DECK_Z1 - 8], [DECK_X, DECK_Z0]];
  for (let i = 1; i < 24; i++){ const a = i / 24 * Math.PI;
    pts.push([DECK_X * Math.cos(a), DECK_Z0 - BOW * Math.sin(a)]); }
  pts.push([-DECK_X, DECK_Z0], [-DECK_X, DECK_Z1 - 8]);
  return pts;
}

export default {
  key: 'starship', label: 'Starship',
  build(scene, { envMap }){
    const group = new THREE.Group();
    const R = rng(1977);

    /* ================= THE SHIP (fixed: the instruments' frame) ================= */
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x2a303d, metalness: .85, roughness: .3, envMap, envMapIntensity: 1.2 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0e15, metalness: .7, roughness: .45, envMap, envMapIntensity: .6 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0x9aa3b5, metalness: 1, roughness: .18, envMap, envMapIntensity: 1.1 });

    // ---- deck top + hull ----
    const O = outline();
    const tex = deckTex(R);
    for (const t of [tex.map, tex.emi]){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 16, 1 / 16); }
    const deckGeo = new THREE.ShapeGeometry(new THREE.Shape(O.map(([x, z]) => new THREE.Vector2(x, -z)))).rotateX(-Math.PI / 2);
    const deckMat = new THREE.MeshStandardMaterial({ map: tex.map, emissive: 0x3aa0d8, emissiveMap: tex.emi, emissiveIntensity: .45,
      metalness: .6, roughness: .38, envMap, envMapIntensity: 1 });
    const deck = new THREE.Mesh(deckGeo, deckMat); deck.position.y = F; group.add(deck);
    // hull beneath: an extruded rim + three stepped keel layers (seen from the side shots and in VR)
    const ext = (k, top, depth) => {
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(O.map(([x, z]) => new THREE.Vector2(x * k, (z + 2) * k - 2))),
        { depth, bevelEnabled: false, curveSegments: 1 }).rotateX(Math.PI / 2);
      return g.translate(0, top, 0);
    };
    group.add(new THREE.Mesh(mergeGeometries([ext(1, F - .01, 2.2), ext(.86, F - 2.2, 3.4), ext(.64, F - 5.6, 4), ext(.36, F - 9.6, 4)]), hullMat));
    // a glowing gunwale line round the deck edge
    const edgeCurve = new THREE.CatmullRomCurve3(O.map(([x, z]) => new THREE.Vector3(x, F - .5, z)), true, 'centripetal');
    const gunwaleMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x4fc8ff).multiplyScalar(1.4), fog: false });
    group.add(new THREE.Mesh(new THREE.TubeGeometry(edgeCurve, 240, .16, 6, true), gunwaleMat));

    // ---- railings: inset 1.6 from the edge (posts + two rails, the top rail chrome) ----
    const inset = O.map(([x, z], i) => {
      const [ax, az] = O[(i - 1 + O.length) % O.length], [bx, bz] = O[(i + 1) % O.length];
      let nx = -(bz - az), nz = bx - ax; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;   // left normal (CCW in x,z → inward)
      if (nx * -x + nz * -(z + 4) < 0){ nx = -nx; nz = -nz; }
      return new THREE.Vector3(x + nx * 1.6, 0, z + nz * 1.6);
    });
    const railCurve = new THREE.CatmullRomCurve3(inset, true, 'centripetal');
    const railAt = y => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railCurve.getSpacedPoints(300).slice(0, -1).map(p => p.clone().setY(F + y)), true), 300, y > 3 ? .14 : .08, 6, true);
    group.add(new THREE.Mesh(railAt(3.4), chrome));
    group.add(new THREE.Mesh(railAt(1.7), darkMat));
    const postPts = railCurve.getSpacedPoints(64).slice(0, -1);
    group.add(instanced(new THREE.CylinderGeometry(.11, .14, 3.4, 6).translate(0, 1.7, 0), darkMat,
      postPts.map(p => trs(p.x, F, p.z))));
    // running lights along the rail foot: a chase streaming aft at the beat (colours per frame)
    const RUN_N = 44;
    const runPts = railCurve.getSpacedPoints(RUN_N).slice(0, -1);
    const runLights = instanced(new THREE.SphereGeometry(.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }),
      runPts.map(p => trs(p.x, F + .25, p.z)));
    runLights.setColorAt(0, new THREE.Color(0)); group.add(runLights);

    // ---- the canopy: ribs + longitudinal stringers (chrome-dark), glass shell + bow dome ----
    const ribs = [];
    const P = new THREE.Vector3();
    const ribCurve = f => new THREE.CatmullRomCurve3(Array.from({ length: 41 }, (_, i) => f(i / 40, new THREE.Vector3())));
    for (let z = DECK_Z0; z <= CAN_Z1 + 1e-6; z += 14)
      ribs.push(new THREE.TubeGeometry(ribCurve((u, p) => canopyAt(u * Math.PI, z, p)), 60, z === CAN_Z1 ? .7 : .42, 8, false));
    for (let k = 1; k <= 5; k++){                                   // stringers: along the cylinder, then over the dome
      const th = k * Math.PI / 6;
      ribs.push(new THREE.TubeGeometry(ribCurve((u, p) => u < .6 ? canopyAt(th, CAN_Z1 + (DECK_Z0 - CAN_Z1) * u / .6, p)
        : domeAt(th, (u - .6) / .4 * Math.PI / 2, p)), 80, .3, 6, false));
    }
    for (let k = 1; k < 4; k++)                                     // dome hoops
      ribs.push(new THREE.TubeGeometry(ribCurve((u, p) => domeAt(u * Math.PI, k / 4 * Math.PI / 2 * .98, p)), 50, .3, 6, false));
    for (const sx of [-1, 1])                                       // canopy footing: a coaming where the glass meets the deck
      ribs.push(new THREE.BoxGeometry(1.4, 1.6, CAN_Z1 - DECK_Z0).translate(sx * (DECK_X - .4), F + .8, (CAN_Z1 + DECK_Z0) / 2));
    group.add(new THREE.Mesh(mergeGeometries(ribs), hullMat));
    // a thin lit seam along the inside of every transverse rib
    const seams = [];
    for (let z = DECK_Z0; z <= CAN_Z1 + 1e-6; z += 14)
      seams.push(new THREE.TubeGeometry(ribCurve((u, p) => { canopyAt(u * Math.PI, z, p); p.x *= .985; p.y = F + (p.y - F) * .985; return p; }), 60, .08, 4, false));
    const seamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7fd6ff).multiplyScalar(.45), fog: false });
    group.add(new THREE.Mesh(mergeGeometries(seams), seamMat));
    const glass = glassMat();
    group.add(new THREE.Mesh(mergeGeometries([
      surf(48, 14, (u, v, p) => canopyAt(u * Math.PI, CAN_Z1 + (DECK_Z0 - CAN_Z1) * v, p)),
      surf(48, 10, (u, v, p) => domeAt(u * Math.PI, v * Math.PI / 2, p)),
    ]), glass));

    // ---- engine nacelles on pylons, outboard below the deck line ----
    const NX = 64, NY = F - 7, NZ0 = -52, NZ1 = 36;               // nacelle centre-line, intake z → nozzle z
    const prof = [[3.6, 0], [5.6, 1.2], [6, 5], [6, 60], [5.5, 72], [4.6, NZ1 - NZ0 - 2], [5.2, NZ1 - NZ0]];   // (radius, along)
    const lathe = new THREE.LatheGeometry(prof.map(([r, a]) => new THREE.Vector2(r, a)), 40).rotateX(Math.PI / 2);   // lathe +y → +z
    const nac = [], pyl = [];
    for (const sx of [-1, 1]){
      nac.push(lathe.clone().translate(sx * NX, NY, NZ0));
      nac.push(new THREE.CircleGeometry(3.6, 32).rotateY(Math.PI).translate(sx * NX, NY, NZ0 + .02));   // intake fan face (dark)
      pyl.push(new THREE.BoxGeometry(NX - DECK_X + 4, 1.4, 22).translate(sx * (DECK_X + NX) / 2 - sx * 2, NY + 3.4, -14));
      pyl.push(new THREE.BoxGeometry(NX - DECK_X + 4, 1.4, 14).translate(sx * (DECK_X + NX) / 2 - sx * 2, NY + 3.4, 18));
    }
    // (fog-free: out past the deck edge the haze would swallow them; a faint blue self-glow holds the silhouette)
    const nacMat = new THREE.MeshStandardMaterial({ color: 0x343b4c, metalness: .85, roughness: .3, envMap, envMapIntensity: 1.3,
      emissive: 0x060c1c, fog: false });
    group.add(new THREE.Mesh(mergeGeometries(nac.map(g => g.index ? g.toNonIndexed() : g)), nacMat));
    group.add(new THREE.Mesh(mergeGeometries(pyl), nacMat));
    lathe.dispose();
    // coil rings: instanced, coloured every frame (a chase running aft + the beat + the music's energy)
    const RING_Z = []; for (let z = NZ0 + 12; z <= NZ0 + 66; z += 4.5) RING_Z.push(z);
    const ringMats = []; const ringZ = [];
    for (const sx of [-1, 1]) for (const z of RING_Z){ ringMats.push(trs(sx * NX, NY, z)); ringZ.push(z); }
    const rings = instanced(new THREE.TorusGeometry(6.15, .32, 8, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), ringMats);
    rings.setColorAt(0, new THREE.Color(0)); group.add(rings);
    // exhaust: a hot core disc + a soft halo at each nozzle, a volumetric plume streaming aft
    const NOZ = NZ1 + .2;
    const glowT = radialTex(128, [[0, 1], [.25, .6], [1, 0]]);
    const coreMat = new THREE.MeshBasicMaterial({ map: glowT, color: 0xffd2a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
    const haloMat = new THREE.MeshBasicMaterial({ map: glowT, color: 0xff7a3a, transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
    coreMat.userData.noFadeGate = haloMat.userData.noFadeGate = true;
    const discGeo = new THREE.PlaneGeometry(1, 1);
    const cores = instanced(discGeo, coreMat, [-1, 1].map(sx => trs(sx * NX, NY, NOZ, 0, 0, 0, 10, 10, 1)));
    const halos = instanced(discGeo, haloMat, [-1, 1].map(sx => trs(sx * NX, NY, NOZ + .3, 0, 0, 0, 30, 30, 1)));
    const plume = instanced(new THREE.CylinderGeometry(1.2, 4.6, 1, 28, 1, true).translate(0, -.5, 0).rotateX(-Math.PI / 2),
      beamMat({ color: 0xff8a4a, gain: .5, falloff: 1.4, edge: 1.2 }), [-1, 1].map(sx => trs(sx * NX, NY, NOZ, 0, 0, 0, 1, 1, 70)));
    // (rotateX(−π/2) maps the cylinder's −y run onto +z: the plume streams AFT from the nozzle)
    for (const m of [cores, halos, plume]){ m.frustumCulled = false; group.add(m); }
    // the plume shader's v runs 0 (far end) → 1 (source): CylinderGeometry's top (v=1) is the nozzle ✓

    /* ================= THE SKY (banks; a pure fn of songTime) ================= */
    // the sky dome: a camera-centred sphere drawn first, never writing depth (everything draws over it)
    const sky = skyTex();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(120, 64, 32),
      new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false }));
    dome.renderOrder = -10; dome.frustumCulled = false; group.add(dome);
    // the moving field rides a rig pivoting on the ship's roll axis
    const rig = new THREE.Group(); rig.position.copy(AXIS); group.add(rig);
    const quad = (n) => { const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(n, 3)); g.setIndex([0, 1, 2, 2, 1, 3]); return g; };
    const attrs = (g, list) => { for (const [k, arr, sz] of list) g.setAttribute(k, new THREE.InstancedBufferAttribute(new Float32Array(arr), sz)); };
    // star streaks: a cylindrical shell round the roll axis, clear of the deck, hull and nacelles
    const NS = 1500, sB = [], sN = [], sC = [], sS = [];
    for (let i = 0; i < NS; i++){
      const a = R() * Math.PI * 2, r = STREAK.r0 + Math.pow(R(), .8) * (STREAK.r1 - STREAK.r0);
      sB.push(Math.cos(a) * r, Math.sin(a) * r, R() * STREAK.L);
      const n = STREAK.n0 + (R() * (STREAK.n1 - STREAK.n0 + 1) | 0); sN.push(n);
      const b = (.45 + .55 * (n - STREAK.n0) / (STREAK.n1 - STREAK.n0)) * (.5 + R() * .7), warm = R() < .14;
      sC.push(b * (warm ? 1 : .7), b * (warm ? .8 : .85), b * (warm ? .6 : 1)); sS.push(.7 + R() * .9);
    }
    const sg = quad([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0]);
    attrs(sg, [['aBase', sB, 3], ['aN', sN, 1], ['aCol', sC, 3], ['aSize', sS, 1]]);
    sg.instanceCount = NS;
    const streaks = new THREE.Mesh(sg, streakMat()); streaks.frustumCulled = false; rig.add(streaks);
    // nebula banks: big soft billboards drifting slower than the stars (parallax against the fixed dome)
    const NN = 26, nB = [], nN = [], nC = [], nS = [], nR = [];
    const NCOL = [[.12, .34, .5], [.08, .2, .45], [.45, .2, .12], [.16, .4, .42], [.3, .14, .4]];
    for (let i = 0; i < NN; i++){
      const a = R() * Math.PI * 2, r = NEB.r0 + R() * (NEB.r1 - NEB.r0);
      nB.push(Math.cos(a) * r, Math.sin(a) * r * .8 + 10, (i + R() * .8) / NN * NEB.L);
      nN.push(1 + (R() < .35 ? 1 : 0));
      const c = NCOL[i % NCOL.length], k = .7 + R() * .6; nC.push(c[0] * k, c[1] * k, c[2] * k);
      nS.push(70 + R() * 90); nR.push(R() * 6.28);
    }
    const ng = quad([-.5, -.5, 0, -.5, .5, 0, .5, -.5, 0, .5, .5, 0]);
    attrs(ng, [['aBase', nB, 3], ['aN', nN, 1], ['aCol', nC, 3], ['aSize', nS, 1], ['aRot', nR, 1]]);
    ng.instanceCount = NN;
    const puff = puffTex();
    const nebula = new THREE.Mesh(ng, nebulaMat(puff)); nebula.frustumCulled = false; nebula.renderOrder = -2; rig.add(nebula);

    /* ================= per frame ================= */
    const su = streaks.material.uniforms, nu = nebula.material.uniforms;
    const _c = new THREE.Color(), _e = new THREE.Euler(0, 0, 0, 'ZYX');
    const RING_HOT = new THREE.Color(0xff6a1a), RING_COOL = new THREE.Color(0x1aa8ff), RUN = new THREE.Color(0x6fd8ff);
    const plumeBase = plume.material.uniforms.uGain.value;
    // HEADSET comfort (xr(on)): a rolling sky around a standing viewer is vection — the deck under
    // your feet never tilts (it's the instruments' frame), and in VR the sky banks half as far
    let bankK = 1;
    return {
      group, ...STAGE,
      fog: new THREE.FogExp2(FOG, .014), background: new THREE.Color(0x010208),
      mood: { ambient: [0x1c2a48, 1.35], hemi: [0x6f90e0, 0x141018, .6] },
      update(dt, songTime, camera, energy = 0, cues = null){
        const t = songTime, tc = skyClock(t);
        // SKY: bank (roll about the forward axis + a coordinated nose-yaw) — the deck never moves
        const bank = bankAt(t, cues) * bankK;
        _e.set(0, BANK.yaw * bank, bank);
        rig.quaternion.setFromEuler(_e);
        dome.quaternion.copy(rig.quaternion);
        dome.position.copy(camera.position);                       // at infinity: centred on the eye
        su.uT.value = tc; nu.uT.value = tc;
        su.uBlur.value = .1 * (1 + .9 * energy);                    // streaks lengthen on the big hits
        su.uGain.value = 1 + .5 * energy;
        // ENGINES: a beat thump + the music's energy + a coil chase running aft
        const thump = beatPulse(t, cues);
        const pow = .6 + .25 * thump + .7 * energy;
        for (let i = 0; i < ringZ.length; i++){
          const chase = .5 + .5 * Math.sin(ringZ[i] * .55 - tc * 2 * Math.PI * 1.5);   // 1.5 Hz: T_WRAP-periodic
          const heat = (ringZ[i] - NZ0) / 66;                      // cool at the intake → hot toward the nozzle
          _c.copy(RING_COOL).lerp(RING_HOT, heat * heat * heat).multiplyScalar(pow * (.15 + .85 * chase * chase) * .55);
          rings.setColorAt(i, _c);
        }
        rings.instanceColor.needsUpdate = true;
        coreMat.opacity = Math.min(1, .55 + .3 * thump + .4 * energy);
        haloMat.opacity = .28 + .16 * thump + .4 * energy;
        plume.material.uniforms.uGain.value = plumeBase * (.75 + .35 * thump + .9 * energy);
        // deck running lights: a pulse travels aft once per beat
        const lb = loopBeat(t, cues), b = lb === lb ? lb : t * 2;   // the loop's own beats (no cue: 120 bpm)
        const fb = b - Math.floor(b);
        for (let i = 0; i < runPts.length; i++){
          const zz = (runPts[i].z - DECK_Z0 + BOW) / (DECK_Z1 - DECK_Z0 + BOW);   // 0 bow → 1 stern
          const d = fb - zz, w = Math.exp(-d * d * 60);
          _c.copy(RUN).multiplyScalar(.25 + 1.6 * w * (.6 + .6 * energy));
          runLights.setColorAt(i, _c);
        }
        runLights.instanceColor.needsUpdate = true;
        deckMat.emissiveIntensity = .4 + .25 * energy;
        gunwaleMat.color.setHex(0x4fc8ff).multiplyScalar(1.2 + .25 * thump + .8 * energy);
        glass.uniforms.uGain.value = 1 + .4 * energy;
      },
      xr(on){ bankK = on ? .5 : 1; },
      dispose(){ sky.dispose(); tex.map.dispose(); tex.emi.dispose(); puff.dispose(); glowT.dispose(); },
    };
  },
};
