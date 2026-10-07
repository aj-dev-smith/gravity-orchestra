import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import basicSsl from '@vitejs/plugin-basic-ssl';

/* Two build modes:
   - default  →  vite build         →  dist/  (hashed assets, CDN-cacheable, what deploy.sh ships)
   - single   →  vite build --mode single  →  dist-single/index.html  (everything inlined,
                 three.js included), copied to marble-cascade.html — the shareable viral unit.
   And one DEV mode:
   - xr       →  npm run dev:xr  (vite --mode xr) — HTTPS with a self-signed cert + LAN host, so a
                 Quest on the same Wi-Fi can open https://<mac-ip>:5173/ (WebXR needs a secure
                 context). Plain `npm run dev` stays http (headless shot scripts use it). docs/XR.md. */
export default defineConfig(({ mode }) => {
  const single = mode === 'single', xr = mode === 'xr';
  return {
    plugins: single ? [viteSingleFile()] : xr ? [basicSsl()] : [],
    ...(xr ? { server: { host: true } } : {}),
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 800,          // three.js is ~535kB; silence the noise
    },
  };
});
