/* THE JUGGLER'S SEARCH, run side by side (src/juggle.js plans; src/juggle.worker.js hosts a job).
   Every (voice, beam width) search is its own pure job (solveVoiceAt) — so a page runs them at
   once, one worker each: the narrow beams of every voice first, a wider one while it can still
   matter. A voice SETTLES exactly as solveJuggler decides it (settleVoice: the first width whose
   best plan is clean, else the best of all), so a plan is the same however it was solved — the
   bake, a worker, the main thread (test/jugglejobs.test.js; the bake test pins solveJuggler).
   One last job adds the plates' holds. Plain data both ways. */
import { layoutJuggler, solveJuggler, solveVoiceAt, assembleJuggler, holdsOf, BEAM_STEPS, settleVoice } from './juggle.js';

/* one job, as the worker runs it (see juggle.worker.js for the three shapes) */
export function runJob({ id, song, vi, m, solved }){
  try {
    const L = layoutJuggler(song);
    if (vi != null) return { id, key: L.key, vi, m, plan: solveVoiceAt(L, vi, m) };
    if (solved) return { id, key: L.key, hold: holdsOf(assembleJuggler(L, solved)) };
    const all = solveJuggler(L);
    holdsOf(assembleJuggler(L, all)).forEach((h, k) => { all[k].hold = h; });
    return { id, key: L.key, solved: all };
  } catch (err){
    return { id, error: String(err && err.message || err) };
  }
}

/* Solve layout L (of `song`) in workers: makeWorker() → a fresh Worker running runJob; at most
   `cap` at once (default: the cores but one). onDone(solved) — per voice { decs, carr, cost, bad,
   beam, hold }, what solveJuggler + the holds give — or onError(err) (main then solves it itself).
   Returns { cancel } (a new song: its workers are stopped, no callback). */
export function planInWorkers(L, song, { makeWorker, cores = 4, cap, onDone, onError }){
  const steps = BEAM_STEPS(L), nV = L.voices.length, plain = { bpm: song.bpm, melody: song.melody, alto: song.alto, bass: song.bass };
  const width = Math.max(1, Math.min(nV * steps.length, cap ?? ((cores || 4) - 1)));
  const res = L.voices.map(() => []), settled = new Array(nV).fill(null), live = new Map();
  const queue = [];                                          // narrow widths of every voice first
  for (let i = 0; i < steps.length; i++) for (let vi = 0; vi < nV; vi++) queue.push([vi, i]);
  let over = false, ids = 0;
  const kill = w => { try { w.terminate(); } catch (e){} };
  const end = (err, solved) => {
    if (over) return;
    over = true;
    for (const w of live.values()) kill(w);
    live.clear();
    if (err) onError?.(err); else onDone?.(solved);
  };
  const job = (tag, msg, take) => {
    let w;
    try { w = makeWorker(); } catch (err){ end(err); return; }
    const id = ++ids;
    live.set(tag, w);
    w.onmessage = e => {
      const d = e.data;
      if (over || !d || d.id !== id) return;
      live.delete(tag); kill(w);
      if (d.error || d.key !== L.key){ end(new Error(d.error || 'juggler: worker key mismatch')); return; }
      take(d);
    };
    w.onerror = e => { e?.preventDefault?.(); if (!over) end(new Error('juggler: worker failed')); };
    w.postMessage({ id, song: plain, ...msg });
  };
  const pump = () => {
    while (!over && live.size < width && queue.length){
      const [vi, i] = queue.shift();
      if (settled[vi]) continue;                             // decided: its wider widths aren't needed
      job(`${vi}:${i}`, { vi, m: steps[i] }, d => {
        res[vi][i] = d.plan;
        if (!settled[vi] && (settled[vi] = settleVoice(res[vi], steps.length))){
          for (let k = 0; k < steps.length; k++){            // its other widths: no longer needed
            const w = live.get(`${vi}:${k}`);
            if (w){ kill(w); live.delete(`${vi}:${k}`); }
          }
          if (settled.every(Boolean)){
            job('holds', { solved: settled }, h => end(null, settled.map((s, v) => ({ ...s, hold: h.hold[v] }))));
            return;
          }
        }
        pump();
      });
    }
  };
  pump();
  return { cancel(){ if (over) return; over = true; for (const w of live.values()) kill(w); live.clear(); } };
}
