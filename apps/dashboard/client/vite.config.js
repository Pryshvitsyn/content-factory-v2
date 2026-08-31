import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const apiHost = process.env.DASHBOARD_API_HOST || '127.0.0.1';
const apiPort = Number(process.env.DASHBOARD_API_PORT || 3001);
const webHost = process.env.DASHBOARD_WEB_HOST || '127.0.0.1';
const webPort = Number(process.env.DASHBOARD_WEB_PORT || 3000);

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    host: webHost,
    port: webPort,
    strictPort: true,
    proxy: { '/api': `http://${apiHost}:${apiPort}` },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.js'] },
});
