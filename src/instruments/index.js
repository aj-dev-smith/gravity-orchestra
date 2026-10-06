/* ============================================================
   INSTRUMENT REGISTRY — every folder src/instruments/<key>/index.js
   is picked up automatically (Vite glob, eager). Adding an instrument
   = adding a folder; NO shared file needs editing. That is the
   modularity contract — see src/instruments/README.md.
   ============================================================ */

const mods = import.meta.glob('./*/index.js', { eager: true });

/** [descriptor…] sorted by key — each is the folder's default export. */
export const INSTRUMENTS = Object.values(mods)
  .map(m => m.default)
  .filter(Boolean)
  .sort((a, b) => a.key.localeCompare(b.key));

export const instrumentByKey = key => INSTRUMENTS.find(I => I.key === key);
