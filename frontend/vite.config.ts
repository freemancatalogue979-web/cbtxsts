import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

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
  plugins: [react(), tailwindcss()],
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
        manualChunks: {
          react: ['react', 'react-dom'],
          motion: ['motion'],
          icons: ['lucide-react'],
        },
      },
    },
  },
});
