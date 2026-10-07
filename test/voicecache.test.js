import { describe, it, expect } from 'vitest';
import { voiceCache, nextVoiceEpoch, sweepVoiceCaches } from '../src/instruments/voicecache.js';
import { INSTRUMENTS } from '../src/instruments/index.js';

const r = n => ({ samples: new Float32Array(n), sr: 8000 });

/* the plugin render caches are bounded to the song in use (main: nextVoiceEpoch at build start,
   sweepVoiceCaches after the bank) — browsing the catalog must not accumulate every song's renders */
describe('voice cache (bounded to the song in use)', () => {
  it('keeps what this build touched, drops what it did not', () => {
    const c = voiceCache();
    nextVoiceEpoch();                          // song A
    c.set('a', r(10)); c.set('shared', r(10));
    sweepVoiceCaches();
    expect(c.has('a') && c.has('shared')).toBe(true);
    nextVoiceEpoch();                          // song B: re-uses 'shared' (a cache HIT touches it), adds 'b'
    const hit = c.get('shared'); c.set('b', r(10));
    const st = sweepVoiceCaches();
    expect(hit.samples.length).toBe(10);
    expect(c.has('a')).toBe(false);            // A's own render is freed
    expect(c.has('shared') && c.has('b')).toBe(true);
    expect(st.dropped).toBeGreaterThanOrEqual(1);
  });
  it('a rebuild of the same song (editor, room swap) is all hits', () => {
    const c = voiceCache();
    nextVoiceEpoch(); c.set('x', r(4)); sweepVoiceCaches();
    nextVoiceEpoch(); const a = c.get('x'); sweepVoiceCaches();
    expect(c.get('x')).toBe(a);
  });
  it('an evicted voice re-renders identically (renders are deterministic)', () => {
    const I = INSTRUMENTS.find(i => i.key === 'marimba'), id = String(I.demo.part[0][1]);
    nextVoiceEpoch();
    const a = I.voice(id), copy = Float32Array.from(a.samples);
    expect(I.voice(id)).toBe(a);               // cached within a build
    nextVoiceEpoch(); sweepVoiceCaches();      // a build that never asked for it → freed
    const b = I.voice(id);
    expect(b).not.toBe(a);
    expect(b.samples).toEqual(copy);
  });
  it('every plugin voice.js uses a bounded cache (no forever-Map)', async () => {
    const fs = await import('node:fs');
    for (const I of INSTRUMENTS){
      const src = fs.readFileSync(new URL(`../src/instruments/${I.key}/voice.js`, import.meta.url), 'utf8');
      expect(/new Map\(\)/.test(src), `${I.key}/voice.js caches renders in a plain Map`).toBe(false);
      expect(src.includes('voiceCache('), `${I.key}/voice.js`).toBe(true);
    }
  });
});
