// Required Chrome gate: the page boots on WebGL2, one real click selects a place, and a pinch
// does not zoom or scroll the browser. Also exercises D16 sheet focus, camera preservation,
// effects and mounted encounter replacement. Streaming and memory budgets are unit tests.
// Usage: node tests/browser/waterdeep-smoke.mjs http://127.0.0.1:5200
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
  '--no-sandbox',
  '--disable-dev-shm-usage',
  `--remote-debugging-port=${port}`,
  '--remote-debugging-address=127.0.0.1',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'waterdeep-smoke-'))}`,
  '--no-first-run',
  '--enable-unsafe-swiftshader',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeLog = '';
chrome.stderr?.on('data', (chunk) => {
  chromeLog = `${chromeLog}${chunk}`.slice(-800);
});
chrome.on('error', (error) => {
  chromeLog = `failed to start ${chromePath}: ${error.message}`;
});

async function pageSocket() {
  for (let i = 0; i < 60; i++) {
    for (const host of ['127.0.0.1', 'localhost']) {
      try {
        const pages = await (await fetch(`http://${host}:${port}/json`)).json();
        const page = pages.find((entry) => entry.type === 'page');
        if (page) return page.webSocketDebuggerUrl;
      } catch {
        /* Chrome still starting */
      }
    }
    await sleep(200);
  }
  throw new Error(`Chrome did not start (${chromePath}). ${chromeLog}`);
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
      'window.__waterdeep && { ready: window.__waterdeep.ready, error: window.__waterdeep.error }');
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
  const camera = await readCamera(true);
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
  return camera;
}

async function readCamera(rememberViewer = false) {
  return evaluate(`(() => {
    const viewer = window.__waterdeep.viewer;
    if (${rememberViewer}) window.__d16Viewer = viewer;
    const { focus, radius, azimuth, polar } = viewer.stats();
    return { focus, radius, azimuth, polar };
  })()`);
}

async function waitForSelector(selector) {
  for (let i = 0; i < 30; i++) {
    if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
    await sleep(100);
  }
  const active = await evaluate('document.activeElement?.outerHTML');
  throw new Error(`missing ${selector}; focused: ${active}`);
}

async function keyPress(key, code = key) {
  const virtualKey = { Enter: 13, Escape: 27, ' ': 32 }[key];
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type, key, code, windowsVirtualKeyCode: virtualKey,
      text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined,
    });
  }
}

async function openSheet(name) {
  const focused = await evaluate(`(() => {
    const button = [...document.querySelectorAll('[data-open-sheet]')]
      .find((entry) => entry.textContent.trim() === ${JSON.stringify(name)});
    button?.focus();
    return !!button && document.activeElement === button;
  })()`);
  assert.ok(focused, `no keyboard opener for ${name}`);
  await keyPress('Enter');
  await waitForSelector('#character-sheet');
  assert.equal(await evaluate('document.activeElement.id'), 'character-sheet-title');
}

async function assertCameraPreserved(camera) {
  assert.deepEqual(await readCamera(), camera, 'opening a sheet moved the map camera');
  assert.equal(await evaluate('window.__waterdeep.viewer === window.__d16Viewer'), true,
    'opening a sheet recreated the viewer');
}

async function assertSheetFromMap(camera) {
  await waitForSelector('#tactical-panel');
  await openSheet('Demo Warden');
  await assertCameraPreserved(camera);
  const sheet = await evaluate("document.querySelector('#character-sheet').textContent");
  assert.match(sheet, /Concentrating on Demo Veil/);
  assert.match(sheet, /fixture:d16-demo/);
  assert.match(sheet, /D&D 5e \(2014\)/);
  assert.match(sheet, /Synthetic example/);
  assert.equal(await evaluate("document.querySelectorAll('#character-sheet .particle').length"), 0);
  await assertEffects();
  await keyPress('Escape');
  assert.equal(await evaluate("!!document.querySelector('#character-sheet')"), false);
  assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Demo Warden');
  await openSheet('Demo Brute');
  await assertCameraPreserved(camera);
  const bruteSheet = await evaluate("document.querySelector('#character-sheet').textContent");
  assert.match(bruteSheet, /2 rounds left/);
  await keyPress('Escape');
  assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Demo Brute');
  await assertCameraPreserved(camera);
  await keyPress('Escape');
  assert.equal(await evaluate('document.activeElement.id'), 'tactical-launcher');
}

async function emulateMotion(value) {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value }],
  });
}

async function assertEffects() {
  await emulateMotion('no-preference');
  await waitForSelector('#character-sheet .particle');
  const count = await evaluate("document.querySelectorAll('#character-sheet .particle').length");
  assert.ok(count > 0 && count <= 12, 'particle budget exceeded');
  const ariaHidden = await evaluate("document.querySelector('#character-sheet .field').ariaHidden");
  assert.equal(ariaHidden, 'true');
  await emulateMotion('reduce');
  await waitForSelector('#character-sheet .field:not(:has(.particle))');
  assert.equal(await evaluate("document.querySelectorAll('#character-sheet .particle').length"), 0,
    'active reduced motion did not remove particles');
  await emulateMotion('no-preference');
  await waitForSelector('#character-sheet .particle');
  await evaluate("document.querySelector('#tactical-particles').focus()");
  await keyPress(' ', 'Space');
  assert.equal(await evaluate("document.querySelector('#tactical-particles').checked"), false);
  assert.equal(await evaluate("document.querySelectorAll('#character-sheet .particle').length"), 0);
  assert.equal(await evaluate("localStorage.getItem('desire.tactical.particles')"), 'off');
  await emulateMotion('reduce');
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
  const touchAction = await evaluate(
    "getComputedStyle(document.getElementById('map')).touchAction");
  assert.equal(touchAction, 'none');
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

async function assertPreferenceAfterReload() {
  await evaluate("document.querySelector('#tactical-launcher').focus()");
  await keyPress('Enter');
  await waitForSelector('#tactical-panel');
  assert.equal(await evaluate("document.querySelector('#tactical-particles').checked"), false,
    'particle preference did not survive reload');
}

try {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await emulateMotion('reduce');
  await send('Page.navigate', { url: `${base}/waterdeep.html?backend=webgl2` });
  await waitForReady();
  await assertBoot();
  await evaluate(`(async () => (await import('/tests/browser/encounter-replacement.svelte.ts'))
    .checkEncounterReplacement())()`);
  const camera = await clickCastle();
  await assertSheetFromMap(camera);
  await pinchDoesNotZoomTheBrowser();
  await assertPreferenceAfterReload();
  console.log(JSON.stringify({
    ok: true, boot: true, click: true, sheet: true, effects: true,
    encounterReplacement: true, pinch: true,
  }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error) }, null, 1));
  process.exitCode = 1;
} finally {
  ws.close();
  chrome.kill();
}
