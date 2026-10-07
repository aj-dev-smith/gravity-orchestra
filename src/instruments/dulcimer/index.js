import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { eventTimes, makeEdge } from '../clock.js';
import {
  fitPart, parseNote, voiceIdOf, dulcimerLane, dulcimerAt, layoutStrings, stringLen, stringR, PART_LIMITS,
  BALL_R, H, LIFT, STRIKE_U, CUP_R, SLEEVE_R, DAMP_HW, MAX_STRINGS, MAX_HOLD, A_CUP,
} from './solve.js';
import { grandVoice } from './voice.js';

/* ============================================================
   MARBLE GRAND — an open grand piano whose action is made of marbles.
   (key 'dulcimer': the hammered-string machine; it plays like a piano.)

   Each pitch owns ONE string (length a pure fn of the note — the bass
   strings copper-wound and long, the treble short and bright, so the
   case takes the grand's curved bentside on its own), ONE pearl marble
   hammer, ONE felt cup on a piston, ONE damper and ONE key. Nothing is
   shared, so chords are free and lanes can never touch (the slab rule).

   A note: the key goes down and the damper lifts off the string (its
   solenoid glows on the damper rail); the piston kicks; the marble flies
   a solved arc and meets the string from BELOW exactly on the beat, the
   1/7 point of its length (the voice's 7th-partial notch is that same
   point). A pulse of light runs out along the string from the strike and
   it SINGS (standing-wave light) for as long as the damper stays up; at
   note-off the key rises, the felt drops and the light dies. The marble
   rebounds lossy into the waiting cup, which takes it on its felt and —
   for a long gap — lowers it to the cradle floor to rest; a fast repeat
   is caught high on the repetition lever and thrown straight back up.
   All motion = solve.js dulcimerAt(t).

   PART CONSTRAINTS (import robustness — PART_LIMITS in solve.js; fitPart +
   dulcimerLane enforce them, warn, and never throw):
     · pitch range A1–C7 (MIDI 33–96); outside folds by octaves
     · ≤ 20 strings (distinct pitches): rarer pitches move an octave onto a
       same-pitch-class string, else drop
     · polyphony: lanes are independent, any chord of ≤ 8 notes per onset
       (outer voices kept, then the loudest)
     · same-pitch retrigger ≥ PART_LIMITS.gap (≈ .21 s worst case; ≈ .2 s at
       forte) — closer repeats are thinned, per string
     · ≤ 384 events per loop (the softest go first)
     · durations honoured up to 4.5 s (the damper); dur 0 rings 1 s
     · note ids: 'C4' piano, 'C4:e' tine e-piano timbre (same machine)
   ============================================================ */

const SIGNATURE = '#a9b8ff';             // pearl periwinkle (bells gold, bass teal, musicbox ice-cyan are taken)
const LOW_C = 0xc7b0ff, HIGH_C = 0xa6d2ff; // string-light: lavender pearl (bass) → ice pearl (treble)
const PEARL = 0xdfe6ff;
const Y_CR = 2.35;                       // world y of the cradle floor (ball centre at rest)
const Y_SB = Y_CR + H + BALL_R;          // every string's BOTTOM line (contact height + the marble)
const CASE_Y0 = .9;                      // case floor
const SIDE = .4;                        // bed edge → case side
const TAIL = .55;                        // speaking end → hitch pin
const KEY_L = 1.25, KEY_DIP = .14;         // key length, dip (rad) when held
const TRAIL_N = 3, TRAIL_DT = .022;
const PULSE_V = 9;                       // u/s — the strike's light running along the string
const DAMP_BACK = 1.95;                  // every damper sits this far behind the front posts

export default {
  key: 'dulcimer',
  label: 'Marble Grand',
  wet: true,
  lookHeight: 3.2,
  camera: { dist: 12.5, up: 8.2, x: 3.2 },
  color: SIGNATURE,

  voice: id => grandVoice(id),
  voiceIds(part){
    const { part: fit } = fitPart(part);
    return [...new Set(fit.map(e => { const p = parseNote(e[1]); return voiceIdOf(p.m, p.ep, e[2]); }))];
  },

  make({ envMap, glowTex }){
    let lanes = [], start = -Infinity, rig = null;

    function build(part, { rollT, beat, P, start: s0 = -Infinity, station, floorY = -20 }){
      const group = new THREE.Group();
      lanes = []; start = s0; rig = null;
      const W = station?.w ?? 11.6, D = station?.d ?? 10;
      const { part: fit, warnings } = fitPart(part, { maxDurBeats: MAX_HOLD / beat });
      // one lane per pitch (the ':e' timbre flag rides on each strike's voice id)
      const ev = eventTimes(fit, { rollT, beat });
      const byM = new Map();
      for (const e of ev){ const p = parseNote(e.note); (byM.get(p.m) || byM.set(p.m, []).get(p.m)).push({ ...e, m: p.m, id: voiceIdOf(p.m, p.ep, e.vel) }); }
      const ms = [...byM.keys()].sort((a, b) => a - b).slice(0, MAX_STRINGS);
      const n = ms.length;
      if (!n) return group;
      let dropped = 0;

      // ---- the bed: lane x (low → high), string lengths from the note alone ----
      const Z_F = D / 2 - 2.15;                         // the front agraffe posts
      const { xs, SP } = layoutStrings(n, W - 2 * (SIDE + .35));
      const xL = xs[0] - SIDE, xR = xs[n - 1] + SIDE;
      const lens = ms.map(stringLen), rads = ms.map(stringR);
      const zEnd = lens.map(l => Z_F - l);             // speaking end (on the bridge)
      const Z_D = Z_F - DAMP_BACK, Z_SB = Z_D - .45;   // dampers; the soundboard's front edge
      const hiK = k => n > 1 ? k / (n - 1) : .5;
      const colOf = k => new THREE.Color(LOW_C).lerp(new THREE.Color(HIGH_C), hiK(k));

      // ---- materials (a fixed set) ----
      const lacquer = new THREE.MeshStandardMaterial({ color: 0x0b0c12, metalness: .35, roughness: .16, envMap, envMapIntensity: 1.1 });
      const pewter  = new THREE.MeshStandardMaterial({ color: 0x9aa0ae, metalness: 1, roughness: .3, envMap, envMapIntensity: 1.2 });
      const chrome  = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: .14, envMap, envMapIntensity: 1.3 });
      const dark    = new THREE.MeshStandardMaterial({ color: 0x232733, metalness: .7, roughness: .45, envMap });
      const spruce  = new THREE.MeshStandardMaterial({ color: 0xc08e58, metalness: 0, roughness: .5, envMap, envMapIntensity: .5, side: THREE.DoubleSide,
        emissive: new THREE.Color(0x6a3c18), emissiveIntensity: .35 });   // warm spruce under cool pearl strings
      const bridgeW = new THREE.MeshStandardMaterial({ color: 0x5b3a21, metalness: 0, roughness: .45, envMap, envMapIntensity: .4 });
      const felt    = new THREE.MeshStandardMaterial({ color: 0xe8dcc4, metalness: 0, roughness: .9, envMap, envMapIntensity: .5,
        emissive: new THREE.Color(0x3a3226), emissiveIntensity: .5 });
      const trim    = new THREE.MeshStandardMaterial({ color: 0x10121c, emissive: new THREE.Color(PEARL), emissiveIntensity: 1.1 });
      const keyM    = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: .26, envMap, envMapIntensity: .55 });
      const ballM   = new THREE.MeshPhysicalMaterial({ color: 0xf2efff, metalness: .1, roughness: .12, clearcoat: 1, clearcoatRoughness: .06,
        iridescence: .85, iridescenceIOR: 1.45, iridescenceThicknessRange: [180, 520], envMap, envMapIntensity: 1.5,
        emissive: new THREE.Color(0x8c9cd8), emissiveIntensity: .06 });

      const fz = m => { m.userData.frozen = true; return m; };
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const add = (m, p = group) => (p.add(m), m);
      const box = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return add(fz(m)); };
      const bar = (a, b, r, mat, seg = 12) => {
        const d = new THREE.Vector3().subVectors(b, a), len = d.length();
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
        m.position.copy(a).addScaledVector(d, .5);
        m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
        return add(fz(m));
      };

      // ---- the case outline (plan view): straight spine (bass side), the bentside curve that
      //      the string ends draw on their own, a straight treble cheek; open at the front ----
      const zBackL = zEnd[0] - TAIL - .35, zBackR = zEnd[n - 1] - TAIL - .35;
      const bent = new THREE.CatmullRomCurve3([V(xL, 0, zBackL), ...xs.map((x, k) => V(x, 0, zEnd[k] - TAIL - .35)), V(xR, 0, zBackR)],
        false, 'centripetal').getPoints(Math.max(24, n * 3));
      const ZC = Z_F + .45;                            // the case's front (the keybed)
      const outline = [V(xL, 0, ZC), ...bent, V(xR, 0, ZC)];
      const RIM_T = .22, RIM_TOP = Y_SB - .38;

      // plinth + legs to the room floor + three stubby lacquered piano legs
      const PL = .3;
      const pz0 = Math.min(zBackL, zBackR) - .3, pz1 = ZC + 1.55, pxl = xL - .3, pxr = xR + .3;
      box(pxr - pxl, PL, pz1 - pz0, (pxl + pxr) / 2, PL / 2, (pz0 + pz1) / 2, dark);
      for (const [x0, z0, x1, z1] of [[pxl, pz1, pxr, pz1], [pxl, pz0, pxr, pz0], [pxl, pz0, pxl, pz1], [pxr, pz0, pxr, pz1]])
        bar(V(x0, PL + .01, z0), V(x1, PL + .01, z1), .028, trim, 6);
      const legH = -floorY;
      if (legH > .6) for (const [x, z] of [[pxl + .5, pz1 - .5], [pxr - .5, pz1 - .5], [pxl + .5, pz0 + .5], [pxr - .5, pz0 + .5]])
        box(.7, legH, .7, x, -legH / 2, z, dark);
      for (const [x, z] of [[xL + .7, ZC - .6], [xR - .7, ZC - .6], [xL + 1.4, (zBackL + Z_SB) / 2]]){
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(.34, .24, CASE_Y0 - PL, 18), lacquer);
        leg.position.set(x, (CASE_Y0 + PL) / 2, z); add(fz(leg));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.3, .025, 6, 24).rotateX(Math.PI / 2), trim);
        ring.position.set(x, CASE_Y0 - .12, z); add(fz(ring));
      }
      // the case floor + rim walls (segment boxes along the outline) + a pearl line along the top
      const shapeOf = pts => { const s = new THREE.Shape(); pts.forEach((p, i) => i ? s.lineTo(p.x, -p.z) : s.moveTo(p.x, -p.z)); s.closePath(); return s; };
      const flat = (pts, y, mat) => { const gm = new THREE.ShapeGeometry(shapeOf(pts)).rotateX(-Math.PI / 2); const m = new THREE.Mesh(gm, mat); m.position.y = y; return add(fz(m)); };
      flat(outline, CASE_Y0, lacquer);
      for (let i = 0; i + 1 < outline.length; i++){
        const a = outline[i], b = outline[i + 1];
        const front = i === 0 || i === outline.length - 2;
        const top = RIM_TOP, d = new THREE.Vector3().subVectors(b, a), len = d.length();
        if (len < 1e-6) continue;
        const nrm = V(-d.z, 0, d.x).normalize().multiplyScalar(-RIM_T / 2);   // outward
        const m = new THREE.Mesh(new THREE.BoxGeometry(RIM_T, top - CASE_Y0, len + RIM_T * (front ? 0 : .9)), lacquer);
        m.position.set((a.x + b.x) / 2 + nrm.x, (top + CASE_Y0) / 2, (a.z + b.z) / 2 + nrm.z);
        m.rotation.y = Math.atan2(d.x, d.z);
        add(fz(m));
      }
      // the low front: keybed + key slip, under the keys
      box(xR - xL + RIM_T * 2, 1.0, 1.9, (xL + xR) / 2, 1.45, ZC + .6, lacquer);
      bar(V(xL - RIM_T, 1.96, ZC + 1.55), V(xR + RIM_T, 1.96, ZC + 1.55), .03, trim, 6);
      const rimLine = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(outline.map(p => V(p.x, RIM_TOP + .01, p.z)), false, 'centripetal'),
        Math.max(48, outline.length * 2), .035, 6), trim);
      add(fz(rimLine));

      // the soundboard (behind the action bay), its bridge (where every speaking length ends),
      // the pewter plate: hitch rail on the bentside, spine + cheek bars
      const sbPts = [V(xL + .05, 0, Z_SB), ...bent.map(p => V(Math.min(xR - .05, Math.max(xL + .05, p.x)), 0, p.z + .08)).filter(p => p.z < Z_SB - .05), V(xR - .05, 0, Z_SB)];
      flat(sbPts, Y_SB - .62, spruce);
      const ridge = (pts, r, mat, seg = 6) => add(fz(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), Math.max(24, pts.length * 4), r, seg), mat)));
      const bridgePts = xs.map((x, k) => V(x, Y_SB - .2, zEnd[k]));
      if (n > 1) ridge([V(xs[0] - .25, Y_SB - .2, zEnd[0]), ...bridgePts, V(xs[n - 1] + .25, Y_SB - .2, zEnd[n - 1])], .2, bridgeW, 8);
      const hitchPts = xs.map((x, k) => V(x, Y_SB - .16, zEnd[k] - TAIL));
      if (n > 1) ridge([V(xL + .1, Y_SB - .16, zBackL + .3), ...hitchPts, V(xR - .1, Y_SB - .16, zBackR + .3)], .13, pewter, 8);
      bar(V(xL + .12, Y_SB - .3, ZC - .2), V(xL + .12, Y_SB - .3, zBackL + .35), .1, pewter);
      bar(V(xR - .12, Y_SB - .3, ZC - .2), V(xR - .12, Y_SB - .3, zBackR + .35), .1, pewter);

      // the front termination: one slender pewter AGRAFFE BAR the strings bear on (low profile —
      // the action under it must read from the front), on two end posts; hitch pins at the back
      const yAg = Y_SB - .055;
      bar(V(xL + .05, yAg, Z_F), V(xR - .05, yAg, Z_F), .055, pewter);
      bar(V(xL + .05, yAg + .07, Z_F + .04), V(xR - .05, yAg + .07, Z_F + .04), .014, trim, 6);
      for (const x of [xL + .12, xR - .12]) bar(V(x, RIM_TOP, Z_F), V(x, yAg, Z_F), .07, pewter);
      const pinGeo = new THREE.CylinderGeometry(.035, .035, .34, 8);
      xs.forEach((x, k) => { const pin = new THREE.Mesh(pinGeo, chrome); pin.position.set(x, Y_SB - .25, zEnd[k] - TAIL); add(fz(pin)); });

      // ---- the STRINGS: one merged mesh, one shader; per-lane vibration + light from uniform arrays ----
      const sGeos = xs.map((x, k) => {
        const len = lens[k], full = len + TAIL + .1, r = rads[k];
        const gm = new THREE.CylinderGeometry(r, r, full, 8, Math.max(24, Math.round(full * 7)), true).rotateX(Math.PI / 2);
        gm.translate(x, Y_SB + r, Z_F + .05 - full / 2);
        const pos = gm.attributes.position, cnt = pos.count;
        const aU = new Float32Array(cnt), aLane = new Float32Array(cnt).fill(k), aLen = new Float32Array(cnt).fill(len), col = new Float32Array(cnt * 3);
        const c = ms[k] < 48 ? new THREE.Color(0xd9925a) : new THREE.Color(0xe9ecf4);   // copper-wound bass, steel above
        for (let i = 0; i < cnt; i++){ aU[i] = (Z_F - pos.getZ(i)) / len; col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b; }
        gm.setAttribute('aU', new THREE.BufferAttribute(aU, 1));
        gm.setAttribute('aLane', new THREE.BufferAttribute(aLane, 1));
        gm.setAttribute('aLen', new THREE.BufferAttribute(aLen, 1));
        gm.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return gm;
      });
      const strU = {
        uDisp: { value: new Float32Array(MAX_STRINGS) }, uSing: { value: new Float32Array(MAX_STRINGS) },
        uHot: { value: new Float32Array(MAX_STRINGS).fill(99) }, uAmp: { value: new Float32Array(MAX_STRINGS) },
        uCol: { value: Array.from({ length: MAX_STRINGS }, (_, k) => k < n ? colOf(k) : new THREE.Color()) },
      };
      const strM = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 1, roughness: .22, envMap, envMapIntensity: 1.4 });
      const f4 = x => x.toFixed(4);
      strM.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, strU);
        sh.vertexShader = `attribute float aU; attribute float aLane; attribute float aLen;
uniform float uDisp[${MAX_STRINGS}]; uniform float uSing[${MAX_STRINGS}]; uniform float uHot[${MAX_STRINGS}]; uniform float uAmp[${MAX_STRINGS}]; uniform vec3 uCol[${MAX_STRINGS}];
varying float vU; varying float vLen; varying float vSing; varying float vHot; varying float vAmp; varying vec3 vCol;
` + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          int li = int(aLane + .5);
          float sh0 = (aU > 0. && aU < 1.) ? sin(3.14159265 * aU) : 0.;
          transformed.y += uDisp[li] * sh0;
          vU = aU; vLen = aLen; vSing = uSing[li]; vHot = uHot[li]; vAmp = uAmp[li]; vCol = uCol[li];`);
        sh.fragmentShader = `varying float vU; varying float vLen; varying float vSing; varying float vHot; varying float vAmp; varying vec3 vCol;
` + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float dd = abs(vU - ${f4(STRIKE_U)}) * vLen;
          float speak = step(0., vU) * step(vU, 1.);
          float pulse = exp(-pow((dd - ${PULSE_V.toFixed(1)} * vHot) / .55, 2.)) * exp(-vHot * 2.4);
          float flash = exp(-pow(dd / .32, 2.)) * exp(-vHot * 9.);
          float stand = pow(abs(sin(3.14159265 * 3. * vU)), 2.);
          totalEmissiveRadiance += vCol * (vAmp * (7. * pulse + 12. * flash) * (.35 + .65 * speak) + vSing * speak * (.25 + .75 * stand) * 3.2);`);
      };
      const strings = add(new THREE.Mesh(mergeGeometries(sGeos), strM));
      sGeos.forEach(gm => gm.dispose());
      strings.frustumCulled = false;

      // ---- per-lane moving parts: instanced (one draw each) ----
      const inst = (geo, mat, count = n) => { const m = new THREE.InstancedMesh(geo, mat, count); m.frustumCulled = false; m.userData.noMerge = true; return add(m); };
      const balls = inst(new THREE.SphereGeometry(BALL_R, 28, 20), ballM);
      const cupGeo = mergeGeometries([
        new THREE.CylinderGeometry(CUP_R, CUP_R * .8, .1, 22).translate(0, -.05, 0),          // the felt seat (top at the ball's bottom)
        new THREE.TorusGeometry(CUP_R - .03, .035, 6, 22).rotateX(Math.PI / 2).translate(0, .02, 0),   // its rim
      ]);
      const cups = inst(cupGeo, felt);
      const ROD_L = 2.0;
      const rods = inst(new THREE.CylinderGeometry(.06, .06, ROD_L, 10).translate(0, -.1 - ROD_L / 2, 0), chrome);
      const DF_H = .2, DB_H = .2, WIRE_L = LIFT + .62;
      const dFelt = inst(new THREE.BoxGeometry(2 * DAMP_HW, DF_H, .34).translate(0, DF_H / 2, 0), felt);
      const dBlock = inst(new THREE.BoxGeometry(2 * DAMP_HW - .04, DB_H, .3).translate(0, DF_H + DB_H / 2, 0), lacquer);
      const dWire = inst(new THREE.CylinderGeometry(.022, .022, WIRE_L, 6).translate(0, DF_H + DB_H + WIRE_L / 2, 0), chrome);
      const keyHW = Math.min(SP / 2 - .025, .42);
      const keys = inst(new THREE.BoxGeometry(2 * keyHW, .16, KEY_L).translate(0, .08, KEY_L / 2), keyM);

      // static per-lane parts: piston sleeves (+ a dark collar), the damper rail's guides
      const SLV_TOP = Y_CR - BALL_R - .12;
      const yRail = Y_SB + .14 + DF_H + DB_H + LIFT + .55;
      // the sleeves run down through the case floor and are seated in the plinth: the rod's full
      // stroke (C_TOP above the floor) is longer than the case is deep, so at rest its foot sits
      // below the case floor — always inside its sleeve, never a bare rod hanging under the case
      const sleeveGeo = new THREE.CylinderGeometry(SLEEVE_R * .62, SLEEVE_R * .62, SLV_TOP - PL, 14);
      const collarGeo = new THREE.CylinderGeometry(SLEEVE_R, SLEEVE_R, .12, 18);
      const zStrike = lens.map(l => Z_F - l * STRIKE_U);
      xs.forEach((x, k) => {
        const s = new THREE.Mesh(sleeveGeo, chrome); s.position.set(x, (SLV_TOP + PL) / 2, zStrike[k]); add(fz(s));
        const c = new THREE.Mesh(collarGeo, dark); c.position.set(x, SLV_TOP - .06, zStrike[k]); add(fz(c));
      });
      bar(V(xL - .05, yRail, Z_D), V(xR + .05, yRail, Z_D), .07, chrome);
      bar(V(xL - .05, yRail + .1, Z_D + .05), V(xR + .05, yRail + .1, Z_D + .05), .02, trim, 6);
      for (const x of [xL - .05, xR + .05]) bar(V(x, RIM_TOP, Z_D), V(x, yRail + .1, Z_D), .09, dark);
      const guideGeo = new THREE.CylinderGeometry(.08, .08, .16, 12);
      xs.forEach(x => { const gd = new THREE.Mesh(guideGeo, dark); gd.position.set(x, yRail, Z_D); add(fz(gd)); });

      // ---- glows: Points (one draw each) — ball halos, ghost trails, lamps (sleeve kick + damper solenoid) ----
      const pts = (count, size) => {
        const gm = new THREE.BufferGeometry();
        gm.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        gm.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        const m = new THREE.Points(gm, new THREE.PointsMaterial({ map: glowTex, size, sizeAttenuation: true, vertexColors: true,
          transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        m.frustumCulled = false;
        return add(m);
      };
      const halo = pts(n, 1.25), trail = pts(n * TRAIL_N, .7), lamp = pts(2 * n, .6);
      xs.forEach((x, k) => {
        lamp.geometry.attributes.position.setXYZ(k, x, SLV_TOP + .02, zStrike[k]);
        lamp.geometry.attributes.position.setXYZ(n + k, x, yRail + .2, Z_D);
      });

      // ---- lanes ----
      ms.forEach((m, k) => {
        const evs = byM.get(m);
        const lane = dulcimerLane(evs.map(e => ({ t: e.t, vel: e.vel, hold: e.tDur, id: e.id })), P, { m });
        dropped += lane.dropped;
        const col = colOf(k);
        lanes.push({ k, m, lane, x: xs[k], r: rads[k], zs: zStrike[k], col, edge: makeEdge(.25),
                     contact: V(xs[k], Y_SB, zStrike[k]), shake: m < 45 });
      });
      if (dropped) warnings.push(`${dropped} same-string repeat${dropped > 1 ? 's' : ''} faster than ${PART_LIMITS.gap}s thinned`);
      if (warnings.length) console.warn('[dulcimer]', warnings.join(' · '));
      rig = { balls, cups, rods, dFelt, dBlock, dWire, keys, halo, trail, lamp, strU, Z_F, Z_D, ZC, n };
      lanes.forEach(ln => { ln.keyC = new THREE.Color([1, 3, 6, 8, 10].includes(ln.m % 12) ? 0x17181e : 0xf2eee4); keys.setColorAt(ln.k, ln.keyC); });
      freeze(group);
      update(start, P, 0, { started: false });           // pose the ARMED rig (the built bounds read it)
      return group;
    }

    const _o = new THREE.Object3D(), _c = new THREE.Color();
    const setI = (mesh, k, x, y, z, rx = 0) => { _o.position.set(x, y, z); _o.rotation.set(rx, 0, 0); _o.updateMatrix(); mesh.setMatrixAt(k, _o.matrix); };

    function update(songTime, P, dt, { started, skipStrikes, onStrike } = {}){
      if (!rig) return;
      const t = started ? songTime : start;
      const { balls, cups, rods, dFelt, dBlock, dWire, keys, halo, trail, lamp, strU, Z_F, Z_D, ZC, n } = rig;
      const hp = halo.geometry.attributes.position, hc = halo.geometry.attributes.color;
      const tp = trail.geometry.attributes.position, tc = trail.geometry.attributes.color;
      const lc = lamp.geometry.attributes.color;
      for (const ln of lanes){
        const { k, lane, x, zs } = ln;
        const s = dulcimerAt(lane, t, start);
        const vel = s.armed ? 0 : lane.vel[s.i];

        if (started && !s.armed && ln.edge.check(s.abs, s.since, skipStrikes)){
          onStrike && onStrike({ note: lane.ids[s.i], vel, pos: ln.contact.clone(), color: ln.col.getHex(), dur: lane.hold[s.i],
            shake: ln.shake ? .015 + .025 * vel : 0, sparks: Math.round(3 + 6 * vel), light: .7 + .6 * vel });
        }

        // marble, cup + piston rod
        const yb = Y_CR + s.y;
        setI(balls, k, x, yb, zs);
        setI(cups, k, x, Y_CR + s.cup - BALL_R, zs);
        setI(rods, k, x, Y_CR + s.cup - BALL_R, zs);
        // damper (its felt rests ON the string top) + key (held down while the damper is up)
        const yD = Y_SB + 2 * ln.r + LIFT * s.damp;
        setI(dFelt, k, x, yD, Z_D); setI(dBlock, k, x, yD, Z_D); setI(dWire, k, x, yD, Z_D);
        setI(keys, k, x, 1.95, ZC + .02, KEY_DIP * s.damp);
        keys.setColorAt(k, _c.copy(ln.keyC).lerp(ln.col, .6 * s.damp));

        // the string's motion + light
        strU.uDisp.value[k] = s.vib;
        strU.uSing.value[k] = s.armed ? 0 : s.sing * (.45 + .55 * vel);
        strU.uHot.value[k] = s.armed ? 99 : s.since;
        strU.uAmp.value[k] = s.armed ? 0 : .4 + .6 * vel;

        // halo: the marble flashes pearl at the strike, a faint glow otherwise
        const age = s.armed ? 99 : s.since;
        hp.setXYZ(k, x, yb, zs);
        const hI = .05 + 1.6 * vel * Math.exp(-age * 12);
        hc.setXYZ(k, ln.col.r * hI, ln.col.g * hI, ln.col.b * hI);
        // lamps: the piston sleeve blazes while it kicks (the energy going in); the damper's solenoid while it holds
        const kick = s.seated && s.cupA > 0 && s.phase === 'kick' ? Math.min(1, s.cupA / (A_CUP * .45)) : 0;
        const catchF = s.phase === 'catch' && s.seated ? Math.min(1, s.cupA / A_CUP) * .5 : 0;
        const kI = .03 + 1.3 * kick + catchF;
        lc.setXYZ(k, ln.col.r * kI, ln.col.g * kI, ln.col.b * kI);
        const dI = .9 * s.damp;                       // the damper's solenoid: lit exactly while it holds the felt up
        lc.setXYZ(n + k, ln.col.r * dI, ln.col.g * dI, ln.col.b * dI);
        // ghost trail of the marble (re-sampled from the pure fn: scrub-safe)
        const speed = Math.min(1, Math.abs(s.vy) / 5);
        for (let j = 0; j < TRAIL_N; j++){
          const q = k * TRAIL_N + j, tj = t - (j + 1) * TRAIL_DT;
          if (!started || tj < start || speed < .1 || s.seated){ tc.setXYZ(q, 0, 0, 0); continue; }
          const sj = dulcimerAt(lane, tj, start);
          tp.setXYZ(q, x, Y_CR + sj.y, zs);
          const f = (1 - (j + 1) / (TRAIL_N + 1)) * .35 * speed;
          tc.setXYZ(q, ln.col.r * f, ln.col.g * f, ln.col.b * f);
        }
      }
      for (const m of [balls, cups, rods, dFelt, dBlock, dWire, keys]) m.instanceMatrix.needsUpdate = true;
      keys.instanceColor.needsUpdate = true;
      hp.needsUpdate = hc.needsUpdate = tp.needsUpdate = tc.needsUpdate = lc.needsUpdate = true;
      lamp.geometry.attributes.position.needsUpdate = true;
    }

    return { build, update };
  },

  /* Demo: an 8-bar pop-piano phrase in C over the solo spine (C3 / G3, a bar each):
     a sustained left hand under a rolling right-hand arpeggio → syncopated block comping
     (the repetition lever, chords firing together) → a melody over held chords → a rolled
     G chord → F-over-C 16th arpeggio (a cascade across the bed) → staccato G7 eighths →
     the melody resolves → a full-range rolled G that rings to the loop seam. */
  demo: {
    bpm: 92, beats: 32,
    part: (() => {
      const p = [];
      const N = (b, note, v, d) => p.push([b, note, v, d]);
      // bar 1 — C: low C held, rolling arpeggio
      N(0, 'C2', .8, 4); N(0, 'C3', .6, 4);
      ['G3', 'C4', 'E4', 'G4', 'C5', 'G4', 'E4', 'C4'].forEach((n, i) => N(i * .5, n, .5 + (i === 4 ? .25 : 0), 1.6));
      // bar 2 — G/B: syncopated block chords (1, 2, 2&, 3&, 4)
      N(4, 'G2', .75, 4);
      [[4, .8, .45], [5, .6, .3], [5.5, .7, .3], [6.5, .75, .45], [7, .65, .8]].forEach(([b, v, d]) => ['D4', 'G4', 'B4'].forEach(n => N(b, n, v, d)));
      // bar 3 — Am: melody over a held chord
      N(8, 'A2', .8, 2); N(10, 'C3', .6, 2);
      ['C4', 'E4', 'A4'].forEach(n => N(8, n, .55, 2));
      N(8, 'E5', .85, 1.4); N(9.5, 'D5', .7, .5); N(10, 'C5', .75, 1); N(11, 'B4', .7, 1);
      ['C4', 'E4'].forEach(n => N(10, n, .5, 2));
      // bar 4 — G: a rolled chord, then a pickup
      N(12, 'G2', .85, 4);
      ['G3', 'B3', 'D4', 'G4', 'B4'].forEach((n, i) => N(12 + i * .125, n, .6 + i * .05, 3.4));
      N(15, 'D5', .65, .45); N(15.5, 'B4', .6, .45);
      // bar 5 — F/C: a 16th-note cascade up the bed, then the top chord
      N(16, 'C2', .8, 4); N(16, 'C3', .65, 4);
      ['C4', 'F4', 'A4', 'C5', 'F5'].forEach((n, i) => N(16 + i * .25, n, .5 + i * .06, 1.9));
      ['A4', 'C5', 'F5'].forEach(n => N(18, n, .75, 1.8));
      // bar 6 — G7: staccato eighths (the repetition lever), then the turn
      N(20, 'G2', .8, 2); N(22, 'G2', .7, 2);
      [20, 20.5, 21, 21.5].forEach((b, i) => ['F4', 'B4', 'D5'].forEach(n => N(b, n, .55 + .1 * (i % 2 ? 0 : 1), .26)));
      ['G4', 'B4', 'D5', 'F5'].forEach(n => N(22, n, .8, .9));
      ['G4', 'B4', 'D5'].forEach(n => { N(23, n, .6, .4); N(23.5, n, .65, .4); });
      // bar 7 — C: the melody resolves
      N(24, 'C2', .85, 4); N(24, 'C3', .65, 4);
      ['E4', 'G4'].forEach(n => N(24, n, .5, 2));
      N(24, 'E5', .85, 1.4); N(25.5, 'G5', .7, .5); N(26, 'C6', .9, 2);
      ['F4', 'A4'].forEach(n => N(26, n, .5, 1)); ['E4', 'G4'].forEach(n => N(27, n, .5, 1));
      // bar 8 — a full-range rolled G, ringing to the seam
      ['G2', 'G3', 'B3', 'D4', 'G4', 'B4', 'D5', 'G5'].forEach((n, i) => N(28 + i * .11, n, .55 + i * .05, 3.6 - i * .11));
      return p;
    })(),
  },
};

/* ---- static structure → ONE mesh per material (bells' freeze). ---- */
function freeze(group){
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert(), byMat = new Map(), dead = [];
  group.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || !o.userData.frozen) return;
    const gm = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const k of Object.keys(gm.attributes)) if (!['position', 'normal', 'uv'].includes(k)) gm.deleteAttribute(k);
    if (!gm.attributes.uv) gm.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(gm.attributes.position.count * 2), 2));
    (byMat.get(o.material) || byMat.set(o.material, []).get(o.material)).push(gm.index ? gm.toNonIndexed() : gm);
    dead.push(o);
  });
  for (const o of dead){ o.parent.remove(o); }
  for (const [mat, geos] of byMat){
    const merged = mergeGeometries(geos, false);
    geos.forEach(gm => gm.dispose());
    if (merged) group.add(new THREE.Mesh(merged, mat));
  }
}
