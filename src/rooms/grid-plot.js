import * as THREE from 'three';
import { footingBoxes } from './footing.js';
/* ============================================================
   THE STAGE PLOT — the Greybox's one set of props (src/rooms/grid.js). A dev room marks where things
   go: every standing machine's NAME is printed on the floor in front of the spot it stands on, in the
   HUD's spaced capitals, with a short tape in the machine's colour — and, when it has been RAISED (its
   lift: by the user, or the layout's gallery raise), by how much in metres (1 u = .677 m: "+4.2 m").
   A machine standing on its own tall stand (the turntable) is not "raised". Lift it and it re-reads.

   It is for the viewer who walks the floor (free-fly, eye level, the headset): the print fades out with
   distance from the eye (PLOT.NEAR → PLOT.FAR) and in the bottom of the frame (under the HUD's button
   row) — the director's wide and the phone's portrait never show it. Shader-only: no per-frame work.

   placeLabels (PURE, tested) finds each label a spot in FRONT of what its machine stands on (the room is
   seen from +z; labels read along +x, like a plot on a page) — else beside it — slid out and along
   until it is ≥ PLOT.CLEAR from every machine's footprint (hung ones too), every footing envelope
   (rooms/footing.js footingBoxes: pads, lofts, stairs, ladders) and every label already placed —
   else none. Deterministic. Flat on the floor (within 1 u of it: the shot solve never counts it) and
   additive: light printed on the grid. One draw, one atlas texture, redrawn only when a text changes.
   ============================================================ */

export const PLOT = {
  EM: .62,          // name glyph size (u) — ≈ .42 m capitals
  SUB: .42,         // elevation glyph size (u)
  TRACK: .22,       // letter spacing (em) — the HUD's spaced caps
  ADV: .6,          // a monospace glyph's advance (em)
  LEAD: .3,         // the gap between the name and its tape / elevation (u)
  TAPE: .1,         // the colour tape's depth (u)
  CLEAR: 1,         // from every footprint, footing envelope and label (u)
  STEP: .45,        // how far a label slides outward per try (u)
  TRIES: 10,
  WALL: .6,         // keep this far inside the room's walls (u)
  M_PER_U: .677,
  RAISED: 1,        // a machine lifted this far (u) reads its lift
  NEAR: 15, FAR: 24,// the print is full within NEAR of the eye, gone past FAR (u)
  LOW: [-.9, -.72], // …and fades out below this band of the frame (NDC y: the HUD's button row)
};

/** PURE. The label's lines: its machine's name (caps) and, when raised, by how much (its LIFT — deck
    over the spot where it would sit on the floor; a tall stand of its own is not a lift). */
export function labelLines(a, floor){
  const name = String(a.label || a.key || '').toUpperCase().trim();
  const lift = Number.isFinite(a.lift) ? a.lift : 0;
  return { name, sub: lift >= PLOT.RAISED ? `+${(lift * PLOT.M_PER_U).toFixed(1)} m` : null };
}
/** PURE. A label's size (u) from its lines — a monospace estimate (the renderer measures the same way). */
export function labelSize({ name, sub }){
  const run = (s, em) => s ? s.length * em * (PLOT.ADV + PLOT.TRACK) - em * PLOT.TRACK : 0;
  const w = Math.max(run(name, PLOT.EM), run(sub, PLOT.SUB));
  const h = PLOT.EM + PLOT.LEAD + PLOT.TAPE + (sub ? PLOT.LEAD * .6 + PLOT.SUB : 0);
  return { w, h };
}

/* an oriented rect: centre, unit axes a (half-extent ha) and b (hb) — SAT in 2-D */
const obb = (x, z, ax, az, ha, hb) => ({ x, z, ax, az, bx: -az, bz: ax, ha, hb });
/* a footing-style rect {x, z, hw, hd, yaw}: its local u axis is world (cos, −sin) (footing.js toWorld) */
const ofRect = r => { const c = Math.cos(r.yaw || 0), s = Math.sin(r.yaw || 0); return obb(r.x, r.z, c, -s, r.hw, r.hd); };
const ofBox = b => obb((b[0] + b[1]) / 2, (b[4] + b[5]) / 2, 1, 0, (b[1] - b[0]) / 2, (b[5] - b[4]) / 2);
const rad = (o, lx, lz) => o.ha * Math.abs(o.ax * lx + o.az * lz) + o.hb * Math.abs(o.bx * lx + o.bz * lz);
/** PURE. True when two oriented rects are at least `gap` apart (separating-axis, conservative at corners). */
export function clearOf(A, B, gap = 0){
  const dx = B.x - A.x, dz = B.z - A.z;
  for (const [lx, lz] of [[A.ax, A.az], [A.bx, A.bz], [B.ax, B.az], [B.bx, B.bz]])
    if (Math.abs(dx * lx + dz * lz) >= rad(A, lx, lz) + rad(B, lx, lz) + gap) return true;
  return false;
}

/** PURE. Where each standing machine's label lies: [{ key, name, sub, color, x, z, w, h }] — on the floor
    in FRONT of what it stands on (the room is seen from +z: a label reads along +x, like the plot on a
    page), else beside it, slid out and along until clear; none if no spot is. `room` {HW, BACK, FRONT}. */
export function placeLabels(anchors = [], plan = null, { floor = plan?.floor ?? 0, room = null, size = labelSize } = {}){
  const list = (anchors || []).filter(a => a && Number.isFinite(a.x) && Number.isFinite(a.z) && a.w > 0 && a.d > 0);
  const pads = new Map((plan?.pads || []).map(p => [p.key, p]));
  const rectOf = a => pads.get(a.key) || { x: a.x, z: a.z, hw: a.w / 2, hd: a.d / 2, yaw: a.yaw || 0 };
  // what a label keeps clear of: every machine's footprint — a HUNG one's where it comes down to the floor
  // (the organ loft's posts; a chandelier 17 u up stands over nothing a floor label could touch) — and
  // every footing envelope
  const grounded = a => a.kind !== 'hung' || !Array.isArray(a.box) || a.box[2] < floor + PLOT.CLEAR;
  const obstacles = [
    ...list.filter(grounded).map(a => ofRect({ x: a.x, z: a.z, hw: a.w / 2, hd: a.d / 2, yaw: a.yaw || 0 })),
    ...list.filter(a => grounded(a) && Array.isArray(a.box)).map(a => ofBox(a.box)),     // (and what overhangs it: the kit's arches)
    ...(plan ? footingBoxes(plan).map(e => ofBox(e.box)) : []),
  ];
  const inRoom = L => !room || (L.x - L.ha >= -room.HW + PLOT.WALL && L.x + L.ha <= room.HW - PLOT.WALL && L.z - L.hb >= room.BACK + PLOT.WALL && L.z + L.hb <= room.FRONT - PLOT.WALL);
  const out = [], placed = [];
  for (const a of list){
    if (a.kind === 'hung') continue;                           // (it stands on nothing: no spot to mark)
    const lines = labelLines(a, floor);
    if (!lines.name) continue;
    const { w, h } = size(lines), r = rectOf(a), c = Math.abs(Math.cos(r.yaw || 0)), s = Math.abs(Math.sin(r.yaw || 0));
    const ex = r.hw * c + r.hd * s, ez = r.hw * s + r.hd * c;       // its world bounds' half-extents
    const room1 = Math.max(0, ex - w / 2), toward = r.x > 0 ? -1 : 1;
    // the spots tried, in order: in front (slid out, then along); else beside it — the side toward the
    // room's middle first — level with its front edge, then with its middle
    const tries = [];
    for (let k = 0; k < PLOT.TRIES; k++) for (const f of [0, -.5, .5, -1, 1, -1.5, 1.5])
      tries.push([r.x + f * Math.max(room1, w / 2), r.z + ez + PLOT.CLEAR + h / 2 + k * PLOT.STEP]);
    for (const sd of [toward, -toward]) for (let k = 0; k < PLOT.TRIES; k++) for (const zz of [r.z + ez - h / 2, r.z])
      tries.push([r.x + sd * (ex + PLOT.CLEAR + w / 2 + k * PLOT.STEP), zz]);
    for (const [x, z] of tries){
      const L = obb(x, z, 1, 0, w / 2, h / 2);
      if (!inRoom(L) || !obstacles.every(o => clearOf(L, o, PLOT.CLEAR)) || !placed.every(o => clearOf(L, o, PLOT.CLEAR * .6))) continue;
      out.push({ key: a.key, ...lines, color: a.color ?? '#8fa6c8', x, z, w, h });
      placed.push(L);
      break;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- the render: one mesh, one atlas */
const NAME_PX = 32, PX_PER_U = NAME_PX / PLOT.EM, SUB_PX = Math.round(PLOT.SUB * PX_PER_U), ATLAS_W = 512;
const ROW = Math.ceil(labelSize({ name: 'X', sub: 'X' }).h * PX_PER_U) + 2;     // a row holds the tallest label
const FONT = px => `600 ${px}px Menlo, Consolas, 'DejaVu Sans Mono', monospace`;

export function makePlot({ renderer = null, floor = 0, room = null } = {}){
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(.34), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.name = 'grid:plot'; mesh.renderOrder = 1; mesh.frustumCulled = false;
  // the fade: by the eye's distance, and out of the bottom of the frame (a pure fn of the view: the GPU's)
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 pW; varying vec4 pC;')
      .replace('#include <project_vertex>', '#include <project_vertex>\npW = (modelMatrix * vec4(transformed, 1.)).xyz; pC = gl_Position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 pW; varying vec4 pC;')
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        float pF = (1. - smoothstep(${PLOT.NEAR.toFixed(1)}, ${PLOT.FAR.toFixed(1)}, distance(pW, cameraPosition)))
                 * smoothstep(${PLOT.LOW[0].toFixed(2)}, ${PLOT.LOW[1].toFixed(2)}, pC.y / max(pC.w, 1e-4));
        gl_FragColor.rgb *= pF;`);
  };
  mat.customProgramCacheKey = () => 'grid:plot';
  let canvas = null, tex = null, sig = '', labels = [], texH = 0;
  const aniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;

  /* the atlas: a row per label — name, its tape in the machine's colour, the elevation */
  function draw(L){
    const H = Math.max(1, L.length) * ROW;
    if (!canvas){ canvas = document.createElement('canvas'); canvas.width = ATLAS_W; }
    if (canvas.height !== H) canvas.height = H;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, ATLAS_W, H);
    const spaced = (s, px, x, y) => { g.font = FONT(px); const adv = px * (PLOT.ADV + PLOT.TRACK); for (const ch of s){ g.fillText(ch, x, y); x += adv; } };
    L.forEach((l, i) => {
      const y0 = i * ROW, k = Math.min(1, (ATLAS_W - 4) / (l.w * PX_PER_U));      // (a long name squeezes to fit its row)
      g.save(); g.translate(2, 0); g.scale(k, 1);
      g.textBaseline = 'alphabetic'; g.fillStyle = '#a9c6ff';
      spaced(l.name, NAME_PX, 0, y0 + NAME_PX * .82);
      const ty = y0 + (PLOT.EM + PLOT.LEAD * .55) * PX_PER_U;
      g.fillStyle = l.color; g.fillRect(0, ty, Math.min(l.w, 2.4) * PX_PER_U, PLOT.TAPE * PX_PER_U);
      if (l.sub){ g.fillStyle = '#86a6e0'; spaced(l.sub, SUB_PX, 0, y0 + (PLOT.EM + PLOT.LEAD + PLOT.TAPE + PLOT.LEAD * .6 + PLOT.SUB * .82) * PX_PER_U); }
      g.restore();
    });
    if (!tex){
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(8, aniso);
      tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
      mat.map = tex; mat.needsUpdate = true;
    } else if (texH !== H) tex.dispose();                   // (a new size: three re-allocates it on the next upload)
    texH = H; tex.needsUpdate = true;
  }

  return {
    mesh, get labels(){ return labels; },
    place(anchors, plan){
      labels = placeLabels(anchors, plan, { floor, room });
      const s = labels.map(l => `${l.name}|${l.sub}|${l.color}`).join('/');
      if (s !== sig){ sig = s; if (labels.length) draw(labels); }
      // the quads: a label is w × h on the floor, its glyphs' up pointing away from its reader
      const H = canvas ? canvas.height : 1, pos = [], uv = [], idx = [], y = floor + .02;
      labels.forEach((l, i) => {
        const ux = 1, uz = 0, vx = 0, vz = 1;                   // u: reading (+x); v: toward the reader (+z: the glyphs' down)
        const hw = l.w / 2, hh = l.h / 2, k = Math.min(1, (ATLAS_W - 4) / (l.w * PX_PER_U));
        const u0 = 2 / ATLAS_W, u1 = (2 + l.w * PX_PER_U * k) / ATLAS_W, t0 = 1 - (i * ROW) / H, t1 = 1 - (i * ROW + l.h * PX_PER_U) / H;
        const at = (a, b) => [l.x + ux * a + vx * b, y, l.z + uz * a + vz * b];
        const n = pos.length / 3;
        pos.push(...at(-hw, -hh), ...at(hw, -hh), ...at(hw, hh), ...at(-hw, hh));   // top-left, top-right, bottom-right, bottom-left
        uv.push(u0, t0, u1, t0, u1, t1, u0, t1);
        idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      mesh.geometry.dispose(); mesh.geometry = geo;
      mesh.visible = labels.length > 0;
      mesh.userData.labels = labels.map(l => l.key);            // (dev probes: who got a label)
    },
    dispose(){ mesh.geometry.dispose(); mat.dispose(); tex?.dispose(); canvas = null; tex = null; sig = ''; texH = 0; },
  };
}
