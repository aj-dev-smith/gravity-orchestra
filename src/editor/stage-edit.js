/* ============================================================
   STAGE EDIT — the human curates the room (PLAN-staging: "build the
   drag mechanism; human curation over auto-layout").

   Key E (or the EDIT pill) enters it: the camera goes free and lifts to
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

   Hung stations (the ricochet chandelier) are a crown over the belt, not
   floor machines: not movable here. The belt is the protagonist: fixed.
   The drum kit moves but doesn't turn (it is built to face the audience).

   Input etiquette (CLAUDE.md §5 + the free camera):
   · never stopPropagation on pointer events — the window-level iOS
     audio-priming listeners must see every tap;
   · a press that lands on a machine disables the orbit for that press only
     (capture phase, before OrbitControls sees it); a press on empty space
     orbits the camera as usual;
   · Q / E are swallowed (capture) only while a machine is selected.
   ============================================================ */
import { snap, snapYaw, conflicts, describeConflicts, footprint, boxCorners, bounds, inPoly } from './placement.js';

const C = { idle: 0x6c7aa0, hover: 0xcfd6e6, sel: 0xffb764, bad: 0xff4d5e, belt: 0x3d6dff };
const GIZMO_ORDER = 990;

export function makeStageEdit({ THREE, scene, cam, dom, host, onChange = () => {} }){
  let on = false, pieces = [], sel = null, hover = null, drag = null, snapOn = true;
  let prevMode = null, prevMax = null, prevPolar = null;
  const local = new Map();                              // key → { rel, top } — each machine's LOCAL box, measured once per build
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), _v = new THREE.Vector3(), plane = new THREE.Plane();

  /* ---- gizmo layer: grid + footprints + rotation ring (drawn over everything) ---- */
  const gizmo = new THREE.Group(); gizmo.visible = false; gizmo.renderOrder = GIZMO_ORDER; scene.add(gizmo);
  const lineMat = (color, opacity) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false });
  const fillMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const tag = o => { o.renderOrder = GIZMO_ORDER; o.userData.noMerge = true; o.userData.noFadeGate = true; o.raycast = () => {}; return o; };
  // the floor grid: minor lines every SNAP·2 = 1 u, major every 5 u — at the decks' working level
  const grid = new THREE.Group(); gizmo.add(grid);
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

  /* ---- DOM: name tags + the toolbar ---- */
  const tagsEl = document.createElement('div'); tagsEl.className = 'se-tags'; tagsEl.hidden = true; document.body.appendChild(tagsEl);
  const bar = document.createElement('div'); bar.className = 'se-bar'; bar.hidden = true;
  bar.innerHTML = `<b>STAGE EDIT</b><span class="se-hint"></span>
    <span class="se-btns"><button data-a="ccw" title="turn left 15° (Q / Shift+R)">↺<i> Q</i></button><button data-a="cw" title="turn right 15° (E / R)"><i>E </i>↻</button>
    <button data-a="undo" title="undo the last move (⌘Z / Ctrl+Z)">↶<i> UNDO</i></button>
    <button data-a="snap" class="on" title="snap to the ½-unit grid / 15° (hold Shift to place freely)">⌗<i> SNAP</i></button>
    <button data-a="reset" title="forget this song's layout — back to the solved stage">⟲<i> RESET LAYOUT</i></button>
    <button data-a="done" class="done" title="leave stage edit (Esc)">✓<i> DONE</i></button></span>`;
  document.body.appendChild(bar);
  const hintEl = bar.querySelector('.se-hint');
  bar.addEventListener('click', e => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'ccw') turn(-1, e.shiftKey); else if (a === 'cw') turn(1, e.shiftKey);
    else if (a === 'undo'){ select(null); host.undo(); }
    else if (a === 'snap'){ snapOn = !snapOn; e.target.closest('button').classList.toggle('on', snapOn); }
    else if (a === 'reset'){ select(null); host.resetLayout(); }
    else if (a === 'done') toggle(false);
  });

  /* ---- the pieces: every movable machine, its pivot + measured footprint ---- */
  /* measure every machine's LOCAL box now (main calls this right after a build: the count-in pose,
     the pose the room solve measured) — never re-measured live, so animated parts can't jitter it */
  function measureAll(){
    local.clear();
    for (const p of host.pieces()) local.set(p.key, measureLocal(p));
  }
  function refresh({ reset = false } = {}){
    const keep = reset ? null : sel?.key;
    if (reset){ hover = null; drag = null; }
    if (on) haze(true);
    for (const p of pieces){ gizmo.remove(p.line, p.fill); p.line.geometry.dispose(); p.el.remove(); }
    pieces = host.pieces().map(p => {
      const line = tag(new THREE.Line(rectGeo(), lineMat(C.idle, .8))), fill = tag(new THREE.Mesh(unitPlane, fillMat(C.idle, .06)));
      gizmo.add(line, fill);
      const el = document.createElement('span'); el.className = 'se-tag'; el.textContent = p.label;
      el.style.setProperty('--c', p.color || '#cfd6e6'); tagsEl.appendChild(el);
      const piece = { ...p, line, fill, el, bad: [] };
      measure(piece);
      return piece;
    });
    const wb = host.wall();
    if (wb && !wb.isEmpty()){ setRect(beltLine, beltFill, boxCorners([wb.min.x, wb.max.x, wb.min.z, wb.max.z]), 0); beltLine.visible = beltFill.visible = true; }
    else beltLine.visible = beltFill.visible = false;
    sel = pieces.find(p => p.key === keep) || null;
    check(); paint();
  }
  const pivotOf = p => p.kind === 'kit' ? host.kitPivot() : { x: p.obj.position.x, z: p.obj.position.z };
  const deckOf = p => p.deckY ?? p.obj.position.y;
  const yawOf = p => p.canRotate ? p.obj.rotation.y : 0;
  /* the machine's box in its OWN frame: un-turned for the measurement, then restored */
  function measureLocal(p){
    const yaw = p.obj.rotation.y, turned = p.canRotate && Math.abs(yaw) > 1e-9;
    if (turned){ p.obj.rotation.y = 0; p.obj.updateMatrixWorld(true); }
    const b = host.visBox(p.obj), c = pivotOf(p);
    if (turned){ p.obj.rotation.y = yaw; p.obj.updateMatrixWorld(true); }
    return { rel: b.isEmpty() ? [-1, 1, -1, 1] : [b.min.x - c.x, b.max.x - c.x, b.min.z - c.z, b.max.z - c.z],
             top: b.isEmpty() ? deckOf(p) + 3 : Math.min(b.max.y, deckOf(p) + 14) };
  }
  function measure(p){ const m = local.get(p.key) || measureLocal(p); local.set(p.key, m); p.rel = m.rel; p.top = m.top; }
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
      p.fill.material.color.setHex(col); p.fill.material.opacity = isSel ? .16 : bad ? .14 : isHov ? .1 : .05;
      setRect(p.line, p.fill, fpOf(p), deckOf(p) + .06, yawOf(p));
      p.el.classList.toggle('sel', isSel); p.el.classList.toggle('bad', bad); p.el.classList.toggle('hov', isHov);
    }
    const s = sel;
    ring.visible = knob.visible = knobArrow.visible = !!(s && s.canRotate);
    if (s && s.canRotate){
      const c = pivotOf(s), r = Math.max(Math.hypot(s.rel[0], s.rel[2]), Math.hypot(s.rel[1], s.rel[3]), 3) * .82 + 1.2, y = deckOf(s) + .1, yaw = s.obj.rotation.y;
      ring.position.set(c.x, y, c.z); ring.scale.setScalar(r);
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      knob.position.set(c.x + fx * r, y, c.z + fz * r);
      const kp = knobArrow.geometry.attributes.position;
      [[0, 0], [fx * r * .62, fz * r * .62], [fx * r * .62, fz * r * .62], [fx * r * .62, fz * r * .62], [fx * r * .62, fz * r * .62]].forEach(([dx, dz], i) => kp.setXYZ(i, c.x + dx, y, c.z + dz));
      kp.needsUpdate = true; knobArrow.geometry.computeBoundingSphere();
    }
    hint();
  }
  function hint(){
    if (!sel){ hintEl.textContent = pieces.length ? 'click a machine to pick it up · drag empty space to orbit' : 'nothing to move — this song has only the belt'; hintEl.className = 'se-hint'; return; }
    const bad = describeConflicts(sel.bad, k => pieces.find(p => p.key === k)?.label || k);
    hintEl.textContent = bad ? `${sel.label}: ${bad}` : `${sel.label} · drag to move${sel.canRotate ? ' · Q / E or the ring to turn' : ''}`;
    hintEl.className = 'se-hint' + (bad ? ' bad' : '');
  }

  /* ---- pointer: pick, drag, turn ---- */
  function rayAt(e){
    const r = dom.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
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
    for (const p of pieces){                            // …or its footprint on the floor
      plane.set(_v.set(0, 1, 0), -(deckOf(p) + .06));
      const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (hit && inPoly([hit.x, hit.z], fpOf(p))){
        const d = hit.distanceTo(ray.ray.origin);
        if (!best || d < best.d) best = { piece: p, d, point: hit };
      }
    }
    return best;
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
    if (!hit) return;                                   // empty space: the orbit has it
    cam.orbit.enabled = false;                          // this press is ours (OrbitControls checks at pointerdown)
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
      const d = drag; drag = null;
      try { dom.releasePointerCapture(d.id); } catch (_){}
      dom.style.cursor = '';
      if (d.moved) commit(d.piece);
    } else if (downAt && !downAt.hit && e.target === dom && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5) select(null);   // a click on empty space
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
    setYaw(sel, free || !snapOn ? sel.obj.rotation.y + dir * Math.PI / 36 : snapYaw(sel.obj.rotation.y + dir * Math.PI / 12));
    check(); paint();
    const p = sel;
    clearTimeout(turn._t); turn._t = setTimeout(() => commit(p), 350);   // a burst of Q/E taps commits once
  }
  function commit(p){
    if (!p) return;
    const c = pivotOf(p);
    host.place(p.key, { x: c.x - host.cx(), z: c.z, yaw: p.canRotate ? p.obj.rotation.y : 0 }, pieces.map(q => ({ key: q.key, ...pivotOf(q), yaw: q.canRotate ? q.obj.rotation.y : 0 })));
    onChange();
  }
  function select(p){ sel = p; paint(); }

  /* ---- keys: E toggles · Q/E turn the selection · Esc deselects, then leaves ---- */
  addEventListener('keydown', e => {
    if (/^(input|textarea|select)$/i.test(e.target?.tagName || '') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (on && sel && (k === 'q' || k === 'e')){ e.preventDefault(); e.stopPropagation(); turn(k === 'q' ? -1 : 1, e.shiftKey); return; }
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
    if (on && k === 'escape'){ if (sel) select(null); else toggle(false); }
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
      haze(true); refresh(); overview();
    } else {
      sel = hover = drag = null; dom.style.cursor = ''; haze(false);
      cam.freeFov = null; lowerCeiling();
      cam.orbit.maxDistance = prevMax ?? cam.orbit.maxDistance; cam.orbit.maxPolarAngle = prevPolar ?? cam.orbit.maxPolarAngle;
      if (prevMode && prevMode !== 'free') cam.mode = prevMode;
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
  const _e = new THREE.Vector3(), _a = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
  function overview(){
    const polys = pieces.map(fpOf), wall = wallBox();
    if (wall) polys.push(boxCorners(wall));
    if (!polys.length) return;
    const deck = pieces.length ? pieces.reduce((a, p) => a + deckOf(p), 0) / pieces.length : 0;
    const pts = polys.flat().map(([x, z]) => new THREE.Vector3(x, deck, z));
    for (const p of pieces){ const c = pivotOf(p); pts.push(new THREE.Vector3(c.x, p.top + 2, c.z)); }   // the tags float above
    const [x0, x1, z0, z1] = bounds(polys.flat());
    const W = dom.clientWidth, H = Math.max(1, dom.clientHeight), aspect = W / H;
    const side = aspect < 1 && x1 - x0 > z1 - z0;        // portrait + a wide room: x runs up the screen
    // the toolbar's band (NDC): frame the plan in the rest of the screen
    const br = bar.getBoundingClientRect(), barH = bar.hidden ? 0 : Math.min(H * .3, br.bottom > 0 && br.top < H / 2 ? br.bottom + 8 : H - br.top + 8);
    const atTop = br.top < H / 2, band = 2 * barH / H;
    const yLo = -NDC + (atTop ? 0 : band), yHi = NDC - (atTop ? band : 0);
    const lim = host.roomBox || { y1: Infinity, z1: Infinity };
    const c = cam.camera, fov0 = c.fov;
    // project every point from an eye at aim + dir·D with this lens → its NDC extents
    const extents = (aim, dir, D, fov) => {
      c.fov = fov; c.updateProjectionMatrix();
      c.position.copy(_e.copy(aim).addScaledVector(dir, D)); c.lookAt(aim); c.updateMatrixWorld(true);
      let a = Infinity, b = -Infinity, lo = Infinity, hi = -Infinity, behind = false;
      for (const q of pts){ _a.copy(q).project(c); if (_a.z > 1 || _a.z < -1) behind = true; a = Math.min(a, _a.x); b = Math.max(b, _a.x); lo = Math.min(lo, _a.y); hi = Math.max(hi, _a.y); }
      return { a, b, lo, hi, behind };
    };
    const fits = e => !e.behind && e.b - e.a <= 2 * NDC && e.hi - e.lo <= yHi - yLo;
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
      const aim = new THREE.Vector3((x0 + x1) / 2, deck, (z0 + z1) / 2);
      let D = maxD;
      for (let pass = 0; pass < 3; pass++){
        // the nearest eye that fits (binary search), then re-centre the aim on what it sees
        let lo = 4, hi = maxD;
        if (!fits(extents(aim, dir, hi, fov))) { D = hi; break; }
        for (let i = 0; i < 22; i++){ const m = (lo + hi) / 2; if (fits(extents(aim, dir, m, fov))) hi = m; else lo = m; }
        D = hi * 1.02;
        const e = extents(aim, dir, D, fov);
        const dx = (e.a + e.b) / 2, dy = (e.lo + e.hi) / 2 - (yLo + yHi) / 2;
        if (Math.abs(dx) < .01 && Math.abs(dy) < .01) break;
        // move the aim across the floor by that much of the view (screen right / screen up, laid flat)
        _r.setFromMatrixColumn(c.matrixWorld, 0).setY(0).normalize();
        _u.setFromMatrixColumn(c.matrixWorld, 1).setY(0).normalize();
        const half = D * Math.tan(THREE.MathUtils.degToRad(fov / 2));
        aim.addScaledVector(_r, dx * half * aspect).addScaledVector(_u, dy * half / Math.max(.3, dir.y));
      }
      const e = extents(aim, dir, Math.min(D, maxD), fov);
      if (fits(e) || (lift && fov + 7 > 69)) best = { aim, dir, D: Math.min(D, maxD), fov, lift };
    }
    c.fov = fov0; c.updateProjectionMatrix();
    cam.freeFov = best.fov;
    const eye = best.aim.clone().addScaledVector(best.dir, best.D);
    lowerCeiling();
    if (best.lift) liftCeiling(lim.y1 - 9);           // (y1 = ceiling − 2: anything wholly above ~ceiling − 11)
    else if (Number.isFinite(lim.z1)) eye.z = Math.min(eye.z, lim.z1);
    c.position.copy(eye); cam.target.copy(best.aim); cam.orbit.target.copy(best.aim); cam.orbit.update();
  }

  /* per frame: keep the name tags over their machines */
  function update(){
    if (!on) return;
    if (pendingHover && !drag) hoverPick();
    const W = dom.clientWidth, H = dom.clientHeight;
    for (const p of pieces){
      const c = pivotOf(p);
      _v.set(c.x, p.top + .8, c.z).project(cam.camera);
      const vis = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      p.el.style.display = vis ? '' : 'none';
      if (vis) p.el.style.transform = `translate(${((_v.x + 1) / 2 * W).toFixed(1)}px, ${((1 - _v.y) / 2 * H).toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  function syncUndo(n){ const b = bar.querySelector('[data-a=undo]'); b.disabled = !n; b.title = n ? `undo the last move (⌘Z / Ctrl+Z) · ${n} step${n === 1 ? '' : 's'}` : 'nothing to undo'; }

  return { toggle, refresh, update, overview, measureAll, syncUndo, get on(){ return on; }, get selected(){ return sel?.key || null; },
           /* dev/test: the live footprints (oriented corners + their bounds) + conflicts */
           state: () => pieces.map(p => { const fp = fpOf(p); return { key: p.key, box: bounds(fp).map(v => +v.toFixed(2)), corners: fp.map(q => q.map(v => +v.toFixed(2))),
             rel: p.rel.map(v => +v.toFixed(2)), yaw: +yawOf(p).toFixed(3), bad: p.bad.map(b => b.key) }; }),
           get fov(){ return cam.camera.fov; },
           select: key => select(pieces.find(p => p.key === key) || null),
           /* dev/test: where a piece's deck centre (or its turn knob) is on screen, in CSS px */
           screenOf(key, what = 'deck'){
             const p = pieces.find(q => q.key === key); if (!p) return null;
             if (what === 'knob'){ if (!knob.visible || sel !== p) return null; _v.copy(knob.position); }
             else { const fp = fpOf(p); _v.set(fp.reduce((a, q) => a + q[0], 0) / 4, deckOf(p) + .1, fp.reduce((a, q) => a + q[1], 0) / 4); }
             _v.project(cam.camera);
             const r = dom.getBoundingClientRect();
             return { x: r.left + (_v.x + 1) / 2 * r.width, y: r.top + (1 - _v.y) / 2 * r.height };
           } };
}
