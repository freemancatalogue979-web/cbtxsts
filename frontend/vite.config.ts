import {createHash} from 'node:crypto';
import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig, type Plugin} from 'vite';

/**
 * Stamps dist/sw.js for this exact build: a build id that changes whenever any
 * file changes (so the browser always sees a new worker and drops the old
 * caches), and the list of every chunk the build ships, so the worker can save
 * all screens the first time the app is opened.
 */
function serviceWorkerBuild(): Plugin {
  return {
    name: 'arena-service-worker-build',
    apply: 'build',
    closeBundle() {
      const out = path.resolve(__dirname, 'dist');
      const assets = readdirSync(path.join(out, 'assets'))
        .filter((name) => !name.endsWith('.map'))
        .sort()
        .map((name) => `/assets/${name}`);
      const html = readFileSync(path.join(out, 'index.html'), 'utf8');
      const build = createHash('sha256').update(html).update(assets.join('\n')).digest('hex').slice(0, 16);
      const swPath = path.join(out, 'sw.js');
      const source = readFileSync(swPath, 'utf8')
        .replace("'__SW_BUILD__'", JSON.stringify(build))
        .replace("'__SW_ASSETS__'", JSON.stringify(assets));
      writeFileSync(swPath, source);
    },
  };
}

/**
 * The FastAPI backend listens on localhost:3000. The dev server proxies REST
 * and websocket traffic to it, so the browser only ever talks to one origin
 * (which keeps the sandboxed preview working without CORS gymnastics).
 */
const API_TARGET = process.env.VITE_API_TARGET || 'http://127.0.0.1:3000';

const proxy = {
  '/api': {target: API_TARGET, changeOrigin: true},
  '/live': {target: API_TARGET, changeOrigin: true},
  '/ws': {target: API_TARGET, changeOrigin: true, ws: true},
};

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorkerBuild()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Preview tunnels (https://<port>-<sandbox>.e2b.app) must be accepted.
    allowedHosts: true,
    // Vite's live-reload socket force-RELOADS the page whenever it reconnects
    // (phone locked, signal blip, tunnel hiccup) — players lose their place.
    // The app reconnects its own socket and refreshes data in place, so the
    // dev socket stays off unless a developer opts in with VITE_HMR=1.
    hmr: process.env.VITE_HMR === '1' ? undefined : false,
    proxy,
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        /* Vendor code in its own long-lived files: an app update then only
           re-downloads app code, not React (players pay for every MB). */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (/node_modules\/(motion|framer-motion|motion-dom|motion-utils)\//.test(id)) return 'motion';
          if (id.includes('node_modules/lucide-react/')) return 'icons';
          return undefined;
        },
      },
    },
  },
});
