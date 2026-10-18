// End-to-end smoke: drives the prototype in headless Chrome through CDP.
// Usage: node docs/design/prototype/smoke.mjs
// Requires the prototype served by Vite on the port in PROTOTYPE_URL.
import assert from 'node:assert/strict';
import { checkInitiativeFocus, checkLiveHp } from './rework-smoke.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const DEBUG_PORT = 9333;
const PAGE_URL =
  process.env.PROTOTYPE_URL ?? 'http://127.0.0.1:5199/docs/design/prototype/index.html';
const SEARCH_SETTLE_MS = 600;
const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = 844;
const MAP_MIN_HEIGHT_PX = 320;
const RENDER_WAIT_MS = 1500;
const CDP_TIMEOUT_MS = 10000;
const TARGET_POLL_ATTEMPTS = 40;
const TARGET_POLL_MS = 250;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  assert.ok(found, 'no Chrome binary found; set CHROME_PATH');
  return found;
}

function startChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'desire-d03-smoke-'));
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  return { chrome, profile };
}

async function waitForTarget() {
  for (let attempt = 0; attempt < TARGET_POLL_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting.
    }
    await wait(TARGET_POLL_MS);
  }
  throw new Error('Chrome DevTools endpoint never became reachable');
}

function dispatch(pending, message) {
  const resolver = pending.get(message.id);
  if (!resolver) return;
  pending.delete(message.id);
  resolver(message);
}

function createSend(socket, pending) {
  let nextId = 1;
  return (method, params = {}) => {
    const id = nextId;
    nextId += 1;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout after ${CDP_TIMEOUT_MS}ms: ${method}`));
      }, CDP_TIMEOUT_MS);
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(`CDP error: ${message.error.message}`));
        else resolve(message);
      });
    });
  };
}

function connect(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  socket.addEventListener('message', (event) => dispatch(pending, JSON.parse(event.data)));
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', reject);
  });
  return { opened, send: createSend(socket, pending) };
}

async function clickControl(send, evaluate, selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element?.checkVisibility()) throw new Error('not visible: ' + ${JSON.stringify(selector)});
    if (element.disabled) throw new Error('disabled control: ' + ${JSON.stringify(selector)});
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (!element.contains(document.elementFromPoint(x, y))) {
      throw new Error('obstructed control: ' + ${JSON.stringify(selector)});
    }
    return { x, y };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', button: 'left', clickCount: 1, ...point,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', button: 'left', clickCount: 1, ...point,
  });
}

function browserApi(send) {
  const evaluate = async (expression) => {
    const reply = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (reply.result.exceptionDetails) {
      throw new Error(reply.result.exceptionDetails.exception?.description ?? 'evaluate failed');
    }
    return reply.result.result.value;
  };
  const literal = (selector) => `'${selector.replace(/'/g, "\\'")}'`;
  return {
    evaluate,
    click: (selector) => clickControl(send, evaluate, selector),
    press: async (key) => {
      const keyCode = { Tab: 9, Enter: 13, Escape: 27 }[key];
      const params = { key, code: key, windowsVirtualKeyCode: keyCode };
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown', text: key === 'Enter' ? '\r' : '', ...params,
      });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
    },
    read: (selector, property = 'textContent') => evaluate(`$(${literal(selector)}).${property}`),
    count: (selector) => evaluate(`$$(${literal(selector)}).length`),
    has: (selector) => evaluate(`Boolean($(${literal(selector)}))`),
    visible: (selector) => evaluate(`$(${literal(selector)}).checkVisibility()`),
  };
}

async function checkTable(page) {
  assert.equal(await page.visible('#view-start'), true, 'start view is visible');
  assert.equal(await page.visible('#view-atlas'), false, 'atlas stays hidden on start');
  assert.equal(await page.count('.marker'), 6, 'map markers');
  assert.equal(await page.count('[data-action="select-participant"]'), 5, 'initiative rows');

  await assert.rejects(page.click('[data-action="next-turn"]'), /not visible/);
  await page.click('.rail [data-view="encounter"]');
  assert.equal(await page.visible('#view-encounter'), true, 'combat controls are reachable');
  await page.click('[data-action="next-turn"]');
  const activeName = '[data-active="true"] .turn__name';
  assert.equal(await page.read(activeName), 'Sera', 'next turn is immediate');

  await page.click('[data-action="damage"]');
  const activeMeta = '[data-active="true"] .turn__meta';
  assert.match(await page.read(activeMeta), /14\/24 PV/, 'damage updates');
  await page.click('.rail [data-view="start"]');
}

async function checkSearch(page) {
  await page.click('[data-action="open-search"]');
  assert.equal(await page.read('#search-dialog', 'open'), true, 'search opens');
  await page.evaluate(`(() => {
    const input = $('#lore-input');
    input.value = 'pozo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(SEARCH_SETTLE_MS);
  const firstResult = '.result .result__title';
  assert.equal(await page.read(firstResult), 'Portal Bostezante', 'lore search works');

  await page.evaluate('$(".result").focus()');
  await page.evaluate(
    '$(".result").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))',
  );
  assert.equal(await page.evaluate('document.activeElement.dataset.lore'), 'well-whispers');

  await page.evaluate(`(() => {
    const input = $('#lore-input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
  })()`);
  const viewAfterTyping = await page.read('#app', 'dataset.view');
  assert.equal(viewAfterTyping, 'start', 'digits do not switch views while typing');

  await page.click('[data-action="demo-state"][data-demo-state="error"]');
  await wait(SEARCH_SETTLE_MS);
  assert.equal(await page.has('.state-note--error'), true, 'error state survives the debounce');
}

async function checkPanels(page) {
  await page.click('[data-action="retry-search"]');
  await page.click('.result');
  assert.equal(await page.read('#side-panel-title'), 'Portal Bostezante', 'lore panel opens');
  assert.equal(await page.read('#side-panel', 'hidden'), false, 'panel is visible');

  await page.click('[data-action="close-panel"]');
  await page.click('[data-action="open-sheet"]');
  assert.equal(await page.read('#side-panel-title'), 'Aubrey Valcourt', 'sheet panel opens');
  await page.click('[data-action="close-panel"]');
}

async function checkScenarioJump(page) {
  await page.click('[data-action="set-view"][data-view="atlas"]');
  assert.equal(await page.read('#app', 'dataset.view'), 'atlas', 'atlas view switches');
  assert.equal(await page.visible('#view-atlas'), true, 'atlas view is visible');
  assert.equal(await page.visible('#view-start'), false, 'start view hides');

  const chip = '[data-scenario="well-whispers"]';
  const chipTitle = (await page.read(chip)).trim();
  await page.click(chip);
  assert.equal(await page.read('#encounter-title'), chipTitle, 'scenario jump updates the scene');
  assert.equal(await page.read('#app', 'dataset.view'), 'encounter', 'jump lands on the table');
  assert.equal(await page.visible('#view-encounter'), true, 'encounter view is visible');
}

async function checkMobile(page, send) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: MOBILE_WIDTH,
    height: MOBILE_HEIGHT,
    deviceScaleFactor: 2,
    mobile: true,
  });
  assert.equal(
    await page.evaluate('getComputedStyle($(".rail")).flexDirection'),
    'row',
    'mobile rail becomes a tab bar',
  );
  assert.equal(
    await page.evaluate('getComputedStyle($(".map-frame")).minHeight'),
    `${MAP_MIN_HEIGHT_PX}px`,
    'map keeps its minimum height on mobile',
  );
}

async function main() {
  const { chrome, profile } = startChrome();
  try {
    const { opened, send } = connect(await waitForTarget());
    await opened;
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: PAGE_URL });
    await wait(RENDER_WAIT_MS);
    await send('Runtime.evaluate', {
      expression:
        'window.$ = (s) => document.querySelector(s); ' +
        'window.$$ = (s) => document.querySelectorAll(s)',
    });

    const page = browserApi(send);
    await checkTable(page);
    await checkSearch(page);
    await checkPanels(page);
    await checkScenarioJump(page);
    await checkLiveHp(page);
    await checkInitiativeFocus(page);
    await checkMobile(page, send);

    console.log('smoke ok: map, turn, search states, panel, scenario, mobile rail');
  } finally {
    chrome.kill('SIGKILL');
    await wait(400);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
