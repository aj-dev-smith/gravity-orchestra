import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARCH, rib, rungY, zBack } from './drumparts.js';

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
  return { chrome, dark, iron, copper, trim, reso, felt };
}

/* ---- SPARKLE LACQUER: a metal-flake finish under a glass clearcoat. Each flake is a
   cell of object space with its own random tilt (the shading normal is perturbed per
   cell, so each flake catches the light on its own) and a chance of the flake tint;
   the clearcoat keeps the geometric normal — a smooth glossy skin over glitter, which
   is exactly what a sparkle-finish drum is. Strike lights make it twinkle. ---- */
export function lacquer(st, envMap){
  const mat = new THREE.MeshPhysicalMaterial({ color: st.shell, metalness: .6, roughness: .34, envMap, envMapIntensity: 1.25,
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
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * 1.6, uFlake, step(.55, flkR.x)), flkM * .8);`)
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
    emissive: new THREE.Color(st.glow), emissiveIntensity: .12, side: THREE.DoubleSide, transparent: true, opacity: .93 });
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
export const BASKET = .2;                                // basket hub below the bottom head
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
  const mat = new THREE.MeshStandardMaterial({ color: 0xc8ccd6, metalness: 1, roughness: .25, emissive: new THREE.Color(glow), emissiveIntensity: .05 });
  const u = { uBuzz: { value: 0 }, uT: { value: 0 } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'uniform float uBuzz, uT;\nattribute float aU, aPh;\nvarying float vBz;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
      float bz = uBuzz * sin(6.28318 * (uT * (31.0 + 9.0 * aPh) + aPh)) * sin(3.14159 * aU);
      transformed.y += .045 * bz;
      vBz = abs(bz);`);
    sh.fragmentShader = 'varying float vBz;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance *= 1.0 + vBz * 60.0;`);
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
   a bronze that reads as metal on a lathe: anisotropic highlights wrapped round the
   circumference (tangents follow the lathe), fine lathe grooves that break the
   reflection into rings, a polished bell. Top of the bell at local y = 0. ---- */
export function cymbalProfile(R){
  const rb = .21 * R, bellH = .085 * R + .015, bow = .1 * R;
  const top = rr => rr <= rb ? -bellH * (1 - Math.sqrt(Math.max(0, 1 - (rr / rb) ** 2)))
                             : -bellH - bow * ((rr - rb) / (R - rb) * .75 + .25 * ((rr - rb) / (R - rb)) ** 2);
  const th = rr => .03 - .018 * Math.max(0, (rr - rb) / (R - rb));
  return { rb, bellH, bow, top, th, under: bellH + .03 };
}
export function cymbalGeometry(R){
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
  const mat = new THREE.MeshPhysicalMaterial({ color: st.bronze, metalness: 1, roughness: .3, envMap, envMapIntensity: 1.6,
    anisotropy: .75, emissive: new THREE.Color(st.glow), emissiveIntensity: .05, side: THREE.DoubleSide });
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

/* ---- the MAGNET ARCH — a BANDSHELL: three superellipse ribs rising front → back,
   springing from footings on the deck, each with a glowing trim line; a sloping rung
   across them over every magnet; keystones + a crown spine. Static → frozen. ---- */
export function buildArch(mags, mats){
  const group = new THREE.Group();
  const add = m => (group.add(fz(m)), m);
  const ribCurve = (R, off = 0) => {                     // the rib in its own plane, `off` = outward offset
    const pts = [];
    for (let k = 0; k <= 80; k++){
      const s = -1 + 2 * k / 80, x = ARCH.X0 * Math.sign(s) * Math.pow(Math.abs(s), .6);   // dense near the feet
      const e = 1e-3, dy = R.y(Math.min(ARCH.X0, x + e)) - R.y(Math.max(-ARCH.X0, x - e));
      const n = new THREE.Vector2(-dy, 2 * e).normalize();   // outward normal: tangent (2e, dy) turned left
      pts.push(V(x + n.x * off, R.y(x) + n.y * off, R.z(x + n.x * off)));
    }
    return new THREE.CatmullRomCurve3(pts);
  };
  const ribs = Array.from({ length: ARCH.ribs }, (_, k) => rib(k));
  ribs.forEach((R, k) => {
    const main = k === 0 || k === ribs.length - 1;
    add(new THREE.Mesh(new THREE.TubeGeometry(ribCurve(R), 180, main ? .13 : .085, 12), mats.chrome));
    add(new THREE.Mesh(new THREE.TubeGeometry(ribCurve(R, main ? .19 : .14), 180, .03, 6), mats.trim));
    for (const sx of [-1, 1]){                           // footings
      const x = sx * ARCH.X0, z = R.z(x);
      add(new THREE.Mesh(new THREE.CylinderGeometry(.3, .4, .3, 24), mats.iron)).position.set(x, .15, z);
      const r = add(new THREE.Mesh(new THREE.TorusGeometry(.36, .025, 6, 32), mats.trim)); r.rotation.x = Math.PI / 2; r.position.set(x, .29, z);
    }
    const kst = add(new THREE.Mesh(new THREE.BoxGeometry(.5, .42, .34), mats.iron)); kst.position.set(0, R.y(0), R.z(0));
  });
  // the crown spine, front keystone → back keystone
  const R0 = ribs[0], R1 = ribs.at(-1);
  add(bar(V(0, R0.y(0), R0.z(0)), V(0, R1.y(0), R1.z(0)), .08, mats.chrome));
  add(new THREE.Mesh(new THREE.SphereGeometry(.26, 24, 16), mats.chrome)).position.set(0, R1.y(0) + .38, R1.z(0));
  // rungs: one per magnet (merged with any within .35 in x), sloping with the shell,
  // cantilevered past the back rib if a magnet sits behind it
  const rungs = [];
  for (const m of [...mags].sort((a, b) => a.x - b.x)){
    const last = rungs.at(-1);
    if (last && m.x - last.x0 < .35){ last.ms.push(m); last.x = (last.x0 + m.x) / 2; }
    else rungs.push({ x0: m.x, x: m.x, ms: [m] });
  }
  for (const r of rungs){
    const zb = Math.min(zBack(r.x), ...r.ms.map(m => m.z - .35)), zf = ARCH.front.z;
    add(bar(V(r.x, rungY(r.x, zb), zb), V(r.x, rungY(r.x, zf), zf), .06, mats.dark));
    for (const m of r.ms){
      const y = rungY(r.x, m.z);
      add(bar(V(m.x, m.topY, m.z), V(r.x, y, m.z), .028, mats.chrome, 8));   // hanger rod
      const clamp = add(new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .18, 12), mats.iron));
      clamp.rotation.x = Math.PI / 2; clamp.position.set(r.x, y, m.z);
    }
  }
  return group;
}

/* ---- the RISER DECK: an angular faceted slab (the back-left corner cut away for the
   belt's bay in the solo slot), with a glowing lip, and a sound-grille of concentric
   grooves round the kick. The KICK SHOCKWAVE lives here: up to 3 rings (drumparts
   shockRing) race across the top face from the kick — light through the grooves. ---- */
export function buildDeck(mats, kick){
  const outline = [[-9.3, 3.4], [9.3, 3.4], [9.3, -6.4], [-1.6, -6.4], [-4.4, -3.3], [-9.3, -3.3]];
  const sh = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(sh, { depth: .26, bevelEnabled: true, bevelThickness: .04, bevelSize: .06, bevelSegments: 2 });
  geo.rotateX(-Math.PI / 2).translate(0, -.3, 0);        // top face at y ≈ 0
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

/* ---- the SPIRAL STAIRCASE the toms climb: a chrome newel post, a cantilevered wedge
   step under each tom (its edge lit in the tom's colour), the floor tom on a round
   plinth at the foot. Pitch = height: a fill is a visible descent. ---- */
export function buildStair(seats, C, R, mats, stepY){
  const group = new THREE.Group(), add = m => (group.add(fz(m)), m);
  if (!seats.length) return { group };
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa2b4, metalness: .9, roughness: .22, envMap: mats.chrome.envMap, envMapIntensity: 1.4 });
  const rOut = R + 1.25;                                 // tread outer radius (past the widest hoop)
  const rail = rOut - .12;                               // the handrail rides just inside the treads' nose
  const top = Math.max(...seats.map(s => stepY(s))) + 1.1;
  add(new THREE.Mesh(new THREE.CylinderGeometry(.16, .22, top, 24), mats.chrome)).position.set(C.x, top / 2, C.z);
  add(new THREE.Mesh(new THREE.SphereGeometry(.26, 20, 14), mats.chrome)).position.set(C.x, top + .12, C.z);
  add(new THREE.Mesh(new THREE.CylinderGeometry(.5, .6, .2, 24), mats.iron)).position.set(C.x, .1, C.z);
  add(new THREE.Mesh(new THREE.CylinderGeometry(rOut + .15, rOut + .25, .12, 64), mats.deck || mats.iron)).position.set(C.x, .06, C.z);
  const plinthTrim = add(new THREE.Mesh(new THREE.TorusGeometry(rOut + .2, .025, 6, 96), mats.trim));
  plinthTrim.rotation.x = Math.PI / 2; plinthTrim.position.set(C.x, .125, C.z);
  const railPts = [];
  seats.forEach((s, k) => {
    const prev = seats[k - 1], next = seats[k + 1];
    const a0 = prev ? (prev.phi + s.phi) / 2 : s.phi - (next ? (next.phi - s.phi) / 2 : .4);
    const a1 = next ? (next.phi + s.phi) / 2 : s.phi + (prev ? (s.phi - prev.phi) / 2 : .4);
    const y = Math.max(.12, stepY(s));
    // a wedge tread: a cylinder sector (thetaStart measured like our bearing: 0 = +z, + toward +x)
    if (y > .3){
      add(new THREE.Mesh(new THREE.CylinderGeometry(rOut, rOut, .2, 32, 1, false, a0, a1 - a0), steel)).position.set(C.x, y - .1, C.z);
    }
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(rOut + .015, rOut + .015, .09, 32, 1, true, a0, a1 - a0), s.trimMat);
    edge.position.set(C.x, y - .05, C.z); add(edge);
    // a baluster at the tread's nose, up to the rail
    const bx = C.x + rail * Math.sin(s.phi), bz = C.z + rail * Math.cos(s.phi);
    add(bar(V(bx, y, bz), V(bx, y + 1.05, bz), .03, mats.chrome, 8));
    railPts.push(V(bx, y + 1.05, bz));
  });
  // the HANDRAIL: one chrome helix through the baluster tops — it's what makes it read as a stair
  if (railPts.length > 1){
    const pts = [], n = 24 * railPts.length;
    const ph0 = seats[0].phi - .35, ph1 = seats.at(-1).phi + .35;
    const yAt = ph => {                                   // linear through the baluster tops, extended at the ends
      const P = seats.map((s, k) => [s.phi, railPts[k].y]);
      let k = 0; while (k < P.length - 2 && ph > P[k + 1][0]) k++;
      const [x0, y0] = P[k], [x1, y1] = P[k + 1];
      return y0 + (y1 - y0) * (ph - x0) / (x1 - x0);
    };
    for (let k = 0; k <= n; k++){ const ph = ph0 + (ph1 - ph0) * k / n; pts.push(V(C.x + rail * Math.sin(ph), yAt(ph), C.z + rail * Math.cos(ph))); }
    add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, .05, 8), mats.chrome));
    add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => p.clone().setY(p.y + .07))), n * 2, .018, 5), mats.trim));
  }
  return { group };
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
