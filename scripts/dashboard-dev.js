'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const { localStorageRoot } = require('./local-runtime');

const viteExecutable = path.resolve(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vite.cmd' : 'vite',
);

const storageRoot = localStorageRoot(process.env);
const childEnv = { ...process.env, CONTENT_FACTORY_STORAGE_ROOT: storageRoot };
let database = process.env.CONTENT_FACTORY_DATABASE || 'unresolved';
try { if (process.env.DATABASE_URL) database = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//,'')) || database; } catch {}
console.log(`Database: ${database}`);
console.log(`Artifact storage: ${storageRoot}`);

const children = [
  { name: 'Control API', process: spawn(process.execPath, ['apps/dashboard/server/index.js'], { stdio: 'inherit', env: childEnv }) },
  { name: 'Vite frontend', process: spawn(viteExecutable, ['--config', 'apps/dashboard/client/vite.config.js'], { stdio: 'inherit', env: childEnv }) },
];

let stopping = false;
function stop(code = 0, message = null) {
  if (stopping) return;
  stopping = true;
  if (message) console.error(message);
  for (const child of children) {
    if (child.process.exitCode === null && !child.process.killed) child.process.kill('SIGTERM');
  }
  process.exitCode = code;
}

for (const child of children) {
  child.process.on('error', (error) => {
    stop(1, `${child.name} failed to start: ${error.message}`);
  });
  child.process.on('exit', (code, signal) => {
    if (!stopping) {
      const detail = signal ? `signal ${signal}` : `exit code ${code}`;
      stop(code || 1, `${child.name} stopped unexpectedly (${detail}); shutting down dashboard.`);
    }
  });
}
process.on('SIGINT', () => stop(0, 'Stopping dashboard…'));
process.on('SIGTERM', () => stop(0, 'Stopping dashboard…'));
