import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STAGE, rng, canvasTex, radialTex, glowPoints, glowMat, instanced, trs } from './common.js';
import { tintStyle } from './footing3d.js';
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

   Layers, near → far: the stage (instruments on the floor contract),
   the side graves (lit, fogged), the fence, the chapel + trees (dark
   SILHOUETTES that ignore the fog, so they read against the sky), the
   moon + clouds, the sky dome (its horizon IS the fog colour, so far
   ground melts into it and the conveyor's off-screen wrap stays hidden).

   ~22 draw calls, everything instanced/merged; animation is uniforms +
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

/* how its footing looks (rooms/footing3d.js tintStyle) — one per built room: its own materials */
const footStyle = () => tintStyle({ key: 'graveyard', base: { color: 0xd6dcd2, grain: true, roughness: .96, metalness: 0 },
  steel: { color: 0x4a5056, metalness: .45, roughness: .6 }, deck: { color: 0x4d4034, metalness: .05, roughness: .85 } });

export default {
  key: 'graveyard', label: 'Midnight Graveyard',
  build(scene, { envMap }){
    const FOOT_STYLE = footStyle();
    const group = new THREE.Group();
    const R = rng(1031);
    const F = STAGE.FLOOR;

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

    // ---- graves: headstones (rounded tops), crosses, obelisks — instanced, leaning ----
    const stone = new THREE.MeshStandardMaterial({ map: stoneTex(), color: 0x8f968d, roughness: .92, metalness: 0, envMap, envMapIntensity: .15 });
    const headGeo = mergeGeometries([
      new THREE.BoxGeometry(2.4, 3.2, .45).translate(0, 1.6, 0),
      new THREE.CylinderGeometry(1.2, 1.2, .45, 16, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 3.2, 0),
    ].map(g => g.toNonIndexed()));
    const crossGeo = mergeGeometries([
      new THREE.BoxGeometry(.6, 6.4, .5).translate(0, 3.2, 0), new THREE.BoxGeometry(3, .6, .5).translate(0, 4.6, 0),
      new THREE.TorusGeometry(.9, .14, 6, 18).translate(0, 4.6, 0),                // the Celtic ring
      new THREE.BoxGeometry(1.6, .8, 1.1).translate(0, .4, 0),
    ].map(g => g.toNonIndexed()));
    const obeliskGeo = mergeGeometries([
      new THREE.BoxGeometry(2.6, 1.2, 2.6).translate(0, .6, 0),
      new THREE.CylinderGeometry(.55, 1.05, 9, 4, 1).rotateY(Math.PI / 4).translate(0, 5.7, 0),
      new THREE.ConeGeometry(.78, 1.4, 4).rotateY(Math.PI / 4).translate(0, 10.9, 0),
    ].map(g => g.toNonIndexed()));
    const heads = [], crosses = [], obelisks = [], candles = [];
    // rows of graves down both sides of the stage + a scatter behind the machines
    const plot = (x, z, kind, yaw) => {
      const lean = (R() - .5) * .28, roll = (R() - .5) * .18, s = .85 + R() * .5;
      const m = trs(x, F - .15, z, lean, yaw + (R() - .5) * .3, roll, s, s, s);
      (kind < .62 ? heads : kind < .9 ? crosses : obelisks).push(m);
      if (R() < .4) candles.push([x + (R() - .5) * 1.4, z + 1.1 + R() * .4]);
    };
    for (const side of [-1, 1]){
      for (let row = 0; row < 3; row++) for (let k = 0; k < 9; k++){
        const x = side * (44 + row * 6.5 + (R() - .5) * 2), z = -46 + k * 8.5 + (R() - .5) * 3;
        plot(x, z, R(), side * -Math.PI / 2 * .25);
      }
    }
    for (let k = 0; k < 22; k++){                                     // behind the stage
      const x = -40 + (k % 11) * 8 + (R() - .5) * 3, z = -24 - Math.floor(k / 11) * 9 - R() * 3;
      plot(x, z, R(), 0);
    }
    group.add(instanced(headGeo, stone, heads), instanced(crossGeo, stone, crosses), instanced(obeliskGeo, stone, obelisks));

    // ---- the iron fence: posts with spear finials + two rails, round three sides, crooked ----
    const iron = new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: .7, roughness: .55, envMap, envMapIntensity: .4 });
    const postGeo = mergeGeometries([
      new THREE.CylinderGeometry(.09, .09, 5.2, 5).translate(0, 2.6, 0),
      new THREE.ConeGeometry(.22, .7, 4).translate(0, 5.5, 0),
    ].map(g => g.toNonIndexed()));
    const posts = [], rails = [];
    const fenceRun = (x0, z0, x1, z1, gap = 1.1) => {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(L / gap), yaw = Math.atan2(x1 - x0, z1 - z0);
      for (let i = 0; i <= n; i++){
        if (R() < .06) continue;                                      // a missing picket
        const t = i / n;
        posts.push(trs(x0 + (x1 - x0) * t, F, z0 + (z1 - z0) * t, (R() - .5) * .16, 0, (R() - .5) * .16));
      }
      for (const y of [1.2, 4.3]) rails.push(trs((x0 + x1) / 2, F + y + (R() - .5) * .3, (z0 + z1) / 2, 0, yaw, (R() - .5) * .02, 1, 1, L));
    };
    fenceRun(-FENCE_X, FENCE_Z, -8, FENCE_Z); fenceRun(8, FENCE_Z, FENCE_X, FENCE_Z);   // a gate gap behind the stage
    fenceRun(-FENCE_X, FENCE_Z, -FENCE_X, 34); fenceRun(FENCE_X, FENCE_Z, FENCE_X, 34);
    group.add(instanced(postGeo, iron, posts), instanced(new THREE.BoxGeometry(.12, .12, 1), iron, rails));
    // the gate's stone piers, with a lantern each (lit by the candle points below)
    group.add(instanced(new THREE.BoxGeometry(2.2, 8, 2.2).translate(0, 4, 0), stone, [trs(-9.5, F, FENCE_Z), trs(9.5, F, FENCE_Z)]));

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

    // ---- candles on the graves: wax stubs + guttering flames + soft halos + warm pools ----
    const wax = new THREE.MeshStandardMaterial({ color: 0xd8cfb6, roughness: .6, emissive: 0x3a2610 });
    const cand = candles.map(([x, z]) => trs(x, F + .35, z, 0, 0, 0, 1, .7 + R() * .6, 1));
    group.add(instanced(new THREE.CylinderGeometry(.16, .18, 1, 6), wax, cand));
    const fP = [], fC = [], fS = [], fPh = [], hP = [], hC = [], hS = [], hPh = [];
    const flame = radialTex(64, [[0, 1], [.12, .7], [.4, .12], [1, 0]]);
    cand.forEach(m => {
      const p = new THREE.Vector3().setFromMatrixPosition(m), sy = new THREE.Vector3().setFromMatrixScale(m).y;
      fP.push(p.x, p.y + sy / 2 + .22, p.z); fC.push(1, .62, .26); fS.push(.55 + R() * .2); fPh.push(R());
      hP.push(p.x, p.y + sy / 2 + .3, p.z); hC.push(.42, .2, .07); hS.push(5 + R() * 2); hPh.push(R());
    });
    for (const x of [-9.5, 9.5]){                                     // the gate lanterns
      fP.push(x, F + 8.6, FENCE_Z); fC.push(1, .7, .35); fS.push(1.1); fPh.push(R());
      hP.push(x, F + 8.6, FENCE_Z); hC.push(.5, .26, .1); hS.push(11); hPh.push(R());
    }
    const flames = glowPoints(fP, { colors: fC, sizes: fS, phases: fPh, map: flame, flicker: .45, rate: 11 });
    const halos = glowPoints(hP, { colors: hC, sizes: hS, phases: hPh, flicker: .3, rate: 6,
      map: radialTex(64, [[0, .55], [.25, .22], [.6, .05], [1, 0]]) });
    group.add(flames, halos);
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      glowMat(radialTex(), 0xff8a3a, .16, { side: THREE.FrontSide }), cand.length);
    cand.forEach((m, i) => { const p = new THREE.Vector3().setFromMatrixPosition(m); pools.setMatrixAt(i, trs(p.x, F + .05, p.z, 0, 0, 0, 7, 1, 7)); });
    pools.frustumCulled = false; group.add(pools);

    // ---- will-o'-the-wisps: cold green-blue lights drifting low over the graves ----
    const wP = [], wC = [], wS = [], wPh = [];
    for (let i = 0; i < 26; i++){
      const side = i % 2 ? 1 : -1;
      wP.push(side * (20 + R() * 44), F + 1.5 + R() * 5, -50 + R() * 80);
      const c = R(); wC.push(.35 + .2 * c, 1, .7 + .3 * c); wS.push(.7 + R() * .6); wPh.push(R());
    }
    const wisps = glowPoints(wP, { colors: wC, sizes: wS, phases: wPh, map: flame, flicker: .75, rate: 1.7, drift: 2.6 });
    group.add(wisps);

    // ---- GROUND FOG: two rolling layers of noise, fading with distance from the stage ----
    const fogNoise = noiseTex(4, 34, 52); fogNoise.wrapS = fogNoise.wrapT = THREE.RepeatWrapping;
    const fogMat = (h, k, a) => new THREE.ShaderMaterial({
      uniforms: { uMap: { value: fogNoise }, uTime: { value: 0 }, uA: { value: a }, uK: { value: k },
                  uColor: { value: new THREE.Color(0x8fb4a2) }, uBoost: { value: 1 } },
      vertexShader: /* glsl */`
        varying vec2 vW;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xz;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap; uniform float uTime, uA, uK, uBoost; uniform vec3 uColor;
        varying vec2 vW;
        void main(){
          float vD = length(vW - vec2(0., -6.));                    // (per fragment: the plane has 4 vertices)
          float n1 = texture2D(uMap, vW * .011 * uK + vec2(uTime * .006, uTime * .002)).a;
          float n2 = texture2D(uMap, vW * .023 * uK + vec2(-uTime * .009, uTime * .005)).a;
          float n = smoothstep(.22, .72, n1 + .8 * n2);
          float fade = 1. - smoothstep(85., 130., vD);              // melts into the haze far out
          gl_FragColor = vec4(uColor * uBoost, n * fade * uA);
        }`,
      transparent: true, depthWrite: false,
    });
    const fogs = [[1.1, 1, .34], [2.8, .7, .2], [4.8, .45, .09]].map(([h, k, a]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), fogMat(h, k, a));
      m.rotation.x = -Math.PI / 2; m.position.set(0, F + h, -20); m.renderOrder = 2; group.add(m);
      return m;
    });

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

    return {
      group, ...STAGE, HW: FENCE_X, BACK: FENCE_Z, FRONT: 40,
      fog: new THREE.FogExp2(FOG, .017), background,
      mood: { ambient: [0x26324a, 1.6], hemi: [0x9db4e0, 0x141c16, .95] },   // cold moonlight
      // the footing (rooms/footing3d.js): weathered granite, wrought iron, old planks
      footing: FOOT_STYLE,
      update(dt, songTime, camera, energy = 0, cues = null){
        const t = songTime;
        const L = lightning(t, cues), Dn = dawnAt(t, cues);
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
