import * as THREE from 'three';
import { FOOT } from './footing.js';
import { GY, rng, seedOf, onSide, ring, doorOf, doorApex, doorLamps, towerOf, stairLamp,
         terraceLanterns, arcadeOf, PIER, TERR } from './graveyard-place.js';
/* ============================================================
   GRAVEYARD FOOTING — what the machines stand on in the Midnight Graveyard: a room STYLE for
   rooms/footing3d.js (its header is the contract). Gothic stone, wrought iron and old timber,
   weathered and mossy under the moon — the churchyard built them, not a rental company:

     flush  a LEDGER STONE — a flat grave slab: a carved border, slabs laid in it with moss in the
            joints, a crack or two (the belt's kerb is one too)
     low    a CHEST TOMB — panelled sides between pilasters, a frieze, a moulded lid — up CRYPT STEPS
            (worn stone, an iron handrail, a lamp post at the foot)
     mid    a MAUSOLEUM — its roof is the deck: ashlar walls, stepped corner piers, string courses, a
            cornice, a pointed door between two wall lanterns, wrought-iron railings with spear finials,
            climbed by a stone stair against its wall or an iron ladder
     high   a TIMBER SCAFFOLD — posts on stone footings, ledgers lashed outboard at every tier, rickety
            cross-braces, iron bands, a plank deck, timber rails; the top bay of its front left open as
            a GALLOWS frame with a lantern hanging in it; a caged iron ladder, timber rest landings
     open   (something hangs below what the machine rests on: the turntable's resonators) stone PIERS
            under its feet — timber posts when it is lifted high — iron ties kept out of what hangs, a
            carved kerb round it on the ground
     loft   a CRYPT TERRACE — a stone deck on an ARCADE of corbelled arches round every face (squat when
            low, an aqueduct's tiers when tall), an iron fence and lanterns above the low band

   THE LIGHT (one reactive accent per machine — all of it the kit's single edge draw): a line of GHOST
   LIGHT in the carved groove of every stone a machine stands on (ledger, lid, roof, the kerb round an
   open stand), the seam and threshold of a mausoleum's door, the glass of the lanterns that answer it
   (wall, gallows, stair, terrace), each terrace member's stretch of the cornice — the machine's colour
   drawn toward the marsh light, answering its own strikes. The lanterns' FLAMES are the room's
   (graveyard.js lights them at graveyard-place footLights — the same pure layout this file hangs their
   iron from), so they gutter brighter on the strikes too.

   Everything is written into the kit's merged slots — 'base' weathered granite, 'ashlar' coursed
   masonry, 'moss', 'steel' wrought iron, 'deck' old timber + the edge: six draws for a whole song's
   footing, whatever it holds — and stays inside footingBoxes(plan). The materials are made once per
   room (warm(): at the room's build, so no footing build pays for a texture) and disposed with it.
   ============================================================ */

const PY = 1, NY = 2, PX = 4, NX = 8, PZ = 16, NZ = 32, ALL = 63, NOBOT = ALL & ~NY, SIDES = PX | NX | PZ | NZ;
const HAND = 1.3;                                          // a stair's handrail over its nosing line
const _noop = new WeakMap();                               // (a hook's "drawn it myself": one empty group per build)
const NOOP = k => { let g = _noop.get(k); if (!g){ g = new THREE.Group(); g.name = 'footing:hooks'; _noop.set(k, g); } return g; };

/* ---- textures (canvas: none in a headless test — the materials keep their colour) ---- */
function tex(size, draw, { repeat = .5 } = {}){
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  t.repeat.set(repeat, repeat);                            // (the kit's uvs are world × .25: .5 → an 8 u tile)
  return t;
}
/* a soft blot, wrapped across the tile's edges (only where it reaches them) */
function blot(x, cx, cy, r, rgb, a, S){
  for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]){
    const px = cx + ox, py = cy + oy;
    if (px + r < 0 || px - r > S || py + r < 0 || py - r > S) continue;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g; x.fillRect(px - r, py - r, 2 * r, 2 * r);
  }
}
/* weathered granite: a pale grey, speckled, with lichen blooms, rain streaks and hairline cracks */
function stoneTex(){
  return tex(512, (x, S) => {
    const R = rng(71);
    x.fillStyle = '#9c9f97'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) blot(x, R() * S, R() * S, 20 + R() * 70, R() < .5 ? '70,74,70' : '190,192,182', .07 + R() * .1, S);
    for (let i = 0; i < 24; i++) blot(x, R() * S, R() * S, 8 + R() * 26, `${150 + R() * 40 | 0},${160 + R() * 30 | 0},${90 + R() * 30 | 0}`, .12 + R() * .14, S);
    for (let i = 0; i < 7000; i++){ const v = R() < .5 ? 60 : 200; x.fillStyle = `rgba(${v},${v},${v - 6},${.06 + R() * .1})`; x.fillRect(R() * S, R() * S, 1 + R() * 1.6, 1 + R() * 1.6); }
    x.strokeStyle = 'rgba(40,42,40,.16)';
    for (let i = 0; i < 40; i++){ const sx = R() * S, sy = R() * S, L = 30 + R() * 120; x.lineWidth = 1 + R() * 3; x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + (R() - .5) * 6, sy + L); x.stroke(); }
    x.strokeStyle = 'rgba(30,32,30,.5)'; x.lineWidth = 1.2;
    for (let i = 0; i < 5; i++){ let px = R() * S, py = R() * S; x.beginPath(); x.moveTo(px, py);
      for (let k = 0; k < 7; k++){ px += (R() - .5) * 40; py += 10 + R() * 22; x.lineTo(px, py); } x.stroke(); }
  });
}
/* coursed ashlar: blocks ≈ .67 u high, 1 – 1.9 u long, lime mortar, each block its own tone */
function ashlarTex(){
  return tex(512, (x, S) => {
    const R = rng(72), U = S / 8, ch = S / 12;              // (8 u a tile: 12 courses)
    x.fillStyle = '#5c5e55'; x.fillRect(0, 0, S, S);         // the mortar
    for (let r = 0; r < 12; r++){
      let u = -R() * U;
      while (u < S){
        const w = (1 + R() * .9) * U, v = 122 + R() * 50 | 0, g = R() * 14 - 7, col = `rgb(${v + g},${v + 2 + g},${v - 6})`;
        const y0 = r * ch + 1.5, bh = ch - 3;
        const put = (x0, bw) => { x.fillStyle = col; x.fillRect(x0, y0, bw, bh);
          x.fillStyle = 'rgba(30,32,28,.22)'; x.fillRect(x0, y0 + bh - 4, bw, 4); x.fillStyle = 'rgba(230,232,220,.12)'; x.fillRect(x0, y0, bw, 3); };
        put(u + 1.5, Math.min(w, S - u) - 3);
        if (u + w > S) put(0, u + w - S - 1.5);             // (wraps)
        u += w;
      }
    }
    for (let i = 0; i < 5000; i++){ const v = R() < .5 ? 50 : 210; x.fillStyle = `rgba(${v},${v},${v - 6},${.05 + R() * .08})`; x.fillRect(R() * S, R() * S, 1 + R(), 1 + R()); }
    for (let i = 0; i < 28; i++) blot(x, R() * S, R() * S, 10 + R() * 30, `${120 + R() * 40 | 0},${150 + R() * 30 | 0},${70 + R() * 30 | 0}`, .14 + R() * .16, S);
    for (let i = 0; i < 26; i++) blot(x, R() * S, R() * S, 30 + R() * 60, '40,44,40', .08 + R() * .1, S);
  });
}
/* old timber: grey-brown, long grain, a knot or two, weathered silver */
function woodTex(){
  return tex(256, (x, S) => {
    const R = rng(73);
    x.fillStyle = '#b9b0a2'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++){ const px = R() * S, v = R() < .5 ? 50 : 170;
      x.strokeStyle = `rgba(${v},${v - 8},${v - 20},${.08 + R() * .14})`; x.lineWidth = .6 + R() * 1.8;
      x.beginPath(); x.moveTo(px, 0); x.bezierCurveTo(px + (R() - .5) * 8, S * .33, px + (R() - .5) * 8, S * .66, px, S); x.stroke(); }
    for (let i = 0; i < 5; i++){ x.fillStyle = 'rgba(50,38,26,.5)'; x.beginPath(); x.ellipse(R() * S, R() * S, 2 + R() * 3, 5 + R() * 6, 0, 0, Math.PI * 2); x.fill(); }
    for (let i = 0; i < 14; i++) blot(x, R() * S, R() * S, 16 + R() * 40, '170,172,168', .08 + R() * .1, S);
  }, { repeat: 1 });
}

/* the GHOST LIGHT: the kit's edge (aColor × (uBase + uGain · uPulse[slot]), additive) in the yard's own
   key — each machine's colour drawn a third of the way toward the marsh light, so it belongs to the night.
   uNorm[slot] (the room writes it: 1 / the machine's loudest strike) lets a quiet machine's strikes — the
   kit's brushed hats, a music box — reach the same flare as a loud one's; ^.6 lifts the soft ones further */
function ghostEdge(){
  return new THREE.ShaderMaterial({
    uniforms: { uPulse: { value: new Float32Array(FOOT.MAX_PULSE) }, uNorm: { value: new Float32Array(FOOT.MAX_PULSE).fill(1) },
                uBase: { value: .26 }, uGain: { value: 1.6 } },
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aPulse;
      uniform float uPulse[${FOOT.MAX_PULSE}]; uniform float uNorm[${FOOT.MAX_PULSE}]; uniform float uBase, uGain;
      varying vec3 vC;
      void main(){
        float l = dot(aColor, vec3(.3, .55, .15));
        vec3 c = mix(aColor, vec3(.45, .95, .78) * max(l, .3) * 1.3, .33);
        int i = int(aPulse + .5);
        vC = c * (uBase + uGain * pow(clamp(uPulse[i] * uNorm[i], 0., 1.), .6));
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

/* ---- small helpers in the current frame ---- */
/* does the segment p → q (local u, v) cross the rect [u0, u1, v0, v1] grown by g? (footing3d segHits) */
function segHits(p, q, R, g){
  if (!R) return false;
  let t0 = 0, t1 = 1;
  const d = [q[0] - p[0], q[1] - p[1]], lo = [R[0] - g, R[2] - g], hi = [R[1] + g, R[3] + g];
  for (let k = 0; k < 2; k++){
    if (Math.abs(d[k]) < 1e-12){ if (p[k] < lo[k] || p[k] > hi[k]) return false; continue; }
    let a = (lo[k] - p[k]) / d[k], b = (hi[k] - p[k]) / d[k]; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return false;
  }
  return true;
}
/* where a deck's railing opens for its access: [side, along0, along1] (footing3d gapOf) */
const gapOf = acc => !acc ? [null, 0, 0] : acc.kind === 'stair' ? [acc.side, acc.a1 - acc.out, acc.a1] : (() => {
  const mid = (acc.a0 + acc.a1) / 2, off = acc.flights > 1 ? ((acc.flights - 1) % 2 ? .45 : -.45) : 0;
  return [acc.side, mid + off - .33 - .15, mid + off + .33 + .15]; })();
/* one side's writers, by (along a, out o past the face): points, boxes, light */
function sideKit(k, r, side){
  const S = onSide(r, side);
  return {
    W: (a, o, y) => { const [u, v] = S(a, o); return [u, y, v]; },
    box(slot, a0, a1, o0, o1, y0, y1, faces){ const p = S(a0, o0), q = S(a1, o1);
      k.box(slot, Math.min(p[0], q[0]), Math.max(p[0], q[0]), y0, y1, Math.min(p[1], q[1]), Math.max(p[1], q[1]), faces); },
    edge(a0, a1, o0, o1, y0, y1, color, pulse){ const p = S(a0, o0), q = S(a1, o1);
      k.edge(Math.min(p[0], q[0]), Math.max(p[0], q[0]), y0, y1, Math.min(p[1], q[1]), Math.max(p[1], q[1]), color, pulse); },
  };
}

/* ---- the carved stone TOP every stone deck has: a border, a groove holding the ghost light, a field of
   slabs with moss in the joints (settled a hair, one cracked now and then). It occupies T − G … T; the
   stone under it must have its top face at T − G (the groove's floor). ---- */
const G = .05;
function carvedTop(k, u0, u1, v0, v1, T, R){
  const W = u1 - u0, D = v1 - v0, b = Math.min(.34, .14 * Math.min(W, D)), gw = .1;
  k.box('base', u0, u1, T - G, T, v1 - b, v1, PY | PZ | NZ | PX | NX);
  k.box('base', u0, u1, T - G, T, v0, v0 + b, PY | PZ | NZ | PX | NX);
  k.box('base', u0, u0 + b, T - G, T, v0 + b, v1 - b, PY | NX | PX);
  k.box('base', u1 - b, u1, T - G, T, v0 + b, v1 - b, PY | NX | PX);
  const c = b + gw, f0 = [u0 + c, v0 + c], f1 = [u1 - c, v1 - c];
  if (f1[0] - f0[0] < .2 || f1[1] - f0[1] < .2) return;
  const ax = f1[0] - f0[0] >= f1[1] - f0[1] ? 0 : 1, len = f1[ax] - f0[ax], n = Math.max(1, Math.round(len / 3.3)), jw = .06;
  const put = (slot, a0, a1, y0, y1, faces) => ax === 0 ? k.box(slot, a0, a1, y0, y1, f0[1], f1[1], faces) : k.box(slot, f0[0], f1[0], y0, y1, a0, a1, faces);
  const P = ax === 0 ? (q, y) => [q[0], y, q[1]] : (q, y) => [q[1], y, q[0]];
  for (let i = 0; i < n; i++){
    const s0 = f0[ax] + len * i / n, s1 = f0[ax] + len * (i + 1) / n;
    const a0 = s0 + (i ? jw / 2 : 0), a1 = s1 - (i < n - 1 ? jw / 2 : 0);
    const cracked = R() < .4, top = T - (cracked ? .012 : R() * .006);
    put('base', a0, a1, T - G, top, NOBOT);
    if (i < n - 1) put('moss', s1 - jw / 2, s1 + jw / 2, T - G, T - .02, PY);
    if (cracked){                                          // a jagged crack across it, moss in it
      const o0 = f0[1 - ax], o1 = f1[1 - ax], pts = [];
      for (let j = 0; j <= 3; j++) pts.push([a0 + (a1 - a0) * (.2 + .6 * R()), o0 + .03 + (o1 - o0 - .06) * j / 3]);
      for (let j = 0; j < 3; j++) k.bar('moss', P(pts[j], top - .002), P(pts[j + 1], top - .002), .035, .008, ALL);
    }
  }
}

/* ---- the GHOST LIGHT round a stone: a lit joint on the faces of the course under its overhanging lid (the
   body's faces stand `ins` in from the rect's edge; the strip stands LIP proud of them, so it stays inside the
   rect and OUTSIDE the machine's footprint — the pad's margin — where the audience sees it) ---- */
const LIP = .02, LIP_H = .085;
function lipLight(k, hw, hd, ins, y1, color, pulse, y0 = y1 - LIP_H){
  const a = ins - LIP, b = ins;
  k.edge(-hw + a, hw - a, y0, y1, hd - b, hd - a, color, pulse, PZ | PX | NX);
  k.edge(-hw + a, hw - a, y0, y1, -hd + a, -hd + b, color, pulse, NZ | PX | NX);
  k.edge(hw - b, hw - a, y0, y1, -hd + b, hd - b, color, pulse, PX);
  k.edge(-hw + a, -hw + b, y0, y1, -hd + b, hd - b, color, pulse, NX);
}

/* ---- an iron LANTERN round a flame at (u, y, v): a base, four corner rods, its glass (the light), a cap ---- */
function lantern(k, [u, y, v], color, pulse, hang = false){
  const h = .1;
  k.box('steel', u - .12, u + .12, y - .22, y - .18, v - .12, v + .12, ALL);
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.box('steel', u + a * h - .016, u + a * h + .016, y - .18, y + .16, v + b * h - .016, v + b * h + .016, SIDES);
  k.edge(u - .084, u + .084, y - .18, y + .16, v - .084, v + .084, color, pulse);
  k.box('steel', u - .135, u + .135, y + .16, y + .2, v - .135, v + .135, ALL);
  k.box('steel', u - .07, u + .07, y + .2, y + .27, v - .07, v + .07, ALL);
  if (hang) k.box('steel', u - .02, u + .02, y + .27, y + .34, v - .02, v + .02, SIDES | PY);
}
/* a spear finial on a post top at y (a tapering stack) */
function spear(k, u, y, v){
  k.box('steel', u - .08, u + .08, y, y + .06, v - .08, v + .08, ALL);
  k.box('steel', u - .05, u + .05, y + .06, y + .12, v - .05, v + .05, PY | SIDES);
  k.box('steel', u - .025, u + .025, y + .12, y + .18, v - .025, v + .025, PY | SIDES);
}

/* ---- a CRYPT STAIR (a solid stone flight against a face, worn uneven, its body back to the wall at
   oIn) with an iron handrail; its foot newel carries a lamp (graveyard-place stairLamp) ---- */
function cryptStair(k, r, T, acc, R, oIn = -.14){
  const F = k.floor, s = sideKit(k, r, acc.side), ow = acc.out, n = acc.n, rise = acc.rise, tr = acc.tread, aL = acc.a1 - ow;
  for (let i = 1; i < n; i++){
    const a0 = acc.a0 + (i - 1) * tr, a1 = a0 + tr, y = F + i * rise, wear = .03 + R() * .06;
    s.box('base', a0, a1 + .02, oIn, ow - wear, F - .04, y - .04, NOBOT);
    s.box('base', a0 + .03, a1 + .02, oIn, ow - wear - .025, y - .04, y - R() * .006, NOBOT);   // its worn tread
    if (R() < .3) s.box('moss', a1 - .14, a1 + .02, .02, .3 + R() * .35, y - .04, y + .02, NOBOT);  // moss in the corner
  }
  s.box('base', aL, acc.a1, oIn, ow, F - .04, T - .04, NOBOT);
  s.box('base', aL + .03, acc.a1, oIn, ow, T - .04, T, NOBOT);
  // the iron handrail on the open side, its balusters, its newels — the foot one a lamp post
  const o = ow - .16, lamp = stairLamp(r, F), y0 = F + rise + HAND, y1 = T + HAND, a00 = acc.a0 + .14;
  k.bar('steel', s.W(a00, o, y0), s.W(aL, o, y1), .06, .06, ALL);
  k.bar('steel', s.W(aL, o, y1), s.W(acc.a1 - .05, o, y1), .06, .06, ALL);
  const run = aL - a00, nb = Math.max(1, Math.round(run / .55));
  for (let j = 1; j < nb; j++){ const a = a00 + run * j / nb, i = Math.min(n - 1, Math.max(1, Math.ceil((a - acc.a0) / tr))), yb = F + i * rise;
    k.bar('steel', s.W(a, o, yb), s.W(a, o, y0 + (y1 - y0) * j / nb), .035, .035); }
  for (const a of [aL, acc.a1 - .05]){ k.bar('steel', s.W(a, o, T), s.W(a, o, y1 + .02), .08, .08, SIDES); const [u, , v] = s.W(a, o, 0); spear(k, u, y1 + .02, v); }
  if (lamp){
    k.bar('steel', [lamp[0], F + rise - .02, lamp[2]], [lamp[0], lamp[1] - .22, lamp[2]], .085, .085, SIDES);
    lantern(k, lamp, r.color, r.pulse);
  }
}

/* ---- an IRON LADDER up a face (footing3d's, in iron; its masts at oM — the wall / post line): stiles,
   rungs, brackets, a cage past FOOT.CAGE, timber rest landings every LAND_DY ---- */
function ironLadder(k, r, T, acc, oM, yTop){
  const F = k.floor, s = sideKit(k, r, acc.side), W2 = s.W;
  const nf = acc.flights, mid = (acc.a0 + acc.a1) / 2, off = nf > 1 ? .45 : 0, O = .34, hh = .33;
  for (let f = 0; f < nf; f++){
    const y0 = F + (T - F) * f / nf, y1 = F + (T - F) * (f + 1) / nf, ac = mid + (f % 2 ? off : -off), top = f === nf - 1;
    for (const d of [-hh, hh]) k.bar('steel', W2(ac + d, O, y0), W2(ac + d, O, y1 + (top ? 1.15 : 1)), .085, .06, ALL);
    for (let y = y0 + .45; y < y1 - .05; y += .45) k.bar('steel', W2(ac - hh, O, y), W2(ac + hh, O, y), .045, .045);
    const m1 = top ? yTop : y1 - .12;
    for (const d of [-hh, hh]){
      k.bar('steel', W2(ac + d, oM, y0), W2(ac + d, oM, m1), .09, .09, f ? SIDES : SIDES | PY);
      for (let y = y0 + 1.6; y < m1 - .3; y += 3) k.bar('steel', W2(ac + d, O, y), W2(ac + d, oM, y), .055, .055);
      k.bar('steel', W2(ac + d, O, m1 - .25), W2(ac + d, oM, m1 - .25), .055, .055);
    }
    if (acc.cage){                                         // wrought-iron HOOPS (a half ring each), three straps
      const c0 = y0 + (f ? 1.3 : 3.2), c1 = y1 + (top ? 1.1 : .9), R0 = O - .02, R1 = O + .78, hw = hh + .2, NS = 5;
      const at = phi => [ac + hw * Math.sin(phi), R0 + (R1 - R0) * Math.cos(phi)];
      if (c1 > c0 + .3){
        for (let y = c0; y <= c1 + 1e-6; y += Math.max(.9, (c1 - c0) / Math.max(1, Math.round((c1 - c0) / 1.35)))){
          for (let j = 0; j < NS; j++){
            const [a1, o1] = at(-Math.PI / 2 + Math.PI * j / NS), [a2, o2] = at(-Math.PI / 2 + Math.PI * (j + 1) / NS);
            k.bar('steel', W2(a1, o1, y), W2(a2, o2, y), .045, .05);
          }
        }
        for (const phi of [-Math.PI / 3, 0, Math.PI / 3]){ const [a, o] = at(phi); k.bar('steel', W2(a, o, c0), W2(a, o, c1), .04, .04); }
      }
    }
    if (!top){                                             // the rest landing: a stone slab on two iron knee brackets
      const a0 = acc.a0, a1 = acc.a1, yl = y1, o1 = acc.out;
      s.box('base', a0, a1, oM, o1, yl - .16, yl, ALL);
      for (const a of [a0 + .12, a1 - .12]) k.bar('steel', W2(a, oM + .05, yl - 1.05), W2(a, o1 - .12, yl - .17), .07, .07, ALL);
      const oR = o1 - .11;                                 // (the rail line: its finials stay inside the ladder's rect)
      for (const a of [a0 + .1, a1 - .1]){ k.bar('steel', W2(a, oR, yl), W2(a, oR, yl + FOOT.RAIL - .1), .07, .07, PY | SIDES); const [u, , v] = W2(a, oR, 0); spear(k, u, yl + FOOT.RAIL - .1, v); }
      k.bar('steel', W2(a0 + .1, oR, yl + FOOT.RAIL - .3), W2(a1 - .1, oR, yl + FOOT.RAIL - .3), .06, .06, ALL);
      k.bar('steel', W2(a0 + .1, oR, yl + FOOT.RAIL / 2 - .1), W2(a1 - .1, oR, yl + FOOT.RAIL / 2 - .1), .05, .05);
    }
  }
}

/* ---- WROUGHT-IRON railings round a deck at T (inset .12): posts with spear finials, pickets with tips,
   two rails — open over [g0, g1] along the access side; lamp posts where asked. Tops ≤ T + RAIL. ---- */
function ironFence(k, r, T, gapSide, g0, g1, lampPosts = []){
  const hu = r.hw - .12, hv = r.hd - .12;
  const runs = [['-v', [-hu, -hv], [hu, -hv]], ['+u', [hu, -hv], [hu, hv]], ['+v', [hu, hv], [-hu, hv]], ['-u', [-hu, hv], [-hu, -hv]]];
  for (const [side, p, q] of runs){
    const isU = side[1] === 'u', al = pt => isU ? pt[1] : pt[0], P = (a, y) => isU ? [p[0], y, a] : [a, y, p[1]];
    const lo = Math.min(al(p), al(q)), hi = Math.max(al(p), al(q)), segs = [];
    if (side === gapSide){ if (g0 - .05 > lo + .3) segs.push([lo, g0 - .05]); if (g1 + .05 < hi - .3) segs.push([g1 + .05, hi]); }
    else segs.push([lo, hi]);
    for (const [a, b] of segs){
      const L = b - a; if (L < .2) continue;
      const n = Math.max(1, Math.ceil(L / 2.2));
      for (let i = 0; i <= n; i++){ const [u, , v] = P(a + L * i / n, 0);
        k.box('steel', u - .05, u + .05, T, T + 1.24, v - .05, v + .05, SIDES); spear(k, u, T + 1.24, v); }
      k.bar('steel', P(a, T + 1.08), P(b, T + 1.08), .05, .07, ALL);
      k.bar('steel', P(a, T + .16), P(b, T + .16), .05, .07, ALL);
      const m = Math.max(1, Math.round(L / .33));
      for (let i = 1; i < m; i++){ const [u, , v] = P(a + L * i / m, 0);                // (a picket: its tip is the post's finials' job)
        k.box('steel', u - .018, u + .018, T + .1, T + 1.2, v - .018, v + .018, SIDES); }
    }
  }
  for (const [u, v] of lampPosts) k.box('steel', u - .055, u + .055, T, T + 1.0, v - .055, v + .055, SIDES | PY);
}

/* ---- the FORMS (each in its pad's / loft's frame, set by the caller) ---- */
/** flush: a LEDGER STONE (the belt's kerb is one too) */
function ledger(k, p){
  const F = k.floor, T = p.fixed ? F + FOOT.KERB : p.top, R = rng(seedOf(p.key)), I = .06;
  k.box('base', -p.hw + I, p.hw - I, F - .04, T - G, -p.hd + I, p.hd - I, NOBOT);       // the slab, under its carved top's lip
  carvedTop(k, -p.hw, p.hw, -p.hd, p.hd, T, R);
  k.box('base', -p.hw, p.hw, T - G - .025, T - G, -p.hd, p.hd, NY | SIDES);            // (the lip's underside)
  lipLight(k, p.hw, p.hd, I, T - G - .03, p.color, p.pulse, Math.max(F + .005, T - G - .03 - LIP_H));
}

/** low: a CHEST TOMB (panelled sides between pilasters, a frieze, a moulded lid) up CRYPT STEPS */
function chestTomb(k, p){
  const F = k.floor, T = p.top, R = rng(seedOf(p.key) ^ 0x51), hw = p.hw, hd = p.hd;
  const lid = Math.max(Math.min(.3, .1 + .06 * (T - F)), (p.well || 0) + .06), fr = .1, yb = F + .24, yt = Math.max(yb, T - lid - fr);   // (what dips in stays in the lid)
  k.box('base', -hw + .04, hw - .04, F - .04, yb, -hd + .04, hd - .04, NOBOT);          // the base course
  k.box('ashlar', -hw + .16, hw - .16, yb, yt, -hd + .16, hd - .16, SIDES);            // the panels
  if (yt - yb > .25){
    const pil = (u0, u1, v0, v1) => k.box('base', u0, u1, yb, yt, v0, v1, SIDES);
    for (const su of [-1, 1]) for (const sv of [-1, 1]){ const cu = su * (hw - .26), cv = sv * (hd - .26); pil(cu - .18, cu + .18, cv - .18, cv + .18); }
    for (const sv of [-1, 1]){ const n = Math.ceil((2 * hw - .7) / 2.6); for (let i = 1; i < n; i++){ const u = -hw + .26 + (2 * hw - .52) * i / n;
      pil(u - .16, u + .16, sv > 0 ? hd - .18 : -hd + .08, sv > 0 ? hd - .08 : -hd + .18); } }
    for (const su of [-1, 1]){ const n = Math.ceil((2 * hd - .7) / 2.6); for (let i = 1; i < n; i++){ const v = -hd + .26 + (2 * hd - .52) * i / n;
      pil(su > 0 ? hw - .18 : -hw + .08, su > 0 ? hw - .08 : -hw + .18, v - .16, v + .16); } }
  }
  k.box('base', -hw + .07, hw - .07, yt, T - lid, -hd + .07, hd - .07, SIDES);          // the frieze
  k.box('base', -hw, hw, T - lid, T - G, -hd, hd, ALL);                                 // the lid
  carvedTop(k, -hw, hw, -hd, hd, T, R);
  lipLight(k, hw, hd, .07, T - lid - .015, p.color, p.pulse);                          // (on the frieze, under the lid)
  if (p.access) p.access.kind === 'stair' ? cryptStair(k, p, T, p.access, R, -.15) : ironLadder(k, p, T, p.access, -.16, T - lid);
}

/** mid: a MAUSOLEUM whose roof is the deck */
function mausoleum(k, p){
  const F = k.floor, T = p.top, R = rng(seedOf(p.key) ^ 0x7a), hw = p.hw, hd = p.hd, I = GY.INS;
  const Dr = Math.max(.42, (p.well || 0) + .06), corn = GY.ROOF - .42, yW = T - Dr - corn, yb = F + GY.PLINTH;
  k.box('base', -hw + .12, hw - .12, F - .04, yb, -hd + .12, hd - .12, NOBOT);         // the base course
  k.box('ashlar', -hw + I, hw - I, yb, yW, -hd + I, hd - I, SIDES);                     // the walls
  for (const su of [-1, 1]) for (const sv of [-1, 1]){                                  // corner piers, set off halfway up
    const cu = su * (hw - .72), cv = sv * (hd - .72), ym = yb + (yW - yb) * .55;
    k.box('base', cu - .42, cu + .42, yb, ym, cv - .42, cv + .42, SIDES);
    k.box('base', cu - .42 + .07 * su, cu + .42 + .07 * su, ym, ym + .14, cv - .42 + .07 * sv, cv + .42 + .07 * sv, PY | NY | SIDES);
    k.box('base', cu - .35 + .07 * su, cu + .35 + .07 * su, ym + .14, yW, cv - .35 + .07 * sv, cv + .35 + .07 * sv, SIDES);
  }
  const d = doorOf(p, F), c0 = d ? yb + doorApex(d) + .5 : yb + 3.3;
  for (let y = c0; y < yW - 1.2; y += 3.3) k.box('base', -hw + I - .09, hw - I + .09, y, y + .16, -hd + I - .09, hd - I + .09, PY | NY | SIDES);   // string courses
  k.box('base', -hw + .3, hw - .3, yW, yW + corn * .45, -hd + .3, hd - .3, SIDES | NY);  // the cornice, two steps
  k.box('base', -hw + .08, hw - .08, yW + corn * .45, T - Dr, -hd + .08, hd - .08, SIDES | NY);
  k.box('base', -hw, hw, T - Dr, T - G, -hd, hd, ALL);                                  // the roof slab: the deck
  carvedTop(k, -hw, hw, -hd, hd, T, R);
  lipLight(k, hw, hd, .08, T - Dr - .015, p.color, p.pulse);                           // (on the cornice, under the roof)
  // the DOOR: a pointed surround, two iron-strapped timber leaves, light at its seam and its threshold
  if (d){
    const s = sideKit(k, p, d.side), w = d.w, h = d.h, o = -I;
    for (const e of [-1, 1]) s.box('base', d.a + e * (w / 2 + .14) - .14, d.a + e * (w / 2 + .14) + .14, o - .02, o + .15, yb, yb + h, SIDES | PY);
    const apex = yb + h + d.rise, foot = yb + h - .05;
    for (const e of [-1, 1]) k.bar('base', s.W(d.a + e * (w / 2 + .16), o + .065, foot), s.W(d.a, o + .065, apex), .17, .24, ALL);
    s.box('base', d.a - .14, d.a + .14, o - .02, o + .15, apex - .1, apex + .12, ALL);   // the keystone
    s.box('deck', d.a - w / 2, d.a + w / 2, o - .02, o + .06, yb, yb + h, ALL);          // the leaves
    for (const y of [yb + h * .28, yb + h * .7]) s.box('steel', d.a - w / 2 + .08, d.a + w / 2 - .08, o + .06, o + .085, y - .05, y + .05, ALL);
    for (const e of [-1, 1]) s.box('steel', d.a + e * .2 - .045, d.a + e * .2 + .045, o + .06, o + .1, yb + h * .5 - .05, yb + h * .5 + .05, ALL);   // ring pulls
    s.edge(d.a - .02, d.a + .02, o + .06, o + .068, yb + .03, yb + h - .05, p.color, p.pulse);   // the seam
    s.edge(d.a - w / 2 + .04, d.a + w / 2 - .04, o + .06, o + .072, yb, yb + .035, p.color, p.pulse);   // the threshold
    for (const pt of doorLamps(p, F)){                    // a wall lantern each side, hung from a bracket
      const [u, y, v] = pt, back = d.side[1] === 'u' ? [Math.sign(u) * (hw - I), y + .36, v] : [u, y + .36, Math.sign(v) * (hd - I)];
      k.bar('steel', back, [u, y + .36, v], .04, .04, ALL);
      k.bar('steel', [back[0], back[1] - .34, back[2]], [(u + back[0]) / 2, y + .36, (v + back[2]) / 2], .03, .03, ALL);
      lantern(k, pt, p.color, p.pulse, true);
    }
  }
  const [gs, g0, g1] = gapOf(p.access);
  ironFence(k, p, T, gs, g0, g1);
  if (p.access) p.access.kind === 'stair' ? cryptStair(k, p, T, p.access, R, -I + .01) : ironLadder(k, p, T, p.access, -I, yW);
}

/** high: a RUINED BELL TOWER — the crypt terrace's own arcade round every storey (one stone language for
    everything at gallery height), a timber headstock under its deck with the BELL hung from it in the
    belfry, a lantern hung in the front arch of the belfry, broken pinnacles at its corners, an iron fence */
function tower(k, p){
  const F = k.floor, T = p.top, R = rng(seedOf(p.key) ^ 0x3c), Tw = towerOf(p, F), hw = p.hw, hd = p.hd;
  cloister(k, p, Tw.Dd, R, Tw.nT);
  lipLight(k, hw, hd, .04, T - Tw.Dd - .015, p.color, p.pulse);                         // (on the cornice, under the deck)
  // the belfry: a headstock across the tower's short way, the bell hung under it
  const yH = Tw.yC, along = hw >= hd, sp = (along ? hd : hw) - TERR.INP;
  along ? k.box('deck', -.17, .17, yH - .32, yH, -sp, sp, ALL) : k.box('deck', -sp, sp, yH - .32, yH, -.17, .17, ALL);
  const { r, y: yb } = Tw.bell;
  const prof = [[.2, .12], [.36, .14], [.48, .16], [.54, .24], [.6, .26], [.72, .2], [.9, .14], [1, .08]];   // crown → lip (radius × r, height × r)
  let y = yb;
  for (const [w, h] of prof){                              // each course an octagon: two boxes + two diagonal bars
    const y0 = y - h * r * 1.25, a = w * r, c = a * .414, ym = (y + y0) / 2, d = a * .7071;
    k.box('steel', -a, a, y0, y, -c, c, ALL); k.box('steel', -c, c, y0, y, -a, a, ALL);
    k.bar('steel', [-d, ym, -d], [d, ym, d], 2 * c, y - y0, ALL); k.bar('steel', [-d, ym, d], [d, ym, -d], 2 * c, y - y0, ALL);
    y = y0;
  }
  k.box('steel', -.05, .05, y - .05, yb - .2, -.05, .05, SIDES);                       // the clapper
  k.box('steel', -.11, .11, y - .26, y - .05, -.11, .11, ALL);
  // the lantern, hung from the crown of its arch
  if (Tw.lamp){ const [u, ly, v] = Tw.lamp; k.bar('steel', [u, ly + .34, v], [u, Tw.yC - .45, v], .03, .03, SIDES); lantern(k, Tw.lamp, p.color, p.pulse, true); }
  // broken pinnacles at the corners (in the pad's margin, where the fence's corner posts stand; the fence's
  // corner post rises inside each)
  const q = .22;
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]){
    const u = su * (hw - .02 - q / 2), v = sv * (hd - .02 - q / 2), h = .45 + R() * .85;
    k.box('ashlar', u - q / 2, u + q / 2, T - .02, T + h, v - q / 2, v + q / 2, PY | SIDES);
    if (h > .9) k.box('base', u - q / 2 - .03, u + q / 2 + .03, T + .38, T + .48, v - q / 2 - .03, v + q / 2 + .03, ALL);
  }
  const [gs, g0, g1] = gapOf(p.access);
  ironFence(k, p, T, gs, g0, g1);
  if (p.access) ironLadder(k, p, T, p.access, -.2, Tw.yC);
}
/** open: PIERS under its feet (timber posts when high), ties kept out of what hangs, a carved kerb round it */
function piers(k, p){
  const F = k.floor, T = p.top, H = T - F, high = p.band === 'high', R = rng(seedOf(p.key) ^ 0x2d);
  const feet = p.feet?.length ? p.feet : [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [a * (p.hw - .6), b * (p.hd - .6), .3]);
  const cu = feet.reduce((s, f) => s + f[0], 0) / feet.length, cv = feet.reduce((s, f) => s + f[1], 0) / feet.length;
  // (a pier is slid off what hangs along its shallower side — never off its foot: footing3d's clip)
  const HG = p.hang, clip = (u, v, s, r) => {
    if (!HG) return [u, v];
    const x0 = HG[0] - .05, x1 = HG[1] + .05, z0 = HG[2] - .05, z1 = HG[3] + .05;
    if (u + s <= x0 || u - s >= x1 || v + s <= z0 || v - s >= z1) return [u, v];
    const [du, dv] = [[x0 - u - s, 0], [x1 - u + s, 0], [0, z0 - v - s], [0, z1 - v + s]].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0];
    return Math.abs(du + dv) <= r ? [u + du, v + dv] : null;
  };
  const hull = [];
  for (const [fu, fv, rr = .3] of feet.slice().sort((f, g) => Math.atan2(f[1] - cv, f[0] - cu) - Math.atan2(g[1] - cv, g[0] - cu))){
    const s = high ? .26 : Math.max(.24, Math.min(.4, rr * .58)), at = clip(fu, fv, s + .14, rr);
    if (!at) continue;
    const [u, v] = at; hull.push([u, v]);
    if (high){
      k.box('base', u - .4, u + .4, F - .04, F + .3, v - .4, v + .4, NOBOT);
      k.box('steel', u - .3, u + .3, F + .3, F + .52, v - .3, v + .3, SIDES | PY);
      k.box('deck', u - s, u + s, F + .3, T - .1, v - s, v + s, SIDES);
      k.box('steel', u - s - .08, u + s + .08, T - .1, T, v - s - .08, v + s + .08, ALL);
    } else {
      const bh = Math.min(.3, H * .15), capH = Math.min(.24, H * .12);
      k.box('base', u - s - .14, u + s + .14, F - .04, F + bh, v - s - .14, v + s + .14, NOBOT);
      k.box(H > 2.5 ? 'ashlar' : 'base', u - s, u + s, F + bh, T - capH, v - s, v + s, SIDES);
      k.box('base', u - s - .1, u + s + .1, T - capH, T, v - s - .1, v + s + .1, ALL);
    }
  }
  // each face: a head beam + (stone) a sill at the foot, unless it crosses what hangs; tall: iron ties
  // (stone) / timber ledgers + braces (high) in tiers ≤ 6 — below what hangs where it passes near
  const y0 = F + .3, y1 = T - .45, nT = Math.max(1, Math.ceil((y1 - y0) / 6)), yT = Array.from({ length: nT + 1 }, (_, t) => y0 + (y1 - y0) * t / nT);
  const clearY = Number.isFinite(p.hangY) ? p.hangY - .3 : -Infinity;
  if (hull.length > 1) for (let i = 0; i < hull.length; i++){
    const a = hull[i], b = hull[(i + 1) % hull.length];
    if (hull.length === 2 && i) break;
    if (segHits(a, b, p.hang, .15)) continue;
    k.bar(high ? 'deck' : 'steel', [a[0], T - .26, a[1]], [b[0], T - .26, b[1]], .18, .26, ALL);
    if (!high) k.bar('base', [a[0], F + .1, a[1]], [b[0], F + .1, b[1]], .3, .28, ALL);
    if (H <= 1.6) continue;
    const near = segHits(a, b, p.hang, 1);
    for (let t = 0; t < nT; t++){
      if (near && yT[t + 1] > clearY) break;
      if (high){
        if (t) k.bar('deck', [a[0], yT[t], a[1]], [b[0], yT[t], b[1]], .24, .24, ALL);
        k.bar('deck', [a[0], yT[t], a[1]], [b[0], yT[t + 1], b[1]], .1, .18);
        if (R() < .75) k.bar('deck', [b[0], yT[t], b[1]], [a[0], yT[t + 1], a[1]], .1, .18);
      } else {
        if (t) k.bar('steel', [a[0], yT[t], a[1]], [b[0], yT[t], b[1]], .07, .07, ALL);
        k.bar('steel', [a[0], yT[t], a[1]], [b[0], yT[t + 1], b[1]], .045, .045);
        k.bar('steel', [b[0], yT[t], b[1]], [a[0], yT[t + 1], a[1]], .045, .045);
      }
    }
  }
  // the carved kerb on the ground round its pad's edge (outside the machine, where it is seen), its light
  // on the kerb's outer face
  const KI = .04, u0 = -p.hw + KI, u1 = p.hw - KI, v0 = -p.hd + KI, v1 = p.hd - KI;
  const kw = .17, kh = F + .14;
  for (const o of [0, kw + .05]){                         // two courses, the channel between
    const i0 = o, i1 = o + kw;
    k.box('base', u0 + i0, u1 - i0, F - .04, kh, v1 - i1, v1 - i0, PY | PZ | NZ | PX | NX);
    k.box('base', u0 + i0, u1 - i0, F - .04, kh, v0 + i0, v0 + i1, PY | PZ | NZ | PX | NX);
    k.box('base', u0 + i0, u0 + i1, F - .04, kh, v0 + i1, v1 - i1, PY | PX | NX);
    k.box('base', u1 - i1, u1 - i0, F - .04, kh, v0 + i1, v1 - i1, PY | PX | NX);
  }
  lipLight(k, p.hw, p.hd, KI, kh - .035, p.color, p.pulse, F + .015);
  if (p.access) ironLadder(k, p, T, p.access, -.6, T - .3);
}

/** loft: a CRYPT TERRACE on an arcade of corbelled arches round every face (tiers when tall), an iron
    fence + lanterns above the low band, each member's light on the cornice */
/* the CLOISTER both a terrace and a tower stand on: a carved stone deck Dd deep, a two-step cornice under it,
   and under that an ARCADE round every face — piers on footings, a pointed arch between each pair, a
   string course between storeys (nT of them; squat arches when low) — or, too low for one, a crypt wall.
   Returns yC, the cornice's underside. */
function cloister(k, r, Dd, R, nT0){
  const F = k.floor, T = r.top, H = T - F, corn = .36, yC = T - Dd - corn, INP = TERR.INP, hp = PIER / 2;
  k.box('base', -r.hw, r.hw, T - Dd, T - G, -r.hd, r.hd, ALL);                            // the deck slab
  carvedTop(k, -r.hw, r.hw, -r.hd, r.hd, T, R);
  k.box('base', -r.hw + .12, r.hw - .12, yC, yC + corn * .5, -r.hd + .12, r.hd - .12, SIDES | NY);   // the cornice
  k.box('base', -r.hw + .04, r.hw - .04, yC + corn * .5, T - Dd, -r.hd + .04, r.hd - .04, SIDES | NY);
  if (yC - F < 1.7){                                       // too low for an arcade: a crypt wall under the cornice
    k.box('base', -r.hw + .08, r.hw - .08, F - .04, F + .28, -r.hd + .08, r.hd - .08, NOBOT);
    k.box('ashlar', -r.hw + .16, r.hw - .16, F + .28, yC, -r.hd + .16, r.hd - .16, SIDES);
    return yC;
  }
  const nT = nT0 || Math.max(1, Math.round((yC - F) / 8)), tierTop = t => F + (yC - F) * (t + 1) / nT;
  for (const side of ['-v', '+v', '-u', '+u']){
    const s = sideKit(k, r, side), half = side[1] === 'u' ? r.hd : r.hw, A = arcadeOf(2 * half), ends = side[1] === 'u';
    const DF = ends ? PX | NX : PZ | NZ;                   // (the face's own front + back, in the frame)
    A.forEach((a, i) => {                                 // the piers (the ±u faces leave their corners to the ±v ones)
      if (ends && (i === 0 || i === A.length - 1)) return;
      s.box('base', a - hp - .12, a + hp + .12, -INP - hp - .12, -INP + hp + .12, F - .04, F + .32, NOBOT);
      s.box('ashlar', a - hp, a + hp, -INP - hp, -INP + hp, F + .32, yC, SIDES);
    });
    for (let t = 0; t < nT; t++){
      const y1 = tierTop(t), y0 = t ? tierTop(t - 1) : F + .32, band = t < nT - 1 ? .5 : 0, th = y1 - y0;
      let spring = null;
      for (let i = 0; i < A.length - 1; i++){
        const a0 = A[i] + hp, a1 = A[i + 1] - hp;
        if (a1 - a0 < .3) continue;
        const rise = Math.min((a1 - a0) * .62, Math.max(.4, (th - band) * (H < 4 ? .5 : .42)));
        spring = y1 - band - .45 - rise;
        arch(k, s, a0, a1, rise, y1 - band, -INP, 2 * hp, DF);
      }
      if (spring !== null && spring - y0 > .5) A.forEach((a, i) => {                   // the imposts the arches spring from
        if (ends && (i === 0 || i === A.length - 1)) return;
        s.box('base', a - hp - .06, a + hp + .06, -INP - hp - .05, -INP + hp + .05, spring - .16, spring, ALL);
      });
      if (band){                                           // a string course round the tier
        const e = ends ? -hp - .07 : hp + .06;
        s.box('base', A[0] - e, A[A.length - 1] + e, -INP - hp - .06, -INP + hp + .06, y1 - band, y1, ALL);
      }
    }
  }
  return yC;
}
/* a POINTED ARCH over a0..a1 (along its face) whose crown is .45 under `top`: a ring of voussoirs standing a
   hair proud (two-centred when it rises at least half its span, else a segment), its keystone, the masonry
   behind it in courses that hide under the ring, the spandrel wall up to `top`. In the face's frame (s):
   its wall is `dep` deep round the line o = oc; DF = the wall's front + back faces in the frame. */
function arch(k, s, a0, a1, rise, top, oc, dep, DF){
  const span = a1 - a0, mid = (a0 + a1) / 2, yS = top - .45 - rise, ring = Math.min(.34, .16 + .06 * span);
  // the intrados of the LEFT half: x(y) for y in yS..yS + rise, and its centre
  let cx, cy, Rr;
  if (rise >= span / 2 - 1e-6){ Rr = (rise * rise + span * span / 4) / span; cx = a0 + Rr; cy = yS; }
  else { Rr = (span * span / 4 + rise * rise) / (2 * rise); cx = mid; cy = yS + rise - Rr; }
  const xAt = y => cx - Math.sqrt(Math.max(0, Rr * Rr - (y - cy) * (y - cy)));
  const yA = yS + rise, w0 = dep - .04, wR = dep + .03;
  // the masonry behind the ring: courses whose inner edge sits on the intrados at their foot (the ring hides the steps)
  const n = Math.max(2, Math.ceil(rise / .26));
  for (let j = 0; j < n; j++){
    const ya = yS + rise * j / n, yb = yS + rise * (j + 1) / n, e = Math.min(mid, xAt(ya));
    if (e - a0 < .02) continue;
    if (e >= mid - .01){ s.box('ashlar', a0, a1, oc - w0 / 2, oc + w0 / 2, ya, yb, DF); continue; }
    s.box('ashlar', a0, e, oc - w0 / 2, oc + w0 / 2, ya, yb, DF);
    s.box('ashlar', a1 - (e - a0), a1, oc - w0 / 2, oc + w0 / 2, ya, yb, DF);
  }
  s.box('ashlar', a0, a1, oc - w0 / 2, oc + w0 / 2, yA, top, DF | NY);                  // the spandrel
  // the ring: 4 voussoirs a side along the intrados, each standing out from it by `ring`
  const th0 = Math.atan2(yS - cy, a0 - cx), th1 = Math.atan2(yA - cy, mid - cx), NV = 4;
  for (const sgn of [-1, 1]){
    const X = x => sgn < 0 ? x : a1 - (x - a0);
    for (let i = 0; i < NV; i++){
      const ta = th0 + (th1 - th0) * i / NV, tb = th0 + (th1 - th0) * (i + 1) / NV, tm = (ta + tb) / 2;
      const nx = Math.cos(tm), ny = Math.sin(tm), o = ring / 2, ext = ring * .28;
      let ax = cx + Rr * Math.cos(ta) + nx * o, ay = cy + Rr * Math.sin(ta) + ny * o, bx = cx + Rr * Math.cos(tb) + nx * o, by = cy + Rr * Math.sin(tb) + ny * o;
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, ea = i ? ext : 0, eb = i < NV - 1 ? ext : 0;
      ax -= dx / L * ea; ay -= dy / L * ea; bx += dx / L * eb; by += dy / L * eb;
      k.bar('base', s.W(X(ax), oc, ay), s.W(X(bx), oc, by), wR, ring, ALL);
    }
  }
  s.box('base', mid - .15, mid + .15, oc - wR / 2 - .02, oc + wR / 2 + .02, yA - .06, yA + ring + .1, ALL);   // the keystone
}

function terrace(k, L, members){
  const F = k.floor, T = L.top, R = rng(seedOf(L.id));
  const Dd = Math.max(.5, (L.well || 0) + .06), yC = cloister(k, L, Dd, R);
  // each member's light: its stretch of the cornice (front and back; an end it reaches)
  for (const m of members){
    let m0 = Infinity, m1 = -Infinity, n0 = Infinity, n1 = -Infinity;
    const cc = Math.cos(m.yaw || 0), ss = Math.sin(m.yaw || 0);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]){
      const x = m.x + cc * a * m.hw + ss * b * m.hd - L.x, z = m.z - ss * a * m.hw + cc * b * m.hd - L.z;
      m0 = Math.min(m0, x); m1 = Math.max(m1, x); n0 = Math.min(n0, z); n1 = Math.max(n1, z);
    }
    m0 = Math.max(-L.hw + .14, m0); m1 = Math.min(L.hw - .14, m1); n0 = Math.max(-L.hd + .14, n0); n1 = Math.min(L.hd - .14, n1);
    const y0 = yC + .05, y1 = yC + .1;
    if (m1 - m0 > .2) for (const side of ['+v', '-v']) sideKit(k, L, side).edge(m0, m1, -.124, -.108, y0, y1, m.color, m.pulse);
    if (n1 - n0 > .2){
      if (m0 <= -L.hw + .4) sideKit(k, L, '-u').edge(n0, n1, -.124, -.108, y0, y1, m.color, m.pulse);
      if (m1 >= L.hw - .4) sideKit(k, L, '+u').edge(n0, n1, -.124, -.108, y0, y1, m.color, m.pulse);
    }
  }
  // the fence (not on a low terrace: that's a step up) and its lanterns, each answering the member nearest it
  const lamps = terraceLanterns(L);
  if (L.band !== 'low'){
    const [gs, g0, g1] = gapOf(L.access);
    ironFence(k, L, T, gs, g0, g1, lamps.map(([u, , v]) => [u, v]));
    for (const pt of lamps){
      let best = Infinity, who = members[0];
      for (const m of members){ const dd = Math.hypot(m.x - L.x - pt[0], m.z - L.z - pt[2]); if (dd < best){ best = dd; who = m; } }
      lantern(k, pt, who?.color, who?.pulse ?? 0);
    }
  }
  if (L.access){
    const first = members[0];
    const lit = { ...L, color: first?.color, pulse: first?.pulse ?? 0 };
    L.access.kind === 'stair' ? cryptStair(k, lit, T, L.access, R, -.14) : ironLadder(k, L, T, L.access, -.2, yC);
  }
}
/* ---- the STYLE ---- */
export function graveyardStyle(){
  let made = null;
  const style = {
    key: 'graveyard',
    mats(kit, ctx = {}){
      if (made) return made;
      const env = ctx.envMap ?? null;
      made = {
        base: new THREE.MeshStandardMaterial({ color: 0xc4c9bd, map: stoneTex(), roughness: .94, metalness: 0, envMap: env, envMapIntensity: .25 }),
        ashlar: new THREE.MeshStandardMaterial({ color: 0xc0c6b8, map: ashlarTex(), roughness: .95, metalness: 0, envMap: env, envMapIntensity: .2 }),
        moss: new THREE.MeshStandardMaterial({ color: 0x6a8550, roughness: 1, metalness: 0 }),
        steel: new THREE.MeshStandardMaterial({ color: 0x6c737c, metalness: .5, roughness: .5, envMap: env, envMapIntensity: .7 }),
        deck: new THREE.MeshStandardMaterial({ color: 0xd9d4ca, map: woodTex(), roughness: .9, metalness: 0, envMap: env, envMapIntensity: .35 }),   // (silvered old timber)
        edge: ghostEdge(),
      };
      return made;
    },
    /** make the materials now (the room's build), so no footing build pays for a texture */
    warm(envMap){ style.mats(null, { envMap }); return style; },
    flush(p, k){ p.open ? piers(k, p) : ledger(k, p); return NOOP(k); },
    low(p, k){ p.open ? piers(k, p) : chestTomb(k, p); return NOOP(k); },
    mid(p, k){ p.open ? piers(k, p) : mausoleum(k, p); return NOOP(k); },
    high(p, k){ p.open ? piers(k, p) : tower(k, p); return NOOP(k); },
    loft(L, k){ terrace(k, L, k.plan.pads.filter(p => p.loft === L.id)); return NOOP(k); },
    edge(p, k){ return NOOP(k); },                               // (every form lights its machine itself)
    get materials(){ return made; },
    dispose(){
      if (made) for (const m of Object.values(made)){ m.map?.dispose(); m.dispose(); }
      made = null;
    },
  };
  return style;
}
