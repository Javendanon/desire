// Real DevTools input events exercise browser gesture arbitration, not synthetic PointerEvents.
import assert from 'node:assert/strict';

const settle = () => new Promise((resolve) => setTimeout(resolve, 2600));
const state = 'window.__waterdeep.viewer.stats()';

export async function checkClosePicking(send, evaluate) {
  await evaluate(`(() => {
    const viewer = window.__waterdeep.viewer;
    viewer.focusPlace('castle-waterdeep');
    viewer.zoomBy(100);
  })()`);
  await settle();
  const close = await evaluate(state);
  assert.ok(close.radius < 50, `close zoom radius ${close.radius}`);
  const point = await evaluate(`(() => {
    const viewer = window.__waterdeep.viewer;
    viewer.selectPlace('the-market');
    return viewer.project({ x: 1751.125, z: 4166.911 }, 0);
  })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type, x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1,
    });
  }
  assert.equal((await evaluate(state)).selected, 'castle-waterdeep');
  // Selection must follow the pointer: a click off the marker keeps the other selection.
  await evaluate("window.__waterdeep.viewer.selectPlace('the-market')");
  const away = await evaluate(`(() => {
    const viewer = window.__waterdeep.viewer;
    const marker = viewer.project({ x: 1751.125, z: 4166.911 }, 0);
    const cast = viewer.project({ x: 1751.125 + 18, z: 4166.911 }, 0);
    const map = document.getElementById('map');
    return { x: Math.round(cast.x), y: Math.round(marker.y), width: map.clientWidth };
  })()`);
  assert.ok(away.x > 0 && away.x < away.width - 1, `away click x ${away.x} off canvas`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type, x: away.x, y: away.y, button: 'left', clickCount: 1,
    });
  }
  assert.equal((await evaluate(state)).selected, 'the-market',
    'a click away from the focused marker must not select it');
  await evaluate('window.__waterdeep.viewer.reset()');
  await settle();
  return true;
}

function touch(x, y, id = 0) {
  return { x, y, id, radiusX: 5, radiusY: 5, force: 1 };
}

async function gesture(send, points) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points[0] });
  for (const touchPoints of points.slice(1)) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints });
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settle();
}

async function loadMobilePage(send, evaluate) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 600, height: 900, deviceScaleFactor: 1, mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  // The meta viewport is evaluated at load, not when desktop emulation is resized in place.
  await evaluate('window.__waterdeep.ready = false');
  await send('Page.reload');
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const probe = await evaluate('window.__waterdeep?.ready ?? false');
    if (!probe) continue;
    const action = await evaluate("getComputedStyle(document.getElementById('map')).touchAction");
    assert.equal(action, 'none');
    assert.equal(await evaluate("document.getElementById('map').clientWidth"), 600);
    return;
  }
  throw new Error('mobile scene did not become ready');
}

export async function checkTouchGestures(send, evaluate) {
  await loadMobilePage(send, evaluate);
  await settle();
  await evaluate(`(() => {
    window.__touchCancels = 0;
    document.getElementById('map').addEventListener('pointercancel', () => window.__touchCancels++);
  })()`);
  const before = await evaluate(state);
  await gesture(send, [[touch(350, 400)], [touch(380, 410)], [touch(420, 430)]]);
  const panned = await evaluate(state);
  assert.ok(Math.hypot(panned.focus.x - before.focus.x, panned.focus.z - before.focus.z) > 20);
  await gesture(send, [
    [touch(350, 400), touch(550, 400, 1)],
    [touch(300, 400), touch(600, 400, 1)],
    [touch(250, 400), touch(650, 400, 1)],
  ]);
  const pinched = await evaluate(state);
  assert.ok(pinched.radius < panned.radius - 20, 'pinch must zoom the map');
  assert.equal(pinched.selected, before.selected, 'gestures must not select a place');
  assert.deepEqual(await evaluate('[window.scrollX, window.scrollY, window.visualViewport.scale]'),
    [0, 0, 1], 'native scrolling and viewport zoom must stay disabled');
  assert.equal(await evaluate('window.__touchCancels'), 0, 'browser cancelled a touch gesture');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  return { pan: true, pinch: true, pointerCancels: 0, mobileViewport: '600x900' };
}
