import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STAGE, rng, canvasTex, radialTex, shaftTex, glowPoints, glowMat, instanced, trs } from './common.js';
/* ============================================================
   CATHEDRAL NAVE — clustered stone piers marching away into warm haze,
   a pointed-arch arcade, a clerestory of stained glass throwing slanted
   coloured light shafts down across the stage, hanging candle coronas,
   and a rose window glowing at the far end of the nave.

   Built entirely from instancing + a handful of canvas textures:
   ~20 draw calls. All animation (candle flicker, shaft shimmer, mote
   drift) is shader/uniform-only — zero per-frame allocation.
   The nave runs along −z (away from the stage camera); the instruments'
   horseshoe sits in the crossing. FLOOR = STAGE.FLOOR (the contract).
   ============================================================ */

const NAVE_X = 47;          // pier centre-line (|x|) — clear of the widest station (bells ≈ 37)
const BAY = 17;             // pier spacing along z
const Z0 = 70, NB = 14;     // first pier z, number of bays → nave runs 70 → −168
const SPRING = 20;          // arcade springing line (world y)
const CLER_TOP = 66;        // top of the clerestory wall
const RIB_K = .4;           // vault ribs: a flattened pointed arch (apex = CLER_TOP + .866·span·RIB_K)
const VAULT = CLER_TOP + .866 * 2 * NAVE_X * RIB_K;   // vault apex ≈ 98
const FOG = 0x140e0b;
const SHAFT_A = .04;         // light-shaft opacity (additive; ~14 crossed planes overlap)

/* a pointed (equilateral) arch spanning `span`, as a 3D curve in the y–z plane */
function pointedArch(span, segs = 16){
  const pts = [];
  for (let i = 0; i <= segs; i++){ const th = (i / segs) * Math.PI / 3;   // left half: centre at (span,0)
    pts.push(new THREE.Vector3(0, span * Math.sin(th), span - span * Math.cos(th))); }
  for (let i = segs - 1; i >= 0; i--){ const p = pts[i];
    pts.push(new THREE.Vector3(0, p.y, span - p.z)); }
  return new THREE.CatmullRomCurve3(pts.map(p => p.setZ(p.z - span / 2)));
}

function stoneTex(R){
  return canvasTex(256, 256, (x, w, h) => {                 // ashlar courses, warm grey-brown
    x.fillStyle = '#3a322b'; x.fillRect(0, 0, w, h);
    const rows = 8, rh = h / rows;
    for (let r = 0; r < rows; r++){
      const off = (r % 2) * 32;
      for (let c = -1; c < 5; c++){
        const v = 44 + R() * 22 | 0;
        x.fillStyle = `rgb(${v + 8},${v},${v - 8})`;
        x.fillRect(c * 64 + off + 2, r * rh + 2, 60, rh - 4);
      }
    }
    for (let i = 0; i < 900; i++){ const v = R() * 40 | 0;      // grit
      x.fillStyle = `rgba(${v},${v * .9 | 0},${v * .8 | 0},.25)`; x.fillRect(R() * w, R() * h, 2, 2); }
  }, { repeat: [1, 1] });
}

function floorTex(){
  return canvasTex(512, 512, (x, w) => {                    // worn marble chequer, diagonal
    const n = 4, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++){
      x.fillStyle = (i + j) % 2 ? '#2a221d' : '#6b5d50'; x.fillRect(i * s, j * s, s, s);
    }
    const R = rng(7);
    for (let k = 0; k < 60; k++){                            // veins
      x.strokeStyle = `rgba(${200 + R() * 40 | 0},${180 + R() * 30 | 0},${150},${.05 + R() * .08})`;
      x.lineWidth = .5 + R() * 1.5; x.beginPath();
      let px = R() * w, py = R() * w; x.moveTo(px, py);
      for (let t = 0; t < 6; t++){ px += (R() - .5) * 90; py += (R() - .3) * 60; x.lineTo(px, py); }
      x.stroke();
    }
    x.strokeStyle = 'rgba(10,8,6,.8)'; x.lineWidth = 3;     // grout
    for (let i = 0; i <= n; i++){ x.beginPath(); x.moveTo(i * s, 0); x.lineTo(i * s, w); x.stroke();
      x.beginPath(); x.moveTo(0, i * s); x.lineTo(w, i * s); x.stroke(); }
  });
}

/* one clerestory bay: stone wall (map) with the arcade arch cut out (alpha) and a
   pair of lancets + a small rose (glass drawn separately into `glass`) */
function bayTextures(){
  const W = 256, H = Math.round(256 * (CLER_TOP - SPRING) / BAY);
  const S = W / BAY;                                         // px per world unit
  const archPath = (x) => {                                  // the arcade opening (spring at the bottom edge)
    x.beginPath(); x.moveTo(0, H);
    const span = W, rr = span;
    x.arc(W, H, rr, Math.PI, Math.PI + Math.PI / 3, false);
    x.arc(0, H, rr, -Math.PI / 3, 0, false);
    x.closePath();
  };
  const lancet = (x, cx, bottom, wid, hgt) => {              // a pointed-top window
    const r = wid; x.beginPath();
    x.moveTo(cx - wid / 2, bottom); x.lineTo(cx - wid / 2, bottom - hgt);
    x.arc(cx + wid / 2, bottom - hgt, r, Math.PI, Math.PI + Math.PI / 3);
    x.arc(cx - wid / 2, bottom - hgt, r, -Math.PI / 3, 0);
    x.lineTo(cx + wid / 2, bottom); x.closePath();
  };
  const winY = H - (40 - SPRING) * S;                        // lancet sills at y≈40
  const wins = [[W * .33, W * .17, 15 * S], [W * .67, W * .17, 15 * S]];
  const rose = [W / 2, winY - 19.5 * S, W * .11];
  const R = rng(3);
  const wall = canvasTex(W, H, (x) => {
    x.fillStyle = '#3d342c'; x.fillRect(0, 0, W, H);
    const rh = 1.6 * S;
    for (let y = H, r = 0; y > -rh; y -= rh, r++){
      const off = (r % 2) * 20;
      for (let c = -1; c < W / 40 + 1; c++){
        const v = 46 + R() * 20 | 0;
        x.fillStyle = `rgb(${v + 8},${v},${v - 7})`; x.fillRect(c * 40 + off + 1, y - rh + 1, 38, rh - 2);
      }
    }
    x.globalCompositeOperation = 'destination-out';           // cut the arcade opening
    archPath(x); x.fill();
    x.globalCompositeOperation = 'source-over';
    x.fillStyle = '#0c0907';                                  // window reveals (dark stone frames)
    wins.forEach(([cx, w, h]) => { lancet(x, cx, winY + 6, w + 12, h + 4); x.fill(); });
    x.beginPath(); x.arc(rose[0], rose[1], rose[2] + 6, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#5e5246'; x.lineWidth = 6; archPath(x); x.stroke();   // arch moulding
  }, { mips: true });
  const glass = canvasTex(W, H, (x) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
    const pal = ['#ff9a2e', '#d9332b', '#2f5cff', '#f4c542', '#7c3cff', '#29b37a', '#ff5c8a', '#3fa9ff'];
    const paint = (clip) => {
      x.save(); clip(); x.clip();
      const cell = 7;
      for (let yy = 0; yy < H; yy += cell) for (let xx = 0; xx < W; xx += cell){
        x.fillStyle = pal[(R() * pal.length) | 0]; x.globalAlpha = .55 + R() * .45;
        x.fillRect(xx, yy, cell, cell);
      }
      x.globalAlpha = 1; x.strokeStyle = '#000'; x.lineWidth = 1.6;   // leading
      for (let yy = 0; yy < H; yy += cell * 2){ x.beginPath(); x.moveTo(0, yy); x.lineTo(W, yy + 9); x.stroke(); }
      for (let xx = 0; xx < W; xx += cell * 2){ x.beginPath(); x.moveTo(xx, 0); x.lineTo(xx - 6, H); x.stroke(); }
      x.restore();
    };
    wins.forEach(([cx, w, h]) => paint(() => lancet(x, cx, winY, w, h)));
    paint(() => { x.beginPath(); x.arc(rose[0], rose[1], rose[2], 0, Math.PI * 2); });
    x.strokeStyle = '#000'; x.lineWidth = 3;                 // rose tracery
    for (let k = 0; k < 8; k++){ const a = k * Math.PI / 4; x.beginPath(); x.moveTo(rose[0], rose[1]);
      x.lineTo(rose[0] + Math.cos(a) * rose[2], rose[1] + Math.sin(a) * rose[2]); x.stroke(); }
  });
  return { wall, glass };
}

function roseTex(){
  return canvasTex(512, 512, (x, w) => {
    const c = w / 2, R = rng(11);
    x.fillStyle = '#000'; x.fillRect(0, 0, w, w);
    const pal = ['#2f5cff', '#d9332b', '#f4c542', '#7c3cff', '#3fa9ff', '#ff9a2e'];
    for (let ring = 6; ring >= 1; ring--){
      const r = ring * 40, n = ring * 6;
      for (let k = 0; k < n; k++){
        const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
        x.beginPath(); x.moveTo(c, c); x.arc(c, c, r, a0, a1); x.closePath();
        x.fillStyle = pal[(ring + k) % pal.length]; x.globalAlpha = .6 + R() * .4; x.fill();
      }
    }
    x.globalAlpha = 1; x.strokeStyle = '#000'; x.lineWidth = 5;
    for (let ring = 1; ring <= 6; ring++){ x.beginPath(); x.arc(c, c, ring * 40, 0, Math.PI * 2); x.stroke(); }
    for (let k = 0; k < 24; k++){ const a = k / 24 * Math.PI * 2;
      x.beginPath(); x.moveTo(c + Math.cos(a) * 40, c + Math.sin(a) * 40);
      x.lineTo(c + Math.cos(a) * 240, c + Math.sin(a) * 240); x.stroke(); }
    for (let k = 0; k < 12; k++){ const a = k / 12 * Math.PI * 2;      // petal cusps
      x.beginPath(); x.arc(c + Math.cos(a) * 150, c + Math.sin(a) * 150, 34, 0, Math.PI * 2); x.stroke(); }
    const g = x.createRadialGradient(c, c, 230, c, c, 256);  // feather the outer edge
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
    x.fillStyle = g; x.fillRect(0, 0, w, w);
  });
}

export default {
  key: 'cathedral', label: 'Cathedral Nave',
  build(scene, { envMap }){
    const group = new THREE.Group();
    const R = rng(42);
    const F = STAGE.FLOOR;
    const zEnd = Z0 - NB * BAY;
    const pierZ = Array.from({ length: NB + 1 }, (_, i) => Z0 - i * BAY);

    // ---- floor: worn marble chequer, a touch of gloss so the glows pool in it ----
    const fT = floorTex(); fT.wrapS = fT.wrapT = THREE.RepeatWrapping; fT.repeat.set(10, 22);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * NAVE_X + 40, Z0 - zEnd + 30),
      new THREE.MeshStandardMaterial({ map: fT, roughness: .32, metalness: .15, envMap, envMapIntensity: .5 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, F, (Z0 + zEnd) / 2); group.add(floor);

    // ---- clustered piers (core + 8 shafts + base + capital), instanced both sides ----
    const stone = new THREE.MeshStandardMaterial({ map: stoneTex(R), color: 0xb8a690, roughness: .85, metalness: 0, envMap, envMapIntensity: .25 });
    stone.map.wrapS = stone.map.wrapT = THREE.RepeatWrapping; stone.map.repeat.set(2, 6);
    const H = SPRING - F;
    const parts = [new THREE.CylinderGeometry(2.3, 2.3, H, 16, 1, true).translate(0, H / 2, 0)];
    for (let k = 0; k < 8; k++){ const a = k * Math.PI / 4;
      parts.push(new THREE.CylinderGeometry(.62, .62, H, 8, 1, true).translate(Math.cos(a) * 2.45, H / 2, Math.sin(a) * 2.45)); }
    parts.push(new THREE.CylinderGeometry(3.6, 4, 2.4, 8).translate(0, 1.2, 0));          // base
    parts.push(new THREE.CylinderGeometry(3.7, 3.3, 1.2, 8).translate(0, 3, 0));           // base torus-ish step
    parts.push(new THREE.CylinderGeometry(4.0, 3.0, 2.2, 8).translate(0, H - 1.1, 0));     // capital
    parts.push(new THREE.BoxGeometry(8.4, 1, 8.4).translate(0, H + .5, 0));                // abacus
    const pierGeo = mergeGeometries(parts.map(g => g.toNonIndexed()));
    const pierM = [];
    for (const s of [-1, 1]) for (const z of pierZ) pierM.push(trs(s * NAVE_X, F, z));
    group.add(instanced(pierGeo, stone, pierM));

    // ---- arcade arches (tube along a pointed curve) between consecutive piers ----
    const archGeo = new THREE.TubeGeometry(pointedArch(BAY), 32, 1.25, 6, false);
    const archM = [];
    for (const s of [-1, 1]) for (let i = 0; i < NB; i++) archM.push(trs(s * NAVE_X, SPRING + 1, pierZ[i] - BAY / 2));
    group.add(instanced(archGeo, stone, archM));

    // ---- clerestory walls: stone with the arcade cut out + glowing stained glass ----
    const { wall, glass } = bayTextures();
    wall.wrapS = glass.wrapS = THREE.RepeatWrapping; wall.repeat.x = glass.repeat.x = NB;
    const wallGeo = new THREE.PlaneGeometry(NB * BAY, CLER_TOP - SPRING);
    const wallMat = new THREE.MeshStandardMaterial({ map: wall, color: 0xc0ae98, alphaTest: .5, roughness: .9, side: THREE.DoubleSide });
    const glassMat = new THREE.MeshBasicMaterial({ map: glass, color: new THREE.Color(2.4, 2.1, 1.9), blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, side: THREE.DoubleSide });
    /* the glass is an ADDITIVE overlay — mostly black texels that still cost fill. Crop it to the
       window band (lancet sills y≈40 → rose top ≈62) and to the first GB bays (the haze has
       swallowed everything beyond), with the uvs remapped so it registers exactly. */
    const G0 = 39, G1 = 62.5, GB = 9;
    const glassGeo = new THREE.PlaneGeometry(GB * BAY, G1 - G0);
    { const uv = glassGeo.attributes.uv, v0 = (G0 - SPRING) / (CLER_TOP - SPRING), v1 = (G1 - SPRING) / (CLER_TOP - SPRING);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * GB / NB, v0 + uv.getY(i) * (v1 - v0)); }
    for (const s of [-1, 1]){
      const wm = new THREE.Mesh(wallGeo, wallMat);
      wm.rotation.y = s * Math.PI / 2; wm.position.set(s * NAVE_X, (SPRING + CLER_TOP) / 2, Z0 - NB * BAY / 2);
      const gm = new THREE.Mesh(glassGeo, glassMat);
      gm.rotation.copy(wm.rotation); gm.position.set(wm.position.x - s * .3, (G0 + G1) / 2, Z0 - GB * BAY / 2);
      group.add(wm, gm);
    }
    // aisle outer walls + vault + ceiling: dark masses the haze swallows
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a231d, roughness: 1, side: THREE.DoubleSide });
    for (const s of [-1, 1]){
      const aw = new THREE.Mesh(new THREE.PlaneGeometry(Z0 - zEnd + 30, SPRING + 18 - F), dark);
      aw.rotation.y = s * Math.PI / 2; aw.position.set(s * (NAVE_X + 16), (F + SPRING + 18) / 2, (Z0 + zEnd) / 2); group.add(aw);
    }
    const ribGeo = new THREE.TubeGeometry(pointedArch(2 * NAVE_X, 20), 40, 1.1, 6, false);
    const ribM = pierZ.map(z => trs(0, CLER_TOP, z, 0, Math.PI / 2, 0, 1, RIB_K, 1));
    group.add(instanced(ribGeo, stone, ribM));
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(2 * NAVE_X + 10, Z0 - zEnd + 30), dark);
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, VAULT + .5, (Z0 + zEnd) / 2); group.add(ceil);

    // ---- the west end: apse wall + the great rose window, far down the nave ----
    const apse = new THREE.Mesh(new THREE.PlaneGeometry(2 * NAVE_X + 34, VAULT + 30 - F), dark);
    apse.position.set(0, (F + VAULT + 30) / 2, zEnd - 2); group.add(apse);
    const rose = new THREE.Mesh(new THREE.CircleGeometry(20, 64),
      new THREE.MeshBasicMaterial({ map: roseTex(), color: new THREE.Color(1.5, 1.3, 1.25), blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, fog: false }));
    rose.position.set(0, 48, zEnd - 1); group.add(rose);
    const roseHalo = new THREE.Mesh(new THREE.PlaneGeometry(76, 76), glowMat(radialTex(), 0xff9f5a, .16));
    roseHalo.position.set(0, 48, zEnd + 1); group.add(roseHalo);

    // ---- light shafts: crossed additive planes from the LEFT clerestory, slanting down
    // across the crossing (the low sun). Each is tinted by its window's glass. ----
    const sh = shaftTex();
    const shaftGeo = mergeGeometries([
      new THREE.PlaneGeometry(1, 1).translate(0, -.5, 0),
      new THREE.PlaneGeometry(1, 1).translate(0, -.5, 0).rotateY(Math.PI / 2)]);
    const shaftMat = new THREE.MeshBasicMaterial({ map: sh, transparent: true, opacity: SHAFT_A, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const dir = new THREE.Vector3(.6, -.78, -.17).normalize();
    const qDir = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    const eul = new THREE.Euler().setFromQuaternion(qDir);
    const shaftTint = [0xffc27a, 0xff8a5a, 0x8fb0ff, 0xffe0a0, 0xc79bff, 0xffb070];
    const shaftList = [];
    pierZ.slice(2, 9).forEach((z, i) => {
      for (const off of [-.25, .3]){
        const zz = z - BAY / 2 + off * BAY * .5;
        const len = (48 - F) / -dir.y, w = 3.5 + R() * 2.5;
        shaftList.push({ m: trs(-NAVE_X + .5, 48, zz, eul.x, eul.y, eul.z, w, len * 1.02, w),
          c: new THREE.Color(shaftTint[(i * 2 + (off > 0)) % shaftTint.length]),
          hit: new THREE.Vector3(-NAVE_X + .5 + dir.x * len, F + .05, zz + dir.z * len) });
      }
    });
    const shafts = new THREE.InstancedMesh(shaftGeo, shaftMat, shaftList.length);
    shaftList.forEach((s, i) => { shafts.setMatrixAt(i, s.m); shafts.setColorAt(i, s.c); });
    shafts.frustumCulled = false; group.add(shafts);
    // where the shafts land: coloured light pools on the floor
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      glowMat(radialTex(), 0xffffff, .35, { side: THREE.FrontSide }), shaftList.length);
    shaftList.forEach((s, i) => { pools.setMatrixAt(i, trs(s.hit.x, s.hit.y, s.hit.z, 0, 0, 0, 13, 1, 8));
      pools.setColorAt(i, s.c.clone().multiplyScalar(.6)); });
    pools.frustumCulled = false; group.add(pools);

    // ---- light: dust motes drifting in the shafts + candle coronas + pricket stands ----
    const flame = radialTex(64, [[0, 1], [.12, .7], [.4, .12], [1, 0]]);
    const mP = [], mC = [], mS = [], mPh = [];
    shaftList.forEach(s => {
      const top = new THREE.Vector3().setFromMatrixPosition(s.m), len = new THREE.Vector3().setFromMatrixScale(s.m).y;
      for (let k = 0; k < 26; k++){
        const t = .15 + R() * .8, p = top.clone().addScaledVector(dir, t * len);
        mP.push(p.x + (R() - .5) * 4, p.y, p.z + (R() - .5) * 4); mC.push(s.c.r * .7, s.c.g * .7, s.c.b * .7);
        mS.push(.12 + R() * .18); mPh.push(R());
      }
    });
    const motes = glowPoints(mP, { colors: mC, sizes: mS, phases: mPh, map: flame, size: 1, flicker: .7, rate: 1.3, drift: 1 });
    group.add(motes);

    const fP = [], fC = [], fS = [], fPh = [], hP = [], hC = [], hS = [], hPh = [];
    const flameCol = [1.0, .62, .25];
    const iron = new THREE.MeshStandardMaterial({ color: 0x18140f, metalness: .8, roughness: .5, envMap });
    const ringM = [], chainM = [];
    const CORONA = [[-34, 24, 30], [34, 24, 30], [-34, 26, -6], [34, 26, -6], [-30, 27, -44], [30, 27, -44], [0, 32, -80], [0, 33, -118]];
    CORONA.forEach(([cx, cy, cz]) => {
      ringM.push(trs(cx, cy, cz, Math.PI / 2, 0, 0));
      const top = CLER_TOP + 20;
      chainM.push(trs(cx, (cy + top) / 2, cz, 0, 0, 0, 1, top - cy, 1));
      for (let k = 0; k < 18; k++){ const a = k / 18 * Math.PI * 2;
        fP.push(cx + Math.cos(a) * 3.2, cy + .55, cz + Math.sin(a) * 3.2);
        fC.push(...flameCol); fS.push(.5 + R() * .15); fPh.push(R()); }
      hP.push(cx, cy + .4, cz); hC.push(.5, .24, .08); hS.push(10); hPh.push(R());   // the corona's soft halo   // the corona's soft halo
    });
    group.add(instanced(new THREE.TorusGeometry(3.2, .13, 6, 36), iron, ringM));
    group.add(instanced(new THREE.CylinderGeometry(.05, .05, 1, 4), iron, chainM));
    const standM = [];
    for (const s of [-1, 1]) for (const z of pierZ){                 // pricket stands at every pier
      const x = s * (NAVE_X - 6.5);
      standM.push(trs(x, F + 2.2, z, 0, 0, 0, 1, 4.4, 1));
      for (let k = 0; k < 7; k++){
        fP.push(x + (k - 3) * .45, F + 4.6 + (k % 2) * .5, z + (R() - .5) * .8);
        fC.push(...flameCol); fS.push(.38 + R() * .1); fPh.push(R()); }
      hP.push(x, F + 4.8, z); hC.push(.4, .18, .06); hS.push(6); hPh.push(R());
    }
    group.add(instanced(new THREE.CylinderGeometry(.18, .6, 1, 6), iron, standM));
    const flames = glowPoints(fP, { colors: fC, sizes: fS, phases: fPh, map: flame, size: 1, flicker: .3, rate: 9 });
    const halos = glowPoints(hP, { colors: hC, sizes: hS, phases: hPh, size: 1, flicker: .18, rate: 5,
      map: radialTex(64, [[0, .55], [.25, .22], [.6, .05], [1, 0]]) });
    group.add(flames, halos);
    // warm pools under the prickets
    const warm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      glowMat(radialTex(), 0xff9a4a, .2, { side: THREE.FrontSide }), standM.length);
    let wi = 0;
    for (const s of [-1, 1]) for (const z of pierZ) warm.setMatrixAt(wi++, trs(s * (NAVE_X - 6.5), F + .06, z, 0, 0, 0, 14, 1, 14));
    warm.frustumCulled = false; group.add(warm);

    const glassBase = glassMat.color.clone();
    return {
      group, ...STAGE, FRONT: Z0, BACK: zEnd, HW: NAVE_X, CEIL: CLER_TOP,
      fog: new THREE.FogExp2(FOG, .017), background: new THREE.Color(FOG),
      mood: { ambient: [0x2a1f16, 1.3], hemi: [0x9a7a58, 0x1a120c, .55] },
      update(dt, songTime, camera, energy = 0){
        flames.material.uniforms.uTime.value = songTime; halos.material.uniforms.uTime.value = songTime;
        motes.material.uniforms.uTime.value = songTime;
        // the glass "breathes" with the music: lead strikes / kicks lift it a touch
        const b = 1 + .35 * energy;
        glassMat.color.copy(glassBase).multiplyScalar(b);
        shaftMat.opacity = SHAFT_A * (1 + .12 * Math.sin(songTime * .7)) * (1 + .4 * energy);
        flames.material.uniforms.uBoost.value = 1 + .25 * energy;
      },
      dispose(){},
    };
  },
};

