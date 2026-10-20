// Runs waterdeep.html in a real Chrome over the DevTools protocol: proves the scene renders,
// streams sectors, pans, zooms, selects a place and leaves no max-detail city loaded.
// Usage: node tests/browser/waterdeep-smoke.mjs http://127.0.0.1:5200 [screenshot.png]
// CHROME=/path/to/chrome overrides the browser (default: the macOS Chrome, then google-chrome).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkClosePicking, checkTouchGestures } from './map-gestures.mjs';

const [base = 'http://127.0.0.1:5200', screenshot = '/tmp/waterdeep-sectors.png'] =
  process.argv.slice(2);
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromePath = process.env.CHROME ?? (existsSync(MAC_CHROME) ? MAC_CHROME : 'google-chrome');
const port = 9900 + Math.floor(Math.random() * 400);
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'waterdeep-smoke-'))}`,
    '--no-first-run',
    '--enable-unsafe-swiftshader',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (expression) => {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (reply.result?.exceptionDetails) {
    throw new Error(reply.result.exceptionDetails.text ?? 'evaluation failed');
  }
  return reply.result?.result?.value ?? null;
};

async function waitForReady() {
  for (let i = 0; i < 120; i++) {
    const state = await evaluate('window.__waterdeep ? { ready: window.__waterdeep.ready, error: window.__waterdeep.error } : null');
    if (state?.ready) return state;
    if (state?.error) throw new Error(state.error);
    await sleep(500);
  }
  throw new Error('the Waterdeep scene did not become ready');
}

try {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: `${base}/waterdeep.html?backend=webgl2` });
  await waitForReady();
  await sleep(900);

  const first = await evaluate('window.__waterdeep.check()');
  await evaluate('window.__waterdeep.viewer.panBy(260, 150)');
  await sleep(700);
  const panned = await evaluate('window.__waterdeep.check()');
  await evaluate('window.__waterdeep.viewer.zoomBy(-4)');
  await sleep(800);
  const zoomed = await evaluate('window.__waterdeep.check()');
  const selected = await evaluate(
    "(() => { document.getElementById('control-points').click(); return window.__waterdeep.viewer.selectPlace('castle-waterdeep'); })()",
  );
  await evaluate("window.__waterdeep.viewer.focusPlace('castle-waterdeep')");
  await sleep(1400);
  const clickAt = await evaluate(`(() => {
    const viewer = window.__waterdeep.viewer;
    viewer.selectPlace('the-market');
    const point = viewer.project({ x: 1751.125, z: 4166.911 }, 0);
    return { x: Math.round(point.x), y: Math.round(point.y) };
  })()`);
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: clickAt.x,
    y: clickAt.y,
    button: 'left',
    clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: clickAt.x,
    y: clickAt.y,
    button: 'left',
    clickCount: 1,
  });
  await sleep(500);
  const clicked = await evaluate('window.__waterdeep.check()');
  await evaluate("window.__waterdeep.viewer.panBy(-100000, -100000)");
  await sleep(900);
  const unloaded = await evaluate('window.__waterdeep.check()');
  await evaluate("window.__waterdeep.viewer.focusPlace('castle-waterdeep')");
  await sleep(1500);
  const reloaded = await evaluate('window.__waterdeep.check()');
  const selectedState = await evaluate('window.__waterdeep.check()');
  const closePicking = await checkClosePicking(send, evaluate);
  const touch = await checkTouchGestures(send, evaluate);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result?.data) writeFileSync(screenshot, Buffer.from(shot.result.data, 'base64'));
  await evaluate('window.__waterdeep.viewer.reset()');
  await sleep(1400);
  const overviewShot = await send('Page.captureScreenshot', { format: 'png' });
  const overviewPath = screenshot.replace(/\.png$/, '-overview.png');
  if (overviewShot.result?.data) writeFileSync(overviewPath, Buffer.from(overviewShot.result.data, 'base64'));
  await evaluate('window.__waterdeep.viewer.zoomBy(-40); window.__waterdeep.viewer.orbit(0, 5000)');
  await sleep(1700);
  const projection = await evaluate(`(() => {
    const viewer = window.__waterdeep.viewer;
    const base = viewer.project({ x: 1750, z: 3550 }, 0);
    const east = viewer.project({ x: 1850, z: 3550 }, 0);
    const shore = viewer.project({ x: 290, z: 3550 }, 0);
    return {
      hundredMetresPx: Math.hypot(east.x - base.x, east.y - base.y),
      shoreX: shore.x,
      canvasWidth: document.getElementById('map').clientWidth,
    };
  })()`);
  const topShot = await send('Page.captureScreenshot', { format: 'png' });
  const topPath = screenshot.replace(/\.png$/, '-top.png');
  if (topShot.result?.data) writeFileSync(topPath, Buffer.from(topShot.result.data, 'base64'));

  const moved =
    Math.hypot(panned.stats.focus.x - first.stats.focus.x, panned.stats.focus.z - first.stats.focus.z) >
    20;
  const zoomedOut = zoomed.stats.radius > panned.stats.radius + 20;
  const streamed =
    zoomed.stats.sectors.sectors > 0 &&
    zoomed.stats.sectors.sectors <= zoomed.maxDetailSectors &&
    zoomed.stats.sectors.sectors < zoomed.totalSectors &&
    zoomed.stats.sectors.farInstances > zoomed.stats.sectors.detailedBuildings;
  const pickedByPointer = clicked.stats.selected === 'castle-waterdeep';
  const survivedReload =
    reloaded.ok &&
    reloaded.stats.sectors.sectors > 0 &&
    reloaded.stats.frames > unloaded.stats.frames;
  const ok =
    first.ok &&
    moved &&
    zoomedOut &&
    streamed &&
    selected?.id === 'castle-waterdeep' &&
    selectedState.stats.selected === 'castle-waterdeep' &&
    pickedByPointer &&
    survivedReload;

  console.log(
    JSON.stringify(
      {
        ok,
        screenshot,
        overview: screenshot.replace(/\.png$/, '-overview.png'),
        top: screenshot.replace(/\.png$/, '-top.png'),
        backend: first.stats.backend,
        first: first.stats.sectors,
        pannedFocus: panned.stats.focus,
        radius: { before: panned.stats.radius, after: zoomed.stats.radius },
        streamed,
        pickedByPointer,
        closePicking,
        touch,
        survivedReload,
        projection,
        selected: selected?.id ?? null,
      },
      null,
      1,
    ),
  );
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error) }, null, 1));
  process.exitCode = 1;
} finally {
  ws.close();
  chrome.kill();
}
