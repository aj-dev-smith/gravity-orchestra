import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { eventTimes, lanesByNote, makeEdge } from '../clock.js';
import { noteNum } from '../../engine.js';
import { hornLane, hornAt, heldRest, fitPart, voiceIdOf, isStab, PART_LIMITS, HOLD_MAX, BALL_R, H } from './solve.js';
import { layoutHorns, DECK, BW, Z_B, Z_H, Y_LID, Y_C, Y_MAG, MAG_R, MAG_H, Y_BEAM, TILT, FLEX, RIM_R, SLIDE_TOP, SLIDE_X, SLIDE_Z, VALVE_Y0, VALVE_DY } from './layout.js';
import { hornVoice } from './voice.js';
import { restEnv, anticip, sway } from '../idle.js';
import { bucketId, planLadder, allBucketIds } from '../sustain.js';

/* every strike's [voice base, hold s] at this tempo — the build's own fit and lane solve (hold =
   holdFor(dur, beat, gap)), shared with voiceIds so the duration buckets planned from it match */
function hornPairs(fit, { rollT, beat, P }){
  const byNote = lanesByNote(eventTimes(fit, { rollT, beat }));
  const pairs = [];
  for (const note of Object.keys(byNote)){
    const evs = byNote[note], lane = hornLane(evs.map(e => e.t), evs.map(e => e.vel), evs.map(e => e.dur), P, { beat });
    lane.plan.forEach((p, i) => pairs.push([voiceIdOf(note, lane.dur[i]), p.h]));
  }
  return pairs;
}
/* a held note fires its DURATION BUCKET ('C4~0.5' / '~1' / '~2' — ../sustain.js: the exhale baked
   into the iOS sample); a stab ('stab:C4') is already short, and keeps its id */
const strikeId = (base, h, ladder) => base.startsWith('stab:') ? base : bucketId(base, h, HOLD_MAX, ladder);
const hornLadder = pairs => planLadder(pairs.filter(([b]) => !b.startsWith('stab:')), () => HOLD_MAX);

/* ============================================================
   BELLOWS HORNS — a brass section played by gravity.

   A rank of brass horns stands across the deck, low → high: tubas with
   great flared bells at the left, trombones (their slides set to the REAL
   slide position of the note), trumpets at the right (their REAL fingering
   held down while they speak). Every horn is blown by its own BELLOWS, and
   every bellows has its own marble hanging on an electromagnet above it.

   The coil cuts; the marble falls onto the bellows lid exactly on the beat
   (the lid at rest on its stop). Its weight drives the lid down for the
   note's whole duration — the air visibly running out of the bellows and
   through the horn (a stab slams the lid; a long note sinks it slowly). At
   note-off the return ram snaps the lid up and lobs the marble back to its
   magnet (arriving at zero speed) or, for a quick repeat, on a lower solved
   arc straight back onto the beat. The bell glows with the breath and flares;
   a stab throws a shock-ring out of the mouth. All motion = solve.js hornAt(t).

   PART CONSTRAINTS (solve.js PART_LIMITS — what an imported part is fitted to):
   · one horn per PITCH, ≤ 12 pitches (the rarest beyond fold onto a kept horn of
     the same pitch class, else drop) — polyphony is free across horns (lanes never
     interact); a section of 3–4 is the sweet spot, tutti chords of 8+ are honest
   · range E2 … D6 (MIDI 40–86); outside is octave-folded in
   · same-pitch retrigger ≥ MIN_GAP (.18 s): closer repeats are thinned (louder kept)
   · held notes speak .06 … 2.6 s (longer clamp to 2.6); durBeats ≤ .5 (or none) is a
     STAB — its own short accented voice (`stab:<note>`), ≤ .2 s of lid travel
   · ≤ 320 events (the quietest beyond are dropped)
   Never crashes on junk: bad events are skipped (fitPart).
   ============================================================ */

const AMBER    = 0xffa21f;          // signature: the brass breath-glow
const AMBER_HOT= 0xffe2a0;
const COIL     = 0xa58cff;          // magnets + rams: cool violet energy (the brass is warm)
const LEATHER  = 0x3b2418;
const NP       = 4;                 // pleat frames per bellows
const RING_T   = .34;               // the stab shock-ring's flight (s)
// IDLE (../idle.js): while a lane's marble hangs on its magnet the bellows BREATHE — the return
// ram eases the lid a few cm below its stop and back (slow, one lane after another down the
// rank), the coil + ram collar humming with it; the coil swells as the release nears. Zero within
// .2 s of the catch and of the release: the lid is on its stop long before the marble lands.
const BREATH_A = .04, BREATH_HZ = .3;

export default {
  key: 'horns',
  label: 'Bellows Horns',
  wet: true,
  lookHeight: 4.6,
  camera: { dist: 16, up: 3.4 },
  color: '#ffa21f',

  voice: id => hornVoice(id),
  /* ids = the pitch's duration bucket ('C4~1', held) or 'stab:<pitch>'. Given the tempo (main passes
     {beat, rollT, P, loopBeats}) this is EXACTLY the build's fit + lane holds (its same-pitch thinning
     is in seconds); without it, the same fit minus thinning (octave folds + horn merges; thinning
     only drops, so it is a superset) with every rung of every held pitch */
  voiceIds(part, { beat, rollT = 2.6, P, loopBeats = Infinity } = {}){
    if (beat > 0 && P > 0){
      const pairs = hornPairs(fitPart(part, { beat, loopBeats }), { rollT, beat, P }), ladder = hornLadder(pairs);
      return [...new Set(pairs.map(([b, h]) => strikeId(b, h, ladder)))];
    }
    const fit = beat > 0 ? fitPart(part, { beat, loopBeats }) : fitPart(part, { limits: { ...PART_LIMITS, gap: 0 } });
    const bases = [...new Set(fit.map(e => voiceIdOf(e[1], e[3])))];
    return [...bases.filter(b => b.startsWith('stab:')), ...allBucketIds(bases.filter(b => !b.startsWith('stab:')), () => HOLD_MAX)];
  },

  make({ envMap, glowTex }){
    let lanes = [], start = -Infinity, S = 1, ladder = [];
    const instB = { body: null, pleat: null };

    function build(part, { rollT, beat, P, start: s0 = -Infinity, station, floorY = -20, loopBeats = Infinity }){
      const group = new THREE.Group();
      lanes = []; start = s0;
      const W = station?.w ?? 15, D = station?.d ?? 8;
      const fit = fitPart(part, { beat, loopBeats });
      const byNote = lanesByNote(eventTimes(fit, { rollT, beat }));
      const notes = Object.keys(byNote).sort((a, b) => noteNum(a) - noteNum(b));
      const n = notes.length;
      if (!n) return group;
      ladder = hornLadder(hornPairs(fit, { rollT, beat, P }));   // the part's duration buckets (voiceIds plans the same)

      const Lo = layoutHorns(notes, W);
      S = Lo.scale;
      const bed = new THREE.Group(); bed.scale.setScalar(S); group.add(bed);
      const half = Lo.total / 2;

      // ---- materials (constant count after build) ----
      const brass  = new THREE.MeshStandardMaterial({ color: 0xe0b060, metalness: 1, roughness: .2, envMap, envMapIntensity: 1.5 });
      const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: .14, envMap, envMapIntensity: 1.3 });
      const dark   = new THREE.MeshStandardMaterial({ color: 0x232733, metalness: .7, roughness: .45, envMap });
      const iron   = new THREE.MeshStandardMaterial({ color: 0x171a23, metalness: .8, roughness: .35, envMap });
      const trim   = new THREE.MeshStandardMaterial({ color: 0x2a1604, emissive: new THREE.Color(AMBER), emissiveIntensity: .9 });
      const leather= new THREE.MeshStandardMaterial({ color: LEATHER, metalness: .1, roughness: .78 });
      const pleatM = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, metalness: .85, roughness: .3, envMap });

      const fz = m => { m.userData.frozen = true; return m; };
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const bar = (a, b, r, mat, parent = bed, seg = 12) => {
        const d = new THREE.Vector3().subVectors(b, a), len = d.length();
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
        m.position.copy(a).addScaledVector(d, .5);
        m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
        return fz(m), parent.add(m), m;
      };
      const box = (w, h, d, x, y, z, mat, parent = bed) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return fz(m), parent.add(m), m;
      };
      const add = (m, p) => (p.add(m), m);
      const additive = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, ...extra });

      // ---- the plinth: an iron deck with a glowing amber lip, legs down to the floor ----
      const DW = Math.max(W / S, Lo.total + 1.1), DD = D / S;
      const zc = (Z_B + .9 + (Z_H - 1.2)) / 2, dd = Math.min(DD, (Z_B + .9) - (Z_H - 1.2) + .3);
      box(DW - .3, DECK, dd, 0, DECK / 2, zc, iron);
      for (const [w, d, x, z] of [[DW - .2, .05, 0, zc + dd / 2], [DW - .2, .05, 0, zc - dd / 2]])
        box(w, .07, d, x, DECK + .01, z, trim);
      const legH = -floorY / S;
      if (legH > .6) for (const sx of [-1, 1]) for (const sz of [-1, 1]){
        box(.6, legH, .6, sx * (DW / 2 - .7), -legH / 2, zc + sz * (dd / 2 - .6), dark);
        box(.64, .05, .64, sx * (DW / 2 - .7), -.5, zc + sz * (dd / 2 - .6), trim);
      }

      // ---- the MAGNET GANTRY: two posts + the beam every magnet hangs from ----
      const PX = half + .35;
      for (const sx of [-1, 1]){
        bar(V(sx * PX, DECK, Z_B), V(sx * PX, Y_BEAM + .2, Z_B), .11, dark);
        for (const ex of [-1, 1]) bar(V(sx * PX + ex * .13, DECK + .1, Z_B + .1), V(sx * PX + ex * .13, Y_BEAM + .2, Z_B + .1), .02, trim);
        box(.5, .14, .9, sx * PX, DECK + .07, Z_B, dark);
      }
      bar(V(-PX, Y_BEAM, Z_B), V(PX, Y_BEAM, Z_B), .085, chrome);
      bar(V(-PX, Y_BEAM + .12, Z_B + .06), V(PX, Y_BEAM + .12, Z_B + .06), .02, trim);
      // the WIND CHEST behind: a brass manifold the horns stand on (reads as one instrument)
      bar(V(-half, .95, Z_H - .32), V(half, .95, Z_H - .32), .11, brass);
      box(Lo.total, .5, .5, 0, DECK + .25, Z_H - .32, dark);

      // ---- instanced bellows bodies + pleat frames (one draw each for the whole rank) ----
      const bodyGeo = new THREE.BoxGeometry(BW - .1, 1, BW - .1);
      const pleatGeo = new THREE.BoxGeometry(BW, .045, BW);
      instB.body = add(new THREE.InstancedMesh(bodyGeo, leather, n), bed);
      instB.pleat = add(new THREE.InstancedMesh(pleatGeo, pleatM, n * NP), bed);
      instB.body.userData.noMerge = instB.pleat.userData.noMerge = true;
      instB.body.frustumCulled = instB.pleat.frustumCulled = false;

      // ---- shared lane geometry ----
      const ballGeo = new THREE.SphereGeometry(BALL_R, 28, 20);
      const lidGeo = new THREE.BoxGeometry(BW + .06, .1, BW + .06).translate(0, -.05, 0);   // top face = the contact plane
      const magGeo = new THREE.CylinderGeometry(MAG_R, MAG_R * .9, MAG_H, 24).translate(0, MAG_H / 2, 0);
      const faceGeo = new THREE.CylinderGeometry(MAG_R * .78, MAG_R * .78, .03, 24).translate(0, -.015, 0);
      const coilGeo = new THREE.TorusGeometry(MAG_R + .01, .028, 8, 28).rotateX(Math.PI / 2);
      const ramGeo = new THREE.CylinderGeometry(.04, .04, 1, 10);
      const ringGeo = new THREE.TorusGeometry(1, .035, 6, 48).rotateX(Math.PI / 2);
      const diskGeo = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
      const capGeo = new THREE.CylinderGeometry(.075, .075, .05, 16).rotateX(Math.PI / 2);
      const crookGeo = new THREE.TorusGeometry(.1, .035, 8, 16, Math.PI);

      Lo.geo.forEach((q, k) => {
        const note = q.note, x = Lo.xs[k], evs = byNote[note];
        const lane = hornLane(evs.map(e => e.t), evs.map(e => e.vel), evs.map(e => e.dur), P, { beat, scale: S });
        const hiK = n > 1 ? k / (n - 1) : .5;
        const glowC = new THREE.Color(AMBER).lerp(new THREE.Color(AMBER_HOT), .15 + .55 * hiK);
        const laneG = new THREE.Group(); laneG.position.x = x; bed.add(laneG);

        // per-lane materials: the horn's brass (its emissive IS the breath), the marble, the coil
        const hornM = new THREE.MeshStandardMaterial({ color: 0xe8b860, metalness: 1, roughness: .18, envMap, envMapIntensity: 1.7,
          emissive: glowC.clone(), emissiveIntensity: .06, side: THREE.DoubleSide });
        const ballM = new THREE.MeshStandardMaterial({ color: 0xe6ebf2, metalness: 1, roughness: .08, envMap, envMapIntensity: 1.5,
          emissive: glowC.clone(), emissiveIntensity: .1 });
        const coilM = new THREE.MeshStandardMaterial({ color: 0x120c26, emissive: new THREE.Color(COIL), emissiveIntensity: .2 });

        // bellows base + the return RAM behind it (cylinder static; its rod rides the lid)
        box(BW + .08, .08, BW + .08, 0, DECK + .04, Z_B, dark, laneG);
        const zRam = Z_B - BW / 2 - .1;
        bar(V(0, DECK, zRam), V(0, Y_LID - .55, zRam), .085, iron, laneG);
        const collar = add(new THREE.Mesh(new THREE.TorusGeometry(.09, .022, 6, 16).rotateX(Math.PI / 2), coilM), laneG);
        collar.position.set(0, Y_LID - .58, zRam); fz(collar);
        const rod = add(new THREE.Mesh(ramGeo, chrome), laneG); rod.position.z = zRam;
        const lid = add(new THREE.Mesh(lidGeo, brass), laneG); lid.position.set(0, Y_LID, Z_B);
        const ear = add(new THREE.Mesh(new THREE.BoxGeometry(.1, .05, .16), chrome), lid); ear.position.set(0, -.07, -BW / 2 - .06);

        // the MAGNET: drop rod off the beam, iron body, chrome face, the violet coil
        bar(V(0, Y_MAG + MAG_H, Z_B), V(0, Y_BEAM, Z_B), .035, chrome, laneG);
        fz(add(new THREE.Mesh(magGeo, iron), laneG)).position.set(0, Y_MAG, Z_B);
        fz(add(new THREE.Mesh(faceGeo, chrome), laneG)).position.set(0, Y_MAG, Z_B);
        fz(add(new THREE.Mesh(coilGeo, coilM), laneG)).position.set(0, Y_MAG + MAG_H * .45, Z_B);

        // the HORN: lead pipe from the bellows' back, back along the wind chest, up the riser,
        // into the bell. Real tubing reads as one sweep (a CatmullRom tube), rT by register.
        const yP = .95, zOut = Z_B - BW / 2;
        const path = new THREE.CatmullRomCurve3([V(0, yP, zOut + .02), V(0, yP, zOut - .3), V(0, yP + .05, Z_H + .35),
          V(0, yP + .35, Z_H), V(0, (yP + q.yT) / 2, Z_H), V(0, q.yT - .25, Z_H), V(0, q.yT, Z_H)], false, 'centripetal');
        fz(add(new THREE.Mesh(new THREE.TubeGeometry(path, 48, q.rT * .8, 10), hornM), laneG));
        // the BELL — a Bessel flare (r grows as u⁴), tilted toward the audience
        const prof = [];
        for (let i = 0; i <= 32; i++){ const u = i / 32; prof.push(new THREE.Vector2(bellR(q, u), u * q.Lb)); }
        const bellG = new THREE.Group(); bellG.position.set(0, q.yT, Z_H); bellG.rotation.x = TILT; laneG.add(bellG);
        const bell = add(new THREE.Mesh(new THREE.LatheGeometry(prof, 36), hornM), bellG);
        bell.userData.noMerge = true;
        const rim = add(new THREE.Mesh(new THREE.TorusGeometry(q.Rm, RIM_R, 8, 40).rotateX(Math.PI / 2), brass), bell);
        rim.position.y = q.Lb;
        // the breath-light deep in the throat of the bell (additive disk) + a halo at the mouth
        const glowM = additive(glowC, { side: THREE.DoubleSide });
        const disk = add(new THREE.Mesh(diskGeo, glowM), bell);
        disk.position.y = q.Lb * .8; disk.scale.setScalar(bellR(q, .8) * .97);
        const haloM = new THREE.SpriteMaterial({ map: glowTex, color: glowC, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
        const halo = add(new THREE.Sprite(haloM), bellG); halo.position.y = q.Lb * 1.02;
        // the STAB shock-ring thrown out of the mouth along the bell's axis
        const ringM = additive(new THREE.Color(AMBER_HOT));
        const ring = add(new THREE.Mesh(ringGeo, ringM), bellG);

        // trombone: the SLIDE hangs down the front of the riser, its crook at the note's REAL position
        if (q.slide >= 0){
          const y0 = q.yT - SLIDE_TOP, y1 = y0 - q.slideLen, zS = Z_H + SLIDE_Z;
          bar(V(0, y0 + .06, Z_H), V(0, y0 + .06, zS), .045, brass, laneG, 8);            // the joint off the riser
          bar(V(-SLIDE_X, y0 + .06, zS), V(SLIDE_X, y0 + .06, zS), .04, brass, laneG, 8);
          for (const sx of [-1, 1]) bar(V(sx * SLIDE_X, y0 + .06, zS), V(sx * SLIDE_X, y1, zS), .03, chrome, laneG, 8);
          const cr = fz(add(new THREE.Mesh(crookGeo, brass), laneG));
          cr.position.set(0, y1, zS); cr.rotation.z = Math.PI;                                // the U crook, opening up
          bar(V(-SLIDE_X, y1 + q.slideLen * .35, zS), V(SLIDE_X, y1 + q.slideLen * .35, zS), .02, brass, laneG, 6);   // the brace
        }
        // valved horns: the casings face the audience; the note's REAL fingering presses in while it speaks
        let pressed = null;
        if (q.nValves){
          const caps = [];
          for (let v = 1; v <= q.nValves; v++){
            const y = VALVE_Y0 + (v - 1) * VALVE_DY;
            bar(V(0, y, Z_H), V(0, y, Z_H + .34), .065, brass, laneG, 12);
            const g = capGeo.clone().translate(0, y, Z_H + .37);
            if (q.valves.includes(v)) caps.push(g); else fz(add(new THREE.Mesh(g, chrome), laneG));
          }
          if (caps.length){ pressed = add(new THREE.Mesh(mergeGeometries(caps), chrome), laneG); pressed.userData.noMerge = true; }
        }

        // the MARBLE
        const ball = add(new THREE.Mesh(ballGeo, ballM), laneG); ball.position.set(0, Y_C + H, Z_B);

        lanes.push({ note, q, lane, k, x, glowC, laneG, lid, rod, zRam, ball, ballM, coilM, hornM, bell, disk, glowM, halo, haloM,
                     ring, ringM, pressed, edge: makeEdge(.25),
                     contact: V(x * S, (Y_C - BALL_R) * S, Z_B * S) });
      });
      freeze(bed);
      return group;
    }

    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

    function update(songTime, P, dt, { started, skipStrikes, onStrike }){
      const t = started ? songTime : start;
      for (const ln of lanes){
        const s = hornAt(ln.lane, t, start);
        const p = s.armed ? null : ln.lane.plan[s.i];
        const vel = s.armed ? 0 : ln.lane.vel[s.i];
        const stab = !s.armed && isStab(ln.lane.dur[s.i]);

        // ---- strike edge: the marble meets the lid → the horn speaks ----
        if (started && !s.armed && ln.edge.check(s.abs, s.since, skipStrikes)){
          const id = strikeId(voiceIdOf(ln.note, ln.lane.dur[s.i]), p.h, ladder);
          onStrike && onStrike({ note: id, vel, pos: ln.contact.clone(), color: ln.glowC.getHex(), dur: p.h,
            shake: (stab && vel > .8) || (ln.q.fam === 'tba' && vel > .85) ? .02 + .03 * vel : 0,
            sparks: stab ? Math.round(6 + 8 * vel) : Math.round(2 + 3 * vel), light: stab ? 1.2 + .6 * vel : .8 + .5 * vel });
        }

        // ---- idle: the held marble's rest (catch → release; the release is tf before the strike) ----
        const hr = heldRest(ln.lane, s), rest = hr ? restEnv(hr.since, hr.until, .2, .5) : 0;
        const inhale = rest ? .5 - .5 * sway(t, BREATH_HZ, Math.PI / 2 + .7 * ln.k) : 0;   // ≥ 0: the lid only ever dips below its stop
        const lidR = s.lid / S - BREATH_A * rest * inhale;
        // ---- marble, lid, ram (solve units are world units: divide by the bed scale) ----
        ln.ball.position.y = Y_C + s.y / S;
        ln.lid.position.y = Y_LID + lidR;
        const ramTop = Y_LID - .12 + lidR, ramBot = Y_LID - .58;
        ln.rod.position.y = (ramTop + ramBot) / 2; ln.rod.scale.y = Math.max(.01, ramTop - ramBot);
        // bellows body + pleats (instanced): stretched between the base and the lid
        const yb = DECK + .08, yl = Y_LID - .1 + lidR, hgt = yl - yb;
        _m.compose(_v.set(ln.x, yb + hgt / 2, Z_B), _q.identity(), _s.set(1, hgt, 1));
        instB.body.setMatrixAt(ln.k, _m);
        for (let j = 0; j < NP; j++){
          const f = (j + 1) / (NP + 1), w = j % 2 ? 1.04 : .97;      // alternating frames: the zig-zag of a pleat
          _m.compose(_v.set(ln.x, yb + hgt * f, Z_B), _q.identity(), _s.set(w, 1, w));
          instB.pleat.setMatrixAt(ln.k * NP + j, _m);
        }

        // ---- the breath: horn glows, bell flares, the throat lights ----
        const b = s.armed ? 0 : s.breath, age = s.armed ? 99 : s.since;
        const punch = s.armed ? 0 : vel * Math.exp(-age * (stab ? 14 : 9));
        ln.hornM.emissiveIntensity = .05 + .32 * b * (.4 + .6 * vel) + .9 * punch;
        ln.glowM.opacity = Math.min(1, b * (.55 + .45 * vel) + .5 * punch);
        ln.haloM.opacity = Math.min(.95, .55 * b * vel + .6 * punch);
        ln.halo.scale.setScalar(ln.q.Rm * (2.2 + 1.8 * b + 2.5 * punch));
        const flex = 1 + FLEX * Math.min(1, .45 * b * vel + punch);
        ln.bell.scale.set(flex, 1, flex);
        ln.ballM.emissiveIntensity = .08 + (s.onLid ? .35 * b * vel : 0) + 1.5 * punch;
        // the shock-ring (stabs + accents): flies out of the mouth along the axis, widening, fading
        const ru = age / RING_T;
        if (!s.armed && ru < 1 && (stab || vel > .75)){
          const e = 1 - Math.pow(1 - ru, 2.2);
          ln.ring.position.y = ln.q.Lb * (1.02 + .55 * e);
          ln.ring.scale.setScalar(ln.q.Rm * (1 + 1.3 * e));
          ln.ringM.opacity = Math.min(1, 1.6 * vel * Math.pow(1 - ru, 3));
        } else ln.ringM.opacity = 0;
        if (ln.pressed) ln.pressed.position.z = -.1 * Math.min(1, b * 1.6);

        // ---- the coil + ram: where the energy comes from ----
        // the coil burns while it holds the marble (a flash at the zero-speed catch); the ram's collar
        // blazes as it snaps the lid up and lobs the marble (the visible energy supply)
        let coil = 0, ram = 0;
        if (s.held) coil = .6 * (1 + .25 * rest * sway(t, BREATH_HZ, .7 * ln.k) + .9 * anticip(hr.until, .7)) + (p ? 2.4 * Math.exp(-hr.since * 18) : 0);
        if (p && s.since >= p.h && s.since < p.h + p.TS + .2) ram = 2.6 * Math.exp(-Math.max(0, s.since - p.h - p.TS) * 25);
        ln.coilM.emissiveIntensity = .15 + 1.6 * coil + ram;
      }
      if (instB.body){ instB.body.instanceMatrix.needsUpdate = true; instB.pleat.instanceMatrix.needsUpdate = true; }
    }

    return { build, update };
  },

  /* Demo — a Bb-pentatonic FANFARE for a 12-horn section (bars of 4):
       1  the call: trumpets climb F–Bb–D–F over a held Bb (tuba + trombones)
       2  ska: the tuba walks Bb–D–F–G, the section STABS the off-beats (Bb, Bb, Csus, Csus)
       3  the low brass swells under a trumpet line (D5's quick repeat takes the DENSE lob)
       4  "da-DAH" Csus hits, a pickup, and the TUTTI: the whole rank on one Bb chord */
  demo: {
    bpm: 116, beats: 16, scale: ['C', 'D', 'F', 'G', 'A#'],
    part: [
      [0, 'A#2', .9, 1.75], [0, 'F3', .7, 1.75], [0, 'A#3', .7, 1.75],
      [0, 'F4', .8, .4], [.5, 'A#4', .85, .4], [1, 'D5', .9, .9], [2, 'F5', 1, 1.6], [2, 'D4', .7, 1.6],
      [4, 'A#2', .85, .5], [5, 'D3', .8, .5], [6, 'F3', .8, .5], [7, 'G3', .8, .5],
      [4.5, 'D4', .85, .25], [4.5, 'F4', .85, .25], [4.5, 'A#4', .9, .25],
      [5.5, 'D4', .8, .25], [5.5, 'F4', .8, .25], [5.5, 'A#4', .85, .25],
      [6.5, 'C4', .85, .25], [6.5, 'F4', .85, .25], [6.5, 'G4', .9, .25],
      [7.5, 'C4', .9, .25], [7.5, 'F4', .9, .25], [7.5, 'G4', .95, .25],
      [8, 'D3', .65, 3.5], [8, 'G3', .55, 3.5], [8, 'D4', .5, 3.5],
      [8, 'D5', .75, 1], [9, 'F5', .85, .5], [9.5, 'D5', .8, .5], [10, 'A#4', .75, 1], [11, 'G4', .7, 1],
      [12, 'F3', 1, .25], [12, 'C4', 1, .25], [12, 'F4', 1, .25], [12, 'G4', 1, .25],
      [12.75, 'C4', .9, .25], [12.75, 'F4', .9, .25], [12.75, 'G4', .95, .25],
      [13.5, 'G3', .8, .25], [13.5, 'C4', .8, .25], [13.5, 'G4', .85, .25],
      [14, 'A#2', 1, 1.5], [14, 'F3', .9, 1.5], [14, 'A#3', .9, 1.5], [14, 'D4', .9, 1.5],
      [14, 'F4', .95, 1.5], [14, 'A#4', .95, 1.5], [14, 'D5', 1, 1.5], [14, 'F5', 1, 1.5],
    ],
  },
};

/* the bell's radius at u ∈ [0, 1] along its length: a slow cone that blooms into the flare
   (a Bessel-ish horn) — the throat meets the tubing, the mouth is Rm */
function bellR(q, u){ const r0 = q.rT * .8; return r0 + (q.Rm - r0) * (.3 * Math.pow(u, 1.6) + .7 * Math.pow(u, 7)); }

/* ---- static structure → ONE mesh per material (bells' freeze): the rank's ~100 static
   parts become a handful of draws. Bakes each frozen mesh's transform relative to `root`. ---- */
function freeze(root){
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), byMat = new Map(), dead = [];
  root.traverse(o => {
    if (!o.isMesh || !o.userData.frozen) return;
    const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    (byMat.get(o.material) || byMat.set(o.material, []).get(o.material)).push(g);
    dead.push(o);
  });
  for (const o of dead){ o.parent.remove(o); o.geometry.dispose(); }
  for (const [mat, geos] of byMat){
    const merged = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (merged) root.add(new THREE.Mesh(merged, mat));
  }
}
