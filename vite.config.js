import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/* Two build modes:
   - default  →  vite build         →  dist/  (hashed assets, CDN-cacheable, what deploy.sh ships)
   - single   →  vite build --mode single  →  dist-single/index.html  (everything inlined,
                 three.js included), copied to marble-cascade.html — the shareable viral unit. */
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    plugins: single ? [viteSingleFile()] : [],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 800,          // three.js is ~535kB; silence the noise
    },
  };
});
