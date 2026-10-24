/* The juggler's SEARCH off the main thread (src/juggle.js solveJuggler — seconds on a dense
   import) and the plates' HOLDS after it. In: { id, song } (the belt voices + bpm are all it
   reads). Out: { id, key, solved } — plain data, the holds riding along (as in the bake); main
   assembles it onto its own layout (assembleJuggler) and swaps the machine in. */
import { layoutJuggler, solveJuggler, assembleJuggler, holdsOf } from './juggle.js';

self.onmessage = e => {
  const { id, song } = e.data;
  try {
    const L = layoutJuggler(song), solved = solveJuggler(L);
    holdsOf(assembleJuggler(L, solved)).forEach((h, vi) => { solved[vi].hold = h; });
    self.postMessage({ id, key: L.key, solved });
  } catch (err){
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
