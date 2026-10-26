import * as THREE from 'three';
import { FOOT } from './footing.js';
/* ============================================================
   THE METAL ARENA'S FOOTING — what the machines stand on, in REAL STAGING GEAR.
   A room style for rooms/footing3d.js (its header is the contract): every form below writes into
   the kit's merged slot buffers, so the whole song's footing stays one draw per material:

     deck   black-painted ply (Litedeck tops, stair treads, deck undersides)
     steel  ALUMINIUM — the room's own rig material: deck frames, box truss, ladders, rails (the kit's
            own truss / ladder / cage / rail forms write this slot: they come out silver, like the rig)
     skirt  black serge (pleated) — riser skirts and deck valances
     galv   galvanised Layher scaffold tube
     wood   timber: scaffold sole boards and kickboards
     edge   the machine's LIGHT (one additive draw for every pad): an LED line, glow-tape spike marks,
            glow nosing tape on every stair, and on every raised deck a VU FASCIA (below)

   By band (h = support height above the floor, rooms/footing.js):
     FLUSH  a stage deck (Litedeck): black ply top in a silver aluminium frame, a black serge skirt to
            the floor, an LED line under the frame lip, glow-tape spike Ls at the machine's corners
     LOW    a DRUM RISER: the same deck to the floor + an LED VU fascia across its front; black stage
            stairs (closed steps) with white glow nosing tape and an aluminium handrail
     MID    decks on LAYHER scaffold: a grid of galvanised standards on base jacks, jack plates and
            timber sole boards; rosettes at every ledger node; ledgers every 2 m lift; diagonals in
            alternate bays of every outer face; the ring standards run on up as the guard-rail posts
            (top + mid rail) over timber kickboards. A skirted deck slab with the VU fascia; a scaffold
            stair (alu treads on galvanised stringers) or the kit's aluminium ladder
     HIGH   a silver BOX-TRUSS tower (the kit's truss in the rig's aluminium) carrying a skirted deck
            like a PA wing: rails, the VU fascia, a caged ladder resting on a landing every LAND_DY
     LOFT   by its band: a long riser / a Layher deck / a TRUSS WING — one VU stretch per member
     OPEN   the kit's own open stand (posts under the feet, braced clear of what hangs), in aluminium

   THE VU FASCIA answers the machine's own strikes: its LED segments fill from the centre outwards
   to the strike's weight and fall back (a peak ghost falls slower) — a pure fn of songTime (the
   room's update writes uVU / uGhost from rooms/pulse.js envelopes per plan.pulses slot). The edge
   vertex attribute aPulse encodes what each strip is:
       slot            a plain strip: uBase + uGain · uPulse[slot] (the kit's own envelope)
       slot + thr      a VU segment (0 < thr < 1): lit when uVU[slot] ≥ thr, a ghost when uGhost ≥ thr
       −1              glow tape: a steady uTape (spike marks in the machine's colour, white nosing)
   Everything stays inside footingBoxes(plan) (the shot solve's solids): a pad's rect from the floor
   to its deck (+ its rails), a stair / ladder inside its accessRect. 1 u ≈ .677 m.
   ============================================================ */

const PY = 1, NY = 2, PX = 4, NX = 8, PZ = 16, NZ = 32, ALL = 63, NOBOT = ALL & ~NY, SIDES = PX | NX | PZ | NZ;

export const ARENA_FOOT = {
  FRAME: .13,        // a Litedeck's aluminium edge band (≈ 9 cm)
  RIM: .05,          // how much of the frame's top shows round the ply
  LIP: .02,          // the skirt hangs this far inside the frame line (a shadow line under the lip)
  VALANCE: .55,      // a raised deck's serge valance under its frame
  FASCIA: .6,        // a riser's LED fascia, at most this tall
  SEG: .48,          // an LED segment's pitch along a fascia (≈ 33 cm)
  BAY: 3.06,         // a Layher bay (2.07 m)
  LIFT_DY: 2.96,     // a Layher lift (2 m)
  IN: .18,           // scaffold standards in from the deck edge (the deck oversails them)
  TUBE: .075,        // a standard (48.3 mm)
  JACK: .42,         // a base jack's height under its standard
  TOE: .22,          // a kickboard (≈ 15 cm)
  HAND: 1.3,         // a stair handrail over the nosing line
  TAPE: -1,          // aPulse: steady glow tape
};
const A = ARENA_FOOT, RAIL = FOOT.RAIL;

/* a support's deck slab depth: the kit's (footing3d deckDepth: a band's slab, or deeper where its machine
   dips into it — the kit's pistons) — never less than its frame + valance (the skirt is the slab's face) */
const kitDepth = r => Math.max(r.keys || r.band === 'high' ? .38 : .32, (r.well || 0) + .04);
const slabDepth = r => Math.max(kitDepth(r), A.FRAME + A.VALANCE);

/* (along a, out o) on one side of a rect → local [u, v] (the kit's convention: ±u sides run along v) */
const onSide = (r, side) => { const k = side[0] === '+' ? 1 : -1, cu = r.cu || 0, cv = r.cv || 0;
  return side[1] === 'u' ? (a, o) => [cu + k * (r.hw + o), cv + a] : (a, o) => [cu + a, cv + k * (r.hd + o)]; };
const sideHalf = (r, side) => side[1] === 'u' ? r.hd : r.hw;
/* a rect's local (u, v) → world (x, z) (the kit's frame: local +u runs along world (cos, −sin) of its yaw) */
const toW = (r, u, v) => { const c = Math.cos(r.yaw || 0), s = Math.sin(r.yaw || 0); return [r.x + c * u + s * v, r.z - s * u + c * v]; };
/* how far a world point lies from a machine's footprint (its turned rect) */
function rectDist(m, x, z){
  const c = Math.cos(m.yaw || 0), s = Math.sin(m.yaw || 0), dx = x - m.x, dz = z - m.z;
  const u = c * dx - s * dz, v = s * dx + c * dz;
  return Math.hypot(Math.max(Math.abs(u) - m.hw, 0), Math.max(Math.abs(v) - m.hd, 0));
}
/* where a support's rails open for its access (the kit's gapOf): [side, a0, a1] along that side */
function gapOf(acc){
  if (!acc) return null;
  if (acc.kind === 'stair') return [acc.side, acc.a1 - acc.out, acc.a1];
  const mid = (acc.a0 + acc.a1) / 2, off = acc.flights > 1 ? ((acc.flights - 1) % 2 ? .45 : -.45) : 0;
  return [acc.side, mid + off - .33 - .15, mid + off + .33 + .15];
}
/* the landing levels of a support's climb (the kit's: every LAND_DY) */
function landings(r, F){ const nf = r.access?.flights || Math.max(1, Math.ceil((r.top - F) / FOOT.LAND_DY)), out = [];
  for (let f = 1; f < nf; f++) out.push(F + (r.top - F) * f / nf); return out; }

/* ---- textures (drawn once per room; none under node: the tests) ---- */
function canvas(w, h, draw){
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
function tex(c, srgb = true){
  if (!c) return null;
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
const prng = seed => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
/* black-painted ply: a soft grain, scuffs and boot marks (one 4 u tile — the kit's uvs are world-space) */
function plyTex(){
  return tex(canvas(512, 512, (x, w) => {
    const R = prng(91);
    x.fillStyle = '#3c3c43'; x.fillRect(0, 0, w, w);
    for (let i = 0; i < 260; i++){                                         // long faint grain streaks
      const y = R() * w, a = .025 + R() * .04;
      x.fillStyle = R() < .5 ? `rgba(0,0,0,${a})` : `rgba(120,118,128,${a * .7})`;
      x.fillRect(0, y, w, 1 + R() * 2.5);
    }
    for (let i = 0; i < 900; i++){                                         // scuffs
      const a = .03 + R() * .08;
      x.fillStyle = R() < .65 ? `rgba(0,0,0,${a * 1.6})` : `rgba(150,146,150,${a})`;
      x.save(); x.translate(R() * w, R() * w); x.rotate(R() * 6.28); x.fillRect(0, 0, 3 + R() * 26, 1 + R() * 3); x.restore();
    }
  }));
}
/* black serge: box pleats, a colour map and its normal map (vertical folds catch the rake) */
function sergeTex(){
  const PLEATS = 26, W = 512;
  const h = i => { const p = (i / W) * PLEATS % 1; return Math.sin(p * Math.PI * 2) * .6 + Math.sin(p * Math.PI * 4 + .7) * .25; };
  const col = canvas(W, 8, (x, w, H) => {
    for (let i = 0; i < w; i++){ const v = 74 + 18 * h(i) | 0; x.fillStyle = `rgb(${v},${v},${v + 7})`; x.fillRect(i, 0, 1, H); }
  });
  const nrm = canvas(W, 8, (x, w, H) => {
    for (let i = 0; i < w; i++){
      const d = (h(i + 1) - h(i - 1)) * PLEATS * .9, L = Math.hypot(d, 1);
      x.fillStyle = `rgb(${(.5 - .5 * d / L) * 255 | 0},128,${(.5 + .5 / L) * 255 | 0})`; x.fillRect(i, 0, 1, H);
    }
  });
  return { map: tex(col), normalMap: tex(nrm, false) };
}
/* scaffold timber: warm boards, a grain along u */
function woodTex(){
  return tex(canvas(256, 64, (x, w, h) => {
    const R = prng(37);
    x.fillStyle = '#a07a4c'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++){ const y = R() * h, a = .05 + R() * .1; x.fillStyle = `rgba(70,45,20,${a})`; x.fillRect(0, y, w, .6 + R() * 1.4); }
    for (let i = 0; i < 6; i++){ x.fillStyle = 'rgba(60,40,18,.25)'; x.beginPath(); x.ellipse(R() * w, R() * h, 3 + R() * 4, 1.5 + R() * 2, 0, 0, 6.3); x.fill(); }
  }));
}

/* ---- THE LIGHT: one additive draw for every pad (strips, VU segments, glow tape) ---- */
function vuEdgeMat(){
  const N = FOOT.MAX_PULSE;
  return new THREE.ShaderMaterial({
    uniforms: {
      uPulse: { value: new Float32Array(N) },            // the kit's envelope (footing3d writes it: at + .35·next)
      uVU: { value: new Float32Array(N) }, uGhost: { value: new Float32Array(N) },   // the room's (arena.js update)
      uBase: { value: .16 }, uGain: { value: 1.1 },      // a plain strip: dim at rest, an accent on a strike
      uSegOff: { value: .06 }, uSegOn: { value: .9 },    // a VU segment: dark LED → lit
      uTape: { value: .3 },                              // glow tape
    },
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aPulse;
      uniform float uPulse[${N}], uVU[${N}], uGhost[${N}];
      uniform float uBase, uGain, uSegOff, uSegOn, uTape;
      varying vec3 vC;
      void main(){
        float L;
        if (aPulse < -.5) L = uTape;
        else {
          float s = floor(aPulse + 1e-4), f = aPulse - s;
          int i = int(s + .5);
          if (f < .005) L = uBase + uGain * uPulse[i];
          else {
            // lit up to the level; the PEAK HOLD is a marker — only the segments just under the held peak
            float on = step(f, uVU[i]), ghost = step(f, uGhost[i]) * step(uGhost[i] - ${VU.MARK.toFixed(3)}, f) * (1. - on);
            L = uSegOff + uSegOn * (on + .45 * ghost);
          }
        }
        vC = aColor * L;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC;
      void main(){
        gl_FragColor = vec4(vC, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
/** a VU segment's aPulse: its slot + its threshold (centre-out: the middle segments light first) */
export const vuCode = (slot, i, n) => slot + (.03 + .94 * Math.abs(2 * (i + .5) / n - 1));
const NOSING = '#e9eef6';

/** THE METER'S SCALE — a machine's strikes re-weighted against its OWN norm (what the director calls
    "above its own norm"), so a busy machine's groove ripples low on its meter and only its accents and
    entrances reach the top (a dense run must never peg the ring full). Each strike's height:
      accent  its velocity's rank among the machine's own strikes (a flat-velocity machine sits mid-scale)
      entry   how long it rested before it (twice its usual gap ≈ a third up, eight times ≈ the top)
    h = VU.FLOOR + (1 − VU.FLOOR) · max(rank^1.6, entry). Pure; the cue keeps its times. */
export const VU = { FLOOR: .16, DECAY: .24, HOLD: 1.2, MARK: .14 };
export function vuCue(cue, P){
  const n = Array.isArray(cue) ? cue.length : 0;
  if (!n || !(P > 0)) return [];
  const ev = cue.map(c => ({ t: (((+c.t || 0) % P) + P) % P, w: Math.max(0, Math.min(1, c.w ?? 1)) })).sort((a, b) => a.t - b.t);
  const ws = ev.map(e => e.w).sort((a, b) => a - b), flat = ws[n - 1] - ws[0] < .02;
  const rank = w => {                                                     // mid-rank of w in [0, 1]
    if (flat || n < 2) return .5;
    let lo = 0, hi = 0; for (const x of ws){ if (x < w - 1e-9) lo++; if (x <= w + 1e-9) hi++; }
    return ((lo + hi - 1) / 2) / (n - 1);
  };
  const gap = ev.map((e, i) => i ? e.t - ev[i - 1].t : e.t + P - ev[n - 1].t);
  const gs = gap.filter(g => g > 1e-4).sort((a, b) => a - b), med = gs.length ? gs[gs.length >> 1] : P;
  return ev.map((e, i) => {
    const entry = gap[i] > 1e-4 ? Math.max(0, Math.min(1, Math.log2(gap[i] / med) / 3)) : 0;
    return { t: e.t, w: VU.FLOOR + (1 - VU.FLOOR) * Math.max(rank(e.w) ** 1.6, entry) };
  });
}

/* ============================================================ the style ============================ */
export function arenaFooting({ envMap = null, alu = null } = {}){
  const edge = vuEdgeMat();
  const NONE = new THREE.Group(); NONE.name = 'footing:arena';     // (a form drawn into the merged slots: nothing of its own)
  /* the materials are made with the ROOM (its textures painted once, at its build — never inside a footing
     build, which runs again on every lift); the footing only borrows them */
  let made = null;
  const mats = () => {
    if (made) return made;
    const serge = sergeTex();
    made = {
      deck: new THREE.MeshStandardMaterial({ color: 0xffffff, map: plyTex(), roughness: .66, metalness: .04, envMap, envMapIntensity: .3 }),
      // (the rig's own aluminium is metalness 1: overhead it mirrors the beams, but at eye level the dark env
      //  turns it purple-black — a support reads as silver here only half-metal, lit by the room's fills)
      steel: alu || new THREE.MeshStandardMaterial({ color: 0xccd1d9, metalness: .55, roughness: .3, envMap, envMapIntensity: .85 }),
      skirt: new THREE.MeshStandardMaterial({ color: 0xffffff, map: serge.map, normalMap: serge.normalMap, normalScale: new THREE.Vector2(.9, .9), roughness: .93, metalness: 0 }),
      galv: new THREE.MeshStandardMaterial({ color: 0xa9b0b8, metalness: .5, roughness: .46, envMap, envMapIntensity: .55 }),
      wood: new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTex(), roughness: .82, metalness: 0 }),
      edge,
    };
    made._own = ['deck', 'skirt', 'galv', 'wood'].concat(alu ? [] : ['steel']);
    return made;
  };
  mats();

  /* ---------------- the pieces (all in the current kit frame) ---------------- */
  /* a Litedeck top at T: the aluminium frame band (its top shows as a rim) round a black ply sheet */
  function deckTop(k, r, T, F){
    const fr = Math.min(A.FRAME, Math.max(.04, T - F - .01));
    k.box('steel', -r.hw, r.hw, T - fr, T - .008, -r.hd, r.hd, SIDES | PY);
    k.box('deck', -r.hw + A.RIM, r.hw - A.RIM, T - .045, T, -r.hd + A.RIM, r.hd - A.RIM, PY | SIDES);
    return fr;
  }
  /* a box on one side's face (along a0..a1, out o0..o1 from the face plane) into the EDGE buffer */
  function faceEdge(k, r, side, a0, a1, y0, y1, o0, o1, color, code){
    const K = side[0] === '+' ? 1 : -1, out = side[1] === 'u' ? (K > 0 ? PX : NX) : (K > 0 ? PZ : NZ), inward = side[1] === 'u' ? (K > 0 ? NX : PX) : (K > 0 ? NZ : PZ);
    const faces = ALL & ~inward & ~NY | out;
    const cu = r.cu || 0, cv = r.cv || 0;
    if (side[1] === 'u'){ const p = cu + K * (r.hw + o0), q = cu + K * (r.hw + o1); k.edge(Math.min(p, q), Math.max(p, q), y0, y1, cv + a0, cv + a1, color, code, faces); }
    else { const p = cv + K * (r.hd + o0), q = cv + K * (r.hd + o1); k.edge(cu + a0, cu + a1, y0, y1, Math.min(p, q), Math.max(p, q), color, code, faces); }
  }
  /* an LED line round a deck's face (y0..y1), standing just proud of the skirt (plain pulse) */
  function ledLine(k, r, y0, y1, color, slot){
    for (const s of ['+v', '-v', '+u', '-u']){ const h = sideHalf(r, s) - A.LIP; faceEdge(k, r, s, -h, h, y0, y1, -A.LIP - .004, -A.LIP + .014, color, slot); }
  }
  /* the VU RING: LED segments right round a deck's face (y0..y1). Each segment answers the machine
     nearest it (a loft's members share its ring: a meter each, on the stretch that is theirs) and every
     run of one machine's segments fills from its own centre out; the span its stair / ladder climbs is
     left dark */
  function vuRing(k, r, y0, y1, owners, acc, oo = [-A.LIP - .004, -A.LIP + .016]){
    if (!(y1 - y0 > .04) || !owners.length) return;
    for (const side of ['+v', '-v', '+u', '-u']){
      const half = sideHalf(r, side) - .2; if (!(half > .3)) continue;
      const n = Math.max(2, Math.round(2 * half / A.SEG)), pitch = 2 * half / n, g = Math.min(.09, pitch * .2), at = onSide(r, side);
      const skip = acc && acc.side === side ? [acc.a0 - .12, acc.a1 + .12] : null;
      const seg = [];
      for (let i = 0; i < n; i++){
        const a0 = -half + i * pitch + g / 2, a1 = a0 + pitch - g;
        if (skip && a1 > skip[0] && a0 < skip[1]){ seg.push(null); continue; }
        const [x, z] = toW(r, ...at((a0 + a1) / 2, 0));
        let o = owners[0], best = Infinity;
        for (const m of owners){ const d = rectDist(m, x, z); if (d < best - 1e-9){ best = d; o = m; } }
        seg.push({ a0, a1, o });
      }
      for (let i = 0; i < n;){
        if (!seg[i]){ i++; continue; }
        let j = i; while (j + 1 < n && seg[j + 1] && seg[j + 1].o === seg[i].o) j++;
        for (let t = i; t <= j; t++) faceEdge(k, r, side, seg[t].a0, seg[t].a1, y0, y1, oo[0], oo[1], seg[t].o.color, vuCode(seg[t].o.pulse, t - i, j - i + 1));
        i = j + 1;
      }
    }
  }
  /* glow-tape spike Ls at the four corners of a rect (inset), on a deck at T */
  function spikes(k, r, T, color, inset = .3){
    const L = Math.min(.46, r.hw * .4, r.hd * .4), W = .065, y0 = T + .003, y1 = T + .016;
    if (!(L > .1)) return;
    for (const su of [-1, 1]) for (const sv of [-1, 1]){
      const cu = su * (r.hw - inset), cv = sv * (r.hd - inset);
      k.edge(Math.min(cu, cu - su * L), Math.max(cu, cu - su * L), y0, y1, cv - W / 2, cv + W / 2, color, A.TAPE, PY | SIDES);
      k.edge(cu - W / 2, cu + W / 2, y0, y1, Math.min(cv, cv - sv * L), Math.max(cv, cv - sv * L), color, A.TAPE, PY | SIDES);
    }
  }
  /* a raised deck slab at T: the Litedeck top, a serge valance down to T − D, a black underside */
  function slab(k, r, T, F){
    const D = slabDepth(r), y0 = T - D;
    const fr = deckTop(k, r, T, F);
    k.box('skirt', -r.hw + A.LIP, r.hw - A.LIP, y0, T - fr, -r.hd + A.LIP, r.hd - A.LIP, SIDES);
    k.box('deck', -r.hw + A.LIP, r.hw - A.LIP, y0, y0 + .02, -r.hd + A.LIP, r.hd - A.LIP, NY);
    return { D, y0, fr };
  }

  /* STAIRS hugging one side (footing.js access: steps rising along a0 → the landing at a1 − out … a1).
     stage: closed black steps (a stage stair unit) · scaffold: alu treads on galvanised stringers */
  function stair(k, r, T, acc, F, kind){
    const S = onSide(r, acc.side), ow = acc.out, n = acc.n, rise = acc.rise, tr = acc.tread, aL = acc.a1 - ow;
    const P = (a, o, y) => { const [u, v] = S(a, o); return [u, y, v]; };
    const boxSide = (slot, a0, a1, o0, o1, y0, y1, faces = ALL) => { const p = S(a0, o0), q = S(a1, o1);
      k.box(slot, Math.min(p[0], q[0]), Math.max(p[0], q[0]), y0, y1, Math.min(p[1], q[1]), Math.max(p[1], q[1]), faces); };
    const tapeSide = (a0, a1, o0, o1, y) => { const p = S(a0, o0), q = S(a1, o1);
      k.edge(Math.min(p[0], q[0]), Math.max(p[0], q[0]), y + .002, y + .014, Math.min(p[1], q[1]), Math.max(p[1], q[1]), NOSING, A.TAPE, PY | SIDES); };
    for (let i = 1; i < n; i++){
      const a0 = acc.a0 + (i - 1) * tr, a1 = a0 + tr, y = F + i * rise;
      if (kind === 'stage') boxSide('deck', a0, a1 + .02, .02, ow, F - .01, y, NOBOT);
      else boxSide('steel', a0, a1 + .03, .1, ow - .1, y - .05, y, ALL);
      tapeSide(a0 + .01, a0 + .07, kind === 'stage' ? .06 : .14, kind === 'stage' ? ow - .06 : ow - .14, y);
    }
    if (kind === 'stage'){
      boxSide('deck', aL, acc.a1, .02, ow, F - .01, T, NOBOT);                                     // the top landing: a riser unit
      tapeSide(aL + .01, aL + .07, .06, ow - .06, T);
    } else {
      boxSide('steel', aL, acc.a1, 0, ow, T - .16, T - .02, ALL);                                   // the landing deck
      tapeSide(aL + .01, aL + .07, .1, ow - .1, T - .02);
      for (const o of [.12, ow - .12]) k.bar('galv', P(acc.a0 + .1, o, F + .14), P(aL + .15, o, T - .1), .07, .26);   // stringers
      for (const a of [aL + .1, acc.a1 - .1]){                                                    // landing posts on base plates
        k.bar('galv', P(a, ow - .1, F + .06), P(a, ow - .1, T - .16), .075, .075, ALL);
        boxSide('galv', a - .1, a + .1, ow - .2, ow, F, F + .06, NOBOT);
      }
    }
    // the handrail on the open side: up the flight, along the landing, round its end
    const o = ow - .06, y0 = F + rise + A.HAND, y1 = T + A.HAND, slot = kind === 'stage' ? 'steel' : 'galv';
    k.bar(slot, P(acc.a0 + .12, o, y0), P(aL, o, y1), .065, .065, ALL);
    k.bar(slot, P(aL, o, y1), P(acc.a1 - .04, o, y1), .065, .065, ALL);
    k.bar(slot, P(acc.a1 - .04, o, y1), P(acc.a1 - .04, .1, y1), .065, .065, ALL);
    for (const [a, y] of [[acc.a0 + .12, F + rise], [aL, T], [acc.a1 - .04, T]]) k.bar(slot, P(a, o, y), P(a, o, y + A.HAND + .03), .065, .065, PY | SIDES);
    k.bar(slot, P(acc.a1 - .04, .1, T), P(acc.a1 - .04, .1, y1), .065, .065, SIDES);
  }
  function access(k, r, T, F, kind){
    const acc = r.access; if (!acc) return;
    if (acc.kind === 'stair') stair(k, r, T, acc, F, kind);
    else k.forms.ladder(r, T, acc);                                       // the kit's: aluminium, caged past CAGE, landings
  }

  /* LAYHER scaffold under a deck whose underside is at yB: standards on base jacks + sole boards,
     rosettes, ledgers every lift, diagonals on the outer faces; the ring standards run on up to the
     guard rails (railed), stopping under the deck where the access opens */
  function layher(k, r, T, yB, F, gap){
    const S = A.TUBE, hu = Math.max(.3, r.hw - A.IN), hv = Math.max(.3, r.hd - A.IN);
    const nu = Math.max(1, Math.ceil(2 * hu / A.BAY - 1e-9)), nv = Math.max(1, Math.ceil(2 * hv / A.BAY - 1e-9));
    const U = Array.from({ length: nu + 1 }, (_, i) => -hu + 2 * hu * i / nu), V = Array.from({ length: nv + 1 }, (_, j) => -hv + 2 * hv * j / nv);
    const yJ = F + A.JACK, yLo = F + .62, yHi = yB - .12;
    const nl = Math.max(1, Math.ceil((yHi - yLo) / A.LIFT_DY - 1e-9));
    const LV = yHi > yLo + .3 ? Array.from({ length: nl + 1 }, (_, i) => yLo + (yHi - yLo) * i / nl) : [Math.max(F + .3, yHi)];
    const inGap = (side, a) => gap && gap[0] === side && a > gap[1] - .1 && a < gap[2] + .1;
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++){
      const u = U[i], v = V[j], ring = i === 0 || i === nu || j === 0 || j === nv;
      if (!ring && (i % 2 || j % 2)) continue;                    // (inside: a standard every other bay — the transoms span it)
      const open = (j === nv && inGap('+v', u)) || (j === 0 && inGap('-v', u)) || (i === nu && inGap('+u', v)) || (i === 0 && inGap('-u', v));
      const top = ring && !open ? T + RAIL : yB;
      k.box('galv', u - S / 2, u + S / 2, yJ, top, v - S / 2, v + S / 2, top > T ? SIDES | PY : SIDES);
      k.box('galv', u - .026, u + .026, F + .08, yJ + .05, v - .026, v + .026, SIDES);                       // the base jack's screw
      k.box('galv', u - .14, u + .14, F + .05, F + .08, v - .14, v + .14, NOBOT);                            // its plate
      k.box('wood', Math.max(-r.hw + .02, u - .24), Math.min(r.hw - .02, u + .24), F - .01, F + .05,
        Math.max(-r.hd + .02, v - .46), Math.min(r.hd - .02, v + .46), NOBOT);                               // a timber sole board
      for (const y of ring ? LV : LV.slice(-1)) k.box('galv', u - .1, u + .1, y - .022, y + .022, v - .1, v + .1, ALL);   // a rosette at each node
    }
    // ledgers: every lift round the outer ring; inside, only the top lift (the bearers under the deck)
    const yTop = LV[LV.length - 1];
    for (const y of LV){
      V.forEach((v, j) => { if (y === yTop || j === 0 || j === nv) for (let i = 0; i < nu; i++) k.bar('galv', [U[i], y, v], [U[i + 1], y, v], .062, .062); });
      U.forEach((u, i) => { if (y === yTop || i === 0 || i === nu) for (let j = 0; j < nv; j++) k.bar('galv', [u, y, V[j]], [u, y, V[j + 1]], .062, .062); });
    }
    // diagonals: every outer face, alternate bays, alternate hands per lift (a single lift: jack → ledger)
    const lifts = LV.length > 1 ? LV.slice(0, -1).map((y, l) => [y, LV[l + 1]]) : [[yJ, LV[0]]];
    lifts.forEach(([ya, yb], l) => {
      for (let i = 0; i < nu; i++) if ((i + l) % 2 === 0) for (const v of [V[0], V[nv]]){
        const [a, b] = (i + l) % 4 ? [U[i + 1], U[i]] : [U[i], U[i + 1]];
        k.bar('galv', [a, ya, v], [b, yb, v], .056, .056);
      }
      for (let j = 0; j < nv; j++) if ((j + l) % 2 === 0) for (const u of [U[0], U[nu]]){
        const [a, b] = (j + l) % 4 ? [V[j + 1], V[j]] : [V[j], V[j + 1]];
        k.bar('galv', [u, ya, a], [u, yb, b], .056, .056);
      }
    });
    // guard rails on the ring (top + mid), timber kickboards inside them; gate posts where the access opens
    for (const [side, c, lo, hi] of [['-v', -hv, -hu, hu], ['+v', hv, -hu, hu], ['-u', -hu, -hv, hv], ['+u', hu, -hv, hv]]){
      let segs = [[lo, hi]];
      if (gap && gap[0] === side){
        const g0 = gap[1] - .06, g1 = gap[2] + .06; segs = [];
        if (g0 > lo + .25) segs.push([lo, g0]);
        if (g1 < hi - .25) segs.push([g1, hi]);
      }
      const P = (s, y, o = 0) => side[1] === 'v' ? [s, y, c - Math.sign(c) * o] : [c - Math.sign(c) * o, y, s];
      for (const [a, b] of segs){
        k.bar('galv', P(a, T + RAIL - .035), P(b, T + RAIL - .035), .065, .065, ALL);
        k.bar('galv', P(a, T + RAIL * .5), P(b, T + RAIL * .5), .058, .058, ALL);
        const p = P(a, 0, .07), q = P(b, 0, .07);
        if (side[1] === 'v') k.box('wood', Math.min(p[0], q[0]), Math.max(p[0], q[0]), T, T + A.TOE, p[2] - .018, p[2] + .018);
        else k.box('wood', p[0] - .018, p[0] + .018, T, T + A.TOE, Math.min(p[2], q[2]), Math.max(p[2], q[2]));
        for (const e of [a, b]) if (Math.abs(e - lo) > .05 && Math.abs(e - hi) > .05){
          const [x, , z] = P(e, 0); k.box('galv', x - S / 2, x + S / 2, T - .1, T + RAIL, z - S / 2, z + S / 2, SIDES | PY);
        }
      }
    }
  }

  /* AN OPEN STAND (the turntable: its resonator rank hangs below what it rests on) — a box-truss LEG under
     every foot (the rig's own truss, on a black ballast plate with glow-tape spike marks), a truss HEAD BEAM
     between legs wherever it keeps out of what hangs, X-braced tiers below what hangs, the machine's VU on
     each head beam's outer face and as an LED floor ring round the whole stand (what hangs included: the
     audience side reads lit). A service ladder (footing.js: lifted off its own legs) is bracketed to the
     leg it climbs beside. Everything inside the pad's rect, nothing through HANG down to hangY. */
  function openStand(p, k){
    const F = k.floor, T = p.top, H = T - F, HG = p.hang, D = k.DIM, s = D.COL / 2, BW = D.BEAM_W / 2;
    const feet = p.feet?.length ? p.feet : [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [a * (p.hw - .9), b * (p.hd - .9), .5]);
    const cu = feet.reduce((q, f) => q + f[0], 0) / feet.length, cv = feet.reduce((q, f) => q + f[1], 0) / feet.length;
    // (a leg slides off what hangs along its shallower side — never further than its foot reaches; and stays in the rect)
    const clip = (u, v, r) => {
      u = Math.max(-p.hw + s + .35, Math.min(p.hw - s - .35, u)); v = Math.max(-p.hd + s + .35, Math.min(p.hd - s - .35, v));
      if (!HG) return [u, v];
      const x0 = HG[0] - .08, x1 = HG[1] + .08, z0 = HG[2] - .08, z1 = HG[3] + .08;
      if (u + s <= x0 || u - s >= x1 || v + s <= z0 || v - s >= z1) return [u, v];
      const [du, dv] = [[x0 - u - s, 0], [x1 - u + s, 0], [0, z0 - v - s], [0, z1 - v + s]].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0];
      return Math.abs(du + dv) <= Math.max(r, .9) ? [u + du, v + dv] : null;
    };
    const legs = [];
    for (const [fu, fv, rr = .5] of feet.slice().sort((f, g) => Math.atan2(f[1] - cv, f[0] - cu) - Math.atan2(g[1] - cv, g[0] - cu))){
      const at = clip(fu, fv, rr); if (!at) continue;
      const [u, v] = at; legs.push(at);
      k.forms.column(u, v, F + .05, T);
      const b = s + .3;
      k.box('deck', u - b, u + b, F, F + .05, v - b, v + b, NOBOT);                     // the ballast plate
      for (const su of [-1, 1]) for (const sv of [-1, 1]){                              // glow-tape Ls at its corners
        const cu0 = u + su * (b + .1), cv0 = v + sv * (b + .1), L = .3, W = .06;
        k.edge(Math.min(cu0, cu0 - su * L), Math.max(cu0, cu0 - su * L), F + .003, F + .015, cv0 - W / 2, cv0 + W / 2, p.color, A.TAPE, PY | SIDES);
        k.edge(cu0 - W / 2, cu0 + W / 2, F + .003, F + .015, Math.min(cv0, cv0 - sv * L), Math.max(cv0, cv0 - sv * L), p.color, A.TAPE, PY | SIDES);
      }
    }
    // head beams + braced tiers on every face that keeps out of what hangs
    const yT = T - .07, yBeam = yT - D.BEAM, clearY = Number.isFinite(p.hangY) ? p.hangY - .3 : -Infinity;
    const y0 = F + .4, y1 = yBeam - .15, nT = Math.max(1, Math.ceil((y1 - y0) / D.OPEN_TIER));
    const tiers = Array.from({ length: nT + 1 }, (_, t) => y0 + (y1 - y0) * t / nT);
    if (legs.length > 1) for (let i = 0; i < legs.length; i++){
      if (legs.length === 2 && i) break;
      const a = legs[i], b = legs[(i + 1) % legs.length];
      if (hits(a, b, HG, BW + .1)) continue;
      k.forms.beam(a, b, yT);
      // its VU: LED segments along the beam's outer face (an axis-aligned beam — the stand's own frame)
      const ax = Math.abs(a[1] - b[1]) < 1e-6 ? 'u' : Math.abs(a[0] - b[0]) < 1e-6 ? 'v' : null;
      if (ax){
        const lo = Math.min(a[ax === 'u' ? 0 : 1], b[ax === 'u' ? 0 : 1]) + s + .3, hi = Math.max(a[ax === 'u' ? 0 : 1], b[ax === 'u' ? 0 : 1]) - s - .3;
        const c = ax === 'u' ? a[1] : a[0], out = Math.sign(c - (ax === 'u' ? cv : cu)) || 1, n = Math.max(2, Math.round((hi - lo) / A.SEG)), pitch = (hi - lo) / n;
        const o0 = c + out * (BW + .02), o1 = c + out * (BW + .045), ym = (yT + yBeam) / 2;
        if (hi - lo > .8) for (let j = 0; j < n; j++){
          const s0 = lo + j * pitch + .04, s1 = s0 + pitch - .08, code = vuCode(p.pulse, j, n);
          if (ax === 'u') k.edge(s0, s1, ym - .09, ym + .09, Math.min(o0, o1), Math.max(o0, o1), p.color, code, PY | SIDES);
          else k.edge(Math.min(o0, o1), Math.max(o0, o1), ym - .09, ym + .09, s0, s1, p.color, code, PY | SIDES);
        }
      }
      if (H < 1.8) continue;
      const near = hits(a, b, HG, 1), L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      const A0 = [a[0] + dx * s, a[1] + dz * s], B0 = [b[0] - dx * s, b[1] - dz * s];
      for (let t = 0; t < nT; t++){
        if (near && tiers[t + 1] > clearY) break;                                       // (a brace never crosses what hangs)
        const ya = tiers[t], yb = tiers[t + 1], np = Math.max(1, Math.round(L / Math.max(yb - ya, 3)));
        if (t) k.bar('steel', [A0[0], ya, A0[1]], [B0[0], ya, B0[1]], .11, .11, ALL);
        for (let j = 0; j < np; j++){
          const P0 = [A0[0] + (B0[0] - A0[0]) * j / np, A0[1] + (B0[1] - A0[1]) * j / np], P1 = [A0[0] + (B0[0] - A0[0]) * (j + 1) / np, A0[1] + (B0[1] - A0[1]) * (j + 1) / np];
          k.bar('steel', [P0[0], ya, P0[1]], [P1[0], yb, P1[1]], .08, .05);
          k.bar('steel', [P1[0], ya, P1[1]], [P0[0], yb, P0[1]], .08, .05);
        }
      }
    }
    // the LED floor ring round the whole stand (its feet and what hangs over the floor)
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [u, v] of legs.length ? legs : feet){ u0 = Math.min(u0, u - s - .55); u1 = Math.max(u1, u + s + .55); v0 = Math.min(v0, v - s - .55); v1 = Math.max(v1, v + s + .55); }
    if (HG){ u0 = Math.min(u0, HG[0] - .45); u1 = Math.max(u1, HG[1] + .45); v0 = Math.min(v0, HG[2] - .45); v1 = Math.max(v1, HG[3] + .45); }
    u0 = Math.max(u0, -p.hw + .05); u1 = Math.min(u1, p.hw - .05); v0 = Math.max(v0, -p.hd + .05); v1 = Math.min(v1, p.hd - .05);
    const ringR = { x: p.x, z: p.z, yaw: p.yaw, hw: (u1 - u0) / 2, hd: (v1 - v0) / 2, cu: (u0 + u1) / 2, cv: (v0 + v1) / 2 };
    vuRing(k, ringR, F + .004, F + .03, [p], null, [-.15, -.02]);
    // a service ladder, bracketed to the leg beside it
    const acc = p.access;
    if (acc){
      k.forms.ladder(p, T, acc);
      const alongU = acc.side[1] === 'v', K = acc.side[0] === '+' ? 1 : -1;
      let best = null;
      for (const g of legs){
        const a = alongU ? g[0] : g[1], lo = Math.max(acc.a0 + .1, a - s + .05), hi = Math.min(acc.a1 - .1, a + s - .05);
        if (hi > lo && (!best || Math.abs((alongU ? g[1] : g[0]) - K * (alongU ? p.hd : p.hw)) < best.d)) best = { g, at: (lo + hi) / 2, d: Math.abs((alongU ? g[1] : g[0]) - K * (alongU ? p.hd : p.hw)) };
      }
      if (best) for (const y of [...landings(p, F), T - 1.1]){
        if (y < F + 1.5) continue;
        const face = K * ((alongU ? p.hd : p.hw) - .02), leg = (alongU ? best.g[1] : best.g[0]) + K * s;
        const A1 = alongU ? [best.at, y, face] : [face, y, best.at], B1 = alongU ? [best.at, y, leg] : [leg, y, best.at];
        if (!hits([A1[0], A1[2]], [B1[0], B1[2]], HG, .06) || y < clearY) k.bar('steel', A1, B1, .09, .09, ALL);
      }
    }
    return NONE;
  }
  /* does the segment p → q (local u, v) cross the rect R = [u0, u1, v0, v1] grown by g? */
  function hits(p, q, R, g){
    if (!R) return false;
    let t0 = 0, t1 = 1;
    const d = [q[0] - p[0], q[1] - p[1]], lo = [R[0] - g, R[2] - g], hi = [R[1] + g, R[3] + g];
    for (let i = 0; i < 2; i++){
      if (Math.abs(d[i]) < 1e-12){ if (p[i] < lo[i] || p[i] > hi[i]) return false; continue; }
      let a = (lo[i] - p[i]) / d[i], b = (hi[i] - p[i]) / d[i]; if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return false;
    }
    return true;
  }

  /* ---------------- the forms, by band ---------------- */
  const style = {
    key: 'arena',
    mats,
    edgeMat: edge,                                                       // (the room's update writes uVU / uGhost)
    /* a loft member's light is its loft's (spikes on the shared deck, its stretch of the fascia) */
    edge(p){ return p.loft ? NONE : null; },
    flush(p, k){
      if (p.open) return openStand(p, k);
      const F = k.floor;
      if (p.fixed){                                                     // the belt's kerb: a low deck its posts stand in
        const T = F + FOOT.KERB, fr = deckTop(k, p, T, F);
        k.box('skirt', -p.hw + A.LIP, p.hw - A.LIP, F - .01, T - fr, -p.hd + A.LIP, p.hd - A.LIP, SIDES);
        ledLine(k, p, F + .012, Math.max(F + .03, T - fr - .006), p.color, p.pulse);
        return NONE;
      }
      const T = p.top, fr = deckTop(k, p, T, F);
      k.box('skirt', -p.hw + A.LIP, p.hw - A.LIP, F - .01, T - fr, -p.hd + A.LIP, p.hd - A.LIP, SIDES);
      if (p.kind === 'kit') vuRing(k, p, Math.max(F + .04, T - fr - .05 - A.FASCIA), T - fr - .05, [p], null);   // (the drum riser, even at its own height)
      else ledLine(k, p, T - fr - .05, T - fr - .012, p.color, p.pulse);
      spikes(k, p, T, p.color);
      return NONE;
    },
    low(p, k){
      if (p.open) return openStand(p, k);
      const F = k.floor, T = p.top, fr = deckTop(k, p, T, F);
      k.box('skirt', -p.hw + A.LIP, p.hw - A.LIP, F - .01, T - fr, -p.hd + A.LIP, p.hd - A.LIP, SIDES);
      const fh = Math.max(.14, Math.min(A.FASCIA, (T - F - fr) * .42));
      vuRing(k, p, T - fr - .07 - fh, T - fr - .07, [p], p.access);
      spikes(k, p, T, p.color);
      access(k, p, T, F, 'stage');
      return NONE;
    },
    mid(p, k){
      if (p.open) return openStand(p, k);
      const F = k.floor, T = p.top, s = slab(k, p, T, F);
      layher(k, p, T, s.y0, F, gapOf(p.access));
      vuRing(k, p, s.y0 + .1, T - s.fr - .08, [p], p.access);
      spikes(k, p, T, p.color);
      access(k, p, T, F, 'scaffold');
      return NONE;
    },
    high(p, k){
      if (p.open) return openStand(p, k);
      const F = k.floor, T = p.top, s = slab(k, p, T, F);
      k.forms.trussFrame(p, s.y0, landings(p, F));                       // (the kit's box truss: 'steel' = the rig's aluminium)
      const g = gapOf(p.access); k.forms.rails(p, T, g?.[0] ?? null, g?.[1] ?? 0, g?.[2] ?? 0);
      vuRing(k, p, s.y0 + .1, T - s.fr - .08, [p], p.access);
      spikes(k, p, T, p.color);
      access(k, p, T, F, 'scaffold');
      return NONE;
    },
    loft(L, k){
      const F = k.floor, T = L.top, members = k.plan.pads.filter(p => p.loft === L.id);
      let y0, fr;
      if (L.band === 'low'){
        fr = deckTop(k, L, T, F);
        k.box('skirt', -L.hw + A.LIP, L.hw - A.LIP, F - .01, T - fr, -L.hd + A.LIP, L.hd - A.LIP, SIDES);
        y0 = F + .04;
      } else {
        const s = slab(k, L, T, F); y0 = s.y0 + .1; fr = s.fr;
        if (L.band === 'mid') layher(k, L, T, s.y0, F, gapOf(L.access));
        else {
          k.forms.trussFrame(L, s.y0, landings(L, F));
          const g = gapOf(L.access); k.forms.rails(L, T, g?.[0] ?? null, g?.[1] ?? 0, g?.[2] ?? 0);
        }
      }
      access(k, L, T, F, L.band === 'low' ? 'stage' : 'scaffold');
      // the members share the ring (each its own meter on the stretch nearest it) + spike marks on the deck
      const yTop = T - fr - (L.band === 'low' ? .07 : .08);
      const yBot = L.band === 'low' ? Math.max(y0, yTop - Math.max(.14, Math.min(A.FASCIA, (T - F - fr) * .42))) : y0;
      vuRing(k, L, yBot, yTop, members, L.access);
      for (const m of members){ k.frame(m); spikes(k, m, Math.max(T, m.top), m.color); k.frame(L); }
      return NONE;
    },
    dispose(){
      if (made) for (const s of made._own){ made[s].map?.dispose(); made[s].normalMap?.dispose(); made[s].dispose(); }
      edge.dispose(); made = null;
    },
  };
  return style;
}
