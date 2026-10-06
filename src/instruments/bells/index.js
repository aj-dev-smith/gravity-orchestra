import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { eventTimes, lanesByNote, makeEdge } from '../clock.js';
import { noteHz, noteNum } from '../../engine.js';
import { bellLane, bellAt, ballYZ, layoutBells, glowAmp, ROD, BALL_R, TUBE_R, HANG, STRIKE_DEPTH, PIVOT, FORK_X, SLAB_HW,
         SHIVER_A, SHIVER_F, SHIVER_D } from './solve.js';
import { bellVoice } from './voice.js';

/* ============================================================
   TUBULAR BELLS — a cathedral gantry of hanging chime tubes (length
   ∝ f^-1/2, real chime scaling: the bass tube is twice the treble's),
   each with its OWN pendulum striker: a heavy chrome marble on a rod,
   pivoting on the front axle beam. A motorised fork with an
   electromagnet shoe holds the marble back; the coil cuts and the
   marble swings down under real gravity (the exact large-amplitude
   pendulum — Jacobi elliptic fns) to strike the tube at the bottom of
   its arc ON the beat. It bounces back lossy (e = .6); the shoe has
   followed it down and kisses it at the rebound apex at zero speed,
   latches, and the motor winds it back up — the visible energy supply.
   Dense repeats: the shoe catches it on the fly and throws it. The
   struck tube swings on its cord, its glow pulses down the tube and
   rings out in standing-wave bands. All motion = solve.js bellAt(t).
   ============================================================ */

const GOLD     = 0xffc86a;           // signature: cathedral gold bell-light
const GOLD_HOT = 0xfff0c8;
const COIL     = 0x6fd0ff;           // the motors + magnets speak ice-blue energy
const TRAIL_N  = 4, TRAIL_DT = .03;
const PULSE_V  = 11;                 // u/s — the light-pulse racing down a struck tube (shader + foot flare)
const Z_T      = -1.25;              // tube axis depth (strikers swing out toward +z)
const Y_TOP    = 10.8;               // every tube's top cap (tops align; bottoms stair-step)
const L_C4     = 7.0;                // C4 tube length; L ∝ f^-1/2
const SHOE_T   = .055;               // magnet puck half-thickness
const DELTA    = (BALL_R + SHOE_T) / ROD;   // shoe angle ahead of the marble when touching
const SLAB     = .5;                 // deck slab thickness

export const tubeLen = note => Math.max(3, Math.min(11.5, L_C4 * Math.pow(noteHz(note) / 261.626, -.5)));

export default {
  key: 'bells',
  label: 'Tubular Bells',
  wet: true,
  lookHeight: 8.4,
  camera: { dist: 14, up: 6 },      // up + back: the whole gantry, no empty floor in the lower third
  color: '#ffc86a',                 // cathedral gold

  voice: id => bellVoice(id),

  make({ envMap, glowTex }){
    let lanes = [], start = -Infinity;

    function build(part, { rollT, beat, P, start: s0 = -Infinity, station, floorY = -20 }){
      const group = new THREE.Group();
      lanes = []; start = s0;
      const W = station?.w ?? 11, D = station?.d ?? 7;
      const ev = eventTimes(part, { rollT, beat });
      const byNote = lanesByNote(ev);
      const notes = Object.keys(byNote).sort((a, b) => noteNum(a) - noteNum(b));
      const n = notes.length;
      if (!n) return group;

      // ---- materials (constant count after build) ----
      const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: .14, envMap, envMapIntensity: 1.3 });
      const dark   = new THREE.MeshStandardMaterial({ color: 0x2a2f3d, metalness: .7, roughness: .42, envMap });
      const iron   = new THREE.MeshStandardMaterial({ color: 0x171a23, metalness: .8, roughness: .35, envMap });
      const trim   = new THREE.MeshStandardMaterial({ color: 0x2a1c08, emissive: new THREE.Color(GOLD), emissiveIntensity: .8 });
      const cordM  = new THREE.MeshStandardMaterial({ color: 0x9a8c78, metalness: .2, roughness: .7 });
      const ballGeo = new THREE.SphereGeometry(BALL_R, 32, 24);

      // ---- layout (solve.js: lanes live in slabs ≥ PLANE_MIN apart, so they can never touch) ----
      const Lo = layoutBells(n, W), TX = Lo.TX, SP = Lo.SP, x0 = Lo.x0, YAW = Lo.yaw;
      const SDX = Math.sin(YAW), SDZ = Math.cos(YAW);
      const yC = Y_TOP - STRIKE_DEPTH;                   // every strike happens at this height
      const yHang = Y_TOP + HANG;                        // hanger rail
      const yAxle = yC + PIVOT.y;                        // every striker's pivot height
      const zAxle = Z_T + PIVOT.z * SDZ;                 // (pivots sit out along the swing direction)
      const yRail = yAxle + .7;                          // the striker rail every yoke hangs from
      const yYoke = yAxle + .42;                         // the yoke's crossbar
      const yCrown = yRail + .25;

      const fz = m => { m.userData.frozen = true; return m; };   // static → merged by freeze()
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const bar = (a, b, r, mat, parent = group) => {    // a cylinder from point a to point b
        const d = new THREE.Vector3().subVectors(b, a), len = d.length();
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
        m.position.copy(a).addScaledVector(d, .5);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        return fz(m), parent.add(m), m;
      };
      const box = (w, h, d, x, y, z, mat, parent = group) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return fz(m), parent.add(m), m;
      };

      // ---- the plinth: a deck slab with a gold lip, legs to the room floor ----
      box(W - .3, SLAB, D - .3, 0, SLAB / 2, 0, iron);
      for (const [w, d, x, z] of [[W - .2, .05, 0, (D - .2) / 2], [W - .2, .05, 0, -(D - .2) / 2],
                                  [.05, D - .2, (W - .2) / 2, 0], [.05, D - .2, -(W - .2) / 2, 0]])
        box(w, .06, d, x, SLAB + .01, z, trim);          // a glowing edge, not a sheet
      const legH = -floorY;
      if (legH > .6) for (const sx of [-1, 1]) for (const sz of [-1, 1]){
        box(.7, legH, .7, sx * (W / 2 - .8), -legH / 2, sz * (D / 2 - .8), dark);
        box(.74, .05, .74, sx * (W / 2 - .8), -.5, sz * (D / 2 - .8), trim);
      }

      // ---- the gantry: two towers (front + back posts, braced, gold-edged), the hanger rail,
      //      the striker rail, and a pointed cathedral arch over the top ----
      const zB = Z_T - 1.1;
      const zF = Math.min(D / 2 - .4, Z_T + PIVOT.z * SDZ + (ROD + .25) * SDZ + .35);   // front posts clear the swing
      for (const sx of [-1, 1]){
        const x = sx * TX;
        for (const zz of [zB, zF]){
          bar(V(x, SLAB, zz), V(x, yCrown, zz), .13, dark);
          // the gold edge strips: what makes the towers read from across the room
          for (const ex of [-1, 1]) bar(V(x + ex * .16, SLAB + .1, zz + (zz === zF ? .1 : -.1)), V(x + ex * .16, yCrown, zz + (zz === zF ? .1 : -.1)), .022, trim);
        }
        for (const yy of [SLAB + .3, yCrown]) bar(V(x, yy, zB), V(x, yy, zF), .1, dark);
        const segs = 5, h0 = SLAB + .3, h1 = yCrown;     // X bracing up the tower (reads as a real truss)
        for (let k = 0; k < segs; k++){
          const ya = h0 + (h1 - h0) * k / segs, yb = h0 + (h1 - h0) * (k + 1) / segs;
          bar(V(x, ya, zB), V(x, yb, zF), .05, chrome);
          bar(V(x, ya, zF), V(x, yb, zB), .05, chrome);
          bar(V(x, yb, zB), V(x, yb, zF), .04, dark);
        }
        box(.8, .16, zF - zB + .7, x, SLAB + .08, (zB + zF) / 2, dark);
      }
      bar(V(-TX, yHang, Z_T), V(TX, yHang, Z_T), .09, dark);       // hanger rail (every cord hangs here)
      bar(V(-TX, yHang + .11, Z_T + .06), V(TX, yHang + .11, Z_T + .06), .02, trim);
      bar(V(-TX, yHang, Z_T), V(-TX, yHang, zB), .07, dark);
      bar(V(TX, yHang, Z_T), V(TX, yHang, zB), .07, dark);
      bar(V(-TX, yRail, zAxle), V(TX, yRail, zAxle), .08, chrome);  // the striker rail
      bar(V(-TX, yRail + .1, zAxle + .05), V(TX, yRail + .1, zAxle + .05), .02, trim);
      bar(V(-TX, yRail, zAxle), V(-TX, yRail, zF), .07, dark);
      bar(V(TX, yRail, zAxle), V(TX, yRail, zF), .07, dark);
      bar(V(-TX, yCrown, zB), V(TX, yCrown, zB), .1, dark);         // crown ties
      bar(V(-TX, yCrown, zF), V(TX, yCrown, zF), .1, dark);
      bar(V(-TX, yCrown - .14, zF + .1), V(TX, yCrown - .14, zF + .1), .022, trim);
      // the pointed arch — a gothic crown that frames the whole instrument
      const peak = yCrown + 2.6;
      for (const zz of [zB, zF]){
        for (const sx of [-1, 1]){
          const c = new THREE.QuadraticBezierCurve3(V(sx * TX, yCrown, zz), V(sx * TX * .8, peak - .5, zz), V(0, peak, zz));
          fz(group.add(new THREE.Mesh(new THREE.TubeGeometry(c, 24, .09, 8), chrome)).children.at(-1));
          const glow = new THREE.Mesh(new THREE.TubeGeometry(c, 24, .03, 6), trim);
          glow.position.z = zz === zF ? .1 : -.1; fz(glow); group.add(glow);
        }
      }
      bar(V(0, peak, zB), V(0, peak, zF), .08, chrome);
      bar(V(0, yCrown, (zB + zF) / 2), V(0, peak, (zB + zF) / 2), .045, dark);
      const finial = new THREE.Mesh(new THREE.SphereGeometry(.22, 20, 14), chrome);
      finial.position.set(0, peak + .2, (zB + zF) / 2); fz(finial); group.add(finial);

      // ---- shared lane geometry (every swinging part stays inside the lane's ±SLAB_HW slab) ----
      const rodHubGeo = mergeGeometries([
        new THREE.CylinderGeometry(.035, .035, ROD - BALL_R + .02, 10).translate(0, -(ROD - BALL_R) / 2, 0),
        new THREE.CylinderGeometry(.13, .13, .12, 20).rotateZ(Math.PI / 2),
      ]);
      const ARM = ROD + SHOE_T + .02;
      const forkGeo = mergeGeometries([
        ...[-1, 1].map(sx => new THREE.CylinderGeometry(.035, .035, ARM, 8).translate(sx * FORK_X, -ARM / 2, 0)),
        new THREE.CylinderGeometry(.045, .045, 2 * FORK_X + .04, 10).rotateZ(Math.PI / 2).translate(0, -ROD, SHOE_T + .05),
        ...[-1, 1].map(sx => new THREE.CylinderGeometry(.07, .07, FORK_X - .03, 14).rotateZ(Math.PI / 2)
          .translate(sx * (FORK_X + .1) / 2, 0, 0)),                                           // the fork's sleeves on the axle
      ]);
      const puckGeo = new THREE.CylinderGeometry(.15, .15, 2 * SHOE_T, 20).rotateX(Math.PI / 2);
      const coilGeo = new THREE.TorusGeometry(.165, .032, 8, 24);
      const ringGeo = new THREE.TorusGeometry(.17, .022, 6, 28).rotateY(Math.PI / 2);
      const capEyeGeo = mergeGeometries([
        new THREE.CylinderGeometry(TUBE_R * 1.12, TUBE_R * 1.12, .16, 24).translate(0, -HANG - .07, 0),
        new THREE.TorusGeometry(.06, .018, 6, 12),
      ]);
      const cordGeo = mergeGeometries([-1, 1].map(sx => {
        const d = V(sx * TUBE_R * .95, -HANG - .02, 0), l = d.length();
        const gg = new THREE.CylinderGeometry(.012, .012, l, 4);
        gg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize()));
        return gg.translate(d.x / 2, d.y / 2, 0);
      }));
      const poolGeo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
      const add = (m, p) => (p.add(m), m);
      const glowSprite = (color, parent) => add(new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true,
        opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })), parent);

      notes.forEach((note, k) => {
        const len = tubeLen(note);
        const evs = byNote[note];
        const lane = bellLane(evs.map(e => e.t), evs.map(e => e.vel), P, { len });
        const x = x0 + k * SP;
        const hiK = n > 1 ? k / (n - 1) : .5;            // 0 = lowest tube … 1 = highest
        const glowC = new THREE.Color(GOLD).lerp(new THREE.Color(GOLD_HOT), hiK * .7);

        // the lane frame: on the tube axis, turned so its local +z is the swing-out direction
        const laneG = new THREE.Group(); laneG.position.set(x, 0, Z_T); laneG.rotation.y = YAW; group.add(laneG);
        // the TUBE + cords + cap, in a group pivoting at the eyelet on the hanger rail
        const tubeG = new THREE.Group(); tubeG.position.set(0, yHang, 0); laneG.add(tubeG);
        const tube = buildTube(len, glowC, envMap); tubeG.add(tube.mesh);
        add(new THREE.Mesh(capEyeGeo, chrome), tubeG);
        add(new THREE.Mesh(cordGeo, cordM), tubeG);
        const tubeHalo = glowSprite(glowC, tubeG);
        tubeHalo.position.set(0, -HANG - STRIKE_DEPTH, TUBE_R); tubeHalo.scale.setScalar(1.6);
        // the bending wave ARRIVES at the open bottom end: a flare there as the light-pulse lands …
        const footHalo = glowSprite(glowC, tubeG);
        footHalo.position.set(0, -HANG - len, 0); footHalo.scale.setScalar(1.2);
        // … and the light pours out of the open end onto the deck below
        const poolM = new THREE.MeshBasicMaterial({ map: glowTex, color: glowC, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false });
        const pool = add(new THREE.Mesh(poolGeo, poolM), laneG); pool.position.y = SLAB + .02;

        // the YOKE (static): a drop rod off the striker rail, a crossbar, two cheek plates at the
        // slab's edges carrying the axle; the motor (+x) and a plain bearing (−x) ride the axle
        const pz = PIVOT.z;
        bar(V(0, yRail, pz), V(0, yYoke, pz), .035, chrome, laneG);
        box(2 * SLAB_HW, .06, .16, 0, yYoke, pz, dark, laneG);
        for (const sx of [-1, 1]) box(.02, yYoke - yAxle + .12, .18, sx * (SLAB_HW - .01), (yYoke + yAxle - .12) / 2, pz, dark, laneG);
        bar(V(-SLAB_HW + .02, yAxle, pz), V(SLAB_HW - .02, yAxle, pz), .028, chrome, laneG);
        bar(V(FORK_X + .045, yAxle, pz), V(SLAB_HW - .025, yAxle, pz), .15, iron, laneG);      // motor can
        bar(V(-SLAB_HW + .025, yAxle, pz), V(-FORK_X - .045, yAxle, pz), .1, iron, laneG);     // bearing
        const motorM = new THREE.MeshStandardMaterial({ color: 0x0b1c26, emissive: new THREE.Color(COIL), emissiveIntensity: .1 });
        const ring = add(new THREE.Mesh(ringGeo, motorM), laneG); ring.position.set((FORK_X + SLAB_HW) / 2 + .01, yAxle, pz);

        // the STRIKER: rod + hub + marble, swinging about the axle
        const pivot = V(0, yAxle, pz);
        const swing = new THREE.Group(); swing.position.copy(pivot); laneG.add(swing);
        add(new THREE.Mesh(rodHubGeo, chrome), swing);
        const ballM = new THREE.MeshStandardMaterial({ color: 0xe6ebf2, metalness: 1, roughness: .08, envMap, envMapIntensity: 1.5,
          emissive: glowC.clone(), emissiveIntensity: .12 });
        const ball = add(new THREE.Mesh(ballGeo, ballM), swing); ball.position.y = -ROD;

        // the CATCHER: a fork either side of the rod, a crossbar + magnet puck behind the marble
        const coilM = new THREE.MeshStandardMaterial({ color: 0x0b1c26, emissive: new THREE.Color(COIL), emissiveIntensity: .2 });
        const shoe = new THREE.Group(); shoe.position.copy(pivot); laneG.add(shoe);
        add(new THREE.Mesh(forkGeo, dark), shoe);
        add(new THREE.Mesh(puckGeo, chrome), shoe).position.set(0, -ROD, 0);
        add(new THREE.Mesh(coilGeo, coilM), shoe).position.set(0, -ROD, -SHOE_T + .01);
        const coilHalo = glowSprite(COIL, shoe); coilHalo.position.set(0, -ROD, 0); coilHalo.scale.setScalar(.9);

        // ghost trail of the marble (re-sampled from the pure fn: scrub-safe)
        const trail = Array.from({ length: TRAIL_N }, () => glowSprite(glowC, group));

        lanes.push({ note, lane, x, len, glowC, tubeG, tube, tubeHalo, footHalo, pool, poolM, swing, shoe, ballM, coilM, motorM,
                     coilHalo, trail, SDX, SDZ, contact: V(x + SDX * TUBE_R, yC, Z_T + SDZ * TUBE_R), pivot, edge: makeEdge(.25),
                     yC, footY: yHang - HANG - len - SLAB });
      });
      freeze(group);
      return group;
    }

    const ballPos = (ln, th, out) => {
      const b = ballYZ(th);
      return out.set(ln.x + ln.SDX * b.z, ln.yC + b.y, Z_T + ln.SDZ * b.z);
    };
    const _p = new THREE.Vector3();

    function update(songTime, P, dt, { started, skipStrikes, onStrike }){
      const t = started ? songTime : start;
      for (const ln of lanes){
        const s = bellAt(ln.lane, t, start);
        const vel = s.armed ? 0 : ln.lane.vel[s.i];

        // ---- strike edge ----
        if (started && !s.armed && ln.edge.check(s.abs, s.since, skipStrikes)){
          onStrike && onStrike({ note: ln.note, vel, pos: ln.contact.clone(), color: ln.glowC.getHex(), dur: 0,
            shake: ln.len > 6 ? .025 + .03 * vel : 0, sparks: Math.round(5 + 8 * vel), light: 1.1 + .8 * vel });
        }

        // ---- striker + shoe ----
        ln.swing.rotation.x = -s.th;
        ln.shoe.rotation.x = -(s.phi + DELTA);
        const age = s.armed ? 99 : s.since;
        // the marble flashes hot gold at the impact (kinetic energy → light), cooling in ~.15 s
        ln.ballM.emissiveIntensity = .12 + (s.armed ? 0 : 2.6 * vel * Math.exp(-age * 16));
        // coil: blazes on the catch (the clack), holds steady while latched, cuts dark on release
        let on = 0, drive = 0;
        if (s.latched){
          const sinceCatch = s.armed ? 9 : s.since - ln.lane.plan[s.i].tc;
          on = .35 + 2.8 * Math.exp(-sinceCatch * 9);
          // the motor's load: holding the marble against gravity + accelerating it (finite diff — pure fn of t)
          const h = .008, a1 = bellAt(ln.lane, t + h, start).wphi, a0 = bellAt(ln.lane, t - h, start).wphi;
          drive = .5 * Math.sin(s.th) + Math.abs(a1 - a0) / (2 * h) * .04;
        }
        ln.coilM.emissiveIntensity = .12 + 1.9 * on;
        ln.coilHalo.material.opacity = Math.min(.9, .3 * on);
        // the motor ring lights with the drive's speed and load: you SEE where the energy comes from
        ln.motorM.emissiveIntensity = .08 + Math.min(3.5, Math.abs(s.wphi) * .6 + drive * 1.6);

        // ---- the struck tube: swing on the cord, bending shiver, its light ----
        ln.tubeG.rotation.x = -s.tube.psi;
        ln.tubeG.rotation.z = s.tube.roll;
        const amp = s.armed ? 0 : glowAmp(vel);
        const U = ln.tube.u;
        U.uAge.value = age; U.uAmp.value = amp; U.uGap.value = s.armed ? 1 : s.gap;
        ln.tubeHalo.material.opacity = Math.min(1, amp * Math.exp(-age * 3.5) * 1.1);
        ln.tubeHalo.scale.setScalar(1.3 + 2.2 * amp * Math.exp(-age * 5));
        const arrive = (ln.len - STRIKE_DEPTH) / PULSE_V, da = (age - arrive) / .09;
        const flare = amp * (Math.exp(-da * da) * Math.exp(-age * 1.2) + .3 * Math.exp(-age * 1.1) * (age > arrive ? 1 : 0));
        ln.footHalo.material.opacity = Math.min(1, flare);
        ln.footHalo.scale.setScalar(1.1 + 1.4 * Math.exp(-da * da));
        // the light spilling out of the open end lands on the deck (a beat later, a splash then a glow)
        ln.poolM.opacity = Math.min(.9, .75 * flare);
        ln.pool.scale.setScalar(1.1 + .6 * Math.min(1, Math.max(0, age - arrive) * 3) + .3 * amp);
        ln.pool.position.z = (HANG + ln.len) * Math.sin(s.tube.psi);   // under the foot as it swings

        // ---- ghost trail: the marble's own past, faded by its speed ----
        const speed = Math.min(1, Math.abs(s.w) / 3.5);
        ln.trail.forEach((sp, j) => {
          const tj = t - (j + 1) * TRAIL_DT;
          if (!started || tj < start || speed < .08){ sp.material.opacity = 0; return; }
          ballPos(ln, bellAt(ln.lane, tj, start).th, _p);
          sp.position.copy(_p);
          const f = 1 - (j + 1) / (TRAIL_N + 1);
          sp.material.opacity = .32 * f * speed;
          sp.scale.setScalar(BALL_R * 3.6 * (.45 + .55 * f));
        });
      }
    }

    return { build, update };
  },

  /* Demo: Westminster-style quarters → a cathedral chord → a falling run → a tolled
     repeat (the dense, motor-thrown path) → a final full-gantry chord. */
  demo: {
    bpm: 84, beats: 32,
    part: [
      [0, 'E5', .75], [1, 'C5', .6], [2, 'D5', .7], [3, 'G4', 1],
      [4, 'G4', .55], [5, 'D5', .7], [6, 'E5', .8], [7, 'C5', .95],
      [8, 'C4', 1], [8, 'G4', .8], [8, 'E5', .7],
      [12, 'C4', .85], [14, 'C4', .6],
      [16, 'G5', .5], [16.5, 'E5', .55], [17, 'D5', .6], [17.5, 'C5', .65], [18, 'A4', .7], [18.5, 'G4', .75], [19, 'C5', .9],
      [20, 'C5', .55], [20.5, 'C5', .5], [21, 'C5', .7], [21.5, 'D5', .6],
      [22, 'E5', .75], [23, 'G5', .9],
      [24, 'C4', 1], [24, 'G4', .85], [24, 'E5', .8], [24, 'C6', 1],
      [28, 'A4', .45], [29, 'G4', .5], [30, 'C4', .6],
    ],
  },
};

/* ---- static structure → ONE mesh per material (draw calls stay low: a gantry of
   ~90 bars is 2–3 draws). Bakes each frozen mesh's transform relative to the group. ---- */
function freeze(group){
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert(), byMat = new Map(), dead = [];
  group.traverse(o => {
    if (!o.isMesh || !o.userData.frozen) return;
    const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
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

/* ---- a chime TUBE whose light is part of its sound: on a strike a pulse of light
   races down the tube from the contact point (the bending wave), then the tube
   rings out in standing-wave bands that slowly fade. Pure fn of uAge/uAmp. ---- */
function buildTube(len, glowC, envMap){
  const geo = new THREE.CylinderGeometry(TUBE_R, TUBE_R, len, 28, 48, false);
  geo.translate(0, -HANG - len / 2, 0);                  // local y: 0 at the eyelet, top cap at −HANG
  const mat = new THREE.MeshStandardMaterial({ color: 0xf2d9a2, metalness: 1, roughness: .13, envMap, envMapIntensity: 2.4,
    emissive: glowC.clone(), emissiveIntensity: .22 });   // a resting gleam: polished brass, not cardboard
  const u = { uAge: { value: 99 }, uAmp: { value: 0 }, uGap: { value: 1 }, uLen: { value: len }, uGlow: { value: glowC.clone() } };
  const f = x => x.toFixed(4);
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    // the bending SHIVER — exactly solve.js shiverAt (zero at the strike, tapered to zero by the next):
    // a free-free mode shape along the tube, displacing it along the swing axis (local z)
    sh.vertexShader = 'uniform float uAge, uAmp, uGap, uLen;\nvarying float vD;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
      vD = -position.y - ${f(HANG)};
      float shTaper = pow(max(0.0, 1.0 - uAge / uGap), 2.0);
      float shShape = -cos(4.73 * vD / uLen - 2.365) / 0.714;
      transformed.z += -${f(SHIVER_A)} * uAmp * exp(-${f(SHIVER_D)} * uAge) * sin(6.28318 * ${f(SHIVER_F)} * uAge) * shTaper * shShape;`);
    sh.fragmentShader = 'uniform float uAge, uAmp, uLen;\nuniform vec3 uGlow;\nvarying float vD;\n' + sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float dd = abs(vD - ${f(STRIKE_DEPTH)});
      float front = ${PULSE_V.toFixed(1)} * uAge;
      float pulse = exp(-pow((dd - front) / 0.5, 2.0)) * exp(-uAge * 2.0);
      float hot = exp(-pow(dd / 0.35, 2.0)) * exp(-uAge * 6.0);
      float stand = pow(abs(sin(3.14159 * 4.5 * vD / uLen + 0.4)), 3.0);
      float ringE = exp(-uAge * 0.8) * smoothstep(0.0, 0.25, uAge);
      totalEmissiveRadiance += uGlow * uAmp * (3.0 * pulse + 4.5 * hot + (0.15 + 0.85 * stand) * ringE);`);
  };
  return { mesh: new THREE.Mesh(geo, mat), u };
}
