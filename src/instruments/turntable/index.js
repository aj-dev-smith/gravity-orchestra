import * as THREE from 'three';
import { makeEdge, ring, smooth, laneClock, at } from '../clock.js';
import { noteHz, noteNum } from '../../engine.js';
import { GEOM, Y_M, POST, buildRecord, ballAt, carriageAt, padPose, forActivePads,
         maxActive, driveTime, driveRate, spinTime, toLocal } from './solve.js';
import { vibesVoice, TREM_HZ } from './voice.js';

/* ============================================================
   TURNTABLE — the conveyor's sibling: one marble READS A RECORD.

   A heavy vinyl platter spins at constant speed (an idler-wheel drive
   you can watch: motor pulley → rubber idler → platter rim; the strobe
   dots on the rim are its honest speed readout under the amber lamp).
   Concentric glowing GROOVES are a pitch staff (low = outer). Every note
   of the part rides the record on its groove as a pad that slides out
   flush from under the rear BRIDGE (an inlay in the vinyl, tinted its
   groove colour), and — just in time, in front of the audience — its
   post telescopes up, its knuckle tips it to the bounce normal, and it
   reaches the STRIKE LINE under the tonearm's magnet exactly on its
   beat. One immortal marble hops radially from groove to groove — long
   notes are tall arcs, runs are flat skims — and parks on the tonearm's
   ELECTROMAGNET through long rests (and the count-in), carried at the
   arc's own radial speed and dropped onto the beat.

   The motor also turns the vibraphone's TREMOLO shaft: a rank of tuned
   resonator tubes hangs under the plinth's front edge, their butterfly
   discs spinning — every note lights its tube.

   All of it is a pure function of songTime (solve.js; tested in
   test/inst-turntable.test.js). Constant material/mesh counts after build.
   ============================================================ */

const EDGE_W = .25;
const TRAIL_N = 14, TRAIL_DT = .018;
const SIG = new THREE.Color(0xff6a3d);            // signature: the strobe lamp's warm neon
const { R_PLAT, R_LABEL, Y_PLAT, RM } = GEOM;
const PL = { W: 13.4, D: 13.4, TOP: 1.05 };      // plinth
const PLAT_T = .42;                               // platter thickness (top at Y_PLAT)
const Y_COIL = Y_M + RM;                          // magnet face
const COIL_H = .42, COIL_R = .3;
const Y_CAR = Y_COIL + COIL_H + .34;              // carriage body centre
const Y_RAIL = Y_CAR + .32;                       // rail centre
const S_PIVOT = 6.62;                             // the gantry mast, out past the platter on the strike ray
const S_TIP = .7;                                 // rail tip (over the label)
const ZR = 1.05;                                  // the rail runs this far BEHIND the strike line (−z): from
                                                  // above and from the front, every contact stays in view;
                                                  // the carriage reaches over with an L-arm to the magnet
const MAST_TOP = Y_RAIL + 1.25;
const TAU = Math.PI * 2;
const STROBE_N = [180, 183, 216, 222];            // dots per row; row 0 is the one tuned to stand still
const A_LAMP = .36 * Math.PI, A_IDLER = .25 * Math.PI;   // front-right
const R_IDLER = .42, R_PULLEY = .16, Y_DRIVE = Y_PLAT - .33;   // the drive rim (sub-platter) under the record
const R_SUB = R_PLAT - .3, TOP_T = .24;           // sub-platter radius; the record platter's own thickness
const Z_TREM = 5.25, Y_TREM = -.32;               // the tremolo shaft under the plinth's front edge
const PAD_BASE = new THREE.Color(0x9aa4ba);
const hueOf = rank => (((.08 - .53 * rank) % 1) + 1) % 1;   // amber (low) → magenta → violet → ice (high)

const voice = id => vibesVoice(id);

export default {
  key: 'turntable',
  label: 'Turntable',
  wet: true,
  lookHeight: 3.2,
  camera: { dist: 17, up: 8 },
  color: '#ff6a3d',                 // director button / shot tint: the strobe lamp's warm neon
  directorWeight: 1.1,              // a monophonic line (one hit at a time) — level with the plucked machines
  voice,

  make({ envMap, glowTex }){
    let S = null;

    function build(part, { rollT, beat, P, start, floorY = -21 }){
      const group = new THREE.Group();
      const R = buildRecord(part, { rollT, beat, P, start });
      const Ts = spinTime(start);
      const POOL = Math.max(1, maxActive(R));

      // ---- materials (a fixed set) ----
      const M = {
        chrome: new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: .14, envMap, envMapIntensity: 1.3 }),
        dark:   new THREE.MeshStandardMaterial({ color: 0x232733, metalness: .7, roughness: .45, envMap }),
        lacquer: new THREE.MeshStandardMaterial({ color: 0x0b0e18, metalness: .5, roughness: .22, envMap, envMapIntensity: 1.1,
                  side: THREE.DoubleSide }),
        brass:  new THREE.MeshStandardMaterial({ color: 0xd9a650, metalness: 1, roughness: .26, envMap, envMapIntensity: 1.2 }),
        rubber: new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: .1, roughness: .8 }),
        alu:    new THREE.MeshStandardMaterial({ color: 0x9aa3b4, metalness: 1, roughness: .32, envMap }),
        tube:   new THREE.MeshStandardMaterial({ color: 0xffcc66, metalness: 1, roughness: .16, envMap, envMapIntensity: 2.0,
                  side: THREE.DoubleSide }),
        padTop: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .55, roughness: .24, envMap, envMapIntensity: 1.2 }),
        neon:   new THREE.MeshBasicMaterial({ color: SIG.clone().multiplyScalar(1.5) }),
        coil:   new THREE.MeshStandardMaterial({ color: 0x5a3a1c, metalness: .8, roughness: .35, envMap,
                  emissive: new THREE.Color(0xff7a2a), emissiveIntensity: .1 }),
        marble: new THREE.MeshStandardMaterial({ color: 0xffe2b8, metalness: .3, roughness: .2, envMap,
                  emissive: new THREE.Color(0xff9a40), emissiveIntensity: 1.2 }),
        rim:    new THREE.MeshBasicMaterial({ color: 0xffffff }),          // per-instance colour = glow
        tubeGlow: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
        disc:   new THREE.MeshStandardMaterial({ color: 0xb8c0d0, metalness: 1, roughness: .3, envMap, side: THREE.DoubleSide }),
        well:   new THREE.MeshBasicMaterial({ color: 0x020203 }),
        slot:   new THREE.MeshBasicMaterial({ color: SIG.clone().multiplyScalar(.4) }),   // the bridge's re-tuning window
      };

      // ---- the plinth + pedestal (stands on the room floor) ----
      buildPlinth(group, M, floorY);

      // ---- the PLATTER (rotates as one) ----
      const platter = new THREE.Group();
      platter.position.y = Y_PLAT;
      group.add(platter);
      const st = R.staff;
      const rings = st ? [...new Set(R.evs.map(e => e.note))].sort((a, b) => noteNum(a) - noteNum(b)) : [];
            // (single-material meshes only: main disposes o.material directly on a song change)
      const side = new THREE.Mesh(new THREE.CylinderGeometry(R_PLAT, R_PLAT, TOP_T, 128, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x15171d, metalness: .7, roughness: .3, envMap }));
      side.position.y = -TOP_T / 2; platter.add(side);
      const under = new THREE.Mesh(new THREE.CircleGeometry(R_PLAT, 96).rotateX(Math.PI / 2), M.dark);
      under.position.y = -TOP_T; platter.add(under);
      const vinyl = new THREE.Mesh(new THREE.CircleGeometry(R_PLAT, 128).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ map: vinylTexture(), color: 0xffffff, metalness: .35, roughness: .32, envMap, envMapIntensity: .9 }));
      vinyl.position.y = -.003; platter.add(vinyl);
      // strobe band: four rows of dots on the rim, seen under the mains-flicker lamp (see strobePhase)
      const strobe = makeStrobe();
      strobe.mesh.position.y = Y_PLAT - .11; group.add(strobe.mesh);
      // the drive rim (the rubber idler runs on it)
      const driveRim = new THREE.Mesh(new THREE.CylinderGeometry(R_SUB, R_SUB, PLAT_T - TOP_T, 96, 1), M.alu);
      driveRim.position.y = Y_DRIVE - Y_PLAT; platter.add(driveRim);
      // centre label + spindle
      const labelTex = labelTexture();
      const label = new THREE.Mesh(new THREE.CircleGeometry(R_LABEL, 64).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ map: labelTex, metalness: .1, roughness: .5,
          emissive: new THREE.Color(0xffffff), emissiveMap: labelTex, emissiveIntensity: .35 }));
      label.position.y = .004; platter.add(label);
      const spindle = new THREE.Mesh(new THREE.CylinderGeometry(.09, .11, .6, 16), M.chrome);
      spindle.position.y = .3; platter.add(spindle);
      const spCap = new THREE.Mesh(new THREE.SphereGeometry(.1, 12, 8), M.chrome);
      spCap.position.y = .6; platter.add(spCap);
      // the glowing GROOVES: one per staff note (circles: they read the same at any rotation)
      const ringLanes = rings.map(note => {
        const rank = (noteNum(note) - st.loN) / st.span, r = st.ringR(note);
        const col = new THREE.Color().setHSL(hueOf(rank), .85, .55);
        const mat = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(.3), transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false });
        const m = new THREE.Mesh(new THREE.RingGeometry(r - .024, r + .024, 160, 1).rotateX(-Math.PI / 2), mat);
        m.position.y = .007; m.renderOrder = 1; platter.add(m);
        const L = laneClock(R.evs.filter(e => e.note === note).map(e => e.s), P);
        return { note, rank, r, col, mat, L };
      });
      const laneOf = Object.fromEntries(ringLanes.map(l => [l.note, l]));
      R.evs.forEach(e => { e.lane = laneOf[e.note]; e.col = e.lane.col; });

      // ---- the PADS: a pool, re-derived every frame. Each = a disc (tinted its groove colour) with a
      //      glowing rim, on an ARM from a brass KNUCKLE atop a vertical telescoping POST whose foot sits
      //      in a fixed well (pocket) in the vinyl: flush, the disc IS the pocket's lid ----
      const padGeo = new THREE.CylinderGeometry(1, 1, GEOM.PAD_T, 40).translate(0, -GEOM.PAD_T / 2, 0);
      const pads = new THREE.InstancedMesh(padGeo, M.padTop, POOL);
      const rims = new THREE.InstancedMesh(new THREE.TorusGeometry(1, .06, 6, 40).rotateX(Math.PI / 2), M.rim, POOL);
      const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(.062, .062, 1, 12).translate(0, .5, 0), M.chrome, POOL);
      const arms = new THREE.InstancedMesh(new THREE.CylinderGeometry(.042, .042, 1, 10).translate(0, .5, 0), M.chrome, POOL);
      const knuckles = new THREE.InstancedMesh(new THREE.SphereGeometry(.095, 14, 10), M.brass, POOL);
      const collars = new THREE.InstancedMesh(new THREE.CylinderGeometry(.13, .16, .07, 16).translate(0, .035, 0), M.dark, POOL);
      const wells = new THREE.InstancedMesh(new THREE.CircleGeometry(1.04, 40).rotateX(-Math.PI / 2), M.well, POOL);
      const IMS = [pads, rims, posts, arms, knuckles, collars, wells];
      for (const im of IMS){ im.count = 0; im.frustumCulled = false; group.add(im); }
      rims.setColorAt(0, new THREE.Color()); pads.setColorAt(0, new THREE.Color());

      // ---- the TONEARM GANTRY: mast on the plinth, a rail out over the strike line, a stay ----
      buildGantry(group, M);
      const carriage = new THREE.Group(); group.add(carriage);
      const car = new THREE.Mesh(new THREE.BoxGeometry(.8, .34, .62), M.alu); car.position.set(0, Y_CAR, -ZR); carriage.add(car);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]){
        const w = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .08, 12).rotateX(Math.PI / 2), M.dark);
        w.position.set(sx * .26, Y_RAIL - .14, -ZR + sz * .19); carriage.add(w);
      }
      // the L-arm: out of the carriage's front face, over to the strike line, then down to the coil
      const reach = new THREE.Mesh(new THREE.BoxGeometry(.16, .16, ZR + .08), M.alu);
      reach.position.set(0, Y_CAR - .02, -ZR / 2 + .04); carriage.add(reach);
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(.11, 12, 8), M.brass);
      elbow.position.set(0, Y_CAR - .02, 0); carriage.add(elbow);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, Y_CAR - (Y_COIL + COIL_H), 10), M.chrome);
      rod.position.y = (Y_CAR + Y_COIL + COIL_H) / 2; carriage.add(rod);
      const coil = new THREE.Mesh(new THREE.CylinderGeometry(COIL_R, COIL_R, COIL_H, 24), M.coil);
      coil.position.y = Y_COIL + COIL_H / 2; carriage.add(coil);
      const face = new THREE.Mesh(new THREE.CylinderGeometry(COIL_R * .9, COIL_R * .9, .04, 24), M.chrome);
      face.position.y = Y_COIL + .02; carriage.add(face);
      for (const y of [.12, .24, .36]){
        const wind = new THREE.Mesh(new THREE.TorusGeometry(COIL_R + .01, .018, 6, 24).rotateX(Math.PI / 2), M.brass);
        wind.position.y = Y_COIL + y; carriage.add(wind);
      }
      // the carriage's power cable, festooned back along the rail to the mast
      const cable = new THREE.Mesh(new THREE.BoxGeometry(1, .06, .08), M.rubber);
      group.add(cable);

      // ---- the rear BRIDGE (pads ride under it flush, to be re-tuned) ----
      buildCowl(group, M);
      // the STRIKE LINE: a fixed hairline of light on the record under the rail (pads cross it on the beat)
      const laser = new THREE.Mesh(new THREE.PlaneGeometry(R_PLAT - R_LABEL - .2, .035).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: SIG.clone().multiplyScalar(.9), transparent: true, opacity: .55,
          blending: THREE.AdditiveBlending, depthWrite: false }));
      laser.position.set(-(R_PLAT + R_LABEL + .2) / 2, Y_PLAT + .012, 0); laser.renderOrder = 2; group.add(laser);
      // the LANDING LANE: a fixed arc of light on the record just before the strike line, re-sized to
      // the NEXT note's groove — the record carries that note's pad down the lit lane into the beat
      const LANE = .85, laneMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false });
      const lane = new THREE.Mesh(new THREE.RingGeometry(1 - .012, 1 + .012, 48, 1, -Math.PI, LANE).rotateX(-Math.PI / 2), laneMat);
      lane.position.y = Y_PLAT + .01; lane.renderOrder = 2; group.add(lane);

      // ---- the drive: motor pulley → rubber idler → platter rim; strobe lamp ----
      const idler = new THREE.Group(), pulley = new THREE.Group();
      const ri = R_SUB + R_IDLER, rp = ri + R_IDLER + R_PULLEY;
      idler.position.set(ri * Math.cos(A_IDLER), Y_DRIVE, ri * Math.sin(A_IDLER));
      pulley.position.set(rp * Math.cos(A_IDLER), Y_DRIVE, rp * Math.sin(A_IDLER));
      group.add(idler, pulley);
      idler.add(new THREE.Mesh(new THREE.CylinderGeometry(R_IDLER, R_IDLER, .15, 32), M.rubber));
      const idHub = new THREE.Mesh(new THREE.CylinderGeometry(R_IDLER * .6, R_IDLER * .6, .19, 5), M.alu); idler.add(idHub);
      const idPost = new THREE.Mesh(new THREE.CylinderGeometry(.05, .06, Y_DRIVE - PL.TOP, 8), M.chrome);
      idPost.position.set(idler.position.x, (Y_DRIVE + PL.TOP) / 2, idler.position.z); group.add(idPost);
      pulley.add(new THREE.Mesh(new THREE.CylinderGeometry(R_PULLEY, R_PULLEY, .22, 6), M.chrome));
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(.42, .5, Y_DRIVE - .11 - PL.TOP, 32), M.dark);
      motor.position.set(pulley.position.x, (Y_DRIVE - .11 + PL.TOP) / 2, pulley.position.z); group.add(motor);
      const motorRing = new THREE.Mesh(new THREE.TorusGeometry(.43, .022, 6, 32).rotateX(Math.PI / 2), M.neon);
      motorRing.position.set(pulley.position.x, Y_DRIVE - .12, pulley.position.z); group.add(motorRing);
      const rl = R_PLAT + .5;
      const lampHouse = new THREE.Mesh(new THREE.BoxGeometry(.34, .34, .5), M.dark);
      lampHouse.position.set(rl * Math.cos(A_LAMP), PL.TOP + .17, rl * Math.sin(A_LAMP)); lampHouse.rotation.y = -A_LAMP;
      group.add(lampHouse);
      const lampLens = new THREE.Mesh(new THREE.SphereGeometry(.09, 12, 8), M.neon);
      const rl2 = R_PLAT + .3;
      lampLens.position.set(rl2 * Math.cos(A_LAMP), PL.TOP + .22, rl2 * Math.sin(A_LAMP)); group.add(lampLens);

      // ---- the vibraphone resonator rank + tremolo shaft under the front edge ----
      const res = buildResonators(group, M, rings, pulley.position);
      res.lanes.forEach((rl3, i) => { rl3.lane = ringLanes[i]; });

      // ---- the marble ----
      const marble = new THREE.Mesh(new THREE.SphereGeometry(RM, 32, 24), M.marble);
      group.add(marble);

      // ---- one Points cloud: ball halo + ghosts + contact flare + magnet halo + next-pad flare + lamp ----
      const NPT = 1 + TRAIL_N + 4;
      const halo = makeHaloCloud(NPT, glowTex);
      group.add(halo.points);
      for (let i = 0; i < 1 + TRAIL_N; i++) halo.col.setXYZ(i, 1, .66, .32);
      halo.col.setXYZ(2 + TRAIL_N, 1, .55, .2);                       // magnet
      halo.col.setXYZ(NPT - 1, SIG.r, SIG.g * .7, SIG.b * .5);        // strobe lamp

      // the bridge's re-tuning window pulses as each pad passes its centre line (a lane clock of
      // those crossings: every strike's pad crosses POST + COWL_HALF of travel later)
      const tuneLag = (POST + GEOM.COWL_HALF) / R.omega;
      S = { lane, laneMat, R, P, start, Ts, POOL, platter, pads, rims, posts, arms, knuckles, collars, wells, IMS, ringLanes, carriage, cable, coil: M.coil,
            marble, marbleMat: M.marble, halo, NPT, idler, pulley, res, strobe, slotMat: M.slot, tuneLag,
            lampLens: lampLens.position.clone(), edge: makeEdge(EDGE_W),
            m4: new THREE.Matrix4(), q: new THREE.Quaternion(), qi: new THREE.Quaternion(), v: new THREE.Vector3(),
            sc: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), nv: new THREE.Vector3(), c: new THREE.Color() };
      return group;
    }

    function update(songTime, P, dt, { started, skipStrikes, onStrike }){
      if (!S || !S.R.n) return;
      const R = S.R, t = started ? songTime : S.start;
      const gt = driveTime(t, S.Ts), rate = driveRate(t, S.Ts);
      const Th = R.omega * gt;
      // ---- the platter + the drive train (no slip: they share the rim speed) ----
      S.platter.rotation.y = -Th;
      S.idler.rotation.y = Th * R_SUB / R_IDLER;
      S.pulley.rotation.y = -Th * R_SUB / R_PULLEY;
      // the tremolo discs: geared to the motor so they turn at TREM_HZ/2 at full speed
      S.res.shaft.rotation.x = Th * (Math.PI * TREM_HZ) / R.omega;

      // ---- the marble ----
      const b = ballAt(R, t);
      const bp = toLocal(b.s, b.y);
      S.marble.position.set(bp[0], bp[1], bp[2]);
      // squash & stretch: stretch along the velocity with speed, a quick squash at each contact
      const sp = Math.hypot(b.vs, b.vy), sq = b.i >= 0 ? .28 * ring(b.since, 22) : 0;
      if (sp > .05){
        S.nv.set(b.vs * Math.cos(GEOM.A_S), b.vy, b.vs * Math.sin(GEOM.A_S)).divideScalar(sp);
        S.marble.quaternion.setFromUnitVectors(S.up, S.nv);
      }
      const st = Math.min(.12, sp * .014) - sq;         // capped: the long drop stays a marble, not a teardrop
      S.marble.scale.set(1 - st * .5, 1 + st, 1 - st * .5);
      const ev = b.i >= 0 ? R.evs[b.i] : null;
      const since = b.i >= 0 ? b.since : Infinity;
      const vel = ev ? ev.vel : 0;
      S.marbleMat.emissiveIntensity = Math.min(1.6, 1.05 + .55 * vel * ring(since, 7));   // no white-out at contact

      // ---- strike edge: fire once, at the contact ----
      if (started && ev && S.edge.check(b.abs, since, skipStrikes) && onStrike){
        const cp = toLocal(ev.S[0], ev.S[1]);
        const offMagnet = R.evs[(b.i - 1 + R.n) % R.n].park;
        onStrike({ note: ev.note, vel, pos: new THREE.Vector3(cp[0], cp[1], cp[2]), color: ev.col.getHex(), dur: 0,
          shake: offMagnet ? .035 : 0, sparks: Math.round(3 + 5 * vel), light: .5 + .5 * vel });
      }

      // ---- the carriage + magnet ----
      const car = carriageAt(R, t);
      S.carriage.position.set(-car.s, 0, 0);
      const cl = 6.62 - car.s;
      S.cable.position.set(-(car.s + 6.62) / 2, Y_RAIL + .16, -ZR + .2); S.cable.scale.set(Math.max(.01, cl), 1, 1);
      let on = .1;
      if (b.mode === 'held') on = .9;
      else if (b.mode === 'hold'){ const docked = b.since - ev.tUp; on = .8 + 2.5 * Math.exp(-docked * 9); }
      else if (b.mode === 'rise') on = .1 + .7 * smooth(ev.tUp - .35, ev.tUp, b.since);
      S.coil.emissiveIntensity = .1 + 1.6 * on;

      // ---- the grooves: each flashes when its note sounds ----
      for (const l of S.ringLanes){
        const cc = at(l.L, t, R.first), f = cc.armed ? 0 : ring(cc.since, 2.2);
        l.mat.color.copy(l.col).multiplyScalar(.16 + 1.25 * f);
      }

      // ---- the pads ----
      const nextK = b.i >= 0 ? (b.i + 1) % R.n : R.firstIdx;
      const nextAbs = b.i >= 0 ? b.abs + ev.gap : R.first;
      const prog = b.i >= 0 ? Math.min(1, b.since / ev.gap) : smooth(R.tRel - 1.5, R.first, t);
      let j = 0;
      const { m4, q, qi, v, sc, nv, c } = S;
      forActivePads(R, t, (k, abs) => {
        if (j >= S.POOL) return;
        const e = R.evs[k], p = padPose(R, k, abs, t);
        nv.set(p.n[0], p.n[1], p.n[2]);
        q.setFromUnitVectors(S.up, nv);
        v.set(p.top[0], p.top[1] + .014, p.top[2]);   // (render lift: a flush disc sits over the groove lines)
        S.pads.setMatrixAt(j, m4.compose(v, q, sc.set(e.rho, 1, e.rho)));
        v.addScaledVector(nv, .004);
        S.rims.setMatrixAt(j, m4.compose(v, q, sc.set(e.rho, e.rho, e.rho)));
        // the mount: post (foot → knuckle, vertical), knuckle, arm (knuckle → disc underside, along n)
        const [fx, fy, fz] = p.foot, [kx, ky, kz] = p.knuckle;
        S.posts.setMatrixAt(j, m4.compose(v.set(fx, fy, fz), qi, sc.set(1, Math.max(.001, ky - fy), 1)));
        S.knuckles.setMatrixAt(j, m4.compose(v.set(kx, ky, kz), qi, sc.set(1, 1, 1)));
        S.arms.setMatrixAt(j, m4.compose(v.set(kx, ky, kz), q, sc.set(1, Math.max(.001, p.len - GEOM.PAD_T), 1)));
        const ca = Math.cos(p.a), sa = Math.sin(p.a), up = smooth(0, .08, p.extend);
        S.collars.setMatrixAt(j, m4.compose(v.set(fx, Y_PLAT - .07 + .07 * up, fz), qi, sc.set(1, 1, 1)));
        S.wells.setMatrixAt(j, m4.compose(v.set(e.F * ca, Y_PLAT + .002, e.F * sa), qi, sc.set(e.rho, 1, e.rho)));
        // the disc: its groove's colour (an inlay while flush), brightening as it becomes the target
        const isNext = k === nextK && Math.abs(abs - nextAbs) < 1e-6;
        const hot = (isNext ? prog * prog : 0) + (p.live && t >= abs ? e.vel * ring(t - abs, 4) : 0);
        S.pads.setColorAt(j, c.copy(PAD_BASE).lerp(e.col, .62).multiplyScalar(.55 + .25 * p.extend + .9 * hot));
        // rim glow: dim while it travels, warming with the anticipation (prog²) when it's next,
        // the contact flash at its strike (on the PAD, not the marble) fading as it leaves
        let gl = .3 + .35 * p.tilt;
        if (isNext) gl += 2.2 * prog * prog;
        if (p.live && t >= abs) gl += 2.8 * e.vel * ring(t - abs, 3.5);
        gl *= .45 + .55 * p.extend;
        S.rims.setColorAt(j, c.copy(e.col).multiplyScalar(gl));
        j++;
      });
      for (const im of S.IMS){ im.count = j; im.instanceMatrix.needsUpdate = true; }
      {
        const ne = R.evs[nextK];
        S.lane.scale.set(ne.r, 1, ne.r);
        S.laneMat.color.copy(ne.col).multiplyScalar(1.1 * prog * prog);
      }
      S.rims.instanceColor.needsUpdate = true; S.pads.instanceColor.needsUpdate = true;

      // ---- the bridge's re-tuning window: a pulse as each pad passes under its centre ----
      {
        const cc = at(R.L, gt - S.tuneLag, -Infinity), f = gt - S.tuneLag < R.first ? 0 : ring(cc.since, 4);
        S.slotMat.color.copy(SIG).multiplyScalar(.35 + 2.2 * f);
      }

      // ---- resonator tubes light with their notes ----
      const trem = S.res.shaft.rotation.x;
      S.res.lanes.forEach((rl, i) => {
        const l = rl.lane, cc = at(l.L, t, R.first), f = cc.armed ? 0 : ring(cc.since, 1.3);
        const disc = .78 + .22 * Math.cos(2 * trem);           // the butterfly disc opening/closing the mouth
        S.res.glow.setColorAt(i, c.copy(l.col).multiplyScalar((.12 + 1.6 * f) * disc));
      });
      if (S.res.glow.instanceColor) S.res.glow.instanceColor.needsUpdate = true;

      // ---- the strobe band: what the eye sees under the flickering lamp ----
      S.strobe.set(t, S.Ts, R.omega);

      // ---- halos / trail ----
      const H = S.halo, HP = H.pos.array, HA = H.alpha.array, HS = H.size.array;
      HP[0] = bp[0]; HP[1] = bp[1]; HP[2] = bp[2];
      HA[0] = .3 + .22 * vel * ring(since, 6); HS[0] = RM * (4.2 - 1.6 * ring(since, 10));   // the halo TIGHTENS at contact
      const spd = Math.min(1, Math.hypot(b.vs, b.vy) / 6);
      for (let k = 0; k < TRAIL_N; k++){
        const pi = 1 + k, tk = t - (k + 1) * TRAIL_DT;
        if (tk < S.start || spd < .05 || b.mode === 'held' || b.mode === 'hold'){ HA[pi] = 0; continue; }
        const bk = ballAt(R, tk), pk = toLocal(bk.s, bk.y);
        HP[pi * 3] = pk[0]; HP[pi * 3 + 1] = pk[1]; HP[pi * 3 + 2] = pk[2];
        const f = 1 - (k + 1) / (TRAIL_N + 1);
        HA[pi] = .5 * f * spd * (1 - .5 * smooth(5, 7, Math.abs(bk.vy))); HS[pi] = RM * 4 * (.4 + .6 * f);
      }
      const cf = 1 + TRAIL_N;                                       // contact flare: the GROOVE under the pad
      if (ev){
        const cpt = toLocal(ev.r, Y_PLAT + .03);
        HP[cf * 3] = cpt[0]; HP[cf * 3 + 1] = cpt[1]; HP[cf * 3 + 2] = cpt[2];
        const fa = vel * ring(since, 9);
        HA[cf] = fa > .01 ? Math.min(.8, .9 * fa) : 0; HS[cf] = ev.rho * (2.5 + 5 * (1 - ring(since, 9)));
        H.col.setXYZ(cf, ev.col.r * 1.4, ev.col.g * 1.4, ev.col.b * 1.4);
      } else HA[cf] = 0;
      const mh = cf + 1;                                            // magnet halo
      HP[mh * 3] = -car.s; HP[mh * 3 + 1] = Y_COIL + .1; HP[mh * 3 + 2] = 0;
      HA[mh] = Math.min(1, .22 * on); HS[mh] = COIL_R * 4 * (1 + .3 * Math.max(0, on - 1));
      const nf = mh + 1, ne = R.evs[nextK], npt = toLocal(ne.S[0], ne.S[1]);   // the beat's target
      HP[nf * 3] = npt[0]; HP[nf * 3 + 1] = npt[1] + .05; HP[nf * 3 + 2] = npt[2];
      HA[nf] = .35 * prog * prog; HS[nf] = ne.rho * 3.2;
      H.col.setXYZ(nf, ne.col.r, ne.col.g, ne.col.b);
      const lp = nf + 1;                                            // strobe lamp
      HP[lp * 3] = S.lampLens.x; HP[lp * 3 + 1] = S.lampLens.y; HP[lp * 3 + 2] = S.lampLens.z;
      HA[lp] = .45 + .25 * rate; HS[lp] = 1.1;
      H.pos.needsUpdate = H.alpha.needsUpdate = H.size.needsUpdate = H.col.needsUpdate = true;
    }

    return { build, update };
  },

  /* 32 beats in F major, a little vibes tune built to show the record off: a rising
     opening with a tall two-beat arc; an 8th-note scale skimming DOWN the grooves (outward);
     an arpeggio climbing all the way in to C6 that HANGS on the tonearm magnet; the magnet
     carries it out to a low F3 (a 19-semitone leap) and an 8th arpeggio runs back in; a
     repeated-note figure (F5 ×4, D5 ×3: the marble dribbling one groove while the record
     slides fresh pads under it); quarter-note register LEAPS (C6↔C4, A5↔A3 — steep bumper
     pads); and a final run up to a high F6 that parks on the magnet across the loop seam. */
  demo: {
    bpm: 100, beats: 32, scale: ['F', 'G', 'A', 'A#', 'C', 'D', 'E'],
    part: [
      [0, 'F4', .8], [1, 'A4', .7], [2, 'C5', .9],
      [4, 'D5', .7], [4.5, 'C5', .6], [5, 'A#4', .6], [5.5, 'A4', .6], [6, 'G4', .6], [6.5, 'F4', .6], [7, 'E4', .6], [7.5, 'D4', .7],
      [8, 'C4', .8], [8.5, 'F4', .6], [9, 'A4', .65], [9.5, 'C5', .7], [10, 'F5', .8], [10.5, 'A5', .85], [11, 'C6', 1],
      [14, 'F3', .9], [14.5, 'C4', .55], [15, 'F4', .6], [15.5, 'A4', .7],
      [16, 'F5', .9], [16.5, 'F5', .5], [17, 'F5', .6], [17.5, 'F5', .5], [18, 'E5', .7], [19, 'C5', .7],
      [20, 'D5', .8], [20.5, 'D5', .5], [21, 'D5', .6], [21.5, 'C5', .6], [22, 'A#4', .8],
      [24, 'C6', .9], [25, 'C4', .7], [26, 'A5', .8], [27, 'A3', .7],
      [28, 'F4', .7], [28.5, 'A4', .6], [29, 'C5', .7], [29.5, 'F5', .8], [30, 'F6', 1],
    ],
  },
};

/* ================= geometry builders ================= */

function roundedBox(w, h, d, r){
  const s = new THREE.Shape(), x0 = -w / 2, z0 = -d / 2;
  s.moveTo(x0 + r, z0); s.lineTo(x0 + w - r, z0); s.quadraticCurveTo(x0 + w, z0, x0 + w, z0 + r);
  s.lineTo(x0 + w, z0 + d - r); s.quadraticCurveTo(x0 + w, z0 + d, x0 + w - r, z0 + d);
  s.lineTo(x0 + r, z0 + d); s.quadraticCurveTo(x0, z0 + d, x0, z0 + d - r);
  s.lineTo(x0, z0 + r); s.quadraticCurveTo(x0, z0, x0 + r, z0);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: .05, bevelSize: .05, bevelSegments: 2, curveSegments: 8 });
  g.rotateX(Math.PI / 2); g.translate(0, h, 0);            // extrude along −y from h down to 0
  return g;
}

/* The plinth: a heavy lacquered deck with an amber trim line, on a tapered pedestal to the floor. */
function buildPlinth(group, M, floorY){
  const body = new THREE.Mesh(roundedBox(PL.W, PL.TOP - .1, PL.D, .5), M.lacquer);
  group.add(body);
  const top = new THREE.Mesh(roundedBox(PL.W - .1, .06, PL.D - .1, .45), M.dark);
  top.position.y = PL.TOP - .12; group.add(top);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(PL.W - 1, .03, .03), M.neon);
  trim.position.set(0, PL.TOP * .5, PL.D / 2 + .06); group.add(trim);
  const well = new THREE.Mesh(new THREE.CylinderGeometry(R_PLAT + .1, R_PLAT + .1, .03, 96), M.dark);
  well.position.y = PL.TOP - .02; group.add(well);
  const bearing = new THREE.Mesh(new THREE.CylinderGeometry(.5, .6, Y_PLAT - PLAT_T - PL.TOP + .02, 24), M.chrome);
  bearing.position.y = (Y_PLAT - PLAT_T + PL.TOP) / 2; group.add(bearing);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]){
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(.55, .7, .36, 20), M.chrome);
    foot.position.set(sx * (PL.W / 2 - 1.2), -.18, sz * (PL.D / 2 - 2.2)); group.add(foot);
  }
  if (floorY < -.5){
    const h = -floorY - .36;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5.4, h, 4, 1).rotateY(Math.PI / 4), M.lacquer);
    ped.scale.set(1.3, 1, .9);
    ped.position.set(0, -.36 - h / 2, -1.2); group.add(ped);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(PL.W - 1.2, .24, PL.D - 3.4), M.dark);
    cap.position.set(0, -.48, -1.2); group.add(cap);
  }
}

/* The tonearm gantry: a mast on the plinth beyond the platter rim, a box rail cantilevered
   inward PARALLEL to the strike ray but ZR behind it (so it never hides a contact — the carriage's
   L-arm reaches over to the magnet), a stay from the mast head to the rail tip, and a counterweight
   behind the mast (a tonearm's silhouette, and what balances the cantilever). */
function buildGantry(group, M){
  const x = s => -s, z = -ZR;
  const mastH = MAST_TOP - PL.TOP;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.55, .7, .3, 32), M.dark);
  base.position.set(x(S_PIVOT), PL.TOP + .15, z); group.add(base);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.18, .26, mastH, 20), M.chrome);
  mast.position.set(x(S_PIVOT), PL.TOP + mastH / 2, z); group.add(mast);
  const gimbal = new THREE.Mesh(new THREE.TorusGeometry(.34, .06, 8, 24), M.brass);
  gimbal.position.set(x(S_PIVOT), Y_RAIL, z); group.add(gimbal);
  const s0 = S_TIP, s1 = S_PIVOT + .25, L = s1 - s0;
  const rail = new THREE.Mesh(new THREE.BoxGeometry(L, .2, .24), M.alu);
  rail.position.set(x((s0 + s1) / 2), Y_RAIL, z); group.add(rail);
  for (const sz of [-1, 1]){
    const lip = new THREE.Mesh(new THREE.BoxGeometry(L, .04, .05), M.chrome);
    lip.position.set(x((s0 + s1) / 2), Y_RAIL - .12, z + sz * .19); group.add(lip);
  }
  const strip = new THREE.Mesh(new THREE.BoxGeometry(L - 1.2, .025, .05), M.neon);
  strip.position.set(x((s0 + S_PIVOT) / 2), Y_RAIL + .115, z); group.add(strip);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .7, 10).rotateZ(Math.PI / 2), M.chrome);
  arm.position.set(x(S_PIVOT + .5), Y_RAIL, z); group.add(arm);
  const cw = new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, .36, 28).rotateZ(Math.PI / 2), M.brass);
  cw.position.set(x(S_PIVOT + .62), Y_RAIL, z); group.add(cw);
  const a = new THREE.Vector3(x(S_PIVOT), MAST_TOP - .1, z), b = new THREE.Vector3(x(S_TIP + .2), Y_RAIL + .1, z);
  const sv = b.clone().sub(a);
  const stay = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, sv.length(), 8), M.chrome);
  stay.position.copy(a).addScaledVector(sv, .5);
  stay.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sv.clone().normalize());
  group.add(stay);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.16, 14, 10), M.brass);
  head.position.copy(a); group.add(head);
  const endCap = new THREE.Mesh(new THREE.BoxGeometry(.16, .3, .34), M.dark);
  endCap.position.set(x(S_TIP), Y_RAIL, z); group.add(endCap);
}

/* The rear BRIDGE: a hooded tunnel over the back sector of the record. Flush pads ride under
   its brush curtains; inside (hidden) they're re-tuned. It stands on two legs on the plinth
   outside the rim, joined by an outer cheek; the hood is cantilevered inward over the record
   from them. A lit window along its crown pulses as each pad passes under (see update). */
function buildCowl(group, M){
  const a0 = GEOM.A_COWL - GEOM.COWL_HALF, a1 = GEOM.A_COWL + GEOM.COWL_HALF;
  const r0 = R_LABEL + .2, r1 = R_PLAT + .22, H = .5, y0 = Y_PLAT + .03;
  const th0 = Math.PI / 2 - a1, thL = a1 - a0;            // three.js cylinder theta: x = r·sin θ, z = r·cos θ ⇒ θ = π/2 − a
  const rm = (r0 + r1) / 2;
  // the hood: a shallow vault — a flat roof ring plus a raised crown band
  const roof = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 48, 1, 0, thL).rotateX(-Math.PI / 2), M.lacquer);
  roof.rotation.y = -a1; roof.position.y = y0 + H; group.add(roof);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 1, true, th0, thL), M.lacquer);
  // (the crown is a low curved wall at mid-radius carrying the window)
  crown.scale.set(rm, .14, rm); crown.position.y = y0 + H + .07; group.add(crown);
  const crownTop = new THREE.Mesh(new THREE.RingGeometry(rm - .3, rm + .3, 32, 1, 0, thL).rotateX(-Math.PI / 2), M.dark);
  crownTop.rotation.y = -a1; crownTop.position.y = y0 + H + .14; group.add(crownTop);
  for (const r of [rm - .3, rm + .3]){
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, .14, 32, 1, true, th0, thL), M.alu);
    wall.position.y = y0 + H + .07; group.add(wall);
  }
  // the re-tuning window: a glowing slot along the crown
  const win = new THREE.Mesh(new THREE.RingGeometry(rm - .1, rm + .1, 32, 1, .06, thL - .12).rotateX(-Math.PI / 2), M.slot);
  win.rotation.y = -a1; win.position.y = y0 + H + .145; group.add(win);
  // the cheeks (curved side walls)
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(r1, r1, H, 48, 1, true, th0, thL), M.alu);
  outer.position.y = y0 + H / 2; group.add(outer);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(r0, r0, H, 24, 1, true, th0, thL), M.alu);
  inner.position.y = y0 + H / 2; group.add(inner);
  for (const [r, tr] of [[r1, .05], [r0, .04]]){
    const lip = new THREE.Mesh(new THREE.TorusGeometry(r, tr, 6, 48, thL).rotateX(Math.PI / 2), M.chrome);
    lip.rotation.y = -a0; lip.position.y = y0 + H; group.add(lip);
  }
  // the mouths: a lintel with an amber lip and a brush curtain down to just above the vinyl
  for (const a of [a0, a1]){
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(r1 - r0, .1, .1), M.dark);
    lintel.position.set(rm * Math.cos(a), y0 + H - .05, rm * Math.sin(a)); lintel.rotation.y = -a; group.add(lintel);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(r1 - r0, .03, .03), M.neon);
    slot.position.set(rm * Math.cos(a), y0 + H + .02, rm * Math.sin(a)); slot.rotation.y = -a; group.add(slot);
    const brush = new THREE.Mesh(new THREE.BoxGeometry(r1 - r0 - .04, H - .1 - .012, .035), M.rubber);
    brush.position.set(rm * Math.cos(a), Y_PLAT + .012 + (H - .1 - .012) / 2 + (y0 - Y_PLAT), rm * Math.sin(a));
    brush.rotation.y = -a; group.add(brush);
  }
  // two legs on the plinth just outside the rim, under the mouths' outer corners, tied by a beam
  const rl = R_PLAT + .5;
  for (const a of [a0 + .06, a1 - .06]){
    const h = y0 + H - PL.TOP;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(.36, h, .5), M.dark);
    leg.position.set(rl * Math.cos(a), PL.TOP + h / 2, rl * Math.sin(a)); leg.rotation.y = -a; group.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(.56, .08, .7), M.chrome);
    foot.position.set(rl * Math.cos(a), PL.TOP + .04, rl * Math.sin(a)); foot.rotation.y = -a; group.add(foot);
    const knee = new THREE.Mesh(new THREE.BoxGeometry(rl - r1 + .3, .12, .32), M.dark);
    const rk = (rl + r1) / 2;
    knee.position.set(rk * Math.cos(a), y0 + H - .06, rk * Math.sin(a)); knee.rotation.y = -a; group.add(knee);
  }
}

/* The vibraphone resonators: a rank of tuned tubes (quarter-wave: length ∝ 1/f) hung under the
   plinth's front edge, the tremolo shaft along their mouths carrying a butterfly disc in each,
   driven from the motor by a vertical shaft and a bevel pair. Each tube's glow band lights with its note. */
function buildResonators(group, M, rings, motorPos){
  const n = Math.max(1, rings.length);
  const x0 = -5.6, x1 = 3.7, sp = n > 1 ? (x1 - x0) / (n - 1) : 0;
  const fLo = rings.length ? noteHz(rings[0]) : 220;
  const tubes = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 20, 1, true), M.tube, n);
  const caps = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, .05, 20), M.dark, n);
  // the front APRON hides the rank; a tall window in front of each tube shows its length (∝ 1/f)
  // and lights with its note, flickering with the tremolo discs behind it
  const glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), M.tubeGlow, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const lanes = [];
  const rTube = Math.min(.24, Math.max(.12, sp * .38 || .24));
  const yTop = Y_TREM + .14;
  rings.forEach((note, i) => {
    const L = Math.max(.6, Math.min(4.2, 3.6 * fLo / noteHz(note)));
    const x = x0 + i * sp;
    tubes.setMatrixAt(i, m4.compose(v.set(x, yTop - L / 2, Z_TREM), q, s.set(rTube, L, rTube)));
    caps.setMatrixAt(i, m4.compose(v.set(x, yTop - L, Z_TREM), q, s.set(rTube, 1, rTube)));
    glow.setMatrixAt(i, m4.compose(v.set(x, yTop - .15 - L * .45, Z_TREM + .47), q, s.set(rTube * 1.1, L * .86, 1)));
    glow.setColorAt(i, new THREE.Color(0x111111));
    lanes.push({ note, x, L });
  });
  if (!rings.length){ tubes.count = caps.count = glow.count = 0; }
  group.add(tubes, caps, glow);
  const maxL = Math.max(.8, ...lanes.map(l => l.L)), aw = x1 - x0 + 1.3, ah = maxL + .55;
  const apron = new THREE.Mesh(new THREE.BoxGeometry(aw, ah, .08), M.lacquer);
  apron.position.set((x0 + x1) / 2, -.02 - ah / 2, Z_TREM + .42); group.add(apron);
  const apTrim = new THREE.Mesh(new THREE.BoxGeometry(aw, .03, .03), M.neon);
  apTrim.position.set((x0 + x1) / 2, -.02 - ah, Z_TREM + .47); group.add(apTrim);
  for (const sx of [-1, 1]){
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(.08, ah, .9), M.lacquer);
    cheek.position.set((x0 + x1) / 2 + sx * aw / 2, -.02 - ah / 2, Z_TREM + .0); group.add(cheek);
  }
  // the shaft (rotates about x) with a disc in each tube mouth
  const shaft = new THREE.Group(); shaft.position.set(0, Y_TREM, Z_TREM); group.add(shaft);
  const sx0 = x0 - .4, sx1 = motorPos.x;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, sx1 - sx0, 8).rotateZ(Math.PI / 2), M.chrome);
  rod.position.x = (sx0 + sx1) / 2; shaft.add(rod);
  const discs = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20).rotateY(Math.PI / 2), M.disc, n);
  lanes.forEach((l, i) => discs.setMatrixAt(i, m4.compose(v.set(l.x, 0, 0), q.identity(), s.set(1, rTube * .9, rTube * .9))));
  if (!rings.length) discs.count = 0;
  shaft.add(discs);
  // hangers from the plinth underside (bearings for the shaft)
  for (const hx of [x0 - .3, (x0 + x1) / 2, x1 + .3]){
    const h = new THREE.Mesh(new THREE.BoxGeometry(.08, -Y_TREM + .05, .08), M.dark);
    h.position.set(hx, Y_TREM / 2, Z_TREM); group.add(h);
  }
  // the drive: a vertical shaft down from the motor, a bevel box, a short link to the tremolo shaft
  const vs = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, PL.TOP - Y_TREM, 8), M.chrome);
  vs.position.set(motorPos.x, (PL.TOP + Y_TREM) / 2, motorPos.z); group.add(vs);
  const zLink = Z_TREM - motorPos.z;
  if (Math.abs(zLink) > .05){
    const link = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, Math.abs(zLink), 8).rotateX(Math.PI / 2), M.chrome);
    link.position.set(motorPos.x, Y_TREM, (Z_TREM + motorPos.z) / 2); group.add(link);
  }
  for (const z of [motorPos.z, Z_TREM]){
    const box = new THREE.Mesh(new THREE.BoxGeometry(.24, .24, .24), M.brass);
    box.position.set(motorPos.x, Y_TREM, z); group.add(box);
  }
  return { shaft, glow, lanes };
}

/* The vinyl: concentric fine grooves, a run-out, engraved beat ticks round the rim (so the
   spin reads), a soft sheen. 2048² canvas, centred. */
function vinylTexture(){
  const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!cv) return null;
  const W = 2048; cv.width = cv.height = W;
  const g = cv.getContext('2d'), c = W / 2, k = c / R_PLAT;
  g.fillStyle = '#07080c'; g.fillRect(0, 0, W, W);
  for (let r = R_LABEL + .1; r < R_PLAT - .15; r += .018){
    const shade = 18 + 10 * Math.sin(r * 37) + 6 * Math.sin(r * 7.3);
    g.strokeStyle = `rgba(${shade + 30},${shade + 32},${shade + 40},.55)`; g.lineWidth = 1;
    g.beginPath(); g.arc(c, c, r * k, 0, 2 * Math.PI); g.stroke();
  }
  g.fillStyle = '#0c0d12'; g.beginPath(); g.arc(c, c, (R_LABEL + .35) * k, 0, 2 * Math.PI); g.fill();
  g.strokeStyle = 'rgba(140,150,170,.35)'; g.lineWidth = 2;
  g.beginPath(); g.arc(c, c, (R_PLAT - .12) * k, 0, 2 * Math.PI); g.stroke();
  for (let i = 0; i < 64; i++){
    const a = i / 64 * 2 * Math.PI, bar = i % 4 === 0;
    g.strokeStyle = bar ? 'rgba(255,170,90,.6)' : 'rgba(160,170,190,.3)'; g.lineWidth = bar ? 5 : 2;
    const r0 = (R_PLAT - (bar ? .42 : .3)) * k, r1 = (R_PLAT - .16) * k;
    g.beginPath(); g.moveTo(c + r0 * Math.cos(a), c + r0 * Math.sin(a)); g.lineTo(c + r1 * Math.cos(a), c + r1 * Math.sin(a)); g.stroke();
  }
  for (const a0 of [0, Math.PI]){
    const grd = g.createRadialGradient(c, c, R_LABEL * k, c, c, R_PLAT * k);
    grd.addColorStop(0, 'rgba(120,130,160,0)'); grd.addColorStop(.5, 'rgba(120,130,160,.07)'); grd.addColorStop(1, 'rgba(120,130,160,0)');
    g.fillStyle = grd; g.beginPath(); g.moveTo(c, c); g.arc(c, c, R_PLAT * k, a0 - .35, a0 + .35); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

/* The STROBE band: four rows of dots on the platter rim, lit by a lamp that flickers at f_L.
   Row 0 has exactly N₀ = 180 dots for the platter's full speed (f_L = N₀·ω/2π), so under the lamp
   it STANDS STILL while the record visibly turns — the honest speed readout of a real deck; the
   other rows (N ≠ N₀) creep at their alias rate. The eye sees each row's dot phase ALIASED to the
   flashes: apparent speed = f_L·wrap(N·Θ̇/2π/f_L) dots/s (wrap to ±½). Θ̇ ramps 0 → ω in the
   count-in (constant torque), so the alias integrates in closed form — the dots drift, swing and
   LOCK as the motor reaches speed. A pure function of songTime. The band itself is static (it's
   what the light shows you, not the dots' true positions). */
function strobePhase(t, Ts, c, fL){
  const wrapH = x => x - Math.round(x), F = X => { const d = X - Math.round(X); return d * d / 2; };
  if (!(Ts > 0)) return fL * wrapH(c) * t;
  if (t <= -Ts) return 0;
  if (t < 0) return fL * Ts / c * F(c * (t + Ts) / Ts);
  return fL * Ts / c * F(c) + fL * wrapH(c) * t;
}
function makeStrobe(){
  const uPh = new THREE.Vector4();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uPh: { value: uPh } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec4 uPh; varying vec2 vUv;
      float row(float y0, float n, float ph){
        float inY = 1. - smoothstep(.07, .095, abs(vUv.y - y0));
        float x = fract(vUv.x * n + ph);
        return inY * smoothstep(.02, .1, x) * (1. - smoothstep(.4, .48, x));
      }
      void main(){
        float v = row(.82, ${STROBE_N[0]}., uPh.x) + row(.6, ${STROBE_N[1]}., uPh.y)
                + row(.38, ${STROBE_N[2]}., uPh.z) + row(.16, ${STROBE_N[3]}., uPh.w);
        gl_FragColor = vec4(vec3(.018, .02, .028) + vec3(.95, .78, .6) * v * .85, 1.);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(R_PLAT + .014, R_PLAT + .014, .2, 256, 1, true), mat);
  return {
    mesh,
    set(t, Ts, omega){
      const fL = STROBE_N[0] * omega / TAU;
      const ph = STROBE_N.map(n => { const p = strobePhase(t, Ts, n / STROBE_N[0], fL); return p - Math.floor(p); });
      uPh.set(ph[0], ph[1], ph[2], ph[3]);
    },
  };
}

/* The label: deep vermilion with a cream ring and the name (also its own emissive map). */
function labelTexture(){
  const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!cv) return null;
  const W = 512; cv.width = cv.height = W;
  const g = cv.getContext('2d'), c = W / 2;
  g.fillStyle = '#7a1f12'; g.fillRect(0, 0, W, W);
  {
    const grd = g.createRadialGradient(c, c, 10, c, c, c);
    grd.addColorStop(0, '#c2491f'); grd.addColorStop(1, '#5a140c');
    g.fillStyle = grd; g.beginPath(); g.arc(c, c, c, 0, 2 * Math.PI); g.fill();
  }
  g.strokeStyle = '#f2d6a2'; g.lineWidth = 6;
  g.beginPath(); g.arc(c, c, c * .9, 0, 2 * Math.PI); g.stroke();
  g.lineWidth = 2; g.beginPath(); g.arc(c, c, c * .82, 0, 2 * Math.PI); g.stroke();
  g.fillStyle = '#f6e2b8';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 64px Georgia, serif'; g.fillText('CASCADE', c, c - 92);
  g.font = 'italic 30px Georgia, serif'; g.fillText('marble melody machine', c, c + 92);
  g.font = 'bold 34px Georgia, serif'; g.fillText('33⅓', c, c + 140);
  { g.fillStyle = '#20080a'; g.beginPath(); g.arc(c, c, 14, 0, 2 * Math.PI); g.fill(); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* One additive Points cloud for every halo + ghost (constant count → no recompiles). */
function makeHaloCloud(n, glowTex){
  const geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const col = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const alpha = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
  const size = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pos); geo.setAttribute('aColor', col);
  geo.setAttribute('aAlpha', alpha); geo.setAttribute('aSize', size);
  const uniforms = { map: { value: glowTex }, uScale: { value: 800 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
      uniform float uScale; varying vec3 vC; varying float vA;
      void main(){ vC = aColor; vA = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        gl_PointSize = aAlpha > 0. ? aSize * uScale / max(.1, -mv.z) : 0.;
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA;
      void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb * t.a * vA, 1.); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const _v = new THREE.Vector2();
  points.onBeforeRender = (renderer, scene, camera) => {
    renderer.getDrawingBufferSize(_v);
    const fov = camera.isPerspectiveCamera ? camera.fov : 50;
    uniforms.uScale.value = _v.y / (2 * Math.tan(fov * Math.PI / 360));
  };
  return { points, pos, col, alpha, size };
}
