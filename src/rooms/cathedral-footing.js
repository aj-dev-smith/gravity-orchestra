import * as THREE from 'three';
import { FOOT } from './footing.js';
import { gapOf, onSide } from './footing3d.js';
/* ============================================================
   CATHEDRAL FOOTING — what the machines stand on in the Cathedral Nave: STONE and OAK.
   A room style for rooms/footing3d.js (its header is the contract): every hook writes into the
   kit's merged slots, so a whole song's footing stays one draw per material + one for the light.

     FLUSH  an ashlar limestone plinth: a base course, the body set back, a moulded cap; a BRASS
            INLAY runs under the cap (the machine's light). The belt: a low stone kerb, a brass line
            set into its top.
     LOW    a CHANCEL dais: the same moulding, its faces dressed in BLIND ARCADING (pilasters and
            pointed heads), climbed by worn limestone steps with brass nosings and a brass ALTAR RAIL.
     MID    a stone TRIBUNE: a deck (cornice over a fascia, its brass band) on an ARCADE — square
            piers, pointed arches, coursed spandrels — behind a pierced stone balustrade (mullions
            under little pointed heads), climbed by a stone stair with a sloped parapet.
     HIGH   CLUSTERED PIERS (the nave's piers in miniature) carrying the deck on pointed arches,
            string courses tying them at every landing, the balustrade; climbed by a round SPIRAL-
            STAIR TURRET (slit windows glowing up a helix, a pointed cap) hugging one side.
     LOFT   a CHOIR LOFT: the arcade / clustered piers of its band under one deck, a carved dark-OAK
            gallery front (posts, a blind lower panel, three-light pointed tracery above), each
            member's brass band on the fascia under its own stretch.
     OPEN   (a `stand` machine: the turntable) stone colonnettes under its feet, lintels only where
            nothing hangs, a brass ring set in the floor round them (its light).
     LADDER a short climb: an oak ladder on iron brackets; anything taller than TURRET_MIN climbs
            inside a turret.
   Slots: 'base' = limestone, 'deck' = oak, 'steel' = wrought iron (a kit form that falls back reads
   in the room's palette too), 'brass', 'glow' (the turret's lit slits: additive, unlit) — and the
   EDGE: brass at rest, its machine's hue warming in on a strike (one draw, uPulse per pad).
   Everything stays inside footingBoxes(plan) (the shot solve's envelopes): the arcades and piers are
   set back inside the deck's footprint, the turret and the stairs inside their access rects, the
   balustrades and the gallery front under deck + FOOT.RAIL. 1 u ≈ .677 m.
   ============================================================ */

const PY = 1, NY = 2, PX = 4, NX = 8, PZ = 16, NZ = 32, ALL = 63, NOBOT = ALL & ~NY, SIDES = PX | NX | PZ | NZ;
const STONE = 'base', OAK = 'deck', IRON = 'steel', BRASS = 'brass', GLOW = 'glow';
const RAIL_H = FOOT.RAIL;

export const CATH = {
  INLAY: .05,                 // the brass inlay's height (≈ 3 cm)
  DECK: .55,                  // a stone deck's depth (cornice + fascia), or deeper over a machine's well
  CORNICE: .16,               // its projecting top course
  ARC_IN: .45, PIER: .64, WALL: .46, RING: .28,   // a tribune's arcade: set back, pier width, wall depth, arch ring
  CL_IN: .62, CL_SPAN: 7,     // a tower's clustered piers: set back, most apart
  COURSE: .34,                // a spandrel's coursing
  PARA_IN: .18, MULLION: .5,  // the balustrade's line (set back from the deck's edge), mullion pitch
  HAND: 1.3,                  // the altar rail over the nosing line
  TURRET_MIN: 5,              // a ladder climb higher than this is a turret's spiral stair
  OAK_BAY: 1.15,              // the oak gallery front's post pitch
};

/* ---- materials (made once per room — in its build(), so a room swap never paints them; the room
   disposes them) ---- */
/* n grains (dark lo / light hi, alpha a0 + R()·da, up to w × h px) blended straight into the pixels — one
   ImageData pass instead of n fillRects (a texture paints in ~1 ms, not ~8) */
function speckle(x, S, R, n, tint, lo, hi, a0, da, w, h){
  const img = x.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < n; i++){
    const [r, g, b] = tint(R() < .5 ? lo : hi), a = a0 + R() * da, px = R() * S | 0, py = R() * S | 0;
    const gw = 1 + (R() * (w - 1) + .5 | 0), gh = 1 + (R() * (h - 1) + .5 | 0);
    for (let yy = 0; yy < gh; yy++) for (let xx = 0; xx < gw; xx++){
      const o = 4 * (((py + yy) % S) * S + (px + xx) % S);
      d[o] += (r - d[o]) * a; d[o + 1] += (g - d[o + 1]) * a; d[o + 2] += (b - d[o + 2]) * a;
    }
  }
  x.putImageData(img, 0, 0);
}
function ashlarTex(){
  if (typeof document === 'undefined') return null;
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  let s = 23; const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
  x.fillStyle = '#86725a'; x.fillRect(0, 0, S, S);                       // the mortar
  const rows = 8, rh = S / rows;                                          // 4 u tile → courses of .5 u (≈ 34 cm)
  for (let r = 0; r < rows; r++){
    // block joints round the row, cyclic in x (the texture tiles)
    const off = R() * S, cuts = [off];
    for (let p = off + 120 + R() * 150; p < off + S - 100; p += 120 + R() * 150) cuts.push(p);
    cuts.push(off + S);
    for (let i = 0; i + 1 < cuts.length; i++){
      const a = cuts[i] + 1.5, b = cuts[i + 1] - 1.5, v = (R() - .5) * 26, w = R();
      const g = x.createLinearGradient(0, r * rh, 0, (r + 1) * rh);
      const tone = k => `rgb(${(222 + v - k) | 0},${(201 + v * .95 - k) | 0},${(160 + v * .85 - k * 1.1) | 0})`;
      g.addColorStop(0, tone(-4)); g.addColorStop(.7, tone(4)); g.addColorStop(1, tone(14 + w * 10));   // weathered toward its bed
      x.fillStyle = g;
      for (const o of [0, -S]) x.fillRect(a + o, r * rh + 1.5, b - a, rh - 3);
    }
  }
  for (let i = 0; i < 70; i++){                                           // soft stains (wraps)
    const cx = R() * S, cy = R() * S, rr = 10 + R() * 46, a = .03 + R() * .05, dark = R() < .6;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]){
      if (cx + ox + rr < 0 || cx + ox - rr > S || cy + oy + rr < 0 || cy + oy - rr > S) continue;   // (only the copies that land on the tile)
      const g = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rr);
      g.addColorStop(0, dark ? `rgba(90,70,48,${a})` : `rgba(255,246,226,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(cx + ox - rr, cy + oy - rr, 2 * rr, 2 * rr);
    }
  }
  speckle(x, S, R, 5000, v => [v, v - 8, v - 20], 70, 245, .04, .07, 2, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
function oakTex(){
  if (typeof document === 'undefined') return null;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  let s = 5; const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
  x.fillStyle = '#6e4a2e'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++){                                           // close grain + medullary flecks, both ways
    const v = R() < .5, p = R() * S, a = .05 + R() * .08, dark = R() < .65;
    x.strokeStyle = dark ? `rgba(40,24,12,${a})` : `rgba(160,118,78,${a * .8})`; x.lineWidth = .6 + R() * 1.6;
    x.beginPath();
    for (const o of [-S, 0, S]){ if (v){ x.moveTo(p + o, 0); x.bezierCurveTo(p + o + 6, S * .3, p + o - 6, S * .7, p + o, S); }
      else { x.moveTo(0, p + o); x.bezierCurveTo(S * .3, p + o + 6, S * .7, p + o - 6, S, p + o); } }
    x.stroke();
  }
  speckle(x, S, R, 2500, v => [v, v * .7, v * .45], 30, 150, .05, .07, 1, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
/* the light: additive, unlit, fog-free — a brass line at rest; on its machine's strike it brightens and its
   machine's own hue warms into it (uPulse: one slot per pad, written by the footing's update) */
function brassEdgeMat(){
  return new THREE.ShaderMaterial({
    uniforms: { uPulse: { value: new Float32Array(FOOT.MAX_PULSE) }, uBase: { value: .2 }, uGain: { value: 1.2 },
                uBrass: { value: new THREE.Color(1, .66, .3) } },
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aPulse;
      uniform float uPulse[${FOOT.MAX_PULSE}]; uniform float uBase, uGain; uniform vec3 uBrass;
      varying vec3 vC;
      void main(){
        float p = uPulse[int(aPulse + .5)];
        vC = mix(uBrass, aColor, .15 + .45 * p) * (uBase + uGain * p);
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

/* ---- small geometry ---- */
/* (onSide: along a, out o on one side of a rect → local [u, v]; gapOf: where a deck's parapet opens for its
   access — both rooms/footing3d.js's own, so the parapets open exactly where the kit's would) */
/* does the segment p → q (local u, v) cross the rect [u0, u1, v0, v1] grown by g? (footing3d segHits) */
function segHits(p, q, R, g){
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
/* how far under a deck's edge its arcade wall's outer face stands (set back − half the wall) */
const WALL_O = { square: CATH.ARC_IN - CATH.WALL / 2, cluster: CATH.CL_IN - .25 };
/* a pointed arch over a clear half-span s rising h (≥ s): each half a circle of radius R about a centre xc
   across the middle — R = (h² + s²) / 2s, xc = R − s (equilateral when h = s√3) */
export function pointed(s, h){ const R = (h * h + s * s) / (2 * s); return { R, xc: R - s }; }

/* ---- the forms, written into one kit's slots (its frame set to the spec by the caller) ---- */
function makeForms(k){
  const F = k.floor, C = CATH;

  /* the machine's light: four strips round a rect, just proud of its faces (y0..y1) */
  function inlay(u0, u1, v0, v1, y0, y1, p, o = .018){
    if (!p || !(y1 > y0)) return;
    k.edge(u0 - o, u1 + o, y0, y1, v1 - .01, v1 + o, p.color, p.pulse, PY | PZ | PX | NX);
    k.edge(u0 - o, u1 + o, y0, y1, v0 - o, v0 + .01, p.color, p.pulse, PY | NZ | PX | NX);
    k.edge(u1 - .01, u1 + o, y0, y1, v0, v1, p.color, p.pulse, PY | PX);
    k.edge(u0 - o, u0 + .01, y0, y1, v0, v1, p.color, p.pulse, PY | NX);
  }
  /* a line set into a surface at y (flat, a hair proud): round u0..u1 × v0..v1 */
  function inset(u0, u1, v0, v1, y, p, w = .06){
    if (!p) return;
    k.edge(u0, u1, y + .003, y + .016, v1 - w, v1, p.color, p.pulse); k.edge(u0, u1, y + .003, y + .016, v0, v0 + w, p.color, p.pulse);
    k.edge(u0, u0 + w, y + .003, y + .016, v0 + w, v1 - w, p.color, p.pulse); k.edge(u1 - w, u1, y + .003, y + .016, v0 + w, v1 - w, p.color, p.pulse);
  }

  /* a moulded block: a base course, the body set back, a fillet and a cap (it carries the machine) —
     the brass inlay under the cap. Returns the body's set-back. */
  function plinthBlock(r, T, p, { back = .07, base = .1, cap = .16 } = {}){
    const hw = r.hw, hd = r.hd, H = T - F, bH = Math.min(base, H * .22), cH = Math.min(cap, H * .4), fH = cH * .4;
    k.box(STONE, -hw, hw, F - .04, F + bH, -hd, hd, NOBOT);                                                  // the base course
    k.box(STONE, -hw + back, hw - back, F + bH, T - cH, -hd + back, hd - back, SIDES);                      // the body
    k.box(STONE, -hw + back * .45, hw - back * .45, T - cH, T - cH + fH, -hd + back * .45, hd - back * .45, ALL & ~PY);   // the fillet
    k.box(STONE, -hw, hw, T - cH + fH, T, -hd, hd, ALL);                                                    // the cap
    const y1 = T - cH - .03, y0 = Math.max(F + bH + .025, y1 - C.INLAY);
    inlay(-hw + back, hw - back, -hd + back, hd - back, y0, y1, p);
    return back;
  }
  /* BLIND ARCADING on a block's faces (set back `back`): pilasters every ~1.3 u, a pointed head between
     each pair — proud of the body, never past the cap */
  function blindArcade(r, y0, y1, back){
    const H = y1 - y0; if (H < .5) return;
    for (const f of [['u', -1], ['u', 1], ['v', -1], ['v', 1]]){
      const along = f[0], sg = f[1], len = along === 'u' ? r.hw - back : r.hd - back, at = sg * ((along === 'u' ? r.hd : r.hw) - back);
      const n = Math.max(1, Math.round(2 * len / 1.3)), bay = 2 * len / n, pw = .2, pr = .1;
      // a box in this face: along x0..x1, proud d0..d1 out of the body face (outward = sg)
      const fb = (slot, x0, x1, ya, yb, d0, d1, faces = ALL) => {
        const a = at + sg * d0, b = at + sg * d1, lo = Math.min(a, b), hi = Math.max(a, b);
        along === 'u' ? k.box(slot, x0, x1, ya, yb, lo, hi, faces) : k.box(slot, lo, hi, ya, yb, x0, x1, faces);
      };
      const pt = (x, y, d) => along === 'u' ? [x, y, at + sg * d] : [at + sg * d, y, x];
      for (let i = 0; i <= n; i++){ const x = -len + i * bay; fb(STONE, Math.max(-len, x - pw / 2), Math.min(len, x + pw / 2), y0, y1 - .02, -.01, pr, NOBOT); }
      const s = bay / 2 - pw / 2, h = Math.min(s * 1.55, H * .5);
      if (s < .12 || h < s * .9) continue;
      const { R, xc } = pointed(s, Math.max(h, s)), ys = y1 - .08 - Math.max(h, s), Rm = R + .05, th1 = Math.acos(Math.max(-1, Math.min(1, -xc / Rm)));
      for (let i = 0; i < n; i++){
        const m = -len + (i + .5) * bay;
        for (const hs of [-1, 1]){
          let prev = null;
          for (let j = 0; j <= 3; j++){
            const th = Math.PI + (th1 - Math.PI) * j / 3, x = xc + Rm * Math.cos(th), y = ys + Rm * Math.sin(th);
            const q = pt(m + (hs < 0 ? x : -x), y, pr * .45);
            if (prev) k.bar(STONE, prev, q, pr, .1, SIDES);
            prev = q;
          }
        }
      }
    }
  }

  /* a stone DECK at T: a cornice course over a fascia set back under it, the machine's brass band
     along the fascia. Returns its depth (deeper over a machine's well — footing.js pad.well). */
  function stoneDeck(r, T, light){
    const D = Math.max(C.DECK, (r.well || 0) + .04), yB = T - D, hw = r.hw, hd = r.hd, cH = Math.min(C.CORNICE, D * .4);
    k.box(STONE, -hw, hw, T - cH, T, -hd, hd, ALL);                                                       // the cornice (the machine stands on it)
    k.box(STONE, -hw + .06, hw - .06, yB, T - cH, -hd + .06, hd - .06, ALL & ~PY);                         // the fascia
    const ym = yB + (D - cH) * .55;
    inlay(-hw + .06, hw - .06, -hd + .06, hd - .06, ym - C.INLAY / 2, ym + C.INLAY / 2, light);
    return D;
  }

  /* ---- arcades ---- */
  /* the four faces of a rect's pier line (set back `ins`), piers at most `span` apart */
  function pierFaces(r, ins, span){
    const hu = r.hw - ins, hv = r.hd - ins, n = L => Math.max(1, Math.ceil(2 * L / span - 1e-9));
    const lin = (a, b, m) => Array.from({ length: m + 1 }, (_, i) => a + (b - a) * i / m);
    const pu = lin(-hu, hu, n(hu)), pv = lin(-hv, hv, n(hv));
    return { hu, hv, faces: [{ along: 'u', at: -hv, pts: pu }, { along: 'u', at: hv, pts: pu }, { along: 'v', at: -hu, pts: pv }, { along: 'v', at: hu, pts: pv }],
      piers: [...pu.flatMap(u => [[u, -hv], [u, hv]]), ...pv.slice(1, -1).flatMap(v => [[-hu, v], [hu, v]])] };
  }
  /* a face: an axis line of a rect ({along, at}) or any SEGMENT (segFace: an open stand's bays) — x runs
     along it, d across it */
  const faceBox = (f, slot, x0, x1, y0, y1, d0, d1, faces = ALL) => f.seg
    ? k.bar(slot, facePt(f, x0, (y0 + y1) / 2), facePt(f, x1, (y0 + y1) / 2), d1 - d0, y1 - y0, ALL)
    : f.along === 'u' ? k.box(slot, x0, x1, y0, y1, f.at + d0, f.at + d1, faces) : k.box(slot, f.at + d0, f.at + d1, y0, y1, x0, x1, faces);
  const facePt = (f, x, y) => f.seg ? [f.a[0] + f.d[0] * x, y, f.a[1] + f.d[1] * x] : f.along === 'u' ? [x, y, f.at] : [f.at, y, x];
  const segFace = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); return { seg: true, a, L, d: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] }; };
  /* a face's own flags → the kit's: e1 / e0 the +along / −along ends, ds both depth sides, PY / NY as they are */
  const FL = (f, { e1 = 0, e0 = 0, ds = 1, top = 0, bot = 0 } = {}) => (top ? PY : 0) | (bot ? NY : 0) | (f.along === 'u'
    ? (e1 ? PX : 0) | (e0 ? NX : 0) | (ds ? PZ | NZ : 0) : (e1 ? PZ : 0) | (e0 ? NZ : 0) | (ds ? PX | NX : 0));
  /* one bay of an arcade in face f, between support centres xa < xb (half-widths pa, pb: a pier or a
     colonnette), its capitals at yCap: a pointed ring (t thick, a hair deeper than the wall so it reads as
     a moulding) whose crown meets the storey's line `crown` — a narrow bay's arch is STILTED (jambs above
     the capitals) — the spandrels coursed up to yTop */
  function archBay(f, xa, xb, pa, pb, yCap, crown, t, wd, yTop){
    const s = (xb - xa - pa - pb) / 2, m = xa + pa + s;
    if (s < .2){ faceBox(f, STONE, xa, xb, yCap, yTop, -wd / 2, wd / 2); return; }
    const h = Math.max(s * 1.02, Math.min(s * 1.75, crown - yCap)), y0 = Math.max(yCap, crown - h);
    if (y0 > yCap + .01){ faceBox(f, STONE, xa, m - s, yCap, y0, -wd / 2, wd / 2); faceBox(f, STONE, m + s, xb, yCap, y0, -wd / 2, wd / 2); }
    const { R, xc } = pointed(s, h), Rm = R + t / 2, Re = R + t;
    const th1 = Math.acos(Math.max(-1, Math.min(1, -xc / Rm))), n = Math.max(3, Math.round((Math.PI - th1) * Rm / .45));
    for (const hs of [-1, 1]) for (let i = 0; i < n; i++){
      const ta = Math.PI + (th1 - Math.PI) * i / n, tb = Math.PI + (th1 - Math.PI) * (i + 1) / n;
      let xa_ = xc + Rm * Math.cos(ta), ya_ = y0 + Rm * Math.sin(ta), xb_ = xc + Rm * Math.cos(tb), yb_ = y0 + Rm * Math.sin(tb);
      const L = Math.hypot(xb_ - xa_, yb_ - ya_), ex = (t / 2) * Math.tan((ta - tb) / 2) + .012, dx = (xb_ - xa_) / L, dy = (yb_ - ya_) / L;
      xa_ -= dx * ex; ya_ -= dy * ex; xb_ += dx * ex; yb_ += dy * ex;
      const X = x => m + (hs < 0 ? x : -x);
      k.bar(STONE, facePt(f, X(xa_), ya_), facePt(f, X(xb_), yb_), wd + .05, t, SIDES);
    }
    for (let ya = y0; ya < yTop - .01; ya += C.COURSE){
      const yb = Math.min(yTop, ya + C.COURSE), dy = yb - y0;
      const xe = dy < Re ? xc - Math.sqrt(Re * Re - dy * dy) : 1;            // the left extrados at the course's top (≥ 0: the halves have met)
      // (only what can be seen: the two depth sides, the end that looks at the arch; a course's top is
      //  under the next — wider — one, its bottom inside the ring or on the capital)
      const last = yb >= yTop - .01;
      if (xe >= 0){ faceBox(f, STONE, xa, xb, ya, yb, -wd / 2, wd / 2, FL(f, { top: last })); continue; }
      if (m + xe > xa + .01) faceBox(f, STONE, xa, m + xe, ya, yb, -wd / 2, wd / 2, FL(f, { e1: 1, top: last }));
      if (m - xe < xb - .01) faceBox(f, STONE, m - xe, xb, ya, yb, -wd / 2, wd / 2, FL(f, { e0: 1, top: last }));
    }
  }
  /* a square pier with a base, a capital and an abacus, at (u, v), from the floor to y0 */
  function squarePier(u, v, pw, y0){
    const h = pw / 2;
    k.box(STONE, u - h - .1, u + h + .1, F - .04, F + .28, v - h - .1, v + h + .1, NOBOT);
    k.box(STONE, u - h, u + h, F + .28, y0 - .22, v - h, v + h, SIDES);
    k.box(STONE, u - h - .06, u + h + .06, y0 - .22, y0 - .1, v - h - .06, v + h + .06, ALL);
    k.box(STONE, u - h - .1, u + h + .1, y0 - .1, y0, v - h - .1, v + h + .1, ALL);
  }
  /* a CLUSTERED pier: a core, a shaft on every face, a slimmer one at every corner; a stepped base and
     a flared capital under an abacus (the nave's piers in miniature) */
  function clusterPier(u, v, y0){
    const c = .3, sh = .12, sc = .08, y1 = y0 - .5;
    k.box(STONE, u - .52, u + .52, F - .04, F + .24, v - .52, v + .52, NOBOT);
    k.box(STONE, u - .44, u + .44, F + .24, F + .46, v - .44, v + .44, NOBOT);
    k.box(STONE, u - c, u + c, F + .46, y1, v - c, v + c, SIDES);
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) k.box(STONE, u + a * (c + .02) - sh, u + a * (c + .02) + sh, F + .46, y1, v + b * (c + .02) - sh, v + b * (c + .02) + sh, SIDES);
    for (const [a, b] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) k.box(STONE, u + a * c - sc, u + a * c + sc, F + .46, y1, v + b * c - sc, v + b * c + sc, SIDES);
    k.box(STONE, u - .4, u + .4, y1, y1 + .2, v - .4, v + .4, ALL);
    k.box(STONE, u - .47, u + .47, y1 + .2, y1 + .36, v - .47, v + .47, ALL);
    k.box(STONE, u - .52, u + .52, y1 + .36, y0, v - .52, v + .52, ALL);
  }
  /* an ARCADE under a deck whose underside is yB: piers round the rect (set back ins), a pointed bay
     between each pair on every face, the spandrels coursed to the deck; corner blocks where two faces
     meet. 'square' (a tribune): one storey. 'cluster' (a tower / a high loft — always tall): a
     cathedral's ELEVATION in two storeys — the main arcade on clustered piers, a sill course at the
     gallery level, and above it a GALLERY of paired arches on a colonnette in every bay */
  function arcade(r, yB, kind, shut = null){
    const cl = kind === 'cluster', ins = cl ? C.CL_IN : C.ARC_IN, H = yB - F;
    const span = cl ? Math.min(C.CL_SPAN, Math.max(3.4, H * .5)) : Math.min(5.2, Math.max(2.2, H * .58));
    const { hu, hv, faces, piers } = pierFaces(r, ins, span);
    const ph = cl ? .44 : C.PIER / 2, wd = cl ? .5 : C.WALL, t = cl ? .34 : C.RING, band = .24;
    let sMax = 0;
    for (const f of faces) for (let i = 0; i + 1 < f.pts.length; i++) sMax = Math.max(sMax, (f.pts[i + 1] - f.pts[i]) / 2 - ph);
    const two = cl && H > 6;
    // the main arcade: one springing line for every bay (the widest bay's arch), its crown a band under its top
    const yS = two ? F + H * .6 : yB, crown = yS - (two ? .32 : band);
    const h1 = Math.max(sMax * 1.02, Math.min(sMax * (cl ? 1.6 : 1.5), (crown - F) * .62));
    const y0 = Math.max(F + .9, crown - h1);
    for (const [u, v] of piers) cl ? clusterPier(u, v, y0) : squarePier(u, v, C.PIER, y0);
    // a bay an ENGAGED stair turret stands in is WALLED UP (the turret bonds into masonry: nothing of it
    // shows through an open arch): a coursed wall on a plinth course, floor to deck, both storeys
    const shutF = shut && (shut.side[1] === 'v' ? 'u' : 'v'), shutS = shut && (shut.side[0] === '+' ? 1 : -1);
    const isShut = (f, i) => !!shut && f.along === shutF && Math.sign(f.at) === shutS && f.pts[i] < shut.a1 + .05 && f.pts[i + 1] > shut.a0 - .05;
    for (const f of faces) for (let i = 0; i + 1 < f.pts.length; i++){
      if (!isShut(f, i)){ archBay(f, f.pts[i], f.pts[i + 1], ph, ph, y0, crown, t, wd, yS); continue; }
      faceBox(f, STONE, f.pts[i], f.pts[i + 1], F - .04, F + .3, -wd / 2 - .06, wd / 2 + .06, FL(f, { top: 1 }));
      faceBox(f, STONE, f.pts[i], f.pts[i + 1], F + .3, yB, -wd / 2, wd / 2, FL(f));
    }
    for (const [u, v] of [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]]) k.box(STONE, u - wd / 2, u + wd / 2, y0, yB, v - wd / 2, v + wd / 2, SIDES);
    if (!two) return;
    // the gallery: a sill course round every face, the piers carried up as shafts, paired arches between
    const yG = yS + .34, pc = .13, crown2 = yB - band;
    let s2 = 0;
    for (const f of faces) for (let i = 0; i + 1 < f.pts.length; i++) s2 = Math.max(s2, ((f.pts[i + 1] - f.pts[i]) / 2 - ph - pc) / 2);
    const h2 = Math.max(s2 * 1.02, Math.min(s2 * 1.7, (crown2 - yG) * .55)), y2 = Math.max(yG + .5, crown2 - h2);
    for (const f of faces){
      faceBox(f, STONE, f.pts[0] - .02, f.pts[f.pts.length - 1] + .02, yS, yG, -wd / 2 - .07, wd / 2 + .07, ALL);          // the sill course
      for (let i = 0; i < f.pts.length; i++){
        const x = f.pts[i];
        faceBox(f, STONE, x - .34, x + .34, yG, y2 - .16, -wd / 2 - .04, wd / 2 + .04, SIDES);                         // the pier's shaft, carried up
        faceBox(f, STONE, x - .42, x + .42, y2 - .16, y2, -wd / 2 - .08, wd / 2 + .08, ALL);                           // its capital
      }
      for (let i = 0; i + 1 < f.pts.length; i++){
        const xa = f.pts[i], xb = f.pts[i + 1], m = (xa + xb) / 2;
        if (isShut(f, i)) continue;                                                                                  // (walled up)
        if ((m - xa - ph - pc) / 2 < .3){ archBay(f, xa, xb, ph, ph, y2, crown2, t * .8, wd, yB); continue; }
        faceBox(f, STONE, m - pc, m + pc, yG, y2 - .12, -wd / 2 + .06, wd / 2 - .06, SIDES);                            // the colonnette
        faceBox(f, STONE, m - pc - .07, m + pc + .07, y2 - .12, y2, -wd / 2 + .02, wd / 2 - .02, ALL);
        archBay(f, xa, m, ph, pc, y2, crown2, t * .75, wd, yB);
        archBay(f, m, xb, pc, ph, y2, crown2, t * .75, wd, yB);
      }
    }
  }

  /* ---- balustrades ---- */
  /* the parapet's runs round a deck (its line set back PARA_IN), minus the access gap: [a, b] pairs in [u, v] */
  function parapetRuns(r, gap){
    const hu = r.hw - C.PARA_IN, hv = r.hd - C.PARA_IN, [gs, g0, g1] = gap, out = [];
    const runs = [['-v', [-hu, -hv], [hu, -hv]], ['+u', [hu, -hv], [hu, hv]], ['+v', [hu, hv], [-hu, hv]], ['-u', [-hu, hv], [-hu, -hv]]];
    for (const [side, p, q] of runs){
      if (side !== gs){ out.push([p, q]); continue; }
      const al = pt => side[1] === 'u' ? pt[1] : pt[0], at = (x) => side[1] === 'u' ? [p[0], x] : [x, p[1]];
      const lo = Math.min(al(p), al(q)), hi = Math.max(al(p), al(q));
      if (g0 - .05 > lo + .3) out.push([at(lo), at(g0 - .05)]);
      if (g1 + .05 < hi - .3) out.push([at(g1 + .05), at(hi)]);
    }
    return { hu, hv, runs: out };
  }
  /* a pierced STONE balustrade round a deck at T: a base course, a coping, mullions with pointed heads
     between them; a newel at every corner */
  function balustrade(r, T, gap){
    const { hu, hv, runs } = parapetRuns(r, gap), top = T + RAIL_H;
    for (const [a, b] of runs){
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < .2) continue;
      const P = (t, y) => [a[0] + (b[0] - a[0]) * t, y, a[1] + (b[1] - a[1]) * t];
      k.bar(STONE, P(0, T + .09), P(1, T + .09), .26, .18, ALL);                    // the base course
      k.bar(STONE, P(0, top - .075), P(1, top - .075), .3, .15, ALL);               // the coping
      const n = Math.max(1, Math.round(L / C.MULLION)), yS = top - .15;
      for (let i = 0; i <= n; i++){ const [u, , v] = P(i / n, 0); k.box(STONE, u - .06, u + .06, T + .18, yS, v - .06, v + .06, SIDES); }
      const s = L / n / 2 - .06, h = Math.min(s * 1.6, .45), { R, xc } = pointed(s, Math.max(h, s));
      if (s > .06) for (let i = 0; i < n; i++){
        const tm = (i + .5) / n, ys = yS - Math.max(h, s);
        for (const hs of [-1, 1]){
          let prev = null;
          for (let j = 0; j <= 2; j++){
            const th = Math.PI + (Math.acos(-xc / R) - Math.PI) * j / 2, x = xc + R * Math.cos(th), y = ys + R * Math.sin(th);
            const q = P(tm + (hs < 0 ? x : -x) / L, y);
            if (prev) k.bar(STONE, prev, q, .1, .05, SIDES);
            prev = q;
          }
        }
      }
    }
    for (const [u, v] of [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]]) k.box(STONE, u - .17, u + .17, T, top + .0, v - .17, v + .17, NOBOT);
  }
  /* the carved OAK gallery front of a loft at T: posts every ~OAK_BAY, a moulded top rail (brass-capped),
     a bottom rail, a blind panel below a transom, three pointed lights above it in every bay */
  function gallery(r, T, gap){
    const { hu, hv, runs } = parapetRuns(r, gap), top = T + RAIL_H;
    for (const [a, b] of runs){
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < .2) continue;
      const P = (t, y) => [a[0] + (b[0] - a[0]) * t, y, a[1] + (b[1] - a[1]) * t];
      k.bar(OAK, P(0, T + .08), P(1, T + .08), .2, .16, ALL);                      // the bottom rail
      k.bar(OAK, P(0, T + .5), P(1, T + .5), .16, .1, ALL);                        // the transom
      k.bar(OAK, P(0, T + .3), P(1, T + .3), .05, .36, SIDES);                     // the blind panel
      k.bar(OAK, P(0, top - .1), P(1, top - .1), .26, .14, ALL);                   // the top rail
      k.bar(BRASS, P(0, top - .015), P(1, top - .015), .1, .03, ALL);              // its brass cap
      const n = Math.max(1, Math.round(L / C.OAK_BAY)), yS = top - .17;
      for (let i = 0; i <= n; i++){ const [u, , v] = P(i / n, 0); k.box(OAK, u - .07, u + .07, T + .16, top - .17, v - .07, v + .07, SIDES); }
      const lights = 3, lw = L / n / lights;
      for (let i = 0; i < n; i++) for (let j = 0; j < lights; j++){
        const t0 = (i + j / lights) / n, tm = t0 + .5 / lights / n;
        if (j){ const [u, , v] = P(t0, 0); k.box(OAK, u - .025, u + .025, T + .55, yS, v - .025, v + .025, SIDES); }   // the mullions
        const s = lw / 2 - .03, h = Math.min(s * 1.7, .4); if (s < .05) continue;
        const { R, xc } = pointed(s, Math.max(h, s)), ys = yS - Math.max(h, s);
        for (const hs of [-1, 1]){
          let prev = null;
          for (let q = 0; q <= 2; q++){
            const th = Math.PI + (Math.acos(-xc / R) - Math.PI) * q / 2, x = xc + R * Math.cos(th), y = ys + R * Math.sin(th);
            const pt = P(tm + (hs < 0 ? x : -x) / L, y);
            if (prev) k.bar(OAK, prev, pt, .05, .035, SIDES);
            prev = pt;
          }
        }
      }
    }
    for (const [u, v] of [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]]){
      k.box(OAK, u - .12, u + .12, T, top, v - .12, v + .12, NOBOT & ~PY);
      k.box(BRASS, u - .14, u + .14, top - .03, top, v - .14, v + .14, NOBOT);  // (a brass cap on the newel)
    }
  }

  /* ---- access, in this room's idiom ---- */
  /* an access's turret, if it is one: its 12-gon's radii (a = along the side, o = out from it) */
  const TUR = { N: 12, MO: .06 };
  function turretDims(acc, engaged){
    const span = acc.a1 - acc.a0, cN = Math.cos(Math.PI / TUR.N), lim = engaged ? Math.min(span / 2, acc.out) - TUR.MO : 0;
    return { cN, ra: (engaged ? lim : span / 2 - TUR.MO) / cN, ro: (engaged ? lim : acc.out / 2 - TUR.MO) / cN, oc: engaged ? 0 : acc.out / 2 };
  }
  const isTurret = (r, T, acc) => !!acc && acc.kind !== 'stair' && T - F > C.TURRET_MIN;
  /* the along-range an ENGAGED turret takes on its side (its arcade bay is walled up), or null */
  function turretShut(r, T, acc){
    if (!isTurret(r, T, acc) || r.open) return null;
    const am = (acc.a0 + acc.a1) / 2, { ra } = turretDims(acc, true);
    return { side: acc.side, a0: am - ra, a1: am + ra };
  }
  /* wallO: how far under the deck the arcade wall's OUTER face stands (an engaged turret drops the faces
     that would stand behind it) */
  function access(r, T, acc, low, wallO = Infinity){
    if (!acc) return gapOf(acc);
    if (acc.kind === 'stair'){ low ? chancelStair(r, T, acc) : stoneStair(r, T, acc); return gapOf(acc); }
    if (isTurret(r, T, acc)) return turret(r, T, acc, !r.open, wallO);
    oakLadder(r, T, acc); return gapOf(acc);
  }
  /* a solid stone flight hugging one side (footing.js access): its blocks from the floor, a brass nosing
     set into every tread, the landing at the deck's level */
  function steps(r, T, acc){
    const S = onSide(r, acc.side), ow = acc.out, n = acc.n, rise = acc.rise, tr = acc.tread, aL = acc.a1 - ow;
    const B = (slot, a0, a1, o0, o1, y0, y1, faces = ALL) => { const p = S(a0, o0), q = S(a1, o1);
      k.box(slot, Math.min(p[0], q[0]), Math.max(p[0], q[0]), y0, y1, Math.min(p[1], q[1]), Math.max(p[1], q[1]), faces); };
    for (let i = 1; i < n; i++){
      const a0 = acc.a0 + (i - 1) * tr, y = F + i * rise;
      B(STONE, a0, a0 + tr + .02, .02, ow, F - .04, y, NOBOT);
      B(BRASS, a0 + .015, a0 + .07, .12, ow - .1, y - .004, y + .008, PY | PX | NX | PZ | NZ);
    }
    B(STONE, aL, acc.a1, .02, ow, F - .04, T, NOBOT);
    return { S, aL };
  }
  /* the CHANCEL steps (a low dais): stone steps + a brass ALTAR RAIL along the open side (balusters on
     every tread, the rail up the flight, along the landing and back to the dais) */
  function chancelStair(r, T, acc){
    const { S, aL } = steps(r, T, acc), ow = acc.out, rise = acc.rise, o = ow - .09;
    const W2 = (a, oo, y) => { const [u, v] = S(a, oo); return [u, y, v]; };
    const aB = acc.a0 + .12, yR = a => a <= aB ? F + rise + C.HAND : a >= aL ? T + C.HAND : F + rise + C.HAND + (T - F - rise) * (a - aB) / (aL - aB);
    k.bar(BRASS, W2(aB, o, yR(aB)), W2(aL, o, T + C.HAND), .06, .06, ALL);
    k.bar(BRASS, W2(aL, o, T + C.HAND), W2(acc.a1 - .05, o, T + C.HAND), .06, .06, ALL);
    k.bar(BRASS, W2(acc.a1 - .05, o, T + C.HAND), W2(acc.a1 - .05, .08, T + C.HAND), .06, .06, ALL);
    for (let i = 1; i < acc.n; i++){
      const a = acc.a0 + (i - .5) * acc.tread, y = F + i * rise;
      if (a > aL) break;
      k.bar(BRASS, W2(a, o, y), W2(a, o, yR(a)), .035, .035, SIDES);
    }
    for (let a = aL + .3; a < acc.a1 - .2; a += .4) k.bar(BRASS, W2(a, o, T), W2(a, o, T + C.HAND), .035, .035, SIDES);
    for (const [a, y] of [[aB, F + rise], [aL, T], [acc.a1 - .05, T]]){
      k.bar(BRASS, W2(a, o, y), W2(a, o, y + C.HAND + .04), .07, .07, PY | SIDES);                       // newels
      k.box(BRASS, ...(() => { const [u, , v] = W2(a, o, 0); return [u - .055, u + .055, y + C.HAND + .02, y + C.HAND + .11, v - .055, v + .055]; })(), ALL);   // a knop
    }
    // the rail's glint: its level run catches the machine's light (a pad's — a loft has no one machine)
    if (r.pulse == null) return;
    const [p0u, , p0v] = W2(aL, o, 0), [p1u, , p1v] = W2(acc.a1 - .05, o, 0);
    k.edge(Math.min(p0u, p1u) - .012, Math.max(p0u, p1u) + .012, T + C.HAND + .03, T + C.HAND + .042, Math.min(p0v, p1v) - .012, Math.max(p0v, p1v) + .012, r.color, r.pulse);
  }
  /* a tribune's stone stair: the same solid flight, a sloped stone parapet along the open side, level
     along the landing */
  function stoneStair(r, T, acc){
    const { S, aL } = steps(r, T, acc), ow = acc.out, rise = acc.rise, o = ow - .12;
    const W2 = (a, oo, y) => { const [u, v] = S(a, oo); return [u, y, v]; };
    const aB = acc.a0 + .3, slope = Math.atan2(T - F - rise, aL - aB), up = .62;
    k.bar(STONE, W2(aB, o, F + rise + up), W2(aL, o, T + up), .2, 1.05 * Math.cos(slope) + .1, ALL);
    k.bar(STONE, W2(aL, o, T + .62), W2(acc.a1 - .1, o, T + .62), .2, 1.2, ALL);
    k.bar(STONE, W2(acc.a1 - .1, o, T + .62), W2(acc.a1 - .1, .1, T + .62), .2, 1.2, ALL);
    k.box(STONE, ...(() => { const [u, , v] = W2(aB, ow - .2, 0); return [u - .17, u + .17, F - .04, F + rise + 1.3, v - .17, v + .17]; })(), NOBOT);   // the bottom newel
  }
  /* a short climb: an OAK ladder on iron brackets */
  function oakLadder(r, T, acc){
    const S = onSide(r, acc.side), W2 = (a, o, y) => { const [u, v] = S(a, o); return [u, y, v]; };
    const ac = (acc.a0 + acc.a1) / 2, O = .36, hh = .31;
    for (const s of [-hh, hh]) k.bar(OAK, W2(ac + s, O, F), W2(ac + s, O, T + 1.1), .1, .07, ALL);
    for (let y = F + .45; y < T - .05; y += .45) k.bar(OAK, W2(ac - hh, O, y), W2(ac + hh, O, y), .055, .055);
    for (const y of [T - .25, ...(T - F > 3 ? [F + (T - F) * .45] : [])]) for (const s of [-hh, hh]) k.bar(IRON, W2(ac + s, O, y), W2(ac + s, -.02, y), .05, .05);
  }
  /* a SPIRAL-STAIR TURRET on the access side. ENGAGED (a deck): a 12-gon centred on the deck's edge — its
     inner half under the deck (only air and the arcade are there), its outer half filling the access
     rect — ending at the deck in a round crenellated BAY the stair arrives in (nothing of it rises over
     the machine's footprint). FREE-STANDING (an open stand: no deck, and things hang under it): an oval
     in the access rect under a pointed cap. Ashlar walls on a base course, slit windows climbing a helix
     round its outer faces, lit from within. Returns where the deck's balustrade opens: [side, a0, a1] */
  function turret(r, T, acc, engaged, wallO = Infinity){
    const S = onSide(r, acc.side), am = (acc.a0 + acc.a1) / 2, N = TUR.N, { cN, ra, ro, oc } = turretDims(acc, engaged);
    const V = Array.from({ length: N }, (_, i) => { const f = 2 * Math.PI * (i + .5) / N; return [am + ra * Math.cos(f), oc + ro * Math.sin(f)]; });
    const W3 = (q, y) => { const [u, v] = S(q[0], q[1]); return [u, y, v]; };
    const wt = .14, sh = .06, sl = .64, yTop = T;
    const E = V.map((p, i) => { const q = V[(i + 1) % N], L = Math.hypot(q[0] - p[0], q[1] - p[1]), t = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
      return { p, q, L, t, n: [t[1], -t[0]], m: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] }; });
    const shift = (q, n, d) => [q[0] - n[0] * d, q[1] - n[1] * d];
    const along = (e, x, d) => [e.m[0] + e.t[0] * x - e.n[0] * d, e.m[1] + e.t[1] * x - e.n[1] * d];   // x along the face from its middle, d in from it
    // its DOOR: a pointed oak door at the foot of the face that looks out (where a climber walks up)
    let iD = 0; for (let i = 1; i < N; i++) if (E[i].m[1] > E[iD].m[1]) iD = i;
    const Dt = F + 2.5, door = yTop - Dt > 1;
    // the slits: up a helix, only in the faces that look out (the stair winds behind them)
    const outer = i => engaged ? E[i].n[1] > .45 : E[i].n[1] > -.3;
    const slit = new Map();
    for (let j = 0, y = F + 1.3; y + sl < yTop - .45; j++, y += .95){
      const ang = Math.PI / 2 + 2.2 * Math.sin(j * .9), i = ((Math.round(ang / (2 * Math.PI / N)) - 1) % N + N) % N;
      if (outer(i) && !(door && i === iD && y < Dt + .45)) (slit.get(i) || slit.set(i, []).get(i)).push([y, y + sl]);
    }
    for (let i = 0; i < N; i++){
      const e = E[i], cuts = slit.get(i) || [], hl = e.L / 2;
      if (engaged && Math.max(e.p[1], e.q[1]) < -wallO) continue;              // (behind the walled-up bay: never seen)
      let y = F - .04;
      const wall = (y0, y1) => { if (y1 > y0 + .005) k.bar(STONE, W3(along(e, -hl, wt / 2), (y0 + y1) / 2), W3(along(e, hl, wt / 2), (y0 + y1) / 2), wt, y1 - y0, SIDES); };
      if (door && i === iD){
        const dw = Math.max(.12, Math.min(.27, hl - .07)), ym = (F - .04 + Dt) / 2;
        for (const sg of [-1, 1]) k.bar(STONE, W3(along(e, sg * hl, wt / 2), ym), W3(along(e, sg * dw, wt / 2), ym), wt, Dt - F + .04, ALL);   // the jambs
        k.bar(OAK, W3(along(e, -dw, wt * .75), (F + .34 + Dt) / 2), W3(along(e, dw, wt * .75), (F + .34 + Dt) / 2), .05, Dt - F - .34, ALL);   // the door, set back
        for (const sg of [-1, 1]) k.bar(STONE, W3(along(e, sg * (dw + .03), .02), Dt - .12), W3(along(e, 0, .02), Dt + .26), .1, .1, ALL);   // its pointed hood
        k.bar(BRASS, W3(along(e, -dw * .7, wt * .7), F + 1.75), W3(along(e, dw * .7, wt * .7), F + 1.75), .03, .05, ALL);   // a brass strap (no iron slot for one strap)
        y = Dt;
      }
      for (const [s0, s1] of cuts){
        wall(y, s0);
        for (const sg of [-1, 1]) k.bar(STONE, W3(along(e, sg * hl, wt / 2), (s0 + s1) / 2), W3(along(e, sg * sh, wt / 2), (s0 + s1) / 2), wt, s1 - s0, ALL);
        k.bar(GLOW, W3(along(e, -sh, wt * .6), (s0 + s1) / 2), W3(along(e, sh, wt * .6), (s0 + s1) / 2), .03, s1 - s0, ALL);
        y = s1;
      }
      wall(y, yTop);
      // the base course, and (engaged) the deck's cornice carried round its outer faces
      k.bar(STONE, W3(along(e, -hl - .016, wt / 2 - sh / 2), F + .15), W3(along(e, hl + .016, wt / 2 - sh / 2), F + .15), wt + sh, .38, ALL);
      if (engaged && e.m[1] > 0) k.bar(STONE, W3(along(e, -hl - .014, wt / 2 - .025), T - .09), W3(along(e, hl + .014, wt / 2 - .025), T - .09), wt + .05, .18, ALL);
    }
    if (engaged){
      // the bay's floor (level with the deck), and its parapet round the outer faces: a solid breast,
      // a coping, a merlon on every other face; the side faces from the balustrade's line out
      const rIn = ro * cN - wt + .02, oP = -C.PARA_IN;
      for (let o0 = 0; o0 < rIn - .01; o0 += .3){
        const o1 = Math.min(rIn, o0 + .3), w = (ra / ro) * Math.sqrt(Math.max(0, rIn * rIn - o0 * o0)) + .02, p = S(am - w, o0), q = S(am + w, o1);
        k.box(STONE, Math.min(p[0], q[0]), Math.max(p[0], q[0]), T - .22, T, Math.min(p[1], q[1]), Math.max(p[1], q[1]), PY | NY);
      }
      let k2 = 0;
      for (const e of E){
        if (Math.max(e.p[1], e.q[1]) < oP + .01) continue;
        let p = e.p, q = e.q;
        const clip = (a, b) => { const t = (oP - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, oP]; };
        if (p[1] < oP) p = clip(p, q); if (q[1] < oP) q = clip(q, p);
        const pi = shift(p, e.n, .1), qi = shift(q, e.n, .1);
        k.bar(STONE, W3(pi, T + .5), W3(qi, T + .5), .2, 1, ALL);
        k.bar(STONE, W3(shift(p, e.n, .1), T + 1.06), W3(shift(q, e.n, .1), T + 1.06), .26, .12, ALL);
        if (e.m[1] > .3 && (k2++ % 2 === 0)){
          const L = Math.hypot(qi[0] - pi[0], qi[1] - pi[1]), g = Math.min(.08, L * .15), t = [(qi[0] - pi[0]) / L, (qi[1] - pi[1]) / L];
          k.bar(STONE, W3([pi[0] + t[0] * g, pi[1] + t[1] * g], T + 1.29), W3([qi[0] - t[0] * g, qi[1] - t[1] * g], T + 1.29), .2, .34, ALL);
        }
      }
      return [acc.side, am - ra * cN + .15, am + ra * cN - .15];
    }
    // FREE-STANDING (beside an open stand): it ends where the climb arrives — a floor at the deck's level,
    // a crenellated parapet round every face but the ones toward the machine, and a stone BRIDGE across to
    // it (kept out of what hangs under the deck): the climb visibly lands on the stand
    const rIn = ro * cN - wt + .02, rIa = ra * cN - wt + .02;
    for (let o0 = oc - rIn; o0 < oc + rIn - .01; o0 += .3){
      const o1 = Math.min(oc + rIn, o0 + .3), om = Math.abs((o0 + o1) / 2 - oc), w = rIa * Math.sqrt(Math.max(0, 1 - (om / rIn) ** 2)) + .02, p = S(am - w, o0), q = S(am + w, o1);
      k.box(STONE, Math.min(p[0], q[0]), Math.max(p[0], q[0]), T - .22, T, Math.min(p[1], q[1]), Math.max(p[1], q[1]), PY | NY);
    }
    let k2 = 0;
    for (const e of E){
      if (e.n[1] < -.45) continue;                                             // (open toward the machine)
      const pi = shift(e.p, e.n, .1), qi = shift(e.q, e.n, .1);
      k.bar(STONE, W3(pi, T + .5), W3(qi, T + .5), .2, 1, ALL);
      k.bar(STONE, W3(pi, T + 1.06), W3(qi, T + 1.06), .2, .12, ALL);
      if (e.m[1] > oc + .2 && (k2++ % 2 === 0)){
        const L = Math.hypot(qi[0] - pi[0], qi[1] - pi[1]), g = Math.min(.08, L * .15), t = [(qi[0] - pi[0]) / L, (qi[1] - pi[1]) / L];
        k.bar(STONE, W3([pi[0] + t[0] * g, pi[1] + t[1] * g], T + 1.27), W3([qi[0] - t[0] * g, qi[1] - t[1] * g], T + 1.27), .16, .3, ALL);
      }
    }
    // the bridge: from the turret's inner face across to the stand, as far in as it may go
    const oIn = oc - ro * cN + .05, bw = Math.min(.45, ra * cN * .6);
    let reach = 0;
    for (const o of [-.9, -.6, -.3, 0]){
      const p = S(am - bw, o), q = S(am + bw, oIn), R0 = [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1])];
      if (!r.hang || R0[1] < r.hang[0] - .05 || R0[0] > r.hang[1] + .05 || R0[3] < r.hang[2] - .05 || R0[2] > r.hang[3] + .05){ reach = o; break; }
    }
    { const p = S(am - bw, reach), q = S(am + bw, oIn);
      k.box(STONE, Math.min(p[0], q[0]), Math.max(p[0], q[0]), T - .24, T, Math.min(p[1], q[1]), Math.max(p[1], q[1]), ALL);
      if (oIn > .15) for (const sg of [-1, 1]){ const a = W3([am + sg * (bw - .04), .05], T + .45), b = W3([am + sg * (bw - .04), oIn], T + .45);   // its low parapets (over the
        k.bar(STONE, a, b, .08, .9, ALL); } }                                                                                         //  access rect only: the stand's own envelope ends at its deck)
    return gapOf(acc);
  }
  return {
    inlay, inset, plinthBlock, blindArcade, stoneDeck, arcade, balustrade, gallery, turret, oakLadder, chancelStair, stoneStair, access,
    flush(p){
      if (p.fixed){                                                         // the belt's kerb: its posts stand in it
        const T = F + FOOT.KERB;
        k.box(STONE, -p.hw, p.hw, F - .04, T, -p.hd, p.hd, NOBOT);
        inset(-p.hw + .22, p.hw - .22, -p.hd + .22, p.hd - .22, T, p, .05);
        return;
      }
      plinthBlock(p, p.top, p, { back: .07, base: .1, cap: .16 });
    },
    low(p){
      const back = plinthBlock(p, p.top, p, { back: .12, base: .2, cap: .24 });
      if (p.top - F > 1.05) blindArcade(p, F + .2, p.top - .26, back);
      access(p, p.top, p.access, true);
    },
    mid(p){
      const D = stoneDeck(p, p.top, p);
      arcade(p, p.top - D, 'square', turretShut(p, p.top, p.access));
      balustrade(p, p.top, access(p, p.top, p.access, false, WALL_O.square));
    },
    high(p){
      const D = stoneDeck(p, p.top, p);
      arcade(p, p.top - D, 'cluster', turretShut(p, p.top, p.access));
      balustrade(p, p.top, access(p, p.top, p.access, false, WALL_O.cluster));
    },
    loft(L, members){
      const T = L.top;
      if (L.band === 'low'){
        const back = plinthBlock(L, T, null, { back: .12, base: .2, cap: .24 });
        if (T - F > 1.05) blindArcade(L, F + .2, T - .26, back);
        memberBands(L, members, T - .24 - .03 - C.INLAY, T - .24 - .03, back);
      } else {
        const D = stoneDeck(L, T, null), yB = T - D, kind = L.band === 'high' ? 'cluster' : 'square';
        arcade(L, yB, kind, turretShut(L, T, L.access));
        memberBands(L, members, yB + (D - Math.min(C.CORNICE, D * .4)) * .55 - C.INLAY / 2, yB + (D - Math.min(C.CORNICE, D * .4)) * .55 + C.INLAY / 2, .06);
        gallery(L, T, access(L, T, L.access, false, WALL_O[kind]));
        return;
      }
      access(L, T, L.access, true);
    },
    /* an OPEN stand: a colonnette under every foot (slid off what hangs) — clustered, ringed every ≤ 6 u,
       when tall — and between neighbours clear of what hangs, an ARCADE: pointed arches (a long side
       gets colonnettes between, so its arches stay pointed), coursed spandrels and a cornice band
       under the deck. Where an arch can't stand (too low a stand, or what hangs is in the way) a single
       lintel at the top, only if it clears what hangs. A brass ring set in the floor round them (its light). */
    open(p){
      const T = p.top, H = T - F, tall = H > 6.5;
      const feet = p.feet?.length ? p.feet : [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [a * (p.hw - .6), b * (p.hd - .6), .3]);
      const cu = feet.reduce((s, f) => s + f[0], 0) / feet.length, cv = feet.reduce((s, f) => s + f[1], 0) / feet.length;
      const HG = p.hang, clip = (u, v, s, rr) => {
        if (!HG) return [u, v];
        const x0 = HG[0] - .05, x1 = HG[1] + .05, z0 = HG[2] - .05, z1 = HG[3] + .05;
        if (u + s <= x0 || u - s >= x1 || v + s <= z0 || v - s >= z1) return [u, v];
        const [du, dv] = [[x0 - u - s, 0], [x1 - u + s, 0], [0, z0 - v - s], [0, z1 - v + s]].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0];
        return Math.abs(du + dv) <= rr ? [u + du, v + dv] : null;
      };
      const rings = tall ? Array.from({ length: Math.ceil((H - .8) / 6) - 1 }, (_, i) => F + .3 + (H - .8) * (i + 1) / Math.ceil((H - .8) / 6)) : [];
      const colonnette = (u, v, s) => {
        k.box(STONE, u - s - .12, u + s + .12, F - .04, F + .22, v - s - .12, v + s + .12, NOBOT);     // the base
        if (tall){                                                                                      // a core + four shafts
          const c = s * .62, sh = s * .38;
          k.box(STONE, u - c, u + c, F + .22, T - .28, v - c, v + c, SIDES);
          for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) k.box(STONE, u + a * c - sh, u + a * c + sh, F + .22, T - .28, v + b * c - sh, v + b * c + sh, SIDES);
          for (const y of rings) k.box(STONE, u - s - .06, u + s + .06, y - .1, y + .1, v - s - .06, v + s + .06, ALL);   // shaft rings
        } else k.box(STONE, u - s, u + s, F + .22, T - .28, v - s, v + s, SIDES);                       // the shaft
        k.box(STONE, u - s - .06, u + s + .06, T - .28, T - .14, v - s - .06, v + s + .06, ALL);        // the capital
        k.box(STONE, u - s - .12, u + s + .12, T - .14, T, v - s - .12, v + s + .12, ALL);              // the abacus (the foot rests on it)
      };
      const hull = [];
      for (const [fu, fv, rr = .3] of feet.slice().sort((f, g) => Math.atan2(f[1] - cv, f[0] - cu) - Math.atan2(g[1] - cv, g[0] - cu))){
        const s = Math.max(.2, Math.min(tall ? .4 : .34, rr * (tall ? .6 : .5))), at = clip(fu, fv, s + .12, rr);
        if (!at) continue;
        const [u, v] = at; hull.push([u, v, s]);
        colonnette(u, v, s);
      }
      const yTop = T - .16, crown = yTop - .2, avail = crown - (F + 1.1), ring = tall ? .24 : .2, wd = .3;
      if (hull.length > 1) for (let i = 0; i < hull.length; i++){
        const a = hull[i], b = hull[(i + 1) % hull.length];
        if (hull.length === 2 && i) break;
        const lintel = () => { if (!segHits(a, b, p.hang, .15) || !(T - .46 > (p.hangY ?? -Infinity) + .1)) k.bar(STONE, [a[0], T - .3, a[1]], [b[0], T - .3, b[1]], .26, .32, ALL); };
        if (segHits(a, b, p.hang, .2)){ if (!segHits(a, b, p.hang, .15)) lintel(); continue; }
        // the fewest bays whose pointed arches fit under the deck, every colonnette between clear of what hangs
        const f = segFace(a, b), sm = Math.min(a[2], b[2]);
        let bays = null;
        for (let n = 1; n <= 4 && !bays; n++){
          const xs = Array.from({ length: n + 1 }, (_, q) => f.L * q / n), hs = xs.map((_, q) => q === 0 ? a[2] : q === n ? b[2] : sm);
          const sMax = Math.max(...xs.slice(1).map((x, q) => (x - xs[q] - hs[q] - hs[q + 1]) / 2));
          if (sMax < .3 || sMax * 1.02 > avail) continue;
          if (xs.slice(1, -1).some(x => { const [u, , v] = facePt(f, x, 0); const c = clip(u, v, sm + .12, 0); return !c || c[0] !== u || c[1] !== v; })) continue;
          bays = { xs, hs };
        }
        if (!bays){ lintel(); continue; }
        const { xs, hs } = bays;
        for (let q = 1; q < xs.length - 1; q++){ const [u, , v] = facePt(f, xs[q], 0); colonnette(u, v, hs[q]); }
        for (let q = 0; q + 1 < xs.length; q++){
          const s = (xs[q + 1] - xs[q] - hs[q] - hs[q + 1] - .12) / 2, h = Math.max(s * 1.02, Math.min(s * 1.6, avail));
          archBay(f, xs[q], xs[q + 1], hs[q] + .06, hs[q + 1] + .06, crown - h, crown, ring, wd, yTop);
        }
        k.bar(STONE, [a[0], T - .08, a[1]], [b[0], T - .08, b[1]], wd + .08, .16, ALL);                  // the cornice band under the deck
      }
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const [u, v] of feet){ u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      inset(Math.max(-p.hw, u0 - .75), Math.min(p.hw, u1 + .75), Math.max(-p.hd, v0 - .75), Math.min(p.hd, v1 + .75), F, p, .07);
      access(p, T, p.access, false);
    },
  };

  /* each loft member's light: its stretch of the deck's fascia (front + back), and an end where it reaches one */
  function memberBands(L, members, y0, y1, back){
    const o = .018;
    for (const m of members){
      let mu0 = Infinity, mu1 = -Infinity;
      const c = Math.cos(m.yaw || 0), s = Math.sin(m.yaw || 0);
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]){ const x = m.x + c * a * m.hw + s * b * m.hd - L.x; mu0 = Math.min(mu0, x); mu1 = Math.max(mu1, x); }
      mu0 = Math.max(-L.hw + back, mu0); mu1 = Math.min(L.hw - back, mu1);
      if (!(mu1 > mu0)) continue;
      k.edge(mu0, mu1, y0, y1, L.hd - back - .01, L.hd - back + o, m.color, m.pulse, PY | PZ);
      k.edge(mu0, mu1, y0, y1, -L.hd + back - o, -L.hd + back + .01, m.color, m.pulse, PY | NZ);
      if (mu0 <= -L.hw + back + .01) k.edge(-L.hw + back - o, -L.hw + back + .01, y0, y1, -L.hd + back, L.hd - back, m.color, m.pulse, PY | NX);
      if (mu1 >= L.hw - back - .01) k.edge(L.hw - back - .01, L.hw - back + o, y0, y1, -L.hd + back, L.hd - back, m.color, m.pulse, PY | PX);
    }
  }
}


/** the Cathedral's footing style (rooms/footing3d.js): its materials are made once, on first use, and
    are the room's to dispose (style.dispose()) */
export function cathedralFooting(){
  let made = null, tex = [];
  const DRAWN = true;                                   // (a hook that drew its parts INTO the kit's merged slots: handled, nothing to add)
  const forms = new WeakMap(), of = k => forms.get(k) || forms.set(k, makeForms(k)).get(k);
  const hook = name => (spec, k) => {
    const f = of(k);
    if (name !== 'loft' && spec.open) f.open(spec);
    else if (name === 'loft') f.loft(spec, k.plan.pads.filter(p => p.loft === spec.id));
    else f[name](spec);
    return DRAWN;
  };
  return {
    key: 'cathedral',
    mats(kit, ctx = {}){
      if (made) return made;
      const env = ctx.envMap ?? null;
      tex = [ashlarTex(), oakTex()];
      made = {
        // pale warm limestone (its colour is in the map: ≈ .55 albedo — it must not go black in a dim room)
        base: new THREE.MeshStandardMaterial({ map: tex[0], roughness: .86, metalness: 0, envMap: env, envMapIntensity: .3 }),
        // dark oak, a waxed sheen
        deck: new THREE.MeshStandardMaterial({ map: tex[1], roughness: .55, metalness: 0, envMap: env, envMapIntensity: .55 }),
        // wrought iron (brackets; any kit form that falls back)
        steel: new THREE.MeshStandardMaterial({ color: 0x5f5850, metalness: .5, roughness: .55, envMap: env, envMapIntensity: .6 }),
        brass: new THREE.MeshStandardMaterial({ color: 0xd9aa5e, metalness: .55, roughness: .3, envMap: env, envMapIntensity: 1.2 }),
        glow: new THREE.MeshBasicMaterial({ color: 0xffa04a, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
        edge: brassEdgeMat(),
      };
      return made;
    },
    edge: () => DRAWN,                                                     // (every pad's light is drawn by its form)
    flush: hook('flush'), low: hook('low'), mid: hook('mid'), high: hook('high'), loft: hook('loft'),
    dispose(){
      if (made) for (const m of Object.values(made)) m.dispose();
      for (const t of tex) t?.dispose();
      made = null; tex = [];
    },
  };
}
