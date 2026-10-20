// Runs the browser scene regressions against a throwaway Vite server.
// The smoke test drives real Chrome over DevTools, so CI needs a served page first.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.BROWSER_SMOKE_PORT ?? 5219);
const BASE = `http://127.0.0.1:${PORT}`;
const START_ATTEMPTS = 60;

function startServer() {
  const child = spawn(
    'corepack',
    ['pnpm', 'dev', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
  );
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitForServer() {
  for (let attempt = 0; attempt < START_ATTEMPTS; attempt++) {
    try {
      const reply = await fetch(`${BASE}/waterdeep.html`);
      if (reply.ok) return;
    } catch {
      /* the server is still starting */
    }
    await sleep(500);
  }
  throw new Error(`the dev server did not answer on ${BASE}`);
}

function run(command, args) {
  const child = spawn(command, args, { stdio: 'inherit', env: process.env });
  return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
}

const server = startServer();
let exitCode = 1;
try {
  await waitForServer();
  exitCode = await run('node', ['tests/browser/waterdeep-smoke.mjs', BASE]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  server.kill('SIGTERM');
}
process.exitCode = exitCode;
