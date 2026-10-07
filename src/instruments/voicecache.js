/* ============================================================
   VOICE CACHE — the per-plugin render cache, bounded to the SONG IN USE.

   Every voice.js memoises its renders (id → {samples, sr}) so a song build
   renders each id once. Those Maps used to live forever: browsing the catalog
   accumulated every song's renders (≈400 MB of Float32 across the shipped songs
   — a phone tab doesn't survive that). Now each cache is a voiceCache(), and
   main brackets every song build:

       nextVoiceEpoch()      build start — a new song (or a rebuild of this one)
       …build + rebuildBank render / touch every id the song fires…
       sweepVoiceCaches()    once the bank has baked every voice (audio.js onBaked —
                             renders may be deferred): drop what THIS build didn't touch

   What the song uses stays (the bank holds the very same arrays), a rebuild of
   the same song (the editor, a room swap) hits the cache, and a song left
   behind frees its renders. Renders are deterministic, so an evicted id that is
   asked for again simply renders again, identically.
   Same surface as the Map the plugins used: has / get / set (+ size, delete).
   ============================================================ */
const caches = new Set();
let epoch = 0;

export function voiceCache(){
  const m = new Map();
  caches.add(m);
  return {
    has: k => m.has(k),
    get(k){ const e = m.get(k); if (!e) return undefined; e.ep = epoch; return e.v; },
    set(k, v){ m.set(k, { v, ep: epoch }); return this; },
    delete: k => m.delete(k),
    get size(){ return m.size; },
  };
}
/** a song build begins: renders touched from now on belong to it */
export function nextVoiceEpoch(){ return ++epoch; }
/** the current build's epoch (main: a deferred sweep skips itself if a newer build has begun) */
export const voiceEpoch = () => epoch;
/** drop every render not touched since the last nextVoiceEpoch() (keep = also spare that many
    earlier builds). Returns { dropped, kept, bytes } — bytes still cached (dev). */
export function sweepVoiceCaches(keep = 0){
  let dropped = 0, kept = 0, bytes = 0;
  for (const m of caches) for (const [k, e] of m){
    if (e.ep < epoch - keep){ m.delete(k); dropped++; }
    else { kept++; bytes += e.v?.samples?.byteLength || 0; }
  }
  return { dropped, kept, bytes };
}
