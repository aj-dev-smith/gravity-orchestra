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
   knob is magnetic to the floor and to a neighbour's deck), and the
   director re-solves once, at the end. Grabbing the knob in the plan view
   (a straight-down look hides height) eases the eye to an elevated 3/4 view
   that frames the selection; PLAN / 3D in the bar flips between the two.
   PgUp / PgDn and ] / [ step ½ u (Shift 2 u), Home sets it on the floor;
   the dock under the stage has ▲ RAISE, ▼ LOWER, FLOOR (an explicit 0) and
   AUTO (the layout decides — e.g. the gallery raise). One undo step per
   gesture: a drag, a burst of key repeats / taps. The readout says metres
   + the band (FLOOR · RISER · PLATFORM · TOWER) + "LOFT · STRUM" when it
   shares a deck (the footing plan's own word).

   Hung stations (the organ loft, the ricochet chandelier, the volley court)
   are a crown over the belt, not floor machines, and the belt is the
   protagonist: none of them moves here — click one and the dock says why.
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
import { snap, snapYaw, conflicts, describeConflicts, footprint, boxCorners, bounds, inPoly } from './placement.js';
import { readout, dragLift, stepLift, loftTargets, liftMax, rayPlaneY, makeSettle, bandName, TICK_U, fmtMeters } from './height.js';

const C = { idle: 0x6c7aa0, hover: 0xcfd6e6, sel: 0xffb764, bad: 0xff4d5e, belt: 0x3d6dff };
const GIZMO_ORDER = 990;
const HINT_KEY = 'cascade:hint:height';              // the first-selection hint, once used / dismissed (a convenience: storage may throw)
const SETTLE_MS = 700;                               // a burst of height taps / key repeats settles this long after the last
                                                     //  (past an OS key-repeat delay, ~.5 s: a held PgUp is ONE gesture)
const deg = d => d * Math.PI / 180;
const VIEW3D = { el: deg(31), az: deg(38), fov: 42, maxFov: 70, ease: .55 };   // the 3/4 view: ~RCT's dimetric tilt, a longer lens

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
    [...poly, poly[0]].forEach(([x, z], i) => p.setXYZ(i, x, y, z));
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
  const drops = tag(new THREE.LineSegments(dropGeo, new THREE.LineDashedMaterial({ color: C.sel, dashSize: .5, gapSize: .32, transparent: true, opacity: .8, depthTest: false, depthWrite: false, fog: false })));
  shadow.visible = shadowLine.visible = drops.visible = false;
  gizmo.add(shadow, shadowLine, drops);

  /* ---- DOM: name tags + the toolbar ---- */
  const tagsEl = document.createElement('div'); tagsEl.className = 'se-tags'; tagsEl.hidden = true; document.body.appendChild(tagsEl);
  const bar = document.createElement('div'); bar.className = 'se-bar'; bar.hidden = true;
  bar.innerHTML = `<b>STAGE EDIT</b><span class="se-hint"></span>
    <span class="se-btns">
    <button data-a="undo" title="undo the last change (⌘Z / Ctrl+Z)">↶<i> UNDO</i></button>
    <button data-a="snap" class="on" title="snap to the ½-unit grid / 15° (hold Shift to place freely)">⌗<i> SNAP</i></button>
    <span class="se-view" role="group" aria-label="view"><button data-a="plan" class="on" title="straight down over the whole stage">PLAN</button><button data-a="3d" title="an elevated 3/4 view — height reads">3D</button></span>
    <button data-a="reset" title="forget this song's layout — back to the solved stage">⟲<i> RESET LAYOUT</i></button>
    <button data-a="done" class="done" title="leave stage edit (Esc)">✓<i> DONE</i></button></span>`;
  document.body.appendChild(bar);
  const hintEl = bar.querySelector('.se-hint');
  bar.addEventListener('click', e => {
    const b = e.target.closest('button'), a = b?.dataset.a;
    if (!a) return;
    if (a === 'undo'){ select(null); host.undo(); }   // (a burst of height taps still settling is dropped: the undo rebuilds)
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
  knobEl.innerHTML = '<span>▲</span><span>▼</span>';
  const chipEl = document.createElement('div'); chipEl.className = 'se-chip'; chipEl.hidden = true;
  chipEl.innerHTML = '<b></b><i></i><em></em>';
  const tipEl = document.createElement('div'); tipEl.className = 'se-tip'; tipEl.hidden = true;
  tipEl.innerHTML = '<span></span><button aria-label="got it" title="got it">×</button>';
  document.body.append(knobEl, chipEl, tipEl);
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
    if (reset){ hover = null; drag = null; info = null; }
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
  const baseOf = p => H(p)?.bottom ?? deckOf(p);        // the world y it STANDS on (its support's top)
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
  function check(){
    const wall = wallBox();
    for (const p of pieces) p.bad = conflicts(fpOf(p), pieces.filter(o => o !== p).map(o => ({ key: o.key, box: fpOf(o) })), wall, host.room);
  }
  function paint(){
    for (const p of pieces){
      const bad = p.bad.length > 0, isSel = p === sel, isHov = p === hover && !isSel;
      const col = bad ? C.bad : isSel ? C.sel : isHov ? C.hover : C.idle;
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
    paintHeight(true);
    paintDock();
    hint();
  }
  function hint(){
    if (!sel){ hintEl.textContent = pieces.length ? 'click a machine to pick it up · drag empty space to orbit' : 'nothing to move — this song has only the belt'; hintEl.className = 'se-hint'; return; }
    const bad = describeConflicts(sel.bad, k => pieces.find(p => p.key === k)?.label || k);
    const turnHint = coarse() ? ' · the ring turns it' : ' · Q / E or the ring to turn';   // (no keys on a phone)
    hintEl.textContent = bad ? `${sel.label}: ${bad}` : `${sel.label} · drag to move${sel.canRotate ? turnHint : ''}${liftable(sel) ? ' · ▲▼ height' : ''}`;
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
    r.max = maxOf(p, h); r.atMax = h.lift >= r.max - 1e-6;
    return r;
  }
  const maxOf = (p, h = H(p)) => liftMax({ lift: h.lift, top: topOf(p), ceil: h.ceil });
  /* neighbours whose deck this one can share (a LOFT): the lift that levels it with each */
  function targetsOf(p, h = H(p)){
    const others = [];
    for (const o of pieces){
      if (o === p) continue;
      const g = H(o); if (!g) continue;
      others.push({ key: o.key, label: o.label, top: g.bottom, box: bounds(fpOf(o)), raised: bandName(g.bottom - g.floor).band !== 'flush', open: g.open });
    }
    return loftTargets({ bottom0: h.bottom - h.lift, box: bounds(fpOf(p)) }, others);
  }
  /* the POLE stands just outside the footprint's corner nearest the eye (kept while a lift runs; it moves
     to another corner only when that one is clearly nearer — no flicker as the eye orbits) */
  function poleOf(p){
    const fp = fpOf(p), e = cam.camera.position;
    const cx = fp.reduce((a, q) => a + q[0], 0) / 4, cz = fp.reduce((a, q) => a + q[1], 0) / 4;
    const dist = i => Math.hypot(fp[i][0] - e.x, fp[i][1] - e.z);
    let best = 0;
    for (let i = 1; i < 4; i++) if (dist(i) < dist(best)) best = i;
    const keepI = p.poleI ?? best;
    if (!(drag && drag.mode === 'lift' && drag.piece === p) && dist(best) < dist(keepI) * .88) p.poleI = best;
    else p.poleI = keepI;
    const q = fp[p.poleI], dx = q[0] - cx, dz = q[1] - cz, L = Math.hypot(dx, dz) || 1;
    return { x: q[0] + dx / L * .9, z: q[1] + dz / L * .9 };
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
  let lastRead = null, readSig = null, shown = false;
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
    if (!v){ shadow.visible = shadowLine.visible = drops.visible = false; tipEl.hidden = true; }
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
    fp.forEach(([x, z], i) => { dp.setXYZ(i * 2, x, base + .04, z); dp.setXYZ(i * 2 + 1, x, F, z); });
    dp.needsUpdate = true; drops.computeLineDistances(); dropGeo.computeBoundingSphere();
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
    // the knob, where it stands; the readout beside it (away from the screen edge; above a finger)
    knobEl.style.transform = `translate(${_k.x.toFixed(1)}px, ${_k.y.toFixed(1)}px) translate(-50%, -50%)`;
    const W = innerWidth, right = _k.x < W - 190, touchDrag = drag?.mode === 'lift' && drag.touch;
    const cy = touchDrag ? _k.y - 74 : _k.y;
    chipEl.classList.toggle('left', !right);
    chipEl.style.transform = `translate(${(_k.x + (right ? 26 : -26)).toFixed(1)}px, ${cy.toFixed(1)}px) translate(${right ? '0' : '-100%'}, -50%)`;
    if (!tipSeen && !tipEl.hidden){                 // (under the chip — over it when the knob is low: the dock is there)
      const low = cy > innerHeight * .62;
      tipEl.style.transform = `translate(${(_k.x + (right ? 26 : -26)).toFixed(1)}px, ${(low ? cy - 30 : cy + 30).toFixed(1)}px) translate(${right ? '0' : '-100%'}, ${low ? '-100%' : '0'})`;
    }
  }
  let knobW = 0;
  const labOff = () => (knobW ||= knobEl.offsetWidth) ? knobW / 2 + 9 : 24;   // (the knob's width, measured once it shows)
  /* the readout, written only when it changes (the chip + the dock) */
  function setRead(r){
    const key = `${r.value}|${r.name}|${r.loft}|${r.auto}|${r.atMax}|${sel?.key}`;
    if (key === lastRead) return;
    lastRead = key;
    chip.val.textContent = r.value; chip.band.textContent = r.floor ? '' : r.name + (r.auto ? ' · AUTO' : '');
    chip.loft.textContent = r.loft; chipEl.classList.toggle('loft', !!r.loft);
    D.val.textContent = r.value; D.band.textContent = (r.floor ? 'FLOOR' : r.name) + (r.auto ? ' · AUTO' : '') + (r.atMax && !r.floor ? ' · MAX' : '');
    D.loft.textContent = r.loft; dock.classList.toggle('loft', !!r.loft);
    D.up.disabled = r.atMax; D.down.disabled = r.floor; D.floor.disabled = r.floor && !r.auto; D.auto.disabled = r.auto;
    D.up.title = r.atMax ? `as high as it goes (${fmtMeters(r.max)} — ${r.max < 23.99 ? 'the ceiling' : 'the tallest tower'})` : 'raise it ½ u ≈ 34 cm (PgUp or ] · Shift: 2 u)';
    knobEl.setAttribute('aria-valuetext', `${r.value} ${r.floor ? '' : r.name}`.trim());
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
    dock.classList.remove('fixed'); D.why.textContent = '';
    D.name.textContent = p.label; dock.style.setProperty('--c', p.color || '#cfd6e6');
    D.ccw.disabled = D.cw.disabled = !p.canRotate;
    D.ccw.title = p.canRotate ? 'turn left 15° (Q · Shift: 5°)' : `${p.label} faces the audience — it moves, it doesn't turn`;
    D.cw.title = p.canRotate ? 'turn right 15° (E · Shift: 5°)' : D.ccw.title;
    const lift = liftable(p);
    dock.classList.toggle('nolift', !lift);
    if (!lift){ D.val.textContent = ''; D.band.textContent = ''; D.loft.textContent = ''; unread(); }
  }

  /* ---- pointer: pick, drag, turn ---- */
  function rayAt(e){ rayAtXY(e.clientX, e.clientY); }
  function rayAtXY(x, y){
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
    rayAt(e);
    const hit = pick();
    downAt = { x: e.clientX, y: e.clientY, hit: !!hit };
    if (!hit){ ease = null; return; }                    // empty space: the orbit has it (and stops any glide)
    settle.flush();                                     // (a burst of height taps settles before a new gesture)
    cam.orbit.enabled = false;                          // this press is ours (OrbitControls checks at pointerdown)
    ease = null;
    select(hit.piece);
    const p = hit.piece, c = pivotOf(p);
    const y = hit.knob ? deckOf(p) + .1 : THREE.MathUtils.clamp(hit.point.y, deckOf(p) - 2, deckOf(p) + 12);
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
      if (d.moved) commit(d.piece);
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
    if (!sel.canRotate){ hintEl.textContent = `${sel.label} faces the audience — it moves, it doesn't turn`; return; }
    settle.flush();
    setYaw(sel, free || !snapOn ? sel.obj.rotation.y + dir * Math.PI / 36 : snapYaw(sel.obj.rotation.y + dir * Math.PI / 12));
    check(); paint();
    const p = sel;
    clearTimeout(turn._t); turn._t = setTimeout(() => commit(p), 350);   // a burst of Q/E taps commits once
  }
  const entryOf = p => { const c = pivotOf(p); return { x: c.x - host.cx(), z: c.z, yaw: p.canRotate ? p.obj.rotation.y : 0 }; };
  const allNow = () => pieces.map(q => ({ key: q.key, ...pivotOf(q), yaw: q.canRotate ? q.obj.rotation.y : 0 }));
  function commit(p){
    if (!p) return;
    host.place(p.key, entryOf(p), allNow());
    onChange();
  }
  function select(p){
    if (p) info = null;
    if (p !== sel){ unread(); if (sel) sel.poleI = null; }
    sel = p;
    if (p && !tipSeen && liftable(p)){ tipEl.hidden = false; tipEl.querySelector('span').textContent = coarse() ? 'drag ▲▼ to raise or lower it' : 'drag ▲▼ to raise · PgUp / PgDn · Home = floor'; }
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
    settle.flush();
    const p = sel, h = H(p);
    if (!h) return;
    drag = { piece: p, mode: 'lift', id: e.pointerId, touch: e.pointerType === 'touch', px: e.clientX, py: e.clientY, free: e.shiftKey || !snapOn,
             y0: null, lift0: h.lift, cur: h.lift, opened: false, at: poleOf(p), max: maxOf(p, h), targets: targetsOf(p, h), magnet: null };
    try { knobEl.setPointerCapture(e.pointerId); } catch (_){}
    knobEl.classList.add('drag'); document.body.classList.add('se-lifting');
    learned();
    // a straight-down look hides height: grabbing the knob there eases to the 3/4 view first (the drag
    // anchors where the eye lands — relative, so nothing jumps)
    if (view !== '3d') setView('3d'); else paint();
  });
  /* once a frame: the pointer → the knob's drag plane → the lift (snapped, magnetic) → the machine */
  function liftFrame(){
    const d = drag;
    if (!d || d.mode !== 'lift' || ease) return;
    if (d.y0 === null){                                 // ANCHOR (where the eye landed): the pole at the corner nearest it now
      d.piece.poleI = null; d.at = poleOf(d.piece); d.screen = undefined;
      rayAtXY(d.px, d.py);
      const y0 = dragY(d);
      if (y0 !== null){ d.y0 = y0; d.lift0 = d.cur; }
      return;
    }
    rayAtXY(d.px, d.py);
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
    if (d.screen) return -d.py * d.upp;
    return rayPlaneY(ray.ray.origin, ray.ray.direction, d.at, e);
  }
  function endLift(){
    const d = drag; drag = null;
    try { knobEl.releasePointerCapture(d.id); } catch (_){}
    knobEl.classList.remove('drag'); document.body.classList.remove('se-lifting');
    if (!d.opened) return;
    host.liftWrite(d.piece.key, { ...entryOf(d.piece), lift: d.cur }, allNow());
    host.liftSettle();
    onChange(); paint();
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
    settle.poke(() => { applyQueued(); host.liftSettle(); onChange(); paint(); });
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
    onChange(); paint();
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
      haze(true); refresh(); setViewBtns('plan'); view = 'plan'; overview({ ease: true });
    } else {
      settle.flush();
      if (drag?.mode === 'lift') endLift();
      sel = hover = drag = info = null; ease = null; dom.style.cursor = ''; haze(false);
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
    const deck = pieces.length ? pieces.reduce((a, p) => a + baseOf(p), 0) / pieces.length : 0;
    const pts = polys.flat().map(([x, z]) => new THREE.Vector3(x, deck, z));
    for (const p of pieces){ const c = pivotOf(p); pts.push(new THREE.Vector3(c.x, topOf(p) + 2, c.z)); }   // the tags float above
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
  function pose3D(p){
    const list = p ? [p] : pieces;
    const wall = wallBox();
    if (!list.length && !wall) return null;
    const pts = [], floor = (host.floorY ?? 0);
    const add = (poly, y0, y1) => { for (const [x, z] of poly){ pts.push(new THREE.Vector3(x, y0, z), new THREE.Vector3(x, y1, z)); } };
    // (the selection: from the floor to over its top, with room to raise it — its pole + knob stay in frame)
    // (+ a margin round the selection: its neighbours in view — what it might share a loft with)
    for (const q of list){ const h = H(q); add(p ? grown(fpOf(q), 2.5) : fpOf(q), floor, p ? Math.max(topOf(q) + 2.5, (h ? h.bottom : baseOf(q)) + 6) : topOf(q) + .5); }
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
  function setView(v){
    if (!on) return;
    view = v; setViewBtns(v); paint();
    if (v === 'plan') overview({ ease: true });
    else { const t = pose3D(sel); if (t) goTo({ ...t, lift: null }, true); }
  }
  /* the eye's glide (smoothstep; reduced motion: a cut) — a ceiling lift (the plan from above) is made as it
     leaves, a lowered one restored as it lands (the ceiling never blocks the way) */
  let ease = null;
  function goTo({ eye, aim, fov, lift }, glide){
    if (lift != null){ lowerCeiling(); liftCeiling(lift); }
    const c = cam.camera;
    if (!glide || reduce){
      if (lift == null) lowerCeiling();
      cam.freeFov = fov; c.position.copy(eye); cam.target.copy(aim); cam.orbit.target.copy(aim); cam.orbit.update();
      ease = null; return;
    }
    // (from the LIVE aim: cam.target — the director's, on the way in; the orbit's own in free-look)
    ease = { t0: performance.now(), dur: VIEW3D.ease * 1000, p0: c.position.clone(), p1: eye.clone(), a0: cam.target.clone(), a1: aim.clone(), f0: c.fov, f1: fov, lower: lift == null };
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
    easeFrame();
    liftFrame();
    if (queued) applyQueued();
    if (pendingHover && !drag) hoverPick();
    const W = dom.clientWidth, H0 = dom.clientHeight;
    for (const p of pieces){
      const c = pivotOf(p);
      _v.set(c.x, topOf(p) + .8, c.z).project(cam.camera);
      const vis = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      p.el.style.display = vis ? '' : 'none';
      if (!vis) continue;
      // a tag never hangs off the screen edge (a phone's overview puts the corner machines right
      // at it): its centre is held half its own width in from either side (width measured once)
      const hw = (p.tagW ||= p.el.offsetWidth) / 2 + 4;
      const x = hw * 2 < W ? Math.min(W - hw, Math.max(hw, (_v.x + 1) / 2 * W)) : (_v.x + 1) / 2 * W;
      p.el.style.transform = `translate(${x.toFixed(1)}px, ${((1 - _v.y) / 2 * H0).toFixed(1)}px) translate(-50%, -100%)`;
    }
    if (sel) paintHeight();
  }

  function syncUndo(n){ const b = bar.querySelector('[data-a=undo]'); b.disabled = !n; b.title = n ? `undo the last change (⌘Z / Ctrl+Z) · ${n} step${n === 1 ? '' : 's'}` : 'nothing to undo'; }

  return { toggle, refresh, update, overview, measureAll, syncUndo, get on(){ return on; }, get selected(){ return sel?.key || null; },
           /* height: a pending burst of taps settles now (before an undo, a song change) */
           flush: () => settle.flush(), cancel: () => { settle.cancel(); queued = null; },
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
