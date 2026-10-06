import * as THREE from 'three';
import { makeEdge, ring, smooth } from '../clock.js';
import { GEOM, T, B, N, PSI_R, buildComb, tineAt, cylAngle, pinPhase, shapeAt, tipPos, phi1,
         driveTime, driveRate, driveStart, spinTime } from './solve.js';
import { renderTine } from './voice.js';

/* ============================================================
   MUSIC BOX — the sparkling, polyphonic ostinato voice.

   A giant clockwork music box. A brass PINNED CYLINDER turns exactly
   one revolution per loop, so the drum IS the score: every glowing
   bead on it is a note, seated at the angle that carries it to the
   comb at exactly its beat, in the groove of its pitch's tine. The
   engraved beat lines read like a piano roll wrapped round a drum.

   A steel COMB of tuned tines sits behind it (tine length ∝ f^−½, a
   cantilever; low tines carry lead tuning weights). A rising bead
   catches its tine, drags it up, slides off the end, and the tine
   rings — a visibly vibrating cantilever, released at rest from the
   top of its bead (solve.js proves contact, no penetration, C¹ motion).

   What drives it, visibly: a blued MAINSPRING in its barrel turns the
   great wheel; at the other end the drum's wheel runs a pinion, a worm
   wheel and a fast WORM up to the AIR-BRAKE GOVERNOR (×64 the drum) —
   the fan that holds the speed honest. Every rotation is geared to the
   drum's θ(t) = 2π·t/P: one pure function of songTime drives it all.
   ============================================================ */

const EDGE_W = .25;
const AX_Y = 3.2, AX_Z = -.4;                // drum axis (local)
/* solve-frame (y, z) about the axis → local (y, z): the core is turned half a revolution */
const W = (ys, zs) => [AX_Y - ys, AX_Z - zs];
const BED = 1.0;                             // top of the case
const SIG = new THREE.Color(0x8fe9ff);       // signature: ice-cyan starlight
const GOLD = new THREE.Color(0xffb347);
const TINE_TH = .065;                        // tine thickness (above its underside line)
const LEAD_RANK = .34;                       // tines below this pitch rank carry lead weights
const GEARS = { drumL: 48, barrel: 36, drumR: 36, pinion: 9, worm: 16 };
const R_L = 1.6,  R_B = R_L * GEARS.barrel / GEARS.drumL;     // great wheel / barrel wheel (same module)
const R_R = 1.15, R_P = R_R * GEARS.pinion / GEARS.drumR;     // drum's right wheel / pinion
const R_WW = .5, R_WORM = .13;
const PSI_B = -1.8, PSI_A = 2.0;             // local directions (ψ: from +y toward +z) from the drum axis to the barrel (low, behind) / arbor A (low, in front)

const voice = id => renderTine(id);

/* mating-gear angle: gear 2 (N2 teeth) driven by gear 1 (N1) at angle θ1, gear 2 lying in
   direction λ from gear 1 — teeth interleave at the contact point. */
const mesh = (th1, N1, N2, lam) => -(N1 / N2) * (th1 - lam) + lam + Math.PI + Math.PI / N2;

export default {
  key: 'musicbox',
  label: 'Music Box',
  wet: true,
  lookHeight: 2.8,
  camera: { dist: 11.5, up: 8 },    // a look down onto the pinned drum — comb + gear clear of the HUD
  color: '#8fe9ff',                 // ice-cyan starlight
  directorWeight: 1.1,              // the intro's solo voice — it should open the film
  voice,

  make({ envMap, glowTex }){
    let S = null;

    function build(part, { rollT, beat, P, start, floorY = -21.5, loopBeats = 16 }){
      const group = new THREE.Group();
      const { lanes, omega } = buildComb(part, { rollT, beat, P });
      const Ts = spinTime(start), t0 = driveStart(start, Ts);      // the count-in: parked, then spin-up
      const n = lanes.length;
      const sp = Math.min(.44, 6.0 / Math.max(1, n));
      const Lc = n * sp + .4, hx = Lc / 2;
      lanes.forEach((l, k) => { l.x = (k - (n - 1) / 2) * sp; });

      // ---- materials (a constant set: nothing is created after build) ----
      const M = {
        brass:  new THREE.MeshStandardMaterial({ color: 0xd9a650, metalness: 1, roughness: .28, envMap, envMapIntensity: 1.2 }),
        brassD: new THREE.MeshStandardMaterial({ color: 0x9a6a2a, metalness: 1, roughness: .38, envMap }),
        chrome: new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: .15, envMap, envMapIntensity: 1.3 }),
        dark:   new THREE.MeshStandardMaterial({ color: 0x232733, metalness: .7, roughness: .45, envMap }),
        case:   new THREE.MeshStandardMaterial({ color: 0x141a2a, metalness: .55, roughness: .35, envMap }),
        bed:    new THREE.MeshStandardMaterial({ color: 0x3a2a1c, metalness: .6, roughness: .42, envMap }),
        blued:  new THREE.MeshStandardMaterial({ color: 0x2a5cff, metalness: 1, roughness: .22, envMap,
                  emissive: new THREE.Color(0x2050ff), emissiveIntensity: .35 }),
        steel:  new THREE.MeshStandardMaterial({ color: 0x4a5160, metalness: 1, roughness: .32, envMap }),
        combPlate: new THREE.MeshStandardMaterial({ color: 0xaab4c8, metalness: 1, roughness: .2, envMap, envMapIntensity: 1.3 }),
        lead:   new THREE.MeshStandardMaterial({ color: 0x6d7078, metalness: .4, roughness: .55, envMap }),
        neon:   new THREE.MeshBasicMaterial({ color: SIG.clone().multiplyScalar(1.6) }),
        amber:  new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a2a).multiplyScalar(1.4) }),
        blur:   new THREE.MeshBasicMaterial({ color: 0xbfd6ff, transparent: true, opacity: 0, depthWrite: false,
                  blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      };
      const sprite = (col, op = 0) => new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col,
        transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));

      // ---- the case + pedestal down to the floor ----
      const kase = buildCase(group, M, floorY, glowTex);

      // ---- the CORE: solve.js's frame, turned half a revolution about the axis so the comb
      //      sits low at the FRONT and pins come over the top toward the audience, down the
      //      drum's face, and press their tines DOWN (gravity plays no part in a stiff tine,
      //      so this is the same honest pluck, just seen from its best side). ----
      const core = new THREE.Group();
      core.position.set(0, AX_Y, AX_Z); core.rotation.x = Math.PI;
      group.add(core);

      // the DRUM (rotates as one)
      const drum = new THREE.Group();
      core.add(drum);
      const scoreTex = scoreTexture(lanes, { Lc, hx, omega, rollT, beat, loopBeats, P });
      const drumMat = new THREE.MeshStandardMaterial({ map: scoreTex, color: 0xffffff, metalness: .9, roughness: .3,
        envMap, envMapIntensity: 1.1, emissive: new THREE.Color(0x3a2208), emissiveIntensity: .35 });
      const cylG = new THREE.CylinderGeometry(GEOM.R, GEOM.R, Lc, 128, 1, true);
      cylG.rotateZ(-Math.PI / 2);
      drum.add(new THREE.Mesh(cylG, drumMat));
      for (const s of [-1, 1]){
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(GEOM.R * 1.04, GEOM.R * 1.04, .08, 64).rotateZ(Math.PI / 2), M.brassD);
        cap.position.x = s * (hx + .04); drum.add(cap);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(GEOM.R * 1.03, .035, 8, 64).rotateY(Math.PI / 2), M.chrome);
        rim.position.x = s * hx; drum.add(rim);
      }
      drum.add(new THREE.Mesh(new THREE.CylinderGeometry(.075, .075, Lc + 1.5, 16).rotateZ(Math.PI / 2), M.chrome));
      const wheelL = new THREE.Mesh(gearGeo(R_L, GEARS.drumL, .12, 6), M.brass);
      wheelL.position.x = -hx - .35; drum.add(wheelL);
      const wheelR = new THREE.Mesh(gearGeo(R_R, GEARS.drumR, .1, 5), M.brass);
      wheelR.position.x = hx + .35; drum.add(wheelR);

      // the PINS: a fine steel wire for every note (it does the plucking), seated in a
      // glowing bead sunk in the drum skin (the bead is the score you read)
      const pins = [];
      lanes.forEach(l => { l.pin0 = pins.length; l.L.s.forEach((s, i) => pins.push({ lane: l, s, vel: l.vel[i] })); });
      const np = Math.max(1, pins.length);
      const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(GEOM.BEAD, 14, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff }), np);
      const wires = new THREE.InstancedMesh(new THREE.CylinderGeometry(GEOM.RW * .75, GEOM.RW, GEOM.RT - GEOM.R, 8),
        new THREE.MeshStandardMaterial({ color: 0xc8d0dc, metalness: 1, roughness: .2, envMap, envMapIntensity: 1.4 }), np);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
      const baseCol = [];
      const rb = GEOM.R + GEOM.BEAD * .2, rm = (GEOM.R + GEOM.RT) / 2;
      pins.forEach((p, i) => {
        const ph = pinPhase(p.s, P);
        beads.setMatrixAt(i, m4.makeTranslation(p.lane.x, rb * Math.cos(ph), rb * Math.sin(ph)));
        q.setFromEuler(e.set(ph, 0, 0));
        wires.setMatrixAt(i, m4.compose(v3.set(p.lane.x, rm * Math.cos(ph), rm * Math.sin(ph)), q, one));
        const c = GOLD.clone().multiplyScalar(.9 + 1.5 * p.vel);
        baseCol.push(c); beads.setColorAt(i, c);
      });
      if (!pins.length){ beads.count = 0; wires.count = 0; }
      drum.add(beads, wires);

      // the COMB (tines + stepped plate, in the core frame) and its bridge (world frame)
      const comb = buildCombMesh(core, group, lanes, { M });

      // the SPRING BARREL (left, low behind): meshes the great wheel
      const dB = R_L + R_B, lamB = PSI_B - Math.PI;                  // core-frame direction
      const bW = W(dB * Math.cos(lamB), dB * Math.sin(lamB));         // its world (y, z)
      const barrel = new THREE.Group();
      barrel.position.set(-hx - .35, dB * Math.cos(lamB), dB * Math.sin(lamB));
      core.add(barrel);
      barrel.add(new THREE.Mesh(gearGeo(R_B, GEARS.barrel, .12, 0), M.brass));
      const bDrum = new THREE.Mesh(new THREE.CylinderGeometry(R_B * .86, R_B * .86, .62, 48, 1, true).rotateZ(Math.PI / 2), M.brassD);
      bDrum.position.x = -.37; barrel.add(bDrum);
      const back = new THREE.Mesh(new THREE.CircleGeometry(R_B * .86, 48).rotateY(-Math.PI / 2), M.dark);
      back.position.x = -.08; barrel.add(back);
      const spring = new THREE.Mesh(spiralGeo(.16, R_B * .8, 5.5, .022), M.blued);
      spring.position.x = -.62; barrel.add(spring);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(R_B * .86, .04, 8, 48).rotateY(Math.PI / 2), M.chrome);
      lip.position.x = -.68; barrel.add(lip);
      const bArbor = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, 1.6, 12).rotateZ(Math.PI / 2), M.chrome);
      bArbor.position.x = -.45; barrel.add(bArbor);
      const ratchet = new THREE.Mesh(gearGeo(.26, 14, .06, 0, true), M.chrome);
      ratchet.position.x = -.82; barrel.add(ratchet);
      for (const x of [-hx - .12, -hx - 1.32]) group.add(post(x, bW[0], bW[1], BED, M, .09));
      // the winding motor keeps the mainspring at constant tension (its arbor turns with the barrel)
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(.26, .26, .42, 24).rotateZ(Math.PI / 2), M.dark);
      motor.position.set(-hx - 1.55, bW[0], bW[1]); group.add(motor);
      const motorGlow = new THREE.Mesh(new THREE.TorusGeometry(.2, .03, 8, 24).rotateY(Math.PI / 2), M.amber);
      motorGlow.position.set(-hx - 1.77, bW[0], bW[1]); group.add(motorGlow);
      // its output coupling turns with the arbor (= the barrel: constant tension)
      const collar = new THREE.Mesh(gearGeo(.2, 8, .1, 0), M.brass);
      collar.position.set(-hx - 1.31, bW[0], bW[1]); group.add(collar);
      // the CLICK: a pawl riding the ratchet's teeth (a sawtooth of the ratchet's phase)
      const pawl = new THREE.Group();
      pawl.position.set(-hx - 1.17, bW[0] + .5, bW[1] - .05); group.add(pawl);
      const pawlArm = new THREE.Mesh(new THREE.BoxGeometry(.06, .3, .07), M.brass);
      pawlArm.position.y = -.13; pawl.add(pawlArm);
      const pawlHub = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .1, 10).rotateZ(Math.PI / 2), M.chrome);
      pawl.add(pawlHub);

      // the GOVERNOR train (right, low in front): drum wheel → pinion → worm wheel → worm → fan
      const dA = R_R + R_P, lamA = PSI_A - Math.PI;
      const aW = W(dA * Math.cos(lamA), dA * Math.sin(lamA));
      const arborA = new THREE.Group();
      arborA.position.set(0, dA * Math.cos(lamA), dA * Math.sin(lamA));
      core.add(arborA);
      const pinion = new THREE.Mesh(gearGeo(R_P, GEARS.pinion, .14, 0), M.chrome);
      pinion.position.x = hx + .35; arborA.add(pinion);
      const xW = hx + .85;
      const ww = new THREE.Mesh(gearGeo(R_WW, GEARS.worm, .1, 4), M.brass);
      ww.position.x = xW; arborA.add(ww);
      const shaftA = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 1.0, 10).rotateZ(Math.PI / 2), M.chrome);
      shaftA.position.x = hx + .6; arborA.add(shaftA);
      group.add(post(hx + 1.12, aW[0], aW[1], BED, M, .07));
      group.add(post(hx + .12, aW[0], aW[1], BED, M, .07));
      const zWorm = aW[1] + R_WW + R_WORM;                            // the worm stands at the wheel's front
      const govTop = AX_Y + 2.2;
      const worm = new THREE.Group();
      worm.position.set(xW, 0, zWorm);
      group.add(worm);
      const wShaft = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, govTop - BED + .1, 10), M.chrome);
      wShaft.position.y = (govTop + BED) / 2; worm.add(wShaft);
      const helix = new THREE.Mesh(helixGeo(R_WORM, 2 * Math.PI * R_WW / GEARS.worm, .6), M.chrome);
      helix.position.y = aW[0] - .3; worm.add(helix);
      const wCore = new THREE.Mesh(new THREE.CylinderGeometry(R_WORM * .97, R_WORM * .97, .62, 16), M.dark);
      wCore.position.y = aW[0]; worm.add(wCore);
      const fan = new THREE.Group(); fan.position.y = govTop - .2; worm.add(fan);
      for (const s of [-1, 1]){
        const vane = new THREE.Mesh(new THREE.BoxGeometry(.42, .22, .014), M.brass);
        vane.position.x = s * .27; vane.rotation.x = s * .25; fan.add(vane);
      }
      fan.add(new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .34, 12), M.chrome));
      const blurDisc = new THREE.Mesh(new THREE.CylinderGeometry(.48, .48, .2, 40, 1, true), M.blur);
      blurDisc.position.y = govTop - .2; worm.add(blurDisc);
      const gx = xW + .62;                                             // gantry: post + arm to the top bearing
      group.add(post(gx, govTop + .12, zWorm, BED, M, .07, true));
      const arm = new THREE.Mesh(new THREE.BoxGeometry(.62, .08, .1), M.dark);
      arm.position.set(xW + .31, govTop + .12, zWorm); group.add(arm);
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(.12, .16, .14, 16), M.brassD);
      cup.position.set(xW, BED + .07, zWorm); group.add(cup);
      const topCup = cup.clone(); topCup.position.y = govTop + .12; group.add(topCup);

      // the BRAKE: a stop-pin hanging from a lever on the gantry drops into the fan's path and
      // holds the whole train for the count-in (a vane rests against it); it lifts at −Ts and
      // the mainspring spins everything up (solve.js driveTime).
      const fanY = govTop - .2;
      const thA0 = mesh(cylAngle(t0, P), GEARS.drumR, GEARS.pinion, PSI_A - Math.PI);
      const aPark = -GEARS.worm * thA0, aStop = aPark + .2, rStop = .36;
      const stopX = xW + rStop * Math.cos(aStop), stopZ = zWorm - rStop * Math.sin(aStop);
      const pivot = new THREE.Vector3(gx, fanY + .5, zWorm);
      const armV = new THREE.Vector3(stopX - pivot.x, 0, stopZ - pivot.z), armL = armV.length();
      const lever = new THREE.Group(); lever.position.copy(pivot); lever.rotation.y = -Math.atan2(armV.z, armV.x);
      group.add(lever);
      const leverTip = new THREE.Group(); lever.add(leverTip);
      const leverBar = new THREE.Mesh(new THREE.BoxGeometry(armL + .12, .06, .07), M.brass);
      leverBar.position.x = (armL - .12) / 2 + .06; leverTip.add(leverBar);
      const leverHub = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .14, 12).rotateX(Math.PI / 2), M.brassD);
      leverTip.add(leverHub);
      const stopLen = .58;                                             // engaged: its foot .08 below the fan's centre line
      const stop = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, stopLen, 10), M.chrome);
      group.add(stop);
      const stopCap = new THREE.Mesh(new THREE.SphereGeometry(.05, 10, 8), M.amber);
      group.add(stopCap);

      // the drum's bearing standards
      for (const s of [-1, 1]) group.add(standard(s * (hx + .62), AX_Y, AX_Z, BED, M));

      // ---- per-lane juice: tip flash + the approaching bead's glow ----
      for (const l of lanes){
        l.tipGlow = sprite(SIG); l.tipGlow.scale.setScalar(.6); group.add(l.tipGlow);
        l.nextGlow = sprite(GOLD); l.nextGlow.scale.setScalar(.42); group.add(l.nextGlow);
        l.edge = makeEdge(EDGE_W);
      }

      // a soft pool of cyan light on the bed under the comb, fed by the plucks (pure fn of the flashes)
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(comb.cw + 2.4, 3.2).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: glowTex, color: SIG, transparent: true, opacity: 0, depthWrite: false,
          blending: THREE.AdditiveBlending }));
      pool.position.set(0, BED + .02, (comb.zTip + comb.zClamp) / 2); group.add(pool);

      S = { lanes, omega, P, start, Ts, t0, drum, barrel, arborA, worm, fan, blurDisc, beads, pins, baseCol, comb,
            collar, pawl, lever: leverTip, stop, stopCap, stopX, stopZ, pivot, armL, stopLen, fanY, pool, lidMat: kase.lidMat,
            touched: [], tmpC: new THREE.Color() };
      return group;
    }

    function update(songTime, P, dt, { started, skipStrikes, onStrike }){
      if (!S) return;
      const tr = started ? songTime : S.start;         // before play: parked, ARMED at the count-in
      const t = driveTime(tr, S.Ts), rate = driveRate(tr, S.Ts);   // braked → spin-up → running
      const th = cylAngle(t, P);

      // ---- the clockwork: one θ(t) drives every wheel ----
      S.drum.rotation.x = th;
      S.barrel.rotation.x = mesh(th, GEARS.drumL, GEARS.barrel, PSI_B - Math.PI);
      const thA = mesh(th, GEARS.drumR, GEARS.pinion, PSI_A - Math.PI);
      S.arborA.rotation.x = thA;                       // (rotations about x commute with the core's half-turn)
      S.worm.rotation.y = -GEARS.worm * thA;           // single-start worm: one turn per worm-wheel tooth
      const spin = GEARS.worm * GEARS.drumR / GEARS.pinion * 2 * Math.PI / P;   // fan rad/s at full speed
      S.blurDisc.material.opacity = Math.min(.09, rate * spin / 300);
      S.collar.rotation.x = -S.barrel.rotation.x;      // the winding motor's coupling turns with the arbor
      const rph = (((-S.barrel.rotation.x) / (2 * Math.PI / 14)) % 1 + 1) % 1;   // ratchet tooth phase
      S.pawl.rotation.x = -.1 - .32 * rph;             // the click rides up each tooth and drops off it

      // the BRAKE lever: down (stop-pin in the fan's path) until −Ts, lifted over .14 s before it
      const lift = S.Ts > 0 ? smooth(-S.Ts - .14, -S.Ts, tr) : 1;
      const beta = Math.asin(Math.min(.95, .32 / S.armL)) * lift;
      S.lever.rotation.z = beta;
      const ex = S.pivot.x + (S.stopX - S.pivot.x) * Math.cos(beta), ez = S.pivot.z + (S.stopZ - S.pivot.z) * Math.cos(beta);
      const ey = S.pivot.y + S.armL * Math.sin(beta);
      S.stop.position.set(ex, ey - S.stopLen / 2, ez);
      S.stopCap.position.set(ex, ey, ez);

      // ---- restore last frame's lit beads (only the few we touched: O(lanes)) ----
      for (const i of S.touched) S.beads.setColorAt(i, S.baseCol[i]);
      S.touched.length = 0;

      let act = 0;
      for (const l of S.lanes){
        const st = tineAt(l, t, S.t0, S.omega);
        deformTine(l, st);                             // the cantilever bends (CPU, ~100 verts)
        const tp = tipPos(st.w), tw = W(tp[0], tp[1]);
        const vel = st.i >= 0 ? l.vel[st.i] : 1;
        const flash = st.i >= 0 ? ring(st.since, 7) : 0;
        act += flash * (.4 + .6 * vel);
        l.mat.emissiveIntensity = .05 + 1.5 * flash * (.4 + .6 * vel) + .9 * st.env;
        l.tipGlow.position.set(l.x, tw[0] - .03, tw[1] + .05);
        l.tipGlow.material.opacity = Math.min(1, 1.2 * flash * (.4 + .6 * vel) + .3 * st.env);
        l.tipGlow.scale.setScalar(.4 + 1.3 * flash * (.5 + .5 * vel));

        // strike edge: the tine leaves its pin AT the strike
        if (started && !st.armed && l.edge.check(t - st.since, st.since, skipStrikes) && onStrike)
          onStrike({ note: l.note, vel, pos: new THREE.Vector3(l.x, tw[0], tw[1]), color: SIG.getHex(), dur: 0,
            shake: 0, sparks: Math.round(2 + 4 * vel), light: .45 + .5 * vel });

        // beads: the one just plucked flashes ice-white; the coming one warms up as it nears
        if (st.i >= 0 && st.since < 1.2){
          const k = l.pin0 + st.i, f = ring(st.since, 4);
          S.beads.setColorAt(k, S.tmpC.copy(S.baseCol[k]).lerp(SIG, Math.min(1, f * 1.5)).multiplyScalar(1 + 3 * f));
          S.touched.push(k);
        }
        const nx = st.next ?? 0, k2 = l.pin0 + nx;
        const prog = Math.max(0, 1 - st.until / 1.4), p2 = prog * prog;
        if (prog > 0 && k2 < S.pins.length && !(st.i === nx && st.since < 1.2)){
          S.beads.setColorAt(k2, S.tmpC.copy(S.baseCol[k2]).multiplyScalar(1 + 2.2 * p2));
          S.touched.push(k2);
        }
        const psi = PSI_R - S.omega * st.until, rg = GEOM.R + GEOM.BEAD;
        const gw = W(rg * Math.cos(psi), rg * Math.sin(psi));
        l.nextGlow.position.set(l.x, gw[0], gw[1]);
        l.nextGlow.material.opacity = .8 * p2;
      }
      if (S.beads.instanceColor) S.beads.instanceColor.needsUpdate = true;
      const a = 1 - Math.exp(-.7 * act);               // soft-saturating activity of the whole comb
      S.pool.material.opacity = .1 + .55 * a;
      S.lidMat.emissiveIntensity = .28 + .55 * a;
    }

    return { build, update };
  },

  // A C-major ostinato in four bars: chord-and-arpeggio, an Am cascade of 16ths, an F
  // climb, and a G chord that hangs (the long gap) before a high C7 glint pulls it home.
  demo: {
    bpm: 96, beats: 16,
    part: [
      [0, 'C5', .9], [0, 'G5', .8], [0, 'E6', 1],
      [.5, 'C6', .5], [1, 'G5', .55], [1.5, 'E6', .6], [2, 'G6', .75], [2.5, 'E6', .5], [3, 'C6', .55], [3.5, 'G5', .45],
      [4, 'E5', .7], [4, 'A5', .85], [4, 'C6', .8],
      [5, 'A6', .7], [5.25, 'G6', .55], [5.5, 'E6', .6], [5.75, 'D6', .5], [6, 'C6', .75], [6.25, 'B5', .45], [6.5, 'A5', .6],
      [7.5, 'E5', .35],
      [8, 'F5', .9], [8, 'C6', .75], [8, 'A6', .85],
      [8.5, 'F6', .5], [9, 'C6', .5], [9.5, 'A5', .45], [10, 'F6', .65], [10.5, 'G6', .6], [11, 'A6', .7], [11.5, 'B6', .6],
      [12, 'G5', 1], [12, 'B5', .85], [12, 'D6', .9], [12, 'G6', .95],
      [14.5, 'B6', .35], [15, 'E6', .5], [15, 'C7', .8],
    ],
  },
};

/* ================= geometry builders ================= */

/* The tine frame → local: X' along the tine (base → tip), Y' = N (the side pins push),
   Z' across. (y, z) tine-plane vectors map to local (0, y, z). */
const XW = new THREE.Vector3(0, -B[0], -B[1]), YW = new THREE.Vector3(0, N[0], N[1]);
const ZW = new THREE.Vector3().crossVectors(XW, YW);
const TINE_BASIS = new THREE.Matrix4().makeBasis(XW, YW, ZW);

function buildCombMesh(core, group, lanes, { M }){
  const CL = GEOM.L_MAX + .32;                              // the clamp line (from the tip line, toward the base)
  const sp = lanes.length > 1 ? lanes[1].x - lanes[0].x : .44;
  const tipW = sp * .8;                                     // one slit steel plate: slits ≈ .2 of the pitch
  const at = along => new THREE.Vector3(0, T[0] + along * B[0], T[1] + along * B[1]);   // core frame
  // the comb plate behind the tines' roots, out to the clamp line: one instanced piece per tine
  // (unit box scaled to its length) — reads as a single stepped steel spine
  const plate = new THREE.InstancedMesh(new THREE.BoxGeometry(1, TINE_TH * 1.6, sp * 1.001), M.combPlate, Math.max(1, lanes.length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromRotationMatrix(TINE_BASIS), v = new THREE.Vector3(), sc = new THREE.Vector3();
  lanes.forEach((l, k) => {
    // the tine: a box from its base (x'=0) to its tip (x'=len), contact face on y'=0, a touch
    // wider at the root (a real tine is ground to a taper)
    const g = new THREE.BoxGeometry(l.len, TINE_TH, tipW, 20, 1, 1);
    g.translate(l.len / 2, TINE_TH / 2, 0);
    const pa = g.attributes.position.array;
    for (let i = 0; i < pa.length; i += 3) pa[i + 2] *= 1 + .13 * (1 - pa[i] / l.len);
    g.computeVertexNormals();
    l.base = pa.slice();
    l.geo = g;
    l.mat = new THREE.MeshStandardMaterial({ color: 0xc9d3e6, metalness: 1, roughness: .14, envMap: M.chrome.envMap,
      envMapIntensity: 1.4, emissive: SIG, emissiveIntensity: .05 });
    const tg = new THREE.Group();
    tg.matrixAutoUpdate = false;
    const o = at(l.len);
    tg.matrix.copy(TINE_BASIS).setPosition(l.x, o.y, o.z);
    tg.add(new THREE.Mesh(g, l.mat));
    // the BLUR: the envelope a fast-ringing steel tine sweeps — an additive wedge spanning
    // ±amp·φ₁(x) about the rest line, re-derived each frame from the pure ring amplitude
    const bg = g.clone();
    l.blurGeo = bg;
    l.blurMat = new THREE.MeshBasicMaterial({ color: SIG.clone().multiplyScalar(.9), transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending });
    l.blur = new THREE.Mesh(bg, l.blurMat); l.blur.visible = false; l.blur.renderOrder = 2;
    tg.add(l.blur);
    core.add(tg);
    // lead tuning weight under the low tines, riding the bend near the tip
    if (l.rank < LEAD_RANK){
      const wgt = new THREE.Mesh(new THREE.CapsuleGeometry(tipW * .3, l.len * .16, 4, 10).rotateZ(Math.PI / 2), M.lead);
      l.lead = wgt; l.leadX = l.len * .7; tg.add(wgt);
    }
    const plen = CL - l.len, po = at(CL - plen / 2);
    v.set(l.x, po.y, po.z).addScaledVector(new THREE.Vector3(0, N[0], N[1]), TINE_TH * .8);
    plate.setMatrixAt(k, m4.compose(v, q, sc.set(plen, 1, 1)));
  });
  if (!lanes.length) plate.count = 0;
  core.add(plate);
  // the BRIDGE (world frame): a block on the bed under the plate, a clamp bar on top with
  // brass screws, and a cyan light line along its lip
  const cw = lanes.length * sp + .3;
  const c0 = W(at(CL).y, at(CL).z);                              // clamp line, local (y, z), on the contact face
  const dir = Math.sign(W(at(CL).y, at(CL).z)[1] - W(at(0).y, at(0).z)[1]) || 1;   // +1: base is toward +z
  const faceY = c0[0], plateBot = faceY - TINE_TH * 1.6;
  const zMid = c0[1] - dir * .05;
  const block = new THREE.Mesh(new THREE.BoxGeometry(cw, plateBot - BED, .8), M.dark);
  block.position.set(0, (plateBot + BED) / 2, zMid); group.add(block);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(cw, .2, .5), M.dark);
  bar.position.set(0, faceY + .1, zMid + dir * .05); group.add(bar);
  const screws = Math.max(3, Math.round(cw / .55));
  const scr = new THREE.InstancedMesh(new THREE.CylinderGeometry(.07, .07, .05, 12), M.brass, screws);
  for (let i = 0; i < screws; i++)
    scr.setMatrixAt(i, m4.makeTranslation((i / (screws - 1) - .5) * (cw - .3), faceY + .225, zMid + dir * .05));
  group.add(scr);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(cw, .035, .035), M.neon);
  lip.position.set(0, faceY + .19, zMid - dir * .21); group.add(lip);
  return { CL, cw, zTip: W(T[0], T[1])[1], yTip: W(T[0], T[1])[0], zClamp: c0[1] };
}

function deformTine(l, st){
  const pos = l.geo.attributes.position, a = pos.array, b = l.base;
  for (let i = 0; i < a.length; i += 3){
    a[i + 1] = b[i + 1] + shapeAt(b[i], st, l.len);
  }
  pos.needsUpdate = true;
  // the blur wedge: the swept envelope of the ring (top face +amp, bottom face −amp)
  const amp = st.amp || 0;
  l.blur.visible = amp > .004;
  if (l.blur.visible){
    const bp = l.blurGeo.attributes.position, ba = bp.array;
    for (let i = 0; i < ba.length; i += 3){
      const e = amp * phi1(b[i], l.len);
      ba[i + 1] = b[i + 1] > TINE_TH * .5 ? b[i + 1] + e : b[i + 1] - e;
    }
    bp.needsUpdate = true;
    l.blurMat.opacity = Math.min(.5, 2.6 * amp);
  }
  if (l.lead){
    const x = l.leadX, y = shapeAt(x, st, l.len);
    const slope = (shapeAt(x + .02, st, l.len) - shapeAt(x - .02, st, l.len)) / .04;
    l.lead.position.set(x, y + TINE_TH + .05, 0);
    l.lead.rotation.z = Math.atan(slope);
  }
}

/* The case: a lacquered navy plinth with a brass bed plate and a cyan trim line, on a
   tapering pedestal that stands on the room floor (nothing floats). Its LID stands open
   behind the mechanism on two brass hinges, held by a stay — the silhouette that reads
   "music box" from across the room; its inner face carries a gold-and-cyan inlay that
   brightens with the comb's activity. */
const CASE = { W: 9.7, D0: -4.35, D1: 4.35 };
function buildCase(group, M, floorY, glowTex){
  const CW = CASE.W, D0 = CASE.D0, D1 = CASE.D1, Dd = D1 - D0, zc = (D0 + D1) / 2;
  const body = new THREE.Mesh(new THREE.BoxGeometry(CW, BED - .06, Dd), M.case);
  body.position.set(0, (BED - .06) / 2, zc); group.add(body);
  const bed = new THREE.Mesh(new THREE.BoxGeometry(CW - .3, .06, Dd - .3), M.bed);
  bed.position.set(0, BED - .03, zc); group.add(bed);
  for (const y of [.18, BED - .1]){
    const band = new THREE.Mesh(new THREE.BoxGeometry(CW + .04, .05, Dd + .04), M.brass);
    band.position.set(0, y, zc); group.add(band);
  }
  const neon = new THREE.Mesh(new THREE.BoxGeometry(CW + .06, .035, .035), M.neon);
  neon.position.set(0, BED - .2, D1 + .03); group.add(neon);
  // pedestal: the deck is at y=0; the column runs down to the floor
  if (floorY < -.5){
    const h = -floorY;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.2, h, 4, 1).rotateY(Math.PI / 4), M.case);
    ped.scale.set(1.15, 1, .95);
    ped.position.set(0, -h / 2, zc); group.add(ped);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(CW + .3, .3, Dd + .3), M.dark);
    cap.position.set(0, -.15, zc); group.add(cap);
  }
  // the LID: hinged on the case's back edge, standing open at 88° (leaning a hair forward,
  // its weight on the stay). Built lying closed along +z from the hinge, then swung up.
  const LT = .16, ang = 88 * Math.PI / 180;
  const lid = new THREE.Group();
  lid.position.set(0, BED, D0 + LT / 2); lid.rotation.x = -ang;
  group.add(lid);
  const shell = new THREE.Mesh(new THREE.BoxGeometry(CW, LT, Dd - LT), M.case);
  shell.position.set(0, LT / 2, (Dd - LT) / 2); lid.add(shell);
  const inlayTex = inlayTexture();
  const lidMat = new THREE.MeshStandardMaterial({ color: 0x1a2236, metalness: .5, roughness: .35, envMap: M.case.envMap,
    map: inlayTex, emissiveMap: inlayTex, emissive: new THREE.Color(0xffffff), emissiveIntensity: .28 });
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(CW - .5, Dd - .6).rotateX(Math.PI / 2), lidMat);
  inner.position.set(0, -.002, (Dd - LT) / 2); lid.add(inner);         // the face toward the audience once open
  const edge = new THREE.Mesh(new THREE.BoxGeometry(CW + .04, .05, .05), M.brass);
  edge.position.set(0, LT / 2, Dd - LT); lid.add(edge);
  for (const sx of [-1, 1]){
    const side = new THREE.Mesh(new THREE.BoxGeometry(.05, .05, Dd - LT), M.brass);
    side.position.set(sx * CW / 2, LT / 2, (Dd - LT) / 2); lid.add(side);
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .7, 14).rotateZ(Math.PI / 2), M.brass);
    hinge.position.set(sx * (CW / 2 - .9), BED, D0); group.add(hinge);
  }
  // the STAY: a brass rod from the case's side to the lid, holding it open
  const lp = new THREE.Vector3(CW / 2 + .06, 0, 2.4).applyEuler(lid.rotation).add(lid.position);   // on the lid
  const cp = new THREE.Vector3(CW / 2 + .06, BED - .05, D0 + 1.9);                                  // on the case
  const sv = lp.clone().sub(cp);
  const stay = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, sv.length(), 8), M.chrome);
  stay.position.copy(cp).addScaledVector(sv, .5);
  stay.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sv.clone().normalize());
  group.add(stay);
  return { lid, lidMat };
}

/* The lid's inlay: navy lacquer, a double gold-leaf border, a cyan star-and-scroll filigree
   (emissive: the texture is both colour and glow). */
function inlayTexture(){
  const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!cv) return null;
  const Wd = 1024, H = 1024;
  cv.width = Wd; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#05070f'; g.fillRect(0, 0, Wd, H);
  g.strokeStyle = 'rgba(255,190,90,.95)'; g.lineWidth = 10; g.strokeRect(34, 34, Wd - 68, H - 68);
  g.strokeStyle = 'rgba(255,190,90,.55)'; g.lineWidth = 3; g.strokeRect(62, 62, Wd - 124, H - 124);
  // corner fans
  g.strokeStyle = 'rgba(255,190,90,.6)'; g.lineWidth = 3;
  for (const [cx, cy, a0] of [[62, 62, 0], [Wd - 62, 62, Math.PI / 2], [Wd - 62, H - 62, Math.PI], [62, H - 62, -Math.PI / 2]])
    for (let r = 40; r <= 120; r += 40){ g.beginPath(); g.arc(cx, cy, r, a0, a0 + Math.PI / 2); g.stroke(); }
  // a ring of cyan stars + a central star-burst rose
  const cx = Wd / 2, cy = H / 2;
  g.strokeStyle = 'rgba(120,225,255,.75)'; g.lineWidth = 2.5;
  for (let r = 150; r <= 330; r += 90){ g.beginPath(); g.arc(cx, cy, r, 0, 2 * Math.PI); g.stroke(); }
  for (let k = 0; k < 24; k++){
    const a = k * Math.PI / 12, r0 = k % 2 ? 160 : 110, r1 = k % 2 ? 300 : 360;
    g.beginPath(); g.moveTo(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)); g.lineTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)); g.stroke();
  }
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 140; i++){
    const x = 80 + rnd() * (Wd - 160), y = 80 + rnd() * (H - 160), r = .8 + rnd() * 2.6;
    g.fillStyle = rnd() < .75 ? 'rgba(160,235,255,.9)' : 'rgba(255,200,120,.9)';
    g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fill();
  }
  const grd = g.createRadialGradient(cx, cy, 0, cx, cy, 120);
  grd.addColorStop(0, 'rgba(200,245,255,.45)'); grd.addColorStop(1, 'rgba(120,225,255,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, 120, 0, 2 * Math.PI); g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* A brass A-frame bearing standard at x carrying an axis at (y, z). */
function standard(x, y, z, bed, M){
  const g = new THREE.Group();
  const h = y - bed;
  for (const s of [-1, 1]){
    const leg = new THREE.Mesh(new THREE.BoxGeometry(.16, Math.hypot(h, .7), .16), M.brass);
    leg.position.set(x, bed + h / 2, z + s * .35);
    leg.rotation.x = s * Math.atan2(.7, h);
    g.add(leg);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, .22, 20).rotateZ(Math.PI / 2), M.brassD);
  hub.position.set(x, y, z); g.add(hub);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(.4, .1, 1.7), M.dark);
  foot.position.set(x, bed + .05, z); g.add(foot);
  return g;
}

/* A simple post from the bed up to an arbor at (y, z) (or a plain column if top). */
function post(x, y, z, bed, M, r = .08, plain = false){
  const g = new THREE.Group();
  const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.3, y - bed, 12), M.dark);
  p.position.set(x, (y + bed) / 2, z); g.add(p);
  if (!plain){
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.9, r * 1.9, .14, 16).rotateZ(Math.PI / 2), M.brassD);
    hub.position.set(x, y, z); g.add(hub);
  }
  return g;
}

/* A spur gear in the (y, z) plane, axis +x, centred on x = 0; tooth 0 at ψ = 0 (+y).
   spokes > 0 cuts that many windows. ratchet = sawtooth teeth. */
function gearGeo(r, nT, th, spokes = 0, ratchet = false){
  const m = 2 * r / nT, ra = r + m, rd = r - 1.25 * m, p = 2 * Math.PI / nT;
  const shape = new THREE.Shape();
  const pt = (rr, a, first) => first ? shape.moveTo(rr * Math.cos(a), rr * Math.sin(a)) : shape.lineTo(rr * Math.cos(a), rr * Math.sin(a));
  for (let k = 0; k < nT; k++){
    const a = k * p;
    if (ratchet){ pt(rd, a - .5 * p, k === 0); pt(ra, a + .45 * p); pt(rd, a + .5 * p); continue; }
    pt(rd, a - .5 * p, k === 0); pt(rd, a - .27 * p); pt(ra, a - .13 * p); pt(ra, a + .13 * p); pt(rd, a + .27 * p);
  }
  shape.closePath();
  if (spokes > 0){
    const ri = Math.max(.12, r * .28), ro = rd - Math.max(.06, r * .12), sw = Math.min(.35, 1.6 / spokes);
    for (let s = 0; s < spokes; s++){
      const a0 = s * 2 * Math.PI / spokes + sw / 2, a1 = (s + 1) * 2 * Math.PI / spokes - sw / 2;
      const h = new THREE.Path();
      h.moveTo(ri * Math.cos(a0), ri * Math.sin(a0));
      h.absarc(0, 0, ro, a0, a1, false);
      h.absarc(0, 0, ri, a1, a0, true);
      shape.holes.push(h);
    }
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -th / 2);
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));   // (sx, sy, ext) → (y, z, x)
  g.computeVertexNormals();
  return g;
}

/* A flat spiral mainspring in the (y, z) plane. */
function spiralGeo(r0, r1, turns, tube){
  const pts = [];
  const nS = Math.round(turns * 48);
  for (let i = 0; i <= nS; i++){
    const u = i / nS, a = u * turns * 2 * Math.PI, r = r0 + (r1 - r0) * u;
    pts.push(new THREE.Vector3(0, r * Math.cos(a), r * Math.sin(a)));
  }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), nS, tube, 5, false);
  g.scale(4, 1, 1);                                        // a ribbon: wide along the axis, thin radially
  return g;
}

/* The worm's thread: a helix around +y of the given pitch. */
function helixGeo(r, pitch, len){
  const pts = [], turns = len / pitch, nS = Math.round(turns * 24);
  for (let i = 0; i <= nS; i++){
    const u = i / nS, a = u * turns * 2 * Math.PI;
    pts.push(new THREE.Vector3(r * Math.cos(a), u * len, r * Math.sin(a)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), nS, .05, 6, false);
}

/* The SCORE: the drum's brass skin, engraved with one groove per tine and a line per beat
   (heavier at each bar) — the piano roll wrapped round the cylinder. u ↔ ψ − π/2. */
function scoreTexture(lanes, { Lc, hx, omega, rollT, beat, loopBeats, P }){
  const W = 2048, H = 512;
  const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!cv) return null;
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#c99a4e'); grd.addColorStop(.5, '#e2b867'); grd.addColorStop(1, '#c08f45');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.globalAlpha = .06;                                     // brushed metal
  for (let i = 0; i < 260; i++){ g.fillStyle = i % 2 ? '#fff3cf' : '#5a3a10'; g.fillRect(0, (i * 97) % H, W, 1); }
  g.globalAlpha = 1;
  const uOf = phi => ((((phi - Math.PI / 2) / (2 * Math.PI)) % 1) + 1) % 1;
  // beat lines
  for (let b = 0; b <= loopBeats; b++){
    const u = uOf(PSI_R - omega * (rollT + b * beat));
    const bar = b % 4 === 0;
    g.fillStyle = bar ? 'rgba(50,26,4,.9)' : 'rgba(80,46,12,.55)';
    g.fillRect(u * W - (bar ? 6 : 2), 0, bar ? 12 : 4, H);
    g.fillStyle = bar ? 'rgba(255,232,170,.6)' : 'rgba(255,232,170,.25)';
    g.fillRect(u * W + (bar ? 6 : 2), 0, bar ? 3 : 1, H);
  }
  // the blank roll-in sector: a darker band with a centre seam mark
  const u0 = uOf(PSI_R - omega * (rollT + loopBeats * beat)), u1 = uOf(PSI_R - omega * (rollT + P - rollT));
  const uS = uOf(PSI_R - omega * rollT);
  g.fillStyle = 'rgba(40,22,6,.18)';
  const span = ((uS - u0) % 1 + 1) % 1;
  for (let i = 0; i < 64; i++){ const u = (u0 + span * i / 64) % 1; g.fillRect(u * W, 0, span * W / 64 + 1, H); }
  // tine grooves
  for (const l of lanes){
    const v = (l.x + hx) / Lc, y = (1 - v) * H;
    g.fillStyle = 'rgba(60,34,8,.55)'; g.fillRect(0, y - 2, W, 4);
    g.fillStyle = 'rgba(255,236,180,.35)'; g.fillRect(0, y + 2, W, 1);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
