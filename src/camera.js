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
  all:'#cfd6e6', lead:'#ffaa55', alto:'#c08bff', bass:'#66aaff', stage:'#9fe8ff',
};
const FIXED_OK = new Set(['all', 'auto', 'fixed', 'free', 'stage']);
/* DIRECTOR over STATIONS (instrument plugins + the drum machine): the song data is
   known, so main scores each station by what it is ABOUT to play (look-ahead) and
   the director cuts there before it happens — the same "sees the future" trick the
   track director uses. Cuts hold ≥ MIN_HOLD; a shot held past BORED loses its pull,
   so the film keeps moving round the room. A far jump is a hard CUT, a near one glides. */
const MIN_HOLD = 3.0, BORED = 7.5, SWITCH = 1.15, SWITCH_0 = 1.6, HARD_CUT = 12, STAGE_PULL = .9;
/* The BELT is the protagonist (the PATERNOSTER — it carries the tune): it competes as a
   station whose pull never drops below BELT_PULL × the room's level (BELT_ROOM × the mean
   score of the two busiest machines, ≥ 1) while a marble is live, rising with the arc
   it's about to throw (a long lob is the belt's own spotlight) up to BELT_MAX × that level.
   ROTATION keeps the film moving round the room instead of ping-ponging two machines:
     RECENT  — a shot just left is damped (×(1 − RECENT·e^(−ago/RECENT_T))), so a cut
               doesn't bounce straight back;
     UNSEEN  — a station off screen for over UNSEEN_0 s is boosted (ramping to ×(1+UNSEEN)
               over UNSEEN_T s more), so every machine gets its spotlight when it next plays. */
const BELT_PULL = 1.8, BELT_MAX = 2.7, SHRED_PULL = 2.1, BELT_ROOM = .6;    // ×(room level ≥ 1)
const RECENT = .45, RECENT_T = 6, UNSEEN = .6, UNSEEN_0 = 14, UNSEEN_T = 26, BELT_UNSEEN_0 = 8;
/* Room-mode extras (all fed by main's look-ahead over the song data):
     ENSEMBLE_N  — when ≥ this many machines land on one downbeat, go WIDE (ENSEMBLE_S)
     SKIM_S      — the lead's 16th-note skim is the money shot: hold the belt
     the loop seam (no music, no lead marble) breathes wide, never the empty-wall shot. */
const ENSEMBLE_N = 7, ENSEMBLE_S = 2.6, ENSEMBLE_REST = 4, SKIM_S = 2.8;   // REST: s off the wide before it re-earns one
const _Y = new THREE.Vector3(0, 1, 0);

/* Keyboard fly: key → [right, up, forward] screen-space contribution. */
const KEY_PAN = 0.65;                                         // pan units = KEY_PAN · distance · dt (scales with zoom)
const KEY_EASE = .0008;                                       // velocity smoothing — eased accel/decel, no hard start-stop
const PAN_KEYS = {
  arrowup: [0, 0, 1], w: [0, 0, 1], arrowdown: [0, 0, -1], s: [0, 0, -1],
  arrowleft: [-1, 0, 0], a: [-1, 0, 0], arrowright: [1, 0, 0], d: [1, 0, 0],
  e: [0, 1, 0], q: [0, -1, 0],                               // E lifts the eye up, Q drops it down
};

export function makeCameraRig({ stageY, fixedZMax, dom, camsEl, pathBlocked = null }){
  const BASE_FOV = 55;
  let freeFov = null;                                         // a lens override for the free eye (stage edit's plan view)
  const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth/innerHeight, .1, 200);
  /* a shot may carry its own lens (shot.fov — the room's WIDE is a wider lens: the hall is
     bigger than any eye position inside it can frame at 55°); every other pose is BASE_FOV.
     Eased like the pose, snapped on a hard cut. */
  function lens(want, dt, snap){
    if (Math.abs(camera.fov - want) < .01) return;
    camera.fov = snap ? want : camera.fov + (want - camera.fov) * (1 - Math.pow(.0015, dt));
    camera.updateProjectionMatrix();
  }

  // FREE-look is the default so you can move around the scene; the director ('auto') and
  // the rest are one button-tap away. Free orbit still only engages once `started` (after
  // the play tap), so it can never swallow the iOS audio-priming tap.
  const DEFAULT_MODE = 'free';
  let mode = DEFAULT_MODE, autoWant = 'all', lastCut = 0;
  let shakeAmp = 0;
  let stageView = { cx: 0, halfW: 8 };                        // x-centre + half-width of the field (FIXED framing)
  let curTracks = [];                                         // last-built tracks, for the button row
  let stations = [], stage = null;                            // [{key, eye, aim, color}] + the wide {eye, aim}
  let cutNow = false, openUntil = -Infinity, stageOff = -99;
  let lastSeen = {};                                          // director: shot key → time it was last on screen
  let dbgCand = null, dbgRotate = null, dbgFloor = 0;         // the director's last weighing (dev: __dev.weigh)
  const _ideal = new THREE.Vector3(), _aim = new THREE.Vector3(), _focus = new THREE.Vector3();

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
    if (curTracks.length < 2 && !stations.length){ camsEl.style.display = 'none'; mode = DEFAULT_MODE; return; }
    camsEl.style.display = 'flex';
    const multi = curTracks.length > 1;
    ['auto', ...(stations.length ? ['stage'] : []), 'fixed', 'free',
     ...(multi ? ['all', ...curTracks.map(t => t.role)] : []), ...stations.map(st => st.key)].forEach(m => {
      const b = document.createElement('button');
      b.className = 'camb' + (mode === m ? ' on' : '');
      if (mode === m) b.style.color = CAMCOLORS[m] || stations.find(st => st.key === m)?.color || '#cfd6e6';
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

  /* Called by buildWorld after syncTracks: the song's instrument stations (world-space
     eye + aim per station) and the wide STAGE shot. A song that brings stations opens
     on the director — it is the show; songs without keep the free-look default. */
  function syncStations(list, wide, { auto = true, openWide = false, openUntil: openT = 0 } = {}){
    const had = stations.length;
    stations = list; stage = wide;
    if (auto && list.length && !had && mode === DEFAULT_MODE) mode = 'auto';
    if (!list.length && mode === 'stage') mode = DEFAULT_MODE;
    if (!FIXED_OK.has(mode) && !curTracks.some(t => t.role === mode) && !list.some(st => st.key === mode)) mode = 'auto';
    autoWant = openWide ? 'stage' : 'all'; lastCut = -99;   // a full room opens on the wide reveal…
    lastSeen = {};                                            // a new song: every machine is unseen
    openUntil = openWide ? openT : -Infinity;                 // …held until songTime passes openT (count-in + downbeat)
    renderButtons();
  }

  function addShake(amt){ shakeAmp = Math.min(shakeAmp + amt, .15); }

  /* The per-frame pose. Mutates `camera`; leaves `camTarget` as the live aim (read
     by the debug HUD). marblePts = [{p, w, role}] of the live balls; leadRender is
     the lead ball's render position (or null). */
  function update({ dt, time, songTime = Infinity, tracks, marblePts, reduceMotion, started, stationScores }){
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
      lens(freeFov || BASE_FOV, dt, false);                  // (freeFov: stage edit's plan view — a wider lens)
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
      if (!stations.length){
        if (want !== autoWant && time - lastCut > 2.2){
          autoWant = want; lastCut = time;
        }
      } else if (songTime < openUntil){                      // the opening reveal: hold the wide
        autoWant = 'stage'; lastCut = time - MIN_HOLD;        // (and let the first real cut land at once)
      } else {                                                // the room director: tracks vs stations vs wide
        const sc = stationScores || {};
        // the belt competes like a station: a long arc no longer outranks a busy machine
        // (raw dt in seconds used to win ~a third of the film on a dark wall)
        if (autoWant === 'stage') stageOff = time;
        const ensemble = (sc._ensemble ?? 0) >= ENSEMBLE_N && !sc._skim && !sc._forceSoon && time - stageOff > ENSEMBLE_REST;
        const cand = { stage: Math.max(STAGE_PULL, ensemble ? ENSEMBLE_S : 0) };
        stations.forEach(st => { cand[st.key] = sc[st.key] ?? 0; });
        // the belt: the protagonist. Its floor is RELATIVE to the room (a dense orchestra scores
        // every station 2–4; a sparse one under 1) — level with its busiest machines —
        // and rises with the arc it's about to throw (a long lob is the belt's own spotlight)
        let top1 = 0, top2 = 0;                               // the two busiest machines set the room's level
        stations.forEach(st => { const v = sc[st.key] ?? 0; if (v > top1){ top2 = top1; top1 = v; } else if (v > top2) top2 = v; });
        const floor = Math.max(1, BELT_ROOM * (top1 + top2) / 2);
        if (marblePts.length) cand[want] = floor * (want === 'all' ? BELT_PULL
          : score > 1 ? Math.min(BELT_PULL + (score - 1.05) * .6, BELT_MAX) : SHRED_PULL);
        if (!lastSeen._init){                                 // a new song: the clock of "unseen" starts now
          lastSeen = { _init: true, _belt: time }; stations.forEach(st => { lastSeen[st.key] = time; });
        }
        lastSeen[autoWant] = time;                            // (this frame's shot counts as seen)
        if (autoWant !== 'stage' && !stations.some(st => st.key === autoWant)) lastSeen._belt = time;
        const ago = k => time - (lastSeen[k] ?? time);
        const isSt = k => stations.some(st => st.key === k);
        const rotate = (k, v) => k === 'stage' ? v       // (the belt shares one "seen" clock across its roles)
          : isSt(k) ? v * (1 - RECENT * Math.exp(-ago(k) / RECENT_T)) * (1 + UNSEEN * Math.min(1, Math.max(0, ago(k) - UNSEEN_0) / UNSEEN_T))
          : v * (1 - .5 * RECENT * Math.exp(-ago('_belt') / RECENT_T))     // the belt: the protagonist grows
              * (1 + UNSEEN * Math.min(1, Math.max(0, ago('_belt') - BELT_UNSEEN_0) / UNSEEN_T));   // impatient off screen sooner
        dbgCand = cand; dbgRotate = rotate; dbgFloor = floor;
        const held = time - lastCut;
        // an ordinary cut lands ON THE MUSIC: on the next beat — or the next bar line when that
        // is under a beat away — never on the hold timer's tick; and never just ahead of a
        // FORCED cut (a skim / an entrance / the seam within MIN_HOLD): hold, then take that one
        const onGrid = sc._onBar || (sc._onBeat && !sc._barSoon) || sc._onBeat === undefined;
        const quiet = !((sc._forcedWithin ?? Infinity) < MIN_HOLD);
        // a marginal challenger can't win the instant the timer lets it: the bar to switch
        // starts high (SWITCH_0 at MIN_HOLD) and relaxes to SWITCH by the time the shot is BORED
        const sw = SWITCH + (SWITCH_0 - SWITCH) * Math.max(0, Math.min(1, (BORED - held) / (BORED - MIN_HOLD)));
        const cut = k => { if (autoWant !== k){ autoWant = k; lastCut = time; cutNow = true; } };
        // a station's ENTRANCE (several can share a downbeat): cut on the one seen least recently
        const forced = (sc._force || []).filter(k => stations.some(st => st.key === k));
        const force = forced.includes(autoWant) ? autoWant : forced.sort((a, b) => ago(b) - ago(a))[0];
        const scripted = sc._script && (sc._script === 'stage' || stations.some(st => st.key === sc._script) ||
          (marblePts.length && tracks.some(t => t.role === sc._script)));
        if (scripted) cut(sc._script);                        // the song's SCRIPTED story beat (song.director.script)
        else if (sc._skim) cut('lead');                       // the money shot: the lead's skim, no matter the hold
        else if (force) cut(force);
        else if (sc._seam) cut('stage');                      // the loop seam: breathe wide, re-open on the newborn's fall
        else {
          // (on the belt, the incumbent is whichever belt framing is live: its pull is the belt's)
          const cur = (cand[autoWant] ?? (autoWant !== 'stage' && !isSt(autoWant) && marblePts.length ? cand[want] : 0) ?? 0) * (held > BORED ? .45 : 1);
          let best = autoWant, bestS = -1;
          for (const k in cand) if (k !== autoWant){ const v = rotate(k, cand[k]); if (v > bestS){ best = k; bestS = v; } }
          if (held > MIN_HOLD && quiet && onGrid && bestS > cur * sw) cut(best);
        }
      }
      effMode = autoWant;
    }
    const shot0 = effMode === 'stage' ? stage : stations.find(st => st.key === effMode);
    const shot = (camera.aspect < .9 && shot0?.portrait) || shot0;   // a shot may carry its own portrait framing

    // hold a fixed stage view, follow the chosen marble, or frame them all
    const sway = (reduceMotion || mode === 'fixed') ? 0 : Math.sin(time*.21);
    let ideal = _ideal, aim = _aim;
    if (mode === 'fixed'){
      // STATIONARY WORLD CAM: a held pose that frames the whole pad field — no chase,
      // no sway, no shake. Glides into place once (shared lerp below) then holds dead still.
      const margin = 4;                                       // world-unit breathing room around the field
      const zFit = (stageView.halfW + margin) /
        (Math.tan(THREE.MathUtils.degToRad(camera.fov/2)) * Math.min(camera.aspect, 1.7));
      const z = THREE.MathUtils.clamp(zFit, 16, fixedZMax);   // fit the width, but never pull back into the fog
      ideal.set(stageView.cx + z*0.22, stageY + 5, z);         // gentle 3/4, slightly above the band
      aim.set(stageView.cx, stageY + 1.5, 0);
    } else if (shot){
      // a STATION shot: its own eye → aim, with a slow orbit drift so a held shot breathes.
      // Aspect-aware like FIXED: a narrow (portrait) frame pulls the eye back along its
      // own line so the station still fits side to side.
      const fit = Math.min(shot.fitMax ?? Infinity, Math.pow(Math.max(1, 1.5 / camera.aspect), .6));   // fitMax: the eye can't leave the room
      aim.copy(shot.aim);
      ideal.copy(shot.eye).sub(aim).multiplyScalar(fit).applyAxisAngle(_Y, sway * .12).add(aim);
    } else {
      const followed = effMode !== 'all' ? marblePts.find(m => m.role === effMode) : null;
      const focus = _focus.set(0, 0, 0);
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
      // VERTICAL IS (MOSTLY) PINNED: the band is static, so the camera doesn't bob with
      // every bounce. x/z follow the marble (with sway + spread-dolly). In a full ROOM the
      // follow sits further back and gives a PARTIAL vertical follow above the band (lift),
      // so the top of a tall arc (apex ~8 u) stays in frame; the shared lerp smooths it.
      const room = stations.length > 0;
      ideal.copy(focus); ideal.x += (4.5 + sway*2.2)*back; ideal.z += ((room ? 13 : 9.5) - sway*1.4)*back;
      const lift = room && marblePts.length ? Math.max(0, focus.y - stageY - 2.5) : 0;
      ideal.y = stageY + 3.4 + lift*.4;                       // eye height: the band plane (+ a share of the lift)
      aim.copy(focus); aim.y = stageY + .6 + lift*.6;         // look at the band centre, not the bobbing marble
    }
    // a director cut GLIDES only when it's short AND the glide's straight line is clear air —
    // never a dolly through a machine (main's pathBlocked raycasts the world); otherwise CUT
    // …and a cut that changes LENS is a cut too (a glide keeps its focal length: a dolly that
    // zooms on the way reads as a lurch, not a move)
    const fovWant = (mode !== 'fixed' && shot?.fov) || BASE_FOV;
    const hard = cutNow && (camPos.distanceTo(ideal) > HARD_CUT || Math.abs(camera.fov - fovWant) > 1
      || !!(pathBlocked && pathBlocked(camPos, ideal)));
    if (hard){ camPos.copy(ideal); camTarget.copy(aim); }
    lens(fovWant, dt, hard);
    cutNow = false;
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

  return { camera, target: camTarget, orbit, update, syncTracks, syncStations, addShake, resize,
           get mode(){ return mode; }, set mode(m){ mode = m; renderButtons(); },
           get freeFov(){ return freeFov; }, set freeFov(f){ freeFov = f || null; if (f){ camera.fov = f; camera.updateProjectionMatrix(); } }, get shot(){ return autoWant; }, get weigh(){
             return dbgCand && { cand: dbgCand, floor: dbgFloor, rot: Object.fromEntries(Object.keys(dbgCand).map(k => [k, +dbgRotate(k, dbgCand[k]).toFixed(2)])) }; } };
}
