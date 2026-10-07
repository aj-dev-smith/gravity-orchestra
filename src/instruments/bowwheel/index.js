/* ============================================================
   BOW WHEEL — bowed strings (violin · viola · cello · contrabass ·
   string ensembles). (mechanism + closed-form timing: solve.js ·
   DSP: voice.js)

   A hurdy-gurdy built for marbles, at the scale of a pipe organ. A great
   rosined WHEEL (r = 4) turns at a constant ω on an axle pointing at the
   audience, belt-driven by a motor on the deck — you SEE the friction
   surface move. Up to twelve strings run back from a front bridge over
   the wheel's crown (fanned like a violin bridge's curve) to their tail
   pegs; their LENGTH is the note (∝ f^−½), so the string bed's tail is a
   harp-curve, long bass strings behind, short trebles in front. Over each
   string a TANGENT rod rests its felt shoe on the string; a marble drops
   from that string's own electromagnet into the rod's cup, its weight
   sinks the rod and presses the string onto the turning rim exactly on
   the beat — and the wheel bows it for as long as the marble sits there.
   The bowed string glows deep crimson and SHIMMERS (its vibration hull,
   with the voice's own delayed vibrato), rosin dust flies off the rim at
   the contact. At note-off the rod's solenoid kicks: the string lifts off
   (the sound stops) and the marble is lobbed — a short hop straight back
   into the cup for a re-bow, or all the way up to its magnet to wait.
   All motion = solve.js laneAt(songTime). Time is the only state.

   ── PART CONSTRAINTS (imports; see solve.js PART_LIMITS) ──────────────
     · pitches: ≤ 12 distinct (one string each). More → the least-used
       pitches are dropped (count × held length ranks them).
     · range: C2–C7 (MIDI 36–96); outside → folded by octaves.
     · polyphony: every string can bow at once (12); a real section part
       (≤ ~4–6 voices, chords + lines) reads best.
     · same-pitch onsets ≥ MIN_REPEAT (~.38 s) apart; closer repeats
       MERGE into one longer stroke (tremolo → a sustained bow).
     · held length .08 … 3.9 s (the voice sustains 3.9 s; durBeats 0 →
       a .45 s stroke). Each stroke ends early enough to make the next
       landing; at least one flight per string per loop parks on the
       magnet (the count-in waits there) — if a string never rests long
       enough, its stroke before the longest gap is shortened, and as a
       last resort the next note is thinned.
     · ≤ 600 events per loop (the quietest beyond are thinned).
     · never throws: bad events are skipped, flats / odd ids dropped.
   ============================================================ */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { noteNum } from '../../engine.js';
import { eventTimes, lanesByNote, makeEdge } from '../clock.js';
import {
  laneGeom, laneX, bowLane, laneAt, strokeAt, bowEnv, prepPart, wheelAngle, PART_LIMITS, HOLD_MAX,
  WHEEL_R, WHEEL_Y, WHEEL_Z, RIM_W, OMEGA, BALL_R, CUP_R, CUP_Y, MAG_Y, SPACING, GAP,
} from './solve.js';
import { bowVoice } from './voice.js';
import { bucketId, planLadder, allBucketIds } from '../sustain.js';

/* the part → its strings, their geometry and solved lanes — pure, shared by build() and voiceIds
   (so the DURATION BUCKET each stroke fires — '<note>~<hold>', ../sustain.js: the bow lift baked
   into the iOS sample — is planned from the very strokes the machine plays) */
function planBow(part, { rollT, beat, P }){
  const prep = prepPart(part);
  const byNote = lanesByNote(eventTimes(prep.events, { rollT, beat }));
  const notes = Object.keys(byNote).sort((a, b) => noteNum(a) - noteNum(b));
  const geoms = notes.map((note, i) => laneGeom(note, laneX(i, notes.length)));
  const lanes = notes.map((note, i) => bowLane(byNote[note].map(e => ({ t: e.t, tDur: e.tDur, vel: e.vel })), P, geoms[i]));
  const pairs = []; lanes.forEach((L, i) => L.cyc.forEach(q => pairs.push([notes[i], q.hold])));
  return { prep, notes, geoms, lanes, pairs, ladder: planLadder(pairs, () => HOLD_MAX) };
}

export { PART_LIMITS };

const SIG = 0xff2d55;                  // signature: deep rose-crimson
const ZF = WHEEL_Z + RIM_W / 2 + .5;   // the front bridge (strings' near termination)
const TRAIL_N = 10, TRAIL_DT = .02;
const DUST_N = 8, DUST_LIFE = .5;
const GUIDE_Y = CUP_Y - BALL_R - .8;   // the tangents' guide beam (and solenoids)
const MAG_LEN = .32;
const PULLEY_AX = .62, PULLEY_M = .26; // axle / motor pulley radii (belt ratio)
const MOTOR = { x: 5.0, y: 1.0, z: 1.55 };
const POST_X = WHEEL_R + .65;          // gantry posts stand outside the rim

/* deep crimson (low strings) → rose (high) */
function laneColor(n){
  const u = Math.min(1, Math.max(0, (n - 36) / 54));
  return new THREE.Color().setHSL(.985 - .05 * u, .9, .46 + .14 * u);
}

/* a flat vibration lens along +z (u = 0..1 over len), unit half-width along x */
function lensGeometry(len, K = 28){
  const pos = [], idx = [];
  for (let k = 0; k <= K; k++){
    const u = k / K, w = Math.sin(Math.PI * u);
    pos.push(-w, 0, -u * len, w, 0, -u * len);
    if (k){ const b = 2 * k; idx.push(b - 2, b - 1, b, b - 1, b + 1, b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  return g;
}

/* a closed open-belt path around two pulleys in the x-y plane (external tangents) */
function beltPath(a, ra, b, rb, N = 96){
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
  const al = Math.acos((ra - rb) / d);
  const pts = [];
  // arc on a (the far side), tangent, arc on b, tangent
  const arc = (c, r, from, to, n) => { for (let i = 0; i <= n; i++){ const t = from + (to - from) * i / n; pts.push(new THREE.Vector2(c.x + r * Math.cos(t), c.y + r * Math.sin(t))); } };
  arc(a, ra, th + al, th + TAU_ - al, N / 2);
  arc(b, rb, th - al, th + al, N / 4);
  pts.push(pts[0].clone());
  return pts;
}
const TAU_ = Math.PI * 2;

export default {
  key: 'bowwheel',
  label: 'Bow Wheel',
  wet: false,
  lookHeight: 7.6,
  camera: { dist: 15, up: 4, x: 6 },   // three-quarter, from the bass side's front: wheel face + the fanned bed
  color: '#ff2d55',

  voice: id => bowVoice(id),
  /* every stroke's id at this tempo (main passes {beat, rollT, P}); without one, every rung of every string */
  voiceIds(part, { beat, rollT = 2.6, P } = {}){
    if (beat > 0 && P > 0){ const pl = planBow(part, { rollT, beat, P }); return [...new Set(pl.pairs.map(([n, h]) => bucketId(n, h, HOLD_MAX, pl.ladder)))]; }
    return allBucketIds([...new Set(prepPart(part).events.map(e => e[1]))], () => HOLD_MAX);
  },

  make({ envMap, glowTex }){
    let lanes = [], start = -Infinity, ladder = [], wheel = null, pulA = null, pulM = null, beltMk = null, belt = null, rimMat = null,
      trail = null, dust = null, zOff = 0, tire = null;

    function build(part, { rollT, beat, P, start: s0 = -Infinity, station, floorY = -20 }){
      const group = new THREE.Group();
      lanes = []; start = s0;
      const pl = planBow(part, { rollT, beat, P });
      const { prep, notes, geoms } = pl;
      ladder = pl.ladder;
      const n = notes.length;
      const span0 = n ? (n - 1) / 2 * SPACING : 0;

      // the machine's depth: front pulley … the longest string's tail; centre it on the slot
      const zBack = Math.min(-1.6, ...geoms.map(G => ZF - G.len)) - .6, zFront = MOTOR.z + .5;
      zOff = -(zBack + zFront) / 2;
      const M = new THREE.Group(); M.position.z = zOff; group.add(M);

      // ---- materials (constant count after build) ----
      const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: .15, envMap, envMapIntensity: 1.3, side: THREE.DoubleSide });
      const dark   = new THREE.MeshStandardMaterial({ color: 0x232733, metalness: .7, roughness: .45, envMap });
      const iron   = new THREE.MeshStandardMaterial({ color: 0x17141c, metalness: .8, roughness: .35, envMap });
      const brass  = new THREE.MeshStandardMaterial({ color: 0xc9a05a, metalness: 1, roughness: .25, envMap });
      const wood   = new THREE.MeshStandardMaterial({ color: 0x3a1418, metalness: .2, roughness: .38, envMap, envMapIntensity: .6 });
      const felt   = new THREE.MeshStandardMaterial({ color: 0x4a0f1c, metalness: 0, roughness: .95 });
      const trimM  = new THREE.MeshStandardMaterial({ color: 0x1a0610, emissive: new THREE.Color(SIG), emissiveIntensity: .8 });
      rimMat = new THREE.MeshStandardMaterial({ color: 0x1e140e, metalness: .3, roughness: .5, envMap, envMapIntensity: .7,
        emissive: new THREE.Color(SIG), emissiveIntensity: .02, side: THREE.DoubleSide });
      const ballGeo = new THREE.SphereGeometry(BALL_R, 32, 22);

      const bucket = new Map();
      const put = (mat, geo, x, y, z, rx = 0, rz = 0) => {
        if (rx) geo.rotateX(rx); if (rz) geo.rotateZ(rz);
        geo.translate(x, y, z);
        (bucket.get(mat) || bucket.set(mat, []).get(mat)).push(geo);
      };
      const box = (mat, x0, x1, y0, y1, z0, z1) => put(mat, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      const bar = (mat, a, b, r, seg = 12) => {
        const d = new THREE.Vector3().subVectors(b, a), len = d.length();
        const gg = new THREE.CylinderGeometry(r, r, len, seg);
        gg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
        put(mat, gg, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      };
      const V = (x, y, z) => new THREE.Vector3(x, y, z);

      // ---- deck + plinth to the floor ----
      const W = Math.max(station?.w ?? 10, 2 * POST_X + .9), x0 = -W / 2, x1 = Math.max(W / 2, MOTOR.x + .7);
      box(dark, x0, x1, -.35, 0, zBack - .2, zFront + .2);
      box(trimM, x0 - .02, x1 + .02, -.08, -.03, zBack - .22, zFront + .22);
      if (isFinite(floorY) && floorY < -1) box(dark, x0 + 1.2, x1 - 1.2, floorY, -.35, zBack + 1, zFront - 1);

      // ---- the WHEEL: rosined rim, spokes, hub — one rotating group about the axle (z) ----
      wheel = new THREE.Group(); wheel.position.set(0, WHEEL_Y, WHEEL_Z);
      const rimO = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, RIM_W, 160, 1, true); rimO.rotateX(Math.PI / 2);
      const rimI = new THREE.CylinderGeometry(WHEEL_R - .3, WHEEL_R - .3, RIM_W, 120, 1, true); rimI.rotateX(Math.PI / 2);
      const rimF = new THREE.RingGeometry(WHEEL_R - .3, WHEEL_R, 160); rimF.translate(0, 0, RIM_W / 2);
      const rimB = new THREE.RingGeometry(WHEEL_R - .3, WHEEL_R, 160); rimB.rotateY(Math.PI); rimB.translate(0, 0, -RIM_W / 2);
      wheel.add(new THREE.Mesh(mergeGeometries([rimO, rimI, rimF, rimB].map(g => g.toNonIndexed())), rimMat));
      const spokes = [];
      for (let k = 0; k < 8; k++){
        const a = k * Math.PI / 4, s = new THREE.BoxGeometry(.16, WHEEL_R - .75, .14);
        s.translate(0, .45 + (WHEEL_R - .75) / 2, 0); s.rotateZ(a); spokes.push(s);
        const bolt = new THREE.CylinderGeometry(.07, .07, .06, 10); bolt.rotateX(Math.PI / 2);
        bolt.translate((WHEEL_R - .15) * Math.cos(a + Math.PI / 8), (WHEEL_R - .15) * Math.sin(a + Math.PI / 8), RIM_W / 2 + .03); spokes.push(bolt);
      }
      const hub = new THREE.CylinderGeometry(.55, .55, .5, 32); hub.rotateX(Math.PI / 2); spokes.push(hub);
      const cap = new THREE.CylinderGeometry(.3, .38, .2, 24); cap.rotateX(Math.PI / 2); cap.translate(0, 0, .33); spokes.push(cap);
      wheel.add(new THREE.Mesh(mergeGeometries(spokes.map(g => g.index ? g.toNonIndexed() : g)), chrome));
      wheel.children.forEach(m => { m.userData.noMerge = true; });
      M.add(wheel);
      // the rosin's heat: a crimson halo on the rim's running surface while anything bows (static —
      // round, so it needn't turn — but only the crown under the strings burns)
      {
        const arc = 2 * Math.asin(Math.min(1, (span0 + .5) / WHEEL_R));
        const tg = new THREE.TorusGeometry(WHEEL_R + .015, .05, 8, 64, arc); tg.rotateZ(Math.PI / 2 - arc / 2);
        tire = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: SIG, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false }));
        tire.position.set(0, WHEEL_Y, WHEEL_Z); tire.scale.z = RIM_W / .1; M.add(tire);
      }
      // axle + two pedestals (front / back of the rim) with pillow-block bearings
      bar(chrome, V(0, WHEEL_Y, -RIM_W / 2 - .7), V(0, WHEEL_Y, MOTOR.z + .25), .14, 20);
      for (const z of [-RIM_W / 2 - .45, RIM_W / 2 + .45]){
        box(iron, -.22, .22, 0, WHEEL_Y - .25, z - .16, z + .16);
        box(iron, -.7, .7, 0, .25, z - .45, z + .45);
        box(brass, -.4, .4, WHEEL_Y - .3, WHEEL_Y + .3, z - .2, z + .2);
      }
      // the drive: motor on the deck, open belt to the axle pulley (both spin; a belt splice runs round)
      const mkPulley = (r) => {
        const g = new THREE.Group();
        const disc = new THREE.CylinderGeometry(r, r, .22, 40); disc.rotateX(Math.PI / 2);
        const rib = new THREE.BoxGeometry(r * 1.7, .07, .26);
        const rib2 = rib.clone(); rib2.rotateZ(Math.PI / 2);
        g.add(new THREE.Mesh(disc, iron), new THREE.Mesh(mergeGeometries([rib, rib2]), brass));
        g.children.forEach(m => { m.userData.noMerge = true; });
        return g;
      };
      pulA = mkPulley(PULLEY_AX); pulA.position.set(0, WHEEL_Y, MOTOR.z); M.add(pulA);
      pulM = mkPulley(PULLEY_M); pulM.position.set(MOTOR.x, MOTOR.y, MOTOR.z); M.add(pulM);
      box(iron, MOTOR.x - .55, MOTOR.x + .55, 0, MOTOR.y - .25, MOTOR.z - 1.3, MOTOR.z - .2);
      const can = new THREE.CylinderGeometry(.5, .5, 1.0, 28); can.rotateX(Math.PI / 2);
      put(dark, can, MOTOR.x, MOTOR.y, MOTOR.z - .75);
      const ring = new THREE.TorusGeometry(.51, .04, 8, 32); put(trimM, ring, MOTOR.x, MOTOR.y, MOTOR.z - .3);
      bar(chrome, V(MOTOR.x, MOTOR.y, MOTOR.z - .3), V(MOTOR.x, MOTOR.y, MOTOR.z + .1), .07);
      {
        const pts = beltPath({ x: 0, y: WHEEL_Y }, PULLEY_AX + .03, { x: MOTOR.x, y: MOTOR.y }, PULLEY_M + .03);
        const curve = new THREE.CatmullRomCurve3(pts.map(p => V(p.x, p.y, MOTOR.z)), true);
        put(iron, new THREE.TubeGeometry(curve, 160, .035, 6, true), 0, 0, 0);
        const lens = [0]; for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
        belt = { pts, lens, L: lens[lens.length - 1] };
        beltMk = new THREE.Mesh(new THREE.BoxGeometry(.16, .16, .12), trimM); beltMk.userData.noMerge = true; M.add(beltMk);
      }

      // ---- the gantry: two posts outside the rim, a guide beam for the tangents, a magnet beam ----
      const magTop = MAG_Y + BALL_R + MAG_LEN, beamY = magTop + .12;
      const span = n ? (n - 1) / 2 * SPACING + .45 : 1;
      for (const sx of [-1, 1]){
        bar(chrome, V(sx * POST_X, 0, 0), V(sx * POST_X, beamY + .1, 0), .11, 16);
        box(iron, sx * POST_X - .45, sx * POST_X + .45, 0, .2, -.5, ZF + .5);
        put(chrome, new THREE.SphereGeometry(.2, 16, 12), sx * POST_X, beamY + .12, 0);
      }
      box(chrome, -POST_X, POST_X, beamY - .09, beamY + .09, -.12, .12);
      box(dark, -POST_X, POST_X, GUIDE_Y - .08, GUIDE_Y + .08, -.14, .14);
      // the front bridge: a beam spanning the posts under the strings' front ends, a saddle per string
      const yMin = n ? Math.min(...geoms.map(G => G.yRest - G.rs)) : 8;
      // (a curved brass bridge following the strings' crown — each string sits on it — hung from the guide beam)
      const bx = span + .25;
      const bAt = x => WHEEL_Y + Math.sqrt(WHEEL_R * WHEEL_R - Math.min(x * x, WHEEL_R * WHEEL_R * .9)) + GAP;   // = a string's underside
      {
        const pts = []; for (let k = 0; k <= 24; k++){ const x = -bx + 2 * bx * k / 24; pts.push(V(x, bAt(x) - .06, ZF)); }
        put(brass, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, .06, 8, false), 0, 0, 0);
        for (const sx of [-1, 1]) bar(chrome, V(sx * bx, bAt(sx * bx) - .06, ZF), V(sx * bx, GUIDE_Y, .1), .04);
      }
      // the string bed behind the wheel: two rails, a lacquered soundboard, a harp-curve tailpiece
      const yRail = yMin - .55, zR0 = -RIM_W / 2 - .35;
      if (n){
        const xs = geoms.map(G => G.x), tails = geoms.map(G => ZF - G.len);
        for (const sx of [-1, 1]){
          const xr = sx * (span + .1), zEnd = (sx < 0 ? tails[0] : tails[n - 1]) - .35;
          box(dark, xr - .07, xr + .07, yRail - .14, yRail, Math.min(zEnd, zR0 - .4), zR0);
          for (const zl of [zR0 - .2, Math.min(zEnd, zR0 - .4) + .15]) box(dark, xr - .06, xr + .06, 0, yRail - .14, zl - .06, zl + .06);
        }
        const sh = new THREE.Shape();
        sh.moveTo(-span - .1, -zR0);
        sh.lineTo(span + .1, -zR0);
        for (let i = n - 1; i >= 0; i--) sh.lineTo(xs[i] + (i === n - 1 ? .45 : 0), -(tails[i] - .3));
        sh.lineTo(-span - .1, -(tails[0] - .3));
        const sb = new THREE.ShapeGeometry(sh); sb.rotateX(Math.PI / 2);   // (shape y → −z)
        put(wood, sb, 0, yRail - .02, 0);
        for (let i = 0; i < n; i++){
          const G = geoms[i];
          // tail peg: a brass post up to the string with a tuning head; a chrome saddle at the bridge
          bar(brass, V(G.x, yRail, tails[i]), V(G.x, G.yRest + .06, tails[i]), .045);
          put(chrome, new THREE.SphereGeometry(.07, 10, 8), G.x, G.yRest + .08, tails[i]);
          put(chrome, new THREE.SphereGeometry(.045, 10, 8), G.x, G.yRest - G.rs - .02, ZF);   // saddle
          if (i) bar(brass, V(xs[i - 1], yRail + .04, tails[i - 1]), V(G.x, yRail + .04, tails[i]), .05);
          // the tangent's magnet (static), hung from the beam
          put(chrome, new THREE.CylinderGeometry(.14, .16, MAG_LEN, 18), G.x, MAG_Y + BALL_R + MAG_LEN / 2, 0);
          // guide bushing
          put(chrome, new THREE.CylinderGeometry(.075, .075, .2, 12), G.x, GUIDE_Y, 0);
        }
      }

      // ---- the lanes ----
      const springGeo = (() => {                         // a unit-height helix, scaled to the spring's length
        const pts = []; for (let i = 0; i <= 120; i++){ const a = i / 120 * 7 * TAU_; pts.push(V(.085 * Math.cos(a), i / 120, .085 * Math.sin(a))); }
        return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, .012, 5, false);
      })();
      const cupGeo = (() => {                            // a shallow cup whose seat meets the marble's bottom at y = 0
        const pr = [];
        for (let i = 0; i <= 10; i++){ const a = i / 10 * 1.05; pr.push(new THREE.Vector2(Math.max(.001, (BALL_R + .012) * Math.sin(a)), BALL_R + .0 - (BALL_R) * Math.cos(a) - .0)); }
        pr.push(new THREE.Vector2(CUP_R, pr[pr.length - 1].y + .02), new THREE.Vector2(CUP_R, -.07), new THREE.Vector2(.05, -.09));
        return new THREE.LatheGeometry(pr, 28);
      })();
      const strGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1); // unit; scaled per segment
      const trailPos = new Float32Array(n * TRAIL_N * 3), trailCol = new Float32Array(n * TRAIL_N * 3);
      const dustPos = new Float32Array(n * DUST_N * 3), dustCol = new Float32Array(n * DUST_N * 3);

      notes.forEach((note, i) => {
        const G = geoms[i], color = laneColor(noteNum(note));
        const L = pl.lanes[i];
        const tail = ZF - G.len;
        // string: two segments (bridge → rim contact → tail), crimson-hot when bowed
        const sMat = new THREE.MeshStandardMaterial({ color: 0xb8a690, metalness: 1, roughness: .28, envMap,
          emissive: color, emissiveIntensity: .2 });
        const segA = new THREE.Mesh(strGeo, sMat), segB = new THREE.Mesh(strGeo, sMat);
        segA.userData.noMerge = segB.userData.noMerge = true;
        // vibration hull: in the plane of the bow (tangent to the rim at the contact)
        const lens = new THREE.Mesh(lensGeometry(ZF - tail), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        lens.position.set(G.x, G.yRest, ZF); lens.rotation.z = -G.phi;
        // tangent: rod + cup move together; a felt shoe on the string
        const rodLen = (CUP_Y - BALL_R) - (G.yRest + G.rs);
        const tan = new THREE.Group(); tan.position.set(G.x, 0, 0);
        const rodG = new THREE.CylinderGeometry(.035, .035, rodLen, 10); rodG.translate(0, G.yRest + G.rs + rodLen / 2, 0);
        const cupG = cupGeo.clone(); cupG.translate(0, CUP_Y - BALL_R, 0);
        const flange = new THREE.CylinderGeometry(.09, .09, .04, 14); flange.translate(0, CUP_Y - BALL_R - .3, 0);
        const rodMesh = new THREE.Mesh(mergeGeometries([rodG.toNonIndexed(), cupG.toNonIndexed(), flange.toNonIndexed()]), chrome);
        const shoeG = new THREE.BoxGeometry(.16, .07, .3); shoeG.translate(0, G.yRest + G.rs + .035, 0);
        const shoe = new THREE.Mesh(shoeG, felt);
        rodMesh.userData.noMerge = shoe.userData.noMerge = true;
        tan.add(rodMesh, shoe);
        // spring from the guide bushing up to the flange (compresses as the rod sinks)
        const spring = new THREE.Mesh(springGeo, brass); spring.userData.noMerge = true;
        const sp0 = GUIDE_Y + .1, sp1 = CUP_Y - BALL_R - .32;
        spring.position.set(G.x, sp0, 0);
        // the kick solenoid round the bushing, the magnet's coil ring
        const kMat = new THREE.MeshStandardMaterial({ color: 0x2a0d12, emissive: color, emissiveIntensity: .1 });
        const kick = new THREE.Mesh(new THREE.CylinderGeometry(.15, .15, .26, 18, 1, true), kMat);
        kick.position.set(G.x, GUIDE_Y, 0);
        const mMat = new THREE.MeshStandardMaterial({ color: 0x14060a, emissive: new THREE.Color(0xff5a3c), emissiveIntensity: .1 });
        const mRing = new THREE.Mesh(new THREE.TorusGeometry(.13, .025, 8, 24), mMat);
        mRing.rotation.x = Math.PI / 2; mRing.position.set(G.x, MAG_Y + BALL_R + .02, 0);
        // the marble
        const bMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .4, roughness: .12, envMap, envMapIntensity: 1.2,
          emissive: color, emissiveIntensity: .5 });
        const ball = new THREE.Mesh(ballGeo, bMat); ball.userData.noMerge = true;
        // the contact glow on the rim
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.position.set(G.x, G.yPress - G.rs, WHEEL_Z); glow.scale.setScalar(.9);
        M.add(segA, segB, lens, tan, spring, kick, mRing, ball, glow);
        lanes.push({ note, G, L, color, segA, segB, sMat, lens, tan, spring, sp0, sp1, kMat, mMat, ball, bMat, glow,
          tail, edge: makeEdge(.25), i });
      });

      // trails + rosin dust: one Points each for the whole machine
      const mkPts = (pos, col, size) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const p = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTex, size, vertexColors: true, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
        p.frustumCulled = false; p.material.userData.noFadeGate = true; M.add(p);
        return { p, pos, col };
      };
      trail = mkPts(trailPos, trailCol, BALL_R * 5);
      dust = mkPts(dustPos, dustCol, .16);

      for (const [mat, geos] of bucket) M.add(new THREE.Mesh(mergeGeometries(geos.map(g => g.index ? g.toNonIndexed() : g)), mat));
      return group;
    }

    const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
    function seg(m, a, b, r){
      _d.subVectors(b, a); const len = _d.length();
      m.position.addVectors(a, b).multiplyScalar(.5);
      m.quaternion.setFromUnitVectors(_up, _d.multiplyScalar(1 / len));
      m.scale.set(r, len, r);
    }

    function update(songTime, P, dt, { started, skipStrikes, onStrike }){
      if (!wheel) return;
      const t = started ? songTime : start;
      const th = wheelAngle(t);
      wheel.rotation.z = th; pulA.rotation.z = th; pulM.rotation.z = th * PULLEY_AX / PULLEY_M;
      { // the belt's splice rides the belt at the rim speed of the pulleys
        const s = ((OMEGA * (PULLEY_AX + .03) * t) % belt.L + belt.L) % belt.L;
        let k = 1; while (k < belt.lens.length - 1 && belt.lens[k] < s) k++;
        const u = (s - belt.lens[k - 1]) / (belt.lens[k] - belt.lens[k - 1] || 1), A = belt.pts[k - 1], B = belt.pts[k];
        beltMk.position.set(A.x + (B.x - A.x) * u, A.y + (B.y - A.y) * u, MOTOR.z);
      }
      let bowAll = 0;
      for (const ln of lanes){
        const { G, L } = ln;
        const st = laneAt(L, t, start);
        const so = strokeAt(L, t, start);
        // the strike: the string meets the rim (note-on), once
        if (started && so.live && ln.edge.check(so.abs, so.since, skipStrikes)){
          onStrike && onStrike({ note: bucketId(ln.note, so.cyc.hold, HOLD_MAX, ladder), vel: so.cyc.vel, pos: new THREE.Vector3(G.x, G.yPress - G.rs, WHEEL_Z + zOff),
            color: ln.color.getHex(), dur: so.cyc.hold, shake: 0, sparks: 5, light: .7 });
        }
        const env = so.live && st.contact ? bowEnv(so.since, so.cyc.hold) * (.4 + .6 * so.cyc.vel) : 0;
        bowAll = Math.max(bowAll, env);
        // string: bridge → contact (deflected by s) → tail peg
        const yc = G.yRest - st.s;
        _a.set(G.x, G.yRest, ZF); _b.set(G.x, yc, WHEEL_Z); seg(ln.segA, _a, _b, G.rs);
        _a.set(G.x, G.yRest, ln.tail); seg(ln.segB, _b, _a, G.rs);
        ln.sMat.emissiveIntensity = .2 + 3.2 * env;
        // vibration hull: amplitude with the bow, shimmering (a pure fn of t)
        const shim = .55 + .45 * Math.abs(Math.sin(t * 2 * Math.PI * 23 + ln.i * 1.7));
        ln.lens.scale.x = (.012 + .04 * env) * shim + 1e-4;
        ln.lens.position.y = G.yRest - st.s * .5;
        ln.lens.material.opacity = Math.min(.8, .6 * env);
        // tangent + spring
        ln.tan.position.y = -st.s;
        ln.spring.scale.y = Math.max(.05, ln.sp1 - st.s - ln.sp0);
        // the marble
        ln.ball.position.set(G.x, st.y, 0);
        ln.bMat.emissiveIntensity = .5 + 1.6 * env;
        // kick solenoid flash (at the cycle's start), magnet coil while it holds
        const q = st.cyc;
        let kick = 0, hold = st.held ? 1 : 0;
        if (q && st.phase !== 'press' && st.phase !== 'hold'){
          const u = ((t - (q.c)) % P + P) % P;
          kick = Math.exp(-u * 14) * (u < q.F ? 1 : 0);
        }
        ln.kMat.emissiveIntensity = .1 + 3.2 * kick + .45 * env;
        ln.mMat.emissiveIntensity = .1 + 2.6 * hold;
        ln.glow.material.opacity = Math.min(1, 1.1 * env);
        ln.glow.scale.setScalar(.4 + .35 * env);

        // ghost trail: the marble's own recent past (only while it flies)
        for (let j = 0; j < TRAIL_N; j++){
          const o = 3 * (ln.i * TRAIL_N + j), tj = t - (j + 1) * TRAIL_DT;
          const sj = started && tj >= start ? laneAt(L, tj, start) : null;
          const f = sj && !sj.onCup && !sj.held && !st.onCup ? (1 - (j + 1) / (TRAIL_N + 1)) ** 1.3 * Math.min(1, Math.abs(sj.vy) / 3) : 0;
          if (sj){ trail.pos[o] = G.x; trail.pos[o + 1] = sj.y; trail.pos[o + 2] = 0; }
          trail.col[o] = ln.color.r * f; trail.col[o + 1] = ln.color.g * f; trail.col[o + 2] = ln.color.b * f;
        }
        // rosin dust: flung off the rim along its motion at the contact, a pure fn of the stroke's age
        const cx = G.x, cy = G.yPress - G.rs, tx = -Math.cos(G.phi), ty = Math.sin(G.phi);   // rim velocity direction (ω about +z)
        for (let j = 0; j < DUST_N; j++){
          const o = 3 * (ln.i * DUST_N + j);
          let k = 0;
          if (env > 0){
            const a = ((so.since + j * DUST_LIFE / DUST_N) % DUST_LIFE);
            const e = so.since - a;
            if (e >= 0 && e <= so.cyc.hold){
              const sp = 1.6 + .5 * ((j * 7) % 5) / 5, out = .5 + .3 * ((j * 3) % 4) / 4;
              const nx = Math.sin(G.phi), ny = Math.cos(G.phi);
              dust.pos[o] = cx + (tx * sp + nx * out) * a;
              dust.pos[o + 1] = cy + (ty * sp + ny * out) * a - 7.25 * a * a;
              dust.pos[o + 2] = WHEEL_Z + ((j % 3) - 1) * .18 * (.3 + a * 2);
              k = (1 - a / DUST_LIFE) ** 1.5 * (.6 + .4 * env);
            }
          }
          dust.col[o] = 1 * k; dust.col[o + 1] = .45 * k; dust.col[o + 2] = .35 * k;
        }
      }
      if (trail){
        trail.p.geometry.attributes.position.needsUpdate = true; trail.p.geometry.attributes.color.needsUpdate = true;
        dust.p.geometry.attributes.position.needsUpdate = true; dust.p.geometry.attributes.color.needsUpdate = true;
      }
      rimMat.emissiveIntensity = .02 + .08 * bowAll;
      tire.material.opacity = Math.min(1, 1.2 * bowAll);
    }

    return { build, update };
  },

  /* LAMENT in D minor — a four-bar string adagio (72 bpm), the idiom's own grammar:
     a walking-down bass (D3 · A2 · A#2 · A2) under held inner voices, a singing violin line
     with re-bowed repeats (the marble HOPS: E5, F5, A3 across the bar), and a crescendo into
     bar 3 (the Bb chord) that relaxes onto the dominant. Long rests park on the magnets.
     [beat, note, vel, durBeats] */
  demo: {
    bpm: 72, beats: 16,
    part: [
      // bass (cello / contrabass)
      [0, 'D3', .6, 3.7], [4, 'A2', .68, 3.7], [8, 'A#2', .9, 3.7], [12, 'A2', .72, 3.5],
      // viola + second violin
      [0, 'A3', .45, 3.8], [0, 'F4', .45, 3.7],
      [4, 'A3', .52, 3.6], [4, 'E4', .5, 3.7],
      [8, 'D4', .75, 3.7], [8, 'F4', .72, 3.6],
      [12, 'C#4', .6, 3.5], [12, 'E4', .58, 3.5],
      // first violin
      [0, 'A4', .55, 1], [1, 'D5', .6, 1], [2, 'F5', .62, 1.4], [3.5, 'E5', .58, .5],
      [4, 'E5', .66, 1.4], [5.5, 'D5', .62, .5], [6, 'E5', .7, 1.8],
      [8, 'F5', .9, 1.8], [10, 'D5', .85, .9], [11, 'F5', .95, 1],
      [12, 'E5', .8, 1.4], [13.5, 'D5', .7, .5], [14, 'A4', .62, 1.8],
    ],
  },
};
