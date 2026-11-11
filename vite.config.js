import { defineConfig } from 'vite';
import { publicadoPlugin } from './publicado-plugin.js';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  plugins: [publicadoPlugin()],
  server: { host: '127.0.0.1', port: 5173 },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 2000 },
});
