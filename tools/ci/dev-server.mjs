// Start and await the throwaway Vite server used by the browser gate.
// Vite is spawned directly: `pnpm dev` leaves a grandchild holding stdout open, so the CI step
// would never exit after a successful run. Readiness is fail-closed: a server that exited is an
// error even when some other process answers on the port.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const VITE_PACKAGE = dirname(createRequire(import.meta.url).resolve('vite/package.json'));
const VITE = join(VITE_PACKAGE, 'bin', 'vite.js');

export function startVite(port) {
  const child = spawn(
    process.execPath,
    [VITE, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
  );
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

function serverFailure(server) {
  return `the dev server exited with code ${server.exitCode ?? server.signalCode}`;
}

/** Wait until the spawned server answers. Rejects if it exited or never binds. O(attempts). */
export async function waitForServer(server, base, {
  attempts = 60, delayMs = 500, fetchPage = (url) => fetch(url),
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (server.exitCode !== null) throw new Error(serverFailure(server));
    try {
      const reply = await fetchPage(`${base}/waterdeep.html`);
      if (reply.ok) {
        if (server.exitCode !== null) throw new Error(serverFailure(server));
        return;
      }
    } catch (error) {
      if (server.exitCode !== null) throw new Error(serverFailure(server));
      if (!(error instanceof TypeError)) throw error;
    }
    await sleep(delayMs);
  }
  throw new Error(`the dev server did not answer on ${base}`);
}

export function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  setTimeout(() => server.kill('SIGKILL'), 2000).unref();
}
