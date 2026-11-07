// Minimal Chrome DevTools driver for the browser gates. One page per process, no dependencies.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startChrome(profile) {
  const executable = process.env.CHROME ?? (existsSync(MAC_CHROME) ? MAC_CHROME : 'google-chrome');
  const port = 9900 + Math.floor(Math.random() * 400);
  const child = spawn(executable, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), `${profile}-`))}`,
    '--no-first-run',
    '--enable-unsafe-swiftshader',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  child.on('error', (error) => (log = `failed to start ${executable}: ${error.message}`));
  child.stderr?.on('data', (chunk) => (log = `${log}${chunk}`.slice(-800)));
  return { child, port, executable, log: () => log };
}

async function pageSocket(chrome) {
  for (let attempt = 0; attempt < 60; attempt++) {
    for (const host of ['127.0.0.1', 'localhost']) {
      try {
        const reply = await fetch(`http://${host}:${chrome.port}/json`);
        const pages = await reply.json();
        const page = pages.find((entry) => entry.type === 'page');
        if (page) return page.webSocketDebuggerUrl;
      } catch {
        /* Chrome still starting */
      }
    }
    await sleep(200);
  }
  throw new Error(`Chrome did not start (${chrome.executable}). ${chrome.log()}`);
}

export async function connectChrome(profile) {
  const chrome = startChrome(profile);
  const websocket = new WebSocket(await pageSocket(chrome));
  await new Promise((resolve) => websocket.addEventListener('open', resolve));
  let nextId = 0;
  const pending = new Map();
  const loadWaiters = [];

  function send(method, params = {}) {
    return new Promise((resolve) => {
      nextId += 1;
      pending.set(nextId, resolve);
      websocket.send(JSON.stringify({ id: nextId, method, params }));
    });
  }

  websocket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Page.loadEventFired') loadWaiters.shift()?.();
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });

  async function evaluate(expression) {
    const reply = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (reply.result?.exceptionDetails) {
      const detail = reply.result.exceptionDetails;
      throw new Error(detail.exception?.description ?? detail.text ?? 'evaluation failed');
    }
    return reply.result?.result?.value ?? null;
  }

  async function waitFor(expression, label, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${label}`);
  }

  async function click(selector) {
    const clicked = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.click();
      return true;
    })()`);
    assert.ok(clicked, `missing ${selector}`);
  }

  async function navigate(url) {
    await send('Page.navigate', { url });
    await waitFor(`location.href === ${JSON.stringify(url)}`, 'address');
  }

  async function reload() {
    const loaded = new Promise((resolve) => loadWaiters.push(resolve));
    await send('Page.reload', { ignoreCache: true });
    await loaded;
  }

  async function tabOrder(limit, from = null) {
    if (from) await evaluate(`document.getElementById(${JSON.stringify(from)})?.focus()`);
    else await evaluate('document.activeElement?.blur()');
    const seen = [];
    for (let step = 0; step < limit; step += 1) {
      for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', {
          type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9,
        });
      }
      seen.push(await evaluate(`(() => {
        const element = document.activeElement;
        if (!element) return null;
        return {
          id: element.id,
          classes: String(element.className ?? ''),
          parked: Boolean(element.closest('.parked')),
        };
      })()`));
    }
    return seen;
  }

  async function columns(selector) {
    const count = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      return element ? getComputedStyle(element).gridTemplateColumns.split(' ').length : null;
    })()`);
    assert.notEqual(count, null, `missing ${selector}`);
    return count;
  }

  await send('Page.enable');
  return {
    send, evaluate, waitFor, click, navigate, reload, tabOrder, columns,
    close() {
      websocket.close();
      chrome.child.kill();
    },
  };
}
