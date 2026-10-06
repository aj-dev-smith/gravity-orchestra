import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { eventTimes, makeEdge, wrapP } from '../clock.js';
import { noteNum, arcPos } from '../../engine.js';
import { buildOrbit, marbleAt, sinceStrike, wobble, gateLift, powerAt, gatePowerAt, plateWob, BALL_R, PLATE_T, GATE_R, CABLE_R } from './solve.js';
import { glassVoice, gateClink, relayTock } from './voice.js';
import { phosphorAt, armPhosphor, paintPhosphor } from './phosphor.js';

/* ============================================================
   RICOCHET SCULPTURE — a new archetype: a FROZEN PATH.

   A constellation of tuned glass plates hangs in mid-air, each on a
   rigid chrome stem from a smoked-glass canopy. ONE chrome marble
   ricochets between them forever. Every bounce is honestly LOSSY
   (restitution E_REST) and every plate is POWERED: a loudspeaker-like
   driver — a fixed chrome bezel carrying a voice COIL, and a glass
   PISTON that winds back and kicks along its normal at contact at
   exactly the moving-wall speed that restores the lost energy. The
   power chain is visible: the canopy's glowing ring is the BUS; as the
   marble heads for a plate, a charge pulse runs from the ring down that
   plate's stem, its coil warms (prog², the belt's anticipation grammar)
   and DISCHARGES as the piston kicks. The canopy hangs just above
   (H + CEIL_GAP) the marble's ENERGY CEILING H — the height where it
   would come to rest between kicks — so no arc can ever reach it.

   Each note occurrence is its own plate (size = pitch, the engine's
   law; height ≈ pitch, so the sculpture reads as a score); each plate's
   tilt is forced by the two arcs it joins (n = vOut − vIn). The full
   orbit can be drawn as a glowing wire — the frozen knot — as an X-RAY
   of the solve: hidden by default (it has no physical source), key K
   (or ?knot) toggles it. Dark obsidian RELAY plates (powered the same
   way) carry it across long rests (the loop seam) with a soft, dark tock.

   Count-in: the marble hangs on the one magnet, AT the energy ceiling
   (at rest: exactly the orbit's energy), drops onto a hinged STARTER
   GATE angled to send it into the orbit with the orbit's exact
   velocity; then its latch lets go and a COUNTERWEIGHT on the hinge's
   bell-crank drops, swinging the gate up out of the path (a closed
   elastic orbit can't be entered by fixed geometry — time reversibility
   — so something must move once, and it moves for a visible reason).
   All motion = solve.js.
   ============================================================ */

const ICE      = 0x8fe9ff;           // signature: prism ice-cyan
const ICE_HOT  = 0xe8fbff;
const TRAIL_N  = 9, TRAIL_DT = .016;
const CANOPY_PAD = .55;              // canopy rim beyond the furthest plate edge
const ROOM_H = 58;                   // fallback only: main.js passes ceilY (ROOM.CEIL − station.y)
const PULSE_TRAIL = [0, .05, .1], PULSE_SZ = [.9, .6, .4], PULSE_OP = [1, .55, .25];
/* energy → glow: injected energy ∝ w², a plate's glow scales by (w/wMax)^.75, floored so a glancing touch still ticks */
const PW_EXP = .75, PW_MIN = .15;

/* the KNOT x-ray: off by default (no physical source); K toggles it, ?knot starts with it on */
let knotOn = typeof location !== 'undefined' && /[?&]knot\b/.test(location.search);
if (typeof addEventListener === 'function') addEventListener('keydown', e => {
  if ((e.key === 'k' || e.key === 'K') && !/^(input|textarea|select)$/i.test(e.target?.tagName || '')) knotOn = !knotOn;
});

/* the solve is deterministic: memoise it per (part, loop, count-in) so a song change back is instant */
const ORBITS = new Map();
function orbitFor(events, P, start){
  const key = JSON.stringify([P, start, events.map(e => [e.t, e.note, e.vel])]);
  let o = ORBITS.get(key);
  if (!o){
    o = buildOrbit(events, { P, start });
    if (ORBITS.size > 8) ORBITS.delete(ORBITS.keys().next().value);
    ORBITS.set(key, o);
    if (o.score < 0) console.warn(`[ricochet] best layout still grazes by ${(-o.score).toFixed(3)} u (${o.nodes.length} plates) — a shorter phrase solves clean`);
  }
  return o;
}

/* pitch → a prism hue: low = ice-cyan, high = violet-pink */
const hueOf = k => .52 + .33 * k;

export default {
  key: 'ricochet',
  label: 'Ricochet Sculpture',
  wet: true,
  lookHeight: 5.2,
  camera: { dist: 21, up: 3.2 },
  color: '#8fe9ff',

  voice: id => id === 'gate' ? gateClink() : id === 'relay' ? relayTock() : glassVoice(id),
  // every orbit has ≥ 1 relay (the loop seam's rest is always > DT_MAX), so always bake the tock
  voiceIds: part => [...new Set(part.map(e => e[1])), 'gate', 'relay'],

  make({ envMap, glowTex }){
    let S = null;

    function build(part, { rollT, beat, P, start = -Infinity, floorY = -20, ceilY: roomCeil }){
      const group = new THREE.Group();
      S = null;
      const events = eventTimes(part, { rollT, beat });
      if (!events.length) return group;
      const orb = orbitFor(events, P, start);
      const N = orb.nodes.length;
      const notes = orb.nodes.filter(n => !n.relay).map(n => noteNum(n.note));
      const lo = Math.min(...notes), span = Math.max(1, Math.max(...notes) - lo);
      const yC = orb.ceilY;                                  // the canopy: just above the energy ceiling
      const footR = Math.max(...orb.c.map((c, i) => Math.hypot(c.x, c.z) + orb.r[i])) + CANOPY_PAD;
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const UP = V(0, 1, 0);

      // ---- materials (a fixed set + one per plate, constant after build) ----
      const chrome = new THREE.MeshStandardMaterial({ color: 0xdfe6ef, metalness: 1, roughness: .12, envMap, envMapIntensity: 1.4 });
      const dark   = new THREE.MeshStandardMaterial({ color: 0x232733, metalness: .7, roughness: .45, envMap });
      const cableM = new THREE.MeshStandardMaterial({ color: 0xaab4c4, metalness: .9, roughness: .3, envMap });
      const smoke  = new THREE.MeshStandardMaterial({ color: 0x0d1220, metalness: .6, roughness: .08, envMap, envMapIntensity: 1.2,
        transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false });
      const glowM  = new THREE.MeshBasicMaterial({ color: new THREE.Color(ICE).multiplyScalar(1.6) });
      const fz = m => { m.userData.frozen = true; return m; };
      const bar = (a, b, r, mat, seg = 8) => {
        const d = new THREE.Vector3().subVectors(b, a), len = d.length();
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
        m.position.copy(a).addScaledVector(d, .5);
        m.quaternion.setFromUnitVectors(UP, d.normalize());
        return fz(m), group.add(m), m;
      };
      const ring = (R, y, tube, mat) => {
        const m = new THREE.Mesh(new THREE.TorusGeometry(R, tube, 8, 96).rotateX(Math.PI / 2), mat);
        m.position.y = y; return fz(m), group.add(m), m;
      };
      const spriteM = (color, opacity = 0) => new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false });
      const sprite = (color, parent = group) => { const s = new THREE.Sprite(spriteM(color)); parent.add(s); return s; };
      // the charge pulse's beads: three SHARED materials (one per trail slot) for every plate + the gate
      const beadM = PULSE_TRAIL.map((_, k) => spriteM(new THREE.Color(ICE).multiplyScalar(2.2), PULSE_OP[k]));   // hot enough to bloom
      const beadsFor = () => beadM.map(m => { const b = new THREE.Sprite(m); b.visible = false; group.add(b); return b; });
      const pathOf = path => { const segL = path.slice(1).map((q, k) => q.distanceTo(path[k])); return { path, segL, pathL: segL.reduce((a, b) => a + b, 0) }; };
      // energy injected per kick ∝ w²: the glow is sized by it (the gate's kick counts too)
      const wMax = Math.max(1e-6, ...orb.kick.map(k => k.w), orb.entry?.kick ? orb.entry.kick.w : 0);
      const pwOf = w => Math.max(PW_MIN, Math.pow(w / wMax, PW_EXP));

      // ---- the canopy: smoked glass at the energy ceiling, a glowing rim, spokes, and three
      //      suspension rods up to the room's ceiling (the whole sculpture HANGS) ----
      const canopy = new THREE.Mesh(new THREE.CircleGeometry(footR, 72).rotateX(Math.PI / 2), smoke);
      canopy.position.y = yC + .04; group.add(canopy);
      ring(footR, yC, .07, chrome);
      ring(footR - .02, yC - .07, .025, glowM);
      ring(1.1, yC, .05, chrome);
      for (let k = 0; k < 12; k++){
        const a = k / 12 * Math.PI * 2;
        bar(V(1.1 * Math.cos(a), yC + .02, 1.1 * Math.sin(a)), V(footR * Math.cos(a), yC + .02, footR * Math.sin(a)), .035, dark, 6);
      }
      const top = roomCeil ?? (floorY + ROOM_H);
      if (top > yC + 1) for (let k = 0; k < 3; k++){
        const a = k / 3 * Math.PI * 2 + Math.PI / 6;
        bar(V(footR * Math.cos(a), yC + .05, footR * Math.sin(a)), V(footR * .55 * Math.cos(a), top, footR * .55 * Math.sin(a)), .05, dark, 6);
      }
      // the floor: nothing stands on it (the whole sculpture HANGS) — a slim glowing ring on the
      // room floor marks the footprint, a smaller one marks the plumb line under the hub
      ring(footR, floorY + .03, .02, glowM);
      ring(1.1, floorY + .03, .03, glowM);

      // ---- the canopy eyes: where each rigid stem is clamped (static, merged) ----
      const eyeGeo = mergeGeometries(orb.rim.map(K => new THREE.CylinderGeometry(.07, .09, .1, 10).translate(K.x, yC - .03, K.z)));
      group.add(new THREE.Mesh(eyeGeo, chrome));

      // ---- the plates: each welded at one rim point to a RIGID chrome stem clamped in the
      //      canopy (a cable carries no torque — it could never hold a tilted plate, and a hit
      //      from below would slacken it; a stem holds any forced tilt honestly). A strike
      //      sets plate + stem RINGING about the canopy clamp (the wobble), pure fn of time. ----
      const plates = orb.nodes.map((nd, i) => {
        const relay = nd.relay;
        const k = relay ? 0 : (noteNum(nd.note) - lo) / span;
        const col = relay ? new THREE.Color(0x5f7cff) : new THREE.Color().setHSL(hueOf(k), .9, .62);
        const K = orb.rim[i], top = V(K.x, yC, K.z), L = Math.max(.3, yC - K.y);
        const piv = new THREE.Group(); piv.position.copy(top); group.add(piv);
        // the stem + its weld collar, one geometry (one draw call per plate)
        const stemG = mergeGeometries([
          new THREE.CylinderGeometry(CABLE_R, CABLE_R, L, 6).translate(0, -L / 2, 0),
          new THREE.SphereGeometry(.06, 10, 8).translate(0, -L, 0),
        ].map(g => g.index ? g.toNonIndexed() : g));
        piv.add(new THREE.Mesh(stemG, cableM));
        const body = new THREE.Group(); body.position.copy(orb.c[i]).sub(top);
        body.quaternion.setFromUnitVectors(UP, orb.n[i]); piv.add(body);
        const r = orb.r[i];
        // the DRIVER: a fixed bezel (inside the audited plate volume) carrying the voice coil on
        // the back face, and the glass piston that rides along n (local y) inside it. The bezel's
        // own emissive is the pitch-coloured JEWEL RIM (reads at wide) and it carries the charge.
        const bezelM = relay
          ? new THREE.MeshStandardMaterial({ color: 0x232733, metalness: .7, roughness: .45, envMap, emissive: col.clone(), emissiveIntensity: .1 })
          : new THREE.MeshStandardMaterial({ color: 0xdfe6ef, metalness: 1, roughness: .12, envMap, envMapIntensity: 1.4, emissive: col.clone(), emissiveIntensity: .5 });
        const coilR = Math.max(.08, .58 * r), coilT = .028;
        body.add(new THREE.Mesh(mergeGeometries([                                         // bezel + pole piece: one draw
          new THREE.TorusGeometry(r - PLATE_T / 2, PLATE_T / 2, 8, 48).rotateX(Math.PI / 2),
          new THREE.CylinderGeometry(coilR * .35, coilR * .35, .02, 16).translate(0, -PLATE_T / 2 + .01, 0),
        ].map(g => g.index ? g.toNonIndexed() : g)), bezelM));
        const discM = relay
          ? new THREE.MeshStandardMaterial({ color: 0x0a0c14, metalness: .95, roughness: .1, envMap, envMapIntensity: 1.1,
              emissive: col.clone(), emissiveIntensity: .05 })
          : new THREE.MeshStandardMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), .35), metalness: .65, roughness: .04,
              envMap, envMapIntensity: 2, emissive: col.clone(), emissiveIntensity: .12, transparent: true, opacity: .38 });
        const pist = new THREE.Group(); body.add(pist);
        // the piston's FRONT face is exactly the solved contact plane (y = PLATE_T/2); it rides inside the bezel
        const rp = r - PLATE_T * 1.05;
        pist.add(new THREE.Mesh(new THREE.CylinderGeometry(rp, rp, PLATE_T * .8, 40).translate(0, PLATE_T * .1, 0), discM));
        const rimM = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(.25) });          // the voice coil
        body.add(new THREE.Mesh(new THREE.TorusGeometry(coilR, coilT, 6, 40).rotateX(Math.PI / 2).translate(0, -PLATE_T / 2 + coilT, 0), rimM));
        // the power path: BUS ring → (trace under the canopy) → eye → down the stem → weld → coil
        const ang = Math.atan2(K.z, K.x);
        const busP = V((footR - .02) * Math.cos(ang), yC - .07, (footR - .02) * Math.sin(ang));
        const eyeP = V(K.x, yC - .07, K.z);
        const coilP = orb.c[i].clone().addScaledVector(orb.n[i], -PLATE_T / 2 + coilT);
        if (busP.distanceTo(eyeP) > .05) bar(busP, eyeP, .016, dark, 5);
        const pp = pathOf([busP, eyeP, K.clone(), coilP]);
        const beads = beadsFor();
        // the stem's ring (axis + amplitude) is solve.js's plateWob — the very motion the
        // no-penetration check verified
        const wob = plateWob(orb, i);
        const pw = pwOf(orb.kick[i].w);
        const halo = sprite(col);
        const contact = orb.p[i].clone().addScaledVector(orb.n[i], -BALL_R);
        halo.position.copy(contact);
        return { nd, i, relay, col, colBase: col.clone(), piv, wob, discM, rimM, bezelM, halo, contact, r, pist, ...pp, beads, pw,
                 inDt: orb.nodes[(i - 1 + N) % N].dt };
      });
      plates.forEach(armPhosphor);                         // phosphor crystal: dormant until struck

      // ---- the frozen knot: the whole orbit as one faint wire, lit ahead of the marble ----
      const tubes = [];
      orb.nodes.forEach((nd, i) => {
        const p0 = orb.p[i], v0 = orb.v0[i], T = nd.dt;
        const curve = new THREE.Curve(); curve.getPoint = (u, out = new THREE.Vector3()) => out.copy(arcPos(p0, v0, u * T));
        const segs = Math.max(8, Math.ceil(orb.d[i] * 4 + T * 12)), RAD = 4;
        const tg = new THREE.TubeGeometry(curve, segs, .026, RAD, false);
        const n = tg.attributes.position.count, aT = new Float32Array(n);
        for (let v = 0; v < n; v++) aT[v] = nd.t + Math.floor(v / (RAD + 1)) / segs * T;
        tg.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
        tg.deleteAttribute('uv'); tg.deleteAttribute('normal');
        tubes.push(tg);
      });
      const wireU = { uNow: { value: 0 }, uP: { value: P }, uOn: { value: 0 }, uCol: { value: new THREE.Color(ICE) } };
      const wire = new THREE.Mesh(mergeGeometries(tubes), new THREE.ShaderMaterial({
        uniforms: wireU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `attribute float aT; varying float vT;
          void main(){ vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uNow, uP, uOn; uniform vec3 uCol; varying float vT;
          void main(){
            float d = mod(vT - uNow + uP * 8.0, uP);          // seconds AHEAD of the marble along the knot
            float ahead = exp(-d / 0.6) * uOn;
            float behind = exp(-(uP - d) / 0.1) * uOn;
            float k = 0.26 + 3.4 * ahead + 0.9 * behind;
            gl_FragColor = vec4(uCol * k, 1.0);
          }`,
      }));
      wire.frustumCulled = false; wire.visible = knotOn; group.add(wire);

      // ---- the marble: chrome, a faint ice glow, a ghost trail re-sampled from the pure fn ----
      const marbleM = new THREE.MeshStandardMaterial({ color: 0xf2f6fb, metalness: 1, roughness: .06, envMap, envMapIntensity: 1.8,
        emissive: new THREE.Color(ICE), emissiveIntensity: .35 });
      const marble = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 24), marbleM); group.add(marble);
      const mHalo = sprite(ICE); mHalo.scale.setScalar(BALL_R * 7.5); mHalo.material.opacity = .6;   // the HERO: legible at the director's distance
      const trail = Array.from({ length: TRAIL_N }, () => sprite(ICE));

      // ---- the magnet (count-in only) — hangs from the canopy, holds the marble at H ----
      const en = orb.entry;
      let magnet = null, gate = null;
      if (en){
        const Q = en.Q;
        const coilM = new THREE.MeshStandardMaterial({ color: 0x0b1c26, emissive: new THREE.Color(ICE), emissiveIntensity: .1 });
        const yM = Q.y + BALL_R + .14;
        bar(V(Q.x, yM + .14, Q.z), V(Q.x, yC, Q.z), .035, chrome);
        const coil = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, .26, 24), coilM); coil.position.set(Q.x, yM, Q.z); group.add(coil);
        const shoe = new THREE.Mesh(new THREE.CylinderGeometry(.13, .16, .05, 20), chrome); shoe.position.set(Q.x, yM - .15, Q.z); group.add(shoe);
        const mh = sprite(ICE); mh.position.set(Q.x, yM - .1, Q.z); mh.scale.setScalar(1.1);
        magnet = { coilM, halo: mh };

        // the STARTER GATE: a small mirror on an arm, hinged under the canopy to one side of the
        // drop line; after the strike its latch lets go and it swings up flat under the canopy
        const hv = V(en.vOrb.x, 0, en.vOrb.z); if (hv.lengthSq() < 1e-6) hv.set(1, 0, 0); hv.normalize();
        const side = new THREE.Vector3().crossVectors(UP, hv).normalize();
        const off = GATE_R + .28;
        const hinge = en.c.clone().addScaledVector(side, off); hinge.y = yC - .12;
        const hingeG = new THREE.Group(); hingeG.position.copy(hinge); group.add(hingeG);
        const armTip = en.c.clone().addScaledVector(side, GATE_R * .85).sub(hinge);
        const armDir = armTip.clone().normalize(), armLen = armTip.length();
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, armLen, 8), chrome);
        arm.position.copy(armTip).multiplyScalar(.5); arm.quaternion.setFromUnitVectors(UP, armDir); hingeG.add(arm);
        const gateBody = new THREE.Group(); gateBody.position.copy(en.c).sub(hinge);
        gateBody.quaternion.setFromUnitVectors(UP, en.n); hingeG.add(gateBody);
        const gateBase = gateBody.position.clone();
        const gateM = new THREE.MeshStandardMaterial({ color: 0xe9eef5, metalness: 1, roughness: .05, envMap, envMapIntensity: 1.8,
          emissive: new THREE.Color(ICE), emissiveIntensity: .1 });
        gateBody.add(new THREE.Mesh(new THREE.CylinderGeometry(GATE_R, GATE_R, PLATE_T, 32), gateM));
        gateBody.add(new THREE.Mesh(new THREE.TorusGeometry(GATE_R, .02, 6, 40).rotateX(Math.PI / 2), glowM));
        const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, .3, 14), dark);
        knuckle.quaternion.setFromUnitVectors(UP, hv); hingeG.add(knuckle);
        // swing about the hinge axis (along the marble's travel), the way that tucks it in under the canopy
        const park = sg => hinge.clone().add(armTip.clone().applyAxisAngle(hv, sg * Math.PI / 2));
        const sign = Math.hypot(park(1).x, park(1).z) < Math.hypot(park(-1).x, park(-1).z) ? 1 : -1;
        // the visible CAUSE of the swing: a bell-crank counterweight. At rest its lever is level,
        // held by a latch pawl; when the latch lets go the bob falls to hang plumb — and the same
        // quarter-turn of the hinge lifts the gate up flat under the canopy.
        const lever = V(0, -1, 0).applyAxisAngle(hv, -sign * Math.PI / 2), LEV = .62;
        const levM = new THREE.Mesh(new THREE.CylinderGeometry(.028, .028, LEV, 8), chrome);
        levM.position.copy(lever).multiplyScalar(LEV / 2); levM.quaternion.setFromUnitVectors(UP, lever); hingeG.add(levM);
        const bob = new THREE.Mesh(new THREE.SphereGeometry(.15, 18, 14), dark);
        bob.position.copy(lever).multiplyScalar(LEV); hingeG.add(bob);
        const pawl = hinge.clone().addScaledVector(lever, LEV);
        bar(V(pawl.x, pawl.y + .16, pawl.z), V(pawl.x, yC, pawl.z), .03, chrome);           // the latch hanger
        const latchM = new THREE.MeshStandardMaterial({ color: 0x1a2230, emissive: new THREE.Color(ICE), emissiveIntensity: .6 });
        const latch = new THREE.Mesh(new THREE.BoxGeometry(.1, .08, .2), latchM);
        latch.position.set(pawl.x, pawl.y + .2, pawl.z); latch.quaternion.setFromUnitVectors(V(0, 0, 1), hv); group.add(latch);
        bar(V(hinge.x, hinge.y + .05, hinge.z), V(hinge.x, yC, hinge.z), .045, dark);         // the hinge bracket
        // the gate is powered like every plate: BUS → trace → down the hinge bracket → along the arm → its back face
        const gAng = Math.atan2(hinge.z, hinge.x);
        const gBus = V((footR - .02) * Math.cos(gAng), yC - .07, (footR - .02) * Math.sin(gAng));
        const gTop = V(hinge.x, yC - .07, hinge.z);
        if (gBus.distanceTo(gTop) > .05) bar(gBus, gTop, .016, dark, 5);
        const gBack = en.c.clone().addScaledVector(en.n, -PLATE_T / 2);
        gate = { hingeG, hv, sign, gateM, latchM, halo: sprite(ICE), body: gateBody, base: gateBase, n: en.n.clone(),
                 ...pathOf([gBus, gTop, hinge.clone(), hinge.clone().add(armTip), gBack]), beads: beadsFor(), pw: pwOf(en.kick.w) };
        gate.halo.position.copy(en.E);
      }

      freeze(group);
      S = { orb, plates, marble, marbleM, mHalo, trail, wireU, wire, magnet, gate, start, edge: makeEdge(.25), gateEdge: makeEdge(.25), P };
      return group;
    }

    const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _pw = {}, _gw = {};
    const _H = new THREE.Color(ICE_HOT);
    /* a point at fraction u ∈ [0,1] along a plate's power path */
    const pathAt = (pl, u, out) => {
      let d = Math.max(0, u) * pl.pathL;
      for (let k = 0; k < pl.segL.length; k++){
        if (d <= pl.segL[k] || k === pl.segL.length - 1) return out.lerpVectors(pl.path[k], pl.path[k + 1], Math.min(1, d / (pl.segL[k] || 1)));
        d -= pl.segL[k];
      }
      return out;
    };
    /* the charge pulse's beads along a power path, sized by the energy it carries */
    const runBeads = (pl, pulse) => {
      for (let k = 0; k < pl.beads.length; k++){
        const b = pl.beads[k], u = pulse - PULSE_TRAIL[k];
        b.visible = pulse >= 0 && u >= 0;
        if (!b.visible) continue;
        pathAt(pl, u, b.position);
        b.scale.setScalar(PULSE_SZ[k] * (.45 + .55 * pl.pw));
      }
    };
    function update(songTime, P, dt, { started, skipStrikes, onStrike }){
      if (!S) return;
      const { orb, plates } = S, en = orb.entry;
      const t = started ? songTime : S.start;
      const m = marbleAt(orb, t, _p);
      S.marble.position.copy(m.pos);
      S.mHalo.position.copy(m.pos);

      // ---- strikes (each fires once; nothing before the first downbeat ever happened) ----
      if (started && m.phase === 'orbit' && (!en || m.abs >= en.tFirst - 1e-6) && S.edge.check(m.abs, m.since, skipStrikes)){
        const pl = plates[m.i];
        if (!onStrike) {}
        else if (!pl.relay) onStrike({ note: pl.nd.note, vel: pl.nd.vel, pos: pl.contact.clone(), color: pl.col.getHex(), dur: 0,
          shake: pl.inDt > 1 ? .02 + .02 * pl.nd.vel : 0, sparks: Math.round(4 + 6 * pl.nd.vel), light: .8 + .6 * pl.nd.vel });
        // a relay is a real collision too (visuals drive audio): a soft dark tock, no sparks
        else onStrike({ note: 'relay', vel: .3, pos: pl.contact.clone(), color: 0x5f7cff, dur: 0, shake: 0, sparks: 0, light: .2 });
      }
      if (started && en && t >= en.tE && S.gateEdge.check(en.tE, t - en.tE, skipStrikes))
        onStrike && onStrike({ note: 'gate', vel: .7, pos: en.E.clone(), color: ICE, dur: 0, shake: 0, sparks: 10, light: .9 });

      // ---- plates: the power chain (pulse → coil charge → discharge), the piston's kick,
      //      flash, halo, the wobble on the hanger ----
      for (const pl of plates){
        const s = sinceStrike(orb, pl.i, t);
        const v = pl.relay ? .45 : pl.nd.vel;
        const fl = isFinite(s) ? v * Math.exp(-s * 5) : 0;
        const pw = started ? powerAt(orb, pl.i, t, _pw) : (_pw.pulse = -1, _pw.charge = _pw.flash = _pw.x = 0, _pw);
        pl.pist.position.y = pw.x;
        pl.discM.emissiveIntensity = (pl.relay ? .05 : .12) + (pl.relay ? 1.2 : 3.2) * fl + .5 * pw.charge * pl.pw;
        // the coil + the bezel rim: idle (pitch colour), dark until the pulse lands, then warm as
        // q² while the marble closes in, white-hot at the discharge — all sized by the energy (pw)
        const ch = pw.charge * pl.pw, fx = pw.flash * pl.pw, hot = Math.min(1, fx * 1.2);
        pl.rimM.color.copy(pl.colBase).multiplyScalar(.25 + 2.6 * ch).lerp(_H, hot).multiplyScalar(1 + 2.4 * fx);
        pl.bezelM.emissive.copy(pl.colBase).lerp(_H, hot);
        pl.bezelM.emissiveIntensity = (pl.relay ? .1 : .5) + 1.6 * ch + 2.2 * fx;
        runBeads(pl, pw.pulse);
        pl.halo.material.opacity = Math.min(1, 1.1 * fl);
        pl.halo.scale.setScalar(pl.r * (2.2 + 3 * fl));
        const w = isFinite(s) ? wobble(s, P, pl.wob.A) : 0;
        pl.piv.quaternion.copy(_q.setFromAxisAngle(pl.wob.axis, w));
        paintPhosphor(pl, phosphorAt(orb, pl.i, t));       // the struck crystal's afterglow (phosphor.js)
      }

      // ---- the knot lights up just ahead of the marble ----
      const inOrbit = m.phase === 'orbit';
      S.wire.visible = knotOn;
      S.wireU.uOn.value = inOrbit ? 1 : 0;
      S.wireU.uNow.value = wrapP(t, P);

      // ---- the marble's glow + ghost trail (its own past, re-sampled) ----
      const sp = m.vel.length();
      const sinceHit = inOrbit ? m.since : Infinity;
      S.marbleM.emissiveIntensity = .35 + 1.6 * Math.exp(-sinceHit * 14);
      S.trail.forEach((s, j) => {
        const tj = t - (j + 1) * TRAIL_DT;
        if (!started || tj < S.start || m.phase === 'hang'){ s.material.opacity = 0; return; }
        s.position.copy(marbleAt(orb, tj).pos);
        const f = 1 - (j + 1) / (TRAIL_N + 1);
        s.material.opacity = .45 * f * (.35 + .65 * Math.min(1, sp / 6));   // a ghost even at the apex
        s.scale.setScalar(BALL_R * 3.4 * (.4 + .6 * f));
      });

      // ---- count-in hardware: the magnet holds (coil lit) then cuts; the gate swings away ----
      if (S.magnet){
        const holding = m.phase === 'hang';
        const cut = en ? t - en.tRel : 9;
        // holding: the coil burns steady; at the release it flares once, then goes dark for good
        S.magnet.coilM.emissiveIntensity = holding ? 1.6 : .08 + 2.5 * Math.exp(-Math.max(0, cut) * 9);
        S.magnet.halo.material.opacity = holding ? .5 : .5 * Math.exp(-Math.max(0, cut) * 6);
      }
      if (S.gate){
        const lift = gateLift(orb, t);
        S.gate.hingeG.quaternion.setFromAxisAngle(S.gate.hv, S.gate.sign * lift * Math.PI / 2);
        const sE = en ? t - en.tE : 9;
        // the gate is powered too: a pulse from the bus as the magnet lets go, charge after it lands,
        // kick + discharge at contact (solve.js gatePowerAt — the plates' grammar)
        const gp = started ? gatePowerAt(orb, t, _gw) : (_gw.pulse = -1, _gw.charge = _gw.flash = _gw.x = 0, _gw);
        S.gate.body.position.copy(S.gate.base).addScaledVector(S.gate.n, gp.x);
        S.gate.gateM.emissiveIntensity = .1 + 1.6 * gp.charge * S.gate.pw + 3 * gp.flash * S.gate.pw;
        runBeads(S.gate, gp.pulse);
        S.gate.halo.material.opacity = sE >= 0 ? Math.exp(-sE * 6) : 0;
        S.gate.halo.scale.setScalar(1.6);
        S.gate.latchM.emissiveIntensity = lift > 0 ? .05 : .6;                  // armed: lit; released: dark
      }
    }

    return { build, update };
  },

  /* Demo: a 32-beat A-minor phrase — arpeggios that climb the sculpture, skimming runs,
     long notes thrown in tall lobs, a descending sixteenth cascade, and a held tonic
     (its long rest + the loop seam ride the dark relay mirrors). */
  demo: {
    bpm: 96, beats: 32,
    part: (() => {
      const seq = [
        ['A4', .5, .8], ['C5', .5, .6], ['E5', .5, .7], ['A5', .5, .8], ['G5', 1, .9], ['E5', 1, .7],
        ['F5', .5, .7], ['E5', .5, .6], ['D5', .5, .6], ['C5', .5, .6], ['D5', 2, .9],
        ['C5', .5, .7], ['E5', .5, .6], ['G5', .5, .7], ['C6', .5, .85], ['B5', 1, .9], ['G5', 1, .7],
        ['A5', .5, .7], ['G5', .5, .6], ['F5', .5, .6], ['D5', .5, .6], ['E5', 2, .9],
        ['F5', 1, .8], ['A5', .5, .6], ['C6', .5, .7], ['E6', 1, 1], ['D6', .5, .7], ['C6', .5, .7],
        ['B5', .5, .7], ['A5', .5, .6], ['G#5', .5, .7], ['B5', .5, .8], ['E6', 2, 1],
        ['E6', .25, .8], ['D6', .25, .6], ['C6', .25, .65], ['B5', .25, .6], ['A5', .25, .65], ['G5', .25, .6], ['F5', .25, .65], ['E5', .25, .7],
        ['D5', 1, .85], ['G#4', 1, .8],
        ['A4', 4, 1],
      ];
      let b = 0;
      return seq.map(([n, d, v]) => { const e = [b, n, v]; b += d; return e; });
    })(),
  },
};

/* ---- static structure → ONE mesh per material (merged; draw calls stay low) ---- */
function freeze(group){
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert(), byMat = new Map(), dead = [];
  group.traverse(o => {
    if (!o.isMesh || !o.userData.frozen) return;
    const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    (byMat.get(o.material) || byMat.set(o.material, []).get(o.material)).push(g);
    dead.push(o);
  });
  for (const o of dead){ o.parent.remove(o); o.geometry.dispose(); }
  for (const [mat, geos] of byMat){
    const merged = mergeGeometries(geos.map(g => g.index ? g.toNonIndexed() : g), false);
    geos.forEach(g => g.dispose());
    if (merged) group.add(new THREE.Mesh(merged, mat));
  }
}
