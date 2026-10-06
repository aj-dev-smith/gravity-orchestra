import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { eventTimes, lanesByNote, makeEdge, wrapP } from '../clock.js';
import { solveLane, poseAt, BALL_R, V_MAX, g } from './solve.js';
import { layoutBed, RAIL_DX, CAR_H } from './layout.js';
import { bassVoice } from './voice.js';

/* ============================================================
   STRING BASS — the heavyweight. A tiered bed of thick wound bronze
   strings (one per pitch, length ∝ 1/f) under tension between a stepped
   iron headstock and per-string bridge posts, each tied off to a brass
   tuning peg. Over each string's STRIKE POINT (alternating u = .3 / .7,
   like a real pluck point) an electromagnet carriage rides a guide rail
   that hangs from its own overhead winch arm. On the note the coil cuts
   (an ice-white discharge flash), a heavy chrome ball free-falls onto the
   string (released √(2h/g) early — it lands ON the beat), the string sags
   into a V under it, throws it back (lossy: e = .6), and rings: a slow
   readable standing wave + a glowing blur hull (the fast vibration's
   envelope). The carriage swoops down to meet the ball at its rebound
   apex at zero speed, clacks onto it, and the winch hauls it back up —
   the visible energy supply. All motion = solve.js poseAt(songTime).
   ============================================================ */

const SIG      = 0x2fe6c0;           // signature: cold teal string-light
const SIG_HOT  = 0xb8fff4;
const COIL     = 0xff6a24;           // magnets speak the room's amber
const ICE      = 0xcfe8ff;           // the coil's release discharge
const TRAIL_N  = 4, TRAIL_DT = .022;
const DRUM_R   = .2;                 // winch drum radius
const SLAB     = .45;

export default {
  key: 'bass',
  label: 'String Bass',
  wet: false,
  lookHeight: 3.6,

  voice: id => bassVoice(id),

  make({ envMap, glowTex }){
    let lanes = [], start = -Infinity;
    const _c = new THREE.Color(), _coil = new THREE.Color(COIL), _ice = new THREE.Color(ICE);

    function build(part, { rollT, beat, P, start: s0 = -Infinity, station, floorY = -20 }){
      const group = new THREE.Group();
      lanes = []; start = s0;
      const W = station?.w ?? 12, D = station?.d ?? 8;
      const ev = eventTimes(part, { rollT, beat });
      const byNote = lanesByNote(ev);
      const B = layoutBed(Object.keys(byNote), { W, D });
      if (!B.n) return group;
      const { yTop, scale } = B;

      // ---- shared materials (constant count after build) ----
      const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: .15, envMap, envMapIntensity: 1.3 });
      const dark   = new THREE.MeshStandardMaterial({ color: 0x232733, metalness: .7, roughness: .45, envMap });
      const iron   = new THREE.MeshStandardMaterial({ color: 0x1a1d26, metalness: .8, roughness: .35, envMap });
      const brass  = new THREE.MeshStandardMaterial({ color: 0xc9a05a, metalness: 1, roughness: .25, envMap });
      const bronze = new THREE.MeshStandardMaterial({ color: 0xa8784c, metalness: .9, roughness: .32, envMap });
      const trim   = new THREE.MeshStandardMaterial({ color: 0x0c2a26, emissive: new THREE.Color(SIG), emissiveIntensity: .9 });
      const cableM = new THREE.MeshStandardMaterial({ color: 0x9aa2b0, metalness: .9, roughness: .4 });
      const ballGeo = new THREE.SphereGeometry(BALL_R, 40, 28);

      // static parts are collected per material and MERGED: the frame costs ~6 draw calls at any n
      const bucket = new Map();
      const put = (mat, geo, x, y, z, rx = 0, rz = 0) => {
        const gg = geo.clone();
        if (rx) gg.rotateX(rx);
        if (rz) gg.rotateZ(rz);
        gg.translate(x, y, z);
        (bucket.get(mat) || bucket.set(mat, []).get(mat)).push(gg);
      };
      const box = (mat, x0, x1, y0, y1, z0, z1) =>
        put(mat, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      const rod = (mat, a, b, r, seg = 10) => {               // a cylinder from point a to point b
        const d = new THREE.Vector3().subVectors(b, a), len = d.length();
        const gg = new THREE.CylinderGeometry(r, r, len, seg);
        gg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
        gg.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        (bucket.get(mat) || bucket.set(mat, []).get(mat)).push(gg);
      };

      // the plinth + legs to the room floor (full footprint, unscaled)
      const slab = new THREE.Mesh(new THREE.BoxGeometry(W - .3, SLAB, D - .3), iron);
      slab.position.y = SLAB / 2; group.add(slab);
      for (const sz of [-1, 1]){
        const lip = new THREE.Mesh(new THREE.BoxGeometry(W - .3, .05, .05), trim);
        lip.position.set(0, SLAB - .08, sz * (D / 2 - .13)); group.add(lip);
      }
      const legH = -floorY;
      if (legH > .6) for (const sx of [-1, 1]) for (const sz of [-1, 1]){
        const leg = new THREE.Mesh(new THREE.BoxGeometry(.7, legH, .7), dark);
        leg.position.set(sx * (W / 2 - .8), -legH / 2, sz * (D / 2 - .8)); group.add(leg);
      }

      // the BED: everything above the plinth, uniformly scaled if it had to shrink to fit
      const bed = new THREE.Group();
      bed.scale.setScalar(scale); bed.position.y = SLAB * (1 - scale);
      group.add(bed);

      // shared per-lane geometries (carriage, drum) — one variant per rail side
      const carGeo = side => {
        const pole = new THREE.CylinderGeometry(.27, .3, .3, 28); pole.translate(0, .15, 0);
        const collar = new THREE.CylinderGeometry(.1, .1, .4, 12); collar.translate(side * RAIL_DX, .45, 0);
        const housing = new THREE.BoxGeometry(.62, .3, .62); housing.translate(0, .45, 0);
        const yoke = new THREE.BoxGeometry(RAIL_DX, .14, .14); yoke.translate(side * RAIL_DX / 2, .45, 0);
        const lug = new THREE.BoxGeometry(.12, .12, .12); lug.translate(0, CAR_H - .06, 0);   // cable eye
        return { chrome: mergeGeometries([pole, collar]), dark: mergeGeometries([housing, yoke, lug]) };
      };
      const carG = { [-1]: carGeo(-1), [1]: carGeo(1) };
      const coilGeo = new THREE.TorusGeometry(.25, .05, 10, 36); coilGeo.rotateX(Math.PI / 2); coilGeo.translate(0, .03, 0);
      const drumGeo = new THREE.CylinderGeometry(DRUM_R, DRUM_R, .3, 22); drumGeo.rotateX(Math.PI / 2);
      const fl = [-.16, .16].map(fz => { const f = new THREE.CylinderGeometry(DRUM_R * 1.35, DRUM_R * 1.35, .03, 22); f.rotateX(Math.PI / 2); f.translate(0, 0, fz); return f; });
      const spokeGeo = new THREE.BoxGeometry(DRUM_R * 2.5, .07, .05); spokeGeo.translate(0, 0, .18);
      const drumDark = mergeGeometries([...fl, spokeGeo]);
      const cableGeo = new THREE.CylinderGeometry(.02, .02, 1, 6);

      const nb = B.lanes;
      const zEdge = (k, s) => {                             // headstock steps span midpoint → midpoint
        const o = nb[k + s];
        return o ? (nb[k].z + o.z) / 2 : nb[k].z + s * .45;
      };
      const drumY = yTop - DRUM_R - .06;

      for (const L of nb){
        const { note, Ls, rs, y, z, xNut, xR, xb, side, u0 } = L;
        const es = byNote[note];
        const S = solveLane(es.map(e => e.t), P, { u0, Ls });
        const vel = S.s.map(s => Math.max(...es.filter(e => Math.abs(wrapP(e.t, P) - s) < 1e-6).map(e => e.vel), .05));
        const zA = zEdge(L.k, -1), zB = zEdge(L.k, 1);
        const nearDz = Math.min(Math.abs(z - zA), Math.abs(zB - z)) * 2;

        // headstock step + chrome nut saddle; bridge post + saddle; afterlength to a brass peg
        box(iron, xNut - .7, xNut, SLAB, y + .3, Math.min(zA, zB), Math.max(zA, zB));
        put(chrome, new THREE.CylinderGeometry(.13, .13, .4, 16), xNut, y - rs - .13, z, Math.PI / 2);
        box(dark, xR - .06, xR + .3, SLAB, y - rs - .24, z - .19, z + .19);
        put(chrome, new THREE.CylinderGeometry(.13, .13, .4, 16), xR, y - rs - .13, z, Math.PI / 2);
        const peg = new THREE.Vector3(xR + .34, y - .36, z);
        rod(bronze, new THREE.Vector3(xR, y - rs, z), peg, rs * .8);
        put(brass, new THREE.CylinderGeometry(.09, .09, .44, 12), peg.x, peg.y, z, Math.PI / 2);
        put(brass, new THREE.SphereGeometry(.07, 10, 8), peg.x, peg.y, z + .22);
        box(dark, xR + .24, xR + .44, SLAB, peg.y - .08, z - .1, z + .1);

        // RESONATOR box under the string, with a sound-slot that breathes with the ring
        const rTop = y - .72, rDepth = Math.min(.5, nearDz * .5);
        box(dark, xNut + .1, xR - .1, SLAB, rTop, z - rDepth / 2, z + rDepth / 2);
        const slotMat = new THREE.MeshStandardMaterial({ color: 0x06100e, emissive: new THREE.Color(SIG), emissiveIntensity: .03 });
        const slot = new THREE.Mesh(new THREE.BoxGeometry(Ls * .62, .02, .1), slotMat);
        slot.position.set(xNut + Ls / 2, rTop + .005, z); bed.add(slot);

        // THE STRING (+ its blur hull): vertex-shader contact V + standing wave
        const str = buildString(Ls, rs, u0, envMap);
        str.mesh.position.set(xNut + Ls / 2, y - rs, z); bed.add(str.mesh);
        str.hull.position.copy(str.mesh.position); bed.add(str.hull);

        // overhead: arm from the row's gantry spine to past the winch drum; rail hangs beside the column
        const sx = B.spineX[L.row], drumX = xb - side * DRUM_R;
        const armEnd = drumX - side * (DRUM_R * 1.35 + .08);
        box(dark, Math.min(sx, armEnd), Math.max(sx, armEnd), yTop, yTop + .18, z - .09, z + .09);
        box(dark, drumX - .06, drumX + .06, drumY, yTop, z - .26, z - .2);   // drum hanger (axle bracket)
        put(iron, new THREE.CylinderGeometry(.13, .13, .18, 14), drumX, drumY, z - .33, Math.PI / 2);   // motor
        const xRail = L.xRail, railBot = y + .9;
        put(chrome, new THREE.CylinderGeometry(.05, .05, yTop - railBot, 10), xRail, (yTop + railBot) / 2, z);
        put(dark, new THREE.CylinderGeometry(.09, .09, .06, 12), xRail, railBot, z);                   // end stop

        const drumG = new THREE.Group();
        drumG.position.set(drumX, drumY, z);
        drumG.add(new THREE.Mesh(drumGeo, brass), new THREE.Mesh(drumDark, dark));
        bed.add(drumG);

        // carriage: chrome pole + collar, dark housing + yoke, the amber coil at the face
        const car = new THREE.Group();
        const coilMat = new THREE.MeshStandardMaterial({ color: 0x331a10, emissive: new THREE.Color(COIL), emissiveIntensity: .15 });
        const coil = new THREE.Mesh(coilGeo, coilMat);
        const mhalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff7a3a, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false }));
        mhalo.scale.setScalar(1.3); mhalo.position.y = .02;
        car.add(new THREE.Mesh(carG[side].chrome, chrome), new THREE.Mesh(carG[side].dark, dark), coil, mhalo);
        bed.add(car);
        const cable = new THREE.Mesh(cableGeo, cableM); bed.add(cable);

        // the ball: HEAVY polished chrome; it only lights on the strike
        const ballMat = new THREE.MeshStandardMaterial({ color: 0xe4e8f0, metalness: 1, roughness: .07, envMap, envMapIntensity: 1.6,
          emissive: new THREE.Color(SIG), emissiveIntensity: 0 });
        const ball = new THREE.Mesh(ballGeo, ballMat);
        const bhalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: SIG_HOT, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false }));
        const ghosts = Array.from({ length: TRAIL_N }, () => {
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xbfd8ff, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false }));
          bed.add(s); return s;
        });
        bed.add(ball, bhalo);

        const pos = new THREE.Vector3(xb * scale, y * scale + bed.position.y, z * scale);
        lanes.push({ note, S, vel, Ls, y, z, xb, str, slotMat, car, coil, coilMat, mhalo, cable, drumG, ball, ballMat, bhalo,
                     ghosts, edge: makeEdge(.25), flash: 0, pos });
      }

      // gantry: one spine per row in use, along z, on two towers down to the plinth; glow strip on top
      for (const row of [0, 1]){
        const ls = nb.filter(l => l.row === row);
        if (!ls.length) continue;
        const sx = B.spineX[row], za = Math.min(...ls.map(l => l.z)) - .7, zb = Math.max(...ls.map(l => l.z)) + .7;
        box(chrome, sx - .13, sx + .13, yTop - .04, yTop + .22, za, zb);
        box(trim, sx - .03, sx + .03, yTop + .22, yTop + .26, za + .1, zb - .1);
        for (const tz of [za + .13, zb - .13]) box(dark, sx - .13, sx + .13, SLAB, yTop - .04, tz - .13, tz + .13);
      }

      for (const [mat, geos] of bucket){
        const m = new THREE.Mesh(mergeGeometries(geos), mat);
        geos.forEach(gg => gg.dispose());
        bed.add(m);
      }
      return group;
    }

    function update(songTime, P, dt, { started, skipStrikes, onStrike }){
      const t = started ? songTime : start;
      for (const ln of lanes){
        const p = poseAt(ln.S, t, start);
        const loud = Math.min(1, p.vIn / V_MAX);

        // strike edge — once per contact
        if (started && p.i >= 0 && ln.edge.check(p.abs, p.since, skipStrikes)){
          ln.flash = 1;
          const vel = ln.vel[p.i];
          onStrike && onStrike({ note: ln.note, vel, pos: ln.pos, color: SIG, dur: 0,
            shake: loud > .85 ? .04 : 0, sparks: Math.round(4 + 8 * loud), light: .9 + .8 * loud });
        }
        ln.flash *= Math.exp(-dt * 6);
        const fl = ln.flash * (.4 + .6 * loud);

        // ball (centre = underside + r)
        const by = ln.y + p.y + BALL_R;
        ln.ball.position.set(ln.xb, by, ln.z);
        ln.ballMat.emissiveIntensity = 1.4 * fl;
        ln.bhalo.position.set(ln.xb, ln.y + p.y * .5, ln.z);
        ln.bhalo.material.opacity = .55 * fl;
        ln.bhalo.scale.setScalar(BALL_R * (4 + 5 * (1 - ln.flash)));

        // string: contact V + ring; dark wound bronze at rest, light only while it rings
        const u = ln.str.u;
        u.uDef.value = p.def; u.uC1.value = p.c1; u.uC2.value = p.c2;
        const ringV = Math.min(1, p.ring * (.35 + .65 * loud));
        u.uGlow.value = .04 + 2.2 * ringV + 1.2 * fl;
        u.uEnv.value = p.mode === 'contact' ? 0 : (Math.abs(ln.S.A1[p.i] || 0) + Math.abs(ln.S.A2[p.i] || 0)) * .9 * p.ring;
        u.uOp.value = .45 * ringV + .2 * fl;
        ln.str.hull.visible = u.uOp.value > .01;

        ln.slotMat.emissiveIntensity = .03 + 3.5 * p.ring * loud + 1.2 * fl;

        // the coil cut: time since release (from the free-fall itself: y = h − ½g f²)
        const fRel = p.mode === 'fall' ? Math.sqrt(Math.max(0, 2 * (p.cy - p.y) / g)) : Infinity;

        // carriage (face at cy + 2r); an unloaded cable springs: a tiny recoil when the load is cut
        const recoil = isFinite(fRel) ? .035 * Math.exp(-fRel * 12) * Math.sin(fRel * 40) : 0;
        const face = ln.y + p.cy + 2 * BALL_R + recoil;
        ln.car.position.set(ln.xb, face, ln.z);
        const top = face + CAR_H;
        const len = Math.max(.01, drumYOf(ln) - top);
        ln.cable.scale.y = len; ln.cable.position.set(ln.xb, top + len / 2, ln.z);
        ln.drumG.rotation.z = len / DRUM_R;

        // coil: lit while it holds; CLACK bright on the catch; ICE discharge on release
        let on = 0;
        if (p.mode === 'hold' || p.mode === 'winch'){
          const docked = p.armed ? 9 : p.since - ln.S.catchT[p.i];
          on = 1 + 2.4 * Math.exp(-docked * 8);
        } else if (p.mode === 'rise'){
          on = Math.max(0, 1 - (ln.S.catchT[p.i] - p.since) / .12);
        }
        const dis = isFinite(fRel) ? Math.exp(-fRel * 22) : 0;
        _c.copy(_coil).lerp(_ice, Math.min(1, dis * 1.4));
        ln.coilMat.emissive.copy(_c);
        ln.coilMat.emissiveIntensity = .15 + 3.2 * on + 4 * dis;
        ln.mhalo.material.color.copy(_c);
        ln.mhalo.material.opacity = Math.min(1, .45 * on + .7 * dis);
        ln.mhalo.scale.setScalar(1.3 * (1 + .4 * Math.max(0, on - 1)) + 1.2 * dis);

        // ghost trail: the ball's own past, re-sampled from the pure fn
        const speed = Math.min(1, Math.abs(p.vy) / 6);
        ln.ghosts.forEach((s, j) => {
          const tj = t - (j + 1) * TRAIL_DT;
          if (!started || tj < start || speed < .1){ s.material.opacity = 0; return; }
          const q = poseAt(ln.S, tj, start);
          s.position.set(ln.xb, ln.y + q.y + BALL_R, ln.z);
          const f = 1 - (j + 1) / (TRAIL_N + 1);
          s.material.opacity = .22 * f * speed;
          s.scale.setScalar(BALL_R * 2.6 * (.5 + .5 * f));
        });
      }
    }
    const drumYOf = ln => ln.drumG.position.y;

    return { build, update };
  },

  /* A brooding E-minor line, 32 beats: heavy downbeats from full height (long gaps),
     pickup runs that climb across the tiers (dense), octave + fifth double-stops. */
  demo: {
    bpm: 96, beats: 32,
    scale: ['E', 'F#', 'G', 'A', 'B', 'C', 'D'],
    part: [
      [0, 'E1', 1],    [0, 'E2', .7],
      [2.5, 'E1', .5], [3, 'G1', .65], [3.5, 'A1', .75],
      [4, 'B1', .95],  [6, 'A1', .6],  [7, 'G1', .55],
      [8, 'E1', 1],    [10.5, 'B1', .55], [11, 'D2', .7], [11.5, 'E2', .85],
      [12, 'E1', .9],  [12, 'B1', .8],
      [16, 'A1', 1],   [18.5, 'A1', .45], [19, 'B1', .6], [19.5, 'D2', .72],
      [20, 'E2', .9],  [21, 'D2', .7],  [22, 'B1', .7], [23, 'A1', .75],
      [24, 'G1', 1],   [26, 'G1', .5],  [27, 'A1', .65], [27.5, 'B1', .8],
      [28, 'E1', 1],   [28, 'E2', .7],
      [31, 'D2', .4],  [31.5, 'B1', .5],
    ],
  },
};

/* ---- a STRING: a cylinder along x (many segments) displaced in the vertex shader:
   the contact V under the ball at u0 (wrapped round the ball's underside so the string
   never cuts into it), plus the standing wave c1·sin(πu) + c2·sin(2πu). Wound bronze
   (procedural windings, anti-aliased) that only turns to light while it rings.
   The HULL is the same string, fatter, additive: its vertices spread ±env·sin(πu) along
   the normal — the lens-shaped blur a fast-vibrating string shows to the eye. ---- */
function buildString(Ls, rs, u0, envMap){
  const geo = new THREE.CylinderGeometry(rs, rs, Ls, 14, 160, false);
  geo.rotateZ(-Math.PI / 2);                              // axis along +x, x ∈ [−L/2, L/2]
  const mat = new THREE.MeshStandardMaterial({ color: 0xb8865a, metalness: .85, roughness: .34, envMap,
    emissive: new THREE.Color(SIG), emissiveIntensity: 1 });
  const u = { uDef: { value: 0 }, uC1: { value: 0 }, uC2: { value: 0 }, uL: { value: Ls }, uR: { value: BALL_R },
              uU0: { value: u0 }, uGlow: { value: .04 }, uHot: { value: new THREE.Color(SIG_HOT) },
              uEnv: { value: 0 }, uOp: { value: 0 }, uCol: { value: new THREE.Color(SIG_HOT) } };
  const DISP = `
      float uu = clamp(position.x / uL + .5, 0., 1.);
      float xs = position.x - (uU0 - .5) * uL;
      float V = uDef * (uu <= uU0 ? uu / uU0 : (1. - uu) / (1. - uU0));
      float sb = abs(xs) < uR ? uDef + uR - sqrt(uR * uR - xs * xs) : 1e3;
      float d = uDef < 0. ? min(V, sb) : 0.;
      float w = uC1 * sin(3.14159265 * uu) + uC2 * sin(6.2831853 * uu);`;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'uniform float uDef, uC1, uC2, uL, uR, uU0;\nvarying float vAmp;\nvarying float vX;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      ${DISP}
      transformed.y += d + w;
      vX = position.x;
      vAmp = abs(w) * 6. + abs(d) * 2.;`);
    sh.fragmentShader = 'uniform float uGlow;\nuniform vec3 uHot;\nvarying float vAmp;\nvarying float vX;\n' + sh.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float kw = vX * 34.;
      float fw = fwidth(kw);
      float st = mix(.5 + .5 * sin(kw * 6.2831853), .5, clamp(fw * 1.6, 0., 1.));
      diffuseColor.rgb *= .55 + .6 * st;`).replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance = mix(totalEmissiveRadiance, uHot, clamp(vAmp, 0., 1.)) * (uGlow * (.5 + 1.8 * clamp(vAmp, 0., 1.)));`);
  };
  const hullGeo = new THREE.CylinderGeometry(rs * 1.08, rs * 1.08, Ls, 12, 120, false);
  hullGeo.rotateZ(-Math.PI / 2);
  const hullMat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uDef, uC1, uC2, uL, uR, uU0, uEnv;
      varying vec3 vN; varying vec3 vV; varying float vE;
      void main(){
        ${DISP}
        float e = sin(3.14159265 * uu);
        vec3 p = position;
        p.y += d + w + normal.y * uEnv * e;
        p.z += normal.z * uEnv * e * .35;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        vN = normalize(normalMatrix * normal); vV = -mv.xyz; vE = e;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uCol; uniform float uOp;
      varying vec3 vN; varying vec3 vV; varying float vE;
      void main(){
        float f = abs(dot(normalize(vN), normalize(vV)));
        gl_FragColor = vec4(uCol * uOp * f * f * f * vE, 1.);
      }`,
  });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.visible = false;
  return { mesh: new THREE.Mesh(geo, mat), hull, u };
}
