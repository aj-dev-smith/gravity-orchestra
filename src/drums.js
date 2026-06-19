import * as THREE from 'three';
import { solveLaunch, arcPos, arcVel } from './engine.js';
import { normalizeHit } from './drumkit.js';

/* ============================================================
   DRUM KIT — the second instrument archetype, the visible
   percussion section. Fourth render subsystem, same DI'd shape
   as conveyor.js / juice.js / camera.js: a thin seam, no engine
   reach beyond the pure ballistic primitives.

   THE ONE IDEA THAT KEEPS THIS HONEST (same as the melody):
   everything is SOLVED UP FRONT. A drum is a STATIONARY target;
   a hit is a MORTAL ball fired from a spout so that — by the
   closed-form launch solve — it lands on the drumhead at exactly
   the right beat:

       v0   = solveLaunch(mouth, head, FLIGHT)    // the SAME solver
       P(t) = arcPos(mouth, v0, t)                // the SAME arc, t∈[0,FLIGHT]

   After the strike the ball takes a short solved bounce-out and
   fades. No integrator, no scheduler, no per-ball state machine:
   a ball's whole life is a pure function of songTime and its hit
   time `s`. Time is the only state — so the kit can be rendered
   from scratch every frame and never drifts from the music.

   The melody differs only in the two terms we solve: there, each
   pad launches the marble to the NEXT pad; here, a spout launches
   a ball to a fixed drum. Future instruments (lob / shoot / drop)
   swap the same two terms — target + launch solve — and stay just
   as solved. That generality is the moat.
   ============================================================ */

const FLIGHT = 1.05;        // seconds a ball is airborne before it strikes (the spout fires this far ahead)
const OUT    = 0.5;         // seconds of bounce-out before the mortal ball fades away
const BALL_R = 0.2;         // drum-ball radius
const POOL   = 36;          // shared ball rigs — generous; peak airborne is ~12, extras drop silently
const POP    = 0.12;        // fade-in time as the ball forms at the spout mouth

// per-drum render styling — DATA, like MACHINE_STYLE in conveyor.js. shell/head
// colours distinguish the lanes (the balls all glow the same cool tone); `r`/`h`
// are the shell radius/height, `lift` the head's offset above the shell centre.
const DRUM_STYLE = {
  kick:    { r:1.25, h:1.35, shell:0x2a1f38, head:0xff8a3d, ball:0xffb066, spread:0 },
  snare:   { r:0.72, h:0.62, shell:0x27314c, head:0xeaf0ff, ball:0xbfe0ff, spread:0 },
  hat:     { r:0.66, h:0.16, shell:0x3a4230, head:0xffe27a, ball:0xfff0a8, spread:0 },
  hatOpen: { r:0.66, h:0.20, shell:0x3a4230, head:0xffe8a0, ball:0xfff0a8, spread:0 },
  clap:    { r:0.6,  h:0.4,  shell:0x402840, head:0xff9ad8, ball:0xffc0e8, spread:0 },
  // the six toms, low → high: bigger/darker/warmer at the bottom, smaller/brighter
  // up top, so a descending fill reads as a tonal sweep across the kit.
  floorHigh: { r:0.92, h:0.82, shell:0x3a2230, head:0xff665a, ball:0xffa692, spread:0 },
  tomLow:    { r:0.78, h:0.68, shell:0x33243a, head:0xff8868, ball:0xffbc98, spread:0 },
  tomMid:    { r:0.71, h:0.62, shell:0x2f2a44, head:0xffa468, ball:0xffcc98, spread:0 },
  tomHiMid:  { r:0.65, h:0.56, shell:0x2c2e48, head:0xffbe68, ball:0xffdc98, spread:0 },
  tomHigh:   { r:0.59, h:0.50, shell:0x2a3048, head:0xffd668, ball:0xffe898, spread:0 },
  crash:   { r:0.95, h:0.1,  shell:0x444a30, head:0xfff0b0, ball:0xfff6d0, spread:0 },
  ride:    { r:0.95, h:0.1,  shell:0x33402f, head:0xe8f0b0, ball:0xf2f8d0, spread:0 },
};
const FALLBACK = DRUM_STYLE.snare;

const SPAWN_DIST = 2.8;   // the nozzle floats this far out from each head ALONG ITS NORMAL

// The kit is a real DRUM SET, not a row. Each lane has a canonical slot — DATA, like
// MACHINE_STYLE. Coords are LOCAL to the kit origin K = (wall-centre, RISER_TOP, KIT_Z):
// x = left/right, y = head height above the riser deck, z = depth toward the camera (+z).
// `tilt` = [rake, yaw, roll] in radians — the real-kit angles: rack toms raked steeply
// toward the drummer (−rake → face tilts back toward the wall), floor toms near-flat,
// cymbals tilted, side pieces YAWED to wrap around the kit. The spawner then feeds each
// face along its normal (above). `kind` picks the builder; `sup` the procedural stand.
// The kick stays head-up (struck from on top like everything) — the one honest stylization.
const RISER_TOP = 1.5;   // the drum-riser deck height (world y) the whole kit stands on
const KIT_X     = 7.0;   // kit sits this far to the RIGHT of the melody belt (not directly in front)
const KIT_Z     = 5.0;   // …and this far in FRONT of the wall, well clear of the weaving melody pads
// tilt = [rake, yaw, roll]. +rake tilts the face toward the DRUMMER (+z, camera side);
// side pieces YAW inward (left +, right −) so the kit wraps around the seat. The kick is
// the exception: rx≈π/2 stands it UP on the deck, big face toward the drummer like a real one.
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

export function makeDrumMachine({ envMap, glowTex, bandY, floorY }){
  /* The ball POOL is built ONCE and lives in the scene, like the marble rigs —
     it persists across songs. Each frame we recompute the airborne set (pure from
     songTime) and assign rigs to it; rigs carry no state between frames, so they
     can shuffle freely with no flicker. No point-lights here (there can be a dozen
     at once) — emissive + bloom carry the glow. */
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

  let drums = [];     // current song's drum targets  [{lane, group, head, contact, lastStrike, style}]
  let hits  = [];     // current song's flattened hit list, each fully solved up front

  /* Rebuild the kit for a song. `spec` is song.drums (a map of lane → hit list) or
     undefined. params = {rollT, beat, P, cx, halfW}. Returns the targets GROUP for
     the caller to add under `world` (so it's disposed on the next song change). */
  function build(spec, { rollT, beat, P, cx }){
    const group = new THREE.Group();
    drums = []; hits = [];
    if (!spec){ return group; }                    // song has no drums — empty kit

    const K = new THREE.Vector3(cx + KIT_X, RISER_TOP, KIT_Z);  // kit origin: off to the right, deck height, in front
    if (floorY != null) group.add(buildRiser(K, floorY, envMap));  // the riser the whole kit stands on

    // ONE chrome material for all hardware in this build (rims, lugs, stands) — disposed
    // with the world on the next song change like everything else under `group`.
    const hardware = new THREE.MeshStandardMaterial({ color: 0xc2ccde, metalness: 1, roughness: .28, envMap,
      emissive: new THREE.Color(0x1a2233), emissiveIntensity: .3 });

    const spouts = [];

    for (const lane of Object.keys(spec)){
      const L = KIT_LAYOUT[lane] || DEFAULT_LAYOUT;
      const style = DRUM_STYLE[lane] || FALLBACK;
      const contact = new THREE.Vector3(K.x + L.x, K.y + L.y, K.z + L.z);   // head centre: where a ball lands

      const piece = L.kind === 'cymbal' ? buildCymbal(style, envMap)
                  : L.kind === 'hihat'  ? buildHiHat(style, envMap)
                  :                       buildDrum(style, envMap, hardware);
      piece.group.position.copy(contact);
      piece.group.rotation.set(L.tilt[0] || 0, L.tilt[1] || 0, L.tilt[2] || 0);
      group.add(piece.group);
      // procedural stand: vertical (untilted), from the piece's underside down to the deck
      group.add(buildSupport(L.sup, contact, piece.depth, K.y, hardware));

      // spawn along the head's NORMAL so each ball drops onto the (raked) face square-on,
      // not grazing across it — the nozzle follows wherever the drum is angled.
      const normal = new THREE.Vector3(0, 1, 0).applyEuler(piece.group.rotation);
      const mouth = contact.clone().addScaledVector(normal, SPAWN_DIST);
      // the arc is IDENTICAL for every hit on this drum (mouth → head over FLIGHT), so
      // solve it ONCE: launch velocity, and the dampened bounce-out off the head.
      const v0 = solveLaunch(mouth, contact, FLIGHT);            // SAME solver the melody uses
      const impact = arcVel(v0, FLIGHT);                         // velocity at the instant of contact
      const vOut = new THREE.Vector3(impact.x * .22, Math.abs(impact.y) * .5, impact.z * .22);
      spouts.push({ mouth, v0 });                                // each gets a nozzle after the loop

      const d = { lane, group: piece.group, head: piece.head, contact,
                  lastStrike: -999, style, headBaseY: piece.head.position.y };
      drums.push(d);

      // each hit is just a strike TIME on this drum's shared arc
      for (const raw of spec[lane]){
        const { beat: b, vel } = normalizeHit(raw);
        const s = rollT + b * beat;                              // strike time within the loop (lead's timeline)
        hits.push({ drum: d, lane, s, vel, v0, vOut, mouth, struckLoop: null });
      }
    }
    group.add(buildNozzles(spouts));               // a sleek nozzle per face (manifold support deferred)
    return group;
  }

  /* Per-frame. Pure render: positions the airborne balls, flexes struck heads, and
     fires the strike edge (drumhead punch + onStrike for audio/sparks). `P` is the
     loop period (ROLL_T + LOOP_T). */
  function update(songTime, P, dt, { started, skipStrikes, onStrike }){
    // strike-edge detection + head flex (runs even with no airborne ball this frame)
    if (started && hits.length){
      for (const h of hits){
        let ph = (songTime - h.s) % P; if (ph < 0) ph += P;     // time since this hit's last strike
        if (ph <= OUT){                                          // we're inside its just-struck window
          const ks = Math.floor((songTime - h.s) / P);          // which loop's strike
          if (ks !== h.struckLoop){
            h.struckLoop = ks;
            if (!skipStrikes){ h.drum.lastStrike = songTime; onStrike && onStrike(h); }
          }
        }
      }
    }
    // drumhead flex: a quick punch-down that springs back — pure fn of time-since-strike
    for (const d of drums){
      const age = songTime - d.lastStrike;
      const f = (started && age >= 0 && age < .55) ? Math.exp(-age * 9) : 0;
      d.head.position.y = d.headBaseY - .12 * f;
      d.head.scale.set(1 + .14 * f, 1 - .32 * f, 1 + .14 * f);
      d.head.material.emissiveIntensity = .35 + 2.2 * f;
    }

    // airborne balls — recompute the live set from scratch (time is the only state)
    let n = 0;
    if (started){
      for (const h of hits){
        if (n >= POOL) break;
        let ph = (songTime - h.s) % P; if (ph < 0) ph += P;
        let pos, fade;
        if (ph <= OUT){                                          // bounce-out: struck `ph` ago, shrinking away
          pos = arcPos(h.drum.contact, h.vOut, ph);
          fade = 1 - ph / OUT;
        } else if (ph >= P - FLIGHT){                            // in flight toward the next strike
          const fall = FLIGHT - (P - ph);                        // seconds since the spout fired (0..FLIGHT)
          pos = arcPos(h.mouth, h.v0, fall);
          fade = Math.min(fall / POP, 1);                        // forms at the mouth, grows to full
        } else continue;                                         // dormant between bounce-out and next launch

        const rig = pool[n++];
        const st = h.drum.style;
        rig.g.visible = true;
        rig.g.position.copy(pos);
        rig.g.scale.setScalar(Math.max(.001, fade));
        rig.core.material.color.set(st.ball);
        rig.core.material.emissive.set(st.ball);
        rig.core.material.emissiveIntensity = (.4 + .9 * (h.vel ?? 1)) * fade + .1;
        rig.halo.material.color.set(st.ball);
        rig.halo.material.opacity = .16 * fade;
      }
    }
    for (let i = n; i < POOL; i++) pool[i].g.visible = false;    // park the unused rigs
  }

  return { ballGroup, build, update };
}

/* The head of every piece sits at the group's LOCAL y=0 (so `contact` = the group's
   world position), with the body hanging BELOW it; `depth` is how far down the body
   reaches, which the support uses to know where the deck-side stand should stop. */

/* ---- buildDrum — a real shell: lacquered drum + chrome rim hoops + lugs + a flexing
   emissive head. Realistic form, our glow (the head flash carries the strike). ---- */
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
/* a cylinder spanning two points — for stand columns, tripod feet & boom arms */
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
   piece's `sup` type. World-space + vertical, so the piece's tilt never bends the stand. ---- */
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

/* ---- buildNozzles — one sleek chrome nozzle per face, sitting out along the head's
   normal and aimed down its launch line; the balls form and fire from here. The overhead
   manifold/rack that would TIE these together is deferred (we're tuning the kit first). ---- */
function buildNozzles(spouts){
  const g = new THREE.Group();
  const nozMat = new THREE.MeshStandardMaterial({ color: 0xc6d0e8, metalness: 1, roughness: .28,
    side: THREE.DoubleSide, emissive: new THREE.Color(0x3a4a66), emissiveIntensity: .6 });
  for (const { mouth, v0 } of spouts){
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(.15, .09, .32, 18, 1, true), nozMat);
    noz.position.copy(mouth);
    noz.lookAt(mouth.clone().add(v0));             // aim down the launch line
    noz.rotateX(Math.PI / 2);                      // cylinder axis (y) → look direction
    g.add(noz);
  }
  return g;
}
