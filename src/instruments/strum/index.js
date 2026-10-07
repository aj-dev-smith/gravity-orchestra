import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeEdge } from '../clock.js';
import { prepPart, layoutStrings, solveStrum, pickAt, dockRest, stringAt, damperAt, lastSounding, firstPass,
         stringLength, stringRadius, isWound, feltFace, PART_LIMITS,
         R_TIP, H_TIP, S_PICK, S_DAMP, D_DOCK, V_HI, PULLEY_R, CAR_HW, PILLAR_OFF, PILLAR_R, PILLAR_RING } from './solve.js';
import { strumVoice } from './voice.js';
import { restEnv, anticip, sway } from '../idle.js';

/* ============================================================
   STRUM — the MARBLE AUTOHARP. A leaning rosewood harp: a fan of open
   strings (one per pitch, L ∝ f^−½ — the tall bronze basses at the
   brass pillar, the short steel trebles under the curling neck). Behind
   the strings, at the pick line, a chrome rail; on it a carriage pulled
   by a cable loop off a motor pulley, and on the carriage's telescoping
   arm a GOLD MARBLE — the plectrum. In front, at the felt line, a row of
   brass solenoids, one per string, each holding a crimson felt.

   Every strum the marble sweeps the WHOLE fan (an autoharp is played by
   strumming every string and letting the felts choose the chord): it
   drags each string round itself and lets it slip — the felted ones
   die at once, the open ones ring and glow gold. The chord is legible
   before it sounds: its felts lift a beat early. Down-strums on the
   beat, up-strums on the "and"; a long gap docks the marble on a magnet
   at the fan's edge, or — for another down-strum — the arm retracts and
   the carriage runs home behind the strings. All of it = solve.js as a
   pure function of songTime.

   IMPORTED PARTS (what this machine honestly supports — solve.js
   PART_LIMITS, exported for the orchestrator):
     · pitch E2–E6 (MIDI 40–88); outside folds by octaves
     · ≤ 24 strings (distinct pitches) — the rarest move to a kept
       string of the same pitch class, or drop
     · ≤ 6 notes per strum (onsets within 40 ms = one strum; outer
       voices kept, inner thinned evenly)
     · strums ≥ 0.2 s apart always fit (a small fan fits ~0.08 s; denser
       ones are dropped — a much louder one replaces the earlier)
     · ≤ 480 strums per loop (the most crowded are dropped first)
     · durations: a note rings until its felt lands at its end (dur), or
       until the chord changes (dur 0 = let ring); a note that outlasts
       the next strum is BRUSHED (re-plucked softly) as the marble passes
     · ids may carry a timbre: 'E3' steel, 'E3|n' nylon, 'E3|h' harp
   Nothing here throws on a bad part — it thins.
   ============================================================ */

const SIG   = 0xffae34;            // signature: warm marigold gold (bells are pale gold, drums orange)
const HOT   = 0xffe2a8;
const FELT  = 0xb0283a;
const COIL  = 0xff8a3d;
const TILT  = .26;                 // the harp leans back (rad)
const BOX_H = 1.05;                // soundbox height: the bridge sits on its top
const Z0    = .55;                 // string plane, at the bridge, toward the audience
const RAIL_N = -.66, BOARD_N = -1.08, DAMP_N = .66;
const MAXS  = 24;
const TRAIL_N = 6, TRAIL_DT = .006;
// IDLE (../idle.js): a plectrum resting on a dock SWAYS — the drive motor hunts a few cm either way
// on the magnet's soft hold, the cable and both pulleys turning with it (the carriage x feeds the
// whole drive train, so the cause is visible). The dock's coil charges before it kicks the next
// launch. The dock is D_DOCK (.75) clear of the fan; the sway is ±SWAY_A, zero within .2 s of the
// catch and the launch — every pass, every pluck is the solved pose.
const SWAY_A = .04, SWAY_HZ = .42;

export default {
  key: 'strum',
  label: 'Marble Autoharp',
  wet: true,
  lookHeight: 3.3,
  camera: { dist: 9.5, up: .9, x: 2.2 },
  color: '#ffae34',

  voice: id => strumVoice(id),
  PART_LIMITS,

  make({ envMap, glowTex }){
    let S = null, start = -Infinity, R = null;
    const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
    const _c = new THREE.Color();

    function build(part, { rollT, beat, P, start: s0 = -Infinity, station, floorY = -20 }){
      const group = new THREE.Group();
      start = s0; S = null; R = null;
      const W = station?.w ?? 12;
      let prep;
      try { prep = prepPart(part, { rollT, beat, P }); } catch (e){ console.warn('strum: bad part', e); return group; }
      if (!prep.ids.length) return group;
      const lay = layoutStrings(prep.ids, { W });
      S = solveStrum(prep, P, lay);
      if (S.stats.infeasible || prep.stats.dropped || prep.stats.thinned)
        console.info('strum: thinned', JSON.stringify({ ...prep.stats, ...S.stats }));
      const N = S.N, ids = S.ids, xs = S.xs, sc = lay.scale;
      const Ls = ids.map(stringLength), rs = ids.map(stringRadius);
      const x0 = xs[0], x1 = xs[N - 1];
      const railLo = S.E_lo - D_DOCK - CAR_HW - .25 - 2 * PULLEY_R, railHi = S.E_hi + D_DOCK + CAR_HW + .25 + 2 * PULLEY_R;

      // ---- materials (constant count) ----
      const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: .15, envMap, envMapIntensity: 1.3 });
      const dark   = new THREE.MeshStandardMaterial({ color: 0x232733, metalness: .7, roughness: .45, envMap });
      const brass  = new THREE.MeshStandardMaterial({ color: 0xc9a05a, metalness: 1, roughness: .24, envMap });
      const rose   = new THREE.MeshStandardMaterial({ color: 0x8a3c22, metalness: .15, roughness: .36, envMap, envMapIntensity: .8 });
      const roseD  = new THREE.MeshStandardMaterial({ color: 0x3a140a, metalness: .1, roughness: .5, envMap, envMapIntensity: .5 });
      const inlay  = new THREE.MeshStandardMaterial({ color: 0x2a1a08, emissive: new THREE.Color(SIG), emissiveIntensity: .55 });
      const feltM  = new THREE.MeshStandardMaterial({ color: FELT, roughness: .9, metalness: 0, emissive: new THREE.Color(0x40060c), emissiveIntensity: 1 });
      const cableM = new THREE.MeshStandardMaterial({ color: 0x9aa2b0, metalness: .9, roughness: .4 });

      const bucket = new Map();
      const put = (mat, geo, x = 0, y = 0, z = 0, rx = 0, rz = 0) => {
        if (rx) geo.rotateX(rx); if (rz) geo.rotateZ(rz);
        geo.translate(x, y, z);
        (bucket.get(mat) || bucket.set(mat, []).get(mat)).push(geo);
      };
      const box = (mat, xa, xb, ya, yb, za, zb) => put(mat, new THREE.BoxGeometry(xb - xa, yb - ya, zb - za), (xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2);

      // the BED (uniformly scaled if the fan is wider than the footprint) holds a soundbox and the leaning PLANE
      const bed = new THREE.Group(); bed.scale.setScalar(sc); group.add(bed);
      const plane = new THREE.Group(); plane.rotation.x = -TILT; plane.position.set(0, BOX_H, Z0); bed.add(plane);
      const pBucket = new Map();     // static parts in the plane's frame (x, s, n) → merged into the plane
      const pput = (mat, geo, x = 0, y = 0, z = 0, rx = 0, rz = 0) => {
        if (rx) geo.rotateX(rx); if (rz) geo.rotateZ(rz);
        geo.translate(x, y, z);
        (pBucket.get(mat) || pBucket.set(mat, []).get(mat)).push(geo);
      };
      const pbox = (mat, xa, xb, ya, yb, za, zb) => pput(mat, new THREE.BoxGeometry(xb - xa, yb - ya, zb - za), (xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2);
      const rodX = (mat, xa, xb, y, z, r, seg = 12) => pput(mat, new THREE.CylinderGeometry(r, r, xb - xa, seg), (xa + xb) / 2, y, z, 0, Math.PI / 2);

      // ---- SOUNDBOX (station frame) + legs to the floor ----
      const bxa = railLo - .25, bxb = railHi + .25;
      box(rose, bxa, bxb, 0, BOX_H, Z0 - 1.55, Z0 + .8);
      box(inlay, bxa + .05, bxb - .05, BOX_H - .06, BOX_H - .01, Z0 + .78, Z0 + .82);
      box(inlay, bxa + .05, bxb - .05, .1, .14, Z0 + .78, Z0 + .82);
      box(roseD, bxa + .3, bxb - .3, .22, BOX_H - .2, Z0 + .8, Z0 + .84);
      const legH = -floorY / sc;
      if (legH > .5) for (const lx of [bxa + .5, bxb - .5]) for (const lz of [Z0 - 1.25, Z0 + .65])
        box(dark, lx - .22, lx + .22, -legH, 0, lz - .22, lz + .22);

      // ---- the SOUNDBOARD behind the strings: its top edge follows the string tops ----
      {
        const sh = new THREE.Shape();
        sh.moveTo(railLo - .1, -.3);
        sh.lineTo(railHi + .1, -.3);
        sh.lineTo(railHi + .1, S_PICK + .55);
        const tops = xs.map((x, j) => new THREE.Vector2(x, Ls[j] + .05)).reverse();
        sh.lineTo(x1 + .5, Ls[N - 1] * .82);
        sh.splineThru([new THREE.Vector2(x1 + .2, Ls[N - 1] + .05), ...tops.slice(1, -1), new THREE.Vector2(x0 - .1, Ls[0] + .05)]);
        sh.lineTo(x0 - PILLAR_OFF, Ls[0] + .2);
        sh.lineTo(railLo - .1, S_PICK + .55);
        sh.closePath();
        // the ROSETTE soundhole, where the board is broad
        const hx = x0 + (x1 - x0) * .32, hy = Math.max(S_DAMP + .9, stringLength(ids[Math.round((N - 1) * .32)]) * .52), hr = Math.min(.55, .2 + (x1 - x0) * .05);
        const hole = new THREE.Path(); hole.absarc(hx, hy, hr, 0, Math.PI * 2, true); sh.holes.push(hole);
        const g = new THREE.ExtrudeGeometry(sh, { depth: .1, bevelEnabled: true, bevelThickness: .03, bevelSize: .03, bevelSegments: 2, curveSegments: 18 });
        pput(rose, g, 0, 0, BOARD_N - .05);
        const back = new THREE.CircleGeometry(hr * 1.02, 40); pput(roseD, back, hx, hy, BOARD_N - .1);
        R = { rosette: null };
        const rosM = new THREE.MeshStandardMaterial({ color: 0x2a1a08, emissive: new THREE.Color(SIG), emissiveIntensity: .4, metalness: .6, roughness: .3 });
        const ros = new THREE.Mesh(new THREE.TorusGeometry(hr + .06, .035, 10, 64), rosM);
        ros.position.set(hx, hy, BOARD_N + .08); plane.add(ros);
        const ros2 = new THREE.Mesh(new THREE.TorusGeometry(hr + .17, .02, 8, 64), rosM);
        ros2.position.copy(ros.position); plane.add(ros2);
        R.rosM = rosM;
      }

      // ---- bridge (bottom), neck (string tops), pillar, tuning pins ----
      pbox(brass, x0 - .35, x1 + .35, -.14, .02, -.09, .09);
      for (let j = 0; j < N; j++){
        pput(chrome, new THREE.SphereGeometry(.045, 10, 8), xs[j], .03, 0);
        pput(chrome, new THREE.CylinderGeometry(.04, .04, .32, 10), xs[j], Ls[j] + .05, -.05, Math.PI / 2);   // tuning pin
        pput(brass, new THREE.CylinderGeometry(.06, .06, .05, 12), xs[j], Ls[j] + .05, .12, Math.PI / 2);
      }
      {
        const pts = [new THREE.Vector3(x0 - PILLAR_OFF, Ls[0] + .2, 0), ...xs.map((x, j) => new THREE.Vector3(x, Ls[j] + .05, 0)),
                     new THREE.Vector3(x1 + .45, Ls[N - 1] - .05, 0), new THREE.Vector3(x1 + .62, Ls[N - 1] - .45, 0)];
        const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
        pput(brass, new THREE.TubeGeometry(curve, 24 + 6 * N, .1, 10, false));
        const cap = new THREE.SphereGeometry(.16, 16, 12); pput(brass, cap, x1 + .62, Ls[N - 1] - .45, 0);
        // the pillar: from the soundbox up to the neck's head, fluted chrome with brass rings
        const px = x0 - PILLAR_OFF, ph = Ls[0] + .2;   // beyond the bass dock: the marble's run never reaches it
        pput(chrome, new THREE.CylinderGeometry(PILLAR_R * .8, PILLAR_R, ph + .3, 16), px, ph / 2 - .15, 0);
        for (const f of [.08, .5, .92]) pput(brass, new THREE.TorusGeometry(PILLAR_RING - .035, .035, 8, 24), px, ph * f, 0, Math.PI / 2);
        pput(brass, new THREE.SphereGeometry(.22, 18, 14), px, ph + .12, 0);
      }

      // ---- the RAIL behind the strings, docks, pulleys, the drive motor ----
      rodX(chrome, railLo, railHi, S_PICK, RAIL_N, .045);
      rodX(chrome, railLo, railHi, S_PICK - .22, RAIL_N - .05, .03);
      for (const xe of [railLo, railHi]) pbox(dark, xe - .1, xe + .1, S_PICK - .45, S_PICK + .45, BOARD_N + .02, RAIL_N + .12);
      const dockX = [S.E_lo - D_DOCK - CAR_HW - .05, S.E_hi + D_DOCK + CAR_HW + .05];
      const dockMats = dockX.map(() => new THREE.MeshStandardMaterial({ color: 0x331a10, emissive: new THREE.Color(COIL), emissiveIntensity: .2 }));
      dockX.forEach((dx, i) => {
        const coil = new THREE.Mesh(new THREE.CylinderGeometry(.17, .17, .1, 20), dockMats[i]);
        coil.rotation.z = Math.PI / 2; coil.position.set(dx, S_PICK, RAIL_N); plane.add(coil);
        pbox(dark, dx - (i ? -.05 : .05) - .06, dx - (i ? -.05 : .05) + .06, S_PICK - .25, S_PICK + .25, RAIL_N - .25, RAIL_N + .2);
      });
      const pulX = [railLo + PULLEY_R + .12, railHi - PULLEY_R - .12];
      const pulleys = pulX.map(px => {
        const pg = new THREE.Group(); pg.position.set(px, S_PICK, RAIL_N - .18);
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(PULLEY_R, PULLEY_R, .08, 24), brass); rim.rotation.x = Math.PI / 2;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(PULLEY_R * 1.9, .05, .1), dark);
        const spoke2 = spoke.clone(); spoke2.rotation.z = Math.PI / 2;
        pg.add(rim, spoke, spoke2); plane.add(pg);
        return pg;
      });
      pput(dark, new THREE.CylinderGeometry(.24, .24, .32, 18), pulX[0], S_PICK, RAIL_N - .42, Math.PI / 2);   // the motor
      const motorM = new THREE.MeshStandardMaterial({ color: 0x331a10, emissive: new THREE.Color(COIL), emissiveIntensity: .2 });
      const motorRing = new THREE.Mesh(new THREE.TorusGeometry(.245, .025, 8, 28), motorM);
      motorRing.position.set(pulX[0], S_PICK, RAIL_N - .3); plane.add(motorRing);
      // the cable loop: the lower run is fixed; the upper run is two spans to the carriage
      const cY = S_PICK + PULLEY_R, cZ = RAIL_N - .18;
      rodX(cableM, pulX[0], pulX[1], S_PICK - PULLEY_R, cZ, .012, 6);
      const cableGeo = new THREE.CylinderGeometry(.012, .012, 1, 6); cableGeo.rotateZ(Math.PI / 2);
      const cabA = new THREE.Mesh(cableGeo, cableM), cabB = new THREE.Mesh(cableGeo, cableM);
      plane.add(cabA, cabB);

      // ---- the CARRIAGE + telescoping arm + the GOLD MARBLE ----
      const car = new THREE.Group(); plane.add(car);
      {
        const body = new THREE.Mesh(new THREE.BoxGeometry(2 * CAR_HW, .42, .3), dark); body.position.set(0, 0, RAIL_N - .06);
        const shoe = new THREE.Mesh(new THREE.BoxGeometry(2 * CAR_HW - .08, .12, .2), chrome); shoe.position.set(0, cY - S_PICK - .02, cZ);
        // the arm's collar: a short sleeve proud of the body — the retracted marble stops just in front of it
        const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(.085, .085, .07, 16), chrome); sleeve.rotation.x = Math.PI / 2; sleeve.position.set(0, 0, RAIL_N + .065);
        car.add(body, shoe, sleeve);
      }
      const armGeo = new THREE.CylinderGeometry(.035, .035, 1, 10); armGeo.rotateX(Math.PI / 2);
      const arm = new THREE.Mesh(armGeo, chrome); plane.add(arm);
      const marbleM = new THREE.MeshStandardMaterial({ color: 0xffd38a, metalness: .9, roughness: .12, envMap, envMapIntensity: 1.4,
        emissive: new THREE.Color(SIG), emissiveIntensity: .6 });
      const marble = new THREE.Mesh(new THREE.SphereGeometry(R_TIP, 32, 22), marbleM); plane.add(marble);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: SIG, transparent: true, opacity: .5,
        blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.scale.setScalar(.9); plane.add(halo);
      const ghosts = Array.from({ length: TRAIL_N }, () => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: HOT, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false }));
        plane.add(s); return s;
      });

      // ---- THE STRINGS: one merged mesh, displaced per string in the vertex shader ----
      const strings = buildStrings(S, Ls, rs, envMap);
      plane.add(strings.mesh, strings.hull);

      // ---- FELT DAMPERS: a solenoid per string on a front rail; the felt rides the plunger ----
      const railY = S_DAMP + .42;
      rodX(dark, x0 - .45, x1 + .45, railY, DAMP_N + .05, .06);
      for (const xe of [x0 - .5, x1 + .5]) pbox(dark, xe - .07, xe + .07, -.02, railY + .06, DAMP_N - .05, DAMP_N + .15);
      for (let j = 0; j < N; j++){
        pput(brass, new THREE.CylinderGeometry(.075, .075, .26, 14), xs[j], S_DAMP, DAMP_N - .08, Math.PI / 2);   // coil can
        pbox(dark, xs[j] - .03, xs[j] + .03, S_DAMP + .05, railY, DAMP_N - .02, DAMP_N + .04);                  // hanger
      }
      const feltGeo = new THREE.BoxGeometry(.26, .36, .09); feltGeo.translate(0, 0, .045);
      const felts = new THREE.InstancedMesh(feltGeo, feltM, N);
      const plGeo = new THREE.CylinderGeometry(.025, .025, .42, 8); plGeo.rotateX(Math.PI / 2); plGeo.translate(0, 0, .09 + .21);
      const plungers = new THREE.InstancedMesh(plGeo, chrome, N);
      const ringGeo = new THREE.TorusGeometry(.082, .018, 6, 20);
      const ringM = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true });
      const rings = new THREE.InstancedMesh(ringGeo, ringM, N);
      rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3 * N), 3);
      for (const m of [felts, plungers, rings]){ m.userData.noMerge = true; m.frustumCulled = false; plane.add(m); }
      for (let j = 0; j < N; j++){
        _m.compose(_v.set(xs[j], S_DAMP, DAMP_N + .055), _q.identity(), _s.set(1, 1, 1));
        rings.setMatrixAt(j, _m);
      }

      for (const [mat, geos] of bucket){ const m = new THREE.Mesh(mergeGeometries(geos), mat); geos.forEach(g => g.dispose()); bed.add(m); }
      for (const [mat, geos] of pBucket){ const m = new THREE.Mesh(mergeGeometries(geos), mat); geos.forEach(g => g.dispose()); plane.add(m); }

      plane.updateMatrix(); bed.updateMatrix();
      const toLocal = new THREE.Matrix4().multiplyMatrices(bed.matrix, plane.matrix);
      Object.assign(R, { N, xs, rs, Ls, car, arm, marble, marbleM, halo, ghosts, strings, felts, plungers, rings, cabA, cabB, cY, cZ, pulX,
                         pulleys, dockMats, dockX, motorM, toLocal, edges: ids.map(() => makeEdge(.25)), flash: ids.map(() => 0),
                         lastJ: S.passes.map(p => { let L = -1; for (let j = 0; j < N; j++) if (S.strings[j].cr[p.k].sigma && (L < 0 || p.d > 0)) L = j; return L; }) });
      return group;
    }

    function update(songTime, P, dt, { started, skipStrikes, onStrike }){
      if (!S || !R || !S.K) return;
      const t = started ? songTime : start;
      const q = pickAt(S, t, start);
      const speed = Math.min(1, Math.abs(q.vx) / V_HI);
      const dr = dockRest(S, t, start);
      const rest = dr ? restEnv(dr.since, dr.until, .2, .6) : 0;
      const qx = q.x + (rest ? SWAY_A * rest * sway(t, SWAY_HZ) : 0);   // the rendered carriage x (idle sway on the dock)

      // ---- strikes: every open string the marble lets go of ----
      let total = 0;
      for (let j = 0; j < R.N; j++){
        if (!started) break;
        const h = lastSounding(S, j, t, start);
        if (!h || !R.edges[j].check(h.abs, h.since, skipStrikes)) continue;
        const c = h.c, p = S.passes[c.k], first = j === (p.d > 0 ? p.lo : p.hi);
        R.flash[j] = 1;
        // main's strike-light pool is 4 deep and EVERY onStrike takes a slot: a 6-string strum would
        // overwrite its own big flash within a few ms — so the strum's light rides its LAST string
        onStrike && onStrike({ note: S.ids[j], vel: c.vel, pos: _v.set(R.xs[j], S_PICK, 0).applyMatrix4(R.toLocal).clone(),
          color: SIG, dur: Math.min(c.dur, 3), shake: 0, sparks: c.brush ? 0 : first ? 4 : 1, light: j === R.lastJ[c.k] ? .9 + .3 * p.vel : .12 });
      }

      // ---- strings ----
      const U = R.strings.u;
      for (let j = 0; j < R.N; j++){
        const s = stringAt(S, j, t, start);
        R.flash[j] *= Math.exp(-dt * 9);
        const o = U.uS.value[j];
        o.set(s.dx, s.dn, s.b, s.uTop);
        const gl = s.glow + .8 * R.flash[j] * (s.c && s.c.sigma ? 1 : 0);
        U.uE.value[j].set(gl, Math.min(1, Math.abs(s.dx) / .09) * (s.c && s.c.sigma ? 1 : .25));
        total += s.glow;

        // the felt rides its plunger; the solenoid ring glows while it holds the felt OPEN
        const th = damperAt(S, j, t, start);
        const fz = R.rs[j] + feltFace(th);
        _m.compose(_v.set(R.xs[j], S_DAMP, fz), _q.identity(), _s.set(1, 1, 1));
        R.felts.setMatrixAt(j, _m); R.plungers.setMatrixAt(j, _m);
        _c.setHex(SIG).multiplyScalar(.15 + 2.2 * th);
        R.rings.setColorAt(j, _c);
      }
      R.felts.instanceMatrix.needsUpdate = true; R.plungers.instanceMatrix.needsUpdate = true; R.rings.instanceColor.needsUpdate = true;
      R.rosM.emissiveIntensity = .35 + 1.1 * Math.min(1, total / 3);

      // ---- the plectrum ----
      R.car.position.set(qx, S_PICK, 0);
      const back = RAIL_N + .1, front = q.n - R_TIP + .02;
      R.arm.scale.set(1, 1, Math.max(.02, front - back)); R.arm.position.set(qx, S_PICK, (front + back) / 2);
      R.marble.position.set(qx, S_PICK, q.n);
      R.marbleM.emissiveIntensity = .6 + 2.2 * speed;
      R.halo.position.set(qx, S_PICK, q.n + .05);
      R.halo.material.opacity = .35 + .45 * speed;
      R.halo.scale.setScalar(.75 + .6 * speed);
      R.ghosts.forEach((g, i) => {
        const tj = t - (i + 1) * TRAIL_DT;
        if (!started || tj < start || speed < .08){ g.material.opacity = 0; return; }
        const qq = pickAt(S, tj, start);
        g.position.set(qq.x, S_PICK, qq.n);
        const f = 1 - (i + 1) / (TRAIL_N + 1);
        g.material.opacity = .45 * f * speed;
        g.scale.setScalar(R_TIP * (3 + 2 * f));
      });
      // the drive: the cable's upper run is fixed to the carriage → pulleys turn by x / r (no slip)
      for (const pg of R.pulleys) pg.rotation.z = -qx / PULLEY_R;
      const ca = R.pulX[0], cb = R.pulX[1], xa = qx - CAR_HW + .04, xb = qx + CAR_HW - .04;
      R.cabA.scale.set(Math.max(.01, xa - ca), 1, 1); R.cabA.position.set((ca + xa) / 2, R.cY, R.cZ);
      R.cabB.scale.set(Math.max(.01, cb - xb), 1, 1); R.cabB.position.set((xb + cb) / 2, R.cY, R.cZ);
      R.motorM.emissiveIntensity = .2 + 2.6 * speed + (rest ? .6 * rest * Math.abs(Math.cos(2 * Math.PI * SWAY_HZ * t)) : 0);   // (it drives the sway)
      // the docks: lit while they hold the carriage (parked, retract/travel ends, armed)
      const parked = q.mode === 'dock' || q.mode === 'armed' || q.mode === 'retract' || q.mode === 'engage';
      R.dockMats.forEach((m, i) => {
        const near = Math.abs(q.x - (i ? S.E_hi + D_DOCK : S.E_lo - D_DOCK)) < .02;
        m.emissiveIntensity = .2 + (parked && near ? 2.8 + 1.4 * (dr ? anticip(dr.until, .8) : 0) : 0);
      });
    }

    return { build, update };
  },

  /* A folk strum, 32 beats at 96 bpm in G: four bars of the guitarist's
     "D D U U D U" through G – Em – C – D (the felts lift a beat early, the
     marble docks on the long gaps and runs home for the repeated downs),
     then three bars of fingerpicked arpeggios that LET RING (single strings
     under open felts — the brushed ring-through), and a last bar of D with
     a big let-ring G roll to turn the loop. */
  demo: (() => {
    const G = ['G2', 'B2', 'D3', 'G3', 'B3', 'G4'], Em = ['E2', 'B2', 'E3', 'G3', 'B3', 'E4'],
          C = ['C3', 'E3', 'G3', 'C4', 'E4'], D = ['D3', 'A3', 'D4', 'F#4'];
    const part = [];
    const pat = [[0, 1], [1, .78], [1.5, .55], [2.5, .6], [3, .86], [3.5, .62]];
    [G, Em, C, D].forEach((ch, bar) => pat.forEach(([b, v]) => ch.forEach(n => part.push([bar * 4 + b, n, v]))));
    // fingerpicking: bass, then up the chord, 8ths, each note held 1.5 beats
    const arp = [[G, ['G2', 'D3', 'G3', 'B3', 'D4', 'B3', 'G3', 'D3']], [Em, ['E2', 'B2', 'E3', 'G3', 'B3', 'G3', 'E3', 'B2']],
                 [C, ['C3', 'G3', 'C4', 'E4', 'G4', 'E4', 'C4', 'G3']]];
    arp.forEach(([, line], k) => line.forEach((n, i) => part.push([16 + 4 * k + i * .5, n, i ? .55 + .1 * (i % 2) : .9, 1.5])));
    [[28, 1], [29, .75], [29.5, .55], [30, .7]].forEach(([b, v]) => D.forEach(n => part.push([b, n, v])));
    G.forEach((n, i) => part.push([31, n, .95, 2]));
    return { bpm: 96, beats: 32, scale: ['G', 'A', 'B', 'C', 'D', 'E', 'F#'], part };
  })(),
};

/* ---- THE STRINGS: every string in ONE mesh (aStr = its index, aU = 0..1 up from the bridge,
   aUp = its pick point). Per string, uS = (dx, dn, blend, uTop) and uE = (glow, hull): the
   vertex shader bends each string into the plucked V (bridge → pick → node) blending into
   its fundamental — the same shape as solve.js shapeAt. Bronze-wound basses, steel trebles;
   an OPEN string glows marigold while it rings. The HULL is the same strings, fatter and
   additive: the blur of a string vibrating faster than the eye. ---- */
function buildStrings(S, Ls, rs, envMap){
  const geos = [], hulls = [];
  for (let j = 0; j < S.N; j++){
    for (const [arr, rad, seg] of [[geos, rs[j], 8], [hulls, rs[j] * 3.2, 6]]){
      const g = new THREE.CylinderGeometry(rad, rad, Ls[j], seg, 48, true);
      g.translate(S.xs[j], Ls[j] / 2, 0);
      const n = g.attributes.position.count, aS = new Float32Array(n), aU = new Float32Array(n), aUp = new Float32Array(n), col = new Float32Array(3 * n);
      const wound = isWound(S.ids[j]), c = new THREE.Color(wound ? 0xb98a56 : 0xdfe4ee);
      for (let i = 0; i < n; i++){
        aS[i] = j; aU[i] = Math.min(1, Math.max(0, g.attributes.position.getY(i) / Ls[j])); aUp[i] = S.up[j];
        col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b;
      }
      g.setAttribute('aStr', new THREE.BufferAttribute(aS, 1));
      g.setAttribute('aU', new THREE.BufferAttribute(aU, 1));
      g.setAttribute('aUp', new THREE.BufferAttribute(aUp, 1));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      arr.push(g);
    }
  }
  const u = { uS: { value: Array.from({ length: MAXS }, () => new THREE.Vector4(0, 0, 0, 1)) },
              uE: { value: Array.from({ length: MAXS }, () => new THREE.Vector2(0, 0)) },
              uSig: { value: new THREE.Color(SIG) }, uHot: { value: new THREE.Color(HOT) } };
  const DISP = `
      int sj = int(aStr + .5);
      vec4 st = uS[sj];
      float uu = aU, up = aUp, ut = st.w, sh = 0.;
      if (uu > 0. && uu < ut){
        float V = uu <= up ? uu / up : (ut - uu) / (ut - up);
        float q = up / ut, k1 = 2. * sin(3.14159265 * q) / (9.8696044 * q * (1. - q));
        sh = mix(V, k1 * sin(3.14159265 * uu / ut), st.z);
      }
      vec2 eg = uE[sj];`;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: .9, roughness: .3, envMap,
    emissive: new THREE.Color(SIG), emissiveIntensity: 1 });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = `uniform vec4 uS[${MAXS}];\nuniform vec2 uE[${MAXS}];\nattribute float aStr;\nattribute float aU;\nattribute float aUp;\nvarying float vGlow;\nvarying float vWave;\n` +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      ${DISP}
      transformed.x += st.x * sh; transformed.z += st.y * sh;
      vGlow = eg.x; vWave = abs(sh);`);
    sh.fragmentShader = 'uniform vec3 uSig;\nuniform vec3 uHot;\nvarying float vGlow;\nvarying float vWave;\n' + sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance = mix(uSig, uHot, clamp(vGlow * vWave, 0., 1.)) * (.02 + 2.4 * vGlow * (.55 + .45 * vWave));`);
  };
  const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
  geos.forEach(g => g.dispose());
  const hullMat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform vec4 uS[${MAXS}]; uniform vec2 uE[${MAXS}];
      attribute float aStr; attribute float aU; attribute float aUp;
      varying float vA; varying vec3 vN; varying vec3 vV;
      void main(){
        ${DISP}
        vec3 p = position;
        p.x += st.x * sh * .5 + normal.x * abs(st.x) * sh * .6;
        p.z += st.y * sh;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        vN = normalize(normalMatrix * normal); vV = -mv.xyz;
        vA = (eg.x * .5 + eg.y) * sin(3.14159265 * uu);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uSig; varying float vA; varying vec3 vN; varying vec3 vV;
      void main(){
        float f = abs(dot(normalize(vN), normalize(vV)));
        gl_FragColor = vec4(uSig * vA * f * f * .9, 1.);
      }`,
  });
  const hull = new THREE.Mesh(mergeGeometries(hulls), hullMat);
  hulls.forEach(g => g.dispose());
  for (const m of [mesh, hull]){ m.frustumCulled = false; }
  return { mesh, hull, u };
}
