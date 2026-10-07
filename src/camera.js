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
     ride  — RIDE THE BALL: sit just behind the lead marble on its
             own solved path, looking where it's going (ridecam.js —
             a pure fn of songTime). The director also cuts to a
             ride, sparingly, for a long tall flight (plan.ride).
   ============================================================ */

const CAMCOLORS = {
  auto:'#ffe9c9', fixed:'#7fe3c8', free:'#ff8fd0',
  all:'#cfd6e6', lead:'#ffaa55', alto:'#c08bff', bass:'#66aaff', stage:'#9fe8ff', ride:'#ffd36e',
};
const FIXED_OK = new Set(['all', 'auto', 'fixed', 'free', 'stage', 'ride']);
/* DIRECTOR over STATIONS (instrument plugins + the drum machine): the song is data, so
   main solves the loop's whole EDIT at song load (directorplan.js — what's special about
   each machine, beat by beat → a shot list) and the rig plays it back. A far jump is a
   hard CUT, a near one glides. Inside a planned belt shot the track director picks the
   framing (lead / alto / bass / all), switching at most every BELT_HOLD s. */
const HARD_CUT = 12, BELT_HOLD = 2.2;
const _Y = new THREE.Vector3(0, 1, 0);
/* KEEP THE MARBLE IN FRAME: a follow shot (all / lead / alto / bass) pulls its eye back along
   its own line just far enough that every marble it is ABOUT sits inside FIT of the frame — a
   tall arc's apex or a crane-hop lane ride over the housings used to sail out of the top. A
   closed-form fit (no search), capped at FIT_MAX and by the room's walls. */
const FIT = .86, FIT_MAX = 2.4;                               // (and never out through the room's walls)
/* …and when even that can't hold them (two marbles in bays a portrait frame can't span, the pull
   capped by FIT_MAX or the front wall), ALL is not a shot on this screen: the director drops to the
   heaviest single marble (the lead) until ALL has fit again for ALL_REST s. */
const ALL_REST = 1.5, ALL_HOLD = .35;
const _fo = new THREE.Vector3(), _fu = new THREE.Vector3(), _fR = new THREE.Vector3(), _fU = new THREE.Vector3(), _fq = new THREE.Vector3();
const _pI = new THREE.Vector3(), _pA = new THREE.Vector3(), _pF = new THREE.Vector3();

/* Keyboard fly: key → [right, up, forward] screen-space contribution. */
const KEY_PAN = 0.65;                                         // pan units = KEY_PAN · distance · dt (scales with zoom)
const KEY_EASE = .0008;                                       // velocity smoothing — eased accel/decel, no hard start-stop
const PAN_KEYS = {
  arrowup: [0, 0, 1], w: [0, 0, 1], arrowdown: [0, 0, -1], s: [0, 0, -1],
  arrowleft: [-1, 0, 0], a: [-1, 0, 0], arrowright: [1, 0, 0], d: [1, 0, 0],
  e: [0, 1, 0], q: [0, -1, 0],                               // E lifts the eye up, Q drops it down
};

/* ridePose(songTime, directed) → {eye, aim, fov} (THREE.Vector3s) | null — main's RIDE solve
   (ridecam.js over ballPos). directed: only inside a planned ride window (eased in/out);
   otherwise the manual RIDE mode's free-running pose on the lead. */
export function makeCameraRig({ stageY, fixedZMax, dom, camsEl, pathBlocked = null, ridePose = null }){
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
  let lastSig = '';                                           // the strip's button set last render (new set → scroll resets)
  let stations = [], stage = null;                            // [{key, eye, aim, color}] + the wide {eye, aim}
  let follow = null, bounds = null;                           // main's SOLVED follow offsets ({land, portrait}) + the eye's room box
  let cutNow = false, openUntil = -Infinity;
  let plan = null;                                            // director: main's solved edit ({at(songTime) → shot key})
  let allBadUntil = -Infinity, allFailSince = null;                                // director: ALL can't hold every marble on this screen until then
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
  /* Two parts: the CORE (auto / stage / free) always in reach, then every other angle in
     a SCROLLER that never wraps (a phone swipes it; index.html styles both). */
  function renderButtons(){
    const prev = camsEl.querySelector('.camscroll');
    const sig = [curTracks.map(t => t.role), stations.map(st => st.key)].join('|');
    const keep = prev && sig === lastSig ? prev.scrollLeft : 0;   // a re-render mustn't jump the strip; a new song resets it
    lastSig = sig;
    camsEl.innerHTML = '';
    if (curTracks.length < 2 && !stations.length){ camsEl.style.display = 'none'; mode = DEFAULT_MODE; return; }
    camsEl.style.display = 'flex';
    const multi = curTracks.length > 1;
    const core = document.createElement('div'), more = document.createElement('div');
    core.className = 'camcore'; more.className = 'camscroll';
    const add = (box, m) => {
      const b = document.createElement('button');
      b.className = 'camb' + (mode === m ? ' on' : '');
      if (mode === m) b.style.color = CAMCOLORS[m] || stations.find(st => st.key === m)?.color || '#cfd6e6';
      b.textContent = m.toUpperCase();
      b.addEventListener('click', () => { mode = m; renderButtons(); });
      box.appendChild(b);
    };
    ['auto', ...(stations.length ? ['stage'] : []), 'free'].forEach(m => add(core, m));
    ['fixed', ...(curTracks.length ? ['ride'] : []), ...(multi ? ['all', ...curTracks.map(t => t.role)] : []), ...stations.map(st => st.key)].forEach(m => add(more, m));
    // a mouse wheel scrolls the strip sideways (only when it actually overflows)
    more.addEventListener('wheel', e => {
      if (more.scrollWidth <= more.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      more.scrollLeft += e.deltaY; e.preventDefault();
    }, { passive: false });
    more.addEventListener('scroll', () => camEdges(more), { passive: true });
    camsEl.append(core, more);
    more.scrollLeft = keep;
    const on = more.querySelector('.on');                      // the lit button is never hidden past an edge
    if (on){                                                   // (scroll the strip only — scrollIntoView could move the page)
      const l = on.offsetLeft - more.offsetLeft, r = l + on.offsetWidth, pad = 24;
      if (l - pad < more.scrollLeft) more.scrollLeft = Math.max(0, l - pad);
      else if (r + pad > more.scrollLeft + more.clientWidth) more.scrollLeft = r + pad - more.clientWidth;
    }
    camEdges(more);
  }
  // fade whichever edge of the strip has more buttons hiding past it
  function camEdges(more){
    if (!more) return;
    more.classList.toggle('fl', more.scrollLeft > 2);
    more.classList.toggle('fr', more.scrollLeft + more.clientWidth < more.scrollWidth - 2);
  }
  addEventListener('resize', () => camEdges(camsEl.querySelector('.camscroll')));

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
  function syncStations(list, wide, { auto = true, openWide = false, openUntil: openT = 0, follow: fol = null, bounds: bnd = null, plan: pl = null } = {}){
    const had = stations.length;
    stations = list; stage = wide; follow = fol; bounds = bnd; plan = pl;
    if (auto && list.length && !had && mode === DEFAULT_MODE) mode = 'auto';
    if (!list.length && mode === 'stage') mode = DEFAULT_MODE;
    if (!FIXED_OK.has(mode) && !curTracks.some(t => t.role === mode) && !list.some(st => st.key === mode)) mode = 'auto';
    autoWant = openWide ? 'stage' : 'all'; lastCut = -99;   // a full room opens on the wide reveal…
    openUntil = openWide ? openT : -Infinity;                 // …held until songTime passes openT (count-in + downbeat)
    renderButtons();
  }

  function addShake(amt){ shakeAmp = Math.min(shakeAmp + amt, .15); }

  /* The per-frame pose. Mutates `camera`; leaves `camTarget` as the live aim (read
     by the debug HUD). marblePts = [{p, w, role}] of the live balls; leadRender is
     the lead ball's render position (or null). */
  function update({ dt, time, songTime = Infinity, tracks, marblePts, reduceMotion, started }){
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
    let effMode = mode, rideNow = null;
    if (mode === 'auto'){
      let want = 'all', score = 1.0;
      tracks.forEach(tr => {
        const s = tr._st; if (!s) return;
        // a big moment = a long arc in progress, or one about to launch
        const m = Math.max(s.dt < 8 ? s.dt : 0, (s.prog > .55 && s.next < 8) ? s.next : 0);
        if (m >= 1.05 && m > score){ score = m; want = tr.role; }
      });
      if (want === 'all' && tracks[0]._st && tracks[0]._st.dt <= .33) want = 'lead';  // shred cam
      // can ALL hold every live marble on THIS screen? (a probe pose: same solve, no sway / sight test)
      // (not in the count-in — the armed marbles hang on their magnets — and only a failure that
      // HOLDS: a single tall apex is fitFollow's job, not a reason to leave ALL)
      if (songTime >= 0 && marblePts.filter(m => m.vis !== false).length > 1 && !followPose('all', marblePts, 0, _pI, _pA, false)){
        allFailSince ??= time;
        if (time - allFailSince > ALL_HOLD) allBadUntil = time + ALL_REST;
      } else allFailSince = null;
      const allBad = time < allBadUntil;
      if (want === 'all' && allBad) want = heaviest(marblePts);
      rideNow = (ridePose && plan?.at && songTime >= openUntil && ridePose(songTime, true)) || null;
      if (!stations.length){
        // (a planned RIDE is a solved cut — it overrides the track vote's hysteresis both ways)
        if (rideNow){ if (autoWant !== 'ride'){ autoWant = 'ride'; lastCut = time; cutNow = true; } }
        else if (autoWant === 'ride'){ autoWant = want; lastCut = time; cutNow = true; }
        else if (want !== autoWant && (time - lastCut > 2.2 || (autoWant === 'all' && allBad))){
          autoWant = want; lastCut = time;
        }
      } else if (songTime < openUntil){                      // the opening reveal: hold the wide
        autoWant = 'stage'; lastCut = time - BELT_HOLD;      // (and let the first real cut land at once)
      } else {                                                // the room director: play back the SOLVED edit
        // (main's directorplan: the shot for this beat, a pure function of songTime — so the
        // cut lands on the same beat every loop and scrubbing is exact)
        const isSt = k => stations.some(st => st.key === k);
        const k = plan ? plan.at(songTime) : 'stage';
        let pick = k === 'ride' && !rideNow ? 'belt' : k;   // (a ride with no marble on it: its belt)
        if (k === 'belt'){                                    // the belt: whichever framing is live (lead / alto / all…)
          const onBelt = autoWant !== 'stage' && autoWant !== 'ride' && !isSt(autoWant);
          pick = !marblePts.length ? 'stage'
            : onBelt && time - lastCut < BELT_HOLD && !(autoWant === 'all' && allBad) ? autoWant : want;
        } else if (k !== 'stage' && !isSt(k) && !marblePts.length) pick = 'stage';   // a scripted belt role, no marble live
        if (autoWant !== pick){ autoWant = pick; lastCut = time; cutNow = true; }
      }
      effMode = autoWant;
    }
    const shot0 = effMode === 'stage' ? stage : stations.find(st => st.key === effMode);
    const shot = (camera.aspect < .9 && shot0?.portrait) || shot0;   // a shot may carry its own portrait framing

    // hold a fixed stage view, follow the chosen marble, or frame them all
    const sway = (reduceMotion || mode === 'fixed') ? 0 : Math.sin(time*.21);
    let ideal = _ideal, aim = _aim;
    const ride = effMode !== 'ride' || !ridePose ? null : mode === 'auto' ? rideNow : ridePose(songTime, false);
    if (ride){
      // RIDE: the pose IS the solve (a pure fn of songTime — already smoothed, comfort-limited
      // and guarded); no sway, no lerp lag (it would let the marble run out of frame), no shake.
      // Entering it is always a CUT (a glide into a moving chase reads as a lurch).
      camPos.copy(ride.eye); camTarget.copy(ride.aim);
      lens(ride.fov, dt, true);
      cutNow = false; shakeAmp = 0;
      camera.position.copy(camPos); camera.lookAt(camTarget);
      return;
    }
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
    } else followPose(effMode === 'ride' ? 'lead' : effMode, marblePts, sway, ideal, aim, true);   // (ride, nothing to ride yet: chase the lead)
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

  /* the FOLLOW pose (all / lead / alto / bass): into ideal + aim. Returns whether every marble it
     is about sits inside the frame (false: the pull-back was capped — the director's ALL probe). */
  function followPose(role, marblePts, sway, ideal, aim, los){
    const followed = role !== 'all' ? marblePts.find(m => m.role === role) : null;
    // (a newborn still holding off-screen before its fall is not part of the picture yet)
    const shown = marblePts.some(m => m.vis !== false) ? marblePts.filter(m => m.vis !== false) : marblePts;
    const focus = _focus.set(0, 0, 0);
    let back = Math.max(1, 1.3 / Math.min(camera.aspect, 1.3));
    if (!marblePts.length){
      focus.set(0, stageY, 0);                                // pre-start (or between balls): frame the band
    } else if (followed){
      focus.copy(followed.p);
      back *= .92;                                            // tight, personal chase
    } else {
      let wSum = 0;
      shown.forEach(m => { focus.addScaledVector(m.p, m.w); wSum += m.w; });
      focus.divideScalar(wSum);
      let spread = 0;
      shown.forEach(m => spread = Math.max(spread, m.p.distanceTo(focus)));
      back *= (1 + Math.min(spread * .075, .7));
    }
    // VERTICAL IS (MOSTLY) PINNED: the band is static, so the camera doesn't bob with
    // every bounce. x/z follow the marble (with sway + spread-dolly). In a full ROOM the
    // follow sits further back and gives a PARTIAL vertical follow above the band (lift),
    // so the top of a tall arc (apex ~8 u) stays in frame; the shared lerp smooths it.
    const room = stations.length > 0;
    // in a full room the offset is SOLVED (main: shotsolve.solveFollow — swung + lifted until
    // no other machine stands between the eye and the belt, per aspect class)
    const fo = room && follow ? ((camera.aspect < .9 && follow.portrait) || follow.land) : null;
    const ox = fo ? fo[0] : 4.5, oy = fo ? fo[1] : 3.4, oz = fo ? fo[2] : (room ? 13 : 9.5);
    ideal.copy(focus); ideal.x += (ox + sway*2.2)*back; ideal.z += (oz - sway*1.4)*back;
    const lift = room && marblePts.length ? Math.max(0, focus.y - stageY - 2.5) : 0;
    ideal.y = stageY + oy + lift*.4;                          // eye height: the band plane (+ a share of the lift)
    aim.copy(focus); aim.y = stageY + .6 + lift*.6;           // look at the band centre, not the bobbing marble
    if (!marblePts.length) return true;
    // (a followed newborn still holding off-screen is not fitted either)
    return fitFollow(ideal, aim, followed ? (followed.vis !== false ? [followed] : []) : shown, los);
  }
  /* the heaviest live, visible marble's role (the lead: w 1.7) */
  function heaviest(marblePts){
    let best = null;
    for (const m of marblePts) if (m.vis !== false && (!best || m.w > best.w)) best = m;
    return best ? best.role : 'all';
  }

  /* pull eye back along aim→eye until every subject marble sits inside FIT of the frame */
  function fitFollow(eye, aim, pts, los = true){
    if (!pts.length) return true;
    _fo.subVectors(eye, aim); const D = _fo.length(); if (D < 1e-3) return true;
    _fu.copy(_fo).divideScalar(D);
    _fR.crossVectors(_Y, _fu).normalize(); _fU.crossVectors(_fu, _fR);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * FIT, tanH = tanV * camera.aspect;
    let k = 1;
    for (const m of pts){
      _fq.subVectors(m.p, aim); const d = _fq.dot(_fu);
      k = Math.max(k, (Math.abs(_fq.dot(_fR)) / tanH + d) / D, (Math.abs(_fq.dot(_fU)) / tanV + d) / D);
    }
    k = Math.min(k, FIT_MAX);
    // …never out through the room's walls: in a full room the spread dolly × a phone's pull-back
    // alone can carry the eye past them — then pull IN across the floor, but never DOWN (the
    // solved height is what clears the front row)
    let kh = k, kv = Math.max(k, 1);
    if (bounds){
      const lim = (k0, a, v, lo, hi) => v > 1e-6 ? Math.min(k0, (hi - a) / v) : v < -1e-6 ? Math.min(k0, (lo - a) / v) : k0;
      kh = Math.max(.35, lim(lim(kh, aim.x, _fo.x, bounds.x0, bounds.x1), aim.z, _fo.z, bounds.z0, bounds.z1));
      kv = Math.max(.35, lim(kv, aim.y, _fo.y, bounds.y0, bounds.y1));
    }
    // …nor back into a machine (main hands over every machine's box with the solved offsets):
    // step the pull in until the eye stands ≥ .8 clear of each
    const clearAt = (h, v) => { const x = aim.x + _fo.x * h, y = aim.y + _fo.y * v, z = aim.z + _fo.z * h;
      return !follow?.boxes?.some(b => Math.hypot(Math.max(b[0] - x, 0, x - b[1]), Math.max(b[2] - y, 0, y - b[3]), Math.max(b[4] - z, 0, z - b[5])) < .8); };
    while (kh > 1 && !clearAt(kh, kv)){ kh = Math.max(1, kh - .1); kv = Math.max(1, Math.min(kv, kh)); }
    // …nor back to where another machine stands between the eye and a marble it is about (the
    // solved offset is clean at the class's own pull-backs; past them, SEE before backing further):
    // step the pull in until every sight line is clear (main: real meshes, AABB-prefiltered)
    if (los && follow?.blocked){
      const sees = (h, v) => { _pF.set(aim.x + _fo.x * h, aim.y + _fo.y * v, aim.z + _fo.z * h);
        for (const m of pts){ _fq.subVectors(m.p, _pF); const L = _fq.length(); if (L < 1) continue;
          if (follow.blocked(_pF.toArray(), _fq.divideScalar(L).toArray(), L - .6)) return false; }
        return true; };
      while (kh > 1.05 && !sees(kh, kv)){ kh = Math.max(1, kh - .2); kv = Math.max(1, Math.min(kv, kh)); }
    }
    if (kh !== 1 || kv !== 1) eye.set(aim.x + _fo.x * kh, aim.y + _fo.y * kv, aim.z + _fo.z * kh);
    // does every subject now sit inside the frame? (from the final eye, at the true lens)
    _fo.subVectors(aim, eye).normalize(); _fR.crossVectors(_fo, _Y).normalize(); _fU.crossVectors(_fR, _fo);
    const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), th = tv * camera.aspect;
    for (const m of pts){
      _fq.subVectors(m.p, eye); const z = _fq.dot(_fo);
      if (z < .1 || Math.abs(_fq.dot(_fR)) > z * th * .98 || Math.abs(_fq.dot(_fU)) > z * tv * .98) return false;
    }
    return true;
  }

  function resize(){
    camera.aspect = innerWidth/innerHeight;
    camera.updateProjectionMatrix();
  }

  return { camera, target: camTarget, orbit, update, syncTracks, syncStations, addShake, resize,
           get mode(){ return mode; }, set mode(m){ mode = m; renderButtons(); },
           get freeFov(){ return freeFov; }, set freeFov(f){ freeFov = f || null; if (f){ camera.fov = f; camera.updateProjectionMatrix(); } }, get shot(){ return autoWant; } };
}
