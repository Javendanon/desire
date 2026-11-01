// Required Chrome gate: the page boots on WebGL2, one real click selects a place, and a pinch
// does not zoom or scroll the browser. Streaming, corridors, close-zoom math and memory budgets
// are unit tests. Usage: node tests/browser/waterdeep-smoke.mjs http://127.0.0.1:5200
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5200';
const CASTLE = '{ x: 1751.125, z: 4166.911 }';
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromePath = process.env.CHROME ?? (existsSync(MAC_CHROME) ? MAC_CHROME : 'google-chrome');
const port = 9900 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'waterdeep-smoke-'))}`,
  '--no-first-run',
  '--enable-unsafe-swiftshader',
  'about:blank',
], { stdio: 'ignore' });

async function pageSocket() {
  for (let i = 0; i < 60; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = pages.find((entry) => entry.type === 'page');
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
  pending.delete(message.id);
});
const send = (method, params = {}) => new Promise((resolve) => {
  id += 1;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

async function evaluate(expression) {
  const reply = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (reply.result?.exceptionDetails) {
    throw new Error(reply.result.exceptionDetails.exception?.description ??
      reply.result.exceptionDetails.text ?? 'evaluation failed');
  }
  return reply.result?.result?.value ?? null;
}

async function waitForReady() {
  for (let i = 0; i < 120; i++) {
    const state = await evaluate(
      'window.__waterdeep ? { ready: window.__waterdeep.ready, error: window.__waterdeep.error } : null');
    if (state?.ready) return;
    if (state?.error) throw new Error(state.error);
    await sleep(500);
  }
  throw new Error('the Waterdeep scene did not become ready');
}

async function assertBoot() {
  const check = await evaluate('window.__waterdeep.check()');
  assert.equal(check.stats.backend, 'webgl2', check.error ?? 'backend');
  assert.ok(check.ok, check.error ?? 'scene not healthy');
  assert.ok(check.stats.frames > 0, 'no frames');
}

async function clickCastle() {
  await evaluate("window.__waterdeep.viewer.focusPlace('castle-waterdeep')");
  let radius = Infinity;
  for (let i = 0; i < 50 && radius > 340; i++) {
    radius = (await evaluate('window.__waterdeep.viewer.stats()')).radius;
    if (radius > 340) await sleep(100);
  }
  assert.ok(radius <= 340, `camera did not snap (${radius})`);
  await evaluate("window.__waterdeep.viewer.selectPlace('the-market')");
  const point = await evaluate(`(() => {
    const point = window.__waterdeep.viewer.project(${CASTLE}, 0);
    const rect = document.getElementById('map').getBoundingClientRect();
    return {
      x: Math.round(point.x + rect.left),
      y: Math.round(point.y + rect.top),
      visible: point.visible,
    };
  })()`);
  assert.ok(point.visible && point.x > 0 && point.y > 0, `castle off canvas ${point.x},${point.y}`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type, x: point.x, y: point.y, button: 'left', clickCount: 1,
    });
  }
  assert.equal(
    (await evaluate('window.__waterdeep.viewer.stats()')).selected,
    'castle-waterdeep',
  );
}

function touch(x, y, finger = 0) {
  return { x, y, id: finger, radiusX: 5, radiusY: 5, force: 1 };
}

async function pinchDoesNotZoomTheBrowser() {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 600, height: 900, deviceScaleFactor: 1, mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await evaluate('window.__waterdeep.ready = false');
  await send('Page.reload');
  await waitForReady();
  assert.equal(await evaluate("getComputedStyle(document.getElementById('map')).touchAction"), 'none');
  await evaluate(`(() => {
    window.__touchCancels = 0;
    document.getElementById('map').addEventListener('pointercancel', () => window.__touchCancels++);
  })()`);
  const frames = [
    [touch(200, 400), touch(400, 400, 1)],
    [touch(150, 400), touch(450, 400, 1)],
    [touch(100, 400), touch(500, 400, 1)],
  ];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: frames[0] });
  for (const touchPoints of frames.slice(1)) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints });
    await sleep(60);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.deepEqual(await evaluate('[window.scrollX, window.scrollY, window.visualViewport.scale]'),
    [0, 0, 1], 'the browser took the pinch');
  assert.equal(await evaluate('window.__touchCancels'), 0, 'browser cancelled the pinch');
}

try {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await send('Page.navigate', { url: `${base}/waterdeep.html?backend=webgl2` });
  await waitForReady();
  await assertBoot();
  await clickCastle();
  await pinchDoesNotZoomTheBrowser();
  console.log(JSON.stringify({ ok: true, boot: true, click: true, pinch: true }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error) }, null, 1));
  process.exitCode = 1;
} finally {
  ws.close();
  chrome.kill();
}
