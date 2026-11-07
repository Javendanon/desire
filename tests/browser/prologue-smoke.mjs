// Required browser gate for the optional campaign prologue: real Chrome over the dev server.
// Covers the always-available skip, the scene crossfade on scroll, reduced motion, a slow
// network, the narrow layout and the rule that skipping is remembered for the page load.
// Unit-level scroll math and teardown stay in tests/prologue-scroll.test.ts.
import assert from 'node:assert/strict';
import { startVite, stopServer, waitForServer } from '../../tools/ci/dev-server.mjs';
import { connectChrome } from './cdp.mjs';

const PORT = Number(process.env.PROLOGUE_SMOKE_PORT ?? 5223);
const BASE = `http://127.0.0.1:${PORT}`;
const CAMPAIGN = `${BASE}/#/campaigns/smoke-campaign/summary`;
const FLAGS = 'tests/browser/flags.prologue.txt';

let send;
let evaluate;
let waitFor;
let click;
let navigate;
let reload;

const OPACITIES = `[...document.querySelectorAll('.prologue [data-scene]')]
  .map((scene) => Number(scene.style.opacity))`;

async function skipIsAlwaysAvailable() {
  await navigate(CAMPAIGN);
  await waitFor("document.querySelector('.prologue') !== null", 'prologue');

  const skip = await evaluate(`(() => {
    const button = document.querySelector('.prologue button.skip');
    if (!button) return null;
    const box = button.getBoundingClientRect();
    return {
      label: button.textContent.replace(/\\s+/g, ' ').trim(),
      visible: box.width > 0 && box.height > 0,
      focused: document.activeElement === button,
    };
  })()`);
  assert.deepEqual(skip, { label: 'Saltar a la mesa', visible: true, focused: true });
  assert.ok(
    await evaluate("document.getElementById('content') !== null"),
    'the table is mounted behind the prologue, not replaced by it',
  );
}

async function scrollMovesTheScenes() {
  const sceneCount = await evaluate("document.querySelectorAll('.prologue [data-scene]').length");
  assert.ok(sceneCount >= 2, 'the scroll experience crosses at least two scenes');
  const before = await evaluate(OPACITIES);
  assert.ok(before[0] > 0.99, 'the first scene starts visible');
  assert.equal(before[1], 0);

  await evaluate("document.querySelector('.prologue').scrollTop += window.innerHeight");
  await waitFor(`${OPACITIES}[1] > 0.99`, 'second scene');
  assert.equal(
    await evaluate(`${OPACITIES}[0]`),
    0,
    'the first scene leaves as the second arrives',
  );
  await evaluate("document.querySelector('.prologue').scrollTop = 0");
  await waitFor(`${OPACITIES}[0] > 0.99`, 'first scene again');
}

async function escapeLeavesForTheTable() {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
    });
  }
  await waitFor("document.querySelector('.prologue') === null", 'prologue closed by Escape');
  await waitFor("document.activeElement?.id === 'content'", 'focus returns to the table');

  await navigate(`${BASE}/#/campaigns/another-campaign/summary`);
  await waitFor("document.querySelector('#content') !== null", 'second campaign');
  assert.equal(
    await evaluate("document.querySelector('.prologue')"),
    null,
    'the prologue is offered once per page load, not on every campaign',
  );
}

async function reducedMotionShowsAStaticScene() {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await reload();
  await waitFor("document.querySelector('.prologue') !== null", 'static prologue');
  assert.equal(
    await evaluate("document.querySelector('.prologue .track')"),
    null,
    'reduced motion renders no scroll track',
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.prologue [data-scene]').length"),
    0,
    'reduced motion attaches no scroll scenes',
  );
  assert.equal(
    await evaluate("document.querySelector('.prologue .still-frame') !== null"),
    true,
  );
  await click('.prologue button.skip');
  await waitFor("document.querySelector('.prologue') === null", 'static prologue skipped');
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
}

async function missingIllustrationKeepsTheSkip() {
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*/assets/abbey.jpg'] });
  await reload();
  await waitFor("document.querySelector('.prologue button.skip') !== null", 'skip without a still');
  await waitFor(
    "document.querySelector('.prologue .still')?.hidden === true",
    'the failed illustration falls back to the gradient',
  );
  const label = await evaluate(
    "document.querySelector('.prologue button.skip').textContent.trim()",
  );
  assert.equal(label, 'Saltar a la mesa');
  await click('.prologue button.skip');
  await waitFor("document.querySelector('.prologue') === null", 'left without the illustration');
  await send('Network.setBlockedURLs', { urls: [] });
}

const FAIL_PROLOGUE_MOUNT = `
  const querySelectorAll = Element.prototype.querySelectorAll;
  Element.prototype.querySelectorAll = function (selector) {
    if (this.classList.contains('prologue') && selector === '[data-scene]') {
      window.prologueFailureInjected = true;
      throw new Error('Injected prologue mount failure');
    }
    return querySelectorAll.call(this, selector);
  };
  const logError = console.error;
  console.error = (message, ...args) => {
    if (message === 'Campaign prologue failed') {
      window.prologueFailureLogged = args[0]?.message === 'Injected prologue mount failure';
    }
    logError(message, ...args);
  };
`;

async function failedPrologueRestoresTheShell() {
  const script = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: FAIL_PROLOGUE_MOUNT,
  });
  try {
    await reload();
    await waitFor('window.prologueFailureInjected === true', 'injected component mount failure');
    await waitFor('window.prologueFailureLogged === true', 'component failure logged with context');
    await waitFor("document.querySelector('.prologue') === null", 'failed prologue removed');
    assert.equal(
      await evaluate("document.querySelector('.shell')?.inert"),
      false,
      'a component failure must release the shell, not just remove the overlay',
    );
    await waitFor("document.activeElement?.id === 'content'", 'focus after component failure');
    await evaluate("document.querySelector('.brand').focus()");
    assert.equal(await evaluate("document.activeElement?.matches('.brand')"), true);
    await click('.brand');
    await waitFor("location.hash === '#/campaigns'", 'hub navigation after component failure');
  } finally {
    await send('Page.removeScriptToEvaluateOnNewDocument', {
      identifier: script.result.identifier,
    });
  }
}

async function narrowScreenKeepsTheSkipReachable() {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 780, deviceScaleFactor: 1, mobile: true,
  });
  await reload();
  await waitFor("document.querySelector('.prologue button.skip') !== null", 'narrow prologue');
  const inside = await evaluate(`(() => {
    const box = document.querySelector('.prologue button.skip').getBoundingClientRect();
    return box.top >= 0 && box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
  })()`);
  assert.equal(inside, true, 'the skip button stays inside a 390px viewport');
  await click('.prologue button.skip');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1400, height: 900, deviceScaleFactor: 1, mobile: false,
  });
}

let exitCode = 0;
let chrome;
// This suite owns its server: the gate's shared server runs with its own flags file.
process.env.DESIRE_FLAGS_FILE = FLAGS;
const server = startVite(PORT);
try {
  await waitForServer(server, BASE);
  chrome = await connectChrome('prologue-smoke');
  ({ send, evaluate, waitFor, click, navigate, reload } = chrome);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1400, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });

  await skipIsAlwaysAvailable();
  await scrollMovesTheScenes();
  await escapeLeavesForTheTable();
  await reducedMotionShowsAStaticScene();
  await missingIllustrationKeepsTheSkip();
  await narrowScreenKeepsTheSkipReachable();
  await failedPrologueRestoresTheShell();
  const report = {
    ok: true, skip: true, scroll: true, reduced: true, fallback: true, componentFailure: true,
  };
  console.log(JSON.stringify(report));
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ok: false, error: reason }, null, 1));
  exitCode = 1;
} finally {
  chrome?.close();
  stopServer(server);
}
process.exitCode = exitCode;
