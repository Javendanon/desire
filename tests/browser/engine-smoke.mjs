// Runs engine-smoke.html in a real Chrome over the DevTools protocol and fails on any leak.
// Needs the Vite dev server: node tests/browser/engine-smoke.mjs http://127.0.0.1:5199 [webgl2]
// CHROME=/path/to/chrome overrides the browser (default: the macOS Chrome, then google-chrome).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [base = 'http://127.0.0.1:5199', backend = 'auto'] = process.argv.slice(2);
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromePath = process.env.CHROME ?? (existsSync(MAC_CHROME) ? MAC_CHROME : 'google-chrome');
const port = 9500 + Math.floor(Math.random() * 400);
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'engine-smoke-'))}`,
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageSocket() {
  for (let i = 0; i < 60; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = pages.find((p) => p.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* Chrome still starting */
    }
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}

const ws = new WebSocket(await pageSocket());
await new Promise((resolve) => ws.addEventListener('open', resolve));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  pending.get(message.id)?.(message);
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

const query = backend === 'webgl2' ? '?backend=webgl2' : '';
await send('Page.navigate', { url: `${base}/engine-smoke.html${query}` });
let result = null;
for (let i = 0; i < 120 && !result?.done; i++) {
  await sleep(500);
  const reply = await send('Runtime.evaluate', {
    expression: 'window.__smoke ?? null',
    returnByValue: true,
  });
  result = reply.result?.result?.value ?? null;
}
ws.close();
chrome.kill();
console.log(JSON.stringify(result, null, 1));
process.exit(result?.ok ? 0 : 1);
