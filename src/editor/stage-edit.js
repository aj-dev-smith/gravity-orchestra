/* ============================================================
   STAGE EDIT — the human curates the room (PLAN-staging: "build the
   drag mechanism; human curation over auto-layout").

   Key E (or the EDIT pill) enters it: the camera goes free and eases to
   a PLAN VIEW that fits every machine (a wider lens from under the
   ceiling; on a phone held upright the room's long axis runs up the
   screen), every movable machine shows its FOOTPRINT on a floor grid
   with a name tag. A footprint is the machine's own box, measured once
   per build in its LOCAL frame at the count-in pose (the pose the room
   solve measures), and drawn TURNED with it — an oriented rectangle, so
   a machine at 45° is judged by what it occupies (placement.js: SAT). Click one to select it; drag it across the
   floor (a horizontal plane at the grab height — the grabbed point stays
   under the pointer), turn it with the ring handle or Q / E (15° steps),
   everything snapped to a ½-unit grid (hold Shift for free). A footprint
   that overlaps another, the belt, or leaves the room turns RED, live.
   Release → the placement is saved (per song) and the room re-anchors:
   supports already reach the floor (the floor is flat; a station moves
   rigidly — render-time only, the solve never knows) and the director
   re-solves its shots from where things now stand.

   HEIGHT, Rollercoaster-Tycoon style (height.js has the rules): a selected
   machine gets a HEIGHT HANDLE — a pole from the floor beside its nearest
   corner with a metre scale and a knob (▲▼) at the height it stands at, its
   SHADOW on the floor and dashed DROP LINES from its footprint, so height
   reads from any angle. Drag the knob: the machine rises / sinks live (a
   rigid move — the kit's group too, rebuilt at its deck when the gesture
   settles), the room's supports re-form under it each frame (a plinth, a
   riser, a platform, a tower; a LOFT with a neighbour at its height — the
   knob is magnetic to the floor and to a neighbour's deck). Nothing in stage
   edit frames a shot, so the director re-solves ONCE, on the way out (a move
   or a height only re-anchors the room: no hitch at a gesture's end), and an
   undo of a height step — AUTO too — comes back live, no rebuild. Grabbing
   the knob in the plan view (a straight-down look hides height) eases the eye
   to an elevated 3/4 view that frames the selection with its knob landing
   UNDER THE HAND, and the knob then follows the pointer; PLAN / 3D in the bar
   flips between the two. The pole stands at a corner whose knob is clear of
   the bar and the dock; when a gesture leaves it under them anyway, the 3/4
   view re-frames once. One gesture at a time: a second finger is ignored, a
   lost pointer capture ends the drag, and an eye that moves under a drag (a
   damped orbit, a resize) re-anchors it — the machine never moves by itself.
   PgUp / PgDn and ] / [ step ½ u (Shift 2 u), Home sets it on the floor;
   the dock under the stage has ▲ RAISE, ▼ LOWER, FLOOR (an explicit 0) and
   AUTO (the layout decides — e.g. the gallery raise). One undo step per
   gesture: a drag, a burst of key repeats / taps. The readout says metres
   + the band (FLOOR · RISER · PLATFORM · TOWER) + "LOFT · STRUM" when it
   shares a deck (the footing plan's own word).

   HUNG stations (the organ loft, the ricochet chandelier, the volley court)
   hang off the belt as built — and move like any machine: grab one and drag
   it OFF the belt and it STANDS where it is dropped (rebuilt standing: no
   columns or ceiling rods — the room builds its support by height band, and
   it keeps the height it hung at; then height, turn, AUTO, FLOOR as usual).
   Drag a hung machine (hanging or standing) back over the belt's top — or
   onto the spot it hangs at — and it RE-HANGS as built: the MAGNET. A chip
   over it says which, live, all the way ("HANGS FROM THE BELT" / "STANDS
   HERE"), and its footprint turns the belt's blue over the magnet. While it
   hangs it is overhead of everyone: nothing conflicts with it, it doesn't
   turn, it has no height of its own (placement.js standSlot / rehangs).
   The belt itself doesn't move here — click it and the dock says why.
   The drum kit moves but doesn't turn (it is built to face the audience).

   Input etiquette (CLAUDE.md §5 + the free camera):
   · never stopPropagation on pointer events — the window-level iOS
     audio-priming listeners must see every tap (the knob is a DOM element:
     a press on it never reaches the orbit, nothing needs stopping);
   · a press that lands on a machine disables the orbit for that press only
     (capture phase, before OrbitControls sees it); a press on empty space
     orbits the camera as usual;
   · Q / E, PgUp / PgDn, [ / ], Home are swallowed (capture) only while a
     machine is selected.
   ============================================================ */
import { snap, snapYaw, conflicts, describeConflicts, footprint, boxCorners, bounds, inPoly, rehangs } from './placement.js';
import { GALLERY_DROP } from '../instruments/stations.js';
import { readout, dragLift, stepLift, loftTargets, liftMax, rayPlaneY, makeSettle, bandName, TICK_U, fmtMeters } from './height.js';

const C = { idle: 0x6c7aa0, hover: 0xcfd6e6, sel: 0xffb764, bad: 0xff4d5e, belt: 0x3d6dff, hang: 0x7fb2ff };
const GIZMO_ORDER = 990;
const HINT_KEY = 'cascade:hint:height';              // the first-selection hint, once used / dismissed (a convenience: storage may throw)
const SETTLE_MS = 700;                               // a burst of height taps / key repeats settles this long after the last
                                                     //  (past an OS key-repeat delay, ~.5 s: a held PgUp is ONE gesture)
const deg = d => d * Math.PI / 180;
const VIEW3D = { el: deg(31), az: deg(38), fov: 42, maxFov: 70, ease: .55 };   // the 3/4 view: ~RCT's dimetric tilt, a longer lens
const GRAB_HEAD = 8;                                 // a knob grabbed in the PLAN: the 3/4 swing frames at least this much raise (u ≈ 5.4 m) over the machine's top
const GRAB_OVER = 1;                                 //  …or, when it is more, the raise to the rear GALLERY's deck / the highest LOFT it could join, + this

export function makeStageEdit({ THREE, scene, cam, dom, host, onChange = () => {} }){
  let on = false, pieces = [], sel = null, hover = null, drag = null, snapOn = true, info = null;
  let prevMode = null, prevMax = null, prevPolar = null, view = 'plan';
  const local = new Map();                              // key → { rel, top, deck0 } — each machine's LOCAL box, measured once per build
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), _v = new THREE.Vector3(), plane = new THREE.Plane();
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = (() => { try { return window.localStorage; } catch (e){ return null; } })();

  /* ---- gizmo layer: grid + footprints + rotation ring (drawn over everything) ---- */
  const gizmo = new THREE.Group(); gizmo.visible = false; gizmo.renderOrder = GIZMO_ORDER; scene.add(gizmo);
  const lineMat = (color, opacity) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false });
  const fillMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const tag = o => { o.renderOrder = GIZMO_ORDER; o.userData.noMerge = true; o.userData.noFadeGate = true; o.raycast = () => {}; return o; };
  // the floor grid: minor lines every SNAP·2 = 1 u, major every 5 u — on the room floor (the machines stand on it)
  const FLOOR_Y = (host.floorY ?? 0) + .02;
  const grid = new THREE.Group(); grid.position.y = FLOOR_Y; gizmo.add(grid);
  {
    const minor = [], major = [], R = 60;
    for (let i = -R; i <= R; i++) (i % 5 ? minor : major).push(-R, 0, i, R, 0, i, i, 0, -R, i, 0, R);
    const seg = (arr, m) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); return tag(new THREE.LineSegments(g, m)); };
    grid.add(seg(minor, new THREE.LineBasicMaterial({ color: 0x5a6a9a, transparent: true, opacity: .07, depthWrite: false, fog: false })));
    grid.add(seg(major, new THREE.LineBasicMaterial({ color: 0x7b8cc4, transparent: true, opacity: .16, depthWrite: false, fog: false })));
  }
  const rectGeo = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(15), 3)); return g; };
  /* an oriented footprint (4 corners, boxCorners order: local x runs c0→c1, local z c1→c2) */
  const setRect = (line, fill, poly, y, yaw = 0) => {
    const p = line.geometry.attributes.position;
    for (let i = 0; i < 5; i++){ const q = poly[i % 4]; p.setXYZ(i, q[0], y, q[1]); }
    p.needsUpdate = true; line.geometry.computeBoundingSphere();
    const cx = poly.reduce((a, q) => a + q[0], 0) / 4, cz = poly.reduce((a, q) => a + q[1], 0) / 4;
    fill.position.set(cx, y - .01, cz); fill.rotation.y = yaw;
    fill.scale.set(Math.max(.01, Math.hypot(poly[1][0] - poly[0][0], poly[1][1] - poly[0][1])), 1,
                   Math.max(.01, Math.hypot(poly[2][0] - poly[1][0], poly[2][1] - poly[1][1])));
  };
  const unitPlane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  // the belt's footprint (fixed; for reference)
  const beltLine = tag(new THREE.Line(rectGeo(), lineMat(C.belt, .55))), beltFill = tag(new THREE.Mesh(unitPlane, fillMat(C.belt, .07)));
  gizmo.add(beltLine, beltFill);
  // rotation ring + knob
  const ring = tag(new THREE.Mesh(new THREE.RingGeometry(.96, 1, 128).rotateX(-Math.PI / 2), fillMat(C.sel, .5)));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(.6, 20, 14), new THREE.MeshBasicMaterial({ color: C.sel, depthTest: false, depthWrite: false, transparent: true, fog: false }));
  knob.renderOrder = GIZMO_ORDER + 1; knob.userData.noMerge = knob.userData.noFadeGate = true;
  const knobArrow = tag(new THREE.Line(rectGeo(), lineMat(C.sel, .8)));
  ring.visible = knob.visible = knobArrow.visible = false;
  gizmo.add(ring, knob, knobArrow);

  /* ---- the HEIGHT handle, in the world: the selection's SHADOW on the floor (depth-tested: it lies under
     the machine and its supports) + its outline, and dashed DROP LINES from its footprint's corners ---- */
  const shadow = new THREE.Mesh(unitPlane, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .45, depthWrite: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  shadow.userData.noMerge = shadow.userData.noFadeGate = true; shadow.raycast = () => {}; shadow.renderOrder = 2;
  const shadowLine = tag(new THREE.Line(rectGeo(), lineMat(C.sel, .38)));
  const dropGeo = new THREE.BufferGeometry(); dropGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24), 3));
  dropGeo.setAttribute('lineDistance', new THREE.Float32BufferAttribute(new Float32Array(8), 1));   // (the dashes: written in place — no garbage)
  const drops = tag(new THREE.LineSegments(dropGeo, new THREE.LineDashedMaterial({ color: C.sel, dashSize: .5, gapSize: .32, transparent: true, opacity: .8, depthTest: false, depthWrite: false, fog: false })));
  shadow.visible = shadowLine.visible = drops.visible = false;
  gizmo.add(shadow, shadowLine, drops);

  /* ---- DOM: name tags + the toolbar ---- */
  const tagsEl = document.createElement('div'); tagsEl.className = 'se-tags'; tagsEl.hidden = true; document.body.appendChild(tagsEl);
  const bar = document.createElement('div'); bar.className = 'se-bar'; bar.hidden = true;
  bar.innerHTML = `<b>STAGE EDIT</b><span class="se-hint"></span>
    <span class="se-btns">
    <button data-a="undo" title="undo the last change (⌘Z / Ctrl+Z)">↶<i> UNDO</i></button><button data-a="redo" title="redo (⌘⇧Z / Ctrl+Y)" hidden>↷<i> REDO</i></button>
    <button data-a="snap" class="on" title="snap to the ½-unit grid / 15° (hold Shift to place freely)">⌗<i> SNAP</i></button>
    <span class="se-view" role="group" aria-label="view"><button data-a="plan" class="on" title="straight down over the whole stage">PLAN</button><button data-a="3d" title="an elevated 3/4 view — height reads">3D</button></span>
    <button data-a="reset" title="forget this song's layout — back to the solved stage">⟲<i> RESET LAYOUT</i></button>
    <button data-a="done" class="done" title="leave stage edit (Esc)">✓<i> DONE</i></button></span>`;
  document.body.appendChild(bar);
  const hintEl = bar.querySelector('.se-hint');
  bar.addEventListener('click', e => {
    const b = e.target.closest('button'), a = b?.dataset.a;
    if (!a) return;
    if (a === 'undo') host.undo();                     // (the selection stays: a height step comes back live, under it)
    else if (a === 'redo') host.redo?.();
    else if (a === 'snap'){ snapOn = !snapOn; b.classList.toggle('on', snapOn); }
    else if (a === 'plan') setView('plan');
    else if (a === '3d') setView('3d');
    else if (a === 'reset'){ select(null); host.resetLayout(); }
    else if (a === 'done') toggle(false);
    if (e.detail) b.blur();                             // (a pointer click: Space stays the transport's)
  });

  /* ---- DOM: the selection DOCK (under the stage) — who it is, turn, height ---- */
  const dock = document.createElement('div'); dock.className = 'se-dock'; dock.hidden = true;
  dock.innerHTML = `<span class="sd-name"><i></i><b></b><em class="sd-loft"></em></span><span class="sd-why"></span>
    <span class="sd-h">
      <button data-a="down" class="sd-step" title="lower it ½ u ≈ 34 cm (PgDn or [ · Shift: 2 u)" aria-label="lower">▼<i> LOWER</i></button>
      <span class="sd-read" aria-live="polite"><b></b><i></i></span>
      <button data-a="up" class="sd-step" title="raise it ½ u ≈ 34 cm (PgUp or ] · Shift: 2 u)" aria-label="raise">▲<i> RAISE</i></button>
    </span>
    <span class="sd-more"><button data-a="floor" title="set it down on the floor (Home)">FLOOR</button><button data-a="auto" title="let the stage decide its height">AUTO</button></span>
    <span class="sd-turn"><button data-a="ccw" title="turn left 15° (Q · Shift: 5°)" aria-label="turn left">↺</button><button data-a="cw" title="turn right 15° (E · Shift: 5°)" aria-label="turn right">↻</button></span>
`;
  document.body.appendChild(dock);
  const D = {
    name: dock.querySelector('.sd-name b'), dot: dock.querySelector('.sd-name i'), val: dock.querySelector('.sd-read b'), band: dock.querySelector('.sd-read i'),
    loft: dock.querySelector('.sd-loft'), why: dock.querySelector('.sd-why'),
    up: dock.querySelector('[data-a=up]'), down: dock.querySelector('[data-a=down]'), floor: dock.querySelector('[data-a=floor]'), auto: dock.querySelector('[data-a=auto]'),
    ccw: dock.querySelector('[data-a=ccw]'), cw: dock.querySelector('[data-a=cw]'),
  };
  const readEl = dock.querySelector('.sd-read');
  dock.addEventListener('click', e => {
    const b = e.target.closest('button'), a = b?.dataset.a;
    if (!a || !sel) return;
    if (a === 'up' || a === 'down') liftStep(a === 'up' ? 1 : -1, e.shiftKey);
    else if (a === 'floor') liftSet(0);
    else if (a === 'auto') liftAuto();
    else if (a === 'ccw' || a === 'cw') turn(a === 'ccw' ? -1 : 1, e.shiftKey);
    if (e.detail) b.blur();
  });

  /* ---- DOM: the HEIGHT handle on the screen — the pole + its metre scale (SVG), the knob, the readout
     chip beside it, and the first-time hint ---- */
  const SVG = 'http://www.w3.org/2000/svg';
  const poleSvg = document.createElementNS(SVG, 'svg'); poleSvg.setAttribute('class', 'se-pole'); poleSvg.style.display = 'none';
  poleSvg.innerHTML = '<path class="sp-rail"/><path class="sp-run"/><path class="sp-ticks"/><path class="sp-major"/><g class="sp-lab"><text/><text/><text/></g>';
  document.body.appendChild(poleSvg);
  const P = { rail: poleSvg.querySelector('.sp-rail'), run: poleSvg.querySelector('.sp-run'), ticks: poleSvg.querySelector('.sp-ticks'),
              major: poleSvg.querySelector('.sp-major'), labs: [...poleSvg.querySelectorAll('.sp-lab text')] };
  const knobEl = document.createElement('div'); knobEl.className = 'se-knob'; knobEl.hidden = true;
  knobEl.setAttribute('role', 'slider'); knobEl.setAttribute('aria-label', 'height: drag up or down');
  knobEl.setAttribute('aria-orientation', 'vertical'); knobEl.setAttribute('aria-valuemin', '0'); knobEl.tabIndex = 0;
  knobEl.innerHTML = '<span>▲</span><span>▼</span>';
  const chipEl = document.createElement('div'); chipEl.className = 'se-chip'; chipEl.hidden = true;
  chipEl.innerHTML = '<b></b><i></i><em></em>';
  const tipEl = document.createElement('div'); tipEl.className = 'se-tip'; tipEl.hidden = true;
  tipEl.innerHTML = '<span></span><button aria-label="got it" title="got it">×</button>';
  // the MAGNET chip: over a hung machine while it is dragged — does it re-hang from the belt, or stand here
  const magEl = document.createElement('div'); magEl.className = 'se-chip se-mag'; magEl.hidden = true;
  magEl.innerHTML = '<b></b><i></i>';
  const mag = { val: magEl.querySelector('b'), sub: magEl.querySelector('i'), sig: '' };
  document.body.append(knobEl, chipEl, tipEl, magEl);
  const chip = { val: chipEl.querySelector('b'), band: chipEl.querySelector('i'), loft: chipEl.querySelector('em') };
  let tipSeen = (() => { try { return store?.getItem(HINT_KEY) === '1'; } catch (e){ return false; } })();
  const learned = () => { tipEl.hidden = true; if (tipSeen) return; tipSeen = true; try { store?.setItem(HINT_KEY, '1'); } catch (e){} };
  tipEl.querySelector('button').addEventListener('click', learned);

  /* ---- the pieces: every movable machine, its pivot + measured footprint ---- */
  /* measure every machine's LOCAL box now (main calls this right after a build: the count-in pose,
     the pose the room solve measured) — never re-measured live, so animated parts can't jitter it */
  function measureAll(){
    local.clear();
    for (const p of host.pieces()) local.set(p.key, measureLocal(p));
  }
  function refresh({ reset = false } = {}){
    const keep = reset ? null : sel?.key;
    if (reset){ endDrag(false); hover = null; info = null; }
    if (on) haze(true);
    for (const p of pieces){ gizmo.remove(p.line, p.fill); p.line.geometry.dispose(); p.el.remove(); }
    pieces = host.pieces().map(p => {
      const line = tag(new THREE.Line(rectGeo(), lineMat(C.idle, .8))), fill = tag(new THREE.Mesh(unitPlane, fillMat(C.idle, .06)));
      gizmo.add(line, fill);
      const el = document.createElement('span'); el.className = 'se-tag'; el.textContent = p.label;
      el.appendChild(document.createElement('i'));     // (its height, once it's off the floor: the plan view can't show it)
      el.style.setProperty('--c', p.color || '#cfd6e6'); tagsEl.appendChild(el);
      const piece = { ...p, line, fill, el, bad: [] };
      measure(piece);
      return piece;
    });
    const wb = host.wall();
    if (wb && !wb.isEmpty()){ setRect(beltLine, beltFill, boxCorners([wb.min.x, wb.max.x, wb.min.z, wb.max.z]), FLOOR_Y + .04); beltLine.visible = beltFill.visible = true; }
    else beltLine.visible = beltFill.visible = false;
    sel = pieces.find(p => p.key === keep) || null;
    if (sel) info = null;
    check(); paint();
  }
  const pivotOf = p => p.kind === 'kit' ? host.kitPivot() : { x: p.obj.position.x, z: p.obj.position.z };
  /* its HEIGHT now (main's anchors — live while a lift runs): { lift, user, deck, bottom, top, floor, ceil, open } */
  const H = p => host.height?.(p.key, p.hNow || (p.hNow = {})) || null;   // (filled in place: no garbage per frame)
  const deckOf = p => H(p)?.deck ?? p.deckY ?? p.obj.position.y;
  // the world y it STANDS on (its support's top) — a HANGING machine's footprint lies on the floor under it, like
  // the belt's (the plan view looks down from under the ceiling: up at its deck it would be over the lens)
  const baseOf = p => p.hung ? FLOOR_Y - .02 : H(p)?.bottom ?? deckOf(p);
  const tagY = p => p.hung ? baseOf(p) + 1.4 : topOf(p) + .8;   // (its name tag: over its floor footprint, for a hung one)
  const topOf = p => p.top + (deckOf(p) - (p.deck0 ?? deckOf(p)));   // (measured once; a lift moves it rigidly)
  const yawOf = p => p.canRotate ? p.obj.rotation.y : 0;
  const liftable = p => !!(p && host.height && host.liftLive && H(p));
  /* the machine's box in its OWN frame: un-turned for the measurement, then restored */
  function measureLocal(p){
    const yaw = p.obj.rotation.y, turned = p.canRotate && Math.abs(yaw) > 1e-9;
    if (turned){ p.obj.rotation.y = 0; p.obj.updateMatrixWorld(true); }
    const b = host.visBox(p.obj), c = pivotOf(p), deck0 = deckOf(p);
    if (turned){ p.obj.rotation.y = yaw; p.obj.updateMatrixWorld(true); }
    return { rel: b.isEmpty() ? [-1, 1, -1, 1] : [b.min.x - c.x, b.max.x - c.x, b.min.z - c.z, b.max.z - c.z],
             top: b.isEmpty() ? deck0 + 3 : Math.min(b.max.y, deck0 + 14), deck0 };
  }
  function measure(p){ const m = local.get(p.key) || measureLocal(p); local.set(p.key, m); p.rel = m.rel; p.top = m.top; p.deck0 = m.deck0; }
  /** the piece's footprint where it stands now: 4 world XZ corners, turned with it */
  const fpOf = p => { const c = pivotOf(p); return footprint(p.rel, c.x, c.z, yawOf(p)); };
  const wallBox = () => { const wb = host.wall(); return wb && !wb.isEmpty() ? [wb.min.x, wb.max.x, wb.min.z, wb.max.z] : null; };
  /* a HUNG machine (rehang: born hung) re-hangs where it is now: over the belt's top, or on the spot it hangs
     at (placement.js rehangs — the magnet) */
  const hangsAt = p => !!p?.rehang && rehangs(pivotOf(p), wallBox(), host.hangHome?.(p.key) || null);
  const moving = p => !!drag && drag.piece === p && drag.mode === 'move';
  /* overhead: a machine hanging now (and staying hung) — nothing conflicts with it, it conflicts with nothing */
  const overhead = p => !!p.rehang && (p.hung ? !moving(p) || hangsAt(p) : moving(p) && hangsAt(p));
  function check(){
    const wall = wallBox(), floor = pieces.filter(o => !o.hung);
    for (const p of pieces) p.bad = overhead(p) ? [] : conflicts(fpOf(p), floor.filter(o => o !== p).map(o => ({ key: o.key, box: fpOf(o) })), wall, host.room);
  }
  function paint(){
    for (const p of pieces){
      const bad = p.bad.length > 0, isSel = p === sel, isHov = p === hover && !isSel, magnet = moving(p) && hangsAt(p);
      const col = bad ? C.bad : magnet ? C.hang : isSel ? C.sel : isHov ? C.hover : C.idle;
      p.line.material.color.setHex(col); p.line.material.opacity = isSel || bad ? 1 : isHov ? .9 : .6;
      // (the 3/4 view looks THROUGH the selection's footprint at the machine: a lighter fill there)
      p.fill.material.color.setHex(col); p.fill.material.opacity = isSel ? (view === '3d' ? .05 : .16) : bad ? .14 : isHov ? .1 : .05;
      setRect(p.line, p.fill, fpOf(p), baseOf(p) + .06, yawOf(p));
      p.el.classList.toggle('sel', isSel); p.el.classList.toggle('bad', bad); p.el.classList.toggle('hov', isHov);
      const h = H(p), up = h && h.lift > .05 ? `▲ ${fmtMeters(h.lift)}` : '';
      if (p.el.lastChild.textContent !== up){ p.el.lastChild.textContent = up; p.tagW = 0; }
    }
    const s = sel;
    ring.visible = knob.visible = knobArrow.visible = !!(s && s.canRotate) && drag?.mode !== 'lift';   // (no turning while it rises)
    if (s && s.canRotate){
      const c = pivotOf(s), r = Math.max(Math.hypot(s.rel[0], s.rel[2]), Math.hypot(s.rel[1], s.rel[3]), 3) * .82 + 1.2, y = deckOf(s) + .1, yaw = s.obj.rotation.y;
      ring.position.set(c.x, y, c.z); ring.scale.setScalar(r);
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      knob.position.set(c.x + fx * r, y, c.z + fz * r);
      const kp = knobArrow.geometry.attributes.position;
      [[0, 0], [fx * r * .62, fz * r * .62], [fx * r * .62, fz * r * .62], [fx * r * .62, fz * r * .62], [fx * r * .62, fz * r * .62]].forEach(([dx, dz], i) => kp.setXYZ(i, c.x + dx, y, c.z + dz));
      kp.needsUpdate = true; knobArrow.geometry.computeBoundingSphere();
    }
    // (the belt's outline lights up while a hung machine is held over its magnet)
    beltLine.material.opacity = drag?.piece?.rehang && moving(drag.piece) && hangsAt(drag.piece) ? 1 : .55;
    beltFill.material.opacity = beltLine.material.opacity > .6 ? .16 : .07;
    paintHeight(true);
    paintDock();
    paintMagnet();
    hint();
  }
  /* the MAGNET chip, over a hung machine while it is dragged: HANGS FROM THE BELT (release: it hangs as built)
     or STANDS HERE (release: the room builds its support under it) — redrawn per frame from update */
  function paintMagnet(){
    const p = drag?.piece;
    if (!on || !p?.rehang || !moving(p)){ if (!magEl.hidden) magEl.hidden = true; return; }
    const back = hangsAt(p), bad = p.bad.length > 0;
    const up = p.hung ? host.unhangLift?.(p.key) : H(p)?.lift;
    const sig = `${back}|${bad}|${p.hung}|${up}`;
    if (sig !== mag.sig){
      mag.sig = sig;
      mag.val.textContent = back ? 'HANGS FROM THE BELT' : 'STANDS HERE';
      mag.sub.textContent = back ? (p.hung ? 'RELEASE · IT STAYS HUNG' : 'RELEASE · IT HANGS AS BUILT')
        : bad ? 'NOT HERE · ' + describeConflicts(p.bad, k => pieces.find(q => q.key === k)?.label || k).toUpperCase()
        : p.hung ? `RELEASE · ON SUPPORTS${Number.isFinite(up) && up > .05 ? ` · ${fmtMeters(up)} UP` : ''}`
        : 'DROP ON THE BELT TO HANG IT';
      magEl.classList.toggle('hang', back); magEl.classList.toggle('bad', !back && bad);
      mag.w = 0;                                            // (its width changes with the words: re-measured)
    }
    const c = pivotOf(p);
    proj(c.x, p.hung ? tagY(p) + 1 : topOf(p) + 1.2, c.z, _m);
    if (_m.behind){ magEl.hidden = true; return; }
    magEl.hidden = false;
    // (over the machine; never under the bar or off the screen's edge — under the footprint instead, then)
    const W = innerWidth, mw = (mag.w ||= magEl.offsetWidth || 220) / 2 + 8, mh = (mag.h ||= magEl.offsetHeight || 40);
    const br = bar.hidden ? null : bar.getBoundingClientRect(), top = (br && br.top < innerHeight / 2 ? br.bottom : 0) + 8 + mh;
    const x = Math.max(mw, Math.min(W - mw, _m.x)), y = Math.min(innerHeight - 8, Math.max(top, _m.y - 30));
    magEl.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
  const _m = {};
  /* a machine standing on the floor right behind the belt (FLOOR on a gallery machine leaves it there): the
     belt's wall hides it from every seat — the hint says so (the user's word stands; nothing moves it) */
  function hidden(p){
    const w = wallBox(), h = liftable(p) ? H(p) : null;
    if (!w || !h || h.lift > .05) return false;
    const [x0, x1, z0, z1] = bounds(fpOf(p));
    return z1 <= w[2] + .5 && x0 >= w[0] - .5 && x1 <= w[1] + .5;
  }
  function hint(){
    if (!sel){ hintEl.textContent = pieces.length ? 'click a machine to pick it up · drag empty space to orbit' : 'nothing to move — this song has only the belt'; hintEl.className = 'se-hint'; return; }
    const bad = describeConflicts(sel.bad, k => pieces.find(p => p.key === k)?.label || k);
    const turnHint = coarse() ? ' · the ring turns it' : ' · Q / E or the ring to turn';   // (no keys on a phone)
    hintEl.textContent = bad ? `${sel.label}: ${bad}` : moving(sel) && sel.rehang ? (hangsAt(sel) ? `${sel.label} · release to hang it from the belt` : `${sel.label} · release to stand it here`)
      : sel.hung ? `${sel.label} · hangs from the belt — drag it off to stand it in the room`
      : hidden(sel) ? `${sel.label} · hidden behind the belt — drag it forward or ▲ raise it`
      : `${sel.label} · drag to move${sel.canRotate ? turnHint : ''}${liftable(sel) ? ' · ▲▼ height' : ''}${sel.rehang ? ' · onto the belt: re-hang' : ''}`;
    hintEl.className = 'se-hint' + (bad ? ' bad' : '');
  }

  /* ---- HEIGHT: what the handle shows ---- */
  const labelOf = k => pieces.find(p => p.key === k)?.label || host.fixed?.().find(f => f.key === k)?.label || k;
  /* the selection's readout: its lift in metres, the band its support takes, its LOFT mates (the plan's) */
  function readoutOf(p){
    const h = H(p); if (!h) return null;
    const plan = host.footing?.(), pad = plan?.pads?.find(q => q.key === p.key);
    const L = pad?.loft ? plan.lofts.find(l => l.id === pad.loft) : null;
    const r = readout({ lift: h.lift, user: h.user, h: pad ? pad.h : h.bottom - h.floor, loft: L ? L.keys.filter(k => k !== p.key).map(labelOf) : [] });
    r.max = maxOf(p, h); r.atMax = h.lift >= r.max - 1e-6; r.lift = h.lift;
    return r;
  }
  const maxOf = (p, h = H(p)) => liftMax({ lift: h.lift, top: topOf(p), ceil: h.ceil });
  /* neighbours whose deck this one can share (a LOFT): the lift that levels it with each */
  function targetsOf(p, h = H(p)){
    if (h.open) return [];                              // (an open stand stands on posts: the planner never lofts it)
    const others = [];
    for (const o of pieces){
      if (o === p) continue;
      const g = H(o); if (!g) continue;
      others.push({ key: o.key, label: o.label, top: g.bottom, box: bounds(fpOf(o)), raised: bandName(g.bottom - g.floor).band !== 'flush', open: g.open });
    }
    return loftTargets({ bottom0: h.bottom - h.lift, box: bounds(fpOf(p)) }, others);
  }
  /* the POLE stands just outside one of the footprint's corners: one whose KNOB lands in the screen's free
     band (under the bar, over the dock — never under the UI), and of those the nearest the eye. It is kept
     while a lift runs, and moves to another corner only when that one is clearly better (in the band where
     this one isn't, or clearly nearer) — no flicker as the eye orbits */
  const _pc = [{}, {}, {}, {}], _ps = {};
  function poleOf(p){
    const fp = fpOf(p), e = cam.camera.position, y = H(p)?.bottom ?? baseOf(p), B = bandPx || freeBand();
    const cx = (fp[0][0] + fp[1][0] + fp[2][0] + fp[3][0]) / 4, cz = (fp[0][1] + fp[1][1] + fp[2][1] + fp[3][1]) / 4;
    for (let i = 0; i < 4; i++){
      const q = fp[i], dx = q[0] - cx, dz = q[1] - cz, L = Math.hypot(dx, dz) || 1, c = _pc[i];
      c.x = q[0] + dx / L * .9; c.z = q[1] + dz / L * .9; c.d = Math.hypot(q[0] - e.x, q[1] - e.z);
      proj(c.x, y, c.z, _ps);
      c.inb = !_ps.behind && _ps.x > B.x0 && _ps.x < B.x1 && _ps.y > B.y0 && _ps.y < B.y1;
    }
    const better = (i, j) => _pc[i].inb !== _pc[j].inb ? _pc[i].inb : _pc[i].d < _pc[j].d;
    let best = 0;
    for (let i = 1; i < 4; i++) if (better(i, best)) best = i;
    const keepI = p.poleI ?? best, locked = drag && drag.mode === 'lift' && drag.piece === p;
    if (!locked && (_pc[best].inb && !_pc[keepI].inb || _pc[best].inb === _pc[keepI].inb && _pc[best].d < _pc[keepI].d * .88)) p.poleI = best;
    else p.poleI = keepI;
    const c = _pc[p.poleI];
    return { x: c.x, z: c.z, inb: c.inb };
  }
  /* the screen's free band, in CSS px: under the bar, over the dock, in from the sides (read once a frame) */
  let bandPx = null;
  function freeBand(){
    const W = innerWidth, H0 = innerHeight, br = bar.hidden ? null : bar.getBoundingClientRect(), dr = dock.hidden ? null : dock.getBoundingClientRect();
    return { x0: 28, x1: W - 28, y0: (br && br.top < H0 / 2 ? br.bottom : 0) + 30, y1: (dr && dr.height ? dr.top : H0 - 40) - 30 };
  }
  const _q = new THREE.Vector3();
  let domR = null;                                      // (the canvas rect: read once per draw — never between DOM writes)
  /* a world point → CSS px (behind: the eye's back) */
  function proj(x, y, z, out = {}){
    _q.set(x, y, z).project(cam.camera);
    const r = domR || dom.getBoundingClientRect();
    out.x = r.left + (_q.x + 1) / 2 * r.width; out.y = r.top + (1 - _q.y) / 2 * r.height; out.behind = _q.z > 1;
    return out;
  }
  const _a = {}, _b = {}, _t = {}, _k = {};
  let lastRead = null, readSig = null, shown = false, knobIn = true;
  const unread = () => { lastRead = null; readSig = null; };
  /* has anything the handle is drawn from changed since it was drawn (the eye, the lens, the viewport,
     the machine's height + spot, the drag, the hint) — a still frame costs nothing */
  const sigNow = new Float64Array(27), sigLast = new Float64Array(27);
  let sigSel = null;
  function stale(p, h){
    const m = cam.camera.matrixWorld.elements, q = cam.camera.projectionMatrix.elements;
    for (let i = 0; i < 16; i++) sigNow[i] = m[i];
    sigNow[16] = q[0]; sigNow[17] = q[5]; sigNow[18] = h.bottom; sigNow[19] = h.lift; sigNow[20] = innerWidth; sigNow[21] = innerHeight;
    sigNow[22] = drag && drag.mode === 'lift' ? (drag.touch ? 2 : 1) : 0; sigNow[23] = tipEl.hidden ? 0 : 1;
    sigNow[24] = p.obj.position.x; sigNow[25] = p.obj.position.z; sigNow[26] = p.obj.rotation.y;
    let same = sigSel === p;
    for (let i = 0; i < 27 && same; i++) if (sigNow[i] !== sigLast[i]) same = false;
    if (same) return false;
    sigLast.set(sigNow); sigSel = p;
    return true;
  }
  function showHandle(v){
    if (v === shown) return;
    shown = v;
    knobEl.hidden = chipEl.hidden = !v;
    poleSvg.style.display = v ? '' : 'none';
    if (!v){ shadow.visible = shadowLine.visible = drops.visible = false; tipEl.hidden = true; keepOut.fill(NaN, 0, 8); }
  }
  /* the readout, re-read only when the machine's height, the user's word or the footing plan changed */
  function syncRead(p, h){
    const plan = host.footing?.();
    if (readSig && readSig.p === p && readSig.lift === h.lift && readSig.user === h.user && readSig.bottom === h.bottom && readSig.plan === plan) return;
    readSig = { p, lift: h.lift, user: h.user, bottom: h.bottom, plan };
    const r = readoutOf(p);
    if (r) setRead(r);
  }
  /* the handle, while a machine is selected (redrawn only when something it shows changed): shadow + drops
     in the world, pole + knob on the screen */
  function paintHeight(force = false){
    const p = sel, h = p && on ? H(p) : null;
    if (!h || !liftable(p)){ showHandle(false); sigSel = null; return; }
    syncRead(p, h);
    if (!stale(p, h) && !force) return;              // (stale() records what this draw is of)
    const fp = fpOf(p), base = h.bottom, zero = h.bottom - h.lift, F = h.floor + .03, up = base - h.floor > .25;
    // the shadow: its footprint on the floor (only once it's off the floor — on it, the plinth covers it)
    shadow.visible = shadowLine.visible = h.lift > .05;
    setRect(shadowLine, shadow, fp, F, yawOf(p));
    // drop lines: footprint corner (at its base) → the floor
    const dp = dropGeo.attributes.position;
    const ld = dropGeo.attributes.lineDistance;
    for (let i = 0; i < 4; i++){ const [x, z] = fp[i]; dp.setXYZ(i * 2, x, base + .04, z); dp.setXYZ(i * 2 + 1, x, F, z); ld.setX(i * 2, 0); ld.setX(i * 2 + 1, Math.abs(base + .04 - F)); }
    dp.needsUpdate = true; ld.needsUpdate = true; dropGeo.computeBoundingSphere();
    drops.visible = up && h.lift > .05;
    // the pole: floor → a little above where it stands; the scale from its lift-0 height, a tick a metre
    const at = poleOf(p), top = Math.max(base, zero) + 2.6;
    domR = dom.getBoundingClientRect();
    proj(at.x, h.floor, at.z, _a); proj(at.x, top, at.z, _b);
    if (_a.behind || _b.behind){ domR = null; showHandle(false); return; }
    showHandle(true);
    let ux = _b.x - _a.x, uy = _b.y - _a.y; const ul = Math.hypot(ux, uy);
    if (ul < 4){ ux = 0; uy = -1; } else { ux /= ul; uy /= ul; }
    const nx = -uy, ny = ux;                          // (the ticks run across the pole on the screen)
    P.rail.setAttribute('d', `M${_a.x.toFixed(1)} ${_a.y.toFixed(1)}L${_b.x.toFixed(1)} ${_b.y.toFixed(1)}`);
    proj(at.x, zero, at.z, _t); proj(at.x, base, at.z, _k);
    P.run.setAttribute('d', h.lift > .05 ? `M${_t.x.toFixed(1)} ${_t.y.toFixed(1)}L${_k.x.toFixed(1)} ${_k.y.toFixed(1)}` : '');
    let minor = '', major = '', li = 0;
    const off = labOff();
    for (let k = 0; zero + k * TICK_U <= top + 1e-6 && k < 60; k++){
      proj(at.x, zero + k * TICK_U, at.z, _t);
      const big = k % 5 === 0, w = big ? 9 : 5;
      const s = `M${(_t.x - nx * w).toFixed(1)} ${(_t.y - ny * w).toFixed(1)}L${(_t.x + nx * w).toFixed(1)} ${(_t.y + ny * w).toFixed(1)}`;
      if (big) major += s; else minor += s;
      if (big && k > 0 && li < P.labs.length){
        const T = P.labs[li++];                          // (clear of the knob when it stands on that tick)
        T.setAttribute('x', (_t.x + nx * off).toFixed(1)); T.setAttribute('y', (_t.y + ny * off + 3).toFixed(1));
        T.setAttribute('text-anchor', nx < 0 ? 'end' : 'start'); T.textContent = `${k} m`; T.style.display = '';
      }
    }
    for (; li < P.labs.length; li++) P.labs[li].style.display = 'none';
    P.ticks.setAttribute('d', minor); P.major.setAttribute('d', major);
    domR = null;
    // the knob, where it stands; the readout beside it (away from the screen edge; above a finger; inside
    // the free band — never under the bar or the dock). In the PLAN the dock + the tags say the height.
    knobEl.style.transform = `translate(${_k.x.toFixed(1)}px, ${_k.y.toFixed(1)}px) translate(-50%, -50%)`;
    const kw = (knobW || 30) / 2 + 6, kh = (knobH ||= knobEl.offsetHeight || 40) / 2 + 6;
    keepOut[0] = _k.x - kw; keepOut[1] = _k.y - kh; keepOut[2] = _k.x + kw; keepOut[3] = _k.y + kh;
    const B = bandPx || freeBand();
    knobIn = !_k.behind && _k.x > B.x0 - 20 && _k.x < B.x1 + 20 && _k.y > B.y0 - 24 && _k.y < B.y1 + 24;
    chipEl.classList.toggle('plan', view === 'plan');
    const W = innerWidth, right = _k.x < W - 190, touchDrag = drag?.mode === 'lift' && drag.touch;
    const cy = Math.max(B.y0 - 10, Math.min(B.y1 + 10, touchDrag ? _k.y - 74 : _k.y));
    chipEl.classList.toggle('left', !right);
    chipEl.style.transform = `translate(${(_k.x + (right ? 26 : -26)).toFixed(1)}px, ${cy.toFixed(1)}px) translate(${right ? '0' : '-100%'}, -50%)`;
    if (!tipSeen && !tipEl.hidden){                 // (under the chip — over it when the knob is low: the dock is there)
      const low = cy > innerHeight * .62;
      const tx = _k.x + (right ? 26 : -26), ty = low ? cy - 30 : cy + 30;
      tipEl.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) translate(${right ? '0' : '-100%'}, ${low ? '-100%' : '0'})`;
      keepOut[4] = right ? tx : tx - tipW; keepOut[5] = low ? ty - tipH : ty; keepOut[6] = keepOut[4] + tipW; keepOut[7] = keepOut[5] + tipH;
    } else keepOut[4] = keepOut[6] = NaN;
  }
  let knobW = 0, knobH = 0, tipW = 0, tipH = 0;
  /* where the handle sits on the screen (CSS px: [x0, y0, x1, y1] — the knob, the first-time tip, the selection's
     own tag, the top bar; NaN = none): a name tag steps out of its way (update) */
  const keepOut = new Float64Array(16).fill(NaN);
  const labOff = () => (knobW ||= knobEl.offsetWidth) ? knobW / 2 + 9 : 24;   // (the knob's width, measured once it shows)
  /* the readout, written only when it changes (the chip + the dock) */
  function setRead(r){
    const key = `${r.value}|${r.name}|${r.loft}|${r.auto}|${r.atMax}|${sel?.key}|${r.lift}`;
    if (key === lastRead) return;
    lastRead = key;
    chip.val.textContent = r.value; chip.band.textContent = r.floor ? '' : r.name + (r.auto ? ' · AUTO' : '');
    chip.loft.textContent = r.loft; chipEl.classList.toggle('loft', !!r.loft);
    // (on the floor the value says so: the band line only says whose word it is — next to a FLOOR button)
    D.val.textContent = r.value; D.band.textContent = r.floor ? (r.auto ? 'AUTO' : '') : r.name + (r.auto ? ' · AUTO' : '') + (r.atMax ? ' · MAX' : '');
    D.loft.textContent = r.loft; dock.classList.toggle('loft', !!r.loft);
    D.up.disabled = r.atMax; D.down.disabled = r.floor; D.floor.disabled = r.floor && !r.auto; D.auto.disabled = r.auto;
    D.up.title = r.atMax ? `as high as it goes (${fmtMeters(r.max)} — ${r.max < 23.99 ? 'the ceiling' : 'the tallest tower'})` : 'raise it ½ u ≈ 34 cm (PgUp or ] · Shift: 2 u)';
    knobEl.setAttribute('aria-valuetext', `${r.value} ${r.floor ? '' : r.name}`.trim());
    knobEl.setAttribute('aria-valuenow', (+r.lift.toFixed(2)).toString()); knobEl.setAttribute('aria-valuemax', (+r.max.toFixed(2)).toString());
  }
  /* the dock: the selection's name + controls — or, for a machine that can't move, why */
  function paintDock(){
    const p = sel;
    dock.hidden = !on || (!p && !info);
    if (dock.hidden) return;
    if (!p){
      dock.classList.add('fixed'); D.name.textContent = info.label; dock.style.setProperty('--c', info.color || '#cfd6e6');
      D.why.textContent = info.why; return;
    }
    dock.classList.remove('fixed'); D.why.textContent = p.hung ? 'hangs from the belt · drag it off to stand it' : '';
    dock.classList.toggle('hungsel', !!p.hung);
    D.name.textContent = p.label; dock.style.setProperty('--c', p.color || '#cfd6e6');
    D.ccw.disabled = D.cw.disabled = !p.canRotate;
    D.ccw.title = p.canRotate ? 'turn left 15° (Q · Shift: 5°)' : p.hung ? `${p.label} hangs as built — drag it off the belt to turn it` : `${p.label} faces the audience — it moves, it doesn't turn`;
    D.cw.title = p.canRotate ? 'turn right 15° (E · Shift: 5°)' : D.ccw.title;
    const lift = liftable(p);
    dock.classList.toggle('nolift', !lift);
    if (!lift){ D.val.textContent = ''; D.band.textContent = ''; D.loft.textContent = ''; unread(); }
  }

  /* ---- pointer: pick, drag, turn ---- */
  function rayAt(e){ rayAtXY(e.clientX, e.clientY); }
  let rayAtY = 0;
  function rayAtXY(x, y){
    rayAtY = y;
    const r = dom.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam.camera);
  }
  function pick(){
    if (sel?.canRotate && knob.visible && ray.intersectObject(knob, false).length) return { piece: sel, knob: true };
    let best = null;
    if (sel){                                           // the selection wins where it overlaps a neighbour (drag it back out)
      const h = ray.intersectObject(sel.obj, true).find(i => (i.object.isMesh || i.object.isInstancedMesh) && drawn(i.object, sel.obj));
      if (h) return { piece: sel, d: h.distance, point: h.point };
    }
    for (const p of pieces){
      const h = ray.intersectObject(p.obj, true).find(i => (i.object.isMesh || i.object.isInstancedMesh) && drawn(i.object, p.obj));
      if (h && (!best || h.distance < best.d)) best = { piece: p, d: h.distance, point: h.point };
    }
    if (best) return best;
    for (const p of pieces){                            // …or its footprint where it stands
      plane.set(_v.set(0, 1, 0), -(baseOf(p) + .06));
      const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (hit && inPoly([hit.x, hit.z], fpOf(p))){
        const d = hit.distanceTo(ray.ray.origin);
        if (!best || d < best.d) best = { piece: p, d, point: hit };
      }
    }
    return best;
  }
  /* what can't move — the belt, a hung station — picked only on a CLICK (a press there still orbits) */
  function pickFixed(){
    let best = null;
    for (const f of host.fixed?.() || []){
      let d = null;
      if (f.obj){ const h = ray.intersectObject(f.obj, true).find(i => (i.object.isMesh || i.object.isInstancedMesh) && drawn(i.object, f.obj)); if (h) d = h.distance; }
      if (d === null && f.box && !f.box.isEmpty()){ const h = ray.ray.intersectBox(f.box, _v); if (h) d = h.distanceTo(ray.ray.origin); }
      if (d !== null && (!best || d < best.d)) best = { f, d };
    }
    return best?.f || null;
  }
  const drawn = (o, root) => { for (let q = o; q; q = q.parent){ if (!q.visible) return false; if (q === root) return true; } return true; };

  let downAt = null, pendingHover = null;
  function hoverPick(){
    const e = pendingHover; pendingHover = null;
    rayAt(e);
    const h = pick(), next = h?.piece || null;
    dom.style.cursor = h ? (h.knob ? 'alias' : 'grab') : '';
    if (next !== hover){ hover = next; paint(); }
  }
  addEventListener('pointerdown', e => {
    if (!on || e.target !== dom || e.button > 0) return;
    if (drag){
      // ONE gesture at a time: a second finger mid-drag is neither a new gesture nor the orbit's (it would
      // swing the eye under the first). (A mouse has one pointer: a drag still open is a lost release.)
      if (e.pointerType !== 'mouse' && e.pointerId !== drag.id){ cam.orbit.enabled = false; return; }
      endDrag(true);
    }
    rayAt(e);
    const hit = pick();
    const fresh = hit && hit.piece !== sel;              // (a different machine picked: the 3/4 view may re-frame it)
    downAt = { x: e.clientX, y: e.clientY, hit: !!hit, fresh };
    if (!hit){ ease = null; return; }                    // empty space: the orbit has it (and stops any glide)
    settle.flush();                                     // (a burst of height taps settles before a new gesture)
    cam.orbit.enabled = false;                          // this press is ours (OrbitControls checks at pointerdown)
    ease = null;
    select(hit.piece);
    const p = hit.piece, c = pivotOf(p);
    const y = hit.knob ? deckOf(p) + .1 : p.hung ? baseOf(p) + .06 : THREE.MathUtils.clamp(hit.point.y, deckOf(p) - 2, deckOf(p) + 12);   // (a hung one: dragged by its floor footprint)
    plane.set(_v.set(0, 1, 0), -y);
    const at = ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!at) return;
    drag = { piece: p, mode: hit.knob ? 'turn' : 'move', y, at0: at, c0: { ...c }, yaw0: p.obj.rotation.y, moved: false, id: e.pointerId };
    try { dom.setPointerCapture(e.pointerId); } catch (_){ /* (synthetic events) */ }
    dom.style.cursor = 'grabbing';
  }, { capture: true });
  addEventListener('pointermove', e => {
    if (!on) return;
    if (!drag){                                         // hover: picked once per frame (update), not per event
      pendingHover = e.target === dom && !e.buttons ? { clientX: e.clientX, clientY: e.clientY } : null;
      return;
    }
    if (drag.mode === 'lift'){                          // (the lift itself is applied once per frame: update → liftFrame)
      if (e.pointerId === drag.id){ drag.px = e.clientX; drag.py = e.clientY; drag.free = e.shiftKey || !snapOn; }
      return;
    }
    rayAt(e);
    plane.set(_v.set(0, 1, 0), -drag.y);
    const at = ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!at) return;
    const p = drag.piece, free = e.shiftKey || !snapOn;
    if (drag.mode === 'move'){
      const cx = host.cx();
      let x = drag.c0.x + at.x - drag.at0.x, z = drag.c0.z + at.z - drag.at0.z;
      if (!free){ x = cx + snap(x - cx); z = snap(z); }
      if (Math.abs(x - pivotOf(p).x) + Math.abs(z - pivotOf(p).z) < 1e-6) return;
      setPivot(p, x, z);
    } else {
      const c = pivotOf(p);
      const yaw = Math.atan2(at.x - c.x, at.z - c.z);
      setYaw(p, free ? yaw : snapYaw(yaw));
    }
    drag.moved = true;
    check(); paint();
  }, { capture: true });
  const release = e => {
    if (!on) return;
    if (drag){
      if (drag.mode === 'lift'){ if (e.pointerId === drag.id) endLift(); downAt = null; return; }
      const d = drag; drag = null;
      try { dom.releasePointerCapture(d.id); } catch (_){}
      dom.style.cursor = '';
      if (d.moved) commit(d.piece, d);
      if (d.moved || downAt?.fresh) keepInView();        // (the 3/4 view: the knob back out from under the UI)
    } else if (downAt && !downAt.hit && e.target === dom && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5){   // a click on empty space…
      rayAt(e);
      const f = pickFixed();                            // …or on what can't move: say why
      info = f ? { key: f.key, label: f.label, color: f.color, why: f.why } : null;
      select(null);
    }
    downAt = null;
  };
  addEventListener('pointerup', release, { capture: true });
  addEventListener('pointercancel', release, { capture: true });
  // a capture taken away (the OS, a tab switch) ends the gesture as a release would — a drag never outlives its pointer
  dom.addEventListener('lostpointercapture', e => { if (drag && drag.mode !== 'lift' && e.pointerId === drag.id) release(e); });
  /* end whatever gesture is open — write = keep what it did (a release), else drop it (the world it moved
     is being rebuilt: a song change) */
  function endDrag(write){
    const d = drag; if (!d) return;
    if (d.mode === 'lift'){
      if (write){ endLift(); return; }
      drag = null;
      try { knobEl.releasePointerCapture(d.id); } catch (_){}
      knobEl.classList.remove('drag'); document.body.classList.remove('se-lifting'); readEl.setAttribute('aria-live', 'polite');
      return;
    }
    drag = null;
    try { dom.releasePointerCapture(d.id); } catch (_){}
    dom.style.cursor = '';
    if (write && d.moved) commit(d.piece, d);
    else if (d.moved && d.piece?.rehang) paintMagnet();
  }

  function setPivot(p, x, z){
    if (p.kind === 'kit'){ const k = host.kitPivot(); p.obj.position.x += x - k.x; p.obj.position.z += z - k.z; }
    else { p.obj.position.x = x; p.obj.position.z = z; }
    p.obj.updateMatrixWorld(true);
  }
  function setYaw(p, yaw){
    if (!p.canRotate || Math.abs(yaw - p.obj.rotation.y) < 1e-6) return;
    p.obj.rotation.y = yaw; p.obj.updateMatrixWorld(true);   // (the local box turns with it: nothing to re-measure)
  }
  function turn(dir, free){
    if (!sel) return;
    if (!sel.canRotate){ hintEl.textContent = sel.hung ? `${sel.label} hangs as built — drag it off the belt to turn it` : `${sel.label} faces the audience — it moves, it doesn't turn`; return; }
    settle.flush();
    setYaw(sel, free || !snapOn ? sel.obj.rotation.y + dir * Math.PI / 36 : snapYaw(sel.obj.rotation.y + dir * Math.PI / 12));
    check(); paint();
    const p = sel;
    clearTimeout(turn._t); turn._p = p; turn._t = setTimeout(turnDone, 350);   // a burst of Q/E taps commits once
  }
  function turnDone(){ const p = turn._p; clearTimeout(turn._t); turn._t = turn._p = null; if (p){ commit(p); keepInView(); } }
  // (a hung machine taken down keeps the yaw it hung at — the court is turned to the audience)
  const entryOf = p => { const c = pivotOf(p); return { x: c.x - host.cx(), z: c.z, yaw: p.canRotate || p.rehang ? p.obj.rotation.y : 0 }; };
  // (the first edit pins the room as it stands — every machine on the floor; a hung one keeps hanging: no entry)
  const allNow = () => pieces.filter(q => !q.hung).map(q => ({ key: q.key, ...pivotOf(q), yaw: q.canRotate ? q.obj.rotation.y : 0 }));
  /* a gesture's end (d: the drag, for a move): saved, the room re-anchored. A HUNG machine changes how it is
     BUILT when it crosses the magnet (main rebuilds it, holding songTime): dragged off the belt it stands —
     keeping the height it hung at; dropped back over it (a standing one) its entry goes and it hangs as built;
     a hanging one dropped where it hangs goes back exactly (nothing to save) */
  function commit(p, d = null){
    if (!p) return;
    if (p.rehang && d){
      const back = hangsAt(p);
      if (p.hung && back){ setPivot(p, d.c0.x, d.c0.z); check(); paint(); return; }
      if (p.hung){ host.place(p.key, { ...entryOf(p), lift: host.unhangLift?.(p.key) ?? null }, allNow(), { rebuild: true }); onChange(); return; }
      if (back){ host.rehang(p.key); onChange(); return; }
    }
    host.place(p.key, entryOf(p), allNow());
    onChange();
  }
  function select(p){
    if (p) info = null;
    if (p !== sel){ unread(); if (sel) sel.poleI = null; }
    sel = p;
    if (p && !tipSeen && liftable(p)){ tipEl.hidden = false; tipEl.querySelector('span').textContent = coarse() ? 'drag ▲▼ to raise or lower it' : 'drag ▲▼ to raise · PgUp / PgDn · Home = floor';
      tipW = tipEl.offsetWidth; tipH = tipEl.offsetHeight; }
    else tipEl.hidden = true;
    paint();
  }
  const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  /* ---- HEIGHT: the knob's drag, the keys, the dock's buttons ---- */
  // one UNDO step per gesture: a drag opens it at its first change; a burst of key repeats / taps opens it
  // at the first and SETTLES once it stops (the kit rebuilt at its deck, the director's re-solve)
  const settle = makeSettle(SETTLE_MS);
  knobEl.addEventListener('pointerdown', e => {
    if (!on || !sel || e.button > 0 || drag) return;
    settle.flush(); if (turn._t) turnDone();
    const p = sel, h = H(p);
    if (!h) return;
    drag = { piece: p, mode: 'lift', id: e.pointerId, touch: e.pointerType === 'touch', px: e.clientX, py: e.clientY, lx: e.clientX, ly: e.clientY, gx: e.clientX, gy: e.clientY,
             free: e.shiftKey || !snapOn, y0: null, lift0: h.lift, cur: h.lift, opened: false, at: null, max: maxOf(p, h), targets: targetsOf(p, h),
             magnet: null, hand: false, cs: new Float64Array(20) };
    try { knobEl.setPointerCapture(e.pointerId); } catch (_){}
    knobEl.classList.add('drag'); document.body.classList.add('se-lifting'); readEl.setAttribute('aria-live', 'off');
    learned();
    // a straight-down look hides height: grabbing the knob there eases to the 3/4 view first — framed so
    // the knob lands UNDER THE HAND (the grab pixel), and the drag then anchors the knob to the pointer, so
    // a flick made during the swing still counts (camera never moves once the drag has anchored)
    if (view !== '3d'){ drag.hand = true; setView('3d', { hand: { x: e.clientX, y: e.clientY }, dur: .42 }); }
    else paint();
  });
  // a capture taken away ends the lift as a release would (it never follows a hovering mouse)
  knobEl.addEventListener('lostpointercapture', e => { if (drag && drag.mode === 'lift' && e.pointerId === drag.id) endLift(); });
  // the knob is a slider for a keyboard too (focus it: ↑ / ↓, Shift = 2 u)
  knobEl.addEventListener('keydown', e => {
    if (!on || !sel || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown'){ e.preventDefault(); e.stopPropagation(); liftStep(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey); }
  });
  /* has the eye or the viewport changed since the drag last looked (an orbit's damping glide, a wheel zoom,
     a fly key, a phone's URL bar) — then the drag re-anchors where it is, and the machine doesn't move by itself */
  function camMoved(d){
    const m = cam.camera.matrixWorld.elements, q = cam.camera.projectionMatrix.elements, c = d.cs;
    let ch = false;
    for (let i = 0; i < 16; i++) if (c[i] !== m[i]){ ch = true; c[i] = m[i]; }
    if (c[16] !== q[0] || c[17] !== q[5] || c[18] !== innerWidth || c[19] !== innerHeight){ ch = true; c[16] = q[0]; c[17] = q[5]; c[18] = innerWidth; c[19] = innerHeight; }
    return ch;
  }
  /* once a frame: the pointer → the knob's drag plane → the lift (snapped, magnetic) → the machine */
  function liftFrame(){
    const d = drag;
    if (!d || d.mode !== 'lift' || ease) return;
    if (d.y0 === null){                                 // ANCHOR, where the eye is now (after a swing: where it landed)
      d.at = poleOf(d.piece); d.screen = undefined;     // (the corner: chosen for the eye the swing aimed at — locked now)
      camMoved(d);
      rayAtXY(d.px, d.py);
      const y = dragY(d);
      if (y === null) return;
      d.lift0 = d.cur;
      // after the swing (a PLAN grab) the knob stands under the grab pixel — or below it, leaving headroom
      // (underHand): the drag runs from the GRAB pixel, so the knob follows the pointer's motion and what the
      // pointer did during the swing counts. Grabbed in place (3D): from where the pointer is — no jump
      let y0 = y;
      if (d.hand){ rayAtXY(d.gx, d.gy); const g = dragY(d); if (g !== null) y0 = g; }
      d.y0 = y0;
      d.lx = d.px; d.ly = d.py;
      if (!d.hand) return;
    } else if (camMoved(d)){                            // the eye moved under the drag: re-anchor at the pointer's LAST
      d.screen = undefined;                             //  spot (this frame's own move still counts)
      rayAtXY(d.lx, d.ly);
      const y = dragY(d);
      if (y !== null){ d.y0 = y; d.lift0 = d.cur; }
    }
    rayAtXY(d.px, d.py);
    d.lx = d.px; d.ly = d.py;
    const y = dragY(d);
    if (y === null) return;
    const r = dragLift({ lift0: d.lift0, y0: d.y0, y, max: d.max, free: d.free, targets: d.targets });
    if (Math.abs(r.lift - d.cur) < 1e-6) return;
    if (!d.opened){ host.liftBegin(); d.opened = true; }
    d.cur = r.lift; d.magnet = r.magnet;
    applyLift(d.piece, r.lift);
  }
  /* the pointer's height on the knob's plane: vertical, through the pole, facing the eye — or, when the eye
     looks (nearly) straight down that plane, the screen: the knob's pixels at its depth */
  function dragY(d){
    const e = cam.camera.position;
    if (d.screen === undefined){
      const y = rayPlaneY(ray.ray.origin, ray.ray.direction, d.at, e);
      d.screen = y === null;
      if (d.screen){
        const dist = Math.max(1, Math.hypot(d.at.x - e.x, baseOf(d.piece) - e.y, d.at.z - e.z));
        d.upp = 2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.camera.fov / 2)) / Math.max(1, dom.clientHeight);
      }
      if (!d.screen) return y;
    }
    if (d.screen) return -rayAtY * d.upp;
    return rayPlaneY(ray.ray.origin, ray.ray.direction, d.at, e);
  }
  function endLift(){
    const d = drag; drag = null;
    try { knobEl.releasePointerCapture(d.id); } catch (_){}
    knobEl.classList.remove('drag'); document.body.classList.remove('se-lifting'); readEl.setAttribute('aria-live', 'polite');
    if (!d.opened){ paint(); return; }
    host.liftWrite(d.piece.key, { ...entryOf(d.piece), lift: d.cur }, allNow());
    host.liftSettle();
    onChange(); paint();
    keepInView();
  }
  /* a lift, live: the machine moves rigidly, the room re-anchors + re-plans its supports (the host) */
  let liftMs = [];
  function applyLift(p, u){
    const t0 = performance.now();
    host.liftLive(p.key, u);
    liftMs.push(performance.now() - t0); if (liftMs.length > 120) liftMs.shift();
    check(); paint();
  }
  /* a key / ▲ ▼ tap: a step, live; the burst is one undo step, settled once it stops */
  // (a tap's lift is QUEUED and applied once per frame — update: two key repeats inside one frame re-plan the
  //  room's supports once, from where the second one lands)
  let queued = null;
  const liftNow = p => queued && queued.p === p ? queued.u : H(p).lift;
  function liftStep(dir, big){
    const p = sel; if (!liftable(p) || drag) return;
    const h = H(p), r = stepLift(liftNow(p), dir, { big, max: maxOf(p, h), targets: targetsOf(p, h) });
    liftTap(p, r.lift);
  }
  function liftSet(u){ const p = sel; if (!liftable(p) || drag) return; liftTap(p, u); }
  function liftTap(p, u){
    const h = H(p), mine = queued?.p === p || Number.isFinite(h.user);
    if (Math.abs(u - liftNow(p)) < 1e-6 && mine){ nudge(); return; }          // (already there: a limit)
    if (!settle.pending) host.liftBegin();
    queued = { p, u };
    learned();
    settle.poke(() => { applyQueued(); host.liftSettle(); onChange(); paint(); keepInView(); });
    onChange();
  }
  function applyQueued(){
    const q = queued; if (!q) return;
    queued = null;
    applyLift(q.p, q.u);
    host.liftWrite(q.p.key, { ...entryOf(q.p), lift: q.u }, allNow());
  }
  /* AUTO: the user's height is forgotten — the layout decides again (a station: the room re-solves; the
     kit: back on the floor) */
  function liftAuto(){
    const p = sel; if (!liftable(p) || drag || !Number.isFinite(H(p).user)) return;
    settle.flush();
    host.liftAuto(p.key, entryOf(p), allNow());
    onChange(); paint(); keepInView();
  }
  function nudge(){ chipEl.classList.remove('nudge'); void chipEl.offsetWidth; chipEl.classList.add('nudge'); }

  /* ---- keys: E toggles · Q/E turn the selection · height keys · Esc deselects, then leaves ---- */
  addEventListener('keydown', e => {
    if (/^(input|textarea|select)$/i.test(e.target?.tagName || '') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (on && sel && (k === 'q' || k === 'e')){ e.preventDefault(); e.stopPropagation(); turn(k === 'q' ? -1 : 1, e.shiftKey); return; }
    // HEIGHT: PgUp / PgDn, ] / [ (Shift: a big step — '}' / '{' on most layouts), Home = the floor
    if (on && sel){
      const up = k === 'pageup' || e.code === 'BracketRight' || k === ']' || k === '}';
      const down = k === 'pagedown' || e.code === 'BracketLeft' || k === '[' || k === '{';
      if (up || down || k === 'home'){
        e.preventDefault(); e.stopPropagation();
        if (k === 'home') liftSet(0); else liftStep(up ? 1 : -1, e.shiftKey);
        return;
      }
    }
    // R is "rotate" to anyone moving furniture: here it turns the selection (Shift+R back) instead of
    // cycling the room under you; M (machines off) would hide what you're placing — both held while editing
    if (on && (k === 'r' || k === 'm')){
      e.preventDefault(); e.stopPropagation();
      if (k === 'r'){ if (sel) turn(e.shiftKey ? -1 : 1, false); else { hintEl.textContent = 'pick a machine, then R / Q / E turn it (the room stays put while you edit)'; hintEl.className = 'se-hint'; } }
      return;
    }
    if (k === 'e' && !e.repeat){
      // (outside stage edit, the FREE camera owns E — its descend key — so there the EDIT pill enters)
      if (!on && cam.mode === 'free') return;
      e.preventDefault(); e.stopPropagation(); toggle(); return;
    }
    if (on && k === 'escape'){ if (sel || info){ info = null; select(null); } else toggle(false); }
  }, { capture: true });

  /* ---- enter / leave ---- */
  const veilUp = () => { const o = document.getElementById('overlay'); return !!o && !o.classList.contains('gone'); };
  function toggle(want = !on){
    if (want === on) return;
    if (want && veilUp()) return;                       // before the play tap the veil owns the screen (§5) — and the free eye isn't live yet
    on = want;
    gizmo.visible = on; tagsEl.hidden = bar.hidden = !on;
    document.body.classList.toggle('stage-editing', on);
    if (on){
      prevMode = cam.mode; prevMax = cam.orbit.maxDistance; prevPolar = cam.orbit.maxPolarAngle;
      cam.mode = 'free';
      cam.orbit.maxDistance = 110; cam.orbit.maxPolarAngle = Math.PI * .47;   // stay above the floor plane
      host.enter?.();                                   // (the instrument MAP closes: one tool on the screen at a time)
      haze(true); refresh(); setViewBtns('plan'); view = 'plan'; overview({ ease: true });
    } else {
      if (drag) endDrag(true);
      if (turn._t) turnDone();
      settle.flush();
      sel = hover = drag = info = null; ease = null; dom.style.cursor = ''; haze(false);
      host.leave?.();                                   // (the director catches up with what was moved, once)
      cam.freeFov = null; lowerCeiling();
      cam.orbit.maxDistance = prevMax ?? cam.orbit.maxDistance; cam.orbit.maxPolarAngle = prevPolar ?? cam.orbit.maxPolarAngle;
      if (prevMode && prevMode !== 'free') cam.mode = prevMode;
      paintHeight(); paintDock();
    }
    onChange();
  }
  /* the room's haze is tuned for the show's shots; looking down over the whole floor it would
     grey out the far side — thinned while editing (re-applied after a rebuild resets it) */
  const EDIT_FOG = .007;
  let fogBase = null;
  function haze(thin){
    if (!scene.fog) return;
    if (thin){ if (scene.fog.density !== EDIT_FOG) fogBase = scene.fog.density; scene.fog.density = Math.min(fogBase ?? EDIT_FOG, EDIT_FOG); }
    else if (fogBase != null){ scene.fog.density = fogBase; fogBase = null; }
  }
  /* the PLAN VIEW: steeply down over everything movable + the belt, fitted BY CONSTRUCTION —
     numerically: every footprint corner (and every name tag) is projected and the eye backs off
     until they all land inside the screen, minus the toolbar's band, then re-centres on them.
     The eye stays inside the room (under the ceiling — the walls/ceiling are part of the look and
     stay); when that's too close to frame it all at the normal lens, the lens widens instead
     (cam.freeFov, up to MAX_FOV) and the eye stands up straighter (a wide lens tilted is lopsided:
     the near half of the floor would get far less of the screen than the far half). On a phone
     held upright the eye swings round so the room's LONG axis runs up the screen. */
  const MAX_FOV = 76, NDC = .93, LIFT_D = 170;
  /* the ceiling lift: when nothing frames the whole floor from under the ceiling (a phone held
     upright; a big room), the eye rises through it — the room's CEILING-LEVEL meshes (whatever sits
     wholly up there: the lid, trusses, lamps) are hidden while editing, put back on the way out */
  let lifted = [];
  function liftCeiling(ceilY){
    const g = host.roomGroup?.(); if (!g) return;
    const b = new THREE.Box3();
    g.updateWorldMatrix(true, true);
    g.traverse(o => {
      if (!(o.isMesh || o.isInstancedMesh || o.isLine || o.isPoints) || !o.visible || !o.geometry) return;
      if (o.isInstancedMesh){ o.computeBoundingBox(); b.copy(o.boundingBox).applyMatrix4(o.matrixWorld); }
      else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); }
      if (b.min.y > ceilY){ o.visible = false; lifted.push(o); }
    });
  }
  function lowerCeiling(){ for (const o of lifted) o.visible = true; lifted = []; }
  const _e = new THREE.Vector3(), _p = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
  /* the screen's free band for a fit (NDC y): minus the toolbar at the top and the dock at the bottom */
  function bands(){
    const H0 = Math.max(1, dom.clientHeight);
    const br = bar.getBoundingClientRect(), barH = bar.hidden ? 0 : Math.min(H0 * .3, br.bottom > 0 && br.top < H0 / 2 ? br.bottom + 8 : H0 - br.top + 8);
    const atTop = br.top < H0 / 2;
    // the dock: measured when it's up, else what it will take (it stands up on the first selection)
    const dr = dock.getBoundingClientRect(), dockH = Math.min(H0 * .3, !dock.hidden && dr.height ? H0 - dr.top + 8 : (innerWidth <= 640 ? 132 : 84));
    let yLo = -NDC + 2 * dockH / H0, yHi = NDC;
    if (atTop) yHi -= 2 * barH / H0; else yLo += 2 * barH / H0;
    return { yLo, yHi };
  }
  /* fit a set of points from direction `dir` with lens `fov`: the nearest eye (≤ maxD) whose view holds
     them all inside the free band, aim re-centred on them → { aim, D, fits } */
  function fitView(pts, dir, fov, maxD, aim, { yLo, yHi }){
    const c = cam.camera, W = dom.clientWidth, H0 = Math.max(1, dom.clientHeight), aspect = W / H0;
    const extents = (D) => {
      c.fov = fov; c.updateProjectionMatrix();
      c.position.copy(_e.copy(aim).addScaledVector(dir, D)); c.lookAt(aim); c.updateMatrixWorld(true);
      let a = Infinity, b = -Infinity, lo = Infinity, hi = -Infinity, behind = false;
      for (const q of pts){ _p.copy(q).project(c); if (_p.z > 1 || _p.z < -1) behind = true; a = Math.min(a, _p.x); b = Math.max(b, _p.x); lo = Math.min(lo, _p.y); hi = Math.max(hi, _p.y); }
      return { a, b, lo, hi, behind };
    };
    const fits = e => !e.behind && e.b - e.a <= 2 * NDC && e.hi - e.lo <= yHi - yLo;
    let D = maxD;
    for (let pass = 0; pass < 3; pass++){
      // the nearest eye that fits (binary search), then re-centre the aim on what it sees
      let lo = 4, hi = maxD;
      if (!fits(extents(hi))) { D = hi; break; }
      for (let i = 0; i < 22; i++){ const m = (lo + hi) / 2; if (fits(extents(m))) hi = m; else lo = m; }
      D = hi * 1.02;
      const e = extents(D);
      const dx = (e.a + e.b) / 2, dy = (e.lo + e.hi) / 2 - (yLo + yHi) / 2;
      if (Math.abs(dx) < .01 && Math.abs(dy) < .01) break;
      // move the aim across by that much of the view (screen right / screen up, laid flat when looking down)
      _r.setFromMatrixColumn(c.matrixWorld, 0).setY(0).normalize();
      // (a look DOWN — the plan: laid flat on the floor; an oblique look — the 3/4: along the screen's own up)
      const flat = dir.y > .75;
      _u.setFromMatrixColumn(c.matrixWorld, 1);
      if (flat) _u.setY(0).normalize();
      const half = D * Math.tan(THREE.MathUtils.degToRad(fov / 2));
      aim.addScaledVector(_r, dx * half * aspect).addScaledVector(_u, dy * half / (flat ? Math.max(.3, dir.y) : 1));
    }
    const e = extents(Math.min(D, maxD));
    return { aim, D: Math.min(D, maxD), fits: fits(e) };
  }
  function overview({ ease: glide = false } = {}){
    const polys = pieces.map(fpOf), wall = wallBox();
    if (wall) polys.push(boxCorners(wall));
    if (!polys.length) return;
    // (a HUNG machine is framed by its footprint alone, at the floor machines' height: its crown up under the
    //  ceiling would push the plan view out over the ceiling for a tag)
    const floorP = pieces.filter(p => !p.hung), deck = floorP.length ? floorP.reduce((a, p) => a + baseOf(p), 0) / floorP.length : 0;
    const pts = polys.flat().map(([x, z]) => new THREE.Vector3(x, deck, z));
    for (const p of floorP){ const c = pivotOf(p); pts.push(new THREE.Vector3(c.x, topOf(p) + 2, c.z)); }   // the tags float above
    const [x0, x1, z0, z1] = bounds(polys.flat());
    const W = dom.clientWidth, H0 = Math.max(1, dom.clientHeight), aspect = W / H0;
    const side = aspect < 1 && x1 - x0 > z1 - z0;        // portrait + a wide room: x runs up the screen
    const band = bands();
    const lim = host.roomBox || { y1: Infinity, z1: Infinity };
    const c = cam.camera, fov0 = c.fov, pos0 = c.position.clone(), q0 = c.quaternion.clone();
    let best = null;
    // under the ceiling first (lens 55° → MAX_FOV); then, if nothing fit, from above it at the normal lens
    const tries = [];
    for (let fov = 55; fov <= MAX_FOV + 1e-6; fov += 7) tries.push({ fov, lift: false });
    for (let fov = 55; fov <= 69; fov += 7) tries.push({ fov, lift: true });
    for (const { fov, lift } of tries){
      if (best) break;
      const tilt = THREE.MathUtils.degToRad(Math.max(4, 24 - Math.max(0, fov - 55) * .45));
      const dir = side ? new THREE.Vector3(Math.sin(tilt), Math.cos(tilt), 0) : new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt));
      const maxD = lift ? LIFT_D : Math.max(6, (lim.y1 - deck) / dir.y);
      const f = fitView(pts, dir, fov, maxD, new THREE.Vector3((x0 + x1) / 2, deck, (z0 + z1) / 2), band);
      if (f.fits || (lift && fov + 7 > 69)) best = { aim: f.aim, dir, D: f.D, fov, lift };
    }
    c.fov = fov0; c.updateProjectionMatrix(); c.position.copy(pos0); c.quaternion.copy(q0); c.updateMatrixWorld(true);
    const eye = best.aim.clone().addScaledVector(best.dir, best.D);
    if (!best.lift && Number.isFinite(lim.z1)) eye.z = Math.min(eye.z, lim.z1);
    goTo({ eye, aim: best.aim, fov: best.fov, lift: best.lift ? lim.y1 - 9 : null }, glide);   // (y1 = ceiling − 2: anything wholly above ~ceiling − 11)
  }
  /* the 3/4 VIEW (RCT's isometric feel): elevated, from the audience side at an angle, a longer lens — framing
     the selection with headroom to raise it (no selection: the whole stage). The eye stays inside the room;
     when the angle that fits leaves it, the next angle is tried, then a wider lens. */
  function pose3D(p, { head = 0 } = {}){
    const list = p ? [p] : pieces;
    const wall = wallBox();
    if (!list.length && !wall) return null;
    const pts = [], floor = (host.floorY ?? 0);
    const add = (poly, y0, y1) => { for (const [x, z] of poly){ pts.push(new THREE.Vector3(x, y0, z), new THREE.Vector3(x, y1, z)); } };
    // (the selection: from the floor to over its top, with room to raise it — its pole + knob stay in frame)
    // (+ a margin round the selection: its neighbours in view — what it might share a loft with)
    // (head: a grab's raise — the machine's top that far up stays in frame too)
    for (const q of list){ const h = H(q); add(p ? grown(fpOf(q), 2.5) : fpOf(q), floor, p ? Math.max(topOf(q) + Math.max(2.5, head), (h ? h.bottom : baseOf(q)) + 6) : topOf(q) + .5); }
    if (p) add(grown(fpOf(p), 1.6), floor, (H(p)?.bottom ?? baseOf(p)) + .5);   // (the pole + its knob, at any corner)
    if (!p && wall) add(boxCorners(wall), floor, floor + 4);
    const [x0, x1, z0, z1] = bounds(pts.map(v => [v.x, v.z]));
    const cx = host.cx(), mid = (x0 + x1) / 2, outer = Math.sign(mid - cx) || 1;
    const band = bands(), lim = host.roomBox || {};
    const inRoom = e => (!Number.isFinite(lim.y1) || e.y <= lim.y1 + 1e-6) && (!Number.isFinite(lim.z1) || e.z <= lim.z1 + 1e-6)
                     && (!Number.isFinite(lim.x1) || Math.abs(e.x) <= lim.x1 + 1e-6);
    const c = cam.camera, fov0 = c.fov, pos0 = c.position.clone(), q0 = c.quaternion.clone();
    const azs = p ? [outer * VIEW3D.az, -outer * VIEW3D.az, 0, outer * VIEW3D.az * 1.6] : [VIEW3D.az * .6, -VIEW3D.az * .6, 0];
    let best = null, fallback = null;
    for (const az of azs){
      const dir = new THREE.Vector3(Math.sin(az) * Math.cos(VIEW3D.el), Math.sin(VIEW3D.el), Math.cos(az) * Math.cos(VIEW3D.el));
      const aim0 = new THREE.Vector3(mid, (pts.reduce((a, v) => a + v.y, 0) / pts.length), (z0 + z1) / 2);
      // the farthest the eye may stand along dir and stay in the room
      let maxD = 200;
      if (Number.isFinite(lim.y1) && dir.y > 1e-6) maxD = Math.min(maxD, (lim.y1 - aim0.y) / dir.y);
      if (Number.isFinite(lim.z1) && dir.z > 1e-6) maxD = Math.min(maxD, (lim.z1 - aim0.z) / dir.z);
      if (Number.isFinite(lim.x1) && Math.abs(dir.x) > 1e-6) maxD = Math.min(maxD, (lim.x1 - Math.sign(dir.x) * aim0.x) / Math.abs(dir.x));
      maxD = Math.max(6, maxD);
      for (let fov = VIEW3D.fov; fov <= VIEW3D.maxFov + 1e-6; fov += 7){
        const f = fitView(pts, dir, fov, maxD, aim0.clone(), band);
        const eye = f.aim.clone().addScaledVector(dir, f.D);
        if (f.fits && inRoom(eye)){ best = { eye, aim: f.aim, fov }; break; }
        if (!fallback && fov + 7 > VIEW3D.maxFov) fallback = { eye, aim: f.aim, fov };
      }
      if (best) break;
    }
    c.fov = fov0; c.updateProjectionMatrix(); c.position.copy(pos0); c.quaternion.copy(q0); c.updateMatrixWorld(true);
    if (!best && fallback){                             // (nothing fit inside the room: the widest try, its eye held inside)
      const e = fallback.eye;
      if (Number.isFinite(lim.y1)) e.y = Math.min(e.y, lim.y1);
      if (Number.isFinite(lim.z1)) e.z = Math.min(e.z, lim.z1);
      if (Number.isFinite(lim.x1)) e.x = Math.max(-lim.x1, Math.min(lim.x1, e.x));
    }
    return best || fallback;
  }
  /* a footprint grown outward by `d` (its corners pushed out from its centre) */
  function grown(fp, d){
    const cx = fp.reduce((a, q) => a + q[0], 0) / 4, cz = fp.reduce((a, q) => a + q[1], 0) / 4;
    return fp.map(([x, z]) => { const L = Math.hypot(x - cx, z - cz) || 1; return [x + (x - cx) / L * d, z + (z - cz) / L * d]; });
  }
  /* PLAN / 3D */
  function setViewBtns(v){ for (const b of bar.querySelectorAll('.se-view button')) b.classList.toggle('on', b.dataset.a === v); }
  function setView(v, { hand = null, dur } = {}){
    if (!on) return;
    view = v; setViewBtns(v); paint();
    if (v === 'plan') overview({ ease: true });
    else { const head = hand && sel ? headOf(sel) : 0, t = pose3D(sel, { head }); if (t){ if (hand && sel) underHand(t, sel, hand, head); goTo({ ...t, lift: null }, true, dur); } }
  }
  /* the raise a grab's swing frames over the machine's top: enough to reach the rear GALLERY's deck (the belt's
     top housing − GALLERY_DROP — the big raise people make) or the highest LOFT it could join, at least
     GRAB_HEAD — never more than is left to its ceiling */
  function headOf(p){
    const h = H(p); if (!h) return 0;
    let want = GRAB_HEAD;
    const w = host.wall?.();
    if (w && !w.isEmpty()) want = Math.max(want, w.max.y - GALLERY_DROP - h.bottom + GRAB_OVER);
    for (const t of targetsOf(p, h)) want = Math.max(want, t.lift - h.lift + GRAB_OVER);
    return Math.max(0, Math.min(want, maxOf(p, h) - h.lift));
  }
  /* the 3/4 pose `t`, slid across the screen so the selection's height KNOB lands on `hand` (the pixel it was
     grabbed at): the eye + aim move in the view plane (the eye kept in the room); the pole's corner is chosen
     for that eye and locked for the drag. HEADROOM: a grab high on the screen would carry the machine's top
     under the bar as it rises (the camera never moves during the drag) — so the knob lands no higher than
     leaves `head` u of raise over the machine's top inside the free band (straight under the hand, lower
     when it must: the drag then follows the pointer's MOTION from the grab — liftFrame) */
  const _h = {}, _ht = {};
  function underHand(t, p, hand, head = 0){
    const c = cam.camera, fov0 = c.fov, pos0 = c.position.clone(), q0 = c.quaternion.clone();
    const pose = () => { c.fov = t.fov; c.updateProjectionMatrix(); c.position.copy(t.eye); c.lookAt(t.aim); c.updateMatrixWorld(true); };
    pose();
    const y = H(p)?.bottom ?? baseOf(p);
    p.poleI = null; const at = poleOf(p);
    proj(at.x, y, at.z, _h);
    if (!_h.behind){
      const c0 = pivotOf(p), B = freeBand();
      proj(c0.x, topOf(p) + head, c0.z, _ht);          // (the top of the raise, at this pose: a slide in the view plane keeps its span)
      let span = _ht.behind ? 0 : Math.max(0, _h.y - _ht.y);
      // the raise doesn't fit over the grab pixel: a WIDER LENS first (the eye stays put, the knob still lands
      // under the hand), up to VIEW3D.maxFov — what is still over after that lowers the knob instead
      const room = hand.y - B.y0 - 12;
      if (span > room && room > 40 && t.fov < VIEW3D.maxFov){
        const f = Math.min(VIEW3D.maxFov, 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(t.fov / 2)) * span / room)));
        if (f > t.fov + .5){
          t.fov = f; pose(); p.poleI = null; const a2 = poleOf(p); at.x = a2.x; at.z = a2.z;
          proj(at.x, y, at.z, _h); proj(c0.x, topOf(p) + head, c0.z, _ht);
          span = _h.behind || _ht.behind ? 0 : Math.max(0, _h.y - _ht.y);
        }
      }
      // (…and sideways: the machine's whole footprint, at its base and at the raise's top, inside the band — a
      //  phone's narrow frame put half of it off the edge)
      let lo = 0, hi = 0;
      const sides = () => { lo = 0; hi = 0;
        for (const [qx, qz] of fpOf(p)) for (const qy of [y, topOf(p) + head]){ proj(qx, qy, qz, _ht); if (!_ht.behind){ lo = Math.min(lo, _ht.x - _h.x); hi = Math.max(hi, _ht.x - _h.x); } } };
      sides();
      // (a footprint WIDER than the band — a phone's frame, a horn rank at the widest lens: the eye steps BACK
      //  along its line through the knob (the knob keeps its pixel; everything shrinks ~1/k), as far as the room lets it)
      const wB = B.x1 - B.x0 - 16;
      if (hi - lo > wB && wB > 40){
        const k = Math.min(3, (hi - lo) / wB * 1.06), lim = host.roomBox || {};
        const back = _e.set(at.x, y, at.z), eye = t.eye.clone().sub(back).multiplyScalar(k).add(back);
        if (Number.isFinite(lim.y1)) eye.y = Math.min(eye.y, lim.y1);
        if (Number.isFinite(lim.z1)) eye.z = Math.min(eye.z, lim.z1);
        if (Number.isFinite(lim.x1)) eye.x = Math.max(-lim.x1, Math.min(lim.x1, eye.x));
        t.aim.add(back.copy(eye).sub(t.eye)); t.eye.copy(eye); pose();
        proj(at.x, y, at.z, _h); proj(c0.x, topOf(p) + head, c0.z, _ht);
        span = _h.behind || _ht.behind ? 0 : Math.max(0, _h.y - _ht.y);
        sides();
      }
      const xa = B.x0 + 8 - lo, xb = B.x1 - 8 - hi;
      // (still too wide — the room's wall stopped the step back: the KNOB stays under the finger, kept in the
      //  band — centring a frame that is overfull either way only put the handle 400 px from the hand)
      hand = { x: xa <= xb ? Math.min(Math.max(hand.x, xa), xb) : Math.min(Math.max(hand.x, B.x0 + 24), B.x1 - 24),
               y: Math.min(Math.max(hand.y, B.y0 + 12 + span), Math.max(hand.y, B.y1 - 40)) };
      _r.setFromMatrixColumn(c.matrixWorld, 0); _u.setFromMatrixColumn(c.matrixWorld, 1); _p.setFromMatrixColumn(c.matrixWorld, 2);
      const depth = Math.max(1, -_e.set(at.x, y, at.z).sub(c.position).dot(_p));
      const wpp = 2 * depth * Math.tan(THREE.MathUtils.degToRad(t.fov / 2)) / Math.max(1, dom.clientHeight);
      const want = _e.copy(_r).multiplyScalar((_h.x - hand.x) * wpp).addScaledVector(_u, (hand.y - _h.y) * wpp);
      const eye = t.eye.clone().add(want), lim = host.roomBox || {}, floor = host.floorY ?? 0;
      if (Number.isFinite(lim.y1)) eye.y = Math.min(eye.y, lim.y1);
      if (Number.isFinite(lim.z1)) eye.z = Math.min(eye.z, lim.z1);
      if (Number.isFinite(lim.x1)) eye.x = Math.max(-lim.x1, Math.min(lim.x1, eye.x));
      eye.y = Math.max(eye.y, floor + 1.5);
      t.aim.add(_e.copy(eye).sub(t.eye)); t.eye.copy(eye);
      // (the corner stays the one just slid under the hand — locked for the drag: poleOf keeps it while a lift
      //  runs. Re-choosing it for the landed eye moved the knob a corner away: 315 px off the pointer)
    }
    c.fov = fov0; c.updateProjectionMatrix(); c.position.copy(pos0); c.quaternion.copy(q0); c.updateMatrixWorld(true);
  }
  /* after a gesture in the 3/4 view: when the knob has ended up under the bar / the dock / off the screen,
     or the machine itself has risen out of the frame, the eye re-frames the selection once (never during
     a gesture) */
  const _kv = {};
  function keepInView(){
    if (!on || view !== '3d' || !sel || drag || ease || !liftable(sel)) return;
    const B = bandPx = freeBand(); paintHeight(true); bandPx = null;
    const c = pivotOf(sel), inB = () => !_kv.behind && _kv.y > B.y0 - 30 && _kv.y < B.y1 && _kv.x > 0 && _kv.x < innerWidth;
    proj(c.x, topOf(sel), c.z, _kv); let bodyIn = inB();     // (its top, and where it stands: both clear of the UI)
    proj(c.x, baseOf(sel), c.z, _kv); bodyIn = bodyIn && inB();
    // (a margin inside the band: a knob or a machine grazing the dock's edge is re-framed too)
    if (knobIn && _k.y > B.y0 + 10 && _k.y < B.y1 - 40 && bodyIn) return;
    const t = pose3D(sel); if (t) goTo({ ...t, lift: null }, true);
  }
  /* the eye's glide (smoothstep; reduced motion: a cut) — a ceiling lift (the plan from above) is made as it
     leaves, a lowered one restored as it lands (the ceiling never blocks the way) */
  let ease = null;
  function goTo({ eye, aim, fov, lift }, glide, dur = VIEW3D.ease){
    if (lift != null){ lowerCeiling(); liftCeiling(lift); }
    const c = cam.camera;
    if (!glide || reduce){
      if (lift == null) lowerCeiling();
      cam.freeFov = fov; c.position.copy(eye); cam.target.copy(aim); cam.orbit.target.copy(aim); cam.orbit.update();
      ease = null; return;
    }
    // (from the LIVE aim: cam.target — the director's, on the way in; the orbit's own in free-look)
    ease = { t0: performance.now(), dur: dur * 1000, p0: c.position.clone(), p1: eye.clone(), a0: cam.target.clone(), a1: aim.clone(), f0: c.fov, f1: fov, lower: lift == null };
  }
  function easeFrame(){
    if (!ease) return;
    const k = Math.min(1, (performance.now() - ease.t0) / ease.dur), s = k * k * (3 - 2 * k), c = cam.camera;
    c.position.lerpVectors(ease.p0, ease.p1, s); cam.orbit.target.lerpVectors(ease.a0, ease.a1, s); cam.target.copy(cam.orbit.target);
    cam.freeFov = ease.f0 + (ease.f1 - ease.f0) * s;
    c.lookAt(cam.orbit.target); c.updateMatrixWorld();
    if (k >= 1){ const lower = ease.lower; ease = null; cam.orbit.update(); if (lower) lowerCeiling(); }
  }

  /* per frame: the eye's glide, the knob's lift, keep the name tags + the handle over their machines */
  function update(){
    if (!on) return;
    bandPx = sel ? freeBand() : null;                   // (read before this frame's DOM writes)
    easeFrame();
    liftFrame();
    if (queued) applyQueued();
    if (pendingHover && !drag) hoverPick();
    const W = dom.clientWidth, H0 = dom.clientHeight;
    // (the SELECTION's tag first: once placed it is in the way too — a neighbour's tag steps off it)
    keepOut[8] = keepOut[10] = NaN;
    const br = bar.hidden ? null : bar.getBoundingClientRect();     // (read before this frame's tag writes)
    if (br && br.height && br.top < H0 / 2){ keepOut[12] = br.left; keepOut[13] = br.top; keepOut[14] = br.right; keepOut[15] = br.bottom; }
    else keepOut[12] = keepOut[14] = NaN;
    if (sel) tagAt(sel, W, H0);
    for (const p of pieces) if (p !== sel) tagAt(p, W, H0);
    if (sel) paintHeight();
    if (drag?.piece?.rehang) paintMagnet();
    bandPx = null;
  }
  /* a machine's name tag over its top — on the screen, out of the handle's way (and, for a neighbour, out of
     the selection's tag's) */
  function tagAt(p, W, H0){
    const c = pivotOf(p);
    _v.set(c.x, tagY(p), c.z).project(cam.camera);
    const vis = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
    p.el.style.display = vis ? '' : 'none';
    if (!vis) return;
    // a tag never hangs off the screen edge (a phone's overview puts the corner machines right
    // at it): its centre is held half its own width in from either side (width measured once)
    const hw = (p.tagW ||= p.el.offsetWidth) / 2 + 4;
    let x = hw * 2 < W ? Math.min(W - hw, Math.max(hw, (_v.x + 1) / 2 * W)) : (_v.x + 1) / 2 * W, y = (1 - _v.y) / 2 * H0;
    const th = (p.tagH ||= p.el.offsetHeight || 18) + 2;
    stepAside(x, y, hw, th, W, H0); x = _sa[0]; y = _sa[1];
    if (p === sel){ keepOut[8] = x - hw; keepOut[9] = y - th; keepOut[10] = x + hw; keepOut[11] = y; }
    p.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }

  /* a name tag (centre x, bottom y, half width, height) moved the least way that clears the handle (the knob,
     the tip: keepOut) and stays on the screen: a step left / right / up / down past one of them — or, when that
     lands on the other, a second step past that one. Into _sa (no garbage; a tag in the clear costs a few compares) */
  const _sa = [0, 0], _st = { x: 0, y: 0, hw: 0, th: 0, W: 0, H: 0, best: 0 };
  function keptOut(cx, cy, hw, th){
    for (let i = 0; i < 16; i += 4) if (keepOut[i] === keepOut[i] && cx - hw < keepOut[i + 2] && cx + hw > keepOut[i] && cy - th < keepOut[i + 3] && cy > keepOut[i + 1]) return i;
    return -1;
  }
  function stepTry(cx, cy, depth){
    const S = _st, o = keptOut(cx, cy, S.hw, S.th);
    if (o < 0){
      const d = Math.abs(cx - S.x) + Math.abs(cy - S.y);
      if (d < S.best && cx >= S.hw && cx <= S.W - S.hw && cy >= S.th && cy <= S.H){ S.best = d; _sa[0] = cx; _sa[1] = cy; }
      return;
    }
    if (!depth) return;
    stepTry(keepOut[o] - 3 - S.hw, cy, depth - 1); stepTry(keepOut[o + 2] + 3 + S.hw, cy, depth - 1);
    stepTry(cx, keepOut[o + 1] - 3, depth - 1); stepTry(cx, keepOut[o + 3] + 3 + S.th, depth - 1);
  }
  function stepAside(x, y, hw, th, W, H0){
    _sa[0] = x; _sa[1] = y;
    if (keptOut(x, y, hw, th) < 0) return;
    const S = _st; S.x = x; S.y = y; S.hw = hw; S.th = th; S.W = W; S.H = H0; S.best = Infinity;
    stepTry(x, y, 2);
  }
  function syncUndo(n, r = 0){
    const b = bar.querySelector('[data-a=undo]'); b.disabled = !n; b.title = n ? `undo the last change (⌘Z / Ctrl+Z) · ${n} step${n === 1 ? '' : 's'}` : 'nothing to undo';
    const f = bar.querySelector('[data-a=redo]'); f.hidden = !r; f.title = `redo (⌘⇧Z / Ctrl+Y) · ${r} step${r === 1 ? '' : 's'}`;   // (shown only while there is one to redo)
  }

  return { toggle, refresh, update, overview, measureAll, syncUndo, get on(){ return on; }, get selected(){ return sel?.key || null; },
           /* height: a pending burst of taps settles now (before an undo, a song change) */
           flush: () => settle.flush(),
           /* the gesture still open (a drag, a burst of taps, a burst of turns) ends now, as if released — an
              undo then undoes IT */
           finish(){ if (drag) endDrag(true); if (turn._t) turnDone(); settle.flush(); },
           /* …or is dropped (the world it moved is being rebuilt: a song change, a reset) */
           cancel(){ endDrag(false); clearTimeout(turn._t); turn._t = turn._p = null; settle.cancel(); queued = null; },
           get view(){ return view; }, setView,
           /* dev/test: the live footprints (oriented corners + their bounds) + conflicts */
           state: () => pieces.map(p => { const fp = fpOf(p); return { key: p.key, box: bounds(fp).map(v => +v.toFixed(2)), corners: fp.map(q => q.map(v => +v.toFixed(2))),
             rel: p.rel.map(v => +v.toFixed(2)), yaw: +yawOf(p).toFixed(3), bad: p.bad.map(b => b.key) }; }),
           /* dev/test: the selection's height as the handle shows it */
           height(){
             const p = sel; if (!p) return info ? { key: info.key, fixed: true, why: info.why } : null;
             const h = H(p), r = h && readoutOf(p);
             return h && { key: p.key, lift: +h.lift.toFixed(3), user: h.user, bottom: +h.bottom.toFixed(3), max: +r.max.toFixed(3), readout: r,
               view, dragging: drag?.mode === 'lift', magnet: drag?.magnet ?? null, liftMs: liftMs.length ? +(liftMs.reduce((a, b) => a + b, 0) / liftMs.length).toFixed(2) : null,
               liftMsMax: liftMs.length ? +Math.max(...liftMs).toFixed(2) : null, dock: { val: D.val.textContent, band: D.band.textContent, loft: D.loft.textContent } };
           },
           get fov(){ return cam.camera.fov; },
           select: key => select(pieces.find(p => p.key === key) || null),
           /* dev/test: where a piece's deck centre (or its turn knob, or its HEIGHT knob) is on screen, in CSS px */
           screenOf(key, what = 'deck'){
             const p = pieces.find(q => q.key === key); if (!p) return null;
             if (what === 'lift'){
               if (sel !== p || knobEl.hidden) return null;
               const r = knobEl.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
             }
             if (what === 'knob'){ if (!knob.visible || sel !== p) return null; _v.copy(knob.position); }
             else { const fp = fpOf(p); _v.set(fp.reduce((a, q) => a + q[0], 0) / 4, baseOf(p) + .1, fp.reduce((a, q) => a + q[1], 0) / 4); }
             _v.project(cam.camera);
             const r = dom.getBoundingClientRect();
             return { x: r.left + (_v.x + 1) / 2 * r.width, y: r.top + (1 - _v.y) / 2 * r.height };
           } };
}
