import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeEdge } from '../clock.js';
import { solvePogo, pogoAt, carriageAt, ringAt, voiceIdsFor, crossBottom, strikeSurface,
         STRINGS, NUT_X, BRIDGE_X, STAMP_DX, stampX, STR_DZ, SCALE_L, STRING_Y, FRET_H, HOOK_W,
         MAX_FRET, strZ, gauge, strTop, fretX, PART_LIMITS, FOOT_R, PLUNGE, POGO_TOP, BAR_Y, H_MAG, DT_MAX } from './solve.js';
import { pogoVoice } from './voice.js';

/* ============================================================
   POGO BASS — the electric-bass machine (an Animusic "Pogo Sticks"
   homage). A long-scale four-string bass on a stand, tilted toward the
   audience, an 8×10 bass cab behind it. Per string — its own lane, it
   never touches another string's parts:
     · a FRET CARRIAGE in a groove under the string: its chrome hook
       lifts, slides to the fret (the wires at the luthier's
       L·(1 − 2^(−f/12)) — the pitch IS the position) and presses the
       string onto it before the note;
     · a POGO STICK standing on the string over the split pickup. It
       BOUNCES — honest ballistics under the room's gravity — and every
       landing of its rubber foot is the note, exactly on the beat: a held
       note is a tall hop, an 8th-note chug a buzzing jitter. The bounce is
       lossy; the pogo's air PUMP (the glowing ring over the spring) fires
       at each landing and supplies the missing speed — the body visibly
       kicks up off its spring. A rest longer than DT_MAX rises to the
       gantry MAGNET overhead: it arrives at zero speed, hangs, and is let go
       so the free fall lands on the beat.
   The struck span (fret → bridge) blurs and glows, the pickup poles under
   it light with the ring, the cab's eight cones pump. Slap notes (GM 36/37)
   flash white-hot. All motion = solve.js (pure fns of songTime).

   PART CONSTRAINTS (imported MIDI — see solve.js PART_LIMITS):
     · pitch  E1–G3 (MIDI 28–55); outside folds by octaves
     · poly   a line + the odd double stop (≤ 2 sent; the strings voice ≤ 4)
     · gap    same PITCH re-strike ≥ .1 s (a 220-bpm 8th chug is .136 s);
              denser still plays (another string, or a lower hop)
     · events ≤ 512 hits per loop (a double stop = one hit)
     · flags  'E1:s' slap · 'E1:p' pick · 'E1:y' synth bass
     · voices one baked voice per unique NOTE + flag (~5–25 ms each)
   ============================================================ */

const SIG     = 0x3f7bff;            // signature: electric "lake placid" blue
const HOT     = 0xd6e4ff;            // the strike's white-blue
const SLAP    = 0xffffff;
const TILT    = .3;                  // the stand tips the neck toward the audience (rad)
const BOARD_Y = 1.65;                // board top above the plinth top (before the tilt)
const BEAM_Z  = 2.65;                // the gantry posts stand outside the body (rig z)
const TRAIL_N = 3, TRAIL_DT = .018;
const CAB     = { x: -3.3, z: -3.15, w: 4.3, h: 5.0, d: 1.25, y: .42 };   // the 8×10 behind the neck
const FULL    = { w: 15.85, d: 6.82, cx: -.33, cz: -.4 };                 // the full-size rig's XZ extent + centre (measured; scaled to the slot)
const SPRING_L = PLUNGE - .2;        // the spring's rest length (foot collar → body seat)

export default {
  key: 'pogo',
  label: 'Pogo Bass',
  wet: false,                        // dry: a bass line punches, it doesn't smear
  lookHeight: 2.6,
  camera: { dist: 9, up: 3.3, x: -.8 },   // from the left-front: the slanted pogo line fans out, side by side
  color: '#3f7bff',
  PART_LIMITS,

  voice: id => pogoVoice(id),
  voiceIds: part => voiceIdsFor(part),

  make({ envMap, glowTex }){
    let R = null, rig = null, deck = null, lanes = [], start = -Infinity, cones = [], lampMat = null, grilleMat = null;
    const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _c = new THREE.Color(), _hot = new THREE.Color(HOT), _sig = new THREE.Color(SIG),
          _slap = new THREE.Color(SLAP);

    function build(part, { rollT, beat, P, start: s0 = -Infinity, station, floorY = -20 }){
      const group = new THREE.Group();
      lanes = []; cones = []; start = s0;
      // everything is built at full size inside `rig`, then scaled UNIFORMLY to the station's footprint
      const W = station?.w ?? 11.2, D = station?.d ?? 6.4;
      const rs = Math.min(W / FULL.w, D / FULL.d, 1);
      rig = new THREE.Group(); rig.scale.setScalar(rs); rig.position.set(-FULL.cx * rs, 0, -FULL.cz * rs);
      group.add(rig);
      R = solvePogo(part, { rollT, beat, P });
      if (R.stats.viol || R.stats.dropped)
        console.warn(`pogo: ${R.stats.dropped} note(s) unvoiceable, ${R.stats.viol} drive-limit overrun(s) in the fingering`);

      // ---- shared materials (constant count after build) ----
      const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: .14, envMap, envMapIntensity: 1.3 });
      const dark   = new THREE.MeshStandardMaterial({ color: 0x232733, metalness: .7, roughness: .45, envMap });
      const iron   = new THREE.MeshStandardMaterial({ color: 0x15171e, metalness: .8, roughness: .38, envMap });
      const brass  = new THREE.MeshStandardMaterial({ color: 0xc9a05a, metalness: 1, roughness: .25, envMap });
      const wood   = new THREE.MeshStandardMaterial({ color: 0x2a1610, metalness: .1, roughness: .55, envMap, envMapIntensity: .5 });
      const maple  = new THREE.MeshStandardMaterial({ color: 0xc89a5e, metalness: .05, roughness: .4, envMap, envMapIntensity: .6 });
      const body   = new THREE.MeshStandardMaterial({ color: 0x1d3f9a, metalness: .65, roughness: .18, envMap, envMapIntensity: 1.3 });
      const guard  = new THREE.MeshStandardMaterial({ color: 0x0d0f14, metalness: .3, roughness: .3, envMap });
      const pearl  = new THREE.MeshStandardMaterial({ color: 0x1a2238, emissive: new THREE.Color(0x9ab8ff), emissiveIntensity: .5 });
      const bone   = new THREE.MeshStandardMaterial({ color: 0xe8e0cc, metalness: 0, roughness: .5 });
      const rubber = new THREE.MeshStandardMaterial({ color: 0x101114, metalness: .05, roughness: .8 });
      const anod   = new THREE.MeshStandardMaterial({ color: 0x2a5cff, metalness: .85, roughness: .22, envMap, envMapIntensity: 1.2 });
      const trim   = new THREE.MeshStandardMaterial({ color: 0x0a1430, emissive: new THREE.Color(SIG), emissiveIntensity: .9 });
      const rail   = new THREE.MeshStandardMaterial({ color: 0x060a18, emissive: new THREE.Color(SIG), emissiveIntensity: .12 });
      const tolex  = new THREE.MeshStandardMaterial({ color: 0x101114, metalness: .2, roughness: .85 });
      grilleMat    = new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: .2, roughness: .8, emissive: new THREE.Color(SIG), emissiveIntensity: .02 });
      const coneM  = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, metalness: .1, roughness: .7, side: THREE.DoubleSide });
      lampMat      = new THREE.MeshStandardMaterial({ color: 0x081030, emissive: new THREE.Color(SIG), emissiveIntensity: 2 });

      // static parts are collected per material and MERGED (a handful of draw calls at any part)
      const bucket = new Map(), dbucket = new Map();
      const adder = bk => (mat, gg) => (bk.get(mat) || bk.set(mat, []).get(mat)).push(gg);
      const add = adder(bucket), dadd = adder(dbucket);
      const putter = addf => (mat, geo, x, y, z, rx = 0, rz = 0, ry = 0) => {
        if (rx) geo.rotateX(rx); if (rz) geo.rotateZ(rz); if (ry) geo.rotateY(ry);
        geo.translate(x, y, z); addf(mat, geo);
      };
      const put = putter(add), dput = putter(dadd);
      const boxer = p => (mat, x0, x1, y0, y1, z0, z1) => p(mat, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      const box = boxer(put), dbox = boxer(dput);
      const rodGeo = (a, b, r, seg = 10) => {
        const d = new THREE.Vector3().subVectors(b, a), len = d.length();
        const gg = new THREE.CylinderGeometry(r, r, len, seg);
        gg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
        gg.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        return gg;
      };

      // ---- the plinth + a riser to the room floor ----
      box(iron, -7.6, 7.4, 0, .4, -2.7, 2.6);
      box(trim, -7.55, 7.35, .32, .36, 2.6, 2.64);
      const legH = -floorY / rs;
      if (legH > .05){
        box(dark, -7.3, 7.1, -legH, 0, -3.7, 2.35);
        box(trim, -7.32, 7.12, -.12, -.08, 2.35, 2.38);
      }
      // the stand: two yokes up to the neck's cradle
      for (const x of [-4.4, 1.6]){
        box(dark, x - .22, x + .22, .4, BOARD_Y - .7, -.4, .4);
        box(chrome, x - .3, x + .3, BOARD_Y - .78, BOARD_Y - .66, -1.2, 1.2);
      }

      // ---- the 8×10 cab + head (behind the neck, upright) ----
      { const { x, z, w, h, d, y } = CAB;
        box(tolex, x - w / 2, x + w / 2, y, y + h, z - d / 2, z + d / 2);
        box(chrome, x - w / 2 - .02, x + w / 2 + .02, y + h - .06, y + h, z - d / 2 - .02, z + d / 2 + .02);
        for (const sx of [-1, 1]) box(chrome, x + sx * (w / 2 + .03) - .03, x + sx * (w / 2 + .03) + .03, y + h * .3, y + h * .7, z - .2, z + .2);   // handles
        const gr = new THREE.Mesh(new THREE.BoxGeometry(w - .3, h - .4, .04), grilleMat);
        gr.position.set(x, y + h / 2, z + d / 2 + .005); rig.add(gr);
        // the head: chrome face, a row of knobs, the pilot lamp
        box(tolex, x - w / 2 + .1, x + w / 2 - .1, y + h, y + h + .95, z - d / 2 + .1, z + d / 2 - .05);
        box(chrome, x - w / 2 + .2, x + w / 2 - .2, y + h + .2, y + h + .75, z + d / 2 - .04, z + d / 2);
        for (let k = 0; k < 7; k++) put(dark, new THREE.CylinderGeometry(.075, .075, .08, 14), x - 1.5 + k * .45, y + h + .48, z + d / 2 + .04, Math.PI / 2);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(.07, 12, 8), lampMat);
        lamp.position.set(x + w / 2 - .45, y + h + .48, z + d / 2 + .02); rig.add(lamp);
        // eight 10" cones (2 × 4): each pumps on its own (a pure fn of the last strike)
        const pts = [];
        for (let i = 0; i <= 10; i++){ const r = .14 + .74 * i / 10; pts.push(new THREE.Vector2(r, -.26 * (1 - i / 10) ** 1.3)); }
        const coneGeo = new THREE.LatheGeometry(pts, 32); coneGeo.rotateX(Math.PI / 2); coneGeo.scale(.58, .58, .58);
        const capGeo = new THREE.SphereGeometry(.13, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2); capGeo.rotateX(Math.PI / 2); capGeo.scale(1, 1, .5);
        const rimGeo = new THREE.TorusGeometry(.53, .04, 8, 32);
        for (let i = 0; i < 8; i++){
          const cx = x + (i % 2 ? .98 : -.98), cy = y + .55 + (h - .9) * ((i >> 1) + .5) / 4, cz = z + d / 2 + .03;
          put(dark, rimGeo.clone(), cx, cy, cz);
          const cg = new THREE.Group(); cg.position.set(cx, cy, cz);
          cg.add(new THREE.Mesh(coneGeo, coneM), new THREE.Mesh(capGeo, dark)); rig.add(cg);
          cones.push({ g: cg, z: cz, k: i });
        }
      }

      // ---- the tilted DECK: the bass (board top = local y 0) ----
      deck = new THREE.Group();
      deck.position.set(0, BOARD_Y, 0); deck.rotation.x = TILT;
      rig.add(deck);
      const zEdge = strZ(STRINGS - 1) + .36, xFb = fretX(MAX_FRET + 1.6);
      dbox(wood, NUT_X - .05, xFb, -.28, 0, -zEdge, zEdge);           // rosewood board
      dbox(maple, NUT_X - .05, xFb, -.5, -.28, -zEdge + .05, zEdge - .05);   // the maple neck under it
      dbox(trim, NUT_X, xFb, -.22, -.19, zEdge, zEdge + .02);
      // a compact four-in-line headstock (bass tuners: big keys) + the string runs to the posts
      { const hs = new THREE.Shape();
        hs.moveTo(0, -zEdge + .05); hs.lineTo(-.4, -zEdge - .2); hs.lineTo(-1.45, -zEdge - .25); hs.lineTo(-1.75, -.1);
        hs.lineTo(-1.5, zEdge - .1); hs.lineTo(0, zEdge - .05); hs.lineTo(0, -zEdge + .05);
        const gg = new THREE.ExtrudeGeometry(hs, { depth: .2, bevelEnabled: true, bevelSize: .03, bevelThickness: .03, bevelSegments: 1 });
        gg.rotateX(Math.PI / 2); gg.translate(NUT_X - .05, -.06, 0); dadd(maple, gg);
        for (let s = 0; s < STRINGS; s++){
          const tx = NUT_X - .4 - .3 * s, tz = -zEdge - .02;
          dput(chrome, new THREE.CylinderGeometry(.06, .06, .3, 12), tx, .1, tz + .35);
          dput(chrome, new THREE.BoxGeometry(.2, .14, .22), tx, .02, -zEdge - .32);          // the key's gear housing
          dput(chrome, new THREE.CylinderGeometry(.13, .13, .04, 16), tx, .02, -zEdge - .55, Math.PI / 2);   // the wing key
          const a = new THREE.Vector3(NUT_X, STRING_Y, strZ(s)), b = new THREE.Vector3(tx, .2, tz + .35);
          const sg = rodGeo(a, b, gauge(s), 6); dadd(chrome, sg);
        }
      }
      // the BODY: a big offset-waist bass body (x → shape x, z → shape y), a black guard on it
      { const bs = new THREE.Shape();
        const pts = [[xFb - .3, -1.5], [1.6, -2.25], [3.2, -2.05], [4.6, -2.15], [6.6, -2.05], [7.4, -1.1], [7.3, .5], [7.5, 1.55],
                     [6.5, 2.25], [4.6, 2.0], [3.2, 2.2], [1.7, 2.45], [.9, 2.1], [xFb - .3, 1.5]];
        bs.moveTo(pts[0][0], -pts[0][1]); for (const [px, pz] of pts.slice(1)) bs.lineTo(px, -pz); bs.lineTo(pts[0][0], -pts[0][1]);
        const gg = new THREE.ExtrudeGeometry(bs, { depth: .46, bevelEnabled: true, bevelSize: .07, bevelThickness: .07, bevelSegments: 2 });
        gg.rotateX(-Math.PI / 2); gg.translate(0, -.56, 0); dadd(body, gg);
        const gs = new THREE.Shape();
        const gp = [[xFb - .1, -1.25], [2.2, -1.75], [3.0, -1.2], [5.4, -1.25], [5.7, 1.3], [3.1, 1.45], [2.0, 1.85], [xFb - .1, 1.25]];
        gs.moveTo(gp[0][0], -gp[0][1]); for (const [px, pz] of gp.slice(1)) gs.lineTo(px, -pz); gs.lineTo(gp[0][0], -gp[0][1]);
        const g2 = new THREE.ExtrudeGeometry(gs, { depth: .02, bevelEnabled: false });
        g2.rotateX(-Math.PI / 2); g2.translate(0, -.02, 0); dadd(guard, g2);
      }
      // nut, fret wires (SLOTTED where each hook post runs), pearl dots
      dbox(bone, NUT_X - .07, NUT_X + .02, 0, STRING_Y - .05, -zEdge, zEdge);
      const slots = [];
      for (let s = 0; s < STRINGS; s++) for (const sd of [-1, 1]) slots.push(strZ(s) + sd * HOOK_W / 2);
      for (let f = 1; f <= MAX_FRET; f++){
        const x = fretX(f);
        let z0 = -zEdge + .04;
        for (const zs of [...slots, zEdge - .04 + .03]){
          const z1 = Math.min(zs - .03, zEdge - .04);
          if (z1 > z0) dput(chrome, new THREE.BoxGeometry(.04, FRET_H, z1 - z0), x, FRET_H / 2, (z0 + z1) / 2);
          z0 = zs + .03;
        }
      }
      for (const f of [3, 5, 7, 9, 12, 15]){
        const x = (fretX(f) + fretX(f - 1)) / 2;
        for (const z of f === 12 ? [-STR_DZ, STR_DZ] : [0]) dput(pearl, new THREE.CylinderGeometry(.11, .11, .01, 16), x, .004, z);
      }
      for (let s = 0; s < STRINGS; s++) dbox(rail, NUT_X + .05, fretX(MAX_FRET) + .05, -.005, .003, strZ(s) - .022, strZ(s) + .022);
      // the SPLIT PICKUP the pogos stand over: two staggered halves (each under two strings) + a bridge
      // J-pickup bar; the pole pieces under each strike point are per-lane (lit by the ring)
      const ry = Math.atan(STAMP_DX / STR_DZ);
      for (const half of [0, 1]){
        const zc = (strZ(2 * half) + strZ(2 * half + 1)) / 2, xc = (stampX(2 * half) + stampX(2 * half + 1)) / 2;
        const cover = new THREE.CapsuleGeometry(.26, .62, 4, 12); cover.rotateX(Math.PI / 2); cover.scale(1, .3, 1);
        dput(guard, cover, xc, .04, zc, 0, 0, ry);
      }
      dbox(dark, BRIDGE_X - .78, BRIDGE_X - .42, -.02, .08, -1.25, 1.25);
      // bridge plate + saddles + the string tails through the body
      dbox(chrome, BRIDGE_X - .12, BRIDGE_X + .55, -.03, .05, -1.3, 1.3);
      for (let s = 0; s < STRINGS; s++){
        dbox(chrome, BRIDGE_X - .08, BRIDGE_X + .12, .05, STRING_Y - gauge(s), strZ(s) - .1, strZ(s) + .1);
        const sg = new THREE.CylinderGeometry(gauge(s), gauge(s), .45, 6); sg.rotateZ(Math.PI / 2);
        sg.translate(BRIDGE_X + .3, STRING_Y - .05, strZ(s)); dadd(chrome, sg);
      }
      // a knob plate on the lower horn
      for (const [kx, kz] of [[6.2, 1.35], [6.75, 1.0], [5.65, 1.7]]) dput(chrome, new THREE.CylinderGeometry(.14, .16, .16, 18), kx, .08, kz);

      // the deck's world (rig) pose: needed to stand the pogos and the gantry in GRAVITY's frame
      deck.updateMatrix();
      const toRig = (x, y, z, out = new THREE.Vector3()) => out.set(x, y, z).applyMatrix4(deck.matrix);

      // ---- the GANTRY (rig frame, vertical): two posts outside the body, the magnet beam over the
      //      slanted pogo line. Every magnet's face is the parked pogo's top cap (solve.js magnetFace).
      const faceRig = s => toRig(stampX(s), strTop(s) + H_MAG + POGO_TOP, strZ(s)).y;   // (nominal: an open string)
      const beamY = Math.max(...Array.from({ length: STRINGS }, (_, s) => faceRig(s))) + .5;
      const lineAt = z => { // the slanted line's rig x at rig z (the strike points, projected)
        const a = toRig(stampX(0), strTop(0), strZ(0)), b = toRig(stampX(STRINGS - 1), strTop(STRINGS - 1), strZ(STRINGS - 1));
        return a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z);
      };
      // a CANTILEVER: one post behind the body, the boom reaching forward over the pogo line (nothing stands
      // in front of the bass — the audience sees the sticks clean), a diagonal brace under it
      { const zb = -BEAM_Z, xb = lineAt(zb), zf = toRig(stampX(STRINGS - 1), strTop(STRINGS - 1), strZ(STRINGS - 1)).z + .45;
        box(iron, xb - .17, xb + .17, .4, beamY + .38, zb - .17, zb + .17);
        box(chrome, xb - .24, xb + .24, .4, .58, zb - .24, zb + .24);
        box(trim, xb - .18, xb + .18, beamY - .5, beamY - .44, zb - .18, zb + .18);
        const a = new THREE.Vector3(xb, beamY + .2, zb - .2), b = new THREE.Vector3(lineAt(zf), beamY + .2, zf);
        add(iron, rodGeo(a, b, .2, 4)); add(trim, rodGeo(a.clone().setY(beamY + .02), b.clone().setY(beamY + .02), .05, 8));
        put(chrome, new THREE.SphereGeometry(.16, 16, 10), b.x, b.y, b.z);
        const zm = zb + .55 * (zf - zb);
        add(dark, rodGeo(new THREE.Vector3(xb, beamY - 1.7, zb), new THREE.Vector3(lineAt(zm), beamY + .05, zm), .07, 8)); }

      // ---- per-string lanes ----
      const cyl = (r0, r1, h, y, seg = 16, rotZ = false, x = 0) => { const gg = new THREE.CylinderGeometry(r0, r1, h, seg); if (rotZ) gg.rotateZ(Math.PI / 2); gg.translate(x, y, 0); return gg; };
      const footGeo = mergeGeometries([
        (() => { const gg = new THREE.SphereGeometry(FOOT_R, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); gg.translate(0, FOOT_R, 0); return gg; })(),
        cyl(FOOT_R, FOOT_R * .78, .12, FOOT_R + .06, 24),
      ]);
      const plungerGeo = mergeGeometries([
        cyl(.05, .05, PLUNGE + .3, (PLUNGE + .3) / 2 + .15, 12),
        cyl(.105, .105, .05, .2, 20),                                         // the foot collar (the spring's lower seat)
      ]);
      // the body (y = 0 at the foot TIP's rest place + PLUNGE: the spring's upper seat)
      const H_TOP = POGO_TOP - PLUNGE, HOUSE = .8;
      const bodyAnod = mergeGeometries([
        cyl(.125, .125, HOUSE, HOUSE / 2, 24),                                // the pump cylinder (anodised: the stick's colour)
        cyl(.135, .135, .06, .03, 24), cyl(.135, .135, .06, HOUSE - .03, 24), // its end bands
      ]);
      const bodyChrome = mergeGeometries([
        cyl(.06, .06, H_TOP - HOUSE, HOUSE + (H_TOP - HOUSE) / 2, 14),        // the shaft
        cyl(.04, .04, .84, BAR_Y - PLUNGE, 12, true),                          // the handlebar (along x)
        cyl(.035, .035, .66, .1, 10, true),                                    // the foot pegs
        cyl(.1, .08, .07, H_TOP - .035, 20),                                   // the steel top cap (meets the magnet)
      ]);
      const bodyRubber = mergeGeometries([-1, 1].flatMap(sd => [
        cyl(.06, .06, .26, BAR_Y - PLUNGE, 12, true, sd * .32),
        (() => { const gg = new THREE.BoxGeometry(.16, .04, .12); gg.translate(sd * .25, .12, 0); return gg; })(),
      ]));
      const ringGeo = new THREE.TorusGeometry(.13, .03, 8, 28); ringGeo.rotateX(Math.PI / 2); ringGeo.translate(0, .1, 0);
      // the coil spring: a helix tube, rest length SPRING_L, scaled in y with the pump
      const springGeo = (() => {
        const turns = 5, pts = [];
        for (let i = 0; i <= turns * 24; i++){ const u = i / (turns * 24), a = u * turns * Math.PI * 2; pts.push(new THREE.Vector3(.1 * Math.cos(a), u * SPRING_L, .1 * Math.sin(a))); }
        return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 24, .02, 6, false);
      })();
      const shoeGeo = mergeGeometries([
        (() => { const gg = new THREE.CylinderGeometry(.13, .13, .16, 20); gg.translate(0, .08, 0); return gg; })(),
      ]);
      const armGeo = new THREE.CylinderGeometry(.04, .04, 1, 8); armGeo.translate(0, .5, 0);
      const slideGeo = new THREE.BoxGeometry(.5, .12, .16); slideGeo.translate(0, -.06, 0);
      const hookGeo = s => {
        const top = crossBottom(s, 0) + .035;
        const legs = [-1, 1].map(sd => { const gg = new THREE.CylinderGeometry(.02, .02, top + .04, 6); gg.translate(0, (top + .04) / 2 - .04, sd * HOOK_W / 2); return gg; });
        const cross = new THREE.CapsuleGeometry(.042, HOOK_W - .02, 4, 10); cross.rotateX(Math.PI / 2); cross.translate(0, top + .008, 0);
        return { legs: mergeGeometries(legs), cross };
      };
      for (let s = 0; s < STRINGS; s++){
        const S = R.strings[s], z = strZ(s);
        const str = buildString(s, envMap);
        str.mesh.position.set((NUT_X + BRIDGE_X) / 2, STRING_Y, z); deck.add(str.mesh);
        str.hull.position.copy(str.mesh.position); deck.add(str.hull);
        // the pole pieces under the strike point (the split pickup's) + the J bar's — lit by the ring
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x0a1030, metalness: .6, roughness: .3, emissive: new THREE.Color(SIG), emissiveIntensity: .05 });
        const pg = mergeGeometries([[stampX(s) - .1, .05, .1], [stampX(s) + .1, .05, .1], [BRIDGE_X - .6, .045, .1]].map(([px, r, h]) => {
          const gg = new THREE.CylinderGeometry(r, r, h, 12); gg.translate(px, h / 2 + .03, 0); return gg; }));
        const poles = new THREE.Mesh(pg, poleMat); poles.position.z = z; deck.add(poles);
        // the carriage: brass slider + chrome hook (the crossbar glows while it holds the string down)
        const car = new THREE.Group(), hook = new THREE.Group(), hg = hookGeo(s);
        const padMat = new THREE.MeshStandardMaterial({ color: 0x0c1430, metalness: .6, roughness: .3, envMap, emissive: new THREE.Color(SIG), emissiveIntensity: .1 });
        car.add(new THREE.Mesh(slideGeo, brass)); car.position.z = z;
        hook.add(new THREE.Mesh(hg.legs, chrome), new THREE.Mesh(hg.cross, padMat)); hook.position.z = z;
        const tip = sprite(glowTex, 0x8fb4ff);
        deck.add(car, hook, tip);
        // the POGO (rig frame: it stands in gravity, not in the tilted deck)
        const footMat = new THREE.MeshStandardMaterial({ color: 0x15161c, metalness: .1, roughness: .7, emissive: new THREE.Color(SIG), emissiveIntensity: 0 });
        const foot = new THREE.Group(); foot.add(new THREE.Mesh(footGeo, footMat), new THREE.Mesh(plungerGeo, chrome));
        const bodyG = new THREE.Group();
        const pumpMat = new THREE.MeshStandardMaterial({ color: 0x0a1230, emissive: new THREE.Color(SIG), emissiveIntensity: .3 });
        bodyG.add(new THREE.Mesh(bodyAnod, anod), new THREE.Mesh(bodyChrome, chrome), new THREE.Mesh(bodyRubber, rubber), new THREE.Mesh(ringGeo, pumpMat));
        const springMat = new THREE.MeshStandardMaterial({ color: 0xb8c4dc, metalness: 1, roughness: .2, envMap, emissive: new THREE.Color(SIG), emissiveIntensity: 0 });
        const spring = new THREE.Mesh(springGeo, springMat);
        rig.add(foot, bodyG, spring);
        // the magnet over it: a fixed coil housing on the beam, a sprung arm, the shoe (its face)
        const top0 = toRig(stampX(s), strTop(s), z);
        const coilMat = new THREE.MeshStandardMaterial({ color: 0x1a1006, emissive: new THREE.Color(0xff8a2a), emissiveIntensity: .15 });
        const coil = new THREE.Mesh(new THREE.CylinderGeometry(.17, .17, .32, 20), coilMat);
        coil.position.set(top0.x, beamY - .18, top0.z); rig.add(coil);
        put(dark, new THREE.CylinderGeometry(.2, .2, .06, 20), top0.x, beamY - .02, top0.z);
        const arm = new THREE.Mesh(armGeo, chrome); rig.add(arm);
        const shoe = new THREE.Mesh(shoeGeo, iron); rig.add(shoe);
        const halo = sprite(glowTex, HOT); rig.add(halo);
        const ghosts = Array.from({ length: TRAIL_N }, () => { const gs = sprite(glowTex, 0x7fa8ff); rig.add(gs); return gs; });
        lanes.push({ s, S, z, str, poleMat, car, hook, padMat, tip, foot, footMat, bodyG, pumpMat, spring, springMat, coilMat, arm, shoe, halo, ghosts,
                     edge: makeEdge(.25), beamY });
      }

      // (an extrusion is non-indexed: a bucket mixing it with boxes merges as non-indexed)
      const merge = geos => { const mixed = geos.some(gg => !gg.index); const gs = mixed ? geos.map(gg => gg.index ? gg.toNonIndexed() : gg) : geos;
        const m = mergeGeometries(gs); geos.forEach(gg => gg.dispose()); return m; };
      for (const [mat, geos] of bucket) rig.add(new THREE.Mesh(merge(geos), mat));
      for (const [mat, geos] of dbucket) deck.add(new THREE.Mesh(merge(geos), mat));
      rig.updateMatrix();
      return group;
    }

    /* the strike surface of string s in RIG coordinates for carriage pose c */
    const surfRig = (s, c, out) => out.set(stampX(s), strikeSurface(s, c), strZ(s)).applyMatrix4(deck.matrix);

    function update(songTime, P, dt, { started, skipStrikes, onStrike }){
      if (!R || !deck) return;
      const t = started ? songTime : start;
      let loud = 0, pump = 0;
      for (const ln of lanes){
        const { S, s } = ln;
        const c = carriageAt(S, t, start);
        const p = pogoAt(S, t, start);
        const rg = ringAt(S, t, start);
        const e = p.i >= 0 ? S.ev[p.i] : null;
        // the strike: the foot's landing (one voice per note)
        if (started && e && ln.edge.check(p.abs, p.since, skipStrikes)){
          surfRig(s, c, _v).applyMatrix4(rig.matrix);
          const slap = e.flag === 's';
          onStrike && onStrike({ note: e.id, vel: e.vel, pos: _v.clone(), color: slap ? 0xdfe8ff : SIG, dur: Math.min(3, Math.max(.05, e.sound)),
            shake: slap && e.vel > .85 ? .035 : 0, sparks: slap ? 9 : 3, light: .75 + .25 * e.vel });
        }
        if (e && p.since < .5){
          const s0 = p.since, tau = e.flag === 's' ? .02 : .035;
          loud = Math.max(loud, e.vel * Math.exp(-s0 * (e.flag === 's' ? 7 : 3)));
          pump = Math.max(pump, e.vel * (s0 / tau) * Math.exp(1 - s0 / tau));
        }
        // carriage: slider rides the groove; the hook's crossbar lifts / presses
        ln.car.position.x = c.x;
        ln.hook.position.set(c.x, crossBottom(s, c.p) - crossBottom(s, 0), ln.z);
        ln.padMat.emissiveIntensity = .15 + 3.2 * c.p;
        ln.tip.position.set(c.x, crossBottom(s, c.p) + .05, ln.z);
        ln.tip.material.opacity = .85 * c.p; ln.tip.scale.setScalar(.9);
        // string: kink under the hook + the struck span's lateral ring
        const vel = rg.i >= 0 ? S.ev[rg.i].vel : 0;
        const u = ln.str.u, depth = Math.max(0, strTop(s) - crossBottom(s, c.p));
        u.uXc.value = c.x; u.uDef.value = depth;
        u.uX0.value = rg.x0; u.uAmp.value = .06 * rg.a * (.4 + .6 * vel); u.uPh.value = t * 2 * Math.PI * 7;
        u.uGlow.value = .05 + 2.4 * rg.a * (.35 + .65 * vel);
        ln.str.hull.visible = rg.a > .01;
        ln.poleMat.emissiveIntensity = .05 + 3 * rg.a * (.3 + .7 * vel);
        // the POGO: foot tip = the strike surface + its flight (vertical, in gravity's frame)
        surfRig(s, c, _v);
        const fy = _v.y + p.y;
        ln.foot.position.set(_v.x, fy, _v.z);
        ln.bodyG.position.set(_v.x, fy + PLUNGE + p.pump, _v.z);
        ln.spring.position.set(_v.x, fy + .2, _v.z);
        ln.spring.scale.y = (SPRING_L + p.pump) / SPRING_L;
        const fl = e ? Math.exp(-p.since * (e.flag === 's' ? 14 : 8)) * (.35 + .65 * e.vel) : 0;
        _c.copy(_sig).lerp(e?.flag === 's' ? _slap : _hot, Math.min(1, fl));
        ln.footMat.emissive.copy(_c); ln.footMat.emissiveIntensity = 2.2 * fl;
        ln.pumpMat.emissiveIntensity = .3 + 3.2 * p.drive;
        ln.springMat.emissiveIntensity = 1.4 * p.drive;
        ln.halo.position.set(_v.x, _v.y + .05, _v.z);
        ln.halo.material.opacity = .75 * fl; ln.halo.scale.setScalar(.6 + 1.6 * (1 - fl) * fl + .5 * fl);
        // the magnet: its shoe's face is the parked top cap (its arm rides the pickup saddle); the coil
        // glows while it holds
        const face = _v.y + H_MAG + POGO_TOP;
        ln.shoe.position.set(_v.x, face, _v.z);
        ln.arm.position.set(_v.x, face + .16, _v.z); ln.arm.scale.y = Math.max(.05, ln.beamY - .34 - (face + .16));
        const holding = p.mode === 'hold' ? 1 : p.mode === 'drop' ? Math.max(0, 1 - (DT_MAX / 2 - p.until) * 8) : 0;
        ln.coilMat.emissiveIntensity = .12 + 1.5 * holding;
        // ghosts: the foot's recent past, re-sampled from the pure fn
        const sp = Math.min(1, Math.abs(p.vy) / 6);
        ln.ghosts.forEach((gs, j) => {
          const tj = t - (j + 1) * TRAIL_DT;
          if (!started || tj < start || sp < .2){ gs.material.opacity = 0; return; }
          const q = pogoAt(S, tj, start);
          surfRig(s, carriageAt(S, tj, start), _w);
          gs.position.set(_w.x, _w.y + q.y + FOOT_R, _w.z);
          const f = 1 - (j + 1) / (TRAIL_N + 1);
          gs.material.opacity = .26 * f * sp; gs.scale.setScalar(FOOT_R * 3.2 * (.5 + .5 * f));
        });
      }
      // the cab: cones punch with the strikes, grille + lamp glow with them
      for (const cn of cones) cn.g.position.z = cn.z + .09 * pump * (1 + .06 * cn.k);
      grilleMat.emissiveIntensity = .01 + .1 * loud;
      lampMat.emissiveIntensity = 1.6 + 1.6 * loud;
    }

    return { build, update };
  },

  demo: { bpm: 120, beats: 32, scale: ['E', 'F#', 'G', 'A', 'B', 'C', 'D'], part: demoPart() },
};

function sprite(glowTex, color){
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(.6);
  return s;
}

/* ---- a STRING: a cylinder along x displaced in the vertex shader — the kink under the hook
   (two straight runs nut → hook → bridge) and a lateral standing wave over the STRUCK SPAN
   (fret wire → bridge), which also glows. The HULL is the same span, fatter and additive:
   the blur a fast-vibrating string shows to the eye. (The Riff Forge's string, re-gauged.) ---- */
function buildString(s, envMap){
  const L = SCALE_L, r = gauge(s);
  const geo = new THREE.CylinderGeometry(r, r, L, 8, 140, false); geo.rotateZ(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xc9ced8, metalness: 1, roughness: .28, envMap,
    emissive: new THREE.Color(SIG), emissiveIntensity: 1 });
  const u = { uXc: { value: 0 }, uDef: { value: 0 }, uX0: { value: NUT_X }, uAmp: { value: 0 }, uPh: { value: 0 }, uGlow: { value: .05 },
              uHot: { value: new THREE.Color(HOT) }, uCol: { value: new THREE.Color(0x5a8cff) } };
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
        p.z += normal.z * uAmp * env;
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

/* ---- the demo: an ORIGINAL E-minor rock bass line, 8 bars at 120 — a root-8ths drive (the pogo
   buzzes in place), an octave-popping SLAP bar, a walking climb up the neck with a held note that
   parks a pogo on its magnet, a synth-bass bar, and a fast picked fill into the turnaround. ---- */
function demoPart(){
  const out = [];
  const n8 = (b, note, v = .8, d = .45) => out.push([b, note, v, d]);
  // bars 1–2: driving 8ths on E, a turn to G and A
  for (let i = 0; i < 8; i++) n8(i * .5, 'E1', i % 2 ? .72 : .9);
  for (let i = 0; i < 4; i++) n8(4 + i * .5, 'G1', i % 2 ? .72 : .88);
  for (let i = 0; i < 4; i++) n8(6 + i * .5, 'A1', i % 2 ? .74 : .9);
  // bar 3: SLAP — thumb on the low E, popped octaves
  for (const [b, nt, v] of [[8, 'E1:s', 1], [8.5, 'E2:s', .9], [9, 'E1:s', .95], [9.25, 'E1:s', .7], [9.5, 'E2:s', .95],
                            [10, 'G1:s', 1], [10.5, 'G2:s', .9], [11, 'A1:s', 1], [11.5, 'A2:s', .95]]) n8(b, nt, v, .3);
  // bar 4: a walk up the neck, a held B (the pogo parks on its magnet while it rings)
  ['E2', 'F#2', 'G2', 'A2'].forEach((nt, i) => n8(12 + i * .5, nt, .85, .5));
  n8(14, 'B2', 1, 2);
  // bars 5–6: the drive again, with a double stop (root + fifth) on each downbeat
  for (let i = 0; i < 8; i++) n8(16 + i * .5, 'E1', i % 2 ? .72 : .9);
  out.push([16, 'B1', .8, 1]);
  for (let i = 0; i < 4; i++) n8(20 + i * .5, 'C2', i % 2 ? .72 : .9);
  for (let i = 0; i < 4; i++) n8(22 + i * .5, 'D2', i % 2 ? .72 : .9);
  out.push([20, 'G2', .8, 1]);
  // bar 7: SYNTH bass — a squelchy octave figure
  for (const [b, nt] of [[24, 'E1:y'], [24.75, 'E2:y'], [25.5, 'E1:y'], [26, 'G1:y'], [26.75, 'G2:y'], [27.5, 'A1:y']]) n8(b, nt, .9, .6);
  // bar 8: a picked 16th fill down the neck into the turnaround
  ['B2:p', 'A2:p', 'G2:p', 'F#2:p', 'E2:p', 'D2:p', 'B1:p', 'A1:p'].forEach((nt, i) => n8(28 + i * .25, nt, .8, .22));
  n8(30, 'E1', 1, 1.4);
  n8(31.5, 'B1', .85, .45);
  return out.sort((a, b) => a[0] - b[0]);
}
