import * as THREE from 'three';
/* ============================================================
   MIDNIGHT STUDIO — the ATLAS: every painted surface of the studio's footing and props in ONE
   texture (so all of it is one draw): worn Persian rugs (the borders, corners and fringe that show
   round a riser), charcoal riser carpet, catwalk grating, flight-case laminate + aluminium valance + ball
   corners + butterfly latches + handles, orange ratchet-strap webbing, spray-stencilled case labels
   and every machine's NAME. A parallel ORM map (G roughness, B metalness) makes the aluminium shine
   and the wool stay matte under the same material.
   Painted once per page (lazily, by the studio's build()); deterministic (seeded) so every load is
   the same room. Without a DOM (unit tests) the textures are null and only the LAYOUT exists.
   ============================================================ */

const SW = 2048, SH = 1024;                              // the atlas (px): 2048 × 1024 — every region at its old
                                                         //  resolution, repacked (the square's top quarter stood empty:
                                                         //  half the GPU memory, half the upload)
/* regions: [x, y, w, h] in canvas px (y down) */
export const LAYOUT = {
  // (the rug's field + medallion lie under its riser — never seen, never painted)
  borderA: [0, 0, 512, 128], borderB: [512, 0, 512, 128],
  cornerA: [1024, 0, 128, 128], cornerB: [1152, 0, 128, 128],
  fringe: [1280, 0, 512, 64], alu: [1280, 64, 512, 64],
  ball: [1792, 0, 64, 64], bindA: [1856, 0, 64, 64], bindB: [1920, 0, 64, 64], black: [1984, 0, 64, 64],
  latch: [1792, 64, 128, 64], handle: [1920, 64, 128, 64],
  carpet: [0, 128, 256, 256], grating: [256, 128, 256, 256], laminate: [512, 128, 256, 256],
  strap: [768, 128, 64, 256], cable: [832, 128, 64, 64], chrome: [832, 192, 64, 64], red: [832, 256, 64, 64],
  wood: [896, 128, 128, 256],
  stencils: [1024, 128, 1024, 512],                      // 2 × 8 cells of 512 × 64: case stencils
  names: [0, 384, 1024, 576],                            // 2 × 9 cells of 512 × 64: every machine's name
  skirt: [1024, 640, 512, 256],                          // pleated black stage skirting (a riser's sides)
};
export const ATLAS_SIZE = [SW, SH];
const NAME_COLS = 2, STENCIL_COLS = 2;
export const NAMES = {                                   // (pad key → its stencil; anything else: the house name)
  belt: 'GRAVITY ORCHESTRA', drums: 'DRUM MACHINE', marimba: 'MARIMBA', bells: 'TUBULAR BELLS', bass: 'STRING BASS',
  musicbox: 'MUSIC BOX', bowls: 'SINGING BOWLS', turntable: 'TURNTABLE', ricochet: 'RICOCHET', volley: 'VOLLEY',
  riff: 'RIFF FORGE', strum: 'AUTOHARP', pogo: 'POGO BASS', organ: 'LIGHT ORGAN', horns: 'BELLOWS HORNS',
  bowwheel: 'BOW WHEEL', dulcimer: 'MARBLE GRAND', house: 'GRAVITY ORCHESTRA',
};
export const STENCILS = ['GRAVITY ORCH.', 'STUDIO B', 'FRAGILE', 'BACKLINE', 'THIS SIDE UP', 'MIDNIGHT', 'CASE 07', 'HANDLE WITH CARE',
  'STAGE LEFT', 'AMP 2', 'CABLES', 'No. 14', 'TOUR 26', 'KEEP DRY', 'FX RACK', 'SPARES'];

/* a region → its uv rect { s0, s1, t0 (bottom), t1 (top) }, inset by `pad` px against mip bleed */
export function uvRect([x, y, w, h], pad = 1.5){
  return { s0: (x + pad) / SW, s1: (x + w - pad) / SW, t0: 1 - (y + h - pad) / SH, t1: 1 - (y + pad) / SH };
}
/* the uv rects of the layout + the name / stencil cells, each narrowed to its text's own width
   (aspect = text width / cell height, measured when painted; 6 without a DOM) */
function atlasUV(aspects = {}){
  const R = {};
  for (const [k, r] of Object.entries(LAYOUT)) R[k] = uvRect(r);
  const cell = (r, i, cols) => [r[0] + (i % cols) * 512, r[1] + Math.floor(i / cols) * 64, 512, 64];
  const text = (c, aspect) => { const w = Math.min(c[2], aspect * c[3]); return { ...uvRect([c[0] + (c[2] - w) / 2, c[1], w, c[3]], 1), aspect: w / c[3], px: c }; };
  R.name = {};
  Object.keys(NAMES).forEach((k, i) => { R.name[k] = text(cell(LAYOUT.names, i, NAME_COLS), aspects['n:' + k] || 6); });
  R.stencil = STENCILS.map((s, i) => text(cell(LAYOUT.stencils, i, STENCIL_COLS), aspects['s:' + i] || 6));
  return R;
}
export { atlasUV };

/* ---------------------------------------------------------------- painting */
function rng(seed){ let s = seed >>> 0; return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* every draw inside a region, clipped to it, with its own seeded random R; wrap: drawn again at ±w / ±h
   with the SAME seed (each copy identical) — a seamless tile */
function inRegion(x, [rx, ry, rw, rh], draw, wrap = false, seed = 1){
  x.save(); x.beginPath(); x.rect(rx, ry, rw, rh); x.clip(); x.translate(rx, ry);
  if (wrap){ for (const ox of [-rw, 0, rw]) for (const oy of [-rh, 0, rh]){ x.save(); x.translate(ox, oy); draw(rw, rh, rng(seed)); x.restore(); } }
  else draw(rw, rh, rng(seed));
  x.restore();
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/* a wool PILE: fine fibres (drawn once — a 1 px fibre needs no wrap) + slow wear blobs (wrapped:
   lighter abrasion, darker grime) — in a tile's own space */
function fibres(x, w, h, R, a = .08, n = w * h / 90){
  for (let i = 0; i < n; i++){ const v = R() < .5 ? 0 : 255; x.fillStyle = `rgba(${v},${v},${v},${a * (.3 + R())})`;
    x.fillRect(R() * w, R() * h, 1 + R() * 1.5, 1); }
}
function wear(x, w, h, R, { wear = .1, grime = .1, n = 14 } = {}){
  for (let i = 0; i < n; i++){ const cx = R() * w, cy = R() * h, r = 20 + R() * 70, g = x.createRadialGradient(cx, cy, 0, cx, cy, r), lt = R() < .55;
    g.addColorStop(0, lt ? `rgba(235,215,190,${wear * R()})` : `rgba(10,5,5,${grime * R()})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(cx - r, cy - r, 2 * r, 2 * r); }
}
function pile(x, reg, seed, o){
  inRegion(x, reg, (w, h, R) => wear(x, w, h, R, o), true, seed);
  inRegion(x, reg, (w, h, R) => fibres(x, w, h, R), false, seed + 7);
}
/* a stepped (Heriz-style) octagon rosette */
function rosette(x, cx, cy, r, cols){
  const ring = (rr, c) => { x.fillStyle = c; x.beginPath();
    for (let k = 0; k < 8; k++){ const a = (k + .5) * Math.PI / 4; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } x.closePath(); x.fill(); };
  ring(r, cols[0]); ring(r * .78, cols[1]); ring(r * .56, cols[2]);
  x.fillStyle = cols[3]; x.fillRect(cx - r * .18, cy - r * .18, r * .36, r * .36);
  x.fillStyle = cols[1];
  for (let k = 0; k < 4; k++){ const a = k * Math.PI / 2; x.fillRect(cx + Math.cos(a) * r * 1.2 - r * .1, cy + Math.sin(a) * r * 1.2 - r * .1, r * .2, r * .2); }
}
function diamond(x, cx, cy, rx, ry, c){ x.fillStyle = c; x.beginPath(); x.moveTo(cx, cy - ry); x.lineTo(cx + rx, cy); x.lineTo(cx, cy + ry); x.lineTo(cx - rx, cy); x.closePath(); x.fill(); }
/* a stepped lozenge (Heriz medallions, border motifs): the union of n bars, wide-and-flat to narrow-and-tall */
function stepped(x, cx, cy, rx, ry, n, c){
  x.fillStyle = c;
  for (let k = 0; k < n; k++){ const hw = rx * (k + 1) / n, hh = ry * (n - k) / n; x.fillRect(cx - hw, cy - hh, 2 * hw, 2 * hh); }
}

const RUGS = {
  // (the border is what shows round a riser: a warm madder / rust ground with ivory + indigo guards —
  //  bright enough to read as wool in a dim room)
  A: { field: [52, 62, 124], ground2: [40, 48, 100], border: [160, 44, 36], ivory: [236, 220, 184], gold: [214, 160, 64], teal: [52, 118, 110], ink: [44, 46, 98] },
  B: { field: [44, 62, 112], ground2: [34, 48, 92], border: [184, 86, 40], ivory: [238, 224, 190], gold: [220, 168, 72], teal: [58, 124, 114], ink: [52, 36, 86] },
};
function paintBorder(x, reg, P, seed){
  inRegion(x, reg, (w, h) => {
    // outer guard (canvas top = the rug's EDGE), main band, inner guard (canvas bottom = toward the field)
    x.fillStyle = rgba(P.ink, 1); x.fillRect(0, 0, w, 6);
    x.fillStyle = rgba(P.ivory, 1); x.fillRect(0, 6, w, 14);
    x.fillStyle = rgba(P.field, 1); for (let i = 0; i < w; i += 16) x.fillRect(i + 5, 11, 6, 4);
    x.fillStyle = rgba(P.gold, 1); x.fillRect(0, 20, w, 4);
    x.fillStyle = rgba(P.border, 1); x.fillRect(0, 24, w, 80);
    for (let i = 0; i < 4; i++){                          // motifs every 128 px (the tile repeats seamlessly)
      const cx = 64 + i * 128;
      if (i % 2){ rosette(x, cx, 64, 26, [rgba(P.field, 1), rgba(P.ivory, 1), rgba(P.gold, 1), rgba(P.border, 1)]); }
      else { stepped(x, cx, 64, 34, 30, 4, rgba(P.gold, 1)); stepped(x, cx, 64, 22, 19, 3, rgba(P.field, 1)); diamond(x, cx, 64, 7, 7, rgba(P.ivory, 1)); }
      // a running vine
      x.fillStyle = rgba(P.teal, 1); x.fillRect(cx + 40, 60, 48, 8);
      diamond(x, cx + 64, 64, 9, 13, rgba(P.ivory, 1));
    }
    x.fillStyle = rgba(P.gold, 1); x.fillRect(0, 104, w, 4);
    x.fillStyle = rgba(P.ivory, 1); x.fillRect(0, 108, w, 12);
    x.fillStyle = rgba(P.border, 1); for (let i = 0; i < w; i += 12) x.fillRect(i + 3, 112, 5, 4);
    x.fillStyle = rgba(P.ink, 1); x.fillRect(0, 120, w, 8);
  });
  pile(x, reg, seed + 1, { wear: .08, grime: .1 });
}
function paintCorner(x, reg, P, seed){
  inRegion(x, reg, (w, h) => {
    // the outer corner at the canvas top-left: the guards turn the corner, the band carries a rosette
    x.fillStyle = rgba(P.border, 1); x.fillRect(0, 0, w, h);
    x.fillStyle = rgba(P.ink, 1); x.fillRect(0, 0, w, 6); x.fillRect(0, 0, 6, h);
    x.fillStyle = rgba(P.ivory, 1); x.fillRect(6, 6, w - 6, 14); x.fillRect(6, 6, 14, h - 6);
    x.fillStyle = rgba(P.gold, 1); x.fillRect(20, 20, w - 20, 4); x.fillRect(20, 20, 4, h - 20);
    x.fillStyle = rgba(P.gold, 1); x.fillRect(104, 104, w - 104, 4); x.fillRect(104, 104, 4, h - 104);
    x.fillStyle = rgba(P.ivory, 1); x.fillRect(108, 108, w - 108, 12); x.fillRect(108, 108, 12, h - 108);
    x.fillStyle = rgba(P.ink, 1); x.fillRect(120, 120, w - 120, 8); x.fillRect(120, 120, 8, h - 120);
    rosette(x, 64, 64, 28, [rgba(P.gold, 1), rgba(P.field, 1), rgba(P.ivory, 1), rgba(P.border, 1)]);
  });
  inRegion(x, reg, (w, h, R) => { wear(x, w, h, R, { wear: .06, grime: .1, n: 4 }); fibres(x, w, h, R); }, false, seed + 1);
}
function paintFringe(x, reg, seed){
  inRegion(x, reg, (w, h, R) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = 'rgb(186,170,140)'; x.fillRect(0, 0, w, 7);                        // the knotted heading (at the rug)
    for (let i = 0; i < w; i += 5){
      const L = h * (.65 + R() * .35), v = 200 + R() * 40 | 0;
      x.fillStyle = `rgb(${v},${v - 14},${v - 40})`; x.fillRect(i + R(), 6, 2.4, L - 6);
      if (i % 20 === 0){ x.fillStyle = 'rgb(160,146,118)'; x.fillRect(i - 1, 6, 8, 5); }  // a knot every 4 cords
    }
  });
}
function paintCarpet(x, reg, seed){
  inRegion(x, reg, (w, h, R) => {
    x.fillStyle = '#4a4a54'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 10; i++){ const cx = R() * w, cy = R() * h, r = 20 + R() * 40, g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(${R() < .5 ? '20,20,24' : '120,120,130'},${.08 + R() * .08})`); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(cx - r, cy - r, 2 * r, 2 * r); }
  }, true, seed);
  inRegion(x, reg, (w, h, R) => {
    for (let i = 0; i < 6000; i++){ const v = 40 + R() * 70 | 0; x.fillStyle = `rgba(${v},${v},${v + 8},${.25 + R() * .4})`; x.fillRect(R() * w, R() * h, 1.2, 1.2); }
  }, false, seed + 7);
}
function paintGrating(x, reg){
  inRegion(x, reg, (w, h) => {
    x.fillStyle = '#121318'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 16){ const g = x.createLinearGradient(i, 0, i + 5, 0);
      g.addColorStop(0, '#5c616c'); g.addColorStop(.5, '#a3a9b4'); g.addColorStop(1, '#4a4e58'); x.fillStyle = g; x.fillRect(i, 0, 5, h); }
    for (let j = 0; j < h; j += 64){ x.fillStyle = '#7d828d'; x.fillRect(0, j + 30, w, 4); x.fillStyle = '#2a2d33'; x.fillRect(0, j + 34, w, 2); }
  }, true);
}
function paintLaminate(x, reg, seed){
  inRegion(x, reg, (w, h, R) => {
    x.fillStyle = '#34343c'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++){ const v = R() < .5 ? 20 : 90; x.fillStyle = `rgba(${v},${v},${v + 6},${.12 + R() * .15})`;
      x.fillRect(R() * w, R() * h, 1 + R() * 2.2, 1 + R() * 2.2); }                                         // the pebbled ABS skin
  }, false, seed);
  inRegion(x, reg, (w, h, R) => {
    for (let i = 0; i < 6; i++){ x.strokeStyle = `rgba(180,180,190,${.06 + R() * .08})`; x.lineWidth = .7;          // road scuffs
      x.beginPath(); const sx = R() * w, sy = R() * h; x.moveTo(sx, sy); x.lineTo(sx + (R() - .5) * 90, sy + (R() - .5) * 20); x.stroke(); }
  }, true, seed + 7);
}
function paintAlu(x, reg){
  inRegion(x, reg, (w, h) => {
    // the valance extrusion's profile across (canvas y): a bright lip at the edge, a groove, the inner flange
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#8e949e'); g.addColorStop(.12, '#e8ecf2'); g.addColorStop(.3, '#b9bfc8'); g.addColorStop(.46, '#6f747d');
    g.addColorStop(.52, '#c9ced6'); g.addColorStop(.8, '#a4aab3'); g.addColorStop(1, '#7c818a');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 3){ x.fillStyle = `rgba(255,255,255,${(Math.sin(i * 1.7) * .5 + .5) * .05})`; x.fillRect(i, 0, 1, h); }   // brushed
  });
}
function paintBall(x, reg){
  inRegion(x, reg, (w, h) => {
    x.fillStyle = '#a9afb8'; x.fillRect(0, 0, w, h);
    const g = x.createRadialGradient(10, 10, 2, 4, 4, 52);           // the ball corner's dome, its centre at the outer corner
    g.addColorStop(0, '#ffffff'); g.addColorStop(.35, '#dfe4ea'); g.addColorStop(.75, '#8b919a'); g.addColorStop(1, '#5d626b');
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, 50, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#4b4f57'; x.lineWidth = 2; x.beginPath(); x.arc(0, 0, 50, 0, Math.PI / 2); x.stroke();
  });
}
function paintLatch(x, reg){
  inRegion(x, reg, (w, h) => {
    x.clearRect(0, 0, w, h);
    const metal = (x0, y0, ww, hh, r) => { const g = x.createLinearGradient(0, y0, 0, y0 + hh); g.addColorStop(0, '#f2f4f7'); g.addColorStop(.5, '#a8aeb7'); g.addColorStop(1, '#6c717a');
      x.fillStyle = g; x.beginPath(); x.roundRect(x0, y0, ww, hh, r); x.fill(); };
    metal(14, 8, 100, 48, 6);                                         // the dish
    x.fillStyle = '#3c4048'; x.beginPath(); x.roundRect(28, 16, 72, 32, 10); x.fill();
    x.fillStyle = '#cfd4db';                                          // the butterfly
    x.beginPath(); x.moveTo(64, 32); x.bezierCurveTo(44, 12, 30, 22, 36, 32); x.bezierCurveTo(30, 42, 44, 52, 64, 32); x.fill();
    x.beginPath(); x.moveTo(64, 32); x.bezierCurveTo(84, 12, 98, 22, 92, 32); x.bezierCurveTo(98, 42, 84, 52, 64, 32); x.fill();
    x.fillStyle = '#7c818a'; x.beginPath(); x.arc(64, 32, 5, 0, 7); x.fill();
  });
}
function paintHandle(x, reg){
  inRegion(x, reg, (w, h) => {
    x.clearRect(0, 0, w, h);
    const g = x.createLinearGradient(0, 4, 0, 60); g.addColorStop(0, '#e4e8ee'); g.addColorStop(1, '#757a83');
    x.fillStyle = g; x.beginPath(); x.roundRect(6, 6, 116, 52, 8); x.fill();                 // the recessed dish
    x.fillStyle = '#16171b'; x.beginPath(); x.roundRect(16, 14, 96, 36, 6); x.fill();
    x.fillStyle = '#c4c9d0'; x.fillRect(26, 34, 76, 8);                                       // the spring handle
    x.fillStyle = '#80858e'; x.fillRect(26, 40, 76, 3);
  });
}
function paintStrap(x, reg, seed){
  inRegion(x, reg, (w, h, R) => {
    x.fillStyle = '#e8671c'; x.fillRect(0, 0, w, h);
    for (let j = 0; j < h; j += 3){ x.fillStyle = `rgba(120,30,0,${.12 + (j % 6 ? 0 : .1)})`; x.fillRect(0, j, w, 1); }
    x.fillStyle = 'rgba(80,20,0,.5)'; x.fillRect(3, 0, 2, h); x.fillRect(w - 5, 0, 2, h);   // the edge stitch
    for (let i = 0; i < 400; i++){ x.fillStyle = `rgba(255,200,150,${R() * .1})`; x.fillRect(R() * w, R() * h, 2, 1); }
  }, true, seed);
}
function paintSkirt(x, reg){
  inRegion(x, reg, (w, h) => {
    // box pleats: 4 per tile, each a lit face, a shadowed fold, a deep crease
    for (let i = 0; i < 4; i++){ const x0 = i * w / 4, g = x.createLinearGradient(x0, 0, x0 + w / 4, 0);
      g.addColorStop(0, '#0f0f13'); g.addColorStop(.12, '#2a2a31'); g.addColorStop(.5, '#3a3a42'); g.addColorStop(.82, '#26262c'); g.addColorStop(1, '#0c0c10');
      x.fillStyle = g; x.fillRect(x0, 0, w / 4, h); }
    const t = x.createLinearGradient(0, 0, 0, h);                       // the hem + the velcro header
    t.addColorStop(0, 'rgba(0,0,0,.55)'); t.addColorStop(.06, 'rgba(0,0,0,0)'); t.addColorStop(.94, 'rgba(0,0,0,0)'); t.addColorStop(1, 'rgba(0,0,0,.35)');
    x.fillStyle = t; x.fillRect(0, 0, w, h);
  });
}
function paintWood(x, reg, seed){
  inRegion(x, reg, (w, h, R) => {
    x.fillStyle = '#7a4c2c'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++){ x.strokeStyle = `rgba(${R() < .5 ? '40,20,8' : '170,110,60'},${.15 + R() * .2})`; x.lineWidth = .6 + R() * 1.8;
      const x0 = R() * w; x.beginPath(); x.moveTo(x0, 0); x.bezierCurveTo(x0 + (R() - .5) * 20, h * .3, x0 + (R() - .5) * 20, h * .7, x0 + (R() - .5) * 12, h); x.stroke(); }
  }, true, seed);
}
/* spray-paint stencil text centred in its cell, OPAQUE on its own background (an alpha-cut decal's thin
   strokes vanish under mipmapping at a distance; a painted cell only blurs): `bg` paints the cell first
   — the surface it sits on, so the decal's edge never shows. Returns the text's aspect (w / cell h) */
const FONT = s => `900 ${s}px "Arial Black", "Helvetica Neue", Impact, sans-serif`;
function stencil(x, [cx, cy, cw, ch], text, R, bg, fleck, size = 44){
  x.save(); x.beginPath(); x.rect(cx, cy, cw, ch); x.clip();
  bg(cx, cy, cw, ch);
  x.font = FONT(size);
  try { x.letterSpacing = '4px'; } catch(e){}
  let tw = x.measureText(text).width;
  const fit = Math.min(1, (cw - 24) / tw);
  if (fit < 1){ x.font = FONT(Math.floor(size * fit)); tw = x.measureText(text).width; }
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = 'rgba(238,236,228,.5)'; x.shadowBlur = 3;                           // the overspray's soft edge
  x.fillStyle = 'rgba(232,230,222,.92)'; x.fillText(text, cx + cw / 2, cy + ch / 2 + 2);
  x.shadowBlur = 0;
  x.restore();
  // worn paint: a few flecks lifted back to the ground (its own colour)
  x.save(); x.beginPath(); x.rect(cx, cy, cw, ch); x.clip(); x.fillStyle = fleck;
  for (let i = 0; i < 160; i++){ const r = R() < .8 ? 1 : 2; x.fillRect(cx + (R() * cw | 0), cy + (R() * ch | 0), r, r); }
  x.restore();
  return Math.min(cw, tw + 24) / ch;
}
export const PLATE = '#17181d';                           // the panel plate / the names' ground (= the 'black' swatch)

/* ORM (G = roughness, B = metalness) per region — a half-resolution canvas, same layout */
function paintORM(o){
  const k = .5, put = (reg, rough, metal) => { o.fillStyle = `rgb(255,${Math.round(rough * 255)},${Math.round(metal * 255)})`; o.fillRect(reg[0] * k, reg[1] * k, reg[2] * k, reg[3] * k); };
  o.fillStyle = 'rgb(255,242,0)'; o.fillRect(0, 0, SW * k, SH * k);                     // wool / paint: matte
  for (const r of ['laminate']) put(LAYOUT[r], .62, .04);
  for (const r of ['alu', 'ball', 'latch', 'handle', 'chrome']) put(LAYOUT[r], .28, .85);
  put(LAYOUT.grating, .5, .55); put(LAYOUT.black, .32, .1); put(LAYOUT.cable, .55, 0); put(LAYOUT.red, .4, 0); put(LAYOUT.wood, .6, 0);
  put(LAYOUT.strap, .85, 0); put(LAYOUT.names, .32, .1); put(LAYOUT.stencils, .62, .04); put(LAYOUT.skirt, .97, 0);
}

let painted = null;
/* the room is gone: free the textures (the next build paints them again) */
export function releaseStudioAtlas(){ if (painted){ painted.map?.dispose(); painted.orm?.dispose(); painted = null; } }
/* the studio's atlas (painted once per page): { map, orm, uv } — map / orm null without a DOM */
export function studioAtlas(){
  if (painted) return painted;
  if (typeof document === 'undefined'){ painted = { map: null, orm: null, uv: atlasUV() }; return painted; }
  const c = document.createElement('canvas'); c.width = SW; c.height = SH;
  const x = c.getContext('2d');
  const R = rng(4242), aspects = {};
  x.clearRect(0, 0, SW, SH);
  // (the field + medallion lie under the riser: only the border, its corners and the fringe are painted)
  paintBorder(x, LAYOUT.borderA, RUGS.A, 21); paintBorder(x, LAYOUT.borderB, RUGS.B, 22);
  paintCorner(x, LAYOUT.cornerA, RUGS.A, 31); paintCorner(x, LAYOUT.cornerB, RUGS.B, 32);
  paintFringe(x, LAYOUT.fringe, 41); paintAlu(x, LAYOUT.alu); paintBall(x, LAYOUT.ball);
  x.fillStyle = rgba(RUGS.A.border, 1); x.fillRect(...LAYOUT.bindA); x.fillStyle = rgba(RUGS.B.border, 1); x.fillRect(...LAYOUT.bindB);
  x.fillStyle = '#17181d'; x.fillRect(...LAYOUT.black); x.fillStyle = '#1d1e22'; x.fillRect(...LAYOUT.cable);
  x.fillStyle = '#d9dde3'; x.fillRect(...LAYOUT.chrome); x.fillStyle = '#7a1414'; x.fillRect(...LAYOUT.red);
  paintLatch(x, LAYOUT.latch); paintHandle(x, LAYOUT.handle);
  paintCarpet(x, LAYOUT.carpet, 51); paintGrating(x, LAYOUT.grating); paintLaminate(x, LAYOUT.laminate, 52);
  paintStrap(x, LAYOUT.strap, 53); paintWood(x, LAYOUT.wood, 54);
  paintSkirt(x, LAYOUT.skirt);
  const U = atlasUV();
  const plate = (a, b, w, h) => { x.fillStyle = PLATE; x.fillRect(a, b, w, h); };
  // (the case laminate under a stencil: its tile copied out ONCE — drawing the atlas onto itself made the
  //  browser snapshot the whole canvas for every one of the 16 stencils)
  const lam = LAYOUT.laminate, lc = document.createElement('canvas'); lc.width = lam[2]; lc.height = lam[3];
  lc.getContext('2d').drawImage(c, lam[0], lam[1], lam[2], lam[3], 0, 0, lam[2], lam[3]);
  const onCase = (a, b, w, h) => { for (let ox = 0; ox < w; ox += lam[2]) x.drawImage(lc, 8, 8, Math.min(lam[2], w - ox) - 16, h, a + ox, b, Math.min(lam[2], w - ox), h); };
  Object.entries(NAMES).forEach(([k, s]) => { aspects['n:' + k] = stencil(x, U.name[k].px, s, R, plate, PLATE); });
  STENCILS.forEach((s, i) => { aspects['s:' + i] = stencil(x, U.stencil[i].px, s, R, onCase, '#33333a', 40); });
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8; map.flipY = true;
  const oc = document.createElement('canvas'); oc.width = SW / 2; oc.height = SH / 2;
  paintORM(oc.getContext('2d'));
  const orm = new THREE.CanvasTexture(oc);
  painted = { map, orm, uv: atlasUV(aspects), canvas: c };
  return painted;
}
