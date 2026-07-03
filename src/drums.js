import * as THREE from 'three';
import { solveLaunch, arcPos, arcVel, allocateJuggle, padOffset, beltPhase, UPY } from './engine.js';
import { carriageGeometry, HUB_BACK } from './conveyor.js';
import { normalizeHit } from './drumkit.js';

/* ============================================================
   DRUM KIT — the second instrument archetype, the visible
   percussion section. Fourth render subsystem, same DI'd shape
   as conveyor.js / juice.js / camera.js: a thin seam, no engine
   reach beyond the pure ballistic primitives.

   THE ONE IDEA (docs/PLAN-juggling-drums.md): drum hits CHAIN,
   exactly like melody pads chain. A small set of IMMORTAL balls
   juggles across the kit — the bounce-out of one hit is the
   solved flight to that ball's next hit:

       v0 = solveLaunch(thisHead, nextHead, gap)   // the SAME solver

   so a hat run is one ball DRIBBLING, a kick+snare groove is one
   ball ping-ponging, and rhythm is visible in arc height (dt²,
   the belt's grammar). Gaps too long to fly go THROUGH the
   machine: exit arc into the catch BASIN, ride the open rails up
   the lift and across the manifold, dwell glowing in the nozzle
   mouth (the anticipation beat), then fire — the nozzles are the
   mouths of a circulation system, not ball printers. WHICH ball
   takes WHICH hit is pure schedule math (allocateJuggle, in the
   engine, unit-tested); this file only solves geometry per leg.

   Every leg is an analytic arc or an arc-length curve position —
   a ball's whole loop is a pure function of songTime. No
   integrator, no scheduler, no per-ball state. Time is the only
   state, so the kit re-derives from scratch every frame and never
   drifts from the music.

   Two departures from ball-juggling, both decided:
   · the KICK is struck by a pedal BEATER (its face is the one
     perpendicular to the rest — the mallet is honest and iconic);
   · the heads AIM: a solved exit is generally not the natural
     reflection of the entry, so each head gimbals to the bisector
     before every strike (settled at impact, like padOffset(0)=0)
     and its punch-flex becomes the visible cause — a powered
     trampoline. The pads' self-positioning magic, ported.
   ============================================================ */

const FIRE_T  = 1.05;       // nozzle → head flight (the old spout arc, kept)
const CATCH_T = 0.55;       // head → basin exit arc on a plumb leg
const EDGE_W  = 0.5;        // strike-edge detection window (time since strike)
const BALL_R  = 0.2;        // drum-ball radius
const POOL    = 36;         // ball rigs; one PER BALL now (a groove uses 2-3, extras warn)
const DT_MAX      = 1.7;    // longest aerial gap (feel knob — apex ~ |G|·dt²/8)
const MIN_TRANSIT = 2.2;    // shortest gap worth a rail trip (feel knob)
const RIDE_SPEED  = 7;      // u/s along the rails; leftover transit time = nozzle dwell
const AIM_MAX     = 0.45;   // rad — max head deviation from its layout tilt
const BEATER_LANES = ['kick'];
const BEATER_AMP   = 0.85;  // beater back-swing (rad) — same envelope as the pads
// per-ball identity hues — trackable balls are the point of juggling
const BALL_HUES = [0xffd98c, 0xa8dcff, 0xffb3d9, 0xc0ffd0, 0xdcc4ff, 0xfff3b0, 0x9ffcf0, 0xffc4a8];

// per-drum render styling — DATA, like MACHINE_STYLE in conveyor.js. shell/head
// colours distinguish the lanes; `r`/`h` are the shell radius/height.
const DRUM_STYLE = {
  kick:    { r:1.25, h:1.35, shell:0x2a1f38, head:0xff8a3d, ball:0xffb066 },
  snare:   { r:0.72, h:0.62, shell:0x27314c, head:0xeaf0ff, ball:0xbfe0ff },
  hat:     { r:0.66, h:0.16, shell:0x3a4230, head:0xffe27a, ball:0xfff0a8 },
  hatOpen: { r:0.66, h:0.20, shell:0x3a4230, head:0xffe8a0, ball:0xfff0a8 },
  clap:    { r:0.6,  h:0.4,  shell:0x402840, head:0xff9ad8, ball:0xffc0e8 },
  // the toms, low → high: bigger/darker/warmer at the bottom, smaller/brighter
  // up top, so a descending fill reads as a tonal sweep across the kit.
  floorHigh: { r:0.92, h:0.82, shell:0x3a2230, head:0xff665a, ball:0xffa692 },
  tomLow:    { r:0.78, h:0.68, shell:0x33243a, head:0xff8868, ball:0xffbc98 },
  tomMid:    { r:0.71, h:0.62, shell:0x2f2a44, head:0xffa468, ball:0xffcc98 },
  tomHiMid:  { r:0.65, h:0.56, shell:0x2c2e48, head:0xffbe68, ball:0xffdc98 },
  tomHigh:   { r:0.59, h:0.50, shell:0x2a3048, head:0xffd668, ball:0xffe898 },
  crash:   { r:0.95, h:0.1,  shell:0x444a30, head:0xfff0b0, ball:0xfff6d0 },
  ride:    { r:0.95, h:0.1,  shell:0x33402f, head:0xe8f0b0, ball:0xf2f8d0 },
};
const FALLBACK = DRUM_STYLE.snare;

const SPAWN_DIST = 2.8;   // the nozzle floats this far out from each head ALONG ITS NORMAL

// The kit is a real DRUM SET, not a row. Each lane has a canonical slot — DATA, like
// MACHINE_STYLE. Coords are LOCAL to the kit origin K = (wall-centre, RISER_TOP, KIT_Z):
// x = left/right, y = head height above the riser deck, z = depth toward the camera (+z).
// `tilt` = [rake, yaw, roll] in radians — the real-kit angles: rack toms raked steeply
// toward the drummer (−rake → face tilts back toward the wall), floor toms near-flat,
// cymbals tilted, side pieces YAWED to wrap around the kit. `kind` picks the builder;
// `sup` the procedural stand. The kick stands face-out and takes the pedal beater.
const RISER_TOP = 1.5;   // the drum-riser deck height (world y) the whole kit stands on
const KIT_X     = 7.0;   // kit sits this far to the RIGHT of the melody belt (not directly in front)
const KIT_Z     = 5.0;   // …and this far in FRONT of the wall, well clear of the weaving melody pads
const KIT_LAYOUT = {
  kick:      { x:  0.0, y: 1.25,z: 0.9, kind:'drum',   sup:'kick',     tilt:[ 1.48,  0.0,  0.0 ] },
  snare:     { x: -2.0, y: 2.4, z: 1.9, kind:'drum',   sup:'tripod',   tilt:[ 0.12,  0.10, 0.0 ] },
  hat:       { x: -3.2, y: 3.2, z: 1.4, kind:'hihat',  sup:'hihat',    tilt:[ 0.0,   0.12, 0.0 ] },
  hatOpen:   { x: -3.2, y: 3.3, z: 1.4, kind:'hihat',  sup:'hihat',    tilt:[ 0.0,   0.12, 0.0 ] },
  clap:      { x: -4.0, y: 2.7, z: 0.8, kind:'drum',   sup:'tripod',   tilt:[ 0.12,  0.18, 0.0 ] },
  // three rack toms mounted up & back over the (now taller) kick — middle one peaks highest
  tomHigh:   { x: -1.4, y: 3.6, z: 0.2, kind:'drum',   sup:'tom',      tilt:[ 0.50,  0.18, 0.0 ] },
  tomHiMid:  { x:  0.0, y: 4.0, z: 0.0, kind:'drum',   sup:'tom',      tilt:[ 0.52,  0.0,  0.0 ] },
  tomMid:    { x:  1.4, y: 3.6, z: 0.2, kind:'drum',   sup:'tom',      tilt:[ 0.50, -0.18, 0.0 ] },
  // a 4th rack tom dropping toward the floor toms on the right
  tomLow:    { x:  2.9, y: 3.0, z: 0.6, kind:'drum',   sup:'tom',      tilt:[ 0.40, -0.24, 0.0 ] },
  // floor tom: near-flat, on legs, out to the drummer's right — nudged clear of tomLow
  floorHigh: { x:  3.6, y: 2.3, z: 2.4, kind:'drum',   sup:'floortom', tilt:[ 0.12, -0.26, 0.0 ] },
  // cymbals up high on booms, tilted toward the drummer & yawed inward
  crash:     { x: -3.0, y: 4.9, z: 0.5, kind:'cymbal', sup:'boom',     tilt:[ 0.34,  0.22, 0.0 ] },
  ride:      { x:  3.4, y: 4.6, z:-0.4, kind:'cymbal', sup:'boom',     tilt:[ 0.28, -0.24, 0.0 ] },
};
const DEFAULT_LAYOUT = { x: 0, y: 2.4, z: 1.0, kind:'drum', sup:'tripod', tilt:[-0.1, 0, 0] };

const MOUNT_GAUGE = .11;   // arm thickness — the conveyor's lead gauge (one machine language)
const PANEL_D     = -1.5;  // the mounting panel sits this far behind the kit origin (local z)

const wrap = (t, P) => ((t % P) + P) % P;
const ease = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const ZAXIS = new THREE.Vector3(0, 0, 1);
const _nv = new THREE.Vector3(), _hb = new THREE.Vector3(), _dv = new THREE.Vector3();  // per-frame scratch

export function makeDrumMachine({ envMap, glowTex, bandY, floorY }){
  /* The ball POOL is built ONCE and lives in the scene, like the marble rigs —
     it persists across songs. Rig i is BALL i for the whole song (stable identity
     + its own hue, so the eye can follow one ball around the kit). No point-lights
     (there can be several at once) — emissive + bloom carry the glow. */
  const ballGroup = new THREE.Group();
  const ballGeo = new THREE.SphereGeometry(BALL_R, 16, 16);
  const pool = Array.from({ length: POOL }, () => {
    const core = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2,
      metalness: .3, roughness: .25, envMap }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    halo.scale.setScalar(BALL_R * 4.5);
    const g = new THREE.Group(); g.add(core, halo); g.visible = false;
    ballGroup.add(g);
    return { g, core, halo };
  });

  let drums = [];     // current song's drum targets  [{lane, group, head, contact, aims, ...}]
  let hits  = [];     // flattened hit list — drives the strike edge (audio/flex), NOT the balls
  let balls = [];     // solved juggle schedules: [{t0, segs:[{t0,dur,kind,...}]}]
  let beater = null;  // the kick pedal mechanism, if the song has a kick lane
  let mounts = [];    // panel-mounted pads' telescoping spines, re-aimed per frame

  /* Rebuild the kit for a song. `spec` is song.drums (a map of lane → hit list) or
     undefined. params = {rollT, beat, P, cx}. Returns the targets GROUP for the
     caller to add under `world` (so it's disposed on the next song change). */
  function build(spec, { rollT, beat, P, cx }){
    const group = new THREE.Group();
    drums = []; hits = []; balls = []; beater = null; mounts = [];
    if (!spec){ return group; }                    // song has no drums — empty kit

    const K = new THREE.Vector3(cx + KIT_X, RISER_TOP, KIT_Z);  // kit origin: off to the right, deck height, in front
    if (floorY != null) group.add(buildRiser(K, floorY, envMap));  // the riser the whole kit stands on

    // ONE chrome material for all hardware in this build (rims, lugs, stands, rails) —
    // disposed with the world on the next song change like everything else under `group`.
    const hardware = new THREE.MeshStandardMaterial({ color: 0xc2ccde, metalness: 1, roughness: .28, envMap,
      emissive: new THREE.Color(0x1a2233), emissiveIntensity: .3 });

    /* ---- 1. the drums themselves + the flattened hit list (strike edge) ---- */
    // panel-mounted pads share the conveyor mounts' dark matte arm material
    const mountMat = new THREE.MeshStandardMaterial({ color: 0x262b36, metalness: .6, roughness: .62, envMap });
    const byLane = {};
    for (const lane of Object.keys(spec)){
      const L = KIT_LAYOUT[lane] || DEFAULT_LAYOUT;
      const style = DRUM_STYLE[lane] || FALLBACK;
      const contact = new THREE.Vector3(K.x + L.x, K.y + L.y, K.z + L.z);   // head centre: where a ball lands

      const piece = L.kind === 'cymbal' ? buildCymbal(style, envMap)
                  : L.kind === 'hihat'  ? buildHiHat(style, envMap)
                  : BEATER_LANES.includes(lane) ? buildDrum(style, envMap, hardware)
                  :                       buildPad(style, envMap, mountMat);
      piece.group.position.copy(contact);
      piece.group.rotation.set(L.tilt[0] || 0, L.tilt[1] || 0, L.tilt[2] || 0);
      group.add(piece.group);
      // pads hang off the back panel (their arm is added below); everything else keeps
      // its stand — vertical, world-space, from the piece's underside down to the deck
      if (!piece.slider) group.add(buildSupport(L.sup, contact, piece.depth, K.y, hardware));

      // `slider` is the part that runs the wind-up travel: the pad carriage where
      // there is one, else the struck disc itself (cymbal/hat sliding on its stand).
      const slider = piece.slider ?? piece.head;
      const d = { lane, group: piece.group, head: piece.head, contact,
                  lastStrike: -999, style, headBaseY: piece.head.position.y,
                  isPad: !!piece.slider, slider, slideBaseY: slider.position.y,
                  baseQuat: piece.group.quaternion.clone(),
                  normal: UPY.clone().applyEuler(piece.group.rotation),
                  aims: [] };                       // [{s, q, amp}] filled by the schedule solve
      drums.push(d); byLane[lane] = d;

      for (const raw of spec[lane]){
        const { beat: b, vel } = normalizeHit(raw);
        const s = rollT + b * beat;                              // strike time within the loop (lead's timeline)
        hits.push({ drum: d, lane, s, vel, struckLoop: null });
      }
    }

    /* ---- 1b. the mounting PANEL + per-pad arms — the conveyor's mount, verbatim:
       shoe bolted to a (static) panel, telescoping spine out to the carriage hub.
       The spine re-aims every frame so the arm visibly tilts and travels with the
       pad's aim + wind-up, exactly like the belt brackets do. ---- */
    const padDs = drums.filter(d => d.isPad);
    if (padDs.length){
      const panel = buildPanel(padDs, K, envMap, hardware);
      group.add(panel.group);
      const spineGeo = new THREE.BoxGeometry(MOUNT_GAUGE, MOUNT_GAUGE, 1);           // unit — telescoped per frame
      const shoeGeo  = new THREE.BoxGeometry(MOUNT_GAUGE * 2.4, MOUNT_GAUGE * 2.4, MOUNT_GAUGE * .6);
      for (const d of padDs){
        const hubRest = d.contact.clone().addScaledVector(d.normal, -HUB_BACK);
        const anchor = new THREE.Vector3(hubRest.x, hubRest.y, panel.z + MOUNT_GAUGE * .3);
        const shoe = new THREE.Mesh(shoeGeo, mountMat); shoe.position.copy(anchor);
        const spine = new THREE.Mesh(spineGeo, mountMat);
        group.add(shoe, spine);
        mounts.push({ d, spine, anchor });
      }
    }

    /* ---- 2. WHO juggles WHAT — the pure allocator (engine.js) ---- */
    const sched = allocateJuggle(hits, P,
      { dtMax: DT_MAX, minTransit: MIN_TRANSIT, beaterLanes: BEATER_LANES });
    if (sched.length > POOL) console.warn(`drum juggle wants ${sched.length} balls; rendering first ${POOL}`);

    /* ---- 3. the plumbing — built ONLY for drums that actually receive transits ---- */
    const plumbLanes = new Set();
    for (const b of sched) b.legs.forEach((l, i) => {
      if (l.mode === 'plumb') plumbLanes.add(b.strikes[(i + 1) % b.strikes.length].lane);
    });
    const rails = plumbLanes.size
      ? buildRails(K, [...plumbLanes].map(l => byLane[l]), hardware, envMap)
      : null;                                        // {basinMouth, curveFor:{lane:{curve,len}}, mouths:{lane}}
    if (rails) group.add(rails.group);

    /* ---- 4. solve every ball's loop, leg by leg (all closed-form, all up front) ---- */
    for (const b of sched.slice(0, POOL)){
      const n = b.strikes.length;
      // pass 1 — per-leg solved motion, as renderable segments
      const legs = b.legs.map((leg, i) => {
        const A = byLane[b.strikes[i].lane], B = byLane[b.strikes[(i + 1) % n].lane];
        if (leg.mode === 'air'){
          const v0 = solveLaunch(A.contact, B.contact, leg.dt);
          return { segs: [{ dur: leg.dt, kind: 'arc', p0: A.contact, v0 }],
                   vOut: v0, vIn: arcVel(v0, leg.dt) };
        }
        // plumb: catch arc → rail ride → nozzle dwell → fire arc. If the gap is
        // pathologically short (a forced seam wrap), compress the arcs to fit.
        const k = Math.min(1, Math.max(0.1, (leg.dt - .05) / (CATCH_T + FIRE_T)));
        const ct = CATCH_T * k, ft = FIRE_T * k;
        const mouth = rails.mouths[B.lane];
        const vC = solveLaunch(A.contact, rails.basinMouth, ct);
        const vF = solveLaunch(mouth, B.contact, ft);
        const { curve, len } = rails.curveFor[B.lane];
        const avail = leg.dt - ct - ft;
        const ride = Math.min(len / RIDE_SPEED, Math.max(avail, 0));
        const dwell = Math.max(0, avail - ride);
        return { segs: [{ dur: ct,    kind: 'arc',   p0: A.contact, v0: vC },
                        { dur: ride,  kind: 'ride',  curve, len },
                        { dur: dwell, kind: 'dwell', pos: mouth },
                        { dur: ft,    kind: 'arc',   p0: mouth, v0: vF }],
                 vOut: vC, vIn: arcVel(vF, ft) };
      });
      // pass 2 — register each strike's head AIM: the bisector of the solved
      // in/out velocities (a powered-trampoline normal), clamped near the layout
      // tilt. legs[i-1] arrives at strike i; legs[i] leaves it.
      for (let i = 0; i < n; i++){
        const d = byLane[b.strikes[i].lane];
        const vIn = legs[(i - 1 + n) % n].vIn, vOut = legs[i].vOut;
        const nrm = vOut.clone().sub(vIn).normalize();
        let q = new THREE.Quaternion().setFromUnitVectors(UPY, nrm);
        const a = q.angleTo(d.baseQuat);
        if (a > AIM_MAX) q = d.baseQuat.clone().slerp(q, AIM_MAX / a);
        // wind-up depth scales with the SOLVED launch speed (geometry, never the
        // hit's velocity-dynamics): dribbles flick, cross-kit lobs cock back deep.
        const amp = Math.min(.6, Math.max(.08, vOut.length() * .05));
        d.aims.push({ s: wrap(b.strikes[i].s, P), q, amp });
      }
      // flatten to one cyclic segment timeline starting at the ball's first strike
      const segs = []; let t = 0;
      for (const leg of legs) for (const sg of leg.segs){ segs.push({ ...sg, t0: t }); t += sg.dur; }
      balls.push({ t0: b.strikes[0].s, segs, total: t });        // total === P (allocator invariant)
    }
    for (const d of drums) d.aims.sort((a, b2) => a.s - b2.s);

    /* ---- 5. the kick beater — the one mallet-struck piece ---- */
    if (byLane.kick){
      beater = buildBeater(byLane.kick, K, hardware, envMap);
      beater.hits = hits.filter(h => h.lane === 'kick').map(h => h.s);
      group.add(beater.group);
    }
    return group;
  }

  /* Per-frame. Pure render: heads aim + flex, the beater swings, and every ball's
     position falls out of its solved cyclic schedule. `P` is the loop period. */
  function update(songTime, P, dt, { started, skipStrikes, onStrike }){
    // strike-edge detection (runs even with no airborne ball this frame)
    if (started && hits.length){
      for (const h of hits){
        const ph = wrap(songTime - h.s, P);                     // time since this hit's last strike
        if (ph <= EDGE_W){                                       // we're inside its just-struck window
          const ks = Math.floor((songTime - h.s) / P);          // which loop's strike
          if (ks !== h.struckLoop){
            h.struckLoop = ks;
            if (!skipStrikes){ h.drum.lastStrike = songTime; onStrike && onStrike(h); }
          }
        }
      }
    }
    // head AIM: ease from the last strike's pose to the next one's, settled well
    // before impact (the contact-honesty contract, same as padOffset(0)===0).
    for (const d of drums){
      const m = d.aims.length;
      if (!m) continue;
      if (m === 1){ d.group.quaternion.copy(d.aims[0].q); }
      else {
        const tau = wrap(songTime, P);
        let ni = d.aims.findIndex(a => a.s > tau); if (ni < 0) ni = 0;
        const pi = (ni - 1 + m) % m;
        const span = wrap(d.aims[ni].s - d.aims[pi].s, P) || P;
        const u = wrap(tau - d.aims[pi].s, P);
        const settle = Math.min(.35 * span, .15);
        d.group.quaternion.slerpQuaternions(d.aims[pi].q, d.aims[ni].q, ease(u / (span - settle)));
      }
    }
    // drumhead motion — the visible FORCE behind every launch. Ball-struck heads
    // run the pads' flipper envelope along their aimed launch line: retract in
    // anticipation (loading the trampoline), snap back through contact exactly at
    // the strike (padOffset(0)===0 — the same honesty contract), wobble out. The
    // beater-struck kick keeps a reactive punch instead — the mallet is its cause.
    for (const d of drums){
      const age = songTime - d.lastStrike;
      const f = (started && age >= 0 && age < .55) ? Math.exp(-age * 9) : 0;
      if (d.aims.length){
        let off = 0;
        if (started) for (const a of d.aims) off += padOffset(beltPhase(songTime, a.s, P), a.amp);
        d.slider.position.y = d.slideBaseY + off;    // the CARRIAGE travels its mount — visible mechanism
      } else {
        d.head.position.y = d.headBaseY - .12 * f;   // the kick barrel: the mallet punches it
      }
      d.head.scale.set(1 + .14 * f, 1 - .32 * f, 1 + .14 * f);
      d.head.material.emissiveIntensity = .35 + 2.2 * f;
    }
    // arm sync — the conveyor brackets' move, verbatim: the spine telescopes from
    // its panel shoe to the live carriage hub, so the arm visibly tilts with the
    // aim and travels with the wind-up. Runs AFTER aim + wind-up posed the pad.
    for (const m of mounts){
      _nv.copy(UPY).applyQuaternion(m.d.group.quaternion);                  // live pad normal
      _hb.copy(m.d.contact).addScaledVector(_nv, m.d.slider.position.y - HUB_BACK);   // live hub
      _dv.subVectors(_hb, m.anchor);
      const len = _dv.length() || 1e-3;
      m.spine.position.copy(m.anchor).addScaledVector(_dv, .5);
      m.spine.quaternion.setFromUnitVectors(ZAXIS, _dv.divideScalar(len));
      m.spine.scale.set(1, 1, len);
    }

    // the kick beater: wind-up → stroke → follow-through, contact exactly at the
    // strike (padOffset's contract), rectified so the mallet never pierces the head.
    if (beater){
      let back = 0;
      for (const s of beater.hits) back += -padOffset(beltPhase(songTime, s, P), BEATER_AMP);
      beater.arm.rotation.x = beater.dir * Math.max(0, back);
    }

    // the juggling balls — every position re-derived from scratch (time is the only state)
    let n = 0;
    if (started){
      for (const b of balls){
        const tau = wrap(songTime - b.t0, P);
        let sg = b.segs[b.segs.length - 1];
        for (const s of b.segs){ if (tau < s.t0 + s.dur){ sg = s; break; } }
        const local = Math.max(0, tau - sg.t0);
        let pos, dwellGlow = 0;
        if (sg.kind === 'arc')        pos = arcPos(sg.p0, sg.v0, local);
        else if (sg.kind === 'ride')  pos = sg.curve.getPointAt(Math.min(1, (local * RIDE_SPEED) / sg.len));
        else                        { pos = sg.pos; dwellGlow = 1; }   // staged in the nozzle, glowing

        const rig = pool[n]; const hue = BALL_HUES[n % BALL_HUES.length]; n++;
        rig.g.visible = true;
        rig.g.position.copy(pos);
        rig.g.scale.setScalar(1);
        rig.core.material.color.set(hue);
        rig.core.material.emissive.set(hue);
        rig.core.material.emissiveIntensity = 1.1 + .8 * dwellGlow;    // dwell = anticipation glow
        rig.halo.material.color.set(hue);
        rig.halo.material.opacity = .14 + .22 * dwellGlow;
      }
    }
    for (let i = n; i < POOL; i++) pool[i].g.visible = false;    // park the unused rigs
  }

  return { ballGroup, build, update };
}

/* The head of every piece sits at the group's LOCAL y=0 (so `contact` = the group's
   world position — which is also the gimbal point the aim rotates about), with the
   body hanging BELOW it; `depth` is how far down the body reaches, which the support
   uses to know where the deck-side stand should stop. */

/* ---- buildPad — a percussion PAD: the conveyor pad, LITERALLY. The acoustic-shell
   look lied about the physics (a resonator that aims and throws); the belt's pad —
   which always did look like an e-kit head — tells the truth. Same tapered disc,
   same rim ring (lane hue), gripped by the SAME four-post carriage (imported from
   conveyor.js). The carriage lives inside the slider so it rides the wind-up travel
   and tips with the aim for free; the telescoping spine back to the panel is added
   by the build (it needs the panel). One primitive, two stagings. ---- */
function buildPad(style, envMap, mountMat){
  const group = new THREE.Group();
  const r = style.r;
  const slider = new THREE.Group();                    // travels along local y = the launch line
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r * .9, r, r * .24, 36),
    new THREE.MeshStandardMaterial({ color: 0x9aa6bd, metalness: 1, roughness: .18, envMap,
      envMapIntensity: 1.2, emissive: new THREE.Color(style.head), emissiveIntensity: .35 }));
  body.position.y = -r * .12;                          // top face at local y=0 → contact honest
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r * .96, .05, 10, 44),
    new THREE.MeshStandardMaterial({ color: style.ball, metalness: .4, roughness: .3, envMap,
      emissive: new THREE.Color(style.ball), emissiveIntensity: .8 }));
  rim.rotation.x = Math.PI / 2; rim.position.y = .02;
  const car = new THREE.Mesh(carriageGeometry(r * .9, MOUNT_GAUGE), mountMat);   // the belt's grip, verbatim
  slider.add(body, rim, car);
  group.add(slider);
  return { group, head: body, slider, depth: HUB_BACK };
}

/* ---- buildPanel — the pads' mounting wall: the drum station's answer to the belt
   (same backdrop role, zero motion — nothing here recirculates). A matte structural
   panel rising off the riser deck behind the kit, chrome posts at its edges; every
   pad's shoe bolts to it. ---- */
function buildPanel(padDs, K, envMap, hardware){
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of padDs){
    minX = Math.min(minX, d.contact.x); maxX = Math.max(maxX, d.contact.x);
    maxY = Math.max(maxY, d.contact.y);
  }
  const m = 1.6, x0 = minX - m, x1 = maxX + m, top = maxY + 1.6, bot = K.y, z = K.z + PANEL_D;
  const mat = new THREE.MeshStandardMaterial({ color: 0x39415a, metalness: .35, roughness: .65, envMap,
    emissive: new THREE.Color(0x161c2e), emissiveIntensity: .5 });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, top - bot), mat);
  plane.position.set((x0 + x1) / 2, (top + bot) / 2, z);
  const group = new THREE.Group().add(plane);
  for (const sx of [x0, x1]){
    const post = new THREE.Mesh(new THREE.BoxGeometry(.16, top - bot, .16), hardware);
    post.position.set(sx, (top + bot) / 2, z + .15);
    group.add(post);
  }
  return { group, z };
}

/* ---- buildDrum — the KICK's barrel, the one honest acoustic form (a real visible
   mallet strikes a real face): lacquered shell + chrome rim hoops + lugs + a flexing
   emissive head. It anchors the "drum station" silhouette amid the machine. ---- */
function buildDrum(style, envMap, hardware){
  const group = new THREE.Group();
  const r = style.r, h = style.h;
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * .97, h, 40),
    new THREE.MeshStandardMaterial({ color: style.shell, metalness: .45, roughness: .35, envMap,
      emissive: new THREE.Color(style.shell), emissiveIntensity: .18 }));
  shell.position.y = -h / 2;                       // hang the body below the head
  const head = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h * .05, 40),
    new THREE.MeshStandardMaterial({ color: style.head, metalness: .3, roughness: .4, envMap,
      emissive: new THREE.Color(style.head), emissiveIntensity: .35 }));    // local y=0
  group.add(shell, head);
  // chrome rim hoops top & bottom
  for (const y of [0, -h]){
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, .045, 8, 40), hardware);
    hoop.rotation.x = Math.PI / 2; hoop.position.y = y; group.add(hoop);
  }
  // tension lugs evenly around the shell
  const N = Math.max(6, Math.round(r * 8));
  for (let i = 0; i < N; i++){
    const a = i * Math.PI * 2 / N;
    const lug = new THREE.Mesh(new THREE.BoxGeometry(.09, Math.min(.22, h * .5), .09), hardware);
    lug.position.set(Math.cos(a) * r * 1.0, -h / 2, Math.sin(a) * r * 1.0);
    group.add(lug);
  }
  return { group, shell, head, depth: h };
}

/* ---- buildCymbal — a thin tilted bronze disc + bell. The disc IS the head (its
   emissive flash reads as the cymbal ringing). ---- */
function buildCymbal(style, envMap){
  const group = new THREE.Group();
  const r = style.r;
  const bronze = new THREE.MeshStandardMaterial({ color: 0xb8862e, metalness: 1, roughness: .32, envMap,
    emissive: new THREE.Color(style.head), emissiveIntensity: .25 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, .035, 44), bronze);   // local y=0
  const bell = new THREE.Mesh(new THREE.SphereGeometry(r * .22, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), bronze);
  bell.position.y = .02;
  group.add(disc, bell);
  return { group, shell: disc, head: disc, depth: 0 };
}

/* ---- buildHiHat — two close bronze cymbals; the top one is the struck head. ---- */
function buildHiHat(style, envMap){
  const group = new THREE.Group();
  const r = style.r;
  const bronze = new THREE.MeshStandardMaterial({ color: 0xc08a2e, metalness: 1, roughness: .3, envMap,
    emissive: new THREE.Color(style.head), emissiveIntensity: .25 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r, .035, 40), bronze);    // local y=0
  const bot = new THREE.Mesh(new THREE.CylinderGeometry(r, r, .035, 40), bronze);
  bot.position.y = -.18;
  group.add(top, bot);
  return { group, shell: top, head: top, depth: .18 };
}

/* ---- buildRiser — the drum riser: a stage deck the kit stands on + chunky legs to the
   room floor. The kit's anchor=floor support (PLAN-staging): one solid platform instead
   of a forest of poles. ---- */
function buildRiser(K, floorY, envMap){
  const g = new THREE.Group();
  const W = 12.5, D = 6.5, cx = K.x, cz = K.z + 0.8, top = K.y;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(W, .4, D),
    new THREE.MeshStandardMaterial({ color: 0x1c2030, metalness: .4, roughness: .6, envMap,
      emissive: new THREE.Color(0x0c0f18), emissiveIntensity: .2 }));
  deck.position.set(cx, top - .2, cz); g.add(deck);
  const legH = (top - .4) - floorY;
  if (legH > 0){
    const legMat = new THREE.MeshStandardMaterial({ color: 0x3a4254, metalness: .7, roughness: .4, envMap });
    for (const [sx, sz] of [[-1,-1],[1,-1],[-1,1],[1,1]]){
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.5, legH, .5), legMat);
      leg.position.set(cx + sx * (W/2 - .7), floorY + legH/2, cz + sz * (D/2 - .7));
      g.add(leg);
    }
  }
  return g;
}

const _UP = new THREE.Vector3(0, 1, 0);
/* a cylinder spanning two points — for stand columns, tripod feet, boom & beater arms */
function tube(a, b, r, mat){
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length() || 1e-4;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  m.position.copy(a).addScaledVector(dir, .5);
  m.quaternion.setFromUnitVectors(_UP, dir.clone().normalize());
  return m;
}

/* ---- buildSupport — procedural kit hardware from the piece's underside down to the
   deck. The hand-built prototype of the PLAN-staging support generator: a switch on the
   piece's `sup` type. World-space + vertical, so the piece's tilt/aim never bends the stand. ---- */
function buildSupport(kind, contact, depth, deckY, mat){
  const g = new THREE.Group();
  const x = contact.x, z = contact.z, top = contact.y - (depth || 0);   // underside of the piece
  if (kind === 'kick') return g;                       // rests on the deck — no stand
  if (top <= deckY + .05) return g;
  const foot = (cx, cz, spread) => {                   // 3 splayed feet on the deck
    for (let i = 0; i < 3; i++){ const a = i * Math.PI * 2 / 3;
      g.add(tube(new THREE.Vector3(cx, deckY + .7, cz),
                 new THREE.Vector3(cx + Math.cos(a) * spread, deckY, cz + Math.sin(a) * spread), .04, mat)); }
  };
  if (kind === 'floortom'){                            // 3 legs straight down off the shell
    for (let i = 0; i < 3; i++){ const a = i * Math.PI * 2 / 3 + .5;
      g.add(tube(new THREE.Vector3(x + Math.cos(a) * .3, top, z + Math.sin(a) * .3),
                 new THREE.Vector3(x + Math.cos(a) * .55, deckY, z + Math.sin(a) * .55), .05, mat)); }
    return g;
  }
  if (kind === 'tom'){                                 // rack tom: a short mount stub (it hangs over
    g.add(tube(new THREE.Vector3(x, top, z),           // the kick — the real rack/tree comes later)
               new THREE.Vector3(x, top - .6, z), .07, mat));
    return g;
  }
  // tripod / hihat / boom — a column with splayed feet
  g.add(tube(new THREE.Vector3(x, top, z), new THREE.Vector3(x, deckY + .05, z), .06, mat));
  foot(x, z, .6);
  if (kind === 'hihat') g.add(tube(new THREE.Vector3(x, top + .35, z), new THREE.Vector3(x, top - .2, z), .03, mat));
  return g;
}

/* ---- buildBeater — the kick's pedal mallet: a post on the deck, a pivoting arm, a
   beater head that meets the face centre exactly at each strike. The swing reuses the
   pads' padOffset envelope (wind-up → stroke → follow-through) so the two machines
   share one gestural language. ---- */
function buildBeater(kickDrum, K, hardware, envMap){
  const C = kickDrum.contact, nrm = kickDrum.normal;                 // face centre + outward normal
  const pivot = C.clone().addScaledVector(nrm, 1.9); pivot.y = K.y + .25;
  const m0 = C.clone().addScaledVector(nrm, .26);                    // mallet centre at contact
  const group = new THREE.Group();
  group.add(tube(new THREE.Vector3(pivot.x, K.y, pivot.z), pivot, .09, hardware));   // pedal post
  const arm = new THREE.Group(); arm.position.copy(pivot);
  const tip = m0.clone().sub(pivot);                                 // arm vector, local to the pivot
  arm.add(tube(new THREE.Vector3(0, 0, 0), tip, .05, hardware));
  const mallet = new THREE.Mesh(new THREE.SphereGeometry(.24, 18, 14),
    new THREE.MeshStandardMaterial({ color: 0xe8ddc8, metalness: .1, roughness: .55, envMap,
      emissive: new THREE.Color(0x584c30), emissiveIntensity: .35 }));
  mallet.position.copy(tip);
  arm.add(mallet);
  group.add(arm);
  // swing back = away from the face: the sign of rotating the arm tip about +x
  // that increases its distance from the head. Solved once, geometrically.
  const test = tip.clone().applyEuler(new THREE.Euler(.3, 0, 0)).add(pivot);
  const dir = test.distanceTo(C) > m0.distanceTo(C) ? 1 : -1;
  return { group, arm, dir, hits: [] };
}

/* ---- buildRails — the circulation system, v1: one catch BASIN behind the kit, a
   vertical LIFT, an overhead MANIFOLD spine, and a branch down to each receiving
   drum's nozzle. OPEN rails (the ball stays visible the whole ride — conservation
   you can watch), rendered as thin chrome; motion uses one arc-length curve per
   drum. Built ONLY for drums that actually receive transit legs. ---- */
function buildRails(K, receivers, hardware, envMap){
  const group = new THREE.Group();
  const basin = new THREE.Vector3(K.x + 5.0, K.y + .9, K.z - 1.2);   // funnel mouth, rear-right of the deck
  const liftTop = new THREE.Vector3(basin.x, K.y + 7.5, basin.z);    // manifold height, above the kit
  const spineZ = basin.z;

  // the basin funnel (an open cone the catch arcs pour into) + its deck stem
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(.85, .22, .9, 24, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x9fb2cc, metalness: 1, roughness: .3, envMap,
      side: THREE.DoubleSide, emissive: new THREE.Color(0x22304a), emissiveIntensity: .4 }));
  funnel.position.set(basin.x, basin.y - .45, basin.z);
  group.add(funnel, tube(new THREE.Vector3(basin.x, K.y, basin.z),
                         new THREE.Vector3(basin.x, basin.y - .9, basin.z), .07, hardware));

  const nozMat = new THREE.MeshStandardMaterial({ color: 0xc6d0e8, metalness: 1, roughness: .28,
    side: THREE.DoubleSide, emissive: new THREE.Color(0x3a4a66), emissiveIntensity: .6 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xaebadd, metalness: 1, roughness: .32, envMap,
    emissive: new THREE.Color(0x26304a), emissiveIntensity: .35 });
  const railTube = pts => {
    const c = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', .1);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(c, 48, .05, 6), railMat));
    return c;
  };

  // the shared trunk: basin → lift → the far end of the spine
  let minX = liftTop.x;
  for (const d of receivers) minX = Math.min(minX, d.contact.x);
  railTube([basin, liftTop, new THREE.Vector3(minX - .8, liftTop.y, spineZ)]);

  const curveFor = {}, mouths = {};
  for (const d of receivers){
    // nozzle mouth: out along the head's LAYOUT normal (the nozzle is fixed; the
    // head's per-strike aim is a few degrees and the fire arc targets the centre)
    const mouth = d.contact.clone().addScaledVector(d.normal, SPAWN_DIST);
    mouths[d.lane] = mouth;
    const over = new THREE.Vector3(mouth.x, liftTop.y, spineZ);      // this drum's spine junction
    // motion curve: the whole trip, arc-length parameterized (constant ride speed)
    const curve = new THREE.CatmullRomCurve3(
      [basin, liftTop, over, new THREE.Vector3(mouth.x, (liftTop.y + mouth.y) / 2, mouth.z - .4), mouth],
      false, 'catmullrom', .1);
    curveFor[d.lane] = { curve, len: curve.getLength() };
    railTube([over, new THREE.Vector3(mouth.x, (liftTop.y + mouth.y) / 2, mouth.z - .4), mouth]);  // the branch
    // the nozzle itself, aimed down its fire line
    const v0 = solveLaunch(mouth, d.contact, FIRE_T);
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(.15, .09, .32, 18, 1, true), nozMat);
    noz.position.copy(mouth);
    noz.lookAt(mouth.clone().add(v0));             // aim down the launch line
    noz.rotateX(Math.PI / 2);                      // cylinder axis (y) → look direction
    group.add(noz);
  }
  return { group, basinMouth: basin, curveFor, mouths };
}
