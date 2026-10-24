import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DESCENT, beltPhase } from './engine.js';
import { plateAt, carriageAt, ballAt, eventsIn, laneX, railX, parkY } from './juggle.js';
import { PT, PTGEO, makeToneBarParts, merge, bakeStill, sprocketGeometry, gearGeometry, cradleGeometry, warmTex } from './paternoster.js';
import { glowBatch } from './juice.js';
import { velLook } from './dynamics.js';

/* ============================================================
   JUGGLER BELT — the body of the melody belt, a multiball juggling machine. src/juggle.js
   plans it (pure, tested); this file only DRAWS what the plan says — a render subsystem like
   the paternoster before it: THREE only, no audio, no song logic.

   ONE machine for every belt voice:
     · nine lane CHAINS between the housings — the keyboard, low notes left. A note's tone-plate
       rides its lane's chain out of the bottom housing, unfolds onto its voice's hand line,
       kicks on the beat, drops away and folds back onto the chain, and stows in the top one.
     · the CRANE GANTRY in front of the top housing: two rails per voice (one over each hand),
       one magnet carriage per ball, on two towers past the housing's ends. The rail ends are
       where the carriages park across the loop's breath.
     · the BALLS: every voice's juggling marbles, each one a ball of the plan (ballAt).
   Every pose is the plan's own pure fn of songTime (plateAt / carriageAt / ballAt): the chains
   scroll at DESCENT, so they are slip-free with the plates by construction, and scrubbing is
   exact. Strikes and docks are timeline crossings (the plan's strike / dock times), never a
   scheduler.

   Local frame = the plan's band frame: y 0 = a ball's centre at its strike (the old belt's
   contact level, band + UP), x across the lanes, z toward the audience. main places it at
   (0, STAGE_Y + UP.y, 0).
   ============================================================ */

const UPY = .26;                                   // engine UP.y: the contact level over the band
const BAND = -UPY;                                 // the band, local — the paternoster's housings are built around it
const { CZ, RC, TEETH, SPROCK, SKIRT, CROWN, FRONT, BACK, END, GEAR_R, COL_W } = PTGEO;
const RAIL_GAP = .45;                              // a carriage's rail runs this far over its parked magnet's top
const TRAIL_N = 9, TRAIL_DT = .017;                // the analytic trail: puffs along the ball's own past path
const HOT = new THREE.Color(0xff5a1e), ICE = new THREE.Color(0x8fd8ff), AMBER = new THREE.Color(0xffa040);
const XAXIS = new THREE.Vector3(1, 0, 0), YAXIS = new THREE.Vector3(0, 1, 0), ZAXIS = new THREE.Vector3(0, 0, 1);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(),
      _a = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Color(), _v = new THREE.Vector3();
const wrap = (t, P) => ((t % P) + P) % P;
/* the paternoster's chain link, lighter — nine chains of it (≈ 1500 links): flat side plates and
   one open roller (its ends hide between the plates) — 40 triangles, not ~290 */
function liteLink(pitch){
  const parts = [];
  for (const sx of [-1, 1]) parts.push(new THREE.BoxGeometry(.035, pitch * 1.22, .15).translate(sx * .08, pitch / 2, 0));
  parts.push(new THREE.CylinderGeometry(.052, .052, .125, 8, 1, true).rotateZ(Math.PI / 2));
  return merge(parts);
}
function floorIdx(arr, v){ let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi){ const m = (lo + hi) >> 1; if (arr[m] <= v){ ans = m; lo = m + 1; } else hi = m - 1; } return ans; }

/* the rail of voice V over hand h: its height (local y) and depth */
export const railOf = (V, h) => ({ y: parkY(V) + V.r + V.o.MAG_H + RAIL_GAP, z: V.hands[h] });

export function makeJugglerShop({ envMap, floorY, rig }){   // rig: per role {r, body, emissive, glow, glowTex}
  return { build };

  /* J: planJuggler's plan (or a LAYOUT with no solve yet — the machine runs empty while a worker
     solves). floorY: the room floor in the machine's local y. hueOf: a note's rim hue (song scale). */
  function build(J, { hueOf = () => 0 } = {}){
    const o = J.o, VS = J.voices, solved = VS.every(V => V.plates);
    const M = {
      gun:   new THREE.MeshStandardMaterial({ color: 0x2c323d, metalness: .85, roughness: .4, envMap,
               emissive: new THREE.Color(0x10141d), emissiveIntensity: 1 }),
      gunDk: new THREE.MeshStandardMaterial({ color: 0x1a1e26, metalness: .8, roughness: .5, envMap }),
      steel: new THREE.MeshStandardMaterial({ color: 0xb4bcca, metalness: 1, roughness: .26, envMap, envMapIntensity: 1.3,
               emissive: new THREE.Color(0x141a26), emissiveIntensity: 1 }),
      // nine chains scroll all the time: dark oiled steel, rough, no glow of its own — machinery
      // that recedes behind the plates and balls (bright steel here sparkled across the whole band)
      chain: new THREE.MeshStandardMaterial({ color: 0x5a616d, metalness: .9, roughness: .52, envMap, envMapIntensity: .5 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xcf9b45, metalness: 1, roughness: .3, envMap, envMapIntensity: 1.3,
               emissive: new THREE.Color(0x2a1a06), emissiveIntensity: 1 }),
      warm:  new THREE.MeshStandardMaterial({ color: 0x120c08, metalness: .3, roughness: .8,
               emissive: new THREE.Color(0xff8a3a), emissiveIntensity: .55, emissiveMap: warmTex() }),
      cable: new THREE.MeshStandardMaterial({ color: 0x1c1f26, metalness: .6, roughness: .5 }),
      rod:   new THREE.MeshStandardMaterial({ color: 0x6d7586, metalness: 1, roughness: .35, envMap }),
      glow:  new THREE.MeshBasicMaterial({ color: AMBER.clone().multiplyScalar(2.4) }),
      slot:  new THREE.MeshBasicMaterial({ color: 0x0a0604, side: THREE.DoubleSide }),
      add:   () => new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }),
    };
    const geos = [], keep = g => (geos.push(g), g);
    const root = new THREE.Group(); root.name = 'juggler';
    const frame = new THREE.Group(); frame.name = 'juggler:frame';   // the machine (key M hides it; plates + balls stay)
    root.add(frame);
    const mesh = (g, m, x = 0, y = 0, z = 0, parent = frame) => { const ob = new THREE.Mesh(g, m); ob.position.set(x, y, z); parent.add(ob); return ob; };
    const inst = (g, m, n, parent = frame) => { const im = new THREE.InstancedMesh(g, m, Math.max(1, n)); im.count = 0; im.frustumCulled = false; parent.add(im); return im; };

    /* ---------- the lane field ---------- */
    const LN = J.lanes, xs = Array.from({ length: LN }, (_, k) => laneX(k, o));
    const xL = xs[0] - 1.0, xR = xs[LN - 1] + 1.0;
    const hw = xR - xL + 2 * END, hd = FRONT - BACK, hzc = (FRONT + BACK) / 2;

    /* the chain loop: pitch locked to the sprocket's teeth, run locked to whole links (paternoster) */
    const pitch = 2 * Math.PI * RC / TEETH;
    const H = Math.round(2 * SPROCK / (pitch / 2)) * (pitch / 2);
    const Lc = 2 * H + 2 * Math.PI * RC, NL = Math.round(Lc / pitch);
    const yB = BAND - H / 2, yT = BAND + H / 2, gzc = CZ - RC;

    /* ---------- housings (top + bottom): the paternoster's sculpted skirt / open window / crown,
       one wide pair across the whole keyboard ---------- */
    const SK = SKIRT - PT.LIP, WIN = CROWN - SKIRT;
    const skirtGeo = keep(new RoundedBoxGeometry(hw, SK, hd, 3, .16));
    const crownGeo = keep(new RoundedBoxGeometry(hw + .3, .34, hd + .15, 3, .14));
    const backGeo  = keep(new THREE.PlaneGeometry(hw - .1, WIN));
    const cheekGeo = keep(new RoundedBoxGeometry(.16, WIN + .1, hd, 2, .05));
    const nosingGeo = keep(new THREE.CylinderGeometry(.07, .07, hw + .3, 14).rotateZ(Math.PI / 2));
    const trimGeo = keep(new RoundedBoxGeometry(hw + .06, .1, .12, 2, .04));
    const slotW = xs[LN - 1] - xs[0] + 2.2;
    const SLOT_Z0 = -2.15, SLOT_Z1 = -.85;
    const slotGeo = keep(new THREE.PlaneGeometry(slotW, SLOT_Z1 - SLOT_Z0));
    const glowLineGeo = keep(new THREE.BoxGeometry(slotW, .035, .035));
    const ribGeo = keep(new THREE.BoxGeometry(.06, SK - .3, .05));
    const sillGeo = keep(new THREE.BoxGeometry(hw - .3, .05, .05));
    const guideGeo = keep(new THREE.BoxGeometry(.26, 1, .06));
    for (const s of [1, -1]){
      const lipY = BAND + s * PT.LIP;
      mesh(skirtGeo, M.gun, 0, BAND + s * (PT.LIP + SK / 2), hzc);
      mesh(crownGeo, M.gun, 0, BAND + s * (CROWN + .17), hzc - .075);
      mesh(nosingGeo, M.brass, 0, BAND + s * (CROWN + .05), FRONT - .05);
      const back = mesh(backGeo, M.warm, 0, BAND + s * (SKIRT + WIN / 2), BACK + .02);
      if (s < 0) back.rotation.z = Math.PI;
      for (const side of [-1, 1]) mesh(cheekGeo, M.gun, side * (hw / 2 - .08), BAND + s * (SKIRT + WIN / 2), hzc);
      mesh(sillGeo, M.glow, 0, BAND + s * (SKIRT + .03), BACK + .08);
      mesh(trimGeo, M.brass, 0, lipY + s * .055, FRONT + .02);
      mesh(trimGeo, M.brass, 0, BAND + s * (SKIRT - .055), FRONT + .02);
      const nRib = Math.max(2, Math.round(hw / 1.6));
      for (let k = 1; k < nRib; k++) mesh(ribGeo, M.gunDk, xL - END + k * hw / nRib, BAND + s * (PT.LIP + SK / 2), FRONT + .03);
      const slot = mesh(slotGeo, M.slot, 0, lipY - s * .004, (SLOT_Z0 + SLOT_Z1) / 2);
      slot.rotation.x = Math.PI / 2;
      for (const z of [SLOT_Z0, SLOT_Z1]) mesh(glowLineGeo, M.glow, 0, lipY - s * .02, z);
    }
    for (const x of xs){ const gd = mesh(guideGeo, M.gunDk, x, BAND, CZ - .11); gd.scale.y = 2 * PT.LIP; }   // a dark channel behind each lane's chain

    /* ---------- sprockets (one pair per lane), line shafts, outboard gears, columns ---------- */
    const sprGeo  = keep(sprocketGeometry(RC, TEETH, .085));
    const gearGeo = keep(gearGeometry(GEAR_R, 22, .14));
    const hubGeo  = keep(new THREE.CylinderGeometry(.2, .2, .05, 28).rotateZ(Math.PI / 2));
    const ringGeo = keep(new THREE.TorusGeometry(.3, .045, 10, 32).rotateY(Math.PI / 2));
    const shaftGeo = keep(new THREE.CylinderGeometry(.06, .06, 1, 14).rotateZ(Math.PI / 2));
    const colTop = BAND + CROWN + .4, colH = colTop - floorY;
    const colGeo = keep(new THREE.BoxGeometry(COL_W, colH, COL_W));
    const footGeo = keep(new RoundedBoxGeometry(COL_W * 3, .35, COL_W * 4, 2, .06));
    const bearGeo = keep(new RoundedBoxGeometry(.32, .6, .6, 2, .06));
    const lampGeo = keep(new THREE.CylinderGeometry(.09, .09, .03, 20).rotateX(Math.PI / 2));
    const braceGeo = keep(new THREE.BoxGeometry(hw + 2 * (END + .5), .16, .16));
    const spin = [];                                   // [mesh, phase]: rotation.x = −st/RC + phase
    const phTop = Math.PI + H / RC, phBot = Math.PI + 2 * H / RC;
    const sprockets = inst(sprGeo, M.steel, 2 * LN);
    for (const ys of [yT, yB]){ const sh = mesh(shaftGeo, M.steel, 0, ys, gzc); sh.scale.x = hw; spin.push([sh, 0]); }
    for (const side of [-1, 1]){
      const xEnd = side * (hw / 2), xg = xEnd + side * .14, xc = xEnd + side * .5;
      mesh(colGeo, M.gun, xc, floorY + colH / 2, gzc);
      mesh(footGeo, M.gunDk, xc, floorY + .17, gzc);
      for (const ys of [yT, yB]){
        spin.push([mesh(gearGeo, M.steel, xg, ys, gzc), 0], [mesh(hubGeo, M.glow, xg + side * .1, ys, gzc), 0]);
        mesh(ringGeo, M.brass, xg + side * .08, ys, gzc);
        const sh = mesh(shaftGeo, M.steel, (xEnd + xc) / 2, ys, gzc); sh.scale.x = Math.abs(xc - xEnd);
        mesh(bearGeo, M.brass, xc, ys, gzc);
        mesh(lampGeo, M.glow, xc, ys, gzc + .31);
      }
    }
    mesh(braceGeo, M.gun, 0, BAND - CROWN - 1.2, gzc);

    /* ---------- the CRANE GANTRY: a T-rail per voice per hand, between two towers past the
       housing's ends (the rail ends are the parking) ---------- */
    const RAIL = railX(o), RL = RAIL + .55;
    const rails = [];
    VS.forEach((V, vi) => V.hands.forEach((_, h) => rails.push({ vi, h, ...railOf(V, h) })));
    const zs = rails.map(r => r.z), z0 = Math.min(...zs) - .32, z1 = Math.max(...zs) + .32;
    const yTop = Math.max(...rails.map(r => r.y)) + .42;
    const railGeo = keep(merge([new THREE.BoxGeometry(2 * RL, .05, .16).translate(0, .07, 0),   // flange the trolley rolls on
                                new THREE.BoxGeometry(2 * RL, .14, .05)]));                     // web
    for (const r of rails) mesh(railGeo, M.rod, 0, r.y, r.z);
    const XT = RL + .22;                               // tower centre-line
    const postGeo = keep(new THREE.BoxGeometry(.22, yTop - floorY, .22));
    const capGeo = keep(new RoundedBoxGeometry(.5, .22, z1 - z0 + .5, 2, .05));
    const hangerGeo = keep(new THREE.BoxGeometry(.3, .12, z1 - z0 + .1));
    const stopGeo = keep(new RoundedBoxGeometry(.16, .26, .24, 2, .04));
    const tFootGeo = keep(new RoundedBoxGeometry(.7, .3, z1 - z0 + 1, 2, .06));
    for (const side of [-1, 1]){
      const x = side * XT;
      for (const z of [z0, z1]) mesh(postGeo, M.gun, x, floorY + (yTop - floorY) / 2, z);
      mesh(capGeo, M.gun, x, yTop + .11, (z0 + z1) / 2);
      mesh(tFootGeo, M.gunDk, x, floorY + .15, (z0 + z1) / 2);
      for (const r of rails){
        mesh(hangerGeo, M.gunDk, x, r.y, (z0 + z1) / 2);
        mesh(stopGeo, M.brass, side * (RL - .08), r.y + .02, r.z);   // the rail's end stop
      }
      // tie the tower to the housing column behind it: one rigid machine
      const xc = side * (hw / 2 + .5);
      const tie = new THREE.Mesh(keep(new THREE.BoxGeometry(.14, .14, 1)), M.gun);
      _a.set(xc, colTop - .3, gzc); _d.set(x, yTop, z0);
      tie.position.copy(_a).add(_d).multiplyScalar(.5);
      tie.quaternion.setFromUnitVectors(ZAXIS, _v.subVectors(_d, _a).normalize());
      tie.scale.z = _a.distanceTo(_d); frame.add(tie);
    }

    // PERF: the still frame (housings, ribs, columns, gantry …) bakes into one mesh per material
    { const turning = new Set(spin.map(([m]) => m)); bakeStill(frame, frame.children.filter(ob => ob.isMesh && !ob.isInstancedMesh && !turning.has(ob))); }

    /* ---------- the lane chains: one instanced loop per lane ---------- */
    const chains = inst(keep(liteLink(pitch)), M.chain, LN * NL);
    chains.count = LN * NL;
    chains.setColorAt(0, _c.setRGB(1, 1, 1));
    const RUN = [1, .6, .38];                        // a link's shade: the working run, round a sprocket, the return run (in shadow)
    const _ca = [0, 0, 0, 1];
    const chainAt = s => {
      s = ((s % Lc) + Lc) % Lc;
      if (s < H){ _ca[0] = yB + s; _ca[1] = CZ; _ca[2] = 0; _ca[3] = RUN[0]; return _ca; }
      s -= H;
      if (s < Math.PI * RC){ const t = s / RC; _ca[0] = yT + RC * Math.sin(t); _ca[1] = CZ - RC + RC * Math.cos(t); _ca[2] = -t; _ca[3] = RUN[1]; return _ca; }
      s -= Math.PI * RC;
      if (s < H){ _ca[0] = yT - s; _ca[1] = CZ - 2 * RC; _ca[2] = Math.PI; _ca[3] = RUN[2]; return _ca; }
      const t = (s - H) / RC;
      _ca[0] = yB - RC * Math.sin(t); _ca[1] = CZ - RC - RC * Math.cos(t); _ca[2] = Math.PI - t; _ca[3] = RUN[1]; return _ca;
    };

    /* ---------- the KEYS: a lit tile per lane on the bottom housing's face, flashing with the
       hue of the plate struck in its lane — the tune reads side to side ---------- */
    const keyGeo = keep(new RoundedBoxGeometry(o.LANE_D * .78, .16, .05, 2, .03));
    const keys = inst(keyGeo, M.add(), LN);
    keys.count = LN;
    for (let k = 0; k < LN; k++){ _m.makeTranslation(xs[k], BAND - PT.LIP - .42, FRONT + .045); keys.setMatrixAt(k, _m); keys.setColorAt(k, _c.setRGB(0, 0, 0)); }

    const balls = [], lamps = [];
    let trail = null, prevT = null;
    const api = { group: root, frame, update, dispose, xr, focus: VS.map(() => new THREE.Vector3()), st: VS.map(() => null),
                  rails, width: 2 * (XT + .6), lanes: xs, solved, balls };
    if (!solved){ api.update = t => { poseFrame(t); }; return api; }   // (a layout still being solved: the machine stands ready, empty)

    /* ---------- plates (instanced over every voice): bar, rim, pins in the open; the carrier
       (cradle, spine, shoe on the lane chain) is part of the machine ---------- */
    const bar = makeToneBarParts({ envMap });
    bar.rimGeo.translate(0, .062, 0);
    keep(bar.barGeo); keep(bar.rimGeo); keep(bar.pinGeo);
    const capOf = V => { const T = V.strikeT, w = 2 * V.cullC + .05; let best = 0;
      for (let i = 0; i < T.length; i++){ let c = 0; for (let k = 0; k < T.length; k++) if (wrap(T[k] - T[i], V.P) <= w) c++; best = Math.max(best, c); }
      return best + 2; };
    const CAP = VS.reduce((n, V) => n + capOf(V), 0);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .7, roughness: .24, envMap, envMapIntensity: 1.7 });
    const glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const bodyGeo = bar.barGeo.clone(); keep(bodyGeo); bodyGeo.setAttribute('iGlow', glowAttr);
    bodyMat.onBeforeCompile = sh => {                // a per-plate lit floor: hue + flash + anticipation into the emissive
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 iGlow;\nvarying vec3 vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = iGlow;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;');
    };
    bodyMat.customProgramCacheKey = () => 'juggler-plate';
    const bodies = inst(bodyGeo, bodyMat, CAP, root), rims = inst(bar.rimGeo, M.add(), CAP, root), pins = inst(bar.pinGeo, bar.brass, CAP, root);
    const cradles = inst(keep(cradleGeometry(1)), M.brass, CAP);
    const shoes = inst(keep(new RoundedBoxGeometry(.2, .2, .16, 2, .04)), M.gun, CAP);
    // the ARM from the shoe to the plate's hub: a telescoping ram — a gunmetal sleeve off the shoe,
    // a polished rod sliding out of it (a plate far out on the front row has a long reach)
    const SLEEVE = .9;
    const sleeves = inst(keep(new THREE.CylinderGeometry(.05, .05, 1, 10).rotateX(Math.PI / 2).translate(0, 0, .5)), M.gun, CAP);
    const rods = inst(keep(new THREE.CylinderGeometry(.024, .024, 1, 8).rotateX(Math.PI / 2).translate(0, 0, .5)), M.steel, CAP);
    const steelTint = { lead: new THREE.Color(0xe2e7f0), alto: new THREE.Color(0xe2e7f0), bass: new THREE.Color(0xb4c0da) };
    const plateLook = VS.map(V => V.plates.map(p => {
      const hue = hueOf(p.note);
      return { hue, rim: new THREE.Color().setHSL(hue, .9, .62).multiplyScalar(1.35), floor: new THREE.Color().setHSL(hue, .7, .5),
               look: velLook(p.vel ?? 1), q: new THREE.Quaternion(p.q.x, p.q.y, p.q.z, p.q.w),
               amp: THREE.MathUtils.clamp(Math.abs(p.vout.x * p.n.x + p.vout.y * p.n.y + p.vout.z * p.n.z) * .07, .05, 1.6) };
    }));
    // the keys' strike lists: every plate struck in each lane, any voice (sorted)
    const laneHits = xs.map(() => []);
    VS.forEach((V, vi) => V.plates.forEach((p, k) => laneHits[p.lane].push({ t: p.s, col: plateLook[vi][k].rim, look: plateLook[vi][k].look })));
    laneHits.forEach(l => l.sort((a, b) => a.t - b.t));
    const laneT = laneHits.map(l => l.map(h => h.t));

    /* ---------- carriages (instanced over every voice) ---------- */
    const carr = [];
    VS.forEach((V, vi) => V.carriages.forEach((C, c) => carr.push({ V, vi, c, C, rail: railOf(V, C.hand) })));
    const NC = carr.length;
    const mr = o.MAG_R;
    const magGeo = keep(merge([
      new THREE.CylinderGeometry(mr, mr * 1.04, .3, 24).translate(0, .15 + .05, 0),
      new THREE.CylinderGeometry(mr * .55, mr * .7, .12, 18).translate(0, .41, 0),
      new THREE.CylinderGeometry(.05, .05, .12, 8).translate(0, .52, 0),
    ]));
    const trolleys = inst(keep(new RoundedBoxGeometry(.46, .24, .3, 2, .05)), M.gun, NC);
    const drums = inst(keep(new THREE.CylinderGeometry(.1, .1, .3, 16).rotateZ(Math.PI / 2)), M.brass, NC);
    const cables = inst(keep(new THREE.CylinderGeometry(.014, .014, 1, 6)), M.cable, NC);
    const mags = inst(magGeo, M.steel, NC);
    const faces = inst(keep(new THREE.CylinderGeometry(mr * .96, mr * .96, .05, 24)), M.gunDk, NC);
    const coils = inst(keep(new THREE.TorusGeometry(mr * .92, .05, 10, 32).rotateX(Math.PI / 2)), M.add(), NC);
    const tells = inst(keep(new THREE.CylinderGeometry(.05, .05, .03, 14).rotateX(Math.PI / 2)), M.add(), NC);
    for (const im of [trolleys, drums, cables, mags, faces, coils, tells]) im.count = NC;

    /* ---------- the balls: one rig per ball of the plan, one lamp per voice ---------- */
    VS.forEach((V, vi) => {
      const opt = rig[V.role] || rig.lead;
      const coreMat = new THREE.MeshStandardMaterial({ color: opt.body, emissive: opt.emissive, emissiveIntensity: 1.2, metalness: .3, roughness: .25, envMap });
      const haloMat = new THREE.SpriteMaterial({ map: opt.glowTex, color: opt.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .12 });
      const coreGeo = keep(new THREE.SphereGeometry(V.r, 32, 32));
      for (let b = 0; b < V.balls; b++){
        const g = new THREE.Group(), deform = new THREE.Group(), core = new THREE.Mesh(coreGeo, coreMat), halo = new THREE.Sprite(haloMat);
        halo.scale.set(V.r * 5, V.r * 5, 1);
        deform.add(core); g.add(deform, halo); root.add(g);
        balls.push({ V, vi, b, g, deform, core, halo, coreMat, haloMat, glow: new THREE.Color(opt.glow) });
      }
      const lamp = new THREE.PointLight(opt.glow, 3.5, 10, 2);
      root.add(lamp);
      lamps.push({ lamp, at: new THREE.Vector3(0, 0, V.z), init: false });
    });
    trail = glowBatch(balls.length * TRAIL_N);
    root.add(trail.mesh);
    return api;

    /* ---------- per frame ---------- */
    function poseFrame(t){
      const st = t * DESCENT;
      for (let k = 0; k < LN; k++) for (let i = 0; i < NL; i++){
        const c3 = chainAt(i * pitch + st);
        _p.set(xs[k], c3[0], c3[1]); _q.setFromAxisAngle(XAXIS, c3[2]); _s.set(1, 1, 1);
        chains.setMatrixAt(k * NL + i, _m.compose(_p, _q, _s));
        chains.setColorAt(k * NL + i, _c.setScalar(c3[3]));
      }
      chains.instanceMatrix.needsUpdate = true; chains.instanceColor.needsUpdate = true;
      const ang = -st / RC;
      for (const [m, ph] of spin) m.rotation.x = ang + ph;
      sprockets.count = 2 * LN;
      for (let k = 0; k < LN; k++){
        _s.set(1, 1, 1);
        _q.setFromAxisAngle(XAXIS, ang + phTop); sprockets.setMatrixAt(2 * k, _m.compose(_p.set(xs[k], yT, gzc), _q, _s));
        _q.setFromAxisAngle(XAXIS, ang + phBot); sprockets.setMatrixAt(2 * k + 1, _m.compose(_p.set(xs[k], yB, gzc), _q, _s));
      }
      sprockets.instanceMatrix.needsUpdate = true;
    }

    function update(t, dt, { skipStrikes = false, onStrike = null, onDock = null, haloA = .12, emi = 1.2 } = {}){
      poseFrame(t);
      const P = J.P, u = wrap(t, P);

      // ---- strikes + docks: the timeline crossing a strike / dock time (never a scheduler)
      if (prevT !== null && !skipStrikes && t > prevT && t - prevT < .25){
        const a = wrap(prevT, P);
        VS.forEach((V, vi) => {
          if (onStrike) for (const k of eventsIn(V.strikeT, a, u, P)) onStrike(strikeHit(V, vi, k));
          if (onDock) for (const i of eventsIn(V.dockT, a, u, P)){
            const d = V.docks[i], c = carriageAt(V, d.c, t);
            onDock({ role: V.role, r: V.r, pos: _v.set(c.x, c.y, c.z).add(root.position).clone(), glow: balls.find(B => B.V === V)?.glow });
          }
        });
      }
      prevT = t;

      // ---- plates
      let n = 0;
      VS.forEach((V, vi) => {
        const looks = plateLook[vi], tint = steelTint[V.role] || steelTint.lead;
        for (let k = 0; k < V.plates.length; k++){
          const p = V.plates[k], c = beltPhase(t, p.s, P);
          if (Math.abs(DESCENT * c) > V.cullD || n >= CAP) continue;
          const B = plateAt(V, k, t);
          if (!B) continue;
          const L = looks[k];
          const flash = c >= 0 ? L.look * Math.exp(-4 * c) : 0;
          const pre = c < 0 && p.F > 0 && c > -p.F ? (1 + c / p.F) ** 2 : 0;
          _q.set(B.q.x, B.q.y, B.q.z, B.q.w); _p.set(B.x, B.y, B.z); _s.setScalar(p.scale);
          _m.compose(_p, _q, _s);
          bodies.setMatrixAt(n, _m); pins.setMatrixAt(n, _m); cradles.setMatrixAt(n, _m);
          bodies.setColorAt(n, tint);
          _c.copy(L.floor).multiplyScalar(.06 + .32 * flash + .07 * pre);
          glowAttr.setXYZ(n, _c.r, _c.g, _c.b);
          _s.setScalar(p.scale * (1 + .22 * pre + .12 * flash));
          rims.setMatrixAt(n, _m.compose(_p, _q, _s));
          rims.setColorAt(n, _c.copy(L.rim).multiplyScalar((.5 + .55 * flash + .35 * pre) * Math.max(.25, B.tilt)));
          // the carrier: a shoe on the lane's chain (rides it at DESCENT), a spine to the cradle's hub —
          // the plan's own arm (what the hold keeps clear of every ball)
          const hub = _a.set(B.hub.x, B.hub.y, B.hub.z);
          _p.set(B.shoe.x, B.shoe.y, B.shoe.z);
          _s.set(1, 1, 1); _q.identity();
          shoes.setMatrixAt(n, _m.compose(_p, _q, _s));
          _d.subVectors(hub, _p); const len = _d.length() || 1e-3;
          _q.setFromUnitVectors(ZAXIS, _d.divideScalar(len));
          rods.setMatrixAt(n, _m.compose(_p, _q, _s.set(1, 1, len)));
          sleeves.setMatrixAt(n, _m.compose(_p, _q, _s.set(1, 1, Math.min(len, SLEEVE))));
          n++;
        }
      });
      for (const im of [bodies, rims, pins, cradles, shoes, sleeves, rods]){ im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
      glowAttr.needsUpdate = true;

      // ---- the keys
      for (let k = 0; k < LN; k++){
        const T = laneT[k]; let i = floorIdx(T, u), since;
        if (i < 0){ i = T.length - 1; since = u + P - (T[i] ?? -Infinity); } else since = u - T[i];
        const h = laneHits[k][i], f = h ? h.look * Math.exp(-6 * since) : 0;
        keys.setColorAt(k, h ? _c.copy(h.col).multiplyScalar(.1 + 1.1 * f) : _c.setRGB(.05, .05, .07));
      }
      keys.instanceColor.needsUpdate = true;

      // ---- carriages
      carr.forEach((K, i) => {
        const { V, c, C, rail } = K, k = carriageAt(V, c, t);
        let li = floorIdx(C.loadT, u), on, dis = 0, sinceRel = Infinity;
        if (li < 0) on = 1;                                   // holding its ball since the breath
        else {
          const e = C.loadEv[li], since = u - e.t;
          if (e.kind === 'catch') on = 1 + 2.4 * Math.exp(-8 * since);
          else { on = 0; dis = Math.exp(-18 * since); sinceRel = since; }
        }
        const nx = C.loadEv[li + 1];                          // energising as its ball rises to it
        if (on === 0 && nx && nx.kind === 'catch' && nx.t - u < .35) on = 1 - (nx.t - u) / .35;
        const recoil = sinceRel < .5 ? .05 * Math.exp(-sinceRel * 10) * Math.sin(sinceRel * 40) : 0;
        const face = k.y + V.r + recoil, top = face + o.MAG_H, drumY = rail.y - .19;
        _q.identity(); _s.set(1, 1, 1);
        trolleys.setMatrixAt(i, _m.compose(_p.set(k.x, rail.y + .2, rail.z), _q, _s));
        tells.setMatrixAt(i, _m.compose(_p.set(k.x, rail.y + .2, rail.z + .16), _q, _s));
        mags.setMatrixAt(i, _m.compose(_p.set(k.x, face, rail.z), _q, _s));
        faces.setMatrixAt(i, _m.compose(_p.set(k.x, face + .025, rail.z), _q, _s));
        coils.setMatrixAt(i, _m.compose(_p.set(k.x, face + .08, rail.z), _q, _s));
        const len = Math.max(.02, drumY - .1 - top);
        cables.setMatrixAt(i, _m.compose(_p.set(k.x, top + len / 2, rail.z), _q, _s.set(1, len, 1)));
        _q.setFromAxisAngle(XAXIS, -len / .1);                // the winch drum pays out the cable it shows
        drums.setMatrixAt(i, _m.compose(_p.set(k.x, drumY, rail.z), _q, _s.set(1, 1, 1)));
        _c.copy(HOT).lerp(ICE, Math.min(1, dis * 1.4)).multiplyScalar(.12 + 1.1 * on + 2.2 * dis);
        coils.setColorAt(i, _c);
        tells.setColorAt(i, on > .5 ? _c.copy(AMBER).multiplyScalar(2) : _c.setRGB(.06, .05, .04));
      });
      for (const im of [trolleys, tells, mags, faces, coils, cables, drums]){ im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }

      // ---- the balls (+ their analytic trails) and each voice's lamp, focus and director state
      let ti = 0;
      const next = VS.map(() => null), sum = VS.map(() => [0, 0, 0, 0]);
      for (const R of balls){
        const { V, vi, b } = R, q = ballAt(V, b, t);
        R.g.position.set(q.x, q.y, q.z);
        const sp = Math.hypot(q.vx, q.vy, q.vz);
        if (sp > .01) R.deform.quaternion.setFromUnitVectors(YAXIS, _v.set(q.vx / sp, q.vy / sp, q.vz / sp));
        // squash: a pure fn of the time since this ball's last contact (a strike, or a dock)
        const pc = V.pieces[b][Math.max(0, floorIdx(V.pieceT0[b], u))];
        const since = u - pc.t0;
        const sq = pc.seg ? (pc.seg.kind === 'drop' ? 0 : Math.exp(-9 * since)) : pc.t0 > 0 ? .6 * Math.exp(-9 * since) : 0;
        const stretch = 1 + Math.min(sp * .014, .4), sxz = (1 / Math.sqrt(stretch)) * (1 - sq) + 1.3 * sq;
        R.deform.scale.set(sxz, stretch * (1 - sq) + .55 * sq, sxz);
        R.core.rotation.set(t * 6, 0, t * 3.4);
        R.haloMat.opacity = haloA; R.coreMat.emissiveIntensity = emi + .1;
        if (q.mode !== 'held'){
          const s = sum[vi]; s[0] += q.x; s[1] += q.y; s[2] += q.z; s[3]++;
          const tEnd = q.seg.kind === 'rise' ? Infinity : q.seg.t1;
          if (!next[vi] || tEnd < next[vi].tEnd) next[vi] = { tEnd, q, seg: q.seg };
          if (sp > 1.5) for (let i = 1; i <= TRAIL_N; i++){
            const w = ballAt(V, b, t - i * TRAIL_DT), f = 1 - i / (TRAIL_N + 1);
            trail.set(ti++, _v.set(w.x, w.y, w.z), R.glow, .42 * f * f, V.r * (2.5 - .1 * i));
          }
        }
      }
      while (ti < balls.length * TRAIL_N) trail.set(ti++, _v.set(0, 0, 0), _c.setRGB(0, 0, 0), 0, 0);
      trail.commit();
      VS.forEach((V, vi) => {
        const s = sum[vi], L = lamps[vi], nx = next[vi];
        // the next strike: who's coming down, when, and from how far — the camera's "big moment" read
        let k = floorIdx(V.strikeT, u) + 1; if (k >= V.strikeT.length) k = 0;
        const p = V.plates[k];
        if (nx && nx.tEnd < Infinity){
          const F = nx.seg.t1 - nx.seg.t0;
          api.st[vi] = { dt: F, next: V.plates[(nx.seg.b + 1) % V.plates.length].F ?? 9, prog: (u - nx.seg.t0) / F };
        } else api.st[vi] = { dt: 9, next: p.F ?? 9, prog: 0 };
        // focus: the voice's balls in play; between them, where its next note will land
        if (s[3]) api.focus[vi].set(s[0] / s[3], s[1] / s[3], s[2] / s[3]); else api.focus[vi].set(p.x, 0, p.z);
        api.focus[vi].add(root.position);
        // the lamp rides the ball that strikes next (eased — a light that teleported would flicker the plates)
        const want = nx ? _v.set(nx.q.x, nx.q.y, nx.q.z) : _v.set(p.x, 0, p.z);
        if (!L.init){ L.at.copy(want); L.init = true; } else L.at.lerp(want, 1 - Math.exp(-(dt || 0) / .05));
        L.lamp.position.copy(L.at);
        let j = floorIdx(V.strikeT, u), sinceS;
        if (j < 0){ j = V.strikeT.length - 1; sinceS = u + P - V.strikeT[j]; } else sinceS = u - V.strikeT[j];
        L.lamp.intensity = 3.5 + 3.5 * plateLook[vi][j].look * Math.exp(-8 * sinceS);
      });
    }

    function strikeHit(V, vi, k){
      const p = V.plates[k], L = plateLook[vi][k], R = balls.find(B => B.V === V && B.b === p.ball);
      return { role: V.role, deep: V.deep, note: p.note, vel: p.vel ?? 1, look: L.look, hue: L.hue, amp: L.amp, dt: V.notes[k].dt,
               pos: new THREE.Vector3(p.x, 0, p.z).add(root.position),                       // the ball's centre at contact
               surf: new THREE.Vector3(p.x - p.n.x * V.r, -p.n.y * V.r, p.z - p.n.z * V.r).add(root.position),   // the plate's face
               quat: L.q, glow: R?.glow, k, ball: p.ball };
    }

    function xr(on){ for (const L of lamps) L.lamp.visible = !on; }
    function dispose(){
      geos.forEach(g => g.dispose());
      root.traverse(ob => { for (const m of [].concat(ob.material || [])) m.dispose?.(); });
      if (trail){ trail.mesh.geometry.dispose(); trail.mesh.material.dispose(); }
    }
  }
}
