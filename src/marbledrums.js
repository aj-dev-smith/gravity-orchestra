import * as THREE from 'three';
import { dribbleLane, dribbleAt, dribblePiston } from './engine.js';
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
const KIT_X     = 14.0;     // the station sits right of the melody belt, clear of it…
const KIT_Z     = 5.0;      // …and in front of the wall
const ARC_R     = 11;       // amphitheater radius: the row curves toward the camera at the wings
const GAP       = .55;      // clear air between neighbouring heads along the arc

/* Lane order along the arc, left → right. The toms run HIGH → LOW so a descending
   fill sweeps across the machine as a wave; the kick sits centre-front on its own. */
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

const wrapP = (t, P) => ((t % P) + P) % P;

export function makeMarbleDrums({ envMap, glowTex }){
  let lanes = [];                                       // [{lane, L, style, contact, head, ball, coil, ...}]
  let start = -Infinity;

  /* Rebuild for a song. spec = song.drums; {rollT, beat, P, cx, start}. Returns the
     group for the caller to put under `world` (disposed on the next song change). */
  function build(spec, { rollT, beat, P, cx, start: s0 = -Infinity }){
    const group = new THREE.Group();
    lanes = []; start = s0;
    if (!spec) return group;

    const K = new THREE.Vector3(cx + KIT_X, RISER_TOP, KIT_Z);
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: .16, envMap, envMapIntensity: 1.3 });
    const dark   = new THREE.MeshStandardMaterial({ color: 0x232733, metalness: .7, roughness: .45, envMap });
    group.add(buildDeck(K, dark));

    // place the lanes: kick centre-front, the rest along the arc in ORDER
    const names = Object.keys(spec);
    const row = ORDER.filter(n => names.includes(n))
      .concat(names.filter(n => n !== 'kick' && !ORDER.includes(n)));
    const widths = row.map(n => (STYLE[n] || FALLBACK).r * 2 + GAP);
    const total = widths.reduce((a, b) => a + b, 0);
    let along = -total / 2;
    const slots = {};
    row.forEach((n, i) => {
      const mid = along + widths[i] / 2; along += widths[i];
      const a = mid / ARC_R;                             // arc angle
      slots[n] = new THREE.Vector3(Math.sin(a) * ARC_R, 0, (Math.cos(a) - 1) * ARC_R * -1 - 1.2);
    });
    if (names.includes('kick')) slots.kick = new THREE.Vector3(0, 0, 2.2);

    for (const lane of names){
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
      const column = buildColumn(contact, K.y, style, chrome, dark);
      const mag = buildMagnet(contact, L.H, style, chrome, dark, glowTex);
      const ball = buildBall(style, envMap, glowTex);
      group.add(head.group, column.group, mag.group, ball.g);

      lanes.push({ lane, L, vel, style, contact, head, column, mag, ball,
                   drum: { contact, style: { ball: style.glow } },   // the shape main's drumStrike reads
                   fired: -Infinity, flash: 0 });
    }
    group.add(buildTruss(lanes, K, chrome, dark));
    return group;
  }

  /* Per frame. Pure render of songTime: heads ride their pistons, balls fly their
     solved arcs, magnets light while they hold. Strike edges fire onStrike once each. */
  function update(songTime, P, dt, { started, skipStrikes, onStrike }){
    const t = started ? songTime : start;               // before play: the machine sits ARMED
    for (const ln of lanes){
      const d = dribbleAt(ln.L, t, start);
      const off = started ? dribblePiston(ln.L, t, { start }) : 0;

      // strike edge: the strike we most recently left, if it's fresh and not yet fired
      if (started && d.i >= 0 && d.since <= EDGE_W){
        const at = t - d.since;
        if (at > ln.fired + 1e-6){
          ln.fired = at;
          if (!skipStrikes){
            ln.flash = 1;
            onStrike && onStrike({ lane: ln.lane, vel: ln.vel[d.i], drum: ln.drum });
          }
        }
      }
      ln.flash *= Math.exp(-dt * 9);

      // head on its piston (the rod slides with it; the sleeve stays put)
      ln.head.group.position.y = ln.contact.y + off;
      ln.column.rod.position.y = ln.column.rodY + off;
      ln.head.face.material.emissiveIntensity = .3 + 2.4 * ln.flash;
      const sq = ln.flash * .25;
      ln.head.face.scale.set(1 + sq * .4, 1 - sq, 1 + sq * .4);

      // the ball: underside at contact + d.y
      ln.ball.g.position.set(ln.contact.x, ln.contact.y + ln.style.ball + d.y, ln.contact.z);

      // magnet coil: lit while holding; a quick energize as the ball arrives, a hard cut on release
      const arriving = d.mode === 'arc' && d.vy > 0 && d.until > DT_MAX / 2 ? Math.max(0, 1 - (DT_MAX / 2 - d.since) / .12) : 0;
      const on = d.mode === 'hold' ? 1 : arriving;
      ln.mag.coil.material.emissiveIntensity = .15 + 3.0 * on;
      ln.mag.halo.material.opacity = .5 * on;
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

/* ---- a head: drum = shell + bright face + rim; cymbal = thin bronze disc + bell.
   The face's TOP is at local y = 0 so contact is honest. ---- */
function buildHead(style, envMap, chrome, dark){
  const group = new THREE.Group();
  const r = style.r;
  const face = new THREE.Mesh(
    style.kind === 'cymbal'
      ? new THREE.CylinderGeometry(r * .98, r, .04, 48)
      : new THREE.CylinderGeometry(r, r, .06, 48),
    new THREE.MeshStandardMaterial({ color: style.head, metalness: style.kind === 'cymbal' ? .9 : .2,
      roughness: style.kind === 'cymbal' ? .25 : .5, envMap,
      emissive: new THREE.Color(style.head), emissiveIntensity: .3 }));
  face.position.y = -.03;
  group.add(face);
  if (style.kind === 'cymbal'){
    const bell = new THREE.Mesh(new THREE.SphereGeometry(r * .2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), face.material);
    bell.scale.y = .45; group.add(bell);
  } else {
    const h = r * .55;
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(r * .99, r * .96, h, 48), dark);
    shell.position.y = -.06 - h / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 1.01, .045, 10, 48), chrome);
    rim.rotation.x = Math.PI / 2; rim.position.y = -.01;
    group.add(shell, rim);
  }
  return { group, face };
}

/* ---- the piston column: a fixed dark SLEEVE from the deck, a chrome ROD that slides
   with the head. The rod is what you see push. ---- */
function buildColumn(contact, deckY, style, chrome, dark){
  const group = new THREE.Group();
  const under = style.kind === 'cymbal' ? .05 : .06 + style.r * .55;   // bottom of the head body
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
  return { group, coil, halo, topY: faceY + .56 };
}

/* ---- the overhead TRUSS every magnet hangs from: one chrome spine riding the arc
   above the heads, an end tower at each wing down to the deck, a drop rod per magnet,
   and a forward boom out to the kick. One structure instead of a forest of posts. ---- */
function buildTruss(lanes, K, chrome, dark){
  const group = new THREE.Group();
  const top = Math.max(...lanes.map(l => l.mag.topY)) + .7;
  const row = lanes.filter(l => l.lane !== 'kick');
  const kick = lanes.find(l => l.lane === 'kick');
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
  if (kick){                                             // boom from the truss centre out over the kick
    const c = row.length ? row.reduce((a, l) => a.add(l.contact), new THREE.Vector3()).divideScalar(row.length) : kick.contact;
    const z0 = Math.min(c.z, kick.contact.z), z1 = kick.contact.z + .4;
    const boom = new THREE.Mesh(new THREE.BoxGeometry(.12, .12, z1 - z0), chrome);
    boom.position.set(kick.contact.x, top, (z0 + z1) / 2); group.add(boom);
    rod(kick.contact.x, kick.contact.z, kick.mag.topY, top);
    if (!row.length) rod(kick.contact.x, kick.contact.z + .4, K.y, top, .14, dark);
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
  return { g, core, halo };
}
