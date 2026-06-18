import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ============================================================
   CAMERA RIG — every way of looking at the static stage, in one
   place. The world is solved up front and the band is fixed, so
   the camera can "see the future": this module decides where to
   look, never what the world does. Pure render-time framing.

   Modes (the cam buttons pick one):
     auto  — DIRECTOR: cut to whichever track is about to do
             something big (a tall arc) before it happens.
     fixed — a held wide pose that frames the whole pad field.
     free  — hand it to the user: orbit-drag, zoom, and a WASD/
             arrows/QE fly rig (the seed of roaming a room).
     all / lead / alto / bass — follow that marble (or all).
   ============================================================ */

const CAMCOLORS = {
  auto:'#ffe9c9', fixed:'#7fe3c8', free:'#ff8fd0',
  all:'#cfd6e6', lead:'#ffaa55', alto:'#c08bff', bass:'#66aaff',
};
const FIXED_OK = new Set(['all', 'auto', 'fixed', 'free']);   // modes that survive a song change

/* Keyboard fly: key → [right, up, forward] screen-space contribution. */
const KEY_PAN = 0.65;                                         // pan units = KEY_PAN · distance · dt (scales with zoom)
const KEY_EASE = .0008;                                       // velocity smoothing — eased accel/decel, no hard start-stop
const PAN_KEYS = {
  arrowup: [0, 0, 1], w: [0, 0, 1], arrowdown: [0, 0, -1], s: [0, 0, -1],
  arrowleft: [-1, 0, 0], a: [-1, 0, 0], arrowright: [1, 0, 0], d: [1, 0, 0],
  e: [0, 1, 0], q: [0, -1, 0],                               // E lifts the eye up, Q drops it down
};

export function makeCameraRig({ stageY, fixedZMax, dom, camsEl }){
  const camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, .1, 200);

  let mode = 'auto', autoWant = 'all', lastCut = 0;
  let shakeAmp = 0;
  let stageView = { cx: 0, halfW: 8 };                        // x-centre + half-width of the field (FIXED framing)
  let curTracks = [];                                         // last-built tracks, for the button row

  const camTarget = new THREE.Vector3(0, stageY + .6, 0);     // the static band centre
  const camPos = new THREE.Vector3(4.5, stageY + 3.4, 9.5);
  camera.position.copy(camPos); camera.lookAt(camTarget);

  /* FREE-LOOK: hand the camera to the user. The conveyor world is STATIC — the
     marble juggles in a fixed band — so there's a stable thing to orbit; this is
     pure render-time framing, the engine never knows. Disabled until 'free' is
     actually picked (and the canvas sits behind the play overlay) so it can never
     swallow the iOS audio-priming tap (§3 of the handoff). */
  const orbit = new OrbitControls(camera, dom);
  orbit.enableDamping = true; orbit.dampingFactor = .06;       // weighty glide, not a rigid snap
  orbit.screenSpacePanning = true;                             // pan up = move UP (not along the ground plane)
  orbit.panSpeed = 0.9;                                        // calmer right-drag / two-finger pan
  orbit.rotateSpeed = 0.55;                                    // gentler left-drag orbit
  orbit.zoomSpeed = 0.6;                                       // gentler scroll / pinch dolly
  orbit.minDistance = 5; orbit.maxDistance = fixedZMax;        // never dolly back into the FogExp2
  orbit.maxPolarAngle = Math.PI * .92;                         // stop just shy of flying under the floor
  orbit.target.copy(camTarget);
  orbit.enabled = false;

  /* The keyboard is OURS, not OrbitControls' one-nudge-per-press (which feels
     glacial): a held-keys set integrated per frame, so motion is continuous and
     the speed is a real knob. W/S + ↑/↓ dolly through the pivot (forward/back,
     the FPS convention) so you keep travelling instead of stalling at it; A/D + ←/→
     strafe; Q/E lift/drop the eye. */
  const held = new Set();
  const _panR = new THREE.Vector3(), _panU = new THREE.Vector3(),
        _panF = new THREE.Vector3(), _panD = new THREE.Vector3(),
        _vel = new THREE.Vector3(), _desired = new THREE.Vector3();
  addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (mode !== 'free' || !(k in PAN_KEYS)) return;
    if (/^(input|textarea|select)$/i.test(e.target.tagName)) return;   // don't hijack the song picker
    held.add(k); e.preventDefault();
  });
  addEventListener('keyup', e => held.delete(e.key.toLowerCase()));
  function keyboardFly(dt){
    let rx = 0, uy = 0, fz = 0;
    held.forEach(k => { const [r, u, f] = PAN_KEYS[k]; rx += r; uy += u; fz += f; });
    _desired.set(0, 0, 0);
    if (rx || uy || fz){
      _panR.setFromMatrixColumn(camera.matrix, 0);            // camera right
      _panU.setFromMatrixColumn(camera.matrix, 1);            // camera up (screen-space vertical)
      _panF.setFromMatrixColumn(camera.matrix, 2).negate();   // camera forward (looks down −Z)
      const speed = KEY_PAN * camera.position.distanceTo(orbit.target);
      _desired.addScaledVector(_panR, rx).addScaledVector(_panU, uy).addScaledVector(_panF, fz)
        .normalize().multiplyScalar(speed);                   // normalize → diagonals aren't faster than straights
    }
    // Ease the live velocity toward the desired (toward zero when nothing's held), so the
    // fly accelerates in and coasts to a stop instead of snapping — the big smoothness win.
    _vel.lerp(_desired, 1 - Math.pow(KEY_EASE, dt));
    if (_vel.lengthSq() < 1e-7) return;
    _panD.copy(_vel).multiplyScalar(dt);
    camera.position.add(_panD); orbit.target.add(_panD);      // translate BOTH eye + pivot → no spurious rotation
  }

  /* The cam-button row. Hidden for single-track songs (the line IS the harmony). */
  function renderButtons(){
    camsEl.innerHTML = '';
    if (curTracks.length < 2){ camsEl.style.display = 'none'; mode = 'auto'; return; }
    camsEl.style.display = 'flex';
    ['auto', 'fixed', 'free', 'all', ...curTracks.map(t => t.role)].forEach(m => {
      const b = document.createElement('button');
      b.className = 'camb' + (mode === m ? ' on' : '');
      if (mode === m) b.style.color = CAMCOLORS[m];
      b.textContent = m.toUpperCase();
      b.addEventListener('click', () => { mode = m; renderButtons(); });
      camsEl.appendChild(b);
    });
  }

  /* Called by buildWorld: re-frame for the new song and rebuild the button row.
     A mode that no longer maps to a track (e.g. 'alto' on a duo) falls back to auto. */
  function syncTracks(tracks, view){
    curTracks = tracks; stageView = view;
    if (!FIXED_OK.has(mode) && !tracks.some(t => t.role === mode)) mode = 'auto';
    renderButtons();
  }

  function addShake(amt){ shakeAmp = Math.min(shakeAmp + amt, .15); }

  /* The per-frame pose. Mutates `camera`; leaves `camTarget` as the live aim (read
     by the debug HUD). marblePts = [{p, w, role}] of the live balls; leadRender is
     the lead ball's render position (or null). */
  function update({ dt, time, tracks, marblePts, reduceMotion, started }){
    // FREE-LOOK vs DIRECTOR. The orbit camera owns the pose only in 'free' (and only
    // after the play gesture). Entering, we seed its target from the live aim; while
    // active we shadow camPos/camTarget off the live camera, so the moment the user
    // hands control back the director lerps on from there instead of snapping.
    const freeNow = mode === 'free' && started;
    if (freeNow !== orbit.enabled){
      orbit.enabled = freeNow;
      if (freeNow) orbit.target.copy(camTarget);              // orbit around whatever we were framing
    }
    if (freeNow){
      keyboardFly(dt);                                        // WASD / arrows / QE fly the eye + pivot
      orbit.update();
      camPos.copy(camera.position); camTarget.copy(orbit.target);
      return;
    }

    // DIRECTOR: the timeline is known, so cut to the action before it happens
    let effMode = mode;
    if (mode === 'auto'){
      let want = 'all', score = 1.0;
      tracks.forEach(tr => {
        const s = tr._st; if (!s) return;
        // a big moment = a long arc in progress, or one about to launch
        const m = Math.max(s.dt < 8 ? s.dt : 0, (s.prog > .55 && s.next < 8) ? s.next : 0);
        if (m >= 1.05 && m > score){ score = m; want = tr.role; }
      });
      if (want === 'all' && tracks[0]._st && tracks[0]._st.dt <= .33) want = 'lead';  // shred cam
      if (want !== autoWant && time - lastCut > 2.2){
        autoWant = want; lastCut = time;
      }
      effMode = autoWant;
    }

    // hold a fixed stage view, follow the chosen marble, or frame them all
    const sway = (reduceMotion || mode === 'fixed') ? 0 : Math.sin(time*.21);
    let ideal, aim;
    if (mode === 'fixed'){
      // STATIONARY WORLD CAM: a held pose that frames the whole pad field — no chase,
      // no sway, no shake. Glides into place once (shared lerp below) then holds dead still.
      const margin = 4;                                       // world-unit breathing room around the field
      const zFit = (stageView.halfW + margin) /
        (Math.tan(THREE.MathUtils.degToRad(camera.fov/2)) * Math.min(camera.aspect, 1.7));
      const z = THREE.MathUtils.clamp(zFit, 16, fixedZMax);   // fit the width, but never pull back into the fog
      ideal = new THREE.Vector3(stageView.cx + z*0.22, stageY + 5, z);   // gentle 3/4, slightly above the band
      aim   = new THREE.Vector3(stageView.cx, stageY + 1.5, 0);
    } else {
      const followed = effMode !== 'all' ? marblePts.find(m => m.role === effMode) : null;
      const focus = new THREE.Vector3();
      let back = Math.max(1, 1.3 / Math.min(camera.aspect, 1.3));
      if (!marblePts.length){
        focus.set(0, stageY, 0);                              // pre-start (or between balls): frame the band
      } else if (followed){
        focus.copy(followed.p);
        back *= .92;                                          // tight, personal chase
      } else {
        let wSum = 0;
        marblePts.forEach(m => { focus.addScaledVector(m.p, m.w); wSum += m.w; });
        focus.divideScalar(wSum);
        let spread = 0;
        marblePts.forEach(m => spread = Math.max(spread, m.p.distanceTo(focus)));
        back *= (1 + Math.min(spread * .075, .7));
      }
      // VERTICAL IS PINNED: the band is static now, so the camera never cranes up/down.
      // x/z still follow the marble (with sway + spread-dolly); height is locked to the stage plane.
      ideal = focus.clone().add(new THREE.Vector3((4.5 + sway*2.2)*back, 0, (9.5 - sway*1.4)*back));
      ideal.y = stageY + 3.4;                                 // constant eye height — no spread-driven bob
      aim = focus.clone(); aim.y = stageY + .6;               // look at the band centre, not the bobbing marble
    }
    camPos.lerp(ideal, 1 - Math.pow(.0015, dt));
    camTarget.lerp(aim, 1 - Math.pow(.0008, dt));
    camera.position.copy(camPos);
    shakeAmp *= (1 - dt*7);
    if (!reduceMotion && mode !== 'fixed' && shakeAmp > .002){
      camera.position.x += (Math.random()-.5)*shakeAmp;
      camera.position.y += (Math.random()-.5)*shakeAmp;
    }
    camera.lookAt(camTarget);
  }

  function resize(){
    camera.aspect = innerWidth/innerHeight;
    camera.updateProjectionMatrix();
  }

  return { camera, target: camTarget, update, syncTracks, addShake, resize };
}
