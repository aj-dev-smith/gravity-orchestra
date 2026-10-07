import * as THREE from 'three';
import { dribbleAt, dribblePiston, firstStrike } from './engine.js';
import { styleOf, kitPieces, pieceLane, clutchFrom, wireBuzz, shockAges, shockRing, DROP_V, DT_MAX, MAG_H, HW,
         kitFrame, stairTreads, pieceFloor, STANDS, TRIPOD, HAT, hatLinkage,
         cymbalSchedule, cymbalPose, cymbalPiston, cymbalPivot, cymbalUnder, clampLip, CLAMP } from './drumparts.js';
import { V, fz, bar, kitMaterials, buildDrum, buildWires, cymbalProfile, cymbalGeometry, bronze,
         buildMagnet, buildArch, buildDeck, buildStair, coilSpring, freeze } from './drumlook.js';

/* ============================================================
   MARBLE DRUMS — the drum machine. Render subsystem, same DI'd
   shape as paternoster.js / camera.js.

   THE ONE IDEA: one immortal ball per drum, and it only ever
   bounces on THAT drum. The flight between two strikes is the
   solved vertical arc for the gap (engine.js dribbleAt — apex =
   |G|·gap²/8, the belt's dt² grammar), so the groove is readable
   from across the room: the hat ball buzzes, the kick ball heaves,
   the snare lands on 2 and 4. No allocator, no feed, no plumbing.

   What keeps it REAL:
   · every head rides a PISTON (dribblePiston) that visibly supplies
     each change in bounce energy, exactly at rest at contact;
   · a gap too long to fly ends on an ELECTROMAGNET hung at exactly
     the max apex — the ball docks at zero speed, the coil clacks and
     holds, then cuts and the ball free-falls onto the beat;
   · ball size is the drum's: the kick throws a chrome cannonball.

   THE FRESH COAT (drumlook.js builds it, drumparts.js solves it):
   sparkle-lacquer shells with chrome lugs/rods/hoops under coated
   heads; lathed bronze cymbals; the toms climb a SPIRAL STAIRCASE
   (pitch = height — a fill is a visible descent, its steps' nosings
   flashing in turn); crash + ride on booms; the magnets hang from a
   BANDSHELL that fans open toward the audience, all of it sized to the
   kit actually built. Parts that REACT,
   each a pure fn of songTime with a visible cause: SNARE WIRES rattle
   under the snare on every hit; the HI-HAT is one pair of cymbals on
   one ball, its CLUTCH (pedal → rocker → pull-tube → bottom cymbal,
   a return spring) solved from the merged hat/hatOpen sequence so the
   pair is open exactly on open hits — pedal down = closed, like a real one; the KICK lands and a SHOCKWAVE rings out across the
   riser floor's grille. THE CYMBALS (crash, ride + its bell, china, splash) hang on
   booms; each ball strikes its ZONE (edge / bow / bell — drumparts CYMBALS), the cymbal
   then SWINGS as a damped pendulum about the rod tip, and a magnet CLAMP under the bell
   levels it before every strike, parks it when the swing dies and CHOKES it on cue
   (drumparts cymbalPose — a pure fn of songTime).

   Every frame is re-derived from songTime (time is the only state).
   ============================================================ */

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

// ---- the juice knobs (feel-tunables) ----
const TRAIL_N    = 9;       // ghost-trail samples per ball
const TRAIL_DT   = .016;    // seconds between ghost samples
const RIPPLE_K   = .016;    // membrane wave amplitude per unit impact speed…
const RIPPLE_MAX = .13;     // …capped
const WOBBLE     = { hat: .09 };   // hi-hat wobble (rad) at full impact (the hung cymbals swing per drumparts SWING)
const LIGHTS     = 4;       // strike-light pool (a constant count → no shader recompiles)
const LIGHT_PEAK = 9;       // strike-light intensity at full velocity
const TRIM_BASE  = 1.1;     // a stair nosing's resting glow (it flashes on its tom's strike)
// ---- hardware dimensions (drumparts HW: shared with the layout solve) ----
const { ROD_VIS, ROD_IN, SLEEVE } = HW;

/* The kit's footprint for room staging (the Void grows a plinth under it): `slot` is the
   song's KIT_SOLO / KIT_ROOM. Matches the deck of the kit LAST BUILT (main builds the kit
   before it places the room) — sized to that song's pieces (drumparts kitFrame). */
let lastDeck = { x0: -9.3, x1: 9.3, z0: -6.4, z1: 3.4 };
export function kitAnchor(cx, slot){
  const D = lastDeck;
  return { x: cx + slot.x + (D.x0 + D.x1) / 2, z: slot.z + (D.z0 + D.z1) / 2, w: D.x1 - D.x0, d: D.z1 - D.z0, yaw: 0, y: RISER_TOP };
}

export function makeMarbleDrums({ envMap, glowTex }){
  let pieces = [];
  let start = -Infinity;
  let lights = [], lightIdx = 0;
  let deckU = null, kickPc = null, cyms = [];

  /* Rebuild for a song. spec = song.drums; {rollT, beat, P, cx, start, slot}. Returns the
     group for the caller to put under `world` (disposed on the next song change). */
  function build(spec, { rollT, beat, P, cx, start: s0 = -Infinity, slot = KIT_SOLO }){
    const group = new THREE.Group();
    pieces = []; start = s0; lights = []; deckU = null; kickPc = null; cyms = [];
    if (!spec || !Object.keys(spec).length) return group;

    const K = V(cx + slot.x, RISER_TOP, slot.z);
    const kit = new THREE.Group(); kit.position.copy(K); group.add(kit);
    const mats = kitMaterials(envMap);
    const H = MAG_H;

    const layout = kitPieces(spec);
    const F = kitFrame(layout);                          // deck + shell sized to THIS kit
    lastDeck = F.deck;
    const deck = buildDeck(mats, layout.find(p => p.key === 'kick'), F);
    kit.add(deck.deck, deck.lip);
    deckU = deck.u;

    // the staircase: each tom's tread sits so its sleeve straddles it
    const seats = layout.filter(p => p.seat).map(p => ({ ...p.seat, r: styleOf(p.key).r,
      trimMat: new THREE.MeshStandardMaterial({ color: 0x100804, emissive: new THREE.Color(styleOf(p.key).flake), emissiveIntensity: TRIM_BASE }) }));
    kit.add(buildStair(stairTreads(layout), seats, mats).group);

    /* ---- per-piece builders ---- */
    const supportUnder = (x, z, top, floorY, r, wide) => {   // a sleeve from `top` down, standing on `floorY`
      const bot = Math.max(floorY - .25, top - SLEEVE);
      const sleeve = fz(new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, top - bot, 20), mats.dark));
      sleeve.position.set(x, (top + bot) / 2, z); kit.add(sleeve);
      const cap = fz(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.35, r * 1.35, .1, 20), mats.chrome));
      cap.position.set(x, top - .05, z); kit.add(cap);
      if (floorY === 0 && bot > .3){                     // a chrome tripod on the deck (a short post just stands on a flange)
        for (let k = 0; k < 3; k++){
          const a = k * 2.094 + .5, rr = wide ? .9 : .6;
          kit.add(fz(bar(V(x, bot + .12, z), V(x + rr * Math.sin(a), .02, z + rr * Math.cos(a)), .028, mats.chrome, 8)));
        }
        const col = fz(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.4, r * 1.4, .14, 16), mats.chrome));
        col.position.set(x, bot + .07, z); kit.add(col);
        const ext = fz(new THREE.Mesh(new THREE.CylinderGeometry(r * .7, r * .7, bot, 12), mats.dark));   // the centre column to the deck
        ext.position.set(x, bot / 2, z); kit.add(ext);
      } else {
        const fl = fz(new THREE.Mesh(new THREE.CylinderGeometry(r * 2.2, r * 2.6, .1, 24), mats.iron));
        fl.position.set(x, Math.max(floorY, bot) + .05, z); kit.add(fl);
      }
    };

    const buildDrumPiece = (p, st, c, floorY) => {
      const h = buildDrum(st, envMap, mats);
      h.group.position.copy(c); kit.add(h.group);
      const big = p.key === 'kick';
      const rodR = big ? .12 : .06;
      // the piston rod hangs from the basket hub and rides with the head
      const sTop = c.y - h.under - ROD_VIS;
      const rodL = ROD_VIS + Math.min(ROD_IN, sTop - Math.max(floorY - .25, sTop - SLEEVE) - .03);   // never out the sleeve's foot
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(rodR, rodR, rodL, 16), mats.chrome);
      rod.position.y = -h.under - rodL / 2; h.group.add(rod);
      supportUnder(c.x, c.z, sTop, floorY, big ? .3 : .13, big);
      if (p.key === 'snare'){
        const w = buildWires(st, mats, st.glow);
        h.group.add(w.wires, w.plates);
        h.wires = w.u;
      }
      return h;
    };

    const buildHatPiece = (p, st, c) => {
      const Pf = cymbalProfile(st.r), geo = cymbalGeometry(st.r), mat = bronze(st, envMap);
      const group = new THREE.Group(); group.position.copy(c); kit.add(group);
      const tilt = new THREE.Group(); group.add(tilt);   // the wobble pivot — at the contact point
      const top = new THREE.Mesh(geo, mat); tilt.add(top);
      const felt = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, .05, 14), mats.felt);
      felt.position.y = -Pf.under - .02; group.add(felt);
      const h = { group, tilt, face: top, bronze: mat, depth: Pf.under };
      if (p.key === 'hat'){
        // the HI-HAT: the piston carries the pair; the TOP cymbal (the struck one) is fixed
        // on it so contact stays honest, the BOTTOM one rides a pull-tube that the clutch
        // moves (drumparts hatLinkage): pedal pressed → rocker lifts the tube → closed.
        const bot = new THREE.Group(); group.add(bot);
        bot.add(new THREE.Mesh(geo, mat));
        h.bot0 = -(Pf.th(0) + .006);                    // closed: nested right under the top
        bot.position.y = h.bot0;
        const collarY = h.bot0 - Pf.under - .06;        // group-local
        const tubeL = c.y + collarY - HAT.endY;         // closed: the tube's end at the rocker pin
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(.034, .034, tubeL, 12), mats.chrome);
        tube.position.y = collarY - tubeL / 2; bot.add(tube);
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(.075, .075, .07, 14), mats.iron);
        collar.position.y = collarY; bot.add(collar);
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .14, 8), mats.iron);
        pin.rotation.z = Math.PI / 2; pin.position.y = collarY - tubeL; bot.add(pin);
        const rodL = Pf.under + HAT.OPEN + .3;          // the top cymbal's rod, riding inside the tube
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, rodL, 8), mats.chrome);
        rod.position.y = -rodL / 2; group.add(rod);
        // the STAND: a sleeve the tube slides in, on a tripod; the rocker housing at its foot
        const sTop = c.y + collarY - HAT.OPEN - .14, sBot = 1.0;
        const sl = fz(new THREE.Mesh(new THREE.CylinderGeometry(.065, .075, sTop - sBot, 16), mats.dark));
        sl.position.set(c.x, (sTop + sBot) / 2, c.z); kit.add(sl);
        const ring = fz(new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, .1, 16), mats.chrome)); ring.position.set(c.x, sBot + .05, c.z); kit.add(ring);
        for (let k = 0; k < 3; k++){ const a = k * 2.094 + 3.3;
          kit.add(fz(bar(V(c.x, sBot + .05, c.z), V(c.x + TRIPOD * Math.sin(a), .02, c.z + TRIPOD * Math.cos(a)), .028, mats.chrome, 8))); }
        const Q = V(c.x, HAT.q.y, c.z + HAT.q.z);
        const housing = fz(new THREE.Mesh(new THREE.BoxGeometry(.2, .16, .2), mats.iron)); housing.position.copy(Q); kit.add(housing);
        kit.add(fz(bar(V(c.x, .02, c.z + HAT.q.z), V(c.x, Q.y - .08, c.z + HAT.q.z), .04, mats.iron, 8)));   // the housing's post
        const axle = fz(new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .3, 10), mats.chrome)); axle.rotation.z = Math.PI / 2; axle.position.copy(Q); kit.add(axle);
        const rocker = new THREE.Group(); rocker.position.copy(Q); kit.add(rocker);
        rocker.add(new THREE.Mesh(new THREE.BoxGeometry(.05, .05, 2 * HAT.arm + .08), mats.chrome));
        // the return SPRING: rocker front end → a hook on a bracket off the stand
        const toe0 = hatLinkage(0).toe;
        kit.add(fz(bar(V(c.x, HAT.hook + .04, c.z), V(c.x, HAT.hook + .04, c.z + toe0.z), .022, mats.chrome, 8)));
        const spring = coilSpring(11, .045, .009, mats.chrome);
        kit.add(spring.mesh);
        // the PEDAL: a baseplate, a heel hinge, a footboard; a rigid link toe → rocker
        const plate = fz(new THREE.Mesh(new THREE.BoxGeometry(.34, .03, HAT.heelZ - HAT.q.z + .35), mats.iron));
        plate.position.set(c.x, .015, c.z + (HAT.heelZ + HAT.q.z) / 2 + .05); kit.add(plate);
        const heel = fz(new THREE.Mesh(new THREE.BoxGeometry(.38, .12, .16), mats.iron));
        heel.position.set(c.x, .06, c.z + HAT.heelZ + .03); kit.add(heel);
        const pedal = new THREE.Group(); pedal.position.set(c.x, .1, c.z + HAT.heelZ); kit.add(pedal);
        const board = new THREE.Mesh(new THREE.BoxGeometry(.3, .035, HAT.pedalL), mats.chrome);
        board.position.z = -HAT.pedalL / 2; pedal.add(board);
        const link = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, 1, 6), mats.chrome); kit.add(link);
        Object.assign(h, { bot, rocker, spring, pedal, link, under: Pf.under });
      }
      return h;
    };

    /* a HUNG cymbal (crash / ride / china / splash): on a boom, swinging about its rod tip,
       the magnet CLAMP under its bell. Built once per cymbal — the ride bell's ball shares
       the ride's. */
    const buildHung = p => {
      const on = p.cym, st = styleOf(on), Pf = cymbalProfile(st.r);
      const mat = bronze(st, envMap), geo = cymbalGeometry(st.r, !!st.inverted);
      const group = new THREE.Group(); group.position.set(p.cx, p.bell, p.cz); kit.add(group);   // rides the piston
      const pivotY = cymbalPivot(on);
      const tilt = new THREE.Group(); tilt.position.y = pivotY; group.add(tilt);   // the swing pivot: the rod tip
      const top = new THREE.Mesh(geo, mat); top.position.y = -pivotY; tilt.add(top);
      // the CLAMP: a copper-wound ring pot with a felt lip, sliding on the rod; it rises
      // CLAMP.gap into the bell mouth to grip (clamp-local y = 0 is the felt's top)
      const lipR = clampLip(on), clampY = cymbalUnder(on, lipR);
      const clamp = new THREE.Group(); clamp.position.y = clampY; group.add(clamp);
      const felt = new THREE.Mesh(new THREE.TorusGeometry(lipR, .022, 8, 32), mats.felt);
      felt.rotation.x = Math.PI / 2; felt.position.y = -.022; clamp.add(felt);
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(lipR + .035, lipR + .05, .15, 28, 1, true), mats.chrome);
      pot.position.y = -.12; clamp.add(pot);
      for (let k = 0; k < 2; k++){
        const w = new THREE.Mesh(new THREE.TorusGeometry(lipR + .055, .02, 8, 28), mats.copper);
        w.rotation.x = Math.PI / 2; w.position.y = -.09 - k * .055; clamp.add(w);
      }
      const coilMat = new THREE.MeshStandardMaterial({ color: 0x331a10, emissive: new THREE.Color(0xff5a1e), emissiveIntensity: .15 });
      const coil = new THREE.Mesh(new THREE.TorusGeometry(lipR + .04, .016, 8, 28), coilMat);
      coil.rotation.x = Math.PI / 2; coil.position.y = -.2; clamp.add(coil);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(.065, .065, .1, 14), mats.iron);
      collar.position.y = -.22; clamp.add(collar);
      for (let k = 0; k < 3; k++){ const a = k * 2.094 + .4;   // spokes: collar → pot
        clamp.add(bar(V(0, -.21, 0), V((lipR + .03) * Math.sin(a), -.17, (lipR + .03) * Math.cos(a)), .016, mats.iron, 6)); }
      // the rod: from the pivot down, past the clamp, into the boom's sleeve
      const sleeveTop = clampY - CLAMP.gap - .32 - ROD_VIS;   // group-local
      const rodL = pivotY - sleeveTop + .5;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, rodL, 10), mats.chrome);
      rod.position.y = pivotY - rodL / 2; group.add(rod);
      const sTop = p.bell + sleeveTop, sBot = sTop - .55;
      const sl = fz(new THREE.Mesh(new THREE.CylinderGeometry(.09, .1, .55, 16), mats.dark));
      sl.position.set(p.cx, (sTop + sBot) / 2, p.cz); kit.add(sl);
      const S = STANDS[on] || { x: p.cx + (p.cx > 0 ? 1.4 : -1.4), z: p.cz + 1.2 };
      const tip = V(p.cx, sBot, p.cz), joint = V(S.x, sBot - .55, S.z);
      const dir = tip.clone().sub(joint).normalize();
      const tail = joint.clone().addScaledVector(dir, -.7);
      kit.add(fz(bar(tail, tip, .05, mats.chrome)));                                           // the boom arm
      const cw = fz(new THREE.Mesh(new THREE.SphereGeometry(.15, 16, 12), mats.iron)); cw.position.copy(tail); kit.add(cw);
      const kn = fz(new THREE.Mesh(new THREE.SphereGeometry(.1, 16, 12), mats.iron)); kn.position.copy(joint); kit.add(kn);
      kit.add(fz(bar(V(S.x, .5, S.z), joint, .055, mats.chrome)));                             // the stand post
      for (let k = 0; k < 3; k++){ const a = k * 2.094 + .3;
        kit.add(fz(bar(V(S.x, .55, S.z), V(S.x + TRIPOD * Math.sin(a), .02, S.z + TRIPOD * Math.cos(a)), .03, mats.chrome, 8))); }
      return { group, tilt, face: top, bronze: mat, clamp, clampY, coil: coilMat, bell: p.bell, depth: Pf.under };
    };

    const mags = [];
    const byCym = new Map();
    for (const p of layout){
      const st = styleOf(p.key);
      const meta = pieceLane(p, spec, { rollT, beat, P, dtMax: DT_MAX });
      const c = V(p.x, p.lift, p.z);                     // contact, kit-local
      const world = c.clone().add(K);
      const floorY = pieceFloor(p);
      let cy = null;
      if (p.cym){ cy = byCym.get(p.cym); if (!cy){ cy = { on: p.cym, head: buildHung(p), members: [], parts: [], choked: -Infinity }; byCym.set(p.cym, cy); cyms.push(cy); } }
      const head = cy ? cy.head : st.kind === 'cymbal' ? buildHatPiece(p, st, c) : buildDrumPiece(p, st, c, floorY);
      const mag = buildMagnet(c, H, st, mats, glowTex);
      kit.add(mag.group); mags.push(mag);
      const ball = buildBall(st, envMap, glowTex);
      kit.add(ball.g, ball.ghosts);

      const L = meta.L;
      const pc = { key: p.key, meta, L, st, c, head, mag, ball,
                   vMax: L.vOut.length ? Math.max(...L.vOut) : 1,
                   vInMax: Math.max(DROP_V(DT_MAX), ...L.vIn),
                   first: firstStrike(L, start),
                   wobbleA: WOBBLE[p.key] ?? .12, wobbleAxis: pieces.length * 2.4,
                   drum: { contact: world, style: { ball: st.glow } },   // the shape main's drumStrike reads
                   trim: seats.find(q => q.lane === p.key)?.trimMat,   // a tom's stair nosing
                   cym: cy, fired: -Infinity, flash: 0 };
      pieces.push(pc);
      if (cy){ cy.members.push(pc); cy.parts.push({ L, meta, rho: p.rho, dir: p.dir, vInMax: pc.vInMax }); }
      if (p.key === 'kick') kickPc = pc;
    }
    for (const cy of cyms) cy.C = cymbalSchedule(cy.on, cy.parts, P, { dtMax: DT_MAX });   // the swing, solved up front
    kit.add(buildArch(F, mats));

    // the STRIKE LIGHTS: a small round-robin pool — every hit throws its colour into the room
    lights = Array.from({ length: LIGHTS }, () => {
      const l = new THREE.PointLight(0xffffff, 0, 7, 2);
      kit.add(l); return { l, age: 9, peak: 0 };
    });
    lightIdx = 0;
    freeze(kit);
    return group;
  }

  /* Per frame. Pure render of songTime: heads ride their pistons, balls fly their
     solved arcs, magnets light while they hold, the reacting parts follow their solves.
     Strike edges fire onStrike once each. */
  function update(songTime, P, dt, { started, skipStrikes, onStrike }){
    const t = started ? songTime : start;               // before play: the machine sits ARMED
    const half = DT_MAX / 2;
    for (const pc of pieces){
      const { L, c, head } = pc;
      const d = dribbleAt(L, t, start);
      const off = started ? dribblePiston(L, t, { start }) : 0;
      // impact speed of the strike we last left (the armed first drop lands at full speed)
      const vHit = d.i < 0 ? 0 : Math.abs(t - d.since - pc.first) < 1e-6 ? DROP_V(DT_MAX) : L.vIn[d.i];

      // strike edge: the strike we most recently left, if it's fresh and not yet fired
      // (time went backwards — a scrub, a rebuild's pose sweep: forget the "later" strike)
      if (d.i >= 0 && t - d.since < pc.fired - 1e-6) pc.fired = -Infinity;
      if (started && d.i >= 0 && d.since <= EDGE_W){
        const at = t - d.since;
        if (at > pc.fired + 1e-6){
          pc.fired = at;
          if (!skipStrikes){
            pc.flash = 1;
            const vel = pc.meta.vel[d.i];
            onStrike && onStrike({ lane: pc.meta.lane[d.i], vel, drum: pc.drum });
            const Lt = lights[lightIdx++ % lights.length];   // throw this hit's colour into the room
            if (Lt){ Lt.l.color.set(pc.st.glow); Lt.l.position.set(c.x, c.y + .7, c.z + .4);
                     Lt.age = 0; Lt.peak = LIGHT_PEAK * (.35 + .65 * vel) * (pc.key === 'kick' ? 1.6 : 1); }
          }
        }
      }
      pc.flash *= Math.exp(-dt * 9);

      // the head on its piston (its rod rides with it; the sleeve stays put) — a hung
      // cymbal is posed once for all its balls, below
      if (!pc.cym) head.group.position.y = c.y + off;
      if (head.membrane){
        head.face.material.emissiveIntensity = .04 + 2.4 * pc.flash;   // coated white; the drum's colour only on the strike
        head.membrane.uAge.value = d.i < 0 ? 99 : d.since;
        head.membrane.uAmp.value = Math.min(RIPPLE_MAX, RIPPLE_K * vHit);
      }
      if (head.bronze && !pc.cym) head.bronze.emissiveIntensity = .05 + 1.5 * pc.flash;
      if (pc.trim) pc.trim.emissiveIntensity = TRIM_BASE + 5 * pc.flash;   // the step lights as its tom sounds

      // SNARE WIRES: the rattle under the bottom head
      if (head.wires){
        const on = started && d.i >= 0;
        head.wires.uBuzz.value = on ? wireBuzz(d.since, d.since + d.until, vHit / pc.vInMax) : 0;
        head.wires.uT.value = on ? d.since : 0;
      }

      // HI-HAT CLUTCH: open-ness solved from the merged hit sequence, driven through the
      // linkage (the tube rides the piston too, so the pedal follows the whole stand)
      let open = 1;
      if (head.bot){
        open = clutchFrom(L, pc.meta.open, d, start);
        head.bot.position.y = head.bot0 - HAT.OPEN * open;
        const k = hatLinkage(HAT.OPEN * open - off);
        head.rocker.rotation.x = k.alpha;
        head.spring.mesh.position.set(c.x, k.toe.y, c.z + k.toe.z);
        head.spring.u.uLen.value = k.spring;
        head.pedal.rotation.x = k.pedalAng;               // toe up = open, pressed = closed
        const a = V(c.x, k.pedalToe.y, c.z + k.pedalToe.z), b = V(c.x, k.toe.y, c.z + k.toe.z);
        head.link.position.copy(a).lerp(b, .5);
        head.link.scale.y = a.distanceTo(b);
        head.link.quaternion.setFromUnitVectors(V(0, 1, 0), b.sub(a).normalize());
      }

      // cymbal: a precessing WOBBLE about the bell. It grows from zero at the strike and is
      // tapered back to level by the next one, so every contact lands on a level cymbal.
      // A closed hi-hat is clamped — it barely moves; open, it swings free.
      if (head.tilt && !pc.cym){
        let th = 0, ph = 0;
        if (d.i >= 0 && started){
          const s = d.since, gap = d.since + d.until;
          const taper = Math.max(0, 1 - s / gap) ** 2;
          th = pc.wobbleA * (head.bot ? .2 + .8 * open : 1) * Math.min(1, vHit / pc.vMax)
             * (1 - Math.exp(-s * 14)) * Math.exp(-s * 1.4) * taper;
          ph = pc.wobbleAxis + s * 9;                    // the wobble axis walks round — real cymbal precession
        }
        head.tilt.rotation.set(th * Math.cos(ph), 0, th * Math.sin(ph));
      }

      // KICK SHOCKWAVE: the live rings across the riser floor
      if (pc === kickPc && deckU){
        const rings = started ? shockAges(L, d, t, start) : [];
        for (let k = 0; k < 3; k++){
          const R = rings[k];
          if (!R){ deckU.uAmp.value.setComponent(k, 0); continue; }
          const sr = shockRing(R.age);
          const vIn = Math.abs(t - R.age - pc.first) < 1e-6 ? DROP_V(DT_MAX) : L.vIn[R.k];
          deckU.uR.value.setComponent(k, sr.r);
          deckU.uAge.value.setComponent(k, R.age);
          deckU.uAmp.value.setComponent(k, sr.a * R.fade * Math.min(1, vIn / pc.vInMax) * (.4 + .6 * pc.meta.vel[R.k]));
        }
      }

      // the ball: underside at contact + d.y
      const by = c.y + pc.st.ball;
      pc.ball.g.position.set(c.x, by + d.y, c.z);

      // ghost trail: the ball's own past, re-sampled from the solved arc (dim while slow/held)
      const speed = Math.min(1, Math.abs(d.vy) / 6);
      pc.ball.trail.forEach((s, j) => {
        const tj = t - (j + 1) * TRAIL_DT;
        if (!started || tj < start || speed < .05){ s.material.opacity = 0; return; }
        s.position.set(c.x, by + dribbleAt(L, tj, start).y, c.z);
        const f = 1 - (j + 1) / (TRAIL_N + 1);
        s.material.opacity = .32 * f * speed;
        s.scale.setScalar(pc.st.ball * 3.4 * (.4 + .6 * f));
      });

      // magnet coil: energizes as the ball arrives, CLACKS bright the instant it docks,
      // settles to a steady hold glow, and cuts hard on release
      let on = 0;
      if (d.mode === 'hold'){
        const docked = d.i < 0 ? 9 : d.since - half;
        on = 1 + 2.2 * Math.exp(-docked * 9);
      } else if (d.mode === 'arc' && d.vy > 0 && d.until > half){
        on = Math.max(0, 1 - (half - d.since) / .12);
      }
      pc.mag.coil.material.emissiveIntensity = .15 + 3.0 * on;
      pc.mag.halo.material.opacity = Math.min(1, .5 * on);
      pc.mag.halo.scale.setScalar(pc.mag.haloS * (1 + .35 * Math.max(0, on - 1)));
    }
    // THE HUNG CYMBALS: one pose per cymbal from all its balls — the piston (each ball's,
    // quieted at the others' contacts), the damped swing, the clamp
    for (const cy of cyms){
      const h = cy.head;
      h.group.position.y = h.bell + (started ? cymbalPiston(cy.members, t, start) : 0);
      const q = started ? cymbalPose(cy.C, t, start) : { rx: 0, rz: 0, k: 1, i: -1 };
      // CHOKE edge: the clamp grabs the CYMBAL on cue (the merged schedule's choke — the same
      // one cymbalPose grips with), so every lane it sounds (the ride AND its bell) is cut
      if (q.i >= 0){
        const ck = cy.C.choke[q.i];
        if (t < cy.choked - 1e-6) cy.choked = -Infinity;
        if (ck < Infinity && q.since >= ck && q.since - ck <= EDGE_W){
          const at = t - q.since + ck;
          if (at > cy.choked + 1e-6){
            cy.choked = at;
            if (!skipStrikes && onStrike) for (const m of cy.members) onStrike({ lane: m.key, choke: true, vel: 0, drum: m.drum });
          }
        }
      }
      h.tilt.rotation.set(q.rx, 0, q.rz);
      h.clamp.position.y = h.clampY - CLAMP.gap * (1 - q.k);
      let fl = 0; for (const m of cy.members) fl = Math.max(fl, m.flash);
      h.bronze.emissiveIntensity = .05 + 1.5 * fl;
      h.coil.emissiveIntensity = .15 + 2.2 * q.k * q.k;   // the coil lights while it grips
    }
    for (const Lt of lights){                            // strike lights: a hard flash, a quick decay
      Lt.age += dt;
      Lt.l.intensity = Lt.peak * Math.exp(-Lt.age * 11);
    }
  }

  return { build, update };
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
