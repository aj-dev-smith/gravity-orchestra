import * as THREE from 'three';
import { U_PER_M, PAD_R, planAnchors, tourAt, pickAnchor, throwArc, rigFor, earFrame } from './xrplan.js';
import { makeXRMenu } from './xrmenu.js';

/* ============================================================
   XR — the WebXR render subsystem (Meta Quest 2 first; any immersive-vr browser).
   Render-time framing only, like the camera rig: the engine, every machine and the audio
   path never know a headset is there. Time is still the only state — VR just puts your
   head where the director's camera was.

   makeXR({deps}) — same thin DI seam as the other make* rigs. It owns:
   - the ENTER VR (and ENTER AR) buttons, shown ONLY when navigator.xr says the mode is
     supported (no navigator.xr → nothing is added: desktop / iOS pages are untouched);
   - the DOLLY: the user's rig, scaled U_PER_M (≈ 1.48 u/m) so a marble falls at a true
     9.81 m/s² in the headset (xrplan.js — honest gravity, not a floaty diorama);
   - the catwalk PADS you stand on (anchors solved from the director's shot eyes, xrplan.js),
     the teleport ARC (a solved marble throw onto the pad), the fade, snap turn, TOUR mode
     (the director's edit replayed as fade-cuts — a pure fn of songTime, never a glide);
   - controllers (procedural chrome wands — no CDN profile fetch) + a wrist label;
   - the head pose for spatial audio (`ear`) and the rooms (`viewer`).
   main renders scene/camera directly while presenting (EffectComposer can't do XR) and
   skips the camera rig + the perf governor.

   CONTROLS (Quest Touch):
     right stick ↑ (or hold right trigger) — aim the throw · release — teleport to the lit pad
     right stick ←/→ — snap turn 30°      A — tour on/off (the director drives)   B — play/pause
     left stick ←/→ — scrub time          X — next pad                           Y — the MENU
   THE MENU (src/xrmenu.js): an in-world panel — song, room, play/pause, tour, next pad, exit.
   Point either controller at it, trigger to press. While it's open the triggers press, not throw.
   The director / ride cam NEVER move the headset: the head is yours; TOUR only teleports (blink).
   ============================================================ */

const SNAP = Math.PI / 6;                               // snap-turn step
const FADE_OUT = .12, FADE_IN = .16;                    // teleport blink (s, real time — UI, not song state)
const MAX_PADS = 32;
const SCRUB_RATE = 4;                                   // song seconds per real second at full stick
const DOTS = 25;                                        // teleport-arc marbles

export function makeXR({ renderer, scene, camera, envMap, glowTex, enterSound, gestureRetry, onSession,
                         getTime, setTime, getRate, setRate, nextSong, songLabel, shotAt, menu: M = null }){
  const q = new URLSearchParams(location.search);
  const root = new THREE.Group(); root.name = 'xr';
  const dolly = new THREE.Group(); dolly.scale.setScalar(U_PER_M);
  root.add(dolly);
  const viewer = new THREE.Object3D();                  // head pose in WORLD (rooms + spatial audio read it)
  let session = null, mode = null, anchors = [], cur = -1, hover = -1, tour = false, aimHand = null;
  let fade = 0, fadeDir = 0, pending = null, wasAim = false, turnArmed = true, latch = false;
  const edges = {};                                     // button edge detect per hand+index
  let saved = null;

  /* ---- catwalk pads: the one you stand on is solid brass; every other is a faint glass disc
     with a lit rim (seen from across the hall a solid pad would sit right in another shot) ---- */
  const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, metalness: .85, roughness: .32, envMap, envMapIntensity: 1.1 });
  const padGeo = new THREE.CylinderGeometry(PAD_R, PAD_R * .9, .16, 40);
  const disc = new THREE.Mesh(padGeo, brass);           // under your feet
  const ghost = new THREE.InstancedMesh(padGeo, new THREE.MeshBasicMaterial({ color: 0x6f86c0, transparent: true, opacity: .12,
    depthWrite: false }), MAX_PADS);
  const rim = new THREE.InstancedMesh(new THREE.TorusGeometry(PAD_R, .05, 8, 64).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_PADS);
  ghost.count = rim.count = 0; ghost.frustumCulled = rim.frustumCulled = false; disc.visible = false;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffb764, blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true, opacity: .55 }));
  glow.scale.set(PAD_R * 3, PAD_R * 3, 1); glow.visible = false;
  glow.material.userData.noFadeGate = true;
  root.add(disc, ghost, rim, glow);
  const _m = new THREE.Matrix4(), _c = new THREE.Color();
  function layoutPads(){
    ghost.count = rim.count = Math.min(MAX_PADS, anchors.length);
    for (let i = 0; i < rim.count; i++){
      const p = anchors[i].pos;
      ghost.setMatrixAt(i, _m.makeTranslation(p[0], p[1] - .08, p[2]));
      rim.setMatrixAt(i, _m.makeTranslation(p[0], p[1] + .005, p[2]));
    }
    ghost.instanceMatrix.needsUpdate = rim.instanceMatrix.needsUpdate = true;
    paintPads();
  }
  function paintPads(){
    for (let i = 0; i < rim.count; i++){
      _c.set(anchors[i].color);
      const k = i === hover ? 1.6 : i === cur ? .9 : .35;
      rim.setColorAt(i, _c.multiplyScalar(k));
    }
    if (rim.instanceColor) rim.instanceColor.needsUpdate = true;
    const a = anchors[cur];                             // the solid floor under your feet
    disc.visible = !!a;
    if (a) disc.position.set(a.pos[0], a.pos[1] - .08, a.pos[2]);
  }

  /* ---- the teleport arc: a string of small marbles along the solved throw ---- */
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(.06, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0xffc070 }), DOTS);
  dots.frustumCulled = false; dots.visible = false;
  root.add(dots);

  /* ---- controllers: chrome wands with an amber tip, a short pointing ray ---- */
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: .15, envMap, envMapIntensity: 1.4 });
  const tipMat = new THREE.MeshBasicMaterial({ color: 0xffa040 });
  // (grip space: −z runs forward out of the fist — the wand lies along it, the tip leads)
  const wandGeo = new THREE.CylinderGeometry(.009, .015, .13, 16).rotateX(-Math.PI / 2).translate(0, 0, -.025);
  const tipGeo = new THREE.SphereGeometry(.012, 16, 12).translate(0, 0, -.096);
  const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -.6)]);
  const rayMat = new THREE.LineBasicMaterial({ color: 0xffb764, transparent: true, opacity: .7 });
  const hands = {};                                     // handedness → {ctrl, grip, src, ray}
  for (let i = 0; i < 2; i++){
    const ctrl = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i);
    grip.add(new THREE.Mesh(wandGeo, chrome), new THREE.Mesh(tipGeo, tipMat));
    const ray = new THREE.Line(rayGeo, rayMat); ray.visible = false; ctrl.add(ray);
    const h = { ctrl, grip, src: null, ray };
    ctrl.addEventListener('connected', e => { h.src = e.data; if (e.data.handedness) hands[e.data.handedness] = h;
      if (e.data.handedness === 'left') grip.add(panel); });
    ctrl.addEventListener('disconnected', () => { for (const k in hands) if (hands[k] === h) delete hands[k]; h.src = null; });
    dolly.add(ctrl, grip);
  }

  /* ---- wrist label (left grip): song · pad · TOUR / PAUSED ---- */
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 192;
  const ctx2 = cv.getContext('2d'), tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(.12, .045),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  panel.position.set(0, .03, .05); panel.rotation.x = -.9;   // over the back of the left hand
  let panelText = '';
  function drawPanel(){
    const a = anchors[hover >= 0 ? hover : cur];
    const lines = [songLabel?.() || 'ORCHESTRION',
      `${hover >= 0 ? '→ ' : ''}${a ? a.label : ''}`,
      `${tour ? 'TOUR' : 'FREE'}${getRate() ? '' : ' · PAUSED'} · ${getTime().toFixed(0)}s · Y MENU`];
    const s = lines.join('|');
    if (s === panelText) return;
    panelText = s;
    ctx2.clearRect(0, 0, 512, 192);
    ctx2.fillStyle = 'rgba(7,6,14,.78)'; ctx2.beginPath(); ctx2.roundRect(4, 4, 504, 184, 28); ctx2.fill();
    ctx2.strokeStyle = 'rgba(255,183,100,.55)'; ctx2.lineWidth = 3; ctx2.stroke();
    ctx2.font = '600 40px ui-monospace, Menlo, monospace'; ctx2.fillStyle = '#ffb764';
    ctx2.fillText(lines[0].slice(0, 22), 26, 62);
    ctx2.font = '32px ui-monospace, Menlo, monospace'; ctx2.fillStyle = '#cfd6e6';
    ctx2.fillText(lines[1].slice(0, 26), 26, 112);
    ctx2.font = '26px ui-monospace, Menlo, monospace'; ctx2.fillStyle = '#7d859c'; ctx2.fillText(lines[2], 26, 160);
    tex.needsUpdate = true;
  }

  /* ---- the in-world MENU (Y): song · room · transport (the HTML UI is unreachable in VR) ---- */
  const menu = makeXRMenu({
    getState: () => ({ songs: M?.songs() || [], song: M?.song(), rooms: M?.rooms() || [], room: M?.room(),
      playing: !!getRate(), tour, ar: mode === 'ar', time: getTime() }),
    onPress(b){
      if (b.kind === 'song'){ if (b.value !== M?.song()) M?.setSong(b.value); }
      else if (b.kind === 'room') M?.setRoom(b.value);
      else if (b.id === 'play') setRate(getRate() ? 0 : 1);
      else if (b.id === 'tour') tour = !tour;
      else if (b.id === 'pad'){ tour = false; go((cur + 1) % Math.max(1, anchors.length)); }
      else if (b.id === 'close') menu.hide();
      else if (b.id === 'exit'){ menu.hide(); exit(); }
    } });
  dolly.add(menu.mesh);
  const _eu = new THREE.Euler(0, 0, 0, 'YXZ');
  function toggleMenu(){
    if (menu.open){ menu.hide(); return; }
    _eu.setFromQuaternion(camera.quaternion, 'YXZ');    // the head in the rig (metres): the panel opens where you look
    menu.show(camera.position, _eu.y);
  }

  /* ---- the blink: a navy shell around the head (fades the world out/in on every move) ---- */
  const veil = new THREE.Mesh(new THREE.SphereGeometry(.3, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x07060e, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
  veil.renderOrder = 1e9; veil.frustumCulled = false; veil.visible = false;

  /* ---------------- moving the rig ---------------- */
  const _hp = new THREE.Vector3(), _hq = new THREE.Quaternion(), _hs = new THREE.Vector3();
  function headLocal(){ return [camera.position.x, camera.position.y, camera.position.z]; }   // (metres, in the rig)
  function place(id){
    const a = anchors[id]; if (!a) return;
    const r = rigFor(a, session ? headLocal() : [0, 0, 0]);
    dolly.position.set(r.x, r.y, r.z); dolly.rotation.set(0, r.yaw, 0);
    cur = id; paintPads();
  }
  function go(id){                                      // fade → move → fade (never a glide)
    if (id < 0 || id >= anchors.length) return;
    if (!session){ place(id); return; }
    pending = { id }; fadeDir = 1;
  }
  function turn(sign){                                  // snap turn about the HEAD (it stays where it is)
    camera.getWorldPosition(_hp);
    dolly.rotation.y += sign * SNAP;
    dolly.updateMatrixWorld(true);
    const after = camera.position.clone().applyMatrix4(dolly.matrixWorld);
    dolly.position.x += _hp.x - after.x; dolly.position.z += _hp.z - after.z;
  }

  /* ---------------- sessions ---------------- */
  async function enter(m = 'vr'){
    if (session || !navigator.xr) return false;
    // THE gesture: build audio inside it (§5 round 2). No gestureRetry here: a context built a
    // moment ago still reads currentTime 0 and would be torn down and rebuilt at once (and the
    // page's own pointerdown listener already retries for this same tap once audio has started)
    try { enterSound?.(); } catch(e){}
    const s = await navigator.xr.requestSession(m === 'ar' ? 'immersive-ar' : 'immersive-vr',
      { optionalFeatures: ['local-floor', 'bounded-floor', 'layers', 'hand-tracking'] });
    session = s; mode = m;
    saved = { parent: camera.parent, pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov,
              zoom: camera.zoom, near: camera.near, far: camera.far };
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setFramebufferScaleFactor(+(q.get('xrscale') || 1));
    camera.position.set(0, 0, 0); camera.quaternion.identity();
    dolly.add(camera); camera.add(veil); veil.visible = true;
    scene.add(root);
    fade = 1; fadeDir = -1;                              // open from black: the program compiles happen behind it
    s.addEventListener('selectstart', () => gestureRetry?.());   // a select IS a user gesture (WebXR spec) — once per press, any input
    onSession?.(true, m);
    place(Math.max(0, cur));
    await renderer.xr.setSession(s);
    renderer.xr.setFoveation(1);
    const hz = +(q.get('xrhz') || 72);
    if (s.supportedFrameRates?.includes?.(hz) && s.updateTargetFrameRate) s.updateTargetFrameRate(hz).catch(() => {});
    try { renderer.compile(scene, camera); } catch(e){}
    return true;
  }
  function ended(){
    if (!session) return;
    session = null;
    scene.remove(root); camera.remove(veil); dolly.remove(camera);
    if (saved.parent) saved.parent.add(camera);
    camera.position.copy(saved.pos); camera.quaternion.copy(saved.quat); camera.scale.set(1, 1, 1);
    Object.assign(camera, { fov: saved.fov, zoom: saved.zoom, near: saved.near, far: saved.far });
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    renderer.xr.enabled = false;
    dots.visible = glow.visible = false; hover = -1; aimHand = null; tour = false; menu.hide();
    onSession?.(false, mode); mode = null;
  }
  async function exit(){ if (session) await session.end(); }
  renderer.xr.addEventListener('sessionend', ended);     // (three's own teardown — canvas size, loop — has run by now)

  /* ---------------- per frame (presenting only) ---------------- */
  const _o = new THREE.Vector3(), _d = new THREE.Vector3();
  function btn(h, src, i){                              // rising edge of gamepad button i
    const p = !!src?.gamepad?.buttons?.[i]?.pressed, k = h + i, was = edges[k];
    edges[k] = p; return p && !was;
  }
  function update(dt, songTime){
    if (!session) return;
    // the blink
    if (fadeDir){
      fade += fadeDir * dt / (fadeDir > 0 ? FADE_OUT : FADE_IN);
      if (fade >= 1){ fade = 1; if (pending){ place(pending.id); pending = null; } fadeDir = -1; }
      if (fade <= 0){ fade = 0; fadeDir = 0; }
    }
    veil.material.opacity = fade; veil.visible = fade > .001;

    const R = hands.right?.src, L = hands.left?.src;
    const ra = R?.gamepad?.axes || [], la = L?.gamepad?.axes || [];
    // ---- aim + throw (right stick up, or a held trigger on either hand) ----
    const trigR = !!R?.gamepad?.buttons?.[0]?.pressed, trigL = !!L?.gamepad?.buttons?.[0]?.pressed;
    // ---- the MENU: while open, either hand points at it and its trigger presses (no throws) ----
    const pressR = btn('r', R, 0), pressL = btn('l', L, 0);   // (edges tracked every frame, open or not)
    if (menu.open){
      let best = null;
      for (const k of ['right', 'left']){ const h = hands[k]; if (!h) continue;
        h.ctrl.getWorldPosition(_o); h.ctrl.getWorldDirection(_d).negate();
        const hit = menu.cast(_o, _d);                  // (side-effect free: only the chosen hand sets the hover)
        if (hit && !best){ best = { k, hit }; }
        h.ray.visible = !!hit; if (hit) h.ray.scale.z = Math.max(.05, hit.distance / U_PER_M / .6);
      }
      menu.hover(best ? best.hit : null);
      if (best && ((best.k === 'right' && pressR) || (best.k === 'left' && pressL))){ menu.press(best.hit.button); latch = true; }
    } else for (const k in hands) hands[k].ray.scale.z = 1;
    if (!trigR && !trigL) latch = false;                // a press that closed the menu must be released before it can throw
    const aim = menu.open || latch ? null : (ra[3] ?? 0) < -.55 || trigR ? 'right' : trigL ? 'left' : null;
    if (aim){
      const h = hands[aim];
      h.ctrl.getWorldPosition(_o); h.ctrl.getWorldDirection(_d).negate();   // a target ray points down its −z
      hover = pickAnchor(anchors, _o, _d, { skip: cur });
      for (const k in hands) hands[k].ray.visible = k === aim;
      if (hover >= 0){
        const a = anchors[hover], arc = throwArc(_o, [a.pos[0], a.pos[1] + .1, a.pos[2]], DOTS - 1);
        // the marbles swell along the throw (tiny at the hand — they'd fill the eye there)
        arc.pts.forEach((p, i) => { const k = .15 + .85 * Math.min(1, i / (DOTS * .4));
          dots.setMatrixAt(i, _m.makeScale(k, k, k).setPosition(p.x, p.y, p.z)); });
        dots.instanceMatrix.needsUpdate = true; dots.visible = true;
        glow.position.set(a.pos[0], a.pos[1] + .4, a.pos[2]); glow.visible = true;
      } else { dots.visible = false; glow.visible = false; }
      aimHand = aim; paintPads();
    } else if (wasAim){                                 // released: throw yourself onto the lit pad
      for (const k in hands) hands[k].ray.visible = false;
      dots.visible = glow.visible = false;
      if (hover >= 0 && !menu.open){ tour = false; go(hover); }   // (Y mid-aim: the throw is cancelled)
      hover = -1; aimHand = null; paintPads();
    } else if (!menu.open) for (const k in hands) hands[k].ray.visible = false;
    wasAim = !!aim;
    // ---- snap turn (right stick x) ----
    const sx = ra[2] ?? 0;
    if (!aim && turnArmed && Math.abs(sx) > .7){ turn(sx > 0 ? -1 : 1); turnArmed = false; }
    if (Math.abs(sx) < .3) turnArmed = true;
    // ---- buttons ----
    if (btn('r', R, 4)){ tour = !tour; }                               // A: tour
    if (btn('r', R, 5)) setRate(getRate() ? 0 : 1);                   // B: play / pause
    if (btn('l', L, 4)){ tour = false; go((cur + 1) % Math.max(1, anchors.length)); }   // X: next pad
    if (btn('l', L, 5)) toggleMenu();                                  // Y: the menu (song · room · transport)
    menu.refresh();
    // ---- scrub (left stick x): time is the only state, so this is just assigning it ----
    const lx = la[2] ?? 0;
    if (Math.abs(lx) > .15) setTime(getTime() + Math.sign(lx) * (Math.abs(lx) - .15) / .85 * SCRUB_RATE * dt);
    // ---- tour: the director's edit, as cuts between pads ----
    if (tour && shotAt && !fadeDir && anchors.length){
      const id = tourAt(shotAt, anchors, songTime);
      if (id >= 0 && id !== cur) go(id);
    }
    // the head, in world (rooms + spatial audio)
    camera.updateMatrixWorld(true);
    camera.matrixWorld.decompose(_hp, _hq, _hs);
    viewer.position.copy(_hp); viewer.quaternion.copy(_hq); viewer.updateMatrixWorld(true);
    drawPanel();
  }

  /* SPATIAL AUDIO in XR: the strike relative to the HEAD (world units, rotation only — the
     rig's scale is not a distance), a headset's ~90° per-eye field (tanH 1), and the shot
     focus = head → the current pad's aim (spatial.js keeps its contract unchanged). */
  function ear(worldPos){ return earFrame(worldPos, viewer, anchors[cur]?.aim); }

  /* anchors for the current song (main calls this whenever the director re-solves) */
  function setAnchors(input){
    const keep = anchors[cur]?.key;
    anchors = planAnchors(input);
    layoutPads();
    // a new song opens on the LEAD belt's pad (eye level with the strike band) — else the wide
    const again = anchors.findIndex(a => a.key === keep), lead = anchors.findIndex(a => a.key === 'lead');
    const id = again >= 0 ? again : lead >= 0 ? lead : 0;
    if (session) go(id); else cur = id;
  }

  /* ---------------- the buttons (only when the mode is really there) ---------------- */
  const ui = [];
  async function offer(m, label){
    try {
      if (!navigator.xr?.isSessionSupported || !(await navigator.xr.isSessionSupported(m === 'ar' ? 'immersive-ar' : 'immersive-vr'))) return;
    } catch(e){ return; }
    let box = document.getElementById('xrbtns');
    if (!box){
      box = document.createElement('div'); box.id = 'xrbtns';
      box.style.cssText = 'position:fixed;top:112px;right:20px;display:flex;flex-direction:column;gap:8px;align-items:flex-end;z-index:11';
      document.body.appendChild(box);
    }
    const b = document.createElement('button');
    b.className = 'camb'; b.textContent = label;
    b.style.cssText = 'color:#ffb764;border-color:rgba(255,183,100,.55)';
    b.addEventListener('click', e => { e.stopPropagation(); session ? exit() : enter(m).catch(err => console.warn('cascade xr:', err.message)); });
    box.appendChild(b); ui.push(b);
  }
  (async () => {
    // DEV ONLY: ?xremu installs Meta's WebXR emulator (IWER, Quest 2 profile) — never in a build
    if (import.meta.env.DEV && q.has('xremu')){
      const { XRDevice, metaQuest2 } = await import('iwer');
      const dev = new XRDevice(metaQuest2);
      dev.stereoEnabled = true;                         // both eyes into the canvas (the screenshot is the stereo frame)
      dev.installRuntime({ forceInstall: true });       // desktop Chrome HAS a native navigator.xr: force, or requestSession fails
      window.__xrdev = dev;
    }
    await offer('vr', 'ENTER VR');
    if (q.has('ar') || /OculusBrowser/i.test(navigator.userAgent)) await offer('ar', 'ENTER AR');
  })();

  return {
    update, ear, setAnchors, enter, exit, viewer,
    get presenting(){ return !!session; }, get mode(){ return mode; },
    get anchors(){ return anchors; }, get cur(){ return cur; },
    get tour(){ return tour; }, set tour(v){ tour = !!v; },
    go, turn,
    dev: {                                              // window.__dev.xr (scripts/xr-shot.mjs drives these)
      enter: m => enter(m), exit, go: id => go(id), turn: s => turn(s),
      menu: { toggle: () => toggleMenu(), get open(){ return menu.open; }, get hover(){ return menu.hoverId; }, mesh: menu.mesh,
        get buttons(){ return menu.buttons; }, at: id => menu.buttonWorld(id)?.toArray() },
      get tour(){ return tour; }, set tour(v){ tour = !!v; },
      info: () => ({ presenting: !!session, mode, cur, hover, tour, anchors: anchors.map(a => ({ id: a.id, key: a.key, label: a.label,
        pos: a.pos.map(v => +v.toFixed(2)) })), dolly: dolly.position.toArray().map(v => +v.toFixed(2)),
        head: viewer.position.toArray().map(v => +v.toFixed(2)), fade: +fade.toFixed(2),
        hands: Object.fromEntries(Object.entries(hands).map(([k, h]) => [k, h.ctrl.getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(2))])),
        arc: dots.visible ? [0, DOTS - 1].map(i => { dots.getMatrixAt(i, _m); return new THREE.Vector3().setFromMatrixPosition(_m).toArray().map(v => +v.toFixed(2)); }) : null,
        frameRate: session?.frameRate ?? null, fbScale: renderer.xr.getFramebufferScaleFactor?.() }),
    },
  };
}
