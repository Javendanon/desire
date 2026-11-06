// Runs the browser scene and campaign hub regressions against a throwaway Vite server.
// The smoke test drives real Chrome over DevTools, so CI needs a served page first.
import { spawn } from 'node:child_process';
import { startVite, stopServer, waitForServer } from './dev-server.mjs';

const PORT = Number(process.env.BROWSER_SMOKE_PORT ?? 5219);
const BASE = `http://127.0.0.1:${PORT}`;

function run(command, args) {
  const child = spawn(command, args, { stdio: 'inherit', env: process.env });
  return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
}

const server = startVite(PORT);
let exitCode = 1;
try {
  await waitForServer(server, BASE);
  const scripts = [
    'tests/browser/waterdeep-smoke.mjs',
    'tests/browser/campaign-hub-smoke.mjs',
  ];
  exitCode = 0;
  for (const script of scripts) {
    exitCode = await run('node', [script, BASE]);
    if (exitCode !== 0) break;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  stopServer(server);
}
process.exitCode = exitCode;
