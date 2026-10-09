import * as THREE from 'three';
/* ============================================================
   XR MENU — the in-world panel (the HTML UI is unreachable in a headset).

   Y opens it in front of you (it stays put in the rig — turn your head and it doesn't follow);
   point either controller at it, pull the trigger to press. Song, room, play/pause, tour, next
   pad, exit VR. Y again (or the panel's CLOSE) puts it away.

   menuLayout(state) is PURE (tested in test/xrmenu.test.js): the button rectangles in canvas
   pixels for a state {songs, song, page, rooms, room, playing, tour, ar}. hitButton picks one
   from a panel uv. makeXRMenu draws it onto a CanvasTexture plane — redrawn only on change.
   ============================================================ */

export const MENU_W = 1024, MENU_H = 1100;          // canvas px
export const MENU_M = [.84, .84 * MENU_H / MENU_W]; // panel size in metres (the rig is metres)
export const PER_PAGE = 12;                          // songs per page (2 columns × 6)

/* → [{id, kind, label, x, y, w, h, on?, value?}] (canvas px, origin top-left) */
export function menuLayout({ songs = [], song = null, page = 0, rooms = [], room = null, playing = true, tour = false, ar = false } = {}){
  const B = [], pad = 36, gap = 14, W = MENU_W - 2 * pad;
  let y = 112;
  // transport row
  const tw = (W - 4 * gap) / 5;
  [['play', playing ? 'PAUSE' : 'PLAY', !playing], ['tour', 'TOUR', tour], ['pad', 'NEXT PAD', false],
   ['close', 'CLOSE', false], ['exit', ar ? 'EXIT AR' : 'EXIT VR', false]]
    .forEach(([id, label, on], i) => B.push({ id, kind: 'act', label, on, x: pad + i * (tw + gap), y, w: tw, h: 84 }));
  y += 84 + 56;
  // songs: 2 columns × 6, paged
  const pages = Math.max(1, Math.ceil(songs.length / PER_PAGE)), p = Math.min(Math.max(0, page), pages - 1);
  const cw = (W - gap) / 2, rh = 66;
  songs.slice(p * PER_PAGE, (p + 1) * PER_PAGE).forEach((s, i) =>
    B.push({ id: 'song:' + s.key, kind: 'song', value: s.key, label: s.label, on: s.key === song,
      x: pad + (i % 2) * (cw + gap), y: y + Math.floor(i / 2) * (rh + 10), w: cw, h: rh }));
  y += 6 * (rh + 10);
  if (pages > 1){
    B.push({ id: 'prev', kind: 'page', label: '‹ PREV', x: pad, y, w: 200, h: 56, value: (p - 1 + pages) % pages });
    B.push({ id: 'next', kind: 'page', label: 'NEXT ›', x: MENU_W - pad - 200, y, w: 200, h: 56, value: (p + 1) % pages });
    B.push({ id: 'pageof', kind: 'label', label: `${p + 1} / ${pages}`, x: MENU_W / 2 - 80, y, w: 160, h: 56 });
  }
  y += 56 + 54;
  // rooms (not in AR: the camera feed is the room)
  if (!ar){
    const rw = (W - 3 * gap) / 4;
    rooms.forEach((r, i) => B.push({ id: 'room:' + r.key, kind: 'room', value: r.key, label: r.label, on: r.key === room,
      x: pad + (i % 4) * (rw + gap), y: y + Math.floor(i / 4) * 70, w: rw, h: 60 }));
  }
  return B;
}

/* the button under a panel uv (three's uv: origin bottom-left) → button | null */
export function hitButton(layout, u, v){
  const x = u * MENU_W, y = (1 - v) * MENU_H;
  return layout.find(b => b.kind !== 'label' && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null;
}

export function makeXRMenu({ getState, onPress }){
  const cv = document.createElement('canvas'); cv.width = MENU_W; cv.height = MENU_H;
  const g = cv.getContext('2d'), tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(MENU_M[0], MENU_M[1]),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: false }));
  mesh.name = 'xr-menu'; mesh.visible = false; mesh.renderOrder = 1e8;
  mesh.material.depthTest = false;                    // always readable (it floats between you and the machines)
  mesh.frustumCulled = false; mesh.userData.xrKeep = true;
  const cursor = new THREE.Mesh(new THREE.CircleGeometry(.008, 20), new THREE.MeshBasicMaterial({ color: 0xffc070, depthTest: false, toneMapped: false }));
  cursor.renderOrder = 1e8 + 1; cursor.visible = false; cursor.position.z = .002;
  mesh.add(cursor);
  let page = 0, hover = null, layout = [], drawn = '';

  function draw(){
    const st = { ...getState(), page };
    layout = menuLayout(st);
    const key = JSON.stringify([st.song, st.room, st.playing, st.tour, st.ar, page, hover, st.time | 0, st.songs.length]);
    if (key === drawn) return;
    drawn = key;
    g.clearRect(0, 0, MENU_W, MENU_H);
    g.fillStyle = 'rgba(7,6,14,.9)'; g.beginPath(); g.roundRect(4, 4, MENU_W - 8, MENU_H - 8, 34); g.fill();
    g.strokeStyle = 'rgba(255,183,100,.6)'; g.lineWidth = 4; g.stroke();
    g.textBaseline = 'middle';
    g.font = '600 40px ui-monospace, Menlo, monospace'; g.fillStyle = '#ffb764';
    g.fillText('GRAVITY ORCHESTRA', 36, 62);
    g.font = '30px ui-monospace, Menlo, monospace'; g.fillStyle = '#7d859c';
    const cur = st.songs.find(s => s.key === st.song);
    g.textAlign = 'right'; g.fillText(`${(cur?.label || '').slice(0, 28)}  ·  ${st.time.toFixed(0)}s`, MENU_W - 36, 62); g.textAlign = 'left';
    const head = (txt, y) => { g.font = '600 24px ui-monospace, Menlo, monospace'; g.fillStyle = '#5a6178'; g.fillText(txt, 40, y); };
    const songY = layout.find(b => b.kind === 'song')?.y, roomY = layout.find(b => b.kind === 'room')?.y;
    if (songY) head('SONG', songY - 24);
    if (roomY) head('ROOM', roomY - 24);
    for (const b of layout){
      if (b.kind === 'label'){ g.font = '26px ui-monospace, Menlo, monospace'; g.fillStyle = '#7d859c'; g.textAlign = 'center';
        g.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2); g.textAlign = 'left'; continue; }
      const hot = hover === b.id;
      g.fillStyle = b.on ? 'rgba(255,183,100,.24)' : hot ? 'rgba(207,214,230,.16)' : 'rgba(207,214,230,.05)';
      g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 14); g.fill();
      g.strokeStyle = b.on ? 'rgba(255,183,100,.9)' : hot ? 'rgba(207,214,230,.8)' : 'rgba(207,214,230,.2)';
      g.lineWidth = hot ? 4 : 2; g.stroke();
      g.fillStyle = b.on ? '#ffd29a' : '#cfd6e6';
      g.font = `${b.kind === 'act' ? '600 28' : b.kind === 'room' ? '21' : '28'}px ui-monospace, Menlo, monospace`;
      let t = b.label; while (g.measureText(t).width > b.w - 28 && t.length > 3) t = t.slice(0, -2) + '…';
      g.textAlign = b.kind === 'song' ? 'left' : 'center';
      g.fillText(t, b.kind === 'song' ? b.x + 18 : b.x + b.w / 2, b.y + b.h / 2 + 1);
      g.textAlign = 'left';
    }
    g.font = '22px ui-monospace, Menlo, monospace'; g.fillStyle = '#5a6178';
    g.fillText('point + trigger to press  ·  Y closes', 40, MENU_H - 40);
    tex.needsUpdate = true;
  }

  const ray = new THREE.Raycaster();
  return {
    mesh,
    get open(){ return mesh.visible; },
    /* show it ~0.85 m in front of the head, at chest-up height, facing you (rig-local metres) */
    show(headPos, headYaw){
      const f = .85;
      mesh.position.set(headPos.x - Math.sin(headYaw) * f, headPos.y - .12, headPos.z - Math.cos(headYaw) * f);
      mesh.rotation.set(-.12, headYaw, 0, 'YXZ');
      const st = getState(); page = Math.max(0, Math.floor(Math.max(0, st.songs.findIndex(s => s.key === st.song)) / PER_PAGE));
      mesh.visible = true; drawn = ''; draw();
    },
    hide(){ mesh.visible = false; hover = null; cursor.visible = false; },
    /* a pointing ray (world origin + dir) → {button, distance, uv} | null — NO side effects (both
       hands are cast every frame; only the chosen one may set the hover) */
    cast(origin, dir){
      if (!mesh.visible) return null;
      ray.set(origin, dir);
      const hit = ray.intersectObject(mesh, false)[0];
      if (!hit?.uv) return null;
      return { button: hitButton(layout, hit.uv.x, hit.uv.y), distance: hit.distance, uv: hit.uv };
    },
    /* the ONE hit this frame (or null): hover highlight + cursor; redraws only when the hover changes */
    hover(h){
      if (h){ cursor.visible = true; cursor.position.set((h.uv.x - .5) * MENU_M[0], (h.uv.y - .5) * MENU_M[1], .002); }
      else cursor.visible = false;
      const id = h?.button?.id || null;
      if (id !== hover){ hover = id; drawn = ''; }
      draw();
      return h;
    },
    point(origin, dir){ return this.hover(this.cast(origin, dir)); },
    press(b){
      if (!b) return;
      if (b.kind === 'page'){ page = b.value; drawn = ''; draw(); return; }
      onPress(b);
      drawn = ''; draw();
    },
    refresh(){ if (mesh.visible) draw(); },
    /* (dev / tests) a button's centre in WORLD space, and the current buttons */
    buttonWorld(id){
      const b = layout.find(x => x.id === id); if (!b) return null;
      const u = (b.x + b.w / 2) / MENU_W, v = 1 - (b.y + b.h / 2) / MENU_H;
      mesh.updateWorldMatrix(true, false);
      return mesh.localToWorld(new THREE.Vector3((u - .5) * MENU_M[0], (v - .5) * MENU_M[1], 0));
    },
    get hoverId(){ return hover; },
    get buttons(){ return layout.map(b => ({ id: b.id, kind: b.kind, label: b.label, on: !!b.on })); },
  };
}
