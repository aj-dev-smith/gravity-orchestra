import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeEdge, smooth } from '../clock.js';
import { solveRiff, stampAt, carriageAt, muteAt, ringAt, hitAt, voiceIdsFor, crossBottom, stringDrop, strikeSurface,
         STRINGS, NUT_X, BRIDGE_X, STAMP_X, STAMP_DX, stampX, STR_DZ, MUTE_X, SCALE_L, STRING_Y, FRET_H, HEAD_R, MUTE_R, HOOK_W, LIFT_Y,
         H_PARK, V_IN, MAX_FRET, latchRest, strZ, gauge, strTop, fretX, PART_LIMITS, CLEAR_UP } from './solve.js';
import { riffVoice } from './voice.js';
import { restEnv, anticip, sway } from '../idle.js';
import { noteNum } from '../../engine.js';

/* ============================================================
   RIFF FORGE — the distorted electric guitar machine.

   A six-string neck laid on a display stand (tilted toward the
   audience), worked by a DROP FORGE. Per string — its own lane, it
   never touches another string's parts:
     · a FRET CARRIAGE in a groove under the string: its chrome hook
       lifts, slides to the fret (the wires stand at the luthier's
       L·(1 − 2^(−f/12)) — the pitch IS the position) and presses the
       string down onto the fret before the note. Slotted fret wires
       let the hook posts pass.
     · a STAMP: a chrome-marble drop hammer on a rod, driven by a
       solenoid in the forge beam. It lands on the string over the bridge
       pickup exactly on the beat, rebounds lossy, the coil glows with the
       drive that makes up the loss; a long gap parks it on the latch.
   Shared: the felt PALM-MUTE BAR drops onto all six strings at the
   bridge before a muted chug and lifts before an open chord (a real
   right palm). The struck span (fret → bridge) blurs and glows hot,
   the pickup poles under it light with the ring, and the 4×12 cab
   behind the neck pumps its cones. All motion = solve.js (pure fns of
   songTime).

   PART CONSTRAINTS (imported MIDI — see solve.js PART_LIMITS):
     · pitch  E2–C6 (MIDI 40–84); outside folds by octaves
     · poly   ≤ 6 notes per hit (one per string); a chord the strings can't
              voice keeps root + top first. Power chords (2–4) are the idiom.
     · gap    same STRING re-strike ≥ .06 s honest (≥ .13 s comfortable);
              denser still plays (the stamp hops lower), never crashes
     · ioi    no limit across strings (independent lanes)
     · events ≤ 640 hits per loop (a chord = one hit); extras dropped
     · flags  'E2:m' palm mute, 'G3:c' clean amp; durBeats ≤ .3 → muted
     · voices one baked voice per unique HIT (chord + flags) — distortion is
              nonlinear, so a chord renders through ONE amp. ~10–25 ms each.
   ============================================================ */

const SIG     = 0xff4a1c;            // signature: molten forge red-amber
const HOT     = 0xffd08a;            // white-hot at the strike
const COILC   = 0xff7a2a;
const TILT    = .3;                  // the stand tips the neck toward the audience (rad)
const BOARD_Y = 1.65;                // board top above the deck (before the tilt)
const ROD_R   = .045;
const BEAM_Y  = strTop(0) + H_PARK + 2 * HEAD_R + .26;    // the solenoid housing's underside (latch sleeves hang from it)
const HOUSE_H = 1.6;                                        // the housing is taller than the stroke: the rods never leave it
const ROD_L   = BEAM_Y + .15 - (strTop(0) + HEAD_R);        // at contact the rod's top is just inside the housing
const POST_Z  = 1.62;
const HINGE   = { x: MUTE_X + .72, y: strTop(0) + .25 };
const BAR_UP  = -.85;               // the mute bar's lifted swing (rad about z)
const TRAIL_N = 3, TRAIL_DT = .016;
const CAB     = { x: -3.3, z: -2.95, w: 4.8, h: 4.4, d: 1.1, y: .45 };   // the 4×12 behind the neck
// IDLE (../idle.js): while a string's stamp is parked on its latch, its LIFTED fret hook hovers
// (the carriage actuator hunting, a few mm further off the string — never toward it, never while
// it presses) and the solenoid coil charges up before it drives the next stroke. Zero within
// .25 s of the latch's catch and release: every press, every strike is the solved pose.
const HOVER_A = .022, HOVER_HZ = .55;
const FULL    = { w: 15.55, d: 6.6, cx: -.28, cz: -.26 };   // the full-size rig's XZ extent + centre (measured; scaled to the slot)

export default {
  key: 'riff',
  label: 'Riff Forge',
  wet: false,                        // dry: a metal rhythm guitar punches, it doesn't smear
  lookHeight: 1.3,
  camera: { dist: 8.4, up: 6.4, x: 1.0 },
  color: '#ff4a1c',
  PART_LIMITS,

  voice: id => riffVoice(id),
  voiceIds: part => voiceIdsFor(part),
  /** a hit's pitch for the pan width: its LOWEST note (the root — 'E2+B2+E3:m' → E2) */
  voiceHz: id => { const m = /^([A-G]#?)(-?\d)/.exec(String(id)); return m ? 440 * Math.pow(2, (noteNum(m[1] + m[2]) - 69) / 12) : 0; },

  make({ envMap, glowTex }){
    let R = null, rig = null, lanes = [], start = -Infinity, edge = makeEdge(.25), deck = null, bar = null, cones = [], tubes = [],
        grilleMat = null, lampMat = null;
    const _v = new THREE.Vector3(), _c = new THREE.Color(), _hot = new THREE.Color(HOT), _sig = new THREE.Color(SIG);

    function build(part, { rollT, beat, P, start: s0 = -Infinity, station, floorY = -20 }){
      const group = new THREE.Group();
      lanes = []; cones = []; tubes = []; start = s0; edge = makeEdge(.25);
      // everything is built at full size inside `rig`, then scaled UNIFORMLY to the station's footprint
      // (a uniform scale of the whole machine — no part's size ever depends on the part played)
      const W = station?.w ?? 13, D = station?.d ?? 6;
      const rs = Math.min(W / FULL.w, D / FULL.d, 1);
      rig = new THREE.Group(); rig.scale.setScalar(rs); rig.position.set(-FULL.cx * rs, 0, -FULL.cz * rs);
      group.add(rig);
      R = solveRiff(part, { rollT, beat, P });
      if (R.stats.viol || R.stats.dropped)
        console.warn(`riff: ${R.stats.dropped} note(s) unvoiceable, ${R.stats.viol} drive-limit overrun(s) in the fingering`);

      // ---- shared materials (constant count after build) ----
      const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: .14, envMap, envMapIntensity: 1.3 });
      const dark   = new THREE.MeshStandardMaterial({ color: 0x232733, metalness: .7, roughness: .45, envMap });
      const iron   = new THREE.MeshStandardMaterial({ color: 0x15171e, metalness: .8, roughness: .38, envMap });
      const brass  = new THREE.MeshStandardMaterial({ color: 0xc9a05a, metalness: 1, roughness: .25, envMap });
      const wood   = new THREE.MeshStandardMaterial({ color: 0x1c120d, metalness: .1, roughness: .55, envMap, envMapIntensity: .5 });
      const body   = new THREE.MeshStandardMaterial({ color: 0x8a1208, metalness: .55, roughness: .2, envMap, envMapIntensity: 1.2 });
      const bone   = new THREE.MeshStandardMaterial({ color: 0xe8e0cc, metalness: 0, roughness: .5 });
      const felt   = new THREE.MeshStandardMaterial({ color: 0x5a1c16, metalness: 0, roughness: 1, emissive: new THREE.Color(0x3a0a04), emissiveIntensity: .4 });
      const trim   = new THREE.MeshStandardMaterial({ color: 0x2a0a04, emissive: new THREE.Color(SIG), emissiveIntensity: .9 });
      const glass  = new THREE.MeshStandardMaterial({ color: 0x9fb4c8, metalness: .2, roughness: .05, envMap, transparent: true, opacity: .22,
        depthWrite: false, side: THREE.DoubleSide });
      const rail   = new THREE.MeshStandardMaterial({ color: 0x120604, emissive: new THREE.Color(SIG), emissiveIntensity: .1 });
      const inlay  = new THREE.MeshStandardMaterial({ color: 0x2a1408, emissive: new THREE.Color(0xff8a3a), emissiveIntensity: .55 });
      const tolex  = new THREE.MeshStandardMaterial({ color: 0x101114, metalness: .2, roughness: .85 });
      grilleMat    = new THREE.MeshStandardMaterial({ color: 0x1b1714, metalness: .1, roughness: .9, emissive: new THREE.Color(SIG), emissiveIntensity: .02 });
      const coneM  = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, metalness: .1, roughness: .7, side: THREE.DoubleSide });
      lampMat      = new THREE.MeshStandardMaterial({ color: 0x300804, emissive: new THREE.Color(SIG), emissiveIntensity: 2 });

      // static parts are collected per material and MERGED (a handful of draw calls at any part)
      const bucket = new Map();
      const add = (mat, gg) => (bucket.get(mat) || bucket.set(mat, []).get(mat)).push(gg);
      const put = (mat, geo, x, y, z, rx = 0, rz = 0, ry = 0) => {
        if (rx) geo.rotateX(rx); if (rz) geo.rotateZ(rz); if (ry) geo.rotateY(ry);
        geo.translate(x, y, z); add(mat, geo);
      };
      const box = (mat, x0, x1, y0, y1, z0, z1) =>
        put(mat, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      const dbucket = new Map();                           // the same, inside the tilted deck
      const dadd = (mat, gg) => (dbucket.get(mat) || dbucket.set(mat, []).get(mat)).push(gg);
      const dput = (mat, geo, x, y, z, rx = 0, rz = 0, ry = 0) => {
        if (rx) geo.rotateX(rx); if (rz) geo.rotateZ(rz); if (ry) geo.rotateY(ry);
        geo.translate(x, y, z); dadd(mat, geo);
      };
      const dbox = (mat, x0, x1, y0, y1, z0, z1) =>
        dput(mat, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

      // ---- the plinth + legs to the room floor ----
      box(iron, -7.4, 7.4, 0, .4, -2.6, 2.4);
      box(trim, -7.35, 7.35, .32, .36, 2.4, 2.44);
      const legH = -floorY / rs;
      if (legH > .05){                                     // a solid stage riser down to the floor (no legs in front of the neck)
        box(dark, -7.1, 7.1, -legH, 0, -3.35, 2.15);
        box(trim, -7.12, 7.12, -.12, -.08, 2.15, 2.18);
      }
      // the stand: two yokes up to the neck's cradle
      for (const x of [-4.2, 3.6]){
        box(dark, x - .22, x + .22, .4, BOARD_Y - .55, -.4, .4);
        box(chrome, x - .3, x + .3, BOARD_Y - .62, BOARD_Y - .5, -1.1, 1.1);
      }

      // ---- the 4×12 cab + head (behind the neck, upright) ----
      { const { x, z, w, h, d, y } = CAB;
        box(tolex, x - w / 2, x + w / 2, y, y + h, z - d / 2, z + d / 2);
        box(chrome, x - w / 2 - .02, x + w / 2 + .02, y + h - .06, y + h, z - d / 2 - .02, z + d / 2 + .02);
        const gr = new THREE.Mesh(new THREE.BoxGeometry(w - .3, h - .5, .04), grilleMat);
        gr.position.set(x, y + h / 2 - .05, z + d / 2 + .005); rig.add(gr);
        // the head: a chrome-faced amp with four glass power tubes on top
        box(tolex, x - w / 2 + .2, x + w / 2 - .2, y + h, y + h + 1.1, z - d / 2 + .1, z + d / 2 - .05);
        box(chrome, x - w / 2 + .3, x + w / 2 - .3, y + h + .25, y + h + .85, z + d / 2 - .04, z + d / 2);
        for (let k = 0; k < 6; k++) put(dark, new THREE.CylinderGeometry(.08, .08, .08, 14), x - 1.6 + k * .55, y + h + .55, z + d / 2 + .04, Math.PI / 2);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(.07, 12, 8), lampMat);
        lamp.position.set(x + w / 2 - .6, y + h + .55, z + d / 2 + .02); rig.add(lamp);
        const tubeGeo = new THREE.CapsuleGeometry(.13, .4, 6, 14);
        for (let k = 0; k < 4; k++){
          const tm = new THREE.MeshStandardMaterial({ color: 0x2a1408, transparent: true, opacity: .85, emissive: new THREE.Color(0xff7a2a), emissiveIntensity: .4 });
          const tb = new THREE.Mesh(tubeGeo, tm);
          tb.position.set(x - .9 + k * .6, y + h + 1.1 + .33, z); rig.add(tb);
          put(dark, new THREE.CylinderGeometry(.16, .16, .08, 14), x - .9 + k * .6, y + h + 1.13, z);
          tubes.push(tm);
        }
        // four 12" cones: a lathe cone + surround + dust cap, each pumps on its own (pure fn of the hit clock)
        const pts = [];
        for (let i = 0; i <= 10; i++){ const r = .18 + .82 * i / 10; pts.push(new THREE.Vector2(r, -.32 * (1 - i / 10) ** 1.3)); }
        const coneGeo = new THREE.LatheGeometry(pts, 40); coneGeo.rotateX(Math.PI / 2);
        const capGeo = new THREE.SphereGeometry(.22, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2); capGeo.rotateX(Math.PI / 2); capGeo.scale(1, 1, .5);
        const rimGeo = new THREE.TorusGeometry(1.02, .06, 8, 40);
        for (let i = 0; i < 4; i++){
          const cx = x + (i % 2 ? 1.17 : -1.17), cy = y + h / 2 + (i < 2 ? 1.1 : -1.1) - .05, cz = z + d / 2 + .03;
          put(dark, rimGeo.clone(), cx, cy, cz);
          const cg = new THREE.Group(); cg.position.set(cx, cy, cz);
          const cone = new THREE.Mesh(coneGeo, coneM), cap = new THREE.Mesh(capGeo, dark);
          cap.position.z = .0;
          cg.add(cone, cap); rig.add(cg);
          cones.push({ g: cg, z: cz, k: i });
        }
      }

      // ---- the tilted DECK: the guitar + the forge (board top = local y 0) ----
      deck = new THREE.Group();
      deck.position.set(0, BOARD_Y, 0); deck.rotation.x = TILT;
      rig.add(deck);
      const zEdge = strZ(STRINGS - 1) + .3, xFb = fretX(MAX_FRET + 1.2);
      // fretboard (walnut) + its edge trim, headstock, body
      dbox(wood, NUT_X - .05, xFb, -.26, 0, -zEdge, zEdge);
      dbox(trim, NUT_X, xFb, -.2, -.17, zEdge, zEdge + .02);
      { const hs = new THREE.Shape();
        hs.moveTo(0, -zEdge + .05); hs.lineTo(-1.7, -1.05); hs.lineTo(-1.95, -.7); hs.lineTo(-1.8, .95); hs.lineTo(0, zEdge - .05); hs.lineTo(0, -zEdge + .05);
        const g = new THREE.ExtrudeGeometry(hs, { depth: .2, bevelEnabled: true, bevelSize: .03, bevelThickness: .03, bevelSegments: 1 });
        g.rotateX(Math.PI / 2); g.translate(NUT_X - .05, -.04, 0); dadd(body, g);
        for (let s = 0; s < STRINGS; s++){
          const tx = NUT_X - .45 - .22 * s, tz = -.75 + .3 * s;
          dput(chrome, new THREE.CylinderGeometry(.045, .045, .3, 10), tx, .12, tz);
          dput(chrome, new THREE.CylinderGeometry(.07, .07, .05, 12), tx, -.02, tz);
          // the string's run from the nut to its post (static)
          const a = new THREE.Vector3(NUT_X, STRING_Y, strZ(s)), b = new THREE.Vector3(tx, .2, tz);
          const dv = new THREE.Vector3().subVectors(b, a), len = dv.length();
          const sg = new THREE.CylinderGeometry(gauge(s), gauge(s), len, 6);
          sg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv.normalize()));
          sg.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); dadd(chrome, sg);
        }
      }
      { const bs = new THREE.Shape();                       // an offset, pointed metal body (x → shape x, z → shape y)
        const pts = [[xFb - .2, -1.5], [3.6, -2.15], [6.4, -2.2], [7.35, -1.4], [7.1, .2], [7.4, 1.6], [6.2, 2.25], [4.2, 1.95], [xFb - .2, 1.5]];
        bs.moveTo(pts[0][0], -pts[0][1]); for (const [px, pz] of pts.slice(1)) bs.lineTo(px, -pz); bs.lineTo(pts[0][0], -pts[0][1]);
        const g = new THREE.ExtrudeGeometry(bs, { depth: .42, bevelEnabled: true, bevelSize: .06, bevelThickness: .06, bevelSegments: 2 });
        g.rotateX(-Math.PI / 2); g.translate(0, -.5, 0); dadd(body, g);
      }
      // nut, fret wires (SLOTTED where each hook post runs), inlays
      dbox(bone, NUT_X - .06, NUT_X + .02, 0, STRING_Y - .045, -zEdge, zEdge);
      const slots = [];
      for (let s = 0; s < STRINGS; s++) for (const sd of [-1, 1]) slots.push(strZ(s) + sd * HOOK_W / 2);
      for (let f = 1; f <= MAX_FRET; f++){
        const x = fretX(f);
        let z0 = -zEdge + .04;
        for (const zs of [...slots, zEdge - .04 + .03]){
          const z1 = Math.min(zs - .03, zEdge - .04);
          if (z1 > z0) dput(chrome, new THREE.BoxGeometry(.035, FRET_H, z1 - z0), x, FRET_H / 2, (z0 + z1) / 2);
          z0 = zs + .03;
        }
      }
      for (const f of [3, 5, 7, 9, 12, 15, 17, 19]){
        const x = (fretX(f) + fretX(f - 1)) / 2;
        for (const z of f === 12 ? [-STR_DZ2(), STR_DZ2()] : [0])
          dput(inlay, new THREE.CylinderGeometry(.09, .09, .01, 16), x, .004, z);
      }
      // a groove (with a faint rail glow) under each string: the carriage's track
      for (let s = 0; s < STRINGS; s++) dbox(rail, NUT_X + .05, fretX(MAX_FRET) + .05, -.005, .003, strZ(s) - .02, strZ(s) + .02);
      // a neck humbucker (looks) — the strings' own ANVIL poles under each strike point are below (lit by the ring)
      dbox(dark, 2.3, 2.82, -.02, .07, -1.42, 1.42);
      dbox(chrome, 2.27, 2.85, -.03, .03, -1.48, 1.48);
      dput(dark, new THREE.BoxGeometry(.7, .05, 2 * POST_Z / Math.cos(Math.atan(STAMP_DX / STR_DZ)) - .3), STAMP_X, 0, 0, 0, 0, Math.atan(STAMP_DX / STR_DZ));
      // bridge + saddles + tailpiece
      dbox(chrome, BRIDGE_X - .1, BRIDGE_X + .26, -.02, .08, -1.4, 1.4);
      for (let s = 0; s < STRINGS; s++){
        dbox(chrome, BRIDGE_X - .06, BRIDGE_X + .1, .08, STRING_Y - gauge(s), strZ(s) - .09, strZ(s) + .09);
        const sg = new THREE.CylinderGeometry(gauge(s), gauge(s), .55, 6); sg.rotateZ(Math.PI / 2);
        sg.translate(BRIDGE_X + .27, STRING_Y - .03, strZ(s)); dadd(chrome, sg);
      }
      dbox(chrome, BRIDGE_X + .5, BRIDGE_X + .7, -.02, .16, -1.45, 1.45);

      // ---- the FORGE: two posts, a lower crossbar (the latch sleeves hang from it), six GLASS solenoid
      //      tubes (the rods ride inside them — never leave them), a top crossbar ----
      const beamTop = BEAM_Y + HOUSE_H;
      const lineX = z => STAMP_X + z * STAMP_DX / STR_DZ;   // the slanted forge line
      const ry = Math.atan(STAMP_DX / STR_DZ), span = 2 * POST_Z / Math.cos(ry);
      for (const sz of [-1, 1]){
        dbox(iron, lineX(sz * POST_Z) - .13, lineX(sz * POST_Z) + .13, -.05, beamTop + .05, sz * POST_Z - .12, sz * POST_Z + .12);
        dbox(chrome, lineX(sz * POST_Z) - .18, lineX(sz * POST_Z) + .18, -.05, .1, sz * POST_Z - .17, sz * POST_Z + .17);
      }
      const bar3 = (mat, hw, y0, y1, ext) => dput(mat, new THREE.BoxGeometry(2 * hw, y1 - y0, span + ext), STAMP_X, (y0 + y1) / 2, 0, 0, 0, ry);
      bar3(iron, .17, BEAM_Y, BEAM_Y + .14, .24);
      bar3(trim, .175, BEAM_Y + .05, BEAM_Y + .08, .25);
      bar3(iron, .17, beamTop - .12, beamTop, .24);
      bar3(chrome, .19, beamTop, beamTop + .05, .28);
      for (let s = 0; s < STRINGS; s++){
        dput(glass, new THREE.CylinderGeometry(.13, .13, HOUSE_H - .26, 20, 1, true), stampX(s), BEAM_Y + .14 + (HOUSE_H - .26) / 2, strZ(s));
        // the ANVIL pole under the strike point (lit by the ring — the pickup that hears this string)
      }
      for (let s = 0; s < STRINGS; s++){
        // the LATCH: a magnet block whose face is exactly the parked head's top
        const face = strTop(s) + H_PARK + 2 * HEAD_R;
        dput(dark, new THREE.CylinderGeometry(.14, .14, BEAM_Y - face, 16), stampX(s), (BEAM_Y + face) / 2, strZ(s));
      }
      // mute-bar hinge posts + barrel
      for (const sz of [-1, 1]) dbox(dark, HINGE.x - .07, HINGE.x + .07, -.05, HINGE.y, sz * 1.6 - .07, sz * 1.6 + .07);
      dput(chrome, new THREE.CylinderGeometry(.05, .05, 3.3, 12), HINGE.x, HINGE.y, 0, Math.PI / 2);

      // ---- per-string lanes ----
      const headGeo = new THREE.SphereGeometry(HEAD_R, 32, 22);
      const rodGeo = new THREE.CylinderGeometry(ROD_R, ROD_R, ROD_L, 10); rodGeo.translate(0, HEAD_R + ROD_L / 2 - .02, 0);
      const collarGeo = new THREE.CylinderGeometry(HEAD_R * .62, HEAD_R * .7, .12, 14); collarGeo.translate(0, HEAD_R + .02, 0);
      const coilGeo = mergeGeometries([0, 1, 2, 3].map(k => { const g = new THREE.TorusGeometry(.15, .035, 8, 24); g.rotateX(Math.PI / 2); g.translate(0, (k - 1.5) * .085, 0); return g; }));
      const slideGeo = new THREE.BoxGeometry(.42, .1, .12); slideGeo.translate(0, -.06, 0);
      const hookGeo = (s) => {
        const top = crossBottom(s, 0) + .03;               // crossbar centre at p = 0 (the group moves it)
        const legs = [-1, 1].map(sd => { const g = new THREE.CylinderGeometry(.018, .018, top + .04, 6); g.translate(0, (top + .04) / 2 - .04, sd * HOOK_W / 2); return g; });
        const cross = new THREE.CapsuleGeometry(.038, HOOK_W - .02, 4, 10); cross.rotateX(Math.PI / 2); cross.translate(0, top + .008, 0);
        return { legs: mergeGeometries(legs), cross };
      };
      for (let s = 0; s < STRINGS; s++){
        const S = R.strings[s], z = strZ(s);
        // the string + its blur hull (vertex-shader kink under the hook, lateral ring over the struck span)
        const str = buildString(s, envMap);
        str.mesh.position.set((NUT_X + BRIDGE_X) / 2, STRING_Y, z); deck.add(str.mesh);
        str.hull.position.copy(str.mesh.position); deck.add(str.hull);
        // pickup poles under this string (two, one per humbucker) — lit by its ring
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a1006, metalness: .6, roughness: .3, emissive: new THREE.Color(SIG), emissiveIntensity: .05 });
        const pg = mergeGeometries([[2.43, .05, .1], [2.69, .05, .1], [stampX(s), .09, .055]].map(([px, r, h]) => { const g = new THREE.CylinderGeometry(r, r, h, 12); g.translate(px, h / 2 + .03, 0); return g; }));
        const poles = new THREE.Mesh(pg, poleMat); poles.position.z = z; deck.add(poles);
        // the carriage: brass slider + chrome hook (moves along x; the hook lifts/presses in y)
        const car = new THREE.Group();
        // the crossbar is the FINGERTIP: it glows while it holds the string on the fret — the chord shape lights up
        const hg = hookGeo(s), slider = new THREE.Mesh(slideGeo, brass), hook = new THREE.Group();
        const padMat = new THREE.MeshStandardMaterial({ color: 0x3a1a0c, metalness: .6, roughness: .3, envMap, emissive: new THREE.Color(SIG), emissiveIntensity: .1 });
        hook.add(new THREE.Mesh(hg.legs, chrome), new THREE.Mesh(hg.cross, padMat));
        car.add(slider); car.position.z = z;
        hook.position.z = z; hook.userData.riffHook = s;          // (test/idle.test.js finds a string's hook by this)
        const tip = sprite(glowTex, 0xff8a3a);
        deck.add(car, hook, tip);
        // the stamp: chrome marble head + rod + collar; its solenoid coil in the beam; a halo + ghosts
        const headMat = new THREE.MeshStandardMaterial({ color: 0xe4e8f0, metalness: 1, roughness: .08, envMap, envMapIntensity: 1.6,
          emissive: new THREE.Color(SIG), emissiveIntensity: 0 });
        const stamp = new THREE.Group();
        stamp.add(new THREE.Mesh(headGeo, headMat), new THREE.Mesh(rodGeo, chrome), new THREE.Mesh(collarGeo, dark));
        stamp.position.set(stampX(s), strTop(s) + HEAD_R + H_PARK, z); deck.add(stamp);
        const coilMat = new THREE.MeshStandardMaterial({ color: 0x331208, emissive: new THREE.Color(COILC), emissiveIntensity: .2 });
        const coil = new THREE.Mesh(coilGeo, coilMat); coil.position.set(stampX(s), BEAM_Y + .14 + (HOUSE_H - .26) * .62, z); deck.add(coil);
        const halo = sprite(glowTex, HOT); deck.add(halo);
        const ghosts = Array.from({ length: TRAIL_N }, () => { const g = sprite(glowTex, 0xff9a5a); deck.add(g); return g; });
        lanes.push({ s, S, z, str, poleMat, car, hook, padMat, tip, stamp, headMat, coilMat, halo, ghosts });
      }

      // the PALM-MUTE BAR: felt bar + arms on the hinge (rotates about z)
      bar = new THREE.Group(); bar.position.set(HINGE.x, HINGE.y, 0);
      { const yDown = strTop(0) + MUTE_R - HINGE.y, xDown = MUTE_X - HINGE.x;
        const fb = new THREE.Mesh(new THREE.CylinderGeometry(MUTE_R, MUTE_R, 2.95, 18), felt); fb.rotation.x = Math.PI / 2; fb.position.set(xDown, yDown, 0);
        const ab = new THREE.CylinderGeometry(.03, .03, 2.98, 8); ab.rotateX(Math.PI / 2); ab.translate(xDown + .02, yDown + .07, 0);
        const arms = [-1, 1].map(sd => { const g = new THREE.BoxGeometry(Math.hypot(xDown, yDown) + .05, .06, .06);
          g.rotateZ(Math.atan2(yDown, xDown)); g.translate(xDown / 2, yDown / 2, sd * 1.52); return g; });
        bar.add(fb, new THREE.Mesh(mergeGeometries([ab, ...arms]), chrome));
      }
      deck.add(bar);

      for (const [mat, geos] of bucket){ const m = new THREE.Mesh(mergeGeometries(geos), mat); geos.forEach(g => g.dispose()); rig.add(m); }
      for (const [mat, geos] of dbucket){ const m = new THREE.Mesh(mergeGeometries(geos), mat); geos.forEach(g => g.dispose()); deck.add(m); }
      deck.updateMatrix(); rig.updateMatrix();
      return group;
    }

    function update(songTime, P, dt, { started, skipStrikes, onStrike }){
      if (!R || !deck) return;
      const t = started ? songTime : start;
      // the HIT edge: one strike event per chord (its voice is the whole chord through one amp)
      const hc = hitAt(R, t, start);
      if (started && hc.i >= 0 && edge.check(hc.abs, hc.since, skipStrikes)){
        const h = R.hits[hc.i], k = h.asg.length;
        _v.set(h.asg.reduce((a, x) => a + stampX(x.s), 0) / k, strTop(0), h.asg.reduce((a, x) => a + strZ(x.s), 0) / k).applyMatrix4(deck.matrix).applyMatrix4(rig.matrix);
        // the camera only shakes for a RINGING chord (the big open E, not every chug of a thrash riff —
        // a riff fires several hits a second; shaking on each would be a seizure, not an accent)
        const big = !h.mute && k >= 2 && h.dur >= .6;
        onStrike && onStrike({ note: h.id, vel: h.vel, pos: _v.clone(), color: SIG, dur: h.dur,
          shake: big && h.vel > .85 ? .03 + .01 * k : 0, sparks: h.mute ? 2 + k : 5 + 3 * k, light: h.mute ? .55 : .9 + .15 * k });
      }
      // the amp: cones punch with the last hit, tubes + grille glow with it
      let loud = 0, pump = 0;
      if (hc.i >= 0){
        const h = R.hits[hc.i], tau = h.mute ? .022 : .04, s = hc.since;
        loud = h.vel * Math.exp(-s * (h.mute ? 14 : 3));
        pump = h.vel * (s / tau) * Math.exp(1 - s / tau) * (h.mute ? .7 : 1);
      }
      for (const c of cones) c.g.position.z = c.z + .1 * pump * (1 + .08 * c.k);
      grilleMat.emissiveIntensity = .01 + .1 * loud;
      for (const tm of tubes) tm.emissiveIntensity = .4 + 2.6 * loud;
      lampMat.emissiveIntensity = 1.6 + 1.5 * loud;

      for (const ln of lanes){
        const { S, s } = ln;
        const c = carriageAt(S, t, start);
        const p = stampAt(S, t, start);
        const rg = ringAt(S, t, start);
        const vel = rg.i >= 0 ? S.ev[rg.i].vel : 0;
        // idle: the stamp parked on its latch (the rest between T_UP's catch and T_DN's drive)
        const lr = latchRest(p), parked = lr ? restEnv(lr.since, lr.until, .25, .45) : 0;
        // (gated by the hook's CLEARANCE above the string, not its press fraction: a carriage can be
        // mid-press during a latch rest, and the hook must sit on the string it kinks)
        const hov = parked ? HOVER_A * parked * smooth(0, CLEAR_UP, crossBottom(s, c.p) - strTop(s)) * (.5 - .5 * sway(t, HOVER_HZ, 1.3 * s)) : 0;
        // carriage: slider rides the groove; the hook's crossbar lifts / presses
        ln.car.position.x = c.x;
        ln.hook.position.set(c.x, crossBottom(s, c.p) - crossBottom(s, 0) + hov, ln.z);
        ln.padMat.emissiveIntensity = .1 + 2.4 * c.p;
        ln.tip.position.set(c.x, crossBottom(s, c.p) + hov + .05, ln.z);
        ln.tip.material.opacity = .9 * c.p; ln.tip.scale.setScalar(.85);
        // string: kink under the hook + the struck span's lateral ring
        const u = ln.str.u, depth = Math.max(0, strTop(s) - crossBottom(s, c.p));
        u.uXc.value = c.x; u.uDef.value = depth;
        u.uX0.value = rg.x0; u.uAmp.value = .045 * rg.a * (.4 + .6 * vel); u.uPh.value = t * 2 * Math.PI * 9;
        u.uGlow.value = .05 + 2.6 * rg.a * (.35 + .65 * vel);
        ln.str.hull.visible = rg.a > .01;
        ln.poleMat.emissiveIntensity = .05 + 3 * rg.a * (.3 + .7 * vel);
        // the stamp: head underside = the string's real top at the strike point + y (≥ 0: never into it)
        const surf = strikeSurface(s, c);
        const hy = surf + p.y + HEAD_R;
        ln.stamp.position.y = hy;
        const fl = p.i >= 0 ? Math.exp(-p.since * (S.ev[p.i].mute ? 22 : 9)) * (.35 + .65 * S.ev[p.i].vel) : 0;
        _c.copy(_sig).lerp(_hot, Math.min(1, fl));
        ln.headMat.emissive.copy(_c); ln.headMat.emissiveIntensity = 2.4 * fl;
        ln.halo.position.set(stampX(s), hy - HEAD_R * .6, ln.z);
        ln.halo.material.opacity = .7 * fl; ln.halo.scale.setScalar(.5 + 1.4 * (1 - fl) * fl + .4 * fl);
        // the solenoid glows with its drive (the force making up the lossy bounce) — or holds on the latch
        // (anticipation: a latched coil CHARGES over the last ~.7 s before it drives the stroke)
        const drive = p.mode === 'hold' ? .45 + .5 * (lr ? anticip(lr.until, .7) : 0) : Math.min(1.4, Math.abs(p.ay + 14.5) / 420);
        ln.coilMat.emissiveIntensity = .2 + 3 * drive;
        // ghosts: the head's recent past, re-sampled from the pure fn
        const sp = Math.min(1, Math.abs(p.vy) / V_IN);
        ln.ghosts.forEach((g, j) => {
          const tj = t - (j + 1) * TRAIL_DT;
          if (!started || tj < start || sp < .15){ g.material.opacity = 0; return; }
          const q = stampAt(S, tj, start);
          g.position.set(stampX(s), strikeSurface(s, carriageAt(S, tj, start)) + q.y + HEAD_R, ln.z);
          const f = 1 - (j + 1) / (TRAIL_N + 1);
          g.material.opacity = .28 * f * sp; g.scale.setScalar(HEAD_R * 3 * (.5 + .5 * f));
        });
      }
      // the mute bar: hinge angle from its pure fn (d = 1 down on the strings)
      const m = muteAt(R.bar, t, start);
      bar.rotation.z = BAR_UP * (1 - m.d);
    }

    return { build, update };
  },

  demo: { bpm: 112, beats: 32, scale: ['E', 'F#', 'G', 'A', 'A#', 'B', 'C', 'D'], part: demoPart() },
};

const STR_DZ2 = () => strZ(1) - strZ(0);

function sprite(glowTex, color){
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(.6);
  return s;
}

/* ---- a STRING: a cylinder along x displaced in the vertex shader — the kink under the hook
   (two straight runs nut → hook → bridge) and a lateral standing wave over the STRUCK SPAN
   (fret wire → bridge), which also glows hot. The HULL is the same span, fatter and additive:
   the blur a fast-vibrating string shows to the eye. ---- */
function buildString(s, envMap){
  const L = SCALE_L, r = gauge(s);
  const geo = new THREE.CylinderGeometry(r, r, L, 8, 140, false); geo.rotateZ(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: s < 3 ? 0xb89a72 : 0xd8dde8, metalness: 1, roughness: s < 3 ? .32 : .16, envMap,
    emissive: new THREE.Color(SIG), emissiveIntensity: 1 });
  const u = { uXc: { value: 0 }, uDef: { value: 0 }, uX0: { value: NUT_X }, uAmp: { value: 0 }, uPh: { value: 0 }, uGlow: { value: .05 },
              uHot: { value: new THREE.Color(HOT) }, uCol: { value: new THREE.Color(0xff7a3a) } };
  const DISP = `
      float X = position.x + ${((NUT_X + BRIDGE_X) / 2).toFixed(4)};
      float kink = X <= uXc ? (X - ${NUT_X.toFixed(4)}) / max(1e-4, uXc - ${NUT_X.toFixed(4)}) : (${BRIDGE_X.toFixed(4)} - X) / max(1e-4, ${BRIDGE_X.toFixed(4)} - uXc);
      float dy = -uDef * clamp(kink, 0., 1.);
      float span = clamp((X - uX0) / max(1e-3, ${BRIDGE_X.toFixed(4)} - uX0), 0., 1.);
      float env = X > uX0 ? sin(3.14159265 * span) : 0.;`;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'uniform float uXc, uDef, uX0, uAmp, uPh;\nvarying float vEnv;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
      ${DISP}
      transformed.y += dy;
      transformed.z += uAmp * env * sin(uPh);
      vEnv = env;`);
    sh.fragmentShader = 'uniform float uGlow;\nuniform vec3 uHot;\nvarying float vEnv;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance = mix(totalEmissiveRadiance, uHot, vEnv * .6) * uGlow * vEnv;`);
  };
  const hgeo = new THREE.CylinderGeometry(r * 1.6, r * 1.6, L, 8, 100, false); hgeo.rotateZ(-Math.PI / 2);
  const hmat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uXc, uDef, uX0, uAmp, uPh;
      varying float vE; varying vec3 vN; varying vec3 vV;
      void main(){
        ${DISP}
        vec3 p = position;
        p.y += dy;
        p.z += normal.z * uAmp * env;              // the blur lens: as wide as the swing
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        vN = normalize(normalMatrix * normal); vV = -mv.xyz; vE = env;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uCol; uniform float uGlow;
      varying float vE; varying vec3 vN; varying vec3 vV;
      void main(){
        float f = abs(dot(normalize(vN), normalize(vV)));
        gl_FragColor = vec4(uCol * min(1., uGlow * .35) * f * f * vE, 1.);
      }`,
  });
  const hull = new THREE.Mesh(hgeo, hmat); hull.visible = false;
  return { mesh: new THREE.Mesh(geo, mat), hull, u };
}

/* ---- the demo: an ORIGINAL E-minor thrash riff (gallop chugs under the palm, chromatic power
   chords, a ringing Em that parks the stamps, a 16th-note lick that sends the carriages
   running up the neck, a tremolo-chug climax). 8 bars of 4/4 at 112. ---- */
function demoPart(){
  const P5 = { E: ['E2', 'B2', 'E3'], G: ['G2', 'D3', 'G3'], A: ['A2', 'E3', 'A3'], 'A#': ['A#2', 'F3', 'A#3'], B: ['B2', 'F#3', 'B3'],
               D: ['D3', 'A3', 'D4'], C: ['C3', 'G3', 'C4'], F: ['F2', 'C3', 'F3'], 'F#': ['F#2', 'C#3', 'F#3'] };
  const out = [];
  const ch = (b, k, v = 1, d = .5) => P5[k].forEach(n => out.push([b, n, v, d]));
  const chug = (b, v = .7) => out.push([b, 'E2:m', v]);
  const gallop = b => { chug(b + .75, .62); chug(b + 1, .78); chug(b + 1.25, .6); chug(b + 1.5, .74); chug(b + 1.75, .6); };
  const barA = (b, end) => { ch(b, 'E', 1, .75); gallop(b); ch(b + 2, 'G', .95); chug(b + 2.5, .66); chug(b + 2.75, .6); end(b); };
  barA(0, b => { ch(b + 3, 'A#', .95); ch(b + 3.5, 'A', .9); });
  barA(4, b => { ch(b + 3, 'B', .95); ch(b + 3.5, 'A#', .9); });
  barA(8, b => { ch(b + 3, 'D', .95); ch(b + 3.5, 'C', .9); });
  // bar 4: the ringing Em (parks the stamps), then the lick up the neck
  ['E2', 'B2', 'E3', 'G3'].forEach(n => out.push([12, n, 1, 2]));
  ['B3', 'D4', 'E4', 'G4', 'F#4', 'E4', 'D4', 'B3'].forEach((n, i) => out.push([14 + i * .25, n, i % 2 ? .7 : .85, .25]));
  barA(16, b => { ch(b + 3, 'A#', .95); ch(b + 3.5, 'A', .9); });
  barA(20, b => { ch(b + 3, 'B', .95); ch(b + 3.5, 'A#', .9); });
  // bar 7: tremolo chugs, then a chromatic climb into the turnaround
  for (let i = 0; i < 8; i++) chug(24 + i * .25, i % 2 ? .62 : .8);
  ch(26, 'F', .9); ch(26.5, 'F#', .92); ch(27, 'G', .95); ch(27.5, 'A#', 1);
  // bar 8: the big open E, a last gallop, and the pickup chord back to the top
  ch(28, 'E', 1, 2); chug(30.25, .6); chug(30.5, .74); chug(30.75, .6); chug(31, .78); ch(31.5, 'B', 1, .5);
  return out.sort((a, b) => a[0] - b[0]);
}
