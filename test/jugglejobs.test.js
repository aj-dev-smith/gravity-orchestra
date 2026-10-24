import { describe, it, expect } from 'vitest';
import { SONGS } from '../src/songs/index.js';
import { layoutJuggler, packSolve, jugglerKey, BEAM_STEPS, solveVoiceAt, settleVoice, pickBest } from '../src/juggle.js';
import { planInWorkers, runJob } from '../src/jugglejobs.js';
import BAKED from '../src/juggle-baked.json';

/* an in-process stand-in for juggle.worker.js: each job answers after `delay(msg)` ms (so a test
   can make the wide beams finish FIRST), and a terminated worker never answers */
function fakeWorkers(delay = () => 0, wrap = d => d){
  const log = { made: 0, live: 0, peak: 0, killed: 0, jobs: [] };
  const make = () => {
    const w = { dead: false, onmessage: null, onerror: null };
    log.made++; log.live++; log.peak = Math.max(log.peak, log.live);
    w.postMessage = msg => {
      log.jobs.push(msg.vi != null ? `${msg.vi}:${msg.m}` : msg.solved ? 'holds' : 'all');
      setTimeout(() => { if (!w.dead) w.onmessage?.({ data: wrap(runJob(structuredClone(msg)), msg) }); }, delay(msg));
    };
    w.terminate = () => { if (!w.dead){ w.dead = true; log.live--; log.killed++; } };
    return w;
  };
  return { make, log };
}
const plan = (key, opts = {}) => new Promise((resolve, reject) => {
  const song = SONGS[key], L = layoutJuggler(song), { make, log } = fakeWorkers(opts.delay, opts.wrap);
  const job = planInWorkers(L, song, { makeWorker: make, cap: opts.cap ?? 4,
    onDone: solved => resolve({ L, solved, log }), onError: err => (opts.onError ? opts.onError(err, log, resolve) : reject(err)) });
  opts.then?.(job, log, resolve);
});
const baked = song => JSON.stringify(BAKED.plans[jugglerKey(song)].voices);

describe('the juggle, solved side by side (jugglejobs.js) — the same plan as the bake', () => {
  it('every width settles exactly as solveJuggler does (settleVoice over solveVoiceAt)', () => {
    for (const key of ['dies-irae', 'daybreak-engine']){
      const L = layoutJuggler(SONGS[key]), steps = BEAM_STEPS(L);
      const all = L.voices.map((V, vi) => steps.map(m => solveVoiceAt(L, vi, m)));
      expect(all.every(r => settleVoice(r, steps.length))).toBe(true);
      expect(settleVoice([undefined, all[0][1]], steps.length)).toBe(null);        // (a wide answer alone decides nothing)
      expect(pickBest([null, ...all[0]])).toBeTruthy();
    }
  });
  it('a multi-voice song: the workers\' plan IS the bake, and a voice clean at the narrow width cancels its wide job', { timeout: 30000 }, async () => {
    const { L, solved, log } = await plan('dies-irae', { cap: 6 });
    expect(JSON.stringify(packSolve(solved))).toBe(baked(SONGS['dies-irae']));
    expect(L.voices.length).toBe(3);
    expect(log.peak).toBeLessThanOrEqual(6);
    expect(log.killed).toBe(log.made);                    // every worker ends: answered or cancelled
    expect(log.jobs.filter(j => j === 'holds').length).toBe(1);
  });
  it('a voice that needs the wide retry; answers out of order (wide first) change nothing', { timeout: 60000 }, async () => {
    const r = await plan('daybreak-engine', { cap: 3, delay: m => (m.m === 1 ? 60 : 0) });
    expect(JSON.stringify(packSolve(r.solved))).toBe(baked(SONGS['daybreak-engine']));
    const one = await plan('daybreak-engine', { cap: 1 });                              // one worker at a time: the same
    expect(JSON.stringify(packSolve(one.solved))).toBe(baked(SONGS['daybreak-engine']));
    expect(one.log.peak).toBe(1);
  });
  it('a worker that fails or answers for another song is an error, once; every worker stops', { timeout: 30000 }, async () => {
    for (const wrap of [d => ({ id: d.id, error: 'boom' }), d => ({ ...d, key: 'another-song' })]){
      const seen = await plan('dies-irae', { wrap, onError: (err, log, resolve) => setTimeout(() => resolve({ err, log }), 30) });
      expect(seen.err).toBeInstanceOf(Error);
      expect(seen.log.live).toBe(0);
    }
  });
  it('cancel (a new song): no answer, every worker stopped', async () => {
    const out = await new Promise(resolve => {
      const song = SONGS['dies-irae'], L = layoutJuggler(song), { make, log } = fakeWorkers(() => 5);
      let called = false;
      const job = planInWorkers(L, song, { makeWorker: make, cap: 4, onDone: () => { called = true; }, onError: () => { called = true; } });
      job.cancel();
      setTimeout(() => resolve({ called, log }), 200);
    });
    expect(out.called).toBe(false);
    expect(out.log.live).toBe(0);
  });
  it('no Worker at all: an error the page answers by solving on the main thread', () => {
    const song = SONGS['dies-irae'];
    let err = null;
    planInWorkers(layoutJuggler(song), song, { makeWorker: () => { throw new Error('no workers here'); }, onDone(){}, onError: e => { err = e; } });
    expect(err?.message).toBe('no workers here');
  });
  it('the worker\'s whole-plan job (the old protocol) is the bake too', () => {
    const song = SONGS['dies-irae'], d = runJob({ id: 7, song: { bpm: song.bpm, melody: song.melody, alto: song.alto, bass: song.bass } });
    expect(d.id).toBe(7);
    expect(d.key).toBe(jugglerKey(song));
    expect(JSON.stringify(packSolve(d.solved))).toBe(baked(song));
  });
});
