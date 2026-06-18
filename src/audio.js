import { noteHz } from './engine.js';
import { GM_DRUMS } from './drumkit.js';

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
  out.connect(ctx.destination);
  busOut = out; recDest = null;                        // rebuilt context → old recording tap is dead
  noiseBuf = null;                                     // …and the old noise buffer belongs to the dead ctx
  if (isIOS){                                          // also feed a real media element
    const msd = ctx.createMediaStreamDestination();
    out.connect(msd);
    audioEl.srcObject = msd.stream;
    audioEl.play().catch(()=>{});
  }
  ctx.resume().catch(()=>{});
  ctx.onstatechange = () => showState();
  audioReady = true;
  // watchdog: report a zombie clock; rebuilds must happen inside a tap
  const born = performance.now();
  const probe = setInterval(() => {
    if (!ctx) return clearInterval(probe);
    if (ctx.currentTime > .05){ clearInterval(probe); showState(); return; }
    if (performance.now() - born > 900){ clearInterval(probe); showState(' · ctx dead, using samples'); }
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
export function rebuildBank(tracks, drumLanes = []){
  Object.values(bank).forEach(a => {
    try { a.pause(); } catch(e){}
    if (a.dataset.real) URL.revokeObjectURL(a.dataset.real);
    a.remove();
  });
  bank = {}; primed = false;
  const wanted = new Map();
  tracks.forEach(tr => tr.pads.forEach(p => wanted.set(bankKey(p.note, tr.deep), {note:p.note, bass:tr.deep})));
  drumLanes.forEach(name => wanted.set('drum:' + name, {drum:name}));   // one sample per drum lane
  wanted.forEach((spec, k) => {
    const a = document.createElement('audio');
    a.setAttribute('playsinline',''); a.preload = 'auto';
    a.dataset.real = URL.createObjectURL(
      spec.drum ? renderDrumWav(spec.drum) : renderNoteWav(noteHz(spec.note), spec.bass));
    a.src = SILENT_URL;                                  // real sample swapped in after unlock
    a.addEventListener('error', () => stateEl.textContent = 'audio: sample blocked');
    document.body.appendChild(a);
    bank[k] = a;
  });
}
export function primeSamples(){                          // gesture-unlocks every element
  if (primed) return;
  primed = true;
  Object.values(bank).forEach(a => {
    if (a.src !== SILENT_URL) return;                    // already armed with its real note
    const pr = a.play();                                 // pure silence — inaudible everywhere
    if (pr && pr.then) pr.then(() => {
      a.pause();
      a.src = a.dataset.real; a.load();                  // unlock survives the src swap
    }).catch(() => { primed = false; });                 // still silent; the next tap retries
  });
}
let lastPath = '';
export function playNote(note, bass){
  if (ctx && ctx.state === 'running' && ctx.currentTime > .05){
    pluck(note, bass); lastPath = 'webaudio'; return;
  }
  const a = bank[bankKey(note, bass)];
  if (a){
    try { a.currentTime = 0; } catch(e){}
    a.play().catch(()=>{});
    lastPath = 'samples';
  }
}

/* Drum trigger — webaudio when the live context is awake, else the baked sample.
   vel 0..1 → amplitude on the live path; the iOS sample plays full (see §3). */
export function playDrum(name, vel = 1){
  if (ctx && ctx.state === 'running' && ctx.currentTime > .05){
    hitDrum(name, vel); lastPath = 'webaudio'; return;
  }
  const a = bank['drum:' + name];
  if (a){
    try { a.currentTime = 0; } catch(e){}
    a.play().catch(()=>{});
    lastPath = 'samples';
  }
}

function pluck(note, bass){
  if (!ctx) return;
  const f = noteHz(note), t = ctx.currentTime;
  const dur = bass ? 2.6 : 1.6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(.0001, t);
  g.gain.exponentialRampToValueAtTime(bass ? .7 : .5, t + (bass ? .01 : .005));
  g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  const o1 = ctx.createOscillator(); o1.type = bass ? 'sine' : 'triangle'; o1.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * (bass ? 2.002 : 2.004);
  const g2 = ctx.createGain(); g2.gain.value = bass ? .3 : .3;
  o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(master);
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
  kg.gain.setValueAtTime(bass ? .03 : .05, t);
  kg.gain.exponentialRampToValueAtTime(.0001, t + .03);
  k.connect(kg); kg.connect(master); k.start(t); k.stop(t + .05);
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
function hitDrum(name, vel){
  if (!ctx) return;
  const dst = busOut || master;                        // dry bus (no echo); master is a safe fallback
  const t = ctx.currentTime;
  const amp = (GM_DRUMS[name]?.gain ?? .7) * (.35 + .65 * vel);
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
function renderDrumWav(name){
  const sr = 22050;
  const dur = name === 'kick' ? .4 :
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
function encodeWav(s, sr){
  const N = s.length;
  let peak = 0; for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(s[n]));
  const k = .92 / Math.max(peak, 1e-6);
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
/* lazy tap on the post-echo mix for MediaRecorder; null if no live context */
export function captureStream(){
  if (!ctx || !busOut || ctx.state !== 'running') return null;
  if (!recDest){ recDest = ctx.createMediaStreamDestination(); busOut.connect(recDest); }
  return recDest.stream;
}
export function resumeOrBuild(){ if (!ctx) buildAudio(); else ctx.resume().catch(()=>{}); }
export function setStatus(text){ stateEl.textContent = text; }
