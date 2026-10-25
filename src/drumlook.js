import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HW, SPIRAL, shellPoint, shellRungs, deckOutline, cymbalProfile } from './drumparts.js';
export { cymbalProfile };

/* ============================================================
   DRUM LOOK — the materials + geometry builders for the drum
   machine's fresh coat (marbledrums.js wires them to the solve).
   Sparkle-lacquer shells, chrome hardware, coated heads, lathed
   bronze, the spiral staircase, the magnet arch. Every part that
   moves is returned as a handle; everything static is flagged
   `frozen` so the build merges it to one mesh per material.
   ============================================================ */

export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const fz = m => { m.userData.frozen = true; return m; };

/* a cylinder from a to b */
export function bar(a, b, r, mat, seg = 12){
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.position.copy(a).addScaledVector(d, .5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
  return m;
}
/* the same, as a bare geometry (for merging into a moving part) */
function barGeo(a, b, r, seg = 8){
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize()));
  return g.translate(a.x + d.x / 2, a.y + d.y / 2, a.z + d.z / 2);
}

/* ---- shared materials (constant count per build) ---- */
export function kitMaterials(envMap){
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdfe3ec, metalness: 1, roughness: .12, envMap, envMapIntensity: 1.5 });
  const dark   = new THREE.MeshStandardMaterial({ color: 0x1c1f29, metalness: .75, roughness: .4, envMap });
  const iron   = new THREE.MeshStandardMaterial({ color: 0x14161d, metalness: .8, roughness: .32, envMap });
  const copper = new THREE.MeshStandardMaterial({ color: 0xc8703a, metalness: 1, roughness: .28, envMap, envMapIntensity: 1.2 });
  const trim   = new THREE.MeshStandardMaterial({ color: 0x2a1206, emissive: new THREE.Color(0xff7a2e), emissiveIntensity: 1.1 });
  const reso   = new THREE.MeshStandardMaterial({ color: 0x2b2a2e, metalness: .1, roughness: .7, side: THREE.DoubleSide });
  const felt   = new THREE.MeshStandardMaterial({ color: 0x5a1020, roughness: .95 });
  const glass  = new THREE.MeshStandardMaterial({ color: 0x2a3348, metalness: .9, roughness: .12, envMap, envMapIntensity: 1.1,
    transparent: true, opacity: .16, side: THREE.DoubleSide, depthWrite: false });
  return { chrome, dark, iron, copper, trim, reso, felt, glass };
}

/* ---- SPARKLE LACQUER: a metal-flake finish under a glass clearcoat. Each flake is a
   cell of object space with its own random tilt (the shading normal is perturbed per
   cell, so each flake catches the light on its own) and a chance of the flake tint;
   the clearcoat keeps the geometric normal — a smooth glossy skin over glitter, which
   is exactly what a sparkle-finish drum is. Strike lights make it twinkle. ---- */
export function lacquer(st, envMap){
  const mat = new THREE.MeshPhysicalMaterial({ color: st.shell, metalness: .35, roughness: .34, envMap, envMapIntensity: 1.25,
    clearcoat: 1, clearcoatRoughness: .05 });
  const u = { uFlake: { value: new THREE.Color(st.flake) } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vFlk;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvFlk = position;');
    sh.fragmentShader = 'uniform vec3 uFlake;\nvarying vec3 vFlk;\n' +
      `vec3 flkHash(vec3 c){ return fract(sin(vec3(dot(c, vec3(127.1, 311.7, 74.7)), dot(c, vec3(269.5, 183.3, 246.1)),
                                                dot(c, vec3(113.5, 271.9, 124.6)))) * 43758.5453); }\n` +
      sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 flkC = vFlk * 80.0, flkR = flkHash(floor(flkC));
          float flkM = 1.0 - smoothstep(.22, .34, length(fract(flkC) - .2 - .6 * flkR.zxy));   // a round flake per cell
          // under ~a pixel a flake can't be resolved: fade each flake into the finish's AVERAGE
          // colour (no speckle, no shimmer as the camera moves) — flakes resolve as you get close
          float flkPx = 1.0 - smoothstep(.35, .9, length(fwidth(flkC)));
          vec3 flkAvg = mix(diffuseColor.rgb, mix(diffuseColor.rgb * 1.6, uFlake, .45), .16);
          diffuseColor.rgb = mix(flkAvg, mix(diffuseColor.rgb, mix(diffuseColor.rgb * 1.6, uFlake, step(.55, flkR.x)), flkM * .8), flkPx);
          flkM *= flkPx;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          normal = normalize(normal + (flkR * 2.0 - 1.0) * .75 * flkM);`);
  };
  return mat;
}

/* ---- a COATED HEAD: the drumhead membrane (a finely-ringed disc whose vertex shader
   displaces a circular wave from the contact point, fixed at the hoop, decaying — and
   the same wave lights the emissive, so a strike sends a ring of light across the head).
   Translucent off-white coating with the dark reinforcement dot at the centre: the
   ball's target. Driven by uAge (time since the strike — a pure fn of songTime) and uAmp. */
export function buildMembrane(st, envMap){
  const R = st.r * .99;
  const geo = new THREE.RingGeometry(0, R, 72, 28);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xf1ebdf, metalness: 0, roughness: .62, envMap, envMapIntensity: .6,
    emissive: new THREE.Color(st.glow), emissiveIntensity: .04, side: THREE.DoubleSide, transparent: true, opacity: .93 });
  const uniforms = { uAge: { value: 99 }, uAmp: { value: 0 }, uR: { value: R } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'uniform float uAge, uAmp, uR;\nvarying float vWave, vRr;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float rr = length(position.xz);
      float front = 3.0 * uAge;
      float lead = 1.0 - smoothstep(front - .2, front, rr);
      float edge = 1.0 - (rr * rr) / (uR * uR);
      float w = uAmp * exp(-uAge * 4.0) * sin(20.0 * (rr - front)) * lead * edge;
      transformed.y += w;
      vWave = abs(w) / max(uAmp, 1e-4);
      vRr = rr / uR;`);
    sh.fragmentShader = 'varying float vWave, vRr;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float dot0 = 1.0 - smoothstep(.15, .17, vRr);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.05), dot0 * .85);
        diffuseColor.a = mix(diffuseColor.a, 1.0, dot0);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance *= (1.0 + vWave * 4.0) * (1.0 - dot0 * .6);`);
  };
  return { mesh: new THREE.Mesh(geo, mat), uniforms };
}

/* ---- a DRUM: membrane on top (its top at local y = 0, the contact point), a sparkle
   shell, a dark resonant head underneath, chrome hoops, lugs + tension rods, and the
   basket the piston rod grips. Returns the moving group + handles. ---- */
export const BASKET = HW.BASKET;                         // basket hub below the bottom head
export function buildDrum(st, envMap, mats){
  const group = new THREE.Group(), r = st.r, D = st.depth;
  const { mesh: face, uniforms } = buildMembrane(st, envMap);
  const shellMat = lacquer(st, envMap);
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r * .985, r * .985, D - .03, 64, 1, true), shellMat);
  shell.position.y = -D / 2;
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(r * .975, r * .975, D - .03, 48, 1, true), mats.reso);
  inner.position.y = -D / 2;                             // the raw interior (seen through the coated head)
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(r * .97, 48), mats.reso);
  bottom.rotation.x = Math.PI / 2; bottom.position.y = -D + .01;
  // the chrome hardware, one merged mesh: hoops, lugs, tension rods, claws, basket
  const hw = [];
  const hoop = (y, rad) => hw.push(new THREE.TorusGeometry(rad, .042, 10, 64).rotateX(Math.PI / 2).translate(0, y, 0));
  hoop(.014, r * 1.005); hoop(-D, r * 1.005);
  const nLug = Math.max(6, Math.round(r * 9 / 2) * 2);
  const lugL = Math.min(.26, D * .34);
  for (let k = 0; k < nLug; k++){
    const a = (k + .5) / nLug * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const lr = r + .045;
    hw.push(new THREE.CapsuleGeometry(.04, lugL, 4, 8).translate(lr * c, -D / 2, lr * s));
    const rr = r + .06;
    hw.push(barGeo(V(rr * c, .02, rr * s), V(rr * c, -D / 2 + lugL / 2 + .02, rr * s), .014, 6));   // top tension rod
    hw.push(barGeo(V(rr * c, -D - .02, rr * s), V(rr * c, -D / 2 - lugL / 2 - .02, rr * s), .014, 6));   // bottom
    hw.push(new THREE.BoxGeometry(.05, .06, .05).translate(rr * c, .0, rr * s));                     // claws on the hoops
    hw.push(new THREE.BoxGeometry(.05, .06, .05).translate(rr * c, -D, rr * s));
  }
  if (st.chrome){                                        // the kick: twin chrome bands — it's the anchor
    for (const y of [-D * .2, -D * .8]) hw.push(new THREE.TorusGeometry(r * .99, .02, 6, 64).rotateX(Math.PI / 2).translate(0, y, 0));
  }
  const hub = -D - BASKET;
  hw.push(new THREE.SphereGeometry(.07, 14, 10).translate(0, hub, 0));
  for (const a of [0, 2.094, 4.189])                     // three basket arms gripping the bottom hoop
    hw.push(barGeo(V(0, hub, 0), V(.88 * r * Math.cos(a), -D - .01, .88 * r * Math.sin(a)), .024, 6));
  const hardware = new THREE.Mesh(mergeGeometries(hw), mats.chrome);
  hw.forEach(g => g.dispose());
  group.add(face, shell, inner, bottom, hardware);
  return { group, face, membrane: uniforms, depth: D, under: D + BASKET, shellMat };
}

/* ---- SNARE WIRES: two banks of steel wires stretched across the bottom head (the rod's
   path stays clear between them), with end plates + a strainer on the shell. Each wire
   is a thin tube with its own phase; the vertex shader bows it in its first mode by
   uBuzz (solve: drumparts.wireBuzz) at a buzz frequency — a rattle you can see. ---- */
export function buildWires(st, mats, glow){
  const r = st.r, D = st.depth, y = -D - .028, half = .62 * r, geos = [];
  const zs = [];
  for (let k = 0; k < 8; k++){ const z = .14 * r + k * (.5 - .14) * r / 7; zs.push(z, -z); }
  zs.forEach((z, k) => {
    const g = new THREE.CylinderGeometry(.0075, .0075, 2 * half, 4, 14, true).rotateZ(Math.PI / 2).translate(0, y, z);
    const n = g.attributes.position.count, U = new Float32Array(n), Ph = new Float32Array(n);
    for (let i = 0; i < n; i++){ U[i] = (g.attributes.position.getX(i) + half) / (2 * half); Ph[i] = (k * .618) % 1; }
    g.setAttribute('aU', new THREE.BufferAttribute(U, 1)); g.setAttribute('aPh', new THREE.BufferAttribute(Ph, 1));
    geos.push(g);
  });
  const geo = mergeGeometries(geos); geos.forEach(g => g.dispose());
  const mat = new THREE.MeshStandardMaterial({ color: 0xc8ccd6, metalness: 1, roughness: .2, envMap: mats.chrome.envMap, envMapIntensity: 1.4,
    emissive: new THREE.Color(glow), emissiveIntensity: .05 });
  const u = { uBuzz: { value: 0 }, uT: { value: 0 } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'uniform float uBuzz, uT;\nattribute float aU, aPh;\nvarying float vBz;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
      float bz = uBuzz * sin(6.28318 * (uT * (31.0 + 9.0 * aPh) + aPh)) * sin(3.14159 * aU);
      transformed.y += .085 * bz;
      vBz = abs(bz);`);
    sh.fragmentShader = 'varying float vBz;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance *= 1.0 + vBz * 2.5;            // a glint as the wire flexes — steel doesn't glow`);
  };
  const wires = new THREE.Mesh(geo, mat);
  // end plates + the strainer (chrome, merged): what the wires are stretched between
  const hw = [];
  for (const sx of [-1, 1]){
    hw.push(new THREE.BoxGeometry(.03, .025, 1.05 * r).translate(sx * half, y, 0));
    hw.push(barGeo(V(sx * half, y, 0), V(sx * r * 1.0, -D + .02, 0), .012, 5));    // cords to the hoop
  }
  hw.push(new THREE.BoxGeometry(.09, .16, .07).translate(r + .08, -D * .55, 0));    // strainer + throw-off
  hw.push(new THREE.BoxGeometry(.03, .14, .02).rotateZ(.5).translate(r + .15, -D * .45, 0));
  const plates = new THREE.Mesh(mergeGeometries(hw), mats.chrome); hw.forEach(g => g.dispose());
  return { wires, plates, u };
}

/* ---- LATHED BRONZE: a cymbal turned on a lathe — bell dome, bow, thinning edge — in
   a bronze that reads as metal on a lathe: the grooves run ROUND, so the anisotropic
   highlight stretches ACROSS them — the classic radial spoke of light from bell to edge
   (LatheGeometry's tangent runs round the cymbal → rotate the anisotropy a quarter
   turn), swept round the cymbal as it wobbles; fine lathe grooves that break the
   reflection into rings, a polished bell. Top of the bell at local y = 0. ---- */
// (cymbalProfile — the pure lathe profile — lives in drumparts.js now: the cymbal solve needs it)
/* `inverted` (the china): the same lathe flipped top-for-bottom — a bowl, bell down, edge up —
   with its upturned FLANGE (the last 14 % of the radius kicks up harder: the china's lip) */
export function cymbalGeometry(R, inverted = false){
  if (inverted){
    const P = cymbalProfile(R), pts = [], N = 44, f0 = .86 * R;
    const flange = rr => rr > f0 ? .45 * (rr - f0) ** 1.2 / (R - f0) ** .2 : 0;
    const rAt = k => { const u = k / N; return R * (u < .35 ? u * u / .35 * .6 : .21 + (u - .35) / .65 * .79); };
    // flipped: top surface y = th − top (+ flange), underside y = −top (+ flange); bell pit at y = 0
    pts.push(new THREE.Vector2(0.0001, P.th(0)));
    for (let k = 1; k <= N; k++){ const rr = Math.min(R, Math.max(.0002, rAt(k))); pts.push(new THREE.Vector2(rr, P.th(rr) - P.top(rr) + flange(rr))); }
    pts.push(new THREE.Vector2(R + .006, P.th(R) / 2 - P.top(R) + flange(R)));
    for (let k = N; k >= 1; k--){ const rr = Math.min(R, Math.max(.0002, rAt(k))); pts.push(new THREE.Vector2(rr, -P.top(rr) + flange(rr))); }
    pts.push(new THREE.Vector2(0.0001, 0));
    const g = new THREE.LatheGeometry(pts, 96);
    g.computeTangents();
    return g;
  }
  const P = cymbalProfile(R), pts = [], N = 44;
  const rAt = k => { const u = k / N; return R * (u < .35 ? u * u / .35 * .6 : .21 + (u - .35) / .65 * .79); };   // dense through the bell
  pts.push(new THREE.Vector2(0.0001, 0));
  for (let k = 1; k <= N; k++){ const rr = Math.min(R, Math.max(.0002, rAt(k))); pts.push(new THREE.Vector2(rr, P.top(rr))); }
  pts.push(new THREE.Vector2(R + .006, P.top(R) - P.th(R) / 2));
  for (let k = N; k >= 1; k--){ const rr = Math.min(R, Math.max(.0002, rAt(k))); pts.push(new THREE.Vector2(rr, P.top(rr) - P.th(rr))); }
  pts.push(new THREE.Vector2(0.0001, -P.th(0)));
  const g = new THREE.LatheGeometry(pts, 96);
  g.computeTangents();
  return g;
}
export function bronze(st, envMap){
  const mat = new THREE.MeshPhysicalMaterial({ color: st.bronze, metalness: 1, roughness: .26, envMap, envMapIntensity: 1.6,
    anisotropy: .8, anisotropyRotation: Math.PI / 2, emissive: new THREE.Color(st.glow), emissiveIntensity: .05, side: THREE.DoubleSide });
  const u = { uRb: { value: .21 * st.r } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying float vLR;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvLR = length(position.xz);');
    sh.fragmentShader = 'uniform float uRb;\nvarying float vLR;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float tone = .5 + .5 * sin(vLR * 47.0);
        diffuseColor.rgb *= .84 + .2 * tone;                    // tonal grooves: the hammered/lathed bands
        float bellZ = 1.0 - smoothstep(uRb * .9, uRb * 1.05, vLR);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.05, .9), bellZ);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float groove = sin(vLR * 340.0);
        roughnessFactor = clamp(roughnessFactor + .1 * groove - .14 * bellZ, .06, 1.0);`);
  };
  return mat;
}

/* ---- an ELECTROMAGNET: chrome pot, copper windings, dark face, and the coil ring at
   the face that lights when it holds. Hung so its face is exactly where the ball's TOP
   is at the max apex. `topY` = where its hanger rod starts. Local to the kit frame. ---- */
export function buildMagnet(c, H, st, mats, glowTex){
  const group = new THREE.Group();
  const faceY = c.y + H + st.ball * 2;
  const mr = Math.max(.2, st.ball * 1.6);
  const body = fz(new THREE.Mesh(new THREE.CylinderGeometry(mr * .92, mr, .52, 28), mats.chrome));
  body.position.set(c.x, faceY + .26, c.z);
  const face = fz(new THREE.Mesh(new THREE.CylinderGeometry(mr * 1.04, mr * 1.04, .06, 28), mats.iron));
  face.position.set(c.x, faceY + .03, c.z);
  const cap = fz(new THREE.Mesh(new THREE.CylinderGeometry(mr * .55, mr * .95, .14, 24), mats.iron));
  cap.position.set(c.x, faceY + .59, c.z);
  group.add(body, face, cap);
  for (let k = 0; k < 3; k++){                           // copper windings round the pot
    const w = fz(new THREE.Mesh(new THREE.TorusGeometry(mr * .98, .035, 8, 32), mats.copper));
    w.rotation.x = Math.PI / 2; w.position.set(c.x, faceY + .14 + k * .11, c.z); group.add(w);
  }
  const coil = new THREE.Mesh(new THREE.TorusGeometry(mr * .78, .045, 10, 32),
    new THREE.MeshStandardMaterial({ color: 0x331a10, emissive: new THREE.Color(0xff5a1e), emissiveIntensity: .15 }));
  coil.rotation.x = Math.PI / 2; coil.position.set(c.x, faceY - .002, c.z); fz(coil);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff7a3a, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(mr * 4); halo.position.set(c.x, faceY, c.z);
  group.add(coil, halo);
  return { group, coil, halo, haloS: mr * 4, topY: faceY + .66, x: c.x, z: c.z };
}

/* ---- the MAGNET SHELL — a BANDSHELL that opens toward the audience (drumparts
   kitFrame): ribs FAN out from one pair of sculpted footings on the back line — the
   vertical back rib, then two leaning forward over the kit — each with a glowing trim
   line; a smoked-glass canopy between them; a curved RUNG follows the shell out over
   every magnet (a finger off the scallop), the magnet hanging from it on a vertical
   rod. Nothing stands in front of the kit. Static → frozen. ---- */
export function buildArch(F, mats){
  const group = new THREE.Group();
  const add = m => (group.add(fz(m)), m);
  const xs = n => Array.from({ length: n + 1 }, (_, k) => {   // dense near the feet
    const s = -1 + 2 * k / n; return F.xc + F.X0 * Math.sign(s) * Math.pow(Math.abs(s), .55); });
  const ribCurve = (th, off = 0) => {
    const e = new THREE.Vector3(0, Math.cos(th), Math.sin(th));   // the rib plane's "up"
    return new THREE.CatmullRomCurve3(xs(90).map(x => {
      const h = 1e-3, d = (F.rho(Math.min(F.xc + F.X0, x + h)) - F.rho(Math.max(F.xc - F.X0, x - h))) / (2 * h);
      const n = new THREE.Vector2(-d, 1).normalize();         // in-plane outward normal
      const rr = F.rho(x) + n.y * off;
      return V(x + n.x * off, 0, F.zA).addScaledVector(e, rr);
    }));
  };
  F.tilts.forEach((th, k) => {
    const main = k !== 1;
    add(new THREE.Mesh(new THREE.TubeGeometry(ribCurve(th), 200, main ? .12 : .08, 12), mats.chrome));
    add(new THREE.Mesh(new THREE.TubeGeometry(ribCurve(th, main ? .19 : .14), 200, .028, 6), mats.trim));
  });
  // the smoked-glass canopy between the back rib and the front one
  const canopy = new THREE.BufferGeometry(), NX = 64, NT = 8, pos = [], idx = [];
  const cx = xs(NX), thF = F.tilts.at(-1);
  for (let i = 0; i <= NX; i++) for (let j = 0; j <= NT; j++){
    const p = shellPoint(F, cx[i], thF * j / NT); pos.push(p.x, p.y + .02, p.z);
  }
  for (let i = 0; i < NX; i++) for (let j = 0; j < NT; j++){
    const a = i * (NT + 1) + j, b = a + NT + 1; idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  canopy.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); canopy.setIndex(idx); canopy.computeVertexNormals();
  add(new THREE.Mesh(canopy, mats.glass));
  // the footings: every rib springs from the same sculpted plinth (the fan's pivot)
  for (const sx of [-1, 1]){
    const x = F.xc + sx * F.X0;
    add(new THREE.Mesh(new THREE.CylinderGeometry(.3, .44, .36, 28), mats.iron)).position.set(x, .18, F.zA);
    add(new THREE.Mesh(new THREE.SphereGeometry(.24, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.chrome)).position.set(x, .36, F.zA);
    const r = add(new THREE.Mesh(new THREE.TorusGeometry(.4, .025, 6, 32), mats.trim)); r.rotation.x = Math.PI / 2; r.position.set(x, .33, F.zA);
  }
  // the RUNGS: curved arms along the shell, back rib → just past the farthest magnet
  for (const r of shellRungs(F)){
    const pts = [];
    for (let k = 0; k <= 24; k++){ const p = shellPoint(F, r.x, r.th1 * k / 24); pts.push(V(p.x, p.y - .12, p.z)); }
    add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, .06, 10), mats.dark));
    add(new THREE.Mesh(new THREE.SphereGeometry(.1, 14, 10), mats.chrome)).position.copy(pts.at(-1));
    for (const h of r.hang){
      const y = h.y - .12;
      add(bar(V(h.m.x, h.m.top, h.m.z), V(r.x, y, h.m.z), .028, mats.chrome, 8));   // hanger rod
      const clamp = add(new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .18, 12), mats.iron));
      clamp.rotation.z = Math.PI / 2; clamp.position.set(r.x, y, h.m.z);
    }
  }
  return group;
}

/* ---- the RISER DECK: an angular faceted slab sized to the kit (drumparts deckOutline),
   with a glowing lip, and a sound-grille of concentric grooves round the kick. The KICK
   SHOCKWAVE lives here: up to 3 rings (drumparts shockRing) race across the top face
   from the kick — light through the grooves. Its top face is the kit's deck (y 0); its UNDERSIDE,
   DECK_UNDER, is what the whole kit stands on (rooms/footing.js: the floor's plinth, or a lift). ---- */
const DECK_D = .26, DECK_BEVEL = .04;                    // the slab: its body, a bevel top and bottom
export const DECK_UNDER = -(DECK_D + 2 * DECK_BEVEL);
export function buildDeck(mats, kick, F){
  const outline = deckOutline(F);
  const sh = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(sh, { depth: DECK_D, bevelEnabled: true, bevelThickness: DECK_BEVEL, bevelSize: .06, bevelSegments: 2 });
  geo.rotateX(-Math.PI / 2).translate(0, -(DECK_D + DECK_BEVEL), 0);   // top face at y 0
  const mat = new THREE.MeshStandardMaterial({ color: 0x15171f, metalness: .55, roughness: .38, envMap: mats.chrome.envMap,
    emissive: new THREE.Color(0xff7a2e), emissiveIntensity: 1 });
  const u = { uK: { value: new THREE.Vector2(kick?.x ?? 0, kick?.z ?? 0) }, uOn: { value: kick ? 1 : 0 },
              uAge: { value: new THREE.Vector3(99, 99, 99) }, uAmp: { value: new THREE.Vector3() }, uR: { value: new THREE.Vector3() } };
  mat.onBeforeCompile = s => {
    Object.assign(s.uniforms, u);
    s.vertexShader = 'varying vec3 vDk; varying float vUp;\n' + s.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvDk = position; vUp = normal.y;');
    s.fragmentShader = 'uniform vec2 uK; uniform float uOn; uniform vec3 uAge, uAmp, uR;\nvarying vec3 vDk; varying float vUp;\n' +
      s.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float dk = length(vDk.xz - uK);
      float up = step(.5, vUp);
      float grille = up * uOn * smoothstep(.0, .2, dk - 1.45) * pow(.5 + .5 * cos(dk * 18.0), 6.0) * exp(-dk * .22);
      float ring = 0.0;
      for (int i = 0; i < 3; i++){
        float w = .22 + .12 * uAge[i];
        ring += uAmp[i] * exp(-pow((dk - uR[i]) / w, 2.0));
      }
      float lip = 1.0 - up;                                   // the slab's edges glow faintly as the deck's lip
      totalEmissiveRadiance *= lip * .04 + up * uOn * (grille * .05 + ring * (.3 + 1.8 * grille));`);
  };
  const deck = fz(new THREE.Mesh(geo, mat));
  // the lip: a glowing strip round the top edge
  const pts = outline.map(([x, z]) => V(x, .03, z)); pts.push(pts[0].clone());
  const lip = fz(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0), 240, .03, 6), mats.trim));
  return { deck, lip, u };
}

/* ---- the SPIRAL STAIRCASE the toms climb (drumparts stairTreads): a slim chrome
   newel post; thick walnut wedge treads with a glowing nosing in each tom's colour (it
   FLASHES on the tom's strike — a fill is a run of light down the stair); dark risers
   closing each step; balusters + a chrome handrail. The floor tom stands at the foot,
   on the deck. Pitch = height: a fill is a visible descent. ---- */
export function buildStair(treads, seats, mats){
  const group = new THREE.Group(), add = m => (group.add(fz(m)), m);
  if (!seats.length) return { group };
  const { C, R, post } = SPIRAL;
  const wood = new THREE.MeshPhysicalMaterial({ color: 0x7a4a2a, roughness: .4, metalness: 0, clearcoat: .7, clearcoatRoughness: .2,
    envMap: mats.chrome.envMap, envMapIntensity: .7 });
  const rail = R + .55;                                   // balusters stand between the toms' hoops and the nosing
  const top = Math.max(.6, ...treads.map(t => t.y)) + 1.25;
  add(new THREE.Mesh(new THREE.CylinderGeometry(post, post * 1.2, top, 20), mats.chrome)).position.set(C.x, top / 2, C.z);
  add(new THREE.Mesh(new THREE.SphereGeometry(post * 1.7, 18, 12), mats.chrome)).position.set(C.x, top + .08, C.z);
  add(new THREE.Mesh(new THREE.CylinderGeometry(.3, .38, .1, 24), mats.iron)).position.set(C.x, .05, C.z);
  const railPts = [];
  for (const t of treads){
    const s = seats.find(q => q.lane === t.key);
    add(new THREE.Mesh(new THREE.CylinderGeometry(t.rOut, t.rOut, t.th, 40, 1, false, t.a0, t.a1 - t.a0), wood)).position.set(C.x, t.y - t.th / 2, C.z);
    // the nosing: a glowing strip round the tread's outer edge, the tom's colour
    add(new THREE.Mesh(new THREE.CylinderGeometry(t.rOut + .012, t.rOut + .012, .05, 40, 1, true, t.a0, t.a1 - t.a0), s.trimMat)).position.set(C.x, t.y - .03, C.z);
    // the riser: closing the climb from the step below, along the tread's leading edge
    const hR = t.y - t.th - t.below;
    if (hR > .02){
      const len = t.rOut - t.rIn, a = t.a0, mid = t.rIn + len / 2;
      const rs = add(new THREE.Mesh(new THREE.BoxGeometry(.05, hR, len), mats.iron));
      rs.rotation.y = a; rs.position.set(C.x + mid * Math.sin(a), t.below + hR / 2, C.z + mid * Math.cos(a));
    }
    const bx = C.x + rail * Math.sin(s.phi), bz = C.z + rail * Math.cos(s.phi);
    const ang = Math.asin(Math.min(1, (s.r + .14) / R));   // put the baluster off the tom's hoop
    const ph = s.phi + ang, ux = C.x + (t.rOut - .15) * Math.sin(ph), uz = C.z + (t.rOut - .15) * Math.cos(ph);
    add(bar(V(ux, t.y, uz), V(ux, t.y + 1.05, uz), .028, mats.chrome, 8));
    railPts.push({ ph, y: t.y + 1.05 });
  }
  // the HANDRAIL: one chrome helix through the baluster tops
  if (railPts.length > 1){
    const pts = [], n = 24 * railPts.length, r0 = treads[0].rOut - .15;
    const ph0 = railPts[0].ph - .3, ph1 = railPts.at(-1).ph;   // ends at the top baluster (never past the back line)
    const yAt = ph => {
      let k = 0; while (k < railPts.length - 2 && ph > railPts[k + 1].ph) k++;
      const A = railPts[k], B = railPts[k + 1];
      return A.y + (B.y - A.y) * (ph - A.ph) / (B.ph - A.ph);
    };
    for (let k = 0; k <= n; k++){ const ph = ph0 + (ph1 - ph0) * k / n; const rr = r0 + (treads.at(-1).rOut - treads[0].rOut) * k / n;
      pts.push(V(C.x + rr * Math.sin(ph), yAt(ph), C.z + rr * Math.cos(ph))); }
    add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, .045, 8), mats.chrome));
  }
  return { group };
}

/* ---- a COIL SPRING that is rebuilt (not scaled) every frame: the vertex shader lays
   the wire along the helix for the CURRENT length uLen, with a true Frenet frame, so the
   coils keep a round wire as they stretch and close up. Grows +y from its origin. ---- */
export function coilSpring(turns, R, wire, chrome){
  const NS = Math.round(turns * 28), NP = 6, sp = [], idx = [];
  for (let i = 0; i <= NS; i++) for (let j = 0; j <= NP; j++) sp.push(i / NS, j / NP * Math.PI * 2);
  for (let i = 0; i < NS; i++) for (let j = 0; j < NP; j++){
    const a = i * (NP + 1) + j, b = a + NP + 1; idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(sp.length / 2 * 3), 3));
  geo.setAttribute('aSP', new THREE.Float32BufferAttribute(sp, 2));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(V(0, .6, 0), 1.2);
  const mat = chrome.clone(), u = { uLen: { value: .5 } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = `uniform float uLen;\nattribute vec2 aSP;\n` + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `
        float cW = 6.28318 * ${turns.toFixed(1)}, cA = cW * aSP.x;
        vec3 cT = normalize(vec3(-${R.toFixed(3)} * cW * sin(cA), uLen, ${R.toFixed(3)} * cW * cos(cA)));
        vec3 cN = vec3(-cos(cA), 0.0, -sin(cA));
        vec3 cB = normalize(cross(cT, cN)); cN = cross(cB, cT);
        vec3 objectNormal = cos(aSP.y) * cN + sin(aSP.y) * cB;`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(${R.toFixed(3)} * cos(cA), uLen * aSP.x, ${R.toFixed(3)} * sin(cA)) + ${wire.toFixed(3)} * objectNormal;`);
  };
  mat.customProgramCacheKey = () => 'coil' + turns + R + wire;
  return { mesh: new THREE.Mesh(geo, mat), u };
}

/* ---- static structure → ONE mesh per material (bells' freeze). Bakes each frozen
   mesh's transform relative to the group. ---- */
export function freeze(group){
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert(), byMat = new Map(), dead = [];
  group.traverse(o => {
    if (!o.isMesh || !o.userData.frozen) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    (byMat.get(o.material) || byMat.set(o.material, []).get(o.material)).push(g);
    dead.push(o);
  });
  for (const o of dead){ o.parent.remove(o); o.geometry.dispose(); }
  for (const [mat, geos] of byMat){
    const merged = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (merged) group.add(new THREE.Mesh(merged, mat));
  }
}
