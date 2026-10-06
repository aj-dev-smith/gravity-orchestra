/* ============================================================
   STAGE EDIT — the human curates the room (PLAN-staging: "build the
   drag mechanism; human curation over auto-layout").

   Key E (or the EDIT pill) enters it: the camera goes free and lifts to
   an overview, every movable machine shows its measured FOOTPRINT on a
   floor grid with a name tag. Click one to select it; drag it across the
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
import { snap, snapYaw, conflicts, describeConflicts, moveBox } from './placement.js';

const C = { idle: 0x6c7aa0, hover: 0xcfd6e6, sel: 0xffb764, bad: 0xff4d5e, belt: 0x3d6dff };
const GIZMO_ORDER = 990;

export function makeStageEdit({ THREE, scene, cam, dom, host, onChange = () => {} }){
  let on = false, pieces = [], sel = null, hover = null, drag = null, snapOn = true;
  let prevMode = null, prevMax = null, prevPolar = null;
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
  const setRect = (line, fill, b, y) => {
    const p = line.geometry.attributes.position;
    [[b[0], b[2]], [b[1], b[2]], [b[1], b[3]], [b[0], b[3]], [b[0], b[2]]].forEach(([x, z], i) => p.setXYZ(i, x, y, z));
    p.needsUpdate = true; line.geometry.computeBoundingSphere();
    fill.position.set((b[0] + b[1]) / 2, y - .01, (b[2] + b[3]) / 2); fill.scale.set(Math.max(.01, b[1] - b[0]), 1, Math.max(.01, b[3] - b[2]));
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
    <span class="se-btns"><button data-a="ccw" title="turn left 15° (Q)">↺ Q</button><button data-a="cw" title="turn right 15° (E)">E ↻</button>
    <button data-a="snap" class="on" title="snap to the ½-unit grid / 15° (hold Shift to place freely)">SNAP</button>
    <button data-a="reset" title="forget this song's layout — back to the solved stage">RESET LAYOUT</button>
    <button data-a="done" class="done" title="leave stage edit (Esc)">DONE</button></span>`;
  document.body.appendChild(bar);
  const hintEl = bar.querySelector('.se-hint');
  bar.addEventListener('click', e => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'ccw') turn(-1, e.shiftKey); else if (a === 'cw') turn(1, e.shiftKey);
    else if (a === 'snap'){ snapOn = !snapOn; e.target.classList.toggle('on', snapOn); }
    else if (a === 'reset'){ select(null); host.resetLayout(); }
    else if (a === 'done') toggle(false);
  });

  /* ---- the pieces: every movable machine, its pivot + measured footprint ---- */
  function refresh(){
    const keep = sel?.key;
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
    if (wb && !wb.isEmpty()){ setRect(beltLine, beltFill, [wb.min.x, wb.max.x, wb.min.z, wb.max.z], 0); beltLine.visible = beltFill.visible = true; }
    else beltLine.visible = beltFill.visible = false;
    sel = pieces.find(p => p.key === keep) || null;
    check(); paint();
  }
  const pivotOf = p => p.kind === 'kit' ? host.kitPivot() : { x: p.obj.position.x, z: p.obj.position.z };
  const deckOf = p => p.deckY ?? p.obj.position.y;
  function measure(p){
    const b = host.visBox(p.obj), c = pivotOf(p);
    p.rel = b.isEmpty() ? [-1, 1, -1, 1] : [b.min.x - c.x, b.max.x - c.x, b.min.z - c.z, b.max.z - c.z];
    p.top = b.isEmpty() ? deckOf(p) + 3 : Math.min(b.max.y, deckOf(p) + 14);
  }
  const boxOf = p => { const c = pivotOf(p); return moveBox(p.rel, c.x, c.z); };
  function check(){
    const wb = host.wall(), wall = wb && !wb.isEmpty() ? [wb.min.x, wb.max.x, wb.min.z, wb.max.z] : null;
    for (const p of pieces) p.bad = conflicts(boxOf(p), pieces.filter(o => o !== p).map(o => ({ key: o.key, box: boxOf(o) })), wall, host.room);
  }
  function paint(){
    for (const p of pieces){
      const bad = p.bad.length > 0, isSel = p === sel, isHov = p === hover && !isSel;
      const col = bad ? C.bad : isSel ? C.sel : isHov ? C.hover : C.idle;
      p.line.material.color.setHex(col); p.line.material.opacity = isSel || bad ? 1 : isHov ? .9 : .6;
      p.fill.material.color.setHex(col); p.fill.material.opacity = isSel ? .16 : bad ? .14 : isHov ? .1 : .05;
      setRect(p.line, p.fill, boxOf(p), deckOf(p) + .06);
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
      const b = boxOf(p);
      if (hit && hit.x >= b[0] && hit.x <= b[1] && hit.z >= b[2] && hit.z <= b[3]){
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
    p.obj.rotation.y = yaw; p.obj.updateMatrixWorld(true);
    measure(p);
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
    if (k === 'e' && !e.repeat){
      // (outside stage edit, the FREE camera owns E — its descend key — so there the EDIT pill enters)
      if (!on && cam.mode === 'free') return;
      e.preventDefault(); e.stopPropagation(); toggle(); return;
    }
    if (on && k === 'escape'){ if (sel) select(null); else toggle(false); }
  }, { capture: true });

  /* ---- enter / leave ---- */
  function toggle(want = !on){
    if (want === on) return;
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
  /* a high three-quarter view over everything movable + the belt */
  function overview(){
    const pts = pieces.map(p => boxOf(p)), wb = host.wall();
    if (wb && !wb.isEmpty()) pts.push([wb.min.x, wb.max.x, wb.min.z, wb.max.z]);
    if (!pts.length) return;
    const x0 = Math.min(...pts.map(b => b[0])), x1 = Math.max(...pts.map(b => b[1])), z0 = Math.min(...pts.map(b => b[2])), z1 = Math.max(...pts.map(b => b[3]));
    const aim = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const aspect = dom.clientWidth / Math.max(1, dom.clientHeight), tanV = Math.tan(THREE.MathUtils.degToRad(cam.camera.fov / 2));
    // look down steeply (a phone held upright: nearly plan view); back off until the room's width
    // AND depth fit — then pull in along the same line if that would leave the room (it crops)
    const dir = new THREE.Vector3(0, aspect < 1 ? .94 : .78, aspect < 1 ? .34 : .62).normalize();
    const D0 = Math.max((x1 - x0) / 2 / (tanV * aspect), (z1 - z0) * .5 / tanV) * 1.08 + 4;
    const lim = host.roomBox || { y1: Infinity, z1: Infinity };
    // (a phone held upright can't fit a full room from inside it: it frames the middle — the belt
    //  and its nearest neighbours — and the rest is a drag of the empty floor away)
    const k = Math.min(1, (lim.y1 - aim.y) / (dir.y * D0), dir.z > 1e-6 ? (lim.z1 - aim.z) / (dir.z * D0) : 1);
    const eye = aim.clone().addScaledVector(dir, D0 * Math.max(.2, k));
    cam.camera.position.copy(eye); cam.target.copy(aim); cam.orbit.target.copy(aim); cam.orbit.update();
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

  return { toggle, refresh, update, get on(){ return on; }, get selected(){ return sel?.key || null; },
           /* dev/test: the live footprints + conflicts */
           state: () => pieces.map(p => ({ key: p.key, box: boxOf(p).map(v => +v.toFixed(2)), yaw: +p.obj.rotation.y.toFixed(3), bad: p.bad.map(b => b.key) })),
           select: key => select(pieces.find(p => p.key === key) || null),
           /* dev/test: where a piece's deck centre (or its turn knob) is on screen, in CSS px */
           screenOf(key, what = 'deck'){
             const p = pieces.find(q => q.key === key); if (!p) return null;
             if (what === 'knob'){ if (!knob.visible || sel !== p) return null; _v.copy(knob.position); }
             else { const c = pivotOf(p), b = boxOf(p); _v.set((b[0] + b[1]) / 2, deckOf(p) + .1, (b[2] + b[3]) / 2); }
             _v.project(cam.camera);
             const r = dom.getBoundingClientRect();
             return { x: r.left + (_v.x + 1) / 2 * r.width, y: r.top + (1 - _v.y) / 2 * r.height };
           } };
}
