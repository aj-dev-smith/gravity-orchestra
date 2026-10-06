import * as THREE from 'three';
import { G, dribbleLane, dribbleAt, dribblePiston, firstStrike } from './engine.js';
import { normalizeHit } from './drumkit.js';

/* ============================================================
   MARBLE DRUMS — the drum machine, rebuilt from the ground up.
   Render subsystem, same DI'd shape as conveyor.js / camera.js.

   THE ONE IDEA: one immortal ball per drum, and it only ever
   bounces on THAT drum. The flight between two strikes is the
   solved vertical arc for the gap (engine.js dribbleAt — apex =
   |G|·gap²/8, the belt's dt² grammar), so the groove is readable
   from across the room: the hat ball buzzes, the kick ball heaves,
   the snare lands on 2 and 4. No allocator, no feed, no plumbing —
   lanes never interact, polyphony is free, nothing ever appears or
   vanishes.

   What keeps it REAL:
   · every head rides a PISTON (dribblePiston) that visibly supplies
     each change in bounce energy — kick up for a taller arc, give
     for a shorter one — and is exactly at rest at contact;
   · a gap too long to fly ends on an ELECTROMAGNET hung at exactly
     the max apex: the ball arrives at zero speed, the coil lights
     and holds it, then cuts and the ball free-falls onto the beat;
   · ball size is the drum's: the kick throws a chrome cannonball,
     the hat a BB.

   Every frame is re-derived from songTime (time is the only state).
   ============================================================ */

const DT_MAX    = 1.2;      // longest flown gap (s) → magnet height H = |G|·DT_MAX²/8 ≈ 2.6
const EDGE_W    = .25;      // strike-edge window (s): a strike fires once if we land within it
const RISER_TOP = 1.5;      // deck height (world y) — shared with the room/floor staging
/* The kit's slot (x relative to the belt wall's centre, z toward the audience). It has
   two homes: beside the belt when it is the only other machine (KIT_SOLO — right of the
   belt, clear of it, in front of the wall), and the FRONT-RIGHT of the amphitheater when
   the room is full of instrument plugins (KIT_ROOM — see src/instruments/stations.js,
   where the tiers are laid out around it). main picks one per song and reads it back for
   the director's drums shot. */
export const KIT_SOLO = { x: 14, z: 5 };
export const KIT_ROOM = { x: 11, z: 19 };
const ARC_R     = 11;       // amphitheater radius: the row curves toward the camera at the wings
const GAP       = .55;      // clear air between neighbouring heads along the arc

/* Lane order along the arc, left → right. The toms run HIGH → LOW so a descending
   fill sweeps across the machine as a wave; the kick is spliced in dead centre. */
const ORDER = ['crash', 'hatOpen', 'hat', 'clap', 'snare',
               'tomHigh', 'tomHiMid', 'tomMid', 'tomLow', 'floorHigh', 'ride'];

/* Per-lane look. r = head radius, ball = marble radius (mass reads as size),
   lift = head height above the deck, kind picks the head builder. */
const STYLE = {
  kick:      { r: 1.30, ball: .34, lift: 1.0, kind: 'drum',   head: 0xff8a3d, glow: 0xffb066, chrome: true },
  snare:     { r: .72,  ball: .20, lift: 1.7, kind: 'drum',   head: 0xeaf0ff, glow: 0xbfe0ff },
  hat:       { r: .62,  ball: .13, lift: 2.1, kind: 'cymbal', head: 0xffe27a, glow: 0xfff0a8 },
  hatOpen:   { r: .62,  ball: .13, lift: 2.2, kind: 'cymbal', head: 0xffe8a0, glow: 0xfff0a8 },
  clap:      { r: .58,  ball: .17, lift: 1.8, kind: 'drum',   head: 0xff9ad8, glow: 0xffc0e8 },
  tomHigh:   { r: .58,  ball: .18, lift: 1.9, kind: 'drum',   head: 0xffd668, glow: 0xffe898 },
  tomHiMid:  { r: .64,  ball: .20, lift: 1.8, kind: 'drum',   head: 0xffbe68, glow: 0xffdc98 },
  tomMid:    { r: .70,  ball: .22, lift: 1.7, kind: 'drum',   head: 0xffa468, glow: 0xffcc98 },
  tomLow:    { r: .78,  ball: .24, lift: 1.6, kind: 'drum',   head: 0xff8868, glow: 0xffbc98 },
  floorHigh: { r: .90,  ball: .27, lift: 1.4, kind: 'drum',   head: 0xff665a, glow: 0xffa692 },
  crash:     { r: .95,  ball: .16, lift: 2.6, kind: 'cymbal', head: 0xfff0b0, glow: 0xfff6d0 },
  ride:      { r: .95,  ball: .16, lift: 2.5, kind: 'cymbal', head: 0xe8f0b0, glow: 0xf2f8d0 },
};
const FALLBACK = STYLE.snare;

// ---- the juice knobs (feel-tunables) ----
const TRAIL_N    = 9;       // ghost-trail samples per ball
const TRAIL_DT   = .016;    // seconds between ghost samples
const RIPPLE_K   = .016;    // membrane wave amplitude per unit impact speed…
const RIPPLE_MAX = .13;     // …capped
const WOBBLE     = { hat: .07, hatOpen: .1, crash: .26, ride: .18 };   // cymbal wobble (rad) at full impact
const LIGHTS     = 4;       // strike-light pool (a constant count → no shader recompiles)
const LIGHT_PEAK = 9;       // strike-light intensity at full velocity

const wrapP = (t, P) => ((t % P) + P) % P;

export function makeMarbleDrums({ envMap, glowTex }){
  let lanes = [];                                       // [{lane, L, style, contact, head, ball, coil, ...}]
  let start = -Infinity;
  let lights = [], lightIdx = 0;                        // strike-light pool (rebuilt per song, constant size)

  /* Rebuild for a song. spec = song.drums; {rollT, beat, P, cx, start}. Returns the
     group for the caller to put under `world` (disposed on the next song change). */
  function build(spec, { rollT, beat, P, cx, start: s0 = -Infinity, slot = KIT_SOLO }){
    const group = new THREE.Group();
    lanes = []; start = s0; lights = [];
    if (!spec) return group;

    const K = new THREE.Vector3(cx + slot.x, RISER_TOP, slot.z);
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: .16, envMap, envMapIntensity: 1.3 });
    const dark   = new THREE.MeshStandardMaterial({ color: 0x232733, metalness: .7, roughness: .45, envMap });
    group.add(buildDeck(K, dark));

    // place the lanes along the arc in ORDER, with the kick dead centre: the biggest drum
    // anchors the middle of the machine, and a tom fill sweeps right across it
    const names = Object.keys(spec);
    const row = ORDER.filter(n => names.includes(n))
      .concat(names.filter(n => n !== 'kick' && !ORDER.includes(n)));
    if (names.includes('kick')) row.splice(Math.ceil(row.length / 2), 0, 'kick');
    const widths = row.map(n => (STYLE[n] || FALLBACK).r * 2 + GAP);
    const total = widths.reduce((a, b) => a + b, 0);
    let along = -total / 2;
    const slots = {};
    row.forEach((n, i) => {
      const mid = along + widths[i] / 2; along += widths[i];
      const a = mid / ARC_R;                             // arc angle
      slots[n] = new THREE.Vector3(Math.sin(a) * ARC_R, 0, (Math.cos(a) - 1) * ARC_R * -1 - 1.2);
    });

    for (const lane of row){                             // in ARC order — the truss threads them in sequence
      const style = STYLE[lane] || FALLBACK;
      const hits = spec[lane].map(normalizeHit);
      const strikes = hits.map(h => rollT + h.beat * beat);
      const L = dribbleLane(strikes, P, { dtMax: DT_MAX });
      const vel = L.s.map(s => Math.max(...hits
        .filter((h, k) => Math.abs(wrapP(strikes[k], P) - s) < 1e-9).map(h => h.vel)));
      const slot = slots[lane];
      const contact = new THREE.Vector3(K.x + slot.x, K.y + style.lift, K.z + slot.z);

      const head = buildHead(style, envMap, chrome, dark);
      head.group.position.copy(contact);
      const column = buildColumn(contact, K.y, head.depth, chrome, dark);
      const mag = buildMagnet(contact, L.H, style, chrome, dark, glowTex);
      const ball = buildBall(style, envMap, glowTex);
      group.add(head.group, column.group, mag.group, ball.g, ball.ghosts);

      lanes.push({ lane, L, vel, style, contact, head, column, mag, ball,
                   vMax: L.vOut.length ? Math.max(...L.vOut) : 1,
                   first: firstStrike(L, start),               // the armed drop's landing, absolute
                   wobbleA: WOBBLE[lane] ?? .12, wobbleAxis: lanes.length * 2.4,   // each cymbal precesses its own way
                   drum: { contact, style: { ball: style.glow } },   // the shape main's drumStrike reads
                   fired: -Infinity, flash: 0 });
    }
    group.add(buildTruss(lanes, K, chrome, dark));

    // the STRIKE LIGHTS: a small round-robin pool — every hit throws its colour into the room
    lights = Array.from({ length: LIGHTS }, () => {
      const l = new THREE.PointLight(0xffffff, 0, 7, 2);
      group.add(l); return { l, age: 9, peak: 0 };
    });
    lightIdx = 0;
    return group;
  }

  /* Per frame. Pure render of songTime: heads ride their pistons, balls fly their
     solved arcs, magnets light while they hold. Strike edges fire onStrike once each. */
  function update(songTime, P, dt, { started, skipStrikes, onStrike }){
    const t = started ? songTime : start;               // before play: the machine sits ARMED
    const half = DT_MAX / 2;
    for (const ln of lanes){
      const d = dribbleAt(ln.L, t, start);
      const off = started ? dribblePiston(ln.L, t, { start }) : 0;
      // impact speed of the strike we last left (the armed first drop lands at full speed)
      const vHit = d.i < 0 ? 0 : Math.abs(t - d.since - ln.first) < 1e-6 ? -G.y * half : ln.L.vIn[d.i];

      // strike edge: the strike we most recently left, if it's fresh and not yet fired
      if (started && d.i >= 0 && d.since <= EDGE_W){
        const at = t - d.since;
        if (at > ln.fired + 1e-6){
          ln.fired = at;
          if (!skipStrikes){
            ln.flash = 1;
            const vel = ln.vel[d.i];
            onStrike && onStrike({ lane: ln.lane, vel, drum: ln.drum });
            const L = lights[lightIdx++ % lights.length];        // throw this hit's colour into the room
            if (L){ L.l.color.set(ln.style.glow); L.l.position.set(ln.contact.x, ln.contact.y + .7, ln.contact.z + .4);
                    L.age = 0; L.peak = LIGHT_PEAK * (.35 + .65 * vel) * (ln.lane === 'kick' ? 1.6 : 1); }
          }
        }
      }
      ln.flash *= Math.exp(-dt * 9);

      // head on its piston (the rod slides with it; the sleeve stays put)
      ln.head.group.position.y = ln.contact.y + off;
      ln.column.rod.position.y = ln.column.rodY + off;
      ln.head.face.material.emissiveIntensity = .3 + 2.4 * ln.flash;

      // drum: the membrane ripple — a pure fn of time since the strike and its impact speed
      if (ln.head.membrane){
        ln.head.membrane.uAge.value = d.i < 0 ? 99 : d.since;
        ln.head.membrane.uAmp.value = Math.min(RIPPLE_MAX, RIPPLE_K * vHit);
      }
      // cymbal: a precessing WOBBLE about the bell. It grows from zero at the strike and is
      // tapered back to level by the next one, so every contact lands on a level cymbal.
      if (ln.head.tilt){
        let th = 0, ph = 0;
        if (d.i >= 0 && started){
          const s = d.since, gap = d.since + d.until;
          const taper = Math.max(0, 1 - s / gap) ** 2;
          th = ln.wobbleA * Math.min(1, vHit / ln.vMax) * (1 - Math.exp(-s * 14)) * Math.exp(-s * 1.4) * taper;
          ph = ln.wobbleAxis + s * 9;                     // the wobble axis walks round — real cymbal precession
        }
        ln.head.tilt.rotation.set(th * Math.cos(ph), 0, th * Math.sin(ph));
      }

      // the ball: underside at contact + d.y
      const by = ln.contact.y + ln.style.ball;
      ln.ball.g.position.set(ln.contact.x, by + d.y, ln.contact.z);

      // ghost trail: the ball's own past, re-sampled from the solved arc (dim while slow/held)
      const speed = Math.min(1, Math.abs(d.vy) / 6);
      ln.ball.trail.forEach((s, j) => {
        const tj = t - (j + 1) * TRAIL_DT;
        if (!started || tj < start || speed < .05){ s.material.opacity = 0; return; }
        s.position.set(ln.contact.x, by + dribbleAt(ln.L, tj, start).y, ln.contact.z);
        const f = 1 - (j + 1) / (TRAIL_N + 1);
        s.material.opacity = .32 * f * speed;
        s.scale.setScalar(ln.style.ball * 3.4 * (.4 + .6 * f));
      });

      // magnet coil: energizes as the ball arrives, CLACKS bright the instant it docks,
      // settles to a steady hold glow, and cuts hard on release
      let on = 0;
      if (d.mode === 'hold'){
        const docked = d.i < 0 ? 9 : d.since - half;      // time since the ball docked (armed: long ago)
        on = 1 + 2.2 * Math.exp(-docked * 9);
      } else if (d.mode === 'arc' && d.vy > 0 && d.until > half){
        on = Math.max(0, 1 - (half - d.since) / .12);
      }
      ln.mag.coil.material.emissiveIntensity = .15 + 3.0 * on;
      ln.mag.halo.material.opacity = Math.min(1, .5 * on);
      ln.mag.halo.scale.setScalar(ln.mag.haloS * (1 + .35 * Math.max(0, on - 1)));
    }
    for (const L of lights){                             // strike lights: a hard flash, a quick decay
      L.age += dt;
      L.l.intensity = L.peak * Math.exp(-L.age * 11);
    }
  }

  return { build, update };
}

/* ---- the riser deck the station stands on ---- */
function buildDeck(K, mat){
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(ARC_R * .62, ARC_R * .66, .3, 64, 1, false, -1.05, 2.1), mat);
  deck.position.set(K.x, K.y - .15, K.z - ARC_R * .45);
  return deck;
}

/* ---- a head. The struck surface's TOP is at local y = 0 so contact is honest.
   drum   = a real MEMBRANE (ripple shader, below) over an open shell + chrome hoop.
   cymbal = a bronze disc whose BELL top sits at y = 0 (the ball lands on the bell);
            the whole cymbal wobbles about that point (wobble, in update). ---- */
function buildHead(style, envMap, chrome, dark){
  const group = new THREE.Group();
  const r = style.r;
  if (style.kind === 'cymbal'){
    const mat = new THREE.MeshStandardMaterial({ color: style.head, metalness: .9, roughness: .25, envMap,
      emissive: new THREE.Color(style.head), emissiveIntensity: .3 });
    const bellH = r * .2 * .45;
    const tilt = new THREE.Group();                      // the wobble pivot — at the contact point
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * .98, r, .04, 48), mat);
    disc.position.y = -bellH - .02;
    const bell = new THREE.Mesh(new THREE.SphereGeometry(r * .2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    bell.scale.y = .45; bell.position.y = -bellH;
    tilt.add(disc, bell); group.add(tilt);
    return { group, face: disc, tilt, depth: bellH + .04 };
  }
  const { mesh: face, uniforms } = buildMembrane(style, envMap);
  const h = r * .55;
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r * .99, r * .96, h, 48, 1, true), dark);
  shell.position.y = -h / 2 - .005;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(r * .96, 48), dark);   // closes the shell's bottom
  floor.rotation.x = Math.PI / 2; floor.position.y = -h;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 1.01, .045, 10, 48), chrome);
  rim.rotation.x = Math.PI / 2; rim.position.y = .005;
  group.add(face, shell, floor, rim);
  return { group, face, membrane: uniforms, depth: h };
}

/* ---- the drumhead MEMBRANE: a finely-ringed disc whose vertex shader displaces a
   circular wave travelling out from the contact point, clamped to zero at the hoop
   (a real fixed-edge membrane) and decaying. The same wave brightens the emissive,
   so every strike sends a ring of light across the head — under bloom, it glows.
   Driven by uAge (time since the last strike — a pure fn of songTime) and uAmp. ---- */
function buildMembrane(style, envMap){
  const R = style.r * .99;
  const geo = new THREE.RingGeometry(0, R, 72, 28);      // many rings → a smooth radial wave
  geo.rotateX(-Math.PI / 2);                             // lie flat, facing up: local +y is the wave axis
  const mat = new THREE.MeshStandardMaterial({ color: style.head, metalness: .1, roughness: .55, envMap,
    emissive: new THREE.Color(style.head), emissiveIntensity: .3, side: THREE.DoubleSide });
  const uniforms = { uAge: { value: 99 }, uAmp: { value: 0 }, uR: { value: R } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'uniform float uAge, uAmp, uR;\nvarying float vWave;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float rr = length(position.xz);
      float front = 3.0 * uAge;                                      // wave speed (u/s)
      float lead = 1.0 - smoothstep(front - .2, front, rr);          // nothing ahead of the front
      float edge = 1.0 - (rr * rr) / (uR * uR);                      // fixed at the hoop
      float w = uAmp * exp(-uAge * 4.0) * sin(20.0 * (rr - front)) * lead * edge;
      transformed.y += w;
      vWave = abs(w) / max(uAmp, 1e-4);`);
    sh.fragmentShader = 'varying float vWave;\n' + sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance *= 1.0 + vWave * 4.0;`);
  };
  return { mesh: new THREE.Mesh(geo, mat), uniforms };
}

/* ---- the piston column: a fixed dark SLEEVE from the deck, a chrome ROD that slides
   with the head. The rod is what you see push. ---- */
function buildColumn(contact, deckY, under, chrome, dark){   // under = head body depth below contact
  const group = new THREE.Group();
  const top = contact.y - under, span = top - deckY;
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(.16, .2, span * .6, 20), dark);
  sleeve.position.set(contact.x, deckY + span * .3, contact.z);
  const rodLen = span * .7;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, rodLen, 16), chrome);
  const rodY = top - rodLen / 2;
  rod.position.set(contact.x, rodY, contact.z);
  group.add(sleeve, rod);
  return { group, rod, rodY };
}

/* ---- an electromagnet, hung so its face sits exactly where the ball's TOP is at the
   max apex. Its drop rod up to the truss is added by the build (it needs the truss). ---- */
function buildMagnet(contact, H, style, chrome, dark, glowTex){
  const group = new THREE.Group();
  const faceY = contact.y + H + style.ball * 2;          // ball underside at H → ball top at H + 2r
  const mr = Math.max(.2, style.ball * 1.6);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(mr, mr, .5, 24), chrome);
  body.position.set(contact.x, faceY + .25, contact.z);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(mr * 1.08, mr * 1.08, .08, 24), dark);
  cap.position.set(contact.x, faceY + .52, contact.z);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(mr * .82, .05, 10, 32),
    new THREE.MeshStandardMaterial({ color: 0x331a10, emissive: new THREE.Color(0xff5a1e), emissiveIntensity: .15 }));
  coil.rotation.x = Math.PI / 2; coil.position.set(contact.x, faceY + .03, contact.z);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff7a3a, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(mr * 4); halo.position.copy(coil.position);
  group.add(body, cap, coil, halo);
  return { group, coil, halo, haloS: mr * 4, topY: faceY + .56 };
}

/* ---- the overhead TRUSS every magnet hangs from: one chrome spine riding the arc
   above the heads (lanes arrive in arc order), an end tower at each wing down to the
   deck, a drop rod per magnet. One structure instead of a forest of posts. ---- */
function buildTruss(lanes, K, chrome, dark){
  const group = new THREE.Group();
  const top = Math.max(...lanes.map(l => l.mag.topY)) + .7;
  const row = lanes;
  const rod = (x, z, y0, y1, r = .045, mat = chrome) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, y1 - y0, 10), mat);
    m.position.set(x, (y0 + y1) / 2, z); group.add(m);
  };
  if (row.length){
    const pts = row.map(l => new THREE.Vector3(l.contact.x, top, l.contact.z));
    const ext = (a, b) => a.clone().add(a.clone().sub(b).setLength(1.2));   // run past the wing drums
    if (pts.length > 1){ pts.unshift(ext(pts[0], pts[1])); pts.push(ext(pts[pts.length - 1], pts[pts.length - 2])); }
    else pts.push(pts[0].clone().add(new THREE.Vector3(.01, 0, 0)));
    const curve = new THREE.CatmullRomCurve3(pts);
    for (const off of [0, .32]){                         // a two-rail truss: chord + a lower rail
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, off ? .05 : .09, 10), off ? dark : chrome);
      tube.position.y = -off; group.add(tube);
    }
    for (const p of [pts[0], pts[pts.length - 1]]) rod(p.x, p.z, K.y, top, .14, dark);   // end towers
    for (const l of row) rod(l.contact.x, l.contact.z, l.mag.topY, top - .32);         // drop rods
  }
  return group;
}

/* ---- a marble: chrome core with a lane-tinted glow; the kick's is a cannonball ---- */
function buildBall(style, envMap, glowTex){
  const r = style.ball;
  const core = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18),
    new THREE.MeshStandardMaterial({ color: style.chrome ? 0xb8c0cc : 0xffffff, metalness: style.chrome ? 1 : .3,
      roughness: style.chrome ? .1 : .25, envMap,
      emissive: new THREE.Color(style.glow), emissiveIntensity: style.chrome ? .25 : 1.1 }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: style.glow,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: style.chrome ? .08 : .16 }));
  halo.scale.setScalar(r * 5);
  const g = new THREE.Group(); g.add(core, halo);
  // GHOST TRAIL: sprites placed at the ball's own PAST positions, re-sampled from the
  // solved arc every frame — time is the only state, so the trail is scrub-safe too.
  const ghosts = new THREE.Group();
  const trail = Array.from({ length: TRAIL_N }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: style.glow,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    ghosts.add(s); return s;
  });
  return { g, core, halo, ghosts, trail };
}
