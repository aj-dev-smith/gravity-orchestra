import * as THREE from 'three';
import { eventTimes, makeEdge, ring, at } from '../clock.js';
import {
  solve, keyboard, laneHue, handsAt, malletAt, lastHit, bendAt, flexAt, wristDrive,
  trayBoxes, carriageBoxes, HEAD_R, LS, Y_W, Y_TRACK, Y_YOKE, Y_RAIL, RAIL_X0, RAIL_X1, NODE, MODE_GLSL,
  Z_G as Z0, BEAM_H, BEAM_D, RP, BELT_DZ, RC, LINK, CH_Y0, CH_H, CH_W, CH_ZC, A_MAX,
} from './solve.js';
import { marimbaVoice, layerId } from './voice.js';

/* ============================================================
   MARIMBA — THE ROBOT MARIMBIST.

   A real concert-marimba silhouette: rosewood bars low → high along +x
   (naturals in front, accidentals behind and a touch higher), each bar's
   length on the free-free law (L ∝ f^−½) and its underside arch cut,
   resting on felt at its two NODE points on a tapered frame; brass
   resonator tubes hung beneath (quarter wave ∝ 1/f).

   PLAYED BY A ROBOT four-mallet marimbist (all the motion is solved up
   front in solve.js — this file only draws what the math says):
   · a brushed-steel GANTRY beam on two towers; two CARRIAGES (left hand,
     right hand) ride it — each a SADDLE under the beam (a shoe on the
     chrome guide, a plate up the beam's front or back face), clamped to its
     own toothed BELT over brass pulleys (the pulleys turn exactly x/r — the
     belt is the visible cause of every move; the drive motor's coil glows
     with its torque), each trailing a DRAG CHAIN that folds and unfolds in
     the tray on top of the beam, carried by a thin L-bracket (solve.js
     carriageBoxes — test-proven never to pass through tray or chains);
   · under each carriage a LAZY-TONG SCISSOR spreads two z-tracks apart —
     the grip, the interval between the hand's two mallets;
   · on each track a FOREARM slides (reaching back for the sharps) and a
     WRIST MOTOR at its foot throws the shaft: prep lift ∝ velocity →
     down-stroke → contact → lossy rebound → caught. The coil glows while
     it drives (brighter for a whip) and as it catches (the brake);
   · MALLET HEADS are glowing MARBLES on flexible shafts that shiver on
     impact; fast strokes leave ghost trails; the bar bends in its true
     first mode and its resonator lights with the note.

   Constant material / mesh counts after build (instanced parts, one
   Points cloud for every halo + ghost trail). Pure fn of songTime.
   ============================================================ */

const EDGE_W   = .25;
const TRAIL_N  = 9;
const TRAIL_DT = .014;
const GLOW_COIL = new THREE.Color(0xff7a2a);   // the room's amber, for every motor coil
// the keyboard sits a touch left of the station centre so its treble end clears the
// melody belt wall next door (the footprint is |x| ≤ 6.5; the bass end has the room)
const KB_W = 11.2, KB_X0 = -.35;
const FX0 = -6.32, FX1 = 5.62;                 // frame ends (x)
const ZT0 = -3.48, ZT1 = -.2;                  // forearm track ends (z)
const TOOTH = .16;                             // belt tooth pitch
const TX0 = RAIL_X0 - .2, TX1 = RAIL_X1 + .22; // tower x

const voice = id => marimbaVoice(id);

export default {
  key: 'marimba',
  label: 'Marimba',
  wet: false,
  lookHeight: 5.1,                  // between the bars and the gantry: the whole performer, mallets mid-frame
  camera: { dist: 10.5, up: 7, x: -4.2 },  // a 3/4 view from the bass end, over the string bass: tongs, heads + bars read; the belts stay out
  color: '#ff8a5a',                 // director button / shot tint: lacquered rosewood amber
  directorWeight: 1.2,              // (its part is trimmed ×.38 in the mix — cue weights are velocities)
  voice,
  // two baked velocity layers per played note (soft + hard/bright), only the ones a strike
  // can ask for: a hard note's soft layer too (a roll's sustaining strokes are softer, and a
  // stroke the wrist can't fully whip sounds as hard as it actually lands)
  voiceIds(part){
    const ids = new Set();
    for (const e of part){ ids.add(e[1]); if ((e[2] ?? 1) > .75) ids.add(layerId(e[1], e[2] ?? 1)); }
    return [...ids];
  },

  make({ envMap, glowTex }){
    let st = null;                    // the built state for the current song

    function build(part, { rollT, beat, P, start }){
      const group = new THREE.Group();
      const events = eventTimes(part, { rollT, beat });
      const kb = keyboard(events.map(e => e.note), { width: KB_W, x0: KB_X0 });
      const plan = solve(events, { P, start, kb });
      if (plan.warnings.length) console.warn('[marimba]', plan.warnings.join(' · '));
      const rig = plan.rig;
      const bars = kb.bars.map((b, i) => ({ ...b, i, col: new THREE.Color().setHSL(laneHue(b.rank), .85, .6), lane: plan.bars[i] }));

      // ---- materials (a fixed set) ----
      const dark   = new THREE.MeshStandardMaterial({ color: 0x232733, metalness: .7, roughness: .45, envMap });
      const steel  = new THREE.MeshStandardMaterial({ color: 0xc9ced8, metalness: 1, roughness: .3, envMap, envMapIntensity: 1.2 });
      const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: .14, envMap, envMapIntensity: 1.3 });
      const brass  = new THREE.MeshStandardMaterial({ color: 0xf0bb55, metalness: 1, roughness: .2, envMap, envMapIntensity: 2.0 });
      const brassM = new THREE.MeshStandardMaterial({ color: 0xffcc55, metalness: 1, roughness: .14, envMap,
        envMapIntensity: 2.4, side: THREE.DoubleSide });
      brassM.onBeforeCompile = resonatorPatch;
      const capM = new THREE.MeshStandardMaterial({ color: 0xf5c560, metalness: 1, roughness: .2, envMap, envMapIntensity: 2.2 });
      // lacquered honduras rosewood: deep red-brown under a glossy clearcoat that catches the room
      const wood   = new THREE.MeshPhysicalMaterial({ color: 0x9a3410, metalness: 0, roughness: .45, envMap, envMapIntensity: 1.0,
        clearcoat: .6, clearcoatRoughness: .12, emissive: 0x481604, emissiveIntensity: 1 });
      wood.onBeforeCompile = barPatch;
      const coilM  = new THREE.MeshStandardMaterial({ color: 0x3a1c0e, metalness: .6, roughness: .35, envMap });
      coilM.onBeforeCompile = glowPatch;
      const mouthM = new THREE.MeshStandardMaterial({ color: 0x0b0a10, metalness: 0, roughness: 1 });
      mouthM.onBeforeCompile = glowPatch;
      const headM  = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .35, roughness: .16, envMap });
      headM.onBeforeCompile = glowPatch;
      const shaftM = new THREE.MeshStandardMaterial({ color: 0xd6b07a, metalness: .1, roughness: .45, envMap });   // rattan
      shaftM.onBeforeCompile = shaftPatch;
      const rubber = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: .8 });
      const felt   = new THREE.MeshStandardMaterial({ color: 0x5a1830, roughness: 1 });
      const chainM = new THREE.MeshStandardMaterial({ color: 0x1b1d24, metalness: .4, roughness: .5, envMap });

      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
      const put = (mesh, i, x, y, z, sx, sy, sz, quat) => { mesh.setMatrixAt(i, m4.compose(v.set(x, y, z), quat || q.identity(), sc.set(sx, sy, sz))); };
      const meshes = [];
      const add = m => { meshes.push(m); group.add(m); return m; };

      // ---- the plinth (deck top at y = 0) ----
      const SX0 = Math.min(FX0, TX0) - .25, SX1 = Math.max(FX1, TX1) + .25, SW = SX1 - SX0, SC = (SX0 + SX1) / 2;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(SW, .3, 7), dark);
      slab.position.set(SC, -.15, 0); group.add(slab);
      const trimGeo = new THREE.BoxGeometry(SW + .04, .05, .05);
      const trimM = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
      paintGradient(trimGeo, -SW / 2 - .02, SW / 2 + .02);
      for (const z of [-3.5, 3.5]){ const t = new THREE.Mesh(trimGeo, trimM); t.position.set(SC, -.02, z); group.add(t); }

      // ---- BARS (one instanced mesh: arch cut + first-mode flex + grain in the shader) ----
      const barGeo = new THREE.BoxGeometry(1, 1, 1, 1, 2, 32);
      const barMesh = add(new THREE.InstancedMesh(barGeo, wood, bars.length));
      const aFlex = inst(barGeo, 'aFlex', bars.length, 1);
      const aBG   = inst(barGeo, 'aGlow', bars.length, 1);
      const aBC   = inst(barGeo, 'aCol', bars.length, 3);
      bars.forEach((b, i) => { b.col.toArray(aBC.array, i * 3); aBG.array[i] = .03; });

      // ---- RESONATORS (brass tubes + glowing mouths) ----
      const tubeGeo = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
      const tubes = add(new THREE.InstancedMesh(tubeGeo, brassM, bars.length));
      const aRG = inst(tubeGeo, 'aGlow', bars.length, 1), aRC = inst(tubeGeo, 'aCol', bars.length, 3);
      const aRP = inst(tubeGeo, 'aPulse', bars.length, 2);   // the note's pressure wave running down the tube
      const mouthGeo = new THREE.CircleGeometry(1, 28); mouthGeo.rotateX(-Math.PI / 2);
      const mouths = add(new THREE.InstancedMesh(mouthGeo, mouthM, bars.length));
      const aMG = inst(mouthGeo, 'aGlow', bars.length, 1), aMC = inst(mouthGeo, 'aCol', bars.length, 3);
      const caps = add(new THREE.InstancedMesh(new THREE.CylinderGeometry(1, .92, 1, 28), capM, bars.length));
      bars.forEach((b, i) => {
        b.tubeR = Math.max(.045, Math.min(kb.slot * .36, b.w * .48, (.5 - NODE) * b.len - .1));
        b.tubeTop = b.top - b.thick - .32;
        const len = Math.min(b.res, b.tubeTop - .35);
        put(tubes, i, b.x, b.tubeTop - len / 2, b.z, b.tubeR, len, b.tubeR);
        put(mouths, i, b.x, b.tubeTop - .06, b.z, b.tubeR * .94, 1, b.tubeR * .94);
        put(caps, i, b.x, b.tubeTop - len - .03, b.z, b.tubeR * 1.02, .06, b.tubeR * 1.02);
        b.col.toArray(aRC.array, i * 3); b.col.toArray(aMC.array, i * 3);
        aRG.array[i] = .05; aMG.array[i] = .14;
        b.ringT = 1.15 - .62 * b.rank;                   // = the voice's fundamental ring time
        put(barMesh, i, b.x, b.top - b.thick / 2, b.z, b.w, b.thick, b.len);
      });

      // ---- the FRAME: node rails (the bars rest on FELT at their nodes), end frames, legs ----
      const frame = new THREE.Group(); group.add(frame);
      const nodes = [];
      bars.forEach(b => { const dz = (.5 - NODE) * b.len; for (const s of [-1, 1]) nodes.push({ b, x: b.x, z: b.z + s * dz, side: s }); });
      const felts = add(new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), felt, nodes.length));
      nodes.forEach((n, k) => { put(felts, k, n.x, n.b.top - n.b.thick - .015, n.z, n.b.w * .7, .03, .07); n.railY = n.b.top - n.b.thick - .03 - .06; });
      const rails = [];
      for (const natural of [true, false]) for (const side of [-1, 1]){
        const row = nodes.filter(n => n.b.natural === natural && n.side === side).sort((a, b) => a.x - b.x);
        if (!row.length) continue;
        const y = row[0].railY;
        const pts = row.map(n => new THREE.Vector3(n.x, y, n.z));
        pts.unshift(new THREE.Vector3(FX0, y, row[0].z));
        pts.push(new THREE.Vector3(FX1, y, row[row.length - 1].z));
        frame.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 120, .06, 8), dark));
        rails.push({ natural, side, y, z0: row[0].z, z1: row[row.length - 1].z });
      }
      const rod = (a, b, r, mat = dark, parent = frame) => {
        const d = new THREE.Vector3().subVectors(b, a), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 12), mat);
        m.position.copy(a).addScaledVector(d, .5);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        parent.add(m); return m;
      };
      const box = (x, y, z, w, h, d, mat = dark, parent = frame) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m;
      };
      const aabb = (b, mat) => box((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2,
                                   b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], mat);
      for (const end of [-1, 1]){
        const x = end < 0 ? FX0 : FX1;
        const ends = rails.map(r => new THREE.Vector3(x, r.y, end < 0 ? r.z0 : r.z1)).sort((a, b) => a.z - b.z);
        for (const p of ends){
          rod(new THREE.Vector3(p.x, 0, p.z), p, .07);
          const foot = new THREE.Mesh(new THREE.CylinderGeometry(.14, .17, .08, 14), rubber);
          foot.position.set(p.x, .04, p.z); frame.add(foot);
        }
        for (let k = 1; k < ends.length; k++){
          rod(ends[k - 1], ends[k], .05);
          rod(new THREE.Vector3(x, .55, ends[k - 1].z), new THREE.Vector3(x, .55, ends[k].z), .045);
        }
      }
      const fr = rails.find(r => r.natural && r.side === 1), br = rails.find(r => !r.natural && r.side === -1) || rails[0];
      if (fr) rod(new THREE.Vector3(FX0, .55, fr.z0), new THREE.Vector3(FX1, .55, fr.z1), .045);
      if (br) rod(new THREE.Vector3(FX0, .55, br.z0), new THREE.Vector3(FX1, .55, br.z1), .045);

      // ---- the GANTRY: two towers, the brushed-steel beam, its guide, the chain tray ----
      for (const x of [TX0, TX1]){
        for (const dz of [-.42, .42]) rod(new THREE.Vector3(x, 0, Z0 + dz), new THREE.Vector3(x, Y_RAIL + .5, Z0 + dz), .085, steel);
        box(x, Y_RAIL + .55, Z0, .3, .14, 1.15, steel);                          // tower head
        box(x, 1.2, Z0, .12, .08, .84, dark); box(x, 4.4, Z0, .12, .08, .84, dark);  // tower rungs
        for (const dz of [-.42, .42]){ const f = new THREE.Mesh(new THREE.CylinderGeometry(.16, .19, .08, 14), rubber); f.position.set(x, .04, Z0 + dz); frame.add(f); }
      }
      box((TX0 + TX1) / 2, Y_RAIL, Z0, TX1 - TX0 + .3, BEAM_H, BEAM_D, steel);   // the beam
      box((TX0 + TX1) / 2, Y_RAIL - BEAM_H / 2 - .025, Z0, TX1 - TX0, .05, .12, chrome);   // linear guide rail
      for (const b of trayBoxes()) aabb(b, dark);                                  // the chain tray
      // a neon strip under the beam (the signature gradient — reads from across the room)
      const stripGeo = new THREE.BoxGeometry(TX1 - TX0, .03, .03);
      paintGradient(stripGeo, -(TX1 - TX0) / 2, (TX1 - TX0) / 2);
      { const t = new THREE.Mesh(stripGeo, trimM); t.position.set((TX0 + TX1) / 2, Y_RAIL - .1, Z0 + BEAM_D / 2 + .02); frame.add(t); }

      // ---- BELTS + PULLEYS + MOTORS (left hand: front belt; right hand: back belt) ----
      const beltZ = [Z0 + BELT_DZ, Z0 - BELT_DZ];
      const Lx = RAIL_X1 - RAIL_X0, Lb = 2 * Lx + 2 * Math.PI * RP, nT = Math.floor(Lb / TOOTH);
      const pulleys = [];
      for (const h of [0, 1]) for (const x of [RAIL_X0, RAIL_X1]){
        const g = new THREE.Group(); g.position.set(x, Y_RAIL, beltZ[h]); frame.add(g);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(RP, RP, .1, 24), brass); disc.rotation.x = Math.PI / 2; g.add(disc);
        for (let k = 0; k < 3; k++){ const sp = new THREE.Mesh(new THREE.BoxGeometry(RP * 1.7, .035, .12), dark); sp.rotation.z = k * Math.PI / 3; g.add(sp); }
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .14, 12), chrome); hub.rotation.x = Math.PI / 2; g.add(hub);
        rod(new THREE.Vector3(x, Y_RAIL, Z0), new THREE.Vector3(x, Y_RAIL, beltZ[h]), .03, chrome);   // axle
        pulleys.push({ h, g });
      }
      for (const h of [0, 1]) for (const y of [Y_RAIL - RP - .006, Y_RAIL + RP + .006])
        box((RAIL_X0 + RAIL_X1) / 2, y, beltZ[h], Lx, .012, .09, rubber);
      const teeth = add(new THREE.InstancedMesh(new THREE.BoxGeometry(.05, .03, .09), rubber, 2 * nT));
      // motors: the left hand's drive at the left tower, the right hand's at the right
      const motorX = [RAIL_X0, RAIL_X1], motorZ = [beltZ[0] + .2, beltZ[1] - .2];
      const motorCoils = add(new THREE.InstancedMesh(new THREE.CylinderGeometry(.15, .15, .1, 20, 1, true), coilM, 2));
      const aMoG = inst(motorCoils.geometry, 'aGlow', 2, 1), aMoC = inst(motorCoils.geometry, 'aCol', 2, 3);
      for (const h of [0, 1]){
        const can = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, .3, 20), dark);
        can.rotation.x = Math.PI / 2; can.position.set(motorX[h], Y_RAIL, motorZ[h] + (h ? -.08 : .08)); frame.add(can);
        put(motorCoils, h, motorX[h], Y_RAIL, motorZ[h] + (h ? -.08 : .08), 1, 1, 1, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
        GLOW_COIL.toArray(aMoC.array, h * 3);
      }

      // ---- per HAND: carriage, hanger, scissor, chain; per MALLET: track, slider, forearm, wrist, shaft, head ----
      const nCell = rig.nCell, nLink = 2 * nCell, nPin = 3 * nCell + 2;
      // each carriage = a SADDLE (solve.js carriageBoxes: shoe, plate, cap, belt clamp,
      // and the L-bracket — post + arm — that carries its drag chain), unit boxes scaled
      const unit = new THREE.BoxGeometry(1, 1, 1);
      const PART_MAT = { shoe: steel, plate: steel, cap: brass, clamp: dark, post: dark, arm: dark };
      const carParts = Object.fromEntries(Object.entries(PART_MAT).map(([k, m]) => [k, add(new THREE.InstancedMesh(unit, m, 2))]));
      const hangers = add(new THREE.InstancedMesh(new THREE.CylinderGeometry(.06, .06, 1, 12), chrome, 2));
      const slots = add(new THREE.InstancedMesh(new THREE.BoxGeometry(.12, .06, 1), dark, 2));
      const links = add(new THREE.InstancedMesh(new THREE.BoxGeometry(1, .035, .06), chrome, 2 * nLink));
      const pins = add(new THREE.InstancedMesh(new THREE.CylinderGeometry(.04, .04, .12, 10), brass, 2 * nPin));
      const nChain = Math.ceil((RAIL_X1 - RAIL_X0 + .6 + Math.PI * RC) / LINK) + 1;
      const chainLinks = add(new THREE.InstancedMesh(new THREE.BoxGeometry(LINK * .92, CH_H, CH_W), chainM, 2 * nChain));
      const tracks = add(new THREE.InstancedMesh(new THREE.BoxGeometry(.09, .07, ZT1 - ZT0), steel, 4));
      const sliders = add(new THREE.InstancedMesh(new THREE.BoxGeometry(.17, .13, .26), brass, 4));
      const forearms = add(new THREE.InstancedMesh(new THREE.CylinderGeometry(.045, .045, 1, 12), chrome, 4));
      const wrists = add(new THREE.InstancedMesh(new THREE.CylinderGeometry(.095, .095, .17, 18), dark, 4));    // .17 long: tight grips clear by .05
      const wristCoils = add(new THREE.InstancedMesh(new THREE.CylinderGeometry(.1, .1, .08, 18, 1, true), coilM, 4));
      const aWG = inst(wristCoils.geometry, 'aGlow', 4, 1), aWC = inst(wristCoils.geometry, 'aCol', 4, 3);
      for (let k = 0; k < 4; k++) GLOW_COIL.toArray(aWC.array, k * 3);
      const shaftGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 12);
      const shafts = add(new THREE.InstancedMesh(shaftGeo, shaftM, 4));
      const aBend = inst(shaftGeo, 'aBend', 4, 1);
      const ferrules = add(new THREE.InstancedMesh(new THREE.CylinderGeometry(.036, .03, .09, 10), brass, 4));
      const headGeo = new THREE.SphereGeometry(1, 24, 16);
      const heads = add(new THREE.InstancedMesh(headGeo, headM, 4));
      const aHG = inst(headGeo, 'aGlow', 4, 1), aHC = inst(headGeo, 'aCol', 4, 3);

      // ---- one Points cloud: per mallet a head halo + TRAIL_N ghosts + a contact flare; + 2 motor halos ----
      const per = TRAIL_N + 2, NP = 4 * per + 2;
      const halo = makeHaloCloud(NP, glowTex);
      for (const h of [0, 1]) GLOW_COIL.toArray(halo.col.array, (4 * per + h) * 3);
      group.add(halo.points);

      for (const m of meshes) m.frustumCulled = false;
      const edges = plan.mallets.map(() => makeEdge(EDGE_W));
      st = { plan, bars, start: plan.start, barMesh, aFlex, aBG, aRG, aMG, aRP, tubes, put, edges,
             pulleys, teeth, nT, Lb, Lx, beltZ, aMoG, carParts, hangers, slots, links, pins, nCell, nLink, nPin,
             chainLinks, nChain, tracks, sliders, forearms, wrists, wristCoils, aWG, shafts, aBend, ferrules, heads, aHG, aHC,
             halo, per, motorCoils };
      paint(plan.start, false);                          // the ARMED pose from the first frame
      return group;
    }

    const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
    const _s = new THREE.Vector3(), _p = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
    const qZ = a => _q.setFromAxisAngle(_z.set(0, 0, 1), a);
    const qY = a => _q.setFromAxisAngle(_y.set(0, 1, 0), a);
    const qX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);   // cylinder axis → x

    /* Render the machine at time t. live = playing (fire strikes / show motion). */
    function paint(t, live, onStrike, skip){
      const S = st, { plan, bars, put } = S;
      const hs = handsAt(plan, t);
      const ms = [0, 1, 2, 3].map(k => malletAt(plan, k, t, hs));

      // strikes (fire once, from the per-mallet clocks) + head colour/flash
      const hit = plan.mallets.map((M, k) => {
        const lh = lastHit(plan, M, t);
        if (live && lh && !lh.d.armed && S.edges[k].check(lh.d.abs, lh.since, skip) && onStrike){
          const b = bars[lh.s.bar];
          // the SOUND is the impact: vel as the mallet actually landed (= the authored
          // velocity unless the wrist couldn't whip it that hard — see solve.stroke)
          onStrike({ note: layerId(b.note, lh.vel), vel: lh.vel, pos: new THREE.Vector3(lh.s.x, b.top + .03, lh.s.z), color: b.col.getHex(),
                     dur: 0, sparks: Math.round(2 + 5 * lh.vel), light: .45 + .55 * lh.vel, shake: 0 });
        }
        return lh;
      });

      // bars: flex + the warm kiss + resonator glow / pulse
      bars.forEach((b, i) => {
        const L = b.lane.L;
        let since = Infinity, vel = 0;
        if (L){ const d = at(L, t, plan.start); if (!d.armed){ since = d.since; vel = b.lane.hits[d.i].vel; } }
        if (!live) since = Infinity;
        S.aFlex.array[i] = live ? flexAt(plan, i, t) / b.thick : 0;
        S.aBG.array[i] = .03 + .6 * vel * ring(since, 9);
        const rg = vel * ring(since, 1 / b.ringT);
        S.aRG.array[i] = .05 + 1.1 * rg;
        S.aMG.array[i] = .14 + 3.4 * rg;
        S.aRP.array[i * 2] = 1 - since / .24;
        S.aRP.array[i * 2 + 1] = since < .45 ? 2.6 * vel * Math.exp(-since * 3) : 0;
      });
      S.aFlex.needsUpdate = S.aBG.needsUpdate = S.aRG.needsUpdate = S.aMG.needsUpdate = S.aRP.needsUpdate = true;

      // belts: pulleys turn x/r; teeth ride the loop with the carriage clamped to the bottom run
      for (const p of S.pulleys) p.g.rotation.z = hs[p.h].cx / RP;
      for (const h of [0, 1]) for (let k = 0; k < S.nT; k++){
        const a = (((k * TOOTH + hs[h].cx - RAIL_X0) % S.Lb) + S.Lb) % S.Lb;
        const [x, y, ang] = beltPoint(a, S.Lx);
        put(S.teeth, h * S.nT + k, x, y, S.beltZ[h], 1, 1, 1, qZ(ang));
      }
      S.teeth.instanceMatrix.needsUpdate = true;

      // hands — the carriage drive's current follows its TORQUE (|a|, by central
      // differences of the pure motion), plus a little back-EMF with speed
      const DT = .012, hA = handsAt(plan, t - DT), hB = handsAt(plan, t + DT);
      const Hd = [0, 1].map(h => ({
        acc: live ? Math.abs(hB[h].cx - 2 * hs[h].cx + hA[h].cx) / (DT * DT) : 0,
        speed: live ? Math.abs(hB[h].cx - hA[h].cx) / (2 * DT) : 0 }));
      for (const h of [0, 1]){
        const { cx, s } = hs[h];
        for (const b of carriageBoxes(h, cx)){
          const m = S.carParts[b.name];
          put(m, h, (b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2,
              b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
        }
        const zCh = Z0 + (h ? -CH_ZC : CH_ZC);
        // hanger from the carriage's shoe to the scissor's middle joints
        const yShoe = Y_RAIL - BEAM_H / 2 - .15;
        const dz = Math.sqrt(Math.max(0, plan.rig.link ** 2 - (s / S.nCell) ** 2));
        put(S.hangers, h, cx, (yShoe + Y_YOKE) / 2, Z0, 1, yShoe - Y_YOKE, 1);
        put(S.slots, h, cx, Y_YOKE + .05, Z0, 1, 1, plan.rig.link * 2 + .1);
        // the lazy tongs
        const cw = s / S.nCell, ang = Math.atan2(dz, cw);
        for (let c = 0; c < S.nCell; c++){
          const xa = cx - s / 2 + c * cw, xm = xa + cw / 2;
          put(S.links, h * S.nLink + 2 * c, xm, Y_YOKE + .02, Z0, plan.rig.link, 1, 1, qY(-ang));
          put(S.links, h * S.nLink + 2 * c + 1, xm, Y_YOKE - .02, Z0, plan.rig.link, 1, 1, qY(ang));
          put(S.pins, h * S.nPin + c, xm, Y_YOKE, Z0, 1, 1, 1);                         // crossing pin
        }
        for (let c = 0; c <= S.nCell; c++) for (const sd of [0, 1])
          put(S.pins, h * S.nPin + S.nCell + 2 * c + sd, cx - s / 2 + c * cw, Y_YOKE, Z0 + (sd ? dz / 2 : -dz / 2), 1, 1, 1);
        // the drag chain: lower run in the tray, the bend, the upper run back to the bracket arm
        chain(h, cx, CH_Y0, zCh);
        // the motor coil glows with its current: torque (accel) + a little back-EMF
        const I = Math.min(1.6, Hd[h].acc / A_MAX + .04 * Hd[h].speed);
        S.aMoG.array[h] = .06 + 1.4 * I;
        const mh = S.halo, ix = 4 * S.per + h;
        mh.pos.array[ix * 3] = h ? RAIL_X1 : RAIL_X0; mh.pos.array[ix * 3 + 1] = Y_RAIL; mh.pos.array[ix * 3 + 2] = S.beltZ[h] + (h ? -.36 : .36);
        mh.alpha.array[ix] = Math.min(.85, .6 * I); mh.size.array[ix] = .9;
      }
      for (const m of [...Object.values(S.carParts), S.hangers, S.slots, S.links, S.pins, S.chainLinks]) m.instanceMatrix.needsUpdate = true;
      S.aMoG.needsUpdate = true;

      // mallets
      const H2 = S.halo.pos.array, HA = S.halo.alpha.array, HS = S.halo.size.array;
      const past = [];
      if (live) for (let j = 1; j <= TRAIL_N; j++){
        const tj = t - j * TRAIL_DT;
        if (tj < plan.start){ past.push(null); continue; }
        const hj = handsAt(plan, tj);
        past.push([0, 1, 2, 3].map(k => malletAt(plan, k, tj, hj)));
      }
      ms.forEach((p, k) => {
        const M = plan.mallets[k], lh = hit[k];
        put(S.tracks, k, p.x, Y_TRACK + .085, (ZT0 + ZT1) / 2, 1, 1, 1);
        put(S.sliders, k, p.x, Y_TRACK, p.zw, 1, 1, 1);
        put(S.forearms, k, p.x, (Y_TRACK + Y_W) / 2, p.zw, 1, Y_TRACK - Y_W, 1);
        put(S.wrists, k, p.x, Y_W, p.zw, 1, 1, 1, qX);
        put(S.wristCoils, k, p.x, Y_W, p.zw, 1, 1, 1, qX);
        // the shaft: wrist pivot → head, its local x = the bend direction (in the stroke plane)
        _y.set(0, p.y - Y_W, p.z - p.zw).normalize();
        _x.crossVectors(_y, X).normalize();
        _z.crossVectors(_x, _y);
        const len = LS - HEAD_R * .6;
        _m.makeBasis(_x, _y, _z);
        _q.setFromRotationMatrix(_m);
        _p.set(p.x, Y_W, p.zw).addScaledVector(_y, len / 2);
        S.shafts.setMatrixAt(k, m4c.compose(_p, _q, _s.set(.026, len, .026)));
        S.aBend.array[k] = live ? bendAt(plan, M, t) / .026 : 0;
        _p.set(p.x, Y_W, p.zw).addScaledVector(_y, LS - HEAD_R - .03);
        S.ferrules.setMatrixAt(k, m4c.compose(_p, _q, _s.set(1, 1, 1)));
        put(S.heads, k, p.x, p.y, p.z, HEAD_R, HEAD_R, HEAD_R);
        // colour: the bar it last struck (the bar it's about to strike while armed)
        const sIdx = lh && !lh.d.armed ? lh.d.i : M.L ? at(M.L, t, plan.start).next : -1;
        const b = sIdx >= 0 && M.strikes[sIdx] ? bars[M.strikes[sIdx].bar] : null;
        const col = b ? b.col : GLOW_COIL;
        col.toArray(S.aHC.array, k * 3);
        const since = live && lh && !lh.d.armed ? lh.since : Infinity, vel = lh?.vel ?? 0;
        S.aHG.array[k] = 1.3 + 3.5 * vel * ring(since, 10);
        // the wrist motor's coil: throws the down-stroke (brighter for a WHIP — a short
        // stroke thrown hard to land as loud as asked) and brakes the rebound
        S.aWG.array[k] = .05 + 2 * (live ? wristDrive(plan, M, t) : 0);
        // halos: the head, its ghosts (only when moving fast), the contact flare
        const base = k * S.per;
        H2[base * 3] = p.x; H2[base * 3 + 1] = p.y; H2[base * 3 + 2] = p.z;
        col.toArray(S.halo.col.array, base * 3);
        HA[base] = .55 + .45 * vel * ring(since, 8); HS[base] = HEAD_R * (7 + 4 * ring(since, 8));
        let prev = p;
        for (let j = 0; j < TRAIL_N; j++){
          const g = base + 1 + j, q1 = past[j]?.[k];
          col.toArray(S.halo.col.array, g * 3);
          if (!q1){ HA[g] = 0; continue; }
          const sp = Math.hypot(prev.x - q1.x, prev.y - q1.y, prev.z - q1.z) / TRAIL_DT;
          prev = q1;
          const f = 1 - (j + 1) / (TRAIL_N + 1), fast = Math.min(1, Math.max(0, (sp - 2.5) / 6));
          H2[g * 3] = q1.x; H2[g * 3 + 1] = q1.y; H2[g * 3 + 2] = q1.z;
          HA[g] = .5 * f * fast; HS[g] = HEAD_R * 5 * (.45 + .55 * f);
        }
        const cf = base + S.per - 1, fa = vel * ring(since, 14);
        if (lh?.s){ const bb = bars[lh.s.bar]; H2[cf * 3] = lh.s.x; H2[cf * 3 + 1] = bb.top + .03; H2[cf * 3 + 2] = lh.s.z;
          bb.col.toArray(S.halo.col.array, cf * 3); HS[cf] = bb.w * (2 + 3.5 * (1 - ring(since, 14))); }
        HA[cf] = fa > .01 ? Math.min(1, 1.1 * fa) : 0;
      });
      for (const m of [S.tracks, S.sliders, S.forearms, S.wrists, S.wristCoils, S.shafts, S.ferrules, S.heads]) m.instanceMatrix.needsUpdate = true;
      S.aBend.needsUpdate = S.aHG.needsUpdate = S.aHC.needsUpdate = S.aWG.needsUpdate = true;
      S.halo.pos.needsUpdate = S.halo.alpha.needsUpdate = S.halo.size.needsUpdate = S.halo.col.needsUpdate = true;
    }
    const m4c = new THREE.Matrix4();

    /* A drag chain: fixed end at its rail end, lower run on the tray, a U-bend, the
       upper run back to the carriage bracket. Constant length — links on the lower run
       never move; the bend rolls at half the carriage's speed (exactly like the real thing). */
    function chain(h, cx, y0, z){
      const S = st, put = S.put, dir = h ? -1 : 1;
      const xA = h ? RAIL_X1 + .05 : RAIL_X0 - .05;
      const C = (RAIL_X1 - RAIL_X0) + .5;               // ≥ the full travel: the bend always lies beyond the carriage
      const xU = h ? (xA + cx - C) / 2 : (C + xA + cx) / 2;
      const l1 = Math.abs(xU - xA), Lc = C + Math.PI * RC;
      for (let k = 0; k < S.nChain; k++){
        const a = (k + .5) * LINK, ix = h * S.nChain + k;
        let x, y, ang;
        if (a > Lc){ put(S.chainLinks, ix, xA, y0, z, 0, 0, 0); continue; }
        if (a <= l1){ x = xA + dir * a; y = y0; ang = 0; }
        else if (a <= l1 + Math.PI * RC){ const f = (a - l1) / RC; x = xU + dir * RC * Math.sin(f); y = y0 + RC - RC * Math.cos(f); ang = dir * f; }
        else { x = xU - dir * (a - l1 - Math.PI * RC); y = y0 + 2 * RC; ang = dir * Math.PI; }
        put(S.chainLinks, ix, x, y, z, 1, 1, 1, qZ(ang));
      }
    }

    function update(songTime, P, dt, { started, skipStrikes, onStrike }){
      if (!st) return;
      paint(started ? Math.max(songTime, st.start) : st.start, !!started, onStrike, skipStrikes);
    }

    return { build, update };
  },

  /* 32 beats in A minor — a showreel for four mallets: chorale STABS (4-note chords,
     two per hand, the scissors snapping open and shut), a 16th-note scale up across
     the whole keyboard (the line hands off left → right), alternating LEAPS (low /
     high: both carriages jump), the scale back down, ROLLS (a right-hand tremolo on
     E5 over a walking left hand, then both hands rolling a fifth), parallel thirds,
     and a final A-minor chord ROLLED by all four mallets into the loop. */
  demo: {
    bpm: 100, beats: 32, scale: ['A', 'B', 'C', 'D', 'E', 'F', 'G#'],
    part: [
      [0, 'A3', 1], [0, 'E4', 1], [0, 'A4', 1], [0, 'C5', 1],
      [1.5, 'A3', .55], [1.5, 'E4', .55], [1.5, 'A4', .55], [1.5, 'C5', .55],
      [2, 'G3', .75], [2, 'D4', .75], [2, 'G4', .75], [2, 'B4', .75],
      [3, 'F3', .85], [3, 'C4', .85], [3, 'F4', .85], [3, 'A4', .85],
      [4, 'E3', 1], [4, 'B3', 1], [4, 'E4', 1], [4, 'G#4', 1],
      [5.5, 'E3', .5], [5.5, 'B3', .5], [5.5, 'E4', .5], [5.5, 'G#4', .5],
      [6, 'E3', .8], [6, 'D4', .8], [6, 'G#4', .8], [6, 'B4', .8],
      ...['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G#4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G#5', 'A5']
        .map((n, k) => [8 + k * .25, n, +(.42 + .04 * k).toFixed(2)]),
      [12, 'A3', 1], [12, 'A5', 1],
      [12.5, 'E5', .6], [13, 'E3', .75], [13.5, 'B5', .7], [14, 'G#3', .8], [14.5, 'E5', .65], [15, 'A3', .85], [15.5, 'C6', .9],
      ...['A5', 'G#5', 'F5', 'E5', 'D5', 'C5', 'B4', 'A4', 'G#4', 'F4', 'E4', 'D4', 'C4', 'B3', 'A3']
        .map((n, k) => [16 + k * .25, n, +(.95 - .035 * k).toFixed(2)]),
      [20, 'E5', .6, 1.5], [20, 'A3', .7], [21, 'C4', .55], [21.5, 'G4', .5],
      [22, 'A4', .75, 1.75], [22, 'E5', .8, 1.75],
      [24, 'A4', .7], [24, 'C5', .7], [24.5, 'G#4', .6], [24.5, 'B4', .6], [25, 'F4', .65], [25, 'A4', .65],
      [25.5, 'E4', .6], [25.5, 'G#4', .6], [26, 'D4', .7], [26, 'F4', .7], [26.5, 'C4', .65], [26.5, 'E4', .65],
      [27, 'B3', .75], [27, 'D4', .75], [27.5, 'G#3', .8], [27.5, 'B3', .8],
      [28, 'A3', .9, 3], [28, 'E4', .9, 3], [28, 'A4', .9, 3], [28, 'C5', .9, 3],
    ],
  },
};

/* ---- helpers ---- */
/** A point on the belt loop at arc length a from the bottom-left (bottom run → right
    pulley → top run → left pulley): [x, y, tangent angle]. */
function beltPoint(a, Lx){
  const h = Math.PI * RP, R = RP + .015;
  if (a < Lx) return [RAIL_X0 + a, Y_RAIL - R, 0];
  if (a < Lx + h){ const f = (a - Lx) / RP; return [RAIL_X1 + R * Math.sin(f), Y_RAIL - R * Math.cos(f), f]; }
  if (a < 2 * Lx + h) return [RAIL_X1 - (a - Lx - h), Y_RAIL + R, Math.PI];
  const f = (a - 2 * Lx - h) / RP; return [RAIL_X0 - R * Math.sin(f), Y_RAIL + R * Math.cos(f), Math.PI + f];
}

/* Vertex colours along x: the signature rose (low) → violet → ice-cyan (high), bright for bloom. */
function paintGradient(geo, x0, x1){
  const p = geo.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color();
  for (let i = 0; i < p.count; i++){
    col.setHSL(laneHue((p.getX(i) - x0) / (x1 - x0)), .9, .55).multiplyScalar(2.2).toArray(c, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

function inst(geo, name, n, size){
  const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size);
  a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute(name, a);
  return a;
}

/* Shared instanced emissive: emissive += aCol · aGlow (heads, coils, resonator mouths). */
function glowPatch(sh){
  sh.vertexShader = 'attribute float aGlow;\nattribute vec3 aCol;\nvarying float vGlow;\nvarying vec3 vCol;\n' +
    sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow; vCol = aCol;');
  sh.fragmentShader = 'varying float vGlow;\nvarying vec3 vCol;\n' + sh.fragmentShader.replace(
    '#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vCol * vGlow;');
}

/* Mallet shaft: a bow along local x, 0 at both ends (the wrist and the head stay put),
   aBend = mid-span deflection in object units (world / radius). */
function shaftPatch(sh){
  sh.vertexShader = 'attribute float aBend;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    float u = position.y + .5;
    transformed.x += aBend * 4. * u * (1. - u);`);
}

/* Resonator tube: the glow pools toward the mouth (top) of the tube. */
function resonatorPatch(sh){
  sh.vertexShader = 'attribute float aGlow;\nattribute vec3 aCol;\nattribute vec2 aPulse;\nvarying float vGlow;\nvarying vec3 vCol;\nvarying float vH;\nvarying vec2 vPulse;\n' +
    sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow; vCol = aCol; vH = position.y + .5; vPulse = aPulse;');
  sh.fragmentShader = 'varying float vGlow;\nvarying vec3 vCol;\nvarying float vH;\nvarying vec2 vPulse;\n' + sh.fragmentShader.replace(
    '#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float band = (vH - vPulse.x) * 7.;
      totalEmissiveRadiance += vCol * (vGlow * (.15 + .85 * vH * vH) + vPulse.y * exp(-band * band));`);
}

/* Rosewood bar: the underside ARCH (the real tuning cut between the nodes), the
   first free-free bending mode (centre against the ends, nodes still), wood grain,
   and the strike glow. aFlex = centre deflection / thickness (object units). */
function barPatch(sh){
  sh.vertexShader = 'attribute float aFlex;\nattribute float aGlow;\nattribute vec3 aCol;\nvarying float vGlow;\nvarying vec3 vCol;\nvarying vec3 vObj;\n' + MODE_GLSL + '\n' +
    sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float u = position.z;
      float aw = .23;
      float arch = .42 * max(0., 1. - (u * u) / (aw * aw));
      if (position.y < 0.) transformed.y += arch;
      transformed.y += aFlex * -modeShape(u);
      vGlow = aGlow; vCol = aCol; vObj = position;`);
  sh.fragmentShader = 'varying float vGlow;\nvarying vec3 vCol;\nvarying vec3 vObj;\n' + sh.fragmentShader
    .replace('#include <color_fragment>', `#include <color_fragment>
      float gr = sin(vObj.x * 34. + 3.2 * sin(vObj.z * 5.5 + vObj.x * 4.) + vObj.y * 3.);
      float fine = sin(vObj.x * 190. + 9. * sin(vObj.z * 3.7 + vObj.x * 11.));
      float heart = smoothstep(.28, .5, abs(vObj.z));
      diffuseColor.rgb *= (.66 + .28 * smoothstep(-.4, 1., gr) + .07 * fine) * (1. - .28 * heart);`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float centre = 1. - smoothstep(0., .5, abs(vObj.z));
      totalEmissiveRadiance += vCol * vGlow * (.35 + .65 * centre);`);
}

/* One additive Points cloud for every halo + ghost (constant count → no recompiles).
   Point size in world units, perspective-correct (scale read from the camera each render). */
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

