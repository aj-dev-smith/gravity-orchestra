import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeEdge, ring, smooth, laneClock, at } from '../clock.js';
import { noteNum } from '../../engine.js';
import { GEOM, X_RAIL, xOfRank, buildVolley, ballAt, shuttleAt, padPose, forPads, maxPads, solOf } from './solve.js';
import { steelpanVoice } from './voice.js';

/* ============================================================
   VOLLEY — two walls, one marble, traded over the audience's heads.

   A flying COURT hangs over the front of the stage (cables to the
   ceiling, above the audience's sightline to the belt): two slat
   paternosters face each other across a net, a bridge rail spans their
   crowns, and one immortal marble is volleyed between them — the
   phrase on the left wall, the long note that ends it SERVES the
   marble over the net, the right wall answers. Pitch is height on the
   wall's staff (glowing ticks on each strike column), pad size is
   register.

   Every pad is manufactured for its strike: it rides its own slat out
   of the back cowl folded edge-on, its boom telescopes into the court,
   its knuckle tips the disc to the bounce normal, it cocks, and it
   crosses the strike column exactly on its beat (the slats slide along
   the face, so the struck face is at rest but for its own stroke). The
   long lobs ride the bridge's electromagnet shuttle — caught at the apex
   at zero relative speed, carried level, dropped onto the beat. In the
   count-in the marble hangs armed on it.

   All of it is a pure function of songTime (solve.js; tested in
   test/inst-volley.test.js). Constant material/mesh counts after build.
   ============================================================ */

const EDGE_W = .25;
const TRAIL_N = 18, TRAIL_DT = .02;
const SIG = new THREE.Color(0xb8ff5a);              // signature: electric lime (court lines, net cable, rail strip)
const { XF, RM, Y_M, NET_H, PAD_T, ARM } = GEOM;
const RS = .3;                                      // chain sprocket radius: court strand at |x| = XF, back strand XF + 2·RS
const XB = XF + 2 * RS;                             // back strand
const Y_CH0 = 1.95, Y_CH1 = 7.75;                   // the bottom / top chains (the slats run between them)
const Y_BEAM0 = 1.8, Y_BEAM1 = 7.9, Y_TOP = 8.55;   // bottom beam top, top beam underside / top
const CW = 1.0;                                     // cowl length past the open run
const OUT = XB + .4;                                // the frame's outer face |x|
const COIL_H = .4, COIL_R = .27;
const Y_COIL = Y_M + RM;                            // magnet face
const Y_CAR = Y_COIL + COIL_H + .38;                // carriage centre (it hangs under the rail)
const Y_RAIL = Y_CAR + .38;
const LINK = .19;                                   // chain pitch
const TICK_Z = .34;                                 // the strike column's two posts sit at z = ±TICK_Z
const hueOf = rank => .07 + .43 * rank;             // amber (low) → lime → sea-green (high)
const PAD_BASE = new THREE.Color(0xa4adbf);

export default {
  key: 'volley',
  label: 'Volley',
  wet: true,
  lookHeight: 4.6,
  camera: { dist: 21, up: 5, x: 6 },                      // (hung: main shoots it from just under its deck, looking in)
  color: '#b8ff5a',                                 // electric lime
  directorWeight: 1.15,                             // one line, traded: the long serves are story beats
  voice: id => steelpanVoice(id),

  make({ envMap, glowTex }){
    let S = null;

    function build(part, { rollT, beat, P, start, floorY = -20, ceilY }){
      const group = new THREE.Group();
      const R = buildVolley(part, { rollT, beat, P, start });
      if (R.warnings.length) console.warn('[volley]', R.warnings.join('; '));
      const ZW = R.ZW || GEOM.ZW_MIN;
      const POOL = Math.max(1, maxPads(R));

      // ---- materials (a fixed set) ----
      const M = {
        chrome: new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: .14, envMap, envMapIntensity: 1.3 }),
        dark:   new THREE.MeshStandardMaterial({ color: 0x232733, metalness: .7, roughness: .45, envMap }),
        lacquer: new THREE.MeshStandardMaterial({ color: 0x0b0e18, metalness: .5, roughness: .24, envMap, envMapIntensity: 1.1 }),
        brass:  new THREE.MeshStandardMaterial({ color: 0xd9a650, metalness: 1, roughness: .26, envMap, envMapIntensity: 1.2 }),
        alu:    new THREE.MeshStandardMaterial({ color: 0x9aa3b4, metalness: 1, roughness: .32, envMap }),
        steel:  new THREE.MeshStandardMaterial({ color: 0x6d7484, metalness: 1, roughness: .38, envMap }),
        rubber: new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: .1, roughness: .8 }),
        padTop: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .55, roughness: .22, envMap, envMapIntensity: 1.25 }),
        neon:   new THREE.MeshBasicMaterial({ color: SIG.clone().multiplyScalar(1.4) }),
        line:   new THREE.MeshBasicMaterial({ color: SIG.clone().multiplyScalar(.55) }),
        coil:   new THREE.MeshStandardMaterial({ color: 0x3d5a1c, metalness: .8, roughness: .35, envMap,
                  emissive: SIG.clone(), emissiveIntensity: .1 }),
        marble: new THREE.MeshStandardMaterial({ color: 0xf2ffe0, metalness: .3, roughness: .18, envMap,
                  emissive: new THREE.Color(0xc8ff70), emissiveIntensity: 1.15 }),
        rim:    new THREE.MeshBasicMaterial({ color: 0xffffff }),              // per-instance colour = glow
        tick:   new THREE.MeshBasicMaterial({ color: 0xffffff }),              // per-instance colour = the staff
        column: new THREE.MeshBasicMaterial({ color: SIG.clone().multiplyScalar(.35) }),
        slotL:  new THREE.MeshBasicMaterial({ color: SIG.clone().multiplyScalar(.3) }),
        slotR:  new THREE.MeshBasicMaterial({ color: SIG.clone().multiplyScalar(.3) }),
        net:    new THREE.LineBasicMaterial({ color: SIG.clone().multiplyScalar(.22), transparent: true,
                  blending: THREE.AdditiveBlending, depthWrite: false }),
        netTop: new THREE.MeshBasicMaterial({ color: SIG.clone().multiplyScalar(.9) }),
      };
      M.net.userData.noFadeGate = true;                // (always faintly on — it IS the net)

      // ---- the court deck (a hung platform), the walls, the net, the bridge ----
      buildDeck(group, M, ZW);
      for (const s of [-1, 1]) buildWall(group, M, s, ZW);
      buildNet(group, M, ZW);
      buildBridge(group, M);
      buildRigging(group, M, ZW, ceilY ?? (floorY + 56), floorY);

      // ---- the chains (one InstancedMesh for all four loops: top + bottom on each wall) ----
      const loopLen = 2 * (2 * (ZW + .5)) + 2 * Math.PI * RS;
      const NL = Math.ceil(loopLen / LINK);
      const links = new THREE.InstancedMesh(new THREE.BoxGeometry(.15, .07, .09), M.steel, NL * 4);
      links.frustumCulled = false; group.add(links);
      // the sprockets (8: front/back × top/bottom × two walls), each turned by its chain — one instanced draw
      const SPR = [];
      for (const s of [-1, 1]) for (const zs of [-1, 1]) for (const y of [Y_CH0, Y_CH1]) SPR.push({ s, pos: new THREE.Vector3(s * (XF + RS), y, zs * (ZW + .5)) });
      const sprockets = new THREE.InstancedMesh(sprocketGeo(), M.chrome, SPR.length);
      sprockets.frustumCulled = false; group.add(sprockets);

      // ---- the pads: a pool, re-derived every frame. Each = a disc (tinted its note) with a glowing rim,
      //      on an ARM from a brass KNUCKLE at the end of a telescoping BOOM from a SHOE clamped on its SLAT ----
      const padGeo = new THREE.CylinderGeometry(1, 1, PAD_T, 40).translate(0, -PAD_T / 2, 0);
      const pads = new THREE.InstancedMesh(padGeo, M.padTop, POOL);
      const rims = new THREE.InstancedMesh(new THREE.TorusGeometry(1, .1, 6, 40).rotateX(Math.PI / 2), M.rim, POOL);
      const arms = new THREE.InstancedMesh(new THREE.CylinderGeometry(.04, .04, 1, 10).translate(0, .5, 0), M.chrome, POOL);
      const booms = new THREE.InstancedMesh(new THREE.CylinderGeometry(.055, .055, 1, 10).translate(0, .5, 0), M.chrome, POOL);
      const knuckles = new THREE.InstancedMesh(new THREE.SphereGeometry(.085, 14, 10), M.brass, POOL);
      const shoes = new THREE.InstancedMesh(new THREE.BoxGeometry(.2, .28, .2), M.dark, POOL);
      const slats = new THREE.InstancedMesh(new THREE.CylinderGeometry(.035, .035, 1, 8).translate(0, .5, 0), M.alu, POOL);
      const IMS = [pads, rims, arms, booms, knuckles, shoes, slats];
      for (const im of IMS){ im.count = 0; im.frustumCulled = false; group.add(im); }
      rims.setColorAt(0, new THREE.Color()); pads.setColorAt(0, new THREE.Color());

      // ---- the staff: a glowing tick on each wall's strike column at every note's contact height ----
      const st = R.staff;
      const notes = st ? [...new Set(R.evs.map(e => e.note))].sort((a, b) => noteNum(a) - noteNum(b)) : [];
      const lanes = notes.map(note => {
        const rank = (noteNum(note) - st.loN) / st.span;
        const col = new THREE.Color().setHSL(hueOf(rank), .85, .55);
        const perSide = s => laneClock(R.evs.filter(e => e.note === note && e.side === s).map(e => e.s), P);
        return { note, rank, col, y: st.yOf(note), L: { '-1': perSide(-1), '1': perSide(1) } };
      });
      const laneOf = Object.fromEntries(lanes.map(l => [l.note, l]));
      R.evs.forEach(e => { e.col = laneOf[e.note].col; });
      // (a tick = a bar across the strands at each column post: it faces the audience)
      const ticks = new THREE.InstancedMesh(new THREE.BoxGeometry(2 * RS + .3, .06, .06), M.tick, Math.max(1, lanes.length * 4));
      ticks.frustumCulled = false; group.add(ticks);
      { const m4 = new THREE.Matrix4(); let j = 0;
        for (const l of lanes) for (const s of [-1, 1]) for (const zs of [-1, 1]){
          ticks.setMatrixAt(j, m4.makeTranslation(s * (XF + RS), l.y, zs * TICK_Z)); ticks.setColorAt(j, l.col.clone().multiplyScalar(.2)); j++; }
        ticks.count = j; }

      // ---- the shuttle: a carriage hanging under the bridge rail, a rod, the coil + its face
      //      (one merged geometry per material: five draws for the whole trolley) ----
      const shuttle = new THREE.Group(); group.add(shuttle);
      const trolley = (mat, geos) => shuttle.add(new THREE.Mesh(mergeFlat(geos), mat));
      trolley(M.alu, [new THREE.BoxGeometry(.78, .34, .56).translate(0, Y_CAR, 0)]);
      trolley(M.dark, [-1, 1].flatMap(sx => [-1, 1].map(sz => new THREE.CylinderGeometry(.08, .08, .07, 12).rotateX(Math.PI / 2).translate(sx * .25, Y_RAIL - .02, sz * .2))));
      const rodL = Y_CAR - .17 - (Y_COIL + COIL_H);
      trolley(M.chrome, [new THREE.CylinderGeometry(.05, .05, rodL, 10).translate(0, Y_COIL + COIL_H + rodL / 2, 0),
                      new THREE.CylinderGeometry(COIL_R * .9, COIL_R * .9, .04, 24).translate(0, Y_COIL + .02, 0)]);
      trolley(M.coil, [new THREE.CylinderGeometry(COIL_R, COIL_R, COIL_H, 24).translate(0, Y_COIL + COIL_H / 2, 0)]);
      trolley(M.brass, [.11, .22, .33].map(y => new THREE.TorusGeometry(COIL_R + .01, .017, 6, 24).rotateX(Math.PI / 2).translate(0, Y_COIL + y, 0)));
      // its power cable, festooned along the rail back to the left pylon
      const cable = new THREE.Mesh(new THREE.BoxGeometry(1, .05, .07), M.rubber);
      cable.userData.noMerge = true; group.add(cable);

      // ---- the marble ----
      const marble = new THREE.Mesh(new THREE.SphereGeometry(RM, 32, 24), M.marble);
      group.add(marble);

      // ---- one Points cloud: ball halo + ghosts + contact flare + magnet halo + next-pad flare + net flash ----
      const NPT = 1 + TRAIL_N + 4;
      const halo = makeHaloCloud(NPT, glowTex);
      group.add(halo.points);
      for (let i = 0; i < 1 + TRAIL_N; i++) halo.col.setXYZ(i, .8, 1, .55);
      halo.col.setXYZ(2 + TRAIL_N, .7, 1, .35);                       // magnet
      halo.col.setXYZ(NPT - 1, SIG.r, SIG.g, SIG.b);                  // the net cable's flash

      // pure-fn clocks for the furniture: the marble crossing the net (each volley), each wall's
      // front cowl swallowing a struck pad (its re-tuning window pulses)
      const crossT = [];
      R.evs.forEach((e, i) => { const b = R.evs[(i + 1) % R.n]; if (R.n > 1 && e.side !== b.side && e.u) crossT.push(e.s + (0 - e.C[0]) / e.u); });
      const netL = laneClock(crossT, P);
      const intoCowl = s => laneClock(R.evs.filter(e => e.side === s).map(e => e.s + ZW / R.V), P);
      S = { R, P, start, ZW, POOL, pads, rims, arms, booms, knuckles, shoes, slats, IMS, links, NL, loopLen, sprockets, SPR,
            ticks, lanes, shuttle, cable, coil: M.coil, marble, marbleMat: M.marble, halo, NPT, netL, netTop: M.netTop, netMat: M.net,
            cowl: { '-1': { L: intoCowl(-1), mat: M.slotL }, '1': { L: intoCowl(1), mat: M.slotR } },
            edge: makeEdge(EDGE_W),
            m4: new THREE.Matrix4(), q: new THREE.Quaternion(), qi: new THREE.Quaternion(), v: new THREE.Vector3(),
            sc: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), nv: new THREE.Vector3(), dv: new THREE.Vector3(), c: new THREE.Color() };
      return group;
    }

    function update(songTime, P, dt, { started, skipStrikes, onStrike }){
      if (!S || !S.R.n) return;
      const R = S.R, t = started ? songTime : S.start;
      const { m4, q, qi, v, sc, nv, dv, c } = S;

      // ---- the chains + sprockets (slip-free: everything scrolls at V) ----
      const run = R.V * t;
      {
        const Z = S.ZW + .5, L = S.loopLen, straight = 2 * Z, arc = Math.PI * RS;
        let j = 0;
        for (const s of [-1, 1]) for (const y of [Y_CH0, Y_CH1]){
          for (let k = 0; k < S.NL; k++){
            // arclength along the loop: the court strand runs +z (toward the audience)
            let a = ((k * LINK + run) % L + L) % L, x, z, yaw;
            if (a < straight){ x = s * XF; z = -Z + a; yaw = 0; }
            else if ((a -= straight) < arc){ const th = a / RS; x = s * (XF + RS - RS * Math.cos(th)); z = Z + RS * Math.sin(th); yaw = s * th; }
            else if ((a -= arc) < straight){ x = s * XB; z = Z - a; yaw = 0; }
            else { a -= straight; const th = a / RS; x = s * (XF + RS + RS * Math.cos(th)); z = -Z - RS * Math.sin(th); yaw = s * th; }
            q.setFromAxisAngle(S.up, yaw + Math.PI / 2);
            S.links.setMatrixAt(j++, m4.compose(v.set(x, y, z), q, sc.set(1, 1, 1)));
          }
        }
        S.links.instanceMatrix.needsUpdate = true;
        S.SPR.forEach((sp, k) => S.sprockets.setMatrixAt(k, m4.compose(sp.pos, q.setFromAxisAngle(S.up, -sp.s * run / RS), sc.set(1, 1, 1))));
        S.sprockets.instanceMatrix.needsUpdate = true;
      }

      // ---- the marble ----
      const b = ballAt(R, t);
      S.marble.position.set(b.p[0], b.p[1], b.p[2]);
      const sp = Math.hypot(b.v[0], b.v[1]), sq = b.i >= 0 ? .28 * ring(b.since, 22) : 0;
      if (sp > .05){ nv.set(b.v[0], b.v[1], 0).divideScalar(sp); S.marble.quaternion.setFromUnitVectors(S.up, nv); }
      const stch = Math.min(.12, sp * .012) - sq;
      S.marble.scale.set(1 - stch * .5, 1 + stch, 1 - stch * .5);
      const ev = b.i >= 0 ? R.evs[b.i] : null;
      const since = b.i >= 0 ? b.since : Infinity;
      const vel = ev ? ev.vel : 0;
      S.marbleMat.emissiveIntensity = Math.min(1.6, 1.05 + .55 * vel * ring(since, 7));

      // ---- strike edge: fire once, at the contact ----
      if (started && ev && S.edge.check(b.abs, since, skipStrikes) && onStrike){
        const sol = solOf(R, b.i, b.abs), prev = R.evs[(b.i - 1 + R.n) % R.n];
        const volley = R.n > 1 && prev.side !== ev.side;
        onStrike({ note: ev.note, vel, pos: new THREE.Vector3(sol.S[0], sol.S[1], sol.S[2]), color: ev.col.getHex(), dur: 0,
          shake: prev.park ? .045 : volley ? .025 : 0, sparks: Math.round((volley ? 5 : 3) + 4 * vel), light: .55 + .5 * vel });
      }

      // ---- the shuttle + magnet ----
      const sh = shuttleAt(R, t);
      S.shuttle.position.x = sh.x;
      const anchor = -(XF + .9), cl = sh.x - anchor;
      S.cable.position.set((sh.x + anchor) / 2, Y_RAIL + .2, .26); S.cable.scale.set(Math.max(.01, cl), 1, 1);
      let on = .1;
      if (b.mode === 'held') on = .9;
      else if (b.mode === 'hold'){ const docked = b.since - ev.tUp; on = .8 + 2.5 * Math.exp(-docked * 9); }
      else if (b.mode === 'rise') on = .1 + .7 * smooth(ev.tUp - .35, ev.tUp, b.since);
      S.coil.emissiveIntensity = .1 + 1.6 * on;

      // ---- the staff ticks: each flashes when its note sounds on that wall ----
      { let j = 0;
        for (const l of S.lanes) for (const s of [-1, 1]){
          const L = l.L[s], cc = L.s.length ? at(L, t, R.first) : null, f = !cc || cc.armed ? 0 : ring(cc.since, 2.4);
          c.copy(l.col).multiplyScalar(.28 + 2.4 * f);
          S.ticks.setColorAt(j++, c); S.ticks.setColorAt(j++, c);
        }
        if (S.ticks.instanceColor) S.ticks.instanceColor.needsUpdate = true; }

      // ---- the pads ----
      const nextK = b.i >= 0 ? (b.i + 1) % R.n : R.firstIdx;
      const nextAbs = b.i >= 0 ? b.abs + ev.gap : R.first;
      const prog = b.i >= 0 ? Math.min(1, b.since / ev.gap) : smooth(R.tRel - 1.5, R.first, t);
      let j = 0;
      forPads(R, t, (k, abs) => {
        if (j >= S.POOL) return;
        const e = R.evs[k], p = padPose(R, k, abs, t), s = e.side;
        nv.set(p.n[0], p.n[1], p.n[2]);
        q.setFromUnitVectors(S.up, nv);
        S.pads.setMatrixAt(j, m4.compose(v.set(p.top[0], p.top[1], p.top[2]), q, sc.set(e.rho, 1, e.rho)));
        v.addScaledVector(nv, .004);
        S.rims.setMatrixAt(j, m4.compose(v, q, sc.set(e.rho, e.rho, e.rho)));
        const [kx, ky, kz] = p.knuckle, [hx, hy, hz] = p.shoe;
        S.arms.setMatrixAt(j, m4.compose(v.set(kx, ky, kz), q, sc.set(1, Math.max(.001, ARM + p.off - PAD_T), 1)));
        S.knuckles.setMatrixAt(j, m4.compose(v.set(kx, ky, kz), qi, sc.set(1, 1, 1)));
        S.shoes.setMatrixAt(j, m4.compose(v.set(hx, hy, hz), qi, sc.set(1, 1, 1)));
        const bl = Math.abs(kx - hx);
        S.booms.setMatrixAt(j, m4.compose(v.set(hx, hy, hz), q.setFromUnitVectors(S.up, dv.set(-s, 0, 0)), sc.set(1, Math.max(.001, bl), 1)));
        S.slats.setMatrixAt(j, m4.compose(v.set(s * XF, Y_CH0, hz), qi, sc.set(1, Y_CH1 - Y_CH0, 1)));
        // the disc: its note's colour, brightening as it becomes the target; the contact flash
        const isNext = k === nextK && Math.abs(abs - nextAbs) < 1e-6;
        const hot = (isNext ? prog * prog : 0) + (p.live && t >= abs ? e.vel * ring(t - abs, 4) : 0);
        S.pads.setColorAt(j, c.copy(PAD_BASE).lerp(e.col, .7).multiplyScalar(.7 + .4 * p.extend + 1.1 * hot));
        let gl = .45 + .55 * p.tilt;
        if (isNext) gl += 2.2 * prog * prog;
        if (p.live && t >= abs) gl += 2.8 * e.vel * ring(t - abs, 3.5);
        gl *= .45 + .55 * p.extend;
        S.rims.setColorAt(j, c.copy(e.col).multiplyScalar(gl));
        j++;
      });
      for (const im of S.IMS){ im.count = j; im.instanceMatrix.needsUpdate = true; }
      S.rims.instanceColor.needsUpdate = true; S.pads.instanceColor.needsUpdate = true;

      // ---- the cowls' re-tuning windows: a pulse as each struck pad slides in ----
      for (const s of ['-1', '1']){
        const w = S.cowl[s];
        const cc = w.L.s.length ? at(w.L, t, R.first) : null, f = !cc || cc.armed ? 0 : ring(cc.since, 4);
        w.mat.color.copy(SIG).multiplyScalar(.3 + 2 * f);
      }
      // ---- the net: its top cable flashes as the marble sails over ----
      const nc = S.netL.s.length ? at(S.netL, t, R.first) : null, nf = !nc || nc.armed ? 0 : ring(nc.since, 3.5);
      S.netTop.color.copy(SIG).multiplyScalar(.75 + 1.6 * nf);
      S.netMat.color.copy(SIG).multiplyScalar(.2 + .5 * nf);

      // ---- halos / trail ----
      const H = S.halo, HP = H.pos.array, HA = H.alpha.array, HS = H.size.array;
      HP[0] = b.p[0]; HP[1] = b.p[1]; HP[2] = b.p[2];
      HA[0] = .32 + .22 * vel * ring(since, 6); HS[0] = RM * (4.2 - 1.6 * ring(since, 10));
      const spd = Math.min(1, sp / 6);
      for (let k = 0; k < TRAIL_N; k++){
        const pi = 1 + k, tk = t - (k + 1) * TRAIL_DT;
        if (tk < S.start || spd < .05 || b.mode === 'held' || b.mode === 'hold'){ HA[pi] = 0; continue; }
        const bk = ballAt(R, tk);
        HP[pi * 3] = bk.p[0]; HP[pi * 3 + 1] = bk.p[1]; HP[pi * 3 + 2] = bk.p[2];
        const f = 1 - (k + 1) / (TRAIL_N + 1);
        HA[pi] = .5 * f * spd; HS[pi] = RM * 4 * (.4 + .6 * f);
      }
      const cf = 1 + TRAIL_N;                                       // contact flare at the struck face
      if (ev){
        const sol = solOf(R, b.i, b.abs);
        HP[cf * 3] = sol.S[0]; HP[cf * 3 + 1] = sol.S[1]; HP[cf * 3 + 2] = sol.S[2];
        const fa = vel * ring(since, 9);
        HA[cf] = fa > .01 ? Math.min(.8, .9 * fa) : 0; HS[cf] = ev.rho * (2.5 + 5 * (1 - ring(since, 9)));
        H.col.setXYZ(cf, ev.col.r * 1.4, ev.col.g * 1.4, ev.col.b * 1.4);
      } else HA[cf] = 0;
      const mh = cf + 1;                                            // magnet halo
      HP[mh * 3] = sh.x; HP[mh * 3 + 1] = Y_COIL + .1; HP[mh * 3 + 2] = 0;
      HA[mh] = Math.min(1, .22 * on); HS[mh] = COIL_R * 4 * (1 + .3 * Math.max(0, on - 1));
      const tg = mh + 1, ne = R.evs[nextK], ns = solOf(R, nextK, nextAbs);   // the beat's target
      HP[tg * 3] = ns.S[0]; HP[tg * 3 + 1] = ns.S[1] + .05; HP[tg * 3 + 2] = ns.S[2];
      HA[tg] = .35 * prog * prog; HS[tg] = ne.rho * 3.2;
      H.col.setXYZ(tg, ne.col.r, ne.col.g, ne.col.b);
      const nt = tg + 1;                                            // the net cable's flash
      HP[nt * 3] = 0; HP[nt * 3 + 1] = NET_H; HP[nt * 3 + 2] = 0;
      HA[nt] = .5 * nf; HS[nt] = 3.2;
      H.pos.needsUpdate = H.alpha.needsUpdate = H.size.needsUpdate = H.col.needsUpdate = true;
    }

    return { build, update };
  },

  /* 32 beats of C-major calypso, a call and its answer. The LEFT wall calls (a skipping
     figure up its staff) and its held note SERVES the marble over the net; the RIGHT wall
     answers falling back down. The second call climbs to a high C that lobs onto the
     bridge's magnet — carried over the net, dropped onto the reply. Then a RALLY: half-note
     volleys straight across, register leaping (low C to high C), every arc a different
     shape. The last call and answer settle on C, and the long rest across the loop seam is
     the shuttle's slow glide home (the count-in is that same glide). */
  demo: {
    bpm: 100, beats: 32, scale: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
    part: [
      [0, 'C5', .8], [0.5, 'E5', .6], [1, 'G5', .7], [1.5, 'E5', .6], [2, 'A5', .9],
      [4, 'G5', .8], [4.5, 'E5', .6], [5, 'D5', .6], [5.5, 'C5', .6], [6, 'D5', .8],
      [8, 'C5', .8], [8.5, 'E5', .6], [9, 'G5', .7], [9.5, 'A5', .7], [10, 'C6', 1],
      [13, 'A5', .8], [13.5, 'G5', .6], [14, 'E5', .8],
      [16, 'C4', .9], [18, 'C6', .9], [20, 'G4', .9], [22, 'E5', .9],
      [24, 'E5', .8], [24.5, 'D5', .6], [25, 'C5', .6], [25.5, 'A4', .6], [26, 'G4', .8],
      [28, 'A4', .7], [28.5, 'C5', .6], [29, 'D5', .7], [29.5, 'E5', .8], [30, 'C5', 1],
    ],
  },
};

/* ================= geometry builders ================= */

/* (static parts drop their material groups: one-group geometry is what main's static merge bakes) */
const one = g => { g.clearGroups(); return g; };
const box = (w, h, d, x, y, z, mat, group) => { const m = new THREE.Mesh(one(new THREE.BoxGeometry(w, h, d)), mat); m.position.set(x, y, z); group.add(m); return m; };
function bar(a, b, r, mat, group, seg = 8){
  const d = b.clone().sub(a), L = d.length();
  const m = new THREE.Mesh(one(new THREE.CylinderGeometry(r, r, L, seg)), mat);
  m.position.copy(a).addScaledVector(d, .5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  group.add(m); return m;
}

/* The court: a slim lacquered deck on a truss, lime court lines, a landing mark under each rank. */
function buildDeck(group, M, ZW){
  const W = 2 * (OUT + .25), D = 2 * (ZW + CW + .3);
  box(W, .22, D, 0, -.11, 0, M.lacquer, group);
  box(W - .3, .04, D - .3, 0, .005, 0, M.dark, group);
  // the truss under it (the lowest part of the hung court)
  for (const z of [-D / 2 + .2, D / 2 - .2]) box(W - .2, .2, .16, 0, -.33, z, M.steel, group);
  for (let i = 0; i <= 8; i++){
    const x = -W / 2 + .2 + i * (W - .4) / 8;
    box(.12, .2, D - .4, x, -.33, 0, M.steel, group);
  }
  // court lines: the in-court boundary, the centre line under the net, the rank marks
  const Lc = (w, d, x, z) => box(w, .012, d, x, .03, z, M.line, group);
  Lc(2 * XF - .2, .05, 0, ZW); Lc(2 * XF - .2, .05, 0, -ZW);
  Lc(.05, 2 * ZW, XF - .1, 0); Lc(.05, 2 * ZW, -(XF - .1), 0);
  Lc(.06, 2 * ZW, 0, 0);
  for (const s of [-1, 1]) for (const r of [0, 1]){
    const x = s * xOfRank(r);
    Lc(.5, .04, x, 0); Lc(.04, .5, x, 0);
  }
  // the deck's edge trim faces the audience
  box(W - 1, .03, .03, 0, -.12, D / 2 + .02, M.neon, group);
}

/* One wall (side s), an OPEN frame (the room shows through it, like the paternoster): a bottom and
   a top rail carrying the chains, four corner posts with cross-braces on the outer face, the slim
   end cowls (they swallow the stowed pads and the slats' turnarounds), and the strike column — two
   lit posts between the strands where every pad of this wall meets its beat. */
function buildWall(group, M, s, ZW){
  const zc = ZW + CW, inner = XF - GEOM.COWL_IN;
  const xm = s * (OUT + XF - .3) / 2, wB = OUT - (XF - .3);
  // the rails (chain housings)
  box(wB, .36, 2 * zc + .3, xm, Y_BEAM0 - .18, 0, M.dark, group);
  box(wB, .36, 2 * zc + .3, xm, Y_BEAM1 + .18, 0, M.dark, group);
  box(.04, .04, 2 * zc + .2, s * (XF - .3), Y_BEAM0 - .02, 0, M.neon, group);
  box(.04, .04, 2 * zc + .2, s * (XF - .3), Y_BEAM1 + .02, 0, M.neon, group);
  // the posts: from the deck to the crown, at the frame's four corners
  for (const zs of [-1, 1]) for (const xo of [XF - .22, OUT - .1]){
    box(.2, Y_TOP, .2, s * xo, Y_TOP / 2, zs * (zc + .05), M.alu, group);
  }
  // a lacquered footing under the bottom rail, and the crown cap over the top one
  box(wB, .5, 2 * zc + .5, xm, .25, 0, M.lacquer, group);
  box(wB + .2, .22, 2 * zc + .5, xm, Y_TOP + .05, 0, M.lacquer, group);
  // cross-braces on the OUTER face (the court side stays clear for the pads)
  for (const zs of [-1, 1]){
    const z0 = zs * .3, z1 = zs * (zc + .05), x = s * (OUT - .1);
    bar(new THREE.Vector3(x, Y_BEAM0, z0), new THREE.Vector3(x, Y_BEAM1, z1), .03, M.chrome, group, 6);
    bar(new THREE.Vector3(x, Y_BEAM1, z0), new THREE.Vector3(x, Y_BEAM0, z1), .03, M.chrome, group, 6);
  }
  for (const zs of [-1, 1]){
    // the cowls: a slim housing over the run's ends — just deep enough to swallow a stowed pad
    // (edge-on discs reach XF − 2ρ − gap into the court) and the slats' turnaround; the chains'
    // sprockets stay in view outside it
    const z0 = zs * ZW, z1 = zs * zc, zm = (z0 + z1) / 2, dz = Math.abs(z1 - z0);
    const x0 = inner, x1 = XF + .12, cx = s * (x0 + x1) / 2, cw = x1 - x0, h = Y_BEAM1 - Y_BEAM0, yc = (Y_BEAM0 + Y_BEAM1) / 2;
    box(cw, h, dz, cx, yc, zm, M.dark, group);
    // a lit outline on its court face + the re-tuning window (a slot that pulses as a pad slides in)
    for (const z of [z0, z1]) box(.05, h, .05, s * (x0 - .02), yc, z, M.line, group);
    const win = new THREE.Mesh(new THREE.BoxGeometry(.03, h - .9, Math.min(.16, dz * .3)), s < 0 ? M.slotL : M.slotR);
    win.position.set(s * (x0 - .03), yc, zm); win.userData.noMerge = true; group.add(win);
    // its end face: a column of vents (the re-tuning bay breathes)
    for (let k = 0; k < 5; k++) box(cw - .5, .05, .03, cx, Y_BEAM0 + .9 + k * (h - 1.8) / 4, z1 + zs * .016, M.column, group);
  }
  // the strike column: two lit posts between the strands
  for (const zs of [-1, 1]) box(.05, Y_CH1 - Y_CH0, .05, s * (XF + RS), (Y_CH0 + Y_CH1) / 2, zs * TICK_Z, M.column, group);
}

/* The net: two posts, a lit top cable, a fine wire grid. */
function buildNet(group, M, ZW){
  const zp = ZW + .35, y0 = 1.3;
  for (const s of [-1, 1]){
    bar(new THREE.Vector3(0, 0, s * zp), new THREE.Vector3(0, NET_H + .2, s * zp), .06, M.chrome, group, 12);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(.1, 12, 8), M.brass); cap.position.set(0, NET_H + .22, s * zp); group.add(cap);
  }
  const top = new THREE.Mesh(one(new THREE.CylinderGeometry(.035, .035, 2 * zp, 8)).rotateX(Math.PI / 2), M.netTop);
  top.position.set(0, NET_H, 0); group.add(top);
  bar(new THREE.Vector3(0, y0, -zp), new THREE.Vector3(0, y0, zp), .02, M.steel, group, 6);
  const pts = [], step = .28;
  for (let z = -zp + step; z < zp - 1e-6; z += step) pts.push(0, y0, z, 0, NET_H, z);
  for (let y = y0 + step; y < NET_H - 1e-6; y += step) pts.push(0, y, -zp, 0, y, zp);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const net = new THREE.LineSegments(g, M.net); net.renderOrder = 2; group.add(net);
}

/* The bridge: a pylon up from each wall's crown, the rail between them (the shuttle hangs under it). */
function buildBridge(group, M){
  const xr = XF + .9;
  for (const s of [-1, 1]){
    box(.34, Y_RAIL + .35 - Y_TOP, .34, s * xr, (Y_TOP + Y_RAIL + .35) / 2, 0, M.dark, group);
    box(.5, .1, .5, s * xr, Y_TOP + .05, 0, M.chrome, group);
    bar(new THREE.Vector3(s * xr, Y_RAIL + .2, 0), new THREE.Vector3(s * (XF - .1), Y_TOP, 0), .03, M.chrome, group);
  }
  box(2 * xr, .2, .24, 0, Y_RAIL, 0, M.alu, group);
  for (const sz of [-1, 1]) box(2 * xr, .04, .05, 0, Y_RAIL - .12, sz * .19, M.chrome, group);
  box(2 * X_RAIL, .025, .05, 0, Y_RAIL + .115, 0, M.neon, group);
  for (const s of [-1, 1]) box(.16, .3, .34, s * (X_RAIL + .45), Y_RAIL - .1, 0, M.dark, group);   // end stops
}

/* The hung court: four cables from the deck's corners and one from each pylon head up to the
   ceiling; a faint court outline on the room floor marks its footprint. */
function buildRigging(group, M, ZW, ceilY, floorY){
  const D = ZW + CW + .1, W = OUT + .1;
  if (ceilY > Y_RAIL + 1){
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      bar(new THREE.Vector3(sx * W, 0, sz * D), new THREE.Vector3(sx * (W - 1.2), ceilY, sz * (D - .8)), .035, M.steel, group, 6);
    for (const s of [-1, 1])
      bar(new THREE.Vector3(s * (XF + .9), Y_RAIL + .35, 0), new THREE.Vector3(s * (XF + .9), ceilY, 0), .04, M.steel, group, 6);
  }
  if (floorY < -1){
    const fy = floorY + .03, L = (w, d, x, z) => box(w, .02, d, x, fy, z, M.line, group);
    L(2 * W, .05, 0, D); L(2 * W, .05, 0, -D); L(.05, 2 * D, W, 0); L(.05, 2 * D, -W, 0); L(.05, 2 * D, 0, 0);
  }
}

/* merge any list of geometries into one (non-indexed, position/normal/uv) */
function mergeFlat(list){
  const flat = list.map(g => { const f = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(f.attributes)) if (!['position', 'normal', 'uv'].includes(k)) f.deleteAttribute(k); return f; });
  const out = mergeGeometries(flat);
  list.forEach(g => g.dispose()); flat.forEach(g => g.dispose());
  return out;
}
/* a sprocket: a hub + 12 teeth + its shaft, merged */
function sprocketGeo(){
  const parts = [new THREE.CylinderGeometry(RS * .82, RS * .82, .12, 20)];
  for (let i = 0; i < 12; i++){
    const a = i / 12 * Math.PI * 2;
    parts.push(new THREE.BoxGeometry(.08, .1, .1).rotateY(-a).translate(RS * Math.cos(a), 0, RS * Math.sin(a)));
  }
  parts.push(new THREE.CylinderGeometry(.06, .06, .5, 10));
  return mergeFlat(parts);
}

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
