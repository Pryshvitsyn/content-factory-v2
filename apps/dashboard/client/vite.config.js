import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const apiHost = process.env.DASHBOARD_API_HOST || '127.0.0.1';
const apiPort = Number(process.env.DASHBOARD_API_PORT || 3001);
const webHost = process.env.DASHBOARD_WEB_HOST || '127.0.0.1';
const webPort = Number(process.env.DASHBOARD_WEB_PORT || 3000);
const clientRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: clientRoot,
  plugins: [react()],
  resolve: {
    // Keep the established AvatarStudio module intact for legacy direct imports/tests while
    // routing the dashboard entry to the additive multi-source operator workflow.
    alias: [{ find: /^\.\/AvatarStudio$/, replacement: fileURLToPath(new URL('./src/AvatarStudioMultiSource.jsx', import.meta.url)) }],
  },
  server: {
    host: webHost,
    port: webPort,
    strictPort: true,
    proxy: { '/api': `http://${apiHost}:${apiPort}` },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.js'] },
});
