import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig, type Plugin} from 'vite';

/**
 * The FastAPI backend listens on localhost:9000. The dev server proxies REST
 * and websocket traffic to it, so the browser only ever talks to one origin
 * (which keeps the sandboxed preview working without CORS gymnastics).
 */
const API_TARGET = process.env.VITE_API_TARGET || 'http://127.0.0.1:9000';

const proxy = {
  '/api': {target: API_TARGET, changeOrigin: true},
  '/live': {target: API_TARGET, changeOrigin: true},
  '/ws': {target: API_TARGET, changeOrigin: true, ws: true},
};

/**
 * Installable app: emits dist/sw.js from pwa/sw-template.js with the exact
 * hashed files of this build precached, and a version derived from them, so
 * each deploy ships a new worker and the app offers a one-tap reload.
 * Build only: the dev server never registers a worker.
 */
const SHELL_STATIC = [
  '/index.html',
  '/manifest.webmanifest',
  '/brand/logo.png',
  '/brand/logo-full.png',
  '/brand/icon-192.png',
  '/brand/icon-512.png',
  '/brand/favicon-32.png',
  '/brand/apple-touch-icon.png',
];

export function cloverPwa(): Plugin {
  return {
    name: 'clover-pwa',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle)
        .filter((file) => /\.(js|css|woff2)$/.test(file) && !file.endsWith('.map'))
        // Symbol and accented-letter faces are range-limited and rarely needed;
        // they are fetched (and then cached) only when such a character shows up.
        .filter((file) => !/noto-sans-symbols|latin-ext/.test(file))
        .map((file) => `/${file}`)
        .sort();
      const precache = [...SHELL_STATIC, ...built];
      const version = createHash('sha256').update(precache.join('\n')).update(readFileSync(path.resolve(__dirname, 'index.html'))).digest('hex').slice(0, 12);
      const template = readFileSync(path.resolve(__dirname, 'pwa/sw-template.js'), 'utf8');
      const source = template
        .replace('"__CLOVER_VERSION__"', JSON.stringify(version))
        .replace('__CLOVER_PRECACHE__', JSON.stringify(precache, null, 2));
      this.emitFile({type: 'asset', fileName: 'sw.js', source});
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cloverPwa()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 9009,
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
    port: 9009,
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
