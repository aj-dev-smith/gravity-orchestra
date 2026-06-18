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
  kick:    { r:1.05, h:1.0,  shell:0x2a1f38, head:0xff8a3d, ball:0xffb066, spread:0 },
  snare:   { r:0.72, h:0.62, shell:0x27314c, head:0xeaf0ff, ball:0xbfe0ff, spread:0 },
  hat:     { r:0.66, h:0.16, shell:0x3a4230, head:0xffe27a, ball:0xfff0a8, spread:0 },
  hatOpen: { r:0.66, h:0.20, shell:0x3a4230, head:0xffe8a0, ball:0xfff0a8, spread:0 },
  clap:    { r:0.6,  h:0.4,  shell:0x402840, head:0xff9ad8, ball:0xffc0e8, spread:0 },
  // the six toms, low → high: bigger/darker/warmer at the bottom, smaller/brighter
  // up top, so a descending fill reads as a tonal sweep across the kit.
  floorLow:  { r:0.92, h:0.82, shell:0x3a2230, head:0xff665a, ball:0xffa692, spread:0 },
  floorHigh: { r:0.85, h:0.74, shell:0x382436, head:0xff7460, ball:0xffb096, spread:0 },
  tomLow:    { r:0.78, h:0.68, shell:0x33243a, head:0xff8868, ball:0xffbc98, spread:0 },
  tomMid:    { r:0.71, h:0.62, shell:0x2f2a44, head:0xffa468, ball:0xffcc98, spread:0 },
  tomHiMid:  { r:0.65, h:0.56, shell:0x2c2e48, head:0xffbe68, ball:0xffdc98, spread:0 },
  tomHigh:   { r:0.59, h:0.50, shell:0x2a3048, head:0xffd668, ball:0xffe898, spread:0 },
  crash:   { r:0.95, h:0.1,  shell:0x444a30, head:0xfff0b0, ball:0xfff6d0, spread:0 },
  ride:    { r:0.95, h:0.1,  shell:0x33402f, head:0xe8f0b0, ball:0xf2f8d0, spread:0 },
};
const FALLBACK = DRUM_STYLE.snare;

const MOUTH = new THREE.Vector3(0, 3.8, -1.8);   // spout mouth offset from the drumhead: up + back
const GAP   = 2.7;                                // x-spacing between drums in the kit
const Y_OFF = -1.2;                               // kit sits this far below the strike band
const Z_OFF = 2.6;                                // …and this far in FRONT of the wall (clear of the weaving pads)

export function makeDrumMachine({ envMap, glowTex, bandY }){
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

    const lanes = Object.keys(spec);
    lanes.forEach((lane, i) => {
      const style = DRUM_STYLE[lane] || FALLBACK;
      const x = cx + (i - (lanes.length - 1) / 2) * GAP;
      const y = bandY + Y_OFF, z = Z_OFF;
      const drum = buildDrum(style, envMap);
      drum.group.position.set(x, y, z);
      group.add(drum.group);
      const contact = new THREE.Vector3(x, y + style.h / 2, z);   // top-of-head: where a ball lands
      const mouth   = contact.clone().add(MOUTH);
      // the arc is IDENTICAL for every hit on this drum (same mouth → head over FLIGHT),
      // so solve it ONCE: launch velocity, and the dampened bounce-out off the head.
      const v0 = solveLaunch(mouth, contact, FLIGHT);            // SAME solver the melody uses
      const impact = arcVel(v0, FLIGHT);                         // velocity at the instant of contact
      const vOut = new THREE.Vector3(impact.x * .22, Math.abs(impact.y) * .5, impact.z * .22);
      // spout — a chrome funnel the balls are fired from, aimed along the LAUNCH
      // direction (a stub of the future visible spawner machine).
      group.add(buildSpout(mouth, v0));

      const d = { lane, group: drum.group, head: drum.head, contact,
                  lastStrike: -999, style, headBaseY: style.h / 2 };
      drums.push(d);

      // each hit is just a strike TIME on this drum's shared arc
      for (const raw of spec[lane]){
        const { beat: b, vel } = normalizeHit(raw);
        const s = rollT + b * beat;                              // strike time within the loop (lead's timeline)
        hits.push({ drum: d, lane, s, vel, v0, vOut, mouth, struckLoop: null });
      }
    });
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

/* ---- buildDrum — a stationary target: a short shell + a flexing head disc. ---- */
function buildDrum(style, envMap){
  const group = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(style.r, style.r * .94, style.h, 32),
    new THREE.MeshStandardMaterial({ color: style.shell, metalness: .6, roughness: .5, envMap,
      emissive: new THREE.Color(style.shell), emissiveIntensity: .25 }));
  const head = new THREE.Mesh(
    new THREE.CylinderGeometry(style.r * 1.02, style.r * 1.02, style.h * .12, 32),
    new THREE.MeshStandardMaterial({ color: style.head, metalness: .4, roughness: .35, envMap,
      emissive: new THREE.Color(style.head), emissiveIntensity: .35 }));
  head.position.y = style.h / 2;                  // seated on top of the shell
  group.add(shell, head);
  return { group, shell, head };
}

/* ---- buildSpout — a small chrome funnel marking where a lane's balls are fired,
   its wide mouth facing the LAUNCH direction (where balls actually leave). ---- */
function buildSpout(mouth, v0){
  const geo = new THREE.CylinderGeometry(.34, .2, .5, 16, 1, true);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0xc6d0e8, metalness: 1, roughness: .3, side: THREE.DoubleSide,
    emissive: new THREE.Color(0x223047), emissiveIntensity: .4 }));
  m.position.copy(mouth);
  m.lookAt(mouth.clone().add(v0));                // aim down the launch line
  m.rotateX(Math.PI / 2);                         // cylinder's axis (y) → its look direction
  return m;
}
