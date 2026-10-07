import { noteHz } from './engine.js';
import { GM_DRUMS } from './drumkit.js';
import { metalVoice, VARIANTS as METAL_VARIANTS } from './cymbals.js';
import { velGain } from './dynamics.js';
import { PAN_COMP, AIR_HZ, ROOM_MIN, widthFor } from './spatial.js';

/* ---------------- audio: raw Web Audio, zero dependencies ----------------
   iOS WebKit bug: a context created before the first user gesture can report
   state "running" while its clock stays frozen at 0 and emits nothing.
   So: build the ENTIRE context inside the gesture, and watchdog the clock.

   This module is the battle-tested dual-path system, ported VERBATIM from the
   single-file build. The only seams to the rest of the app: `setBeat(beat)`
   feeds the echo timing, and `rebuildBank(tracks)` takes the track list. The
   internals — the iOS war (see CLAUDE.md §3) — are untouched. */

let audioReady = false;
let ctx = null, master = null, rebuilds = 0;
let eDL = null, eDR = null;
let busOut = null, recDest = null;                     // recording tap (additive seam, not war logic)
let mixOut = null, glue = null, limiter = null;        // MIX BUS (post-everything): glue → limiter → ceiling clipper
let revIn = null, revOut = null;                       // room reverb send/return (synchronous IR)
let noiseBuf = null;                                   // white-noise buffer for drum voices (per-context)
let beat = .7;                                         // fed by setBeat() on every song build
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const AC = window.AudioContext || window.webkitAudioContext;

const audioEl = document.createElement('audio');
audioEl.setAttribute('playsinline','');
document.body.appendChild(audioEl);

const stateEl = document.getElementById('astate');
export function showState(extra){
  stateEl.textContent = ctx
    ? `audio: ${ctx.state} · t=${ctx.currentTime.toFixed(1)}` +
      (lastPath ? ` · via ${lastPath}` : '') +
      (rebuilds ? ` · rebuilt×${rebuilds}` : '') + (extra || '')
    : 'audio: tap to start';
}
setInterval(showState, 1000);

/* echo timing follows the song tempo; also updates a live context's delays.
   GLIDE, never jump: snapping delayTime on a live delay line with feedback
   replays its buffered audio as a burst — sounds like every recent note at
   once on song change. setTargetAtTime retunes it smoothly instead. */
export function setBeat(b){
  beat = b;
  if (eDL && ctx){
    const t = ctx.currentTime;
    eDL.delayTime.setTargetAtTime(beat/2, t, .12);
    eDR.delayTime.setTargetAtTime(beat*.75, t, .12);
  }
}

function buildAudio(){                                 // MUST be called from a gesture
  if (ctx){ try { ctx.close(); } catch(e){} }
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = .9;
  const out = ctx.createGain();
  master.connect(out);
  // small stereo echo — no convolver, nothing async
  eDL = ctx.createDelay(1); eDR = ctx.createDelay(1);
  eDL.delayTime.value = beat/2; eDR.delayTime.value = beat*.75;
  const fb = ctx.createGain(); fb.gain.value = .3;
  const wet = ctx.createGain(); wet.gain.value = .25;
  master.connect(eDL); eDL.connect(eDR); eDR.connect(fb); fb.connect(eDL);
  eDL.connect(wet); eDR.connect(wet); wet.connect(out);
  const bus = buildMixBus(out);                        // INSERTED: room reverb + glue + limiter (see MIX)
  bus.connect(ctx.destination);
  busOut = out; mixOut = bus; recDest = null;          // rebuilt context → old recording tap is dead
  noiseBuf = null;                                     // …and the old noise buffer belongs to the dead ctx
  if (isIOS){                                          // also feed a real media element
    const msd = ctx.createMediaStreamDestination();
    bus.connect(msd);                                  // (post-limiter, so it never clips either)
    audioEl.srcObject = msd.stream;
    audioEl.play().catch(()=>{});
  }
  ctx.resume().catch(()=>{});
  ctx.onstatechange = () => showState();
  audioReady = true;
  // watchdog: report a zombie clock; rebuilds must happen inside a tap
  const born = performance.now();
  const zombieWatch = setInterval(() => {
    if (!ctx) return clearInterval(zombieWatch);
    if (ctx.currentTime > .05){ clearInterval(zombieWatch); showState(); return; }
    if (performance.now() - born > 900){ clearInterval(zombieWatch); showState(' · ctx dead, using samples'); }
  }, 200);
  showState();
}
export function initAudio(){ buildAudio(); primeSamples(); }

/* every tap retries/rebuilds the context — MUST run inside the gesture.
   The caller (controls) gates this on `started` and registers the listener. */
export function gestureRetry(){
  primeSamples();
  if (!ctx) buildAudio();
  else if (ctx.currentTime < .05 && rebuilds < 3){ rebuilds++; buildAudio(); }
  else if (ctx.state !== 'running') ctx.resume().catch(()=>{});
  showState();
}

/* ---- Plan B: pre-rendered WAV samples through <audio> elements ----
   When the iframe denies AudioContext activation but allows media playback,
   this path still sings. Bass notes get a deeper, rounder render. */
function renderNoteWav(freq, bass){
  const sr = 22050, dur = bass ? 3.0 : 2.6, N = (sr*dur)|0;
  const s = new Float32Array(N);
  const decay = bass ? 1.7 : 2.6;
  const tickF = bass ? 700 : 2400, tickA = bass ? .06 : .08;
  const tickN = (.025*sr)|0;
  for (let n=0;n<N;n++){
    const t = n/sr;
    const env = Math.exp(-t*decay) * Math.min(1, t/(bass?.008:.004));
    s[n] = bass
      ? env*( .65*Math.sin(6.2832*freq*t)
            + .3*Math.sin(6.2832*freq*.5*t)*Math.exp(-t*1.2)   // sub-octave depth
            + .26*Math.sin(6.2832*freq*2.002*t)*Math.exp(-t*2.2)
            + .05*Math.sin(6.2832*freq*3.0*t)*Math.exp(-t*5))
      : env*( .55*Math.sin(6.2832*freq*t)
            + .22*Math.sin(6.2832*freq*2.004*t)*Math.exp(-t*1.5)
            + .12*Math.sin(6.2832*freq*2.76*t)*Math.exp(-t*5)   // inharmonic tine
            + .06*Math.sin(6.2832*freq*4.2*t)*Math.exp(-t*8)    // sparkle
            + .08*Math.sin(6.2832*freq*3.01*t)*Math.exp(-t*4));
    if (n < tickN) s[n] += tickA*Math.sign(Math.sin(6.2832*tickF*t))*Math.exp(-t*120);
  }
  const d = ((beat/2)*sr)|0;                            // baked-in echo
  const eg = bass ? .18 : .28;
  for (let n=d;n<N;n++) s[n] += eg*s[n-d];
  let peak = 0; for (let n=0;n<N;n++) peak = Math.max(peak, Math.abs(s[n]));
  const k = (bass ? .98 : .85)/Math.max(peak, 1e-6);
  const buf = new ArrayBuffer(44 + N*2), v = new DataView(buf);
  const W = (o,str) => { for(let i=0;i<str.length;i++) v.setUint8(o+i, str.charCodeAt(i)); };
  W(0,'RIFF'); v.setUint32(4, 36+N*2, true); W(8,'WAVE'); W(12,'fmt ');
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
  v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true);
  W(36,'data'); v.setUint32(40, N*2, true);
  for (let n=0;n<N;n++) v.setInt16(44+n*2, Math.max(-1,Math.min(1,s[n]*k))*32767, true);
  return new Blob([buf], {type:'audio/wav'});
}
/* priming plays THIS, never a real note. iOS ignores el.volume, and several
   WebKit versions also ignore js-set el.muted on <audio> — which is why the
   muted-priming fix still blasted every note at once. The only unlock that is
   guaranteed silent on every platform is playing actually-silent samples; the
   activation sticks to the ELEMENT, so the real note is swapped in after. */
const SILENT_URL = (() => {
  const sr = 8000, N = (sr*.06)|0;                       // 60 ms of true zeros
  const buf = new ArrayBuffer(44 + N*2), v = new DataView(buf);
  const W = (o,str) => { for(let i=0;i<str.length;i++) v.setUint8(o+i, str.charCodeAt(i)); };
  W(0,'RIFF'); v.setUint32(4, 36+N*2, true); W(8,'WAVE'); W(12,'fmt ');
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
  v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true);
  W(36,'data'); v.setUint32(40, N*2, true);
  return URL.createObjectURL(new Blob([buf], {type:'audio/wav'}));
})();

let bank = {}, primed = false;
const bankKey = (note, bass) => note + (bass ? '|b' : '');
export function rebuildBank(tracks, drumLanes = [], voices = []){
  bankStat = { t0: performance.now(), n: 0, wavBytes: 0, floatBytes: 0, byKind: {} };
  Object.values(bank).forEach(a => {
    try { a.pause(); } catch(e){}
    const real = a.dataset.real;
    if (real){
      // (the ERR_FILE_NOT_FOUND console noise on song change / import, fixed: a prime play() still
      //  pending on this element resolved AFTER the revoke and swapped the dead URL in — so forget
      //  it first; and an element still LOADING its WAV is detached before its URL dies)
      delete a.dataset.real;
      if (a.src === real){ try { a.removeAttribute('src'); a.load(); } catch(e){} }
      URL.revokeObjectURL(real);
    }
    a.remove();
  });
  bank = {}; primed = false;
  const wanted = new Map();
  tracks.forEach(tr => tr.pads.forEach(p => wanted.set(bankKey(p.note, tr.deep), {note:p.note, bass:tr.deep})));
  drumLanes.forEach(name => wanted.set('drum:' + name, {drum:name}));   // one sample per drum lane
  warmMetal(drumLanes);                                  // the cymbals' renders, now (song load), not on the first hit
  voiceSrc = new Map(); voiceAB = new Map();
  voices.forEach(v => {                                  // instrument plugin voices (src/instruments/*)
    if (voiceSrc.has(v.key)) return;
    try {
      const r = v.render();
      voiceSrc.set(v.key, {samples: r.samples, sr: r.sr, wet: !!v.wet, hz: v.hz});   // hz: the voice's pitch (pan width), main's voiceHzOf
      if (!v.live) wanted.set(v.key, {voice: v.key});   // live: the live path's source only — no <audio> element (no strike fires it bare)
    } catch(e){ console.warn('cascade: voice render failed', v.key, e); }
  });
  voiceSrc.forEach(v => { bankStat.floatBytes += v.samples.byteLength; });
  const gen = ++bankGen, todo = [];
  wanted.forEach((spec, k) => {
    const a = document.createElement('audio');
    a.setAttribute('playsinline',''); a.preload = 'auto';
    if (spec.voice) spec.src = voiceSrc.get(spec.voice);  // (this song's buffer, even if the bank moves on)
    wavSpec.set(a, spec); todo.push(a);                  // the WAV itself is encoded LAZILY (realSrc)
    a.src = SILENT_URL;                                  // real sample swapped in after unlock
    a.addEventListener('error', () => stateEl.textContent = 'audio: sample blocked');
    document.body.appendChild(a);
    bank[k] = a;
  });
  bankStat.ms = Math.round(performance.now() - bankStat.t0);
  /* PERF: encoding every WAV used to block the song build (≈130 WAVs / 25 MB on a full room —
     ~½ s on a laptop, seconds on a phone). The elements, keys and silent priming src exist NOW,
     exactly as before; only the real WAV bytes are made later — in idle slices, or on the spot
     the moment the unlock swap asks for one (realSrc). The §5 unlock dance is unchanged. */
  const idle = typeof requestIdleCallback === 'function' ? cb => requestIdleCallback(cb, { timeout: 1000 }) : cb => setTimeout(cb, 16);
  const step = () => {
    if (gen !== bankGen) return;                         // a newer bank replaced this one
    // PERF (phones): while the LIVE path is healthy no element plays, so the background pass
    // has nothing to serve — on a phone it was eating whole frames for seconds after every song
    // change (Blob + createObjectURL of ~150 WAVs). It sleeps and re-checks; the moment the
    // context is not running-and-ticking (never built, zombie, interrupted) it carries on, and an
    // element that has to play before its WAV exists encodes it on the spot (ready → realSrc),
    // exactly as before. Nothing in the unlock dance changes.
    if (liveOK()){ setTimeout(step, 1000); return; }
    const t0 = performance.now();
    while (todo.length && performance.now() - t0 < 6) realSrc(todo.shift());
    if (!todo.length){ bankStat.lazyDoneMs = Math.round(performance.now() - bankStat.t0); return; }
    // once the tap has unlocked the bank, primed elements are WAITING on these bytes: keep
    // slicing every task instead of only in idle time (a busy phone may rarely go idle)
    primed ? setTimeout(step, 0) : idle(step);
  };
  idle(step);
}
let bankGen = 0;
const liveOK = () => !!ctx && ctx.state === 'running' && ctx.currentTime > .05;   // (the same test every play* uses)
const wavSpec = new WeakMap();                           // <audio> → what its real WAV is, until it is made
/* the element's real sample URL, encoding it now if the idle pass hasn't reached it yet */
function realSrc(a){
  if (a.dataset.real) return a.dataset.real;
  const spec = wavSpec.get(a);
  if (!spec) return SILENT_URL;
  const wav = spec.voice ? encodeWav(spec.src.samples, spec.src.sr) :
    spec.drum ? renderDrumWav(spec.drum) : renderNoteWav(noteHz(spec.note), spec.bass);
  const kind = spec.voice ? spec.voice.split(':').slice(0, 2).join(':') : spec.drum ? 'drum' : 'belt';
  if (bankStat){ bankStat.n++; bankStat.wavBytes += wav.size; bankStat.byKind[kind] = (bankStat.byKind[kind] || 0) + wav.size; }
  wavSpec.delete(a);
  a.dataset.real = URL.createObjectURL(wav);
  // an element the tap already unlocked on the silent clip (primeSamples, below) takes its
  // real sample the moment it exists — the unlock survives the src swap, as in §5
  if (a.dataset.armed && a.src === SILENT_URL){ a.src = a.dataset.real; a.load(); }
  return a.dataset.real;
}
/* sample path: an unlocked element whose WAV the idle pass hasn't reached yet is made NOW
   (one encode, a few ms) rather than playing the silent clip */
const ready = a => { if (a.dataset.armed && !a.dataset.real) realSrc(a); return a; };
/* dev probe (__dev.bank): the iOS sample bank this song built — element count, WAV blob
   bytes (per voice family), the Float32 voice sources kept for the live path, build ms */
let bankStat = null;
export const bankStats = () => bankStat && { ...bankStat, t0: undefined };
export function primeSamples(){                          // gesture-unlocks every element
  if (primed) return;
  primed = true;
  Object.values(bank).forEach(a => {
    if (a.src !== SILENT_URL) return;                    // already armed with its real note
    const pr = a.play();                                 // pure silence — inaudible everywhere
    if (pr && pr.then) pr.then(() => {
      a.pause();
      // unlock survives the src swap. PERF: swap now only if its WAV is already made — the
      // rest stay armed on the silent clip and realSrc swaps each in as the background pass
      // (or a first play) makes it, so a quick first tap never encodes the whole bank at once
      if (a.dataset.real){ a.src = a.dataset.real; a.load(); } else a.dataset.armed = '1';
    }).catch(() => { primed = false; });                 // still silent; the next tap retries
  });
}
let lastPath = '';
// vel 0..1 = the belt note's dynamics (dynamics.js velGain) — live path only: the iOS sample
// plays full, as drum samples always have (el.volume is ignored there, §5)
export function playNote(note, bass, sp, vel = 1){   // sp = {pan, gain, shelf, room} (src/spatial.js), live path only
  if (ctx && ctx.state === 'running' && ctx.currentTime > .05){
    pluck(note, bass, sp, vel); lastPath = 'webaudio'; return;
  }
  const a = bank[bankKey(note, bass)];
  if (a){
    ready(a);
    try { a.currentTime = 0; } catch(e){}
    a.play().catch(()=>{});
    lastPath = 'samples';
  }
}

/* Drum trigger — webaudio when the live context is awake, else the baked sample.
   vel 0..1 → amplitude on the live path; the iOS sample plays full (see §3). */
export function playDrum(name, vel = 1, sp){
  if (ctx && ctx.state === 'running' && ctx.currentTime > .05){
    hitDrum(name, vel, sp); lastPath = 'webaudio'; return;
  }
  metalLive.delete(name);                                // (a choke now means the element, not an old live voice)
  const a = bank['drum:' + name];
  if (a){
    ready(a);
    try { a.currentTime = 0; } catch(e){}
    a.play().catch(()=>{});
    lastPath = 'samples';
  }
}

/* CYMBAL CHOKE — the drum machine's magnet clamp grabbed the cymbal (a timeline edge in
   marbledrums, never a scheduler): cut what it is still ringing. Live path: a ~25 ms fade
   on every voice of that cymbal still sounding. Sample path: pause its element (the only
   control iOS honours — el.volume is ignored). */
export function chokeDrum(name){
  const live = metalLive.get(name);
  if (live && ctx){
    const t = ctx.currentTime;
    for (const v of live){ try { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, .008); v.src.stop(t + .06); } catch(e){} }
    metalLive.delete(name);
    return;
  }
  const a = bank['drum:' + name];
  if (a && !a.paused){ try { a.pause(); } catch(e){} }
}

/* ---- INSTRUMENT VOICES — the plugin seam (src/instruments/README.md) ----
   An instrument hands rebuildBank a list of {key, render() → {samples, sr}, wet}.
   ONE pure render feeds BOTH paths, so the live and iOS voices can't drift apart:
   · live: the same Float32Array wrapped in an AudioBuffer (cached per context),
     gain = vel (dynamics live here only), optional `dur` → a release fade (for
     sustained voices), routed dry to busOut or (wet) through the melody echo;
   · samples: the same buffer as a WAV in the <audio> bank (peak-normalized; iOS
     ignores el.volume, so the element plays full — the usual §5 degradation). */
let voiceSrc = new Map(), voiceAB = new Map(), voiceCtx = null;
function voiceBuffer(key){
  if (voiceCtx !== ctx){ voiceAB = new Map(); voiceCtx = ctx; }   // buffers belong to one context
  let b = voiceAB.get(key);
  if (!b){
    const v = voiceSrc.get(key); if (!v) return null;
    b = ctx.createBuffer(1, v.samples.length, v.sr);
    b.getChannelData(0).set(v.samples);
    voiceAB.set(key, b);
  }
  return b;
}
const voiceHz = key => { const h = voiceSrc.get(key)?.hz; if (Number.isFinite(h) && h > 0) return h;   // (the plugin's pitch for a chord / suffixed id)
  const m = /:([A-G]#?\d)(?:~[\d.]+)?$/.exec(key); try { return m ? noteHz(m[1]) : 0; } catch(e){ return 0; } };
/** (dev: the sound sweep) is this instrument voice baked in the current bank? */
export const hasVoice = key => voiceSrc.has(key);
/* a DURATION-BUCKET id ('inst:organ:C4~1' — src/instruments/sustain.js) bakes its release for the
   sample path below; the live path plays its BASE ('inst:organ:C4') when baked and releases at
   `dur` exactly, as every sustained voice always has */
const liveKey = key => { const k = key.lastIndexOf('~'); return k > 0 && voiceSrc.has(key.slice(0, k)) ? key.slice(0, k) : key; };
export function playVoice(key, vel = 1, { dur = 0, sp } = {}){
  if (ctx && ctx.state === 'running' && ctx.currentTime > .05){
    const lk = liveKey(key);
    const buf = voiceBuffer(lk);
    if (!buf) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.setValueAtTime(Math.max(.05, Math.min(1, vel)) * MIX.voiceTrim, t);
    const wetV = voiceSrc.get(lk).wet;                  // wet: the echo AND the room reverb send
    src.connect(g); g.connect(place([wetV ? master : (busOut || master)], sp, wetV ? MIX.send.wet : MIX.send.voice, voiceHz(lk)));
    src.start(t);
    if (dur > 0 && dur < buf.duration){                  // sustained voice: release at the note's end
      g.gain.setTargetAtTime(.0001, t + dur, .12);
      src.stop(t + dur + .8);
    }
    lastPath = 'webaudio'; return;
  }
  const a = bank[key];
  if (a){
    ready(a);
    try { a.currentTime = 0; } catch(e){}
    a.play().catch(()=>{});
    lastPath = 'samples';
  }
}

function pluck(note, bass, sp, vel = 1){
  if (!ctx) return;
  const f = noteHz(note), t = ctx.currentTime, va = velGain(vel);   // (va = 1 at full: unchanged)
  const dst = place([master], sp, MIX.send.belt, bass ? f * .5 : f);       // SPATIAL: pan/air/distance (+ room send), then the echo
  const dur = bass ? 2.6 : 1.6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(.0001, t);
  g.gain.exponentialRampToValueAtTime((bass ? .7 : .5) * va, t + (bass ? .01 : .005));
  g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  const o1 = ctx.createOscillator(); o1.type = bass ? 'sine' : 'triangle'; o1.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * (bass ? 2.002 : 2.004);
  const g2 = ctx.createGain(); g2.gain.value = bass ? .3 : .3;
  o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(dst);
  o1.start(t); o2.start(t); o1.stop(t+dur+.1); o2.stop(t+dur+.1);
  if (bass){                                            // sub-octave depth
    const o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = f*.5;
    const g3 = ctx.createGain(); g3.gain.value = .3;
    o3.connect(g3); g3.connect(g); o3.start(t); o3.stop(t+dur+.1);
  } else {                                              // inharmonic tine shimmer
    const o4 = ctx.createOscillator(); o4.type = 'sine'; o4.frequency.value = f*2.76;
    const g4 = ctx.createGain();
    g4.gain.setValueAtTime(.14, t);
    g4.gain.exponentialRampToValueAtTime(.0001, t + .5);
    o4.connect(g4); g4.connect(g); o4.start(t); o4.stop(t + .6);
  }
  // impact transient
  const k = ctx.createOscillator(); k.type = 'square'; k.frequency.value = bass ? 700 : 2400;
  const kg = ctx.createGain();
  kg.gain.setValueAtTime((bass ? .03 : .05) * va, t);
  kg.gain.exponentialRampToValueAtTime(.0001, t + .03);
  k.connect(kg); kg.connect(dst); k.start(t); k.stop(t + .05);
}

/* ---- MIX BUS + SPATIAL PLACEMENT (live path only) ----
   Inserted AFTER the existing graph, never inside it:
       master ─┬─────────────► out (busOut: dry drums/voices land here too)
               └► echo ──────►  │      revIn ─► convolver ─► revOut ─┘
                                ▼
     out ─► trim ─► glue comp ─► limiter ─► makeup ─► ceiling clipper = mixOut ─► destination
                                                                       ├─► iOS MediaStreamDestination
                                                                       └─► recording tap (captureStream)
   The LAST stage is a WaveShaper soft clipper whose curve tops out at MIX.ceiling: a
   true per-sample, per-channel peak guarantee (the compressors aren't brickwall and add
   their own makeup gain; the limiter does the work, the clipper only catches strays).
   So speakers, the iOS media-element mirror and recordings all get the same mix that
   cannot exceed the ceiling. The iOS <audio> SAMPLE path can't pan or be bussed — untouched.
   The reverb IR is computed SYNCHRONOUSLY right here (§5 round 1 was an ASYNC IR leaving
   the convolver silent; a buffer assigned in the same tick is there before any note).
   LEVEL CHECKS: measure per-channel SAMPLE peaks (ScriptProcessor/worklet tap on mixOut).
   A stereo AnalyserNode downmixes L+R and under-reads panned peaks. */
export const MIX = {
  voiceTrim: .5,              // plugin voices render peak-normalized (~.8) — sit them with the belt
  busTrim: .55,               // into the glue: the full orchestra sums to ~+14 dBFS untrimmed
  glue:  { threshold: -15, knee: 12, ratio: 2,   attack: .012, release: .22 },   // gentle, slow-ish
  limit: { threshold: -6,  knee: 0,  ratio: 20,  attack: .001, release: .08 },   // brick-ish catch
  makeup: 1.0,                // post-limiter level into the clipper (the comps already add makeup)
  ceiling: .891,              // −1 dBFS: the clipper's hard top; linear below KNEE·ceiling
  knee: .8,
  revSecs: 2.2, revReturn: .6,                  // room reverb: tail length, return level
  send: { belt: .3,  drum: .1, voice: .25, wet: 1 },   // reverb sends per voice family (× spatial `room`)
};
function ceilingCurve(top, knee){                      // odd, monotone, |y| ≤ top for every input
  const N = 4097, c = new Float32Array(N), k = top * knee;
  for (let i = 0; i < N; i++){
    const x = i / (N - 1) * 2 - 1, ax = Math.abs(x);
    const y = ax <= k ? ax : k + (top - k) * Math.tanh((ax - k) / (top - k));
    c[i] = Math.sign(x) * y;
  }
  return c;
}
function buildMixBus(out){
  const trim = ctx.createGain(); trim.gain.value = MIX.busTrim;
  glue = ctx.createDynamicsCompressor();
  limiter = ctx.createDynamicsCompressor();
  for (const [node, k] of [[glue, MIX.glue], [limiter, MIX.limit]])
    for (const p of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[p].value = k[p];
  const makeup = ctx.createGain(); makeup.gain.value = MIX.makeup;
  const clip = ctx.createWaveShaper(); clip.curve = ceilingCurve(MIX.ceiling, MIX.knee); clip.oversample = 'none';
  out.connect(trim); trim.connect(glue); glue.connect(limiter); limiter.connect(makeup); makeup.connect(clip);
  // room reverb: send → convolver (sync IR) → return into the bus (so it's glued + recorded too)
  revIn = ctx.createGain();
  revOut = ctx.createGain(); revOut.gain.value = MIX.revReturn;
  try {
    const conv = ctx.createConvolver();
    conv.buffer = roomIR(ctx, MIX.revSecs);             // synchronous — never an empty convolver
    revIn.connect(conv); conv.connect(revOut); revOut.connect(out);
  } catch(e){ revIn = null; /* no convolver → no sends at all; the dry mix is unaffected */ }
  revProbe = null; revMax = 0;
  return clip;
}
/* A small, dark room: stereo decorrelated noise, ~12 ms pre-delay, a few early
   reflections, an exponential tail (−60 dB at `secs`) that darkens as it decays
   (a one-pole lowpass whose cutoff falls with time). Pure arithmetic, same tick. */
function roomIR(c, secs){
  const sr = c.sampleRate, N = Math.max(1, (sr * secs) | 0), pre = (sr * .012) | 0;
  const b = c.createBuffer(2, N, sr);
  for (let ch = 0; ch < 2; ch++){
    const d = b.getChannelData(ch);
    let seed = 0x9e3779b9 ^ (ch * 0x85ebca6b), y = 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    for (let n = pre; n < N; n++){
      const t = (n - pre) / sr;
      const a = .55 - .4 * Math.min(1, t / secs);       // lowpass coefficient: bright → dark
      y += a * (rnd() - y);
      d[n] = y * Math.exp(-6.9 * t / secs);
    }
    [.019, .027, .041, .053].forEach((tt, i) => {        // early reflections (L/R offset)
      const n = pre + ((tt + ch * .0037 * (i + 1)) * sr | 0);
      if (n < N) d[n] += (.5 - .08 * i) * (i % 2 ? -1 : 1);
    });
  }
  return b;
}
/* Per-voice placement: [air shelf] → [panner ×PAN_COMP] ─┬─ distance gain ─► each dst
                                                          └─ send·room ─────► revIn
   sp = {pan, gain, shelf, room} from src/spatial.js; neutral fields add no node. The
   reverb send is tapped BEFORE the distance gain: the room's reverberant field stays
   put while the direct sound falls off, so far voices read wetter (how ears judge
   distance). PAN_COMP (√2) makes the mono→StereoPanner equal-power law match the old
   mono upmix (1.0 per side at centre), so pan 0 ≡ no panner — no level step either way.
   `hz` (the voice's fundamental, if known) narrows the pan for low voices (widthFor).
   No StereoPannerNode (very old WebKit) → no pan, everything else still works. */
function place(dsts, sp, send = 0, hz = 0){
  dsts = dsts.filter(Boolean);
  const wet = send > 0 && revIn ? send * (sp && sp.room != null ? sp.room : ROOM_MIN) : 0;
  if (!sp && !wet && dsts.length === 1) return dsts[0];
  let head = null, tail = null;
  const add = n => { if (tail) tail.connect(n); else head = n; tail = n; };
  if (sp && sp.shelf < 0){
    const f = ctx.createBiquadFilter(); f.type = 'highshelf';
    f.frequency.value = AIR_HZ; f.gain.value = Math.max(-24, sp.shelf); add(f);
  }
  const pan = sp && sp.pan ? sp.pan * widthFor(hz) : 0;   // lows sit near centre (spatial.js widthFor)
  if (pan && ctx.createStereoPanner){
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); add(p);
    const c = ctx.createGain(); c.gain.value = PAN_COMP; add(c);
  }
  if (!tail) add(ctx.createGain());                      // unity split point
  let direct = tail;
  if (sp && sp.gain != null && Math.abs(sp.gain - 1) > 1e-3){
    direct = ctx.createGain(); direct.gain.value = Math.max(0, sp.gain); tail.connect(direct);
  }
  dsts.forEach(d => direct.connect(d));
  if (wet){ const s = ctx.createGain(); s.gain.value = wet; tail.connect(s); s.connect(revIn); }
  return head;
}
/* dev meter (window.__dev.audioProbe): compressor gain reduction + the reverb-return
   PEAK SINCE THE LAST CALL (a running max, sampled every 30 ms once the probe is first
   asked for) — proof the convolver actually makes sound. Dev-only; costs nothing until used. */
let revProbe = null, revMax = 0;
export function probe(){
  if (!ctx || !revOut) return null;
  if (!revProbe){
    const an = revProbe = ctx.createAnalyser(); an.fftSize = 2048; revOut.connect(an);
    const a = new Float32Array(an.fftSize);
    const tick = setInterval(() => {
      if (revProbe !== an) return clearInterval(tick);  // context rebuilt → a new probe takes over
      an.getFloatTimeDomainData(a);
      for (const x of a) revMax = Math.max(revMax, Math.abs(x));
    }, 30);
  }
  const r = { revPeak: +revMax.toFixed(4), glueDb: +glue.reduction.toFixed(1), limDb: +limiter.reduction.toFixed(1) };
  revMax = 0;
  return r;
}

/* ---- PERCUSSION (live Web Audio) — noise-based voices, routed DRY to busOut so
   they punch through instead of smearing in the melody's echo. velocity → amp. ---- */
function getNoise(){                                    // one white-noise buffer per context
  if (noiseBuf) return noiseBuf;
  const N = (ctx.sampleRate * .4) | 0;
  noiseBuf = ctx.createBuffer(1, N, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < N; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}
const DRUM_HZ = { kick: 60, snare: 250 };                // pan-width pitch (toms use their registry tone; metal = bright → full width)
/* METAL voices (cymbals, open hat, clap — cymbals.js): one pure render per voice, wrapped
   in an AudioBuffer per context. Velocity sets the level AND the darkness (a soft stroke on
   bronze is duller, not just quieter — a lowpass that opens with vel²). Every live voice of
   a cymbal is kept until it ends so the magnet clamp can choke it (chokeDrum). */
let metalAB = new Map(), metalCtx = null, metalRR = {};
const metalLive = new Map();                             // name → Set of {src, g} still ringing
function warmMetal(names){
  for (const n of names) if (GM_DRUMS[n]?.metal)
    for (let v = 0; v < (METAL_VARIANTS[n] || 1); v++) try { metalVoice(n, v); } catch(e){ console.warn('cascade: metal voice failed', n, e); }
}
function metalBuffer(name, v){
  if (metalCtx !== ctx){ metalAB = new Map(); metalCtx = ctx; }
  const k = name + '#' + v;
  let b = metalAB.get(k);
  if (!b){
    const r = metalVoice(name, v);
    b = ctx.createBuffer(1, r.samples.length, r.sr);
    b.getChannelData(0).set(r.samples);
    metalAB.set(k, b);
  }
  return b;
}
function hitMetal(name, vel, dst, t, amp){
  const nv = METAL_VARIANTS[name] || 1, v = (metalRR[name] = ((metalRR[name] ?? -1) + 1) % nv);
  const src = ctx.createBufferSource(); src.buffer = metalBuffer(name, v);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.value = Math.min(16000, 2600 + 14000 * vel * vel); lp.Q.value = .5;
  const g = ctx.createGain(); g.gain.setValueAtTime(amp, t);
  src.connect(lp); lp.connect(g); g.connect(dst);
  src.start(t);
  const live = metalLive.get(name) || metalLive.set(name, new Set()).get(name), voice = { src, g };
  live.add(voice);
  src.onended = () => live.delete(voice);
}
function hitDrum(name, vel, sp){
  if (!ctx) return;
  const metal = GM_DRUMS[name]?.metal;
  const dst = place([busOut || master], sp, MIX.send.drum, DRUM_HZ[name] || GM_DRUMS[name]?.tone || (metal ? 5000 : 0));   // dry bus (no echo) + a touch of room; master = fallback
  const t = ctx.currentTime;
  // velGain: the old .35 + .65·v line from v = .5 up (every groove's level unchanged), bent
  // down below it so a pp hit is genuinely quiet (the old floor spanned only ~9 dB) — dynamics.js
  const amp = (GM_DRUMS[name]?.gain ?? .7) * velGain(vel);
  if (metal){
    try { hitMetal(name, vel, dst, t, amp * (.55 + .45 * vel)); return; }   // (metal: a steeper curve — a soft cymbal tap is far quieter than a crash)
    catch(e){ console.warn('cascade: metal hit failed', name, e); }        // → the old noise fallback below
  }
  if (name === 'kick'){
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(125, t);
    o.frequency.exponentialRampToValueAtTime(44, t + .09);   // the pitch-drop = a kick
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(.0001, t + .34);
    o.connect(g); g.connect(dst); o.start(t); o.stop(t + .38);
    const c = ctx.createOscillator(); c.type = 'square'; c.frequency.value = 900;   // beater click
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(amp * .18, t); cg.gain.exponentialRampToValueAtTime(.0001, t + .02);
    c.connect(cg); cg.connect(dst); c.start(t); c.stop(t + .03);
  } else if (name === 'snare' || name === 'clap'){
    const n = ctx.createBufferSource(); n.buffer = getNoise();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(amp * .85, t);
    ng.gain.exponentialRampToValueAtTime(.0001, t + .19);
    n.connect(hp); hp.connect(ng); ng.connect(dst); n.start(t); n.stop(t + .24);
    [188, 330].forEach((f, i) => {                            // tonal body under the noise
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(amp * (i ? .12 : .2), t);
      g.gain.exponentialRampToValueAtTime(.0001, t + .12);
      o.connect(g); g.connect(dst); o.start(t); o.stop(t + .16);
    });
  } else if (GM_DRUMS[name]?.tone){                          // toms — a pitched, ringing membrane
    const f0 = GM_DRUMS[name].tone;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f0 * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(f0, t + .08);   // a subtle pitch drop — the skin tensioning
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(.0001, t + .4);
    o.connect(g); g.connect(dst); o.start(t); o.stop(t + .44);
    const o2 = ctx.createOscillator(); o2.type = 'sine';     // an octave partial for body
    o2.frequency.setValueAtTime(f0 * 3, t);
    o2.frequency.exponentialRampToValueAtTime(f0 * 2, t + .08);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(amp * .3, t); g2.gain.exponentialRampToValueAtTime(.0001, t + .18);
    o2.connect(g2); g2.connect(dst); o2.start(t); o2.stop(t + .22);
    const nz = ctx.createBufferSource(); nz.buffer = getNoise();   // a stick-attack transient
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(amp * .22, t); ng.gain.exponentialRampToValueAtTime(.0001, t + .03);
    nz.connect(hp); hp.connect(ng); ng.connect(dst); nz.start(t); nz.stop(t + .05);
  } else {                                                   // hat / hatOpen / crash / ride — bright noise
    const open = name === 'hatOpen' || name === 'crash' || name === 'ride';
    const n = ctx.createBufferSource(); n.buffer = getNoise();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass';
    hp.frequency.value = name === 'crash' || name === 'ride' ? 5000 : 7800;
    const g = ctx.createGain();
    const dur = open ? .3 : .05;
    g.gain.setValueAtTime(amp * .5, t);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    n.connect(hp); hp.connect(g); g.connect(dst); n.start(t); n.stop(t + dur + .02);
  }
}

/* ---- PERCUSSION (baked WAV) — the iOS fallback, same shape as renderNoteWav but
   dry (no echo) and punchy. One render per drum at full strength: el.volume is
   ignored on iOS so per-hit dynamics live only on the webaudio path (§3). ---- */
/* the iOS bank's metal samples: the SAME render as the live path, baked to a WAV whose peak
   is the cymbal's mix gain relative to the shells' .92 — el.volume is ignored on iOS, so a
   crash normalized like a kick would ring at full level for 3 s over the whole mix */
/* (the open hat is levelled against the CLOSED hat, not the snare: the closed hat's WAV is
   baked at full .92 like every shell, so an open hat scaled off the snare came out ~6 dB
   UNDER the closed one — an open hat must not be quieter than a chick) */
const metalPeak = name => .92 * GM_DRUMS[name].gain / GM_DRUMS[name === 'hatOpen' ? 'hat' : 'snare'].gain;
function renderDrumWav(name){
  if (GM_DRUMS[name]?.metal){
    try { const r = metalVoice(name, 0); return encodeWav(r.samples, r.sr, Math.min(.92, metalPeak(name))); }
    catch(e){ console.warn('cascade: metal WAV failed', name, e); }
  }
  const sr = 22050;
  const tone = GM_DRUMS[name]?.tone;
  const dur = name === 'kick' ? .4 :
              tone ? .45 :
              (name === 'snare' || name === 'clap') ? .26 :
              (name === 'hatOpen' || name === 'crash' || name === 'ride') ? .3 : .1;
  const N = (sr * dur) | 0, s = new Float32Array(N);
  if (name === 'kick'){
    let ph = 0;
    for (let n = 0; n < N; n++){
      const t = n / sr, f = 44 + 81 * Math.exp(-t * 34);
      ph += 6.2832 * f / sr;
      s[n] = .95 * Math.exp(-t * 9) * Math.min(1, t / .002) * Math.sin(ph);
      if (t < .02) s[n] += .25 * Math.exp(-t * 180) * Math.sign(Math.sin(6.2832 * 900 * t));
    }
  } else if (tone){                                          // tom — pitched membrane + stick attack
    let ph = 0, ph2 = 0;
    for (let n = 0; n < N; n++){
      const t = n / sr, bend = 1 + .5 * Math.exp(-t * 28);   // 1.5 → 1.0 pitch drop
      ph  += 6.2832 * tone * bend / sr;
      ph2 += 6.2832 * tone * 2 * bend / sr;
      const env = Math.exp(-t * 7) * Math.min(1, t / .002);
      s[n] = .9 * env * Math.sin(ph) + .27 * Math.exp(-t * 13) * Math.sin(ph2);
      if (t < .02) s[n] += .2 * Math.exp(-t * 130) * (Math.random() * 2 - 1);   // stick
    }
  } else if (name === 'snare' || name === 'clap'){
    let hp = 0, xp = 0;
    for (let n = 0; n < N; n++){
      const t = n / sr, x = Math.random() * 2 - 1;
      hp = .82 * (hp + x - xp); xp = x;                       // one-pole highpass on the noise
      const env = Math.exp(-t * 19);
      s[n] = .7 * hp * env + env * (.2 * Math.sin(6.2832 * 188 * t) + .12 * Math.sin(6.2832 * 330 * t));
    }
  } else {                                                   // hat family
    const open = name === 'hatOpen' || name === 'crash' || name === 'ride';
    const dec = open ? 12 : 60;
    let hp = 0, xp = 0;
    for (let n = 0; n < N; n++){
      const t = n / sr, x = Math.random() * 2 - 1;
      hp = .9 * (hp + x - xp); xp = x;                        // brighter highpass for the metal
      s[n] = .5 * hp * Math.exp(-t * dec);
    }
  }
  return encodeWav(s, sr);
}
/* PCM-16 mono WAV encoder, peak-normalized. (renderNoteWav keeps its own inline
   encoder verbatim — the iOS-war code is untouched; this serves the drum path.) */
function encodeWav(s, sr, top = .92){
  const N = s.length;
  let peak = 0; for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(s[n]));
  const k = top / Math.max(peak, 1e-6);
  const buf = new ArrayBuffer(44 + N * 2), v = new DataView(buf);
  const W = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  W(0, 'RIFF'); v.setUint32(4, 36 + N * 2, true); W(8, 'WAVE'); W(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  W(36, 'data'); v.setUint32(40, N * 2, true);
  for (let n = 0; n < N; n++) v.setInt16(44 + n * 2, Math.max(-1, Math.min(1, s[n] * k)) * 32767, true);
  return new Blob([buf], { type: 'audio/wav' });
}

/* --- small API for the controls/mute handler --- */
export const isReady = () => audioReady;
/* lazy tap on the final (post-echo, post-limiter) mix for MediaRecorder; null if no live context */
export function captureStream(){
  if (!ctx || !busOut || ctx.state !== 'running') return null;
  if (!recDest){ recDest = ctx.createMediaStreamDestination(); (mixOut || busOut).connect(recDest); }   // post-limiter
  return recDest.stream;
}
export function resumeOrBuild(){ if (!ctx) buildAudio(); else ctx.resume().catch(()=>{}); }
export function setStatus(text){ stateEl.textContent = text; }
