/* The page's memory of the juggles it solved itself (localStorage — a per-viewer convenience): an
   import dropped again, a share link reopened, a MAP route tried twice — no search the second time.
   Keyed like the bake (jugglerKey: the belt's notes + tempo + JUGGLE_VERSION, so a solver change
   simply misses), holding packSolve's plain data (holds included); main assembles it like a baked
   plan and drops an entry that won't. Bounded: the least recently used plans go first (MAX_N plans,
   MAX_CHARS in all). Any storage call may throw (private mode, quota, blocked) — then it just
   remembers less, or nothing; the page never depends on it. */
const PRE = 'cascade:juggle:', IDX = 'cascade:juggle-index';
export const JCACHE = { MAX_N: 40, MAX_CHARS: 1500000 };

export function makeJuggleCache(store = defaultStore()){
  const index = () => {
    try {
      const v = JSON.parse(store.getItem(IDX) || '[]');
      return Array.isArray(v) ? v.filter(e => Array.isArray(e) && typeof e[0] === 'string' && Number.isFinite(e[1])) : [];
    } catch (e){ return []; }
  };
  const save = idx => { try { store.setItem(IDX, JSON.stringify(idx)); } catch (e){} };
  const evict = (idx, n) => { while (idx.length > n){ const [k] = idx.shift(); try { store.removeItem(PRE + k); } catch (e){} } };
  return {
    get(key){
      if (!store) return null;
      try {
        const raw = store.getItem(PRE + key);
        if (!raw) return null;
        const v = JSON.parse(raw);
        if (!Array.isArray(v)) return null;
        const idx = index().filter(e => e[0] !== key);
        idx.push([key, raw.length]); save(idx);              // (most recently used last)
        return v;
      } catch (e){ return null; }
    },
    put(key, packed){
      if (!store) return;
      try {
        const raw = JSON.stringify(packed);
        if (raw.length > JCACHE.MAX_CHARS) return;
        const idx = index().filter(e => e[0] !== key);
        let total = raw.length + idx.reduce((a, e) => a + e[1], 0);
        while (idx.length && (idx.length + 1 > JCACHE.MAX_N || total > JCACHE.MAX_CHARS)){
          const [k, n] = idx.shift(); total -= n;
          try { store.removeItem(PRE + k); } catch (e){}
        }
        try { store.setItem(PRE + key, raw); }
        catch (e){                                           // full (the origin's other data): make room once
          evict(idx, Math.floor(idx.length / 2));
          try { store.setItem(PRE + key, raw); } catch (e2){ save(idx); return; }
        }
        idx.push([key, raw.length]); save(idx);
      } catch (e){}
    },
    drop(key){
      if (!store) return;
      try { store.removeItem(PRE + key); save(index().filter(e => e[0] !== key)); } catch (e){}
    },
  };
}
function defaultStore(){ try { return globalThis.localStorage || null; } catch (e){ return null; } }
