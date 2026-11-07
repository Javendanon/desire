// Required Chrome gate for the playable Trollskull Manor (D34): the house loads on WebGL 2, floors
// switch, a wall blocks a move while a door lets it through, the slide carries a miniature from
// the turret to the alley, and destroying the viewer stops it and leaves none alive.
// Usage: node tests/browser/interior-smoke.mjs http://127.0.0.1:5199
import assert from 'node:assert/strict';

import { connectChrome, sleep } from './cdp.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5199';
const LOAD_TIMEOUT_MS = 120_000;
const SLIDE_WAIT_MS = 5_000;
const STOP_WAIT_MS = 500;
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false };
const GROUND = 'planta-baja';

// Squares of the Trollskull plan used below (floor-local coordinates).
const PLACE = {
  kitchenEast: { floor: GROUND, x: 5, y: 11 },
  tavernBehindKitchenWall: { floor: GROUND, x: 5, y: 10 },
  kitchenByPantryDoor: { floor: GROUND, x: 6, y: 11 },
  pantry: { floor: GROUND, x: 6, y: 10 },
  slideStart: { floor: 'cuspide-torreta', x: 1, y: 1 },
  slideExit: { floor: GROUND, x: 0, y: 6 },
};

const chrome = await connectChrome('interior-smoke');

/** Runs `body` with `viewer` bound to the page's interior viewer and returns its result. */
function call(body) {
  return chrome.evaluate(`(() => { const viewer = window.__interior; ${body} })()`);
}

function placePiece(id, look, cell) {
  return call(`viewer.setPieces([{ id: ${JSON.stringify(id)}, look: '${look}', side: 'ally',
    cell: ${JSON.stringify(cell)} }]);`);
}

function move(id, cell) {
  return call(`return viewer.movePiece(${JSON.stringify(id)}, ${JSON.stringify(cell)});`);
}

async function loads() {
  await chrome.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
  await chrome.navigate(`${base}/interior.html?backend=webgl2&quality=low`);
  const ready = 'Boolean(window.__interior || window.__interiorError)';
  await chrome.waitFor(ready, 'interior viewer', LOAD_TIMEOUT_MS);
  assert.equal(await chrome.evaluate('window.__interiorError ?? null'), null, 'the house loads');
  assert.equal(await call('return viewer.stats().backend;'), 'webgl2');
}

async function switchesFloors() {
  await call("viewer.setFloor('segundo-piso');");
  assert.equal(await call('return viewer.stats().floor;'), 'segundo-piso');
}

async function wallsBlockAndDoorsOpen() {
  await placePiece('p', 'ranger', PLACE.kitchenEast);
  await call("viewer.setMoveMode('p', 1);");
  assert.ok((await call('return viewer.stats().reachable;')) > 0, 'move mode lights squares');
  assert.equal(await move('p', PLACE.tavernBehindKitchenWall), false, 'the kitchen wall blocks');
  await placePiece('p', 'ranger', PLACE.kitchenByPantryDoor);
  await call("viewer.setMoveMode('p', 1);");
  assert.equal(await move('p', PLACE.pantry), true, 'the pantry door lets it through');
}

async function slidesToTheAlley() {
  await placePiece('c', 'cleric', PLACE.slideStart);
  assert.equal(await move('c', PLACE.slideExit), true);
  await sleep(SLIDE_WAIT_MS);
  assert.deepEqual(await call("return viewer.pieceCell('c');"), PLACE.slideExit);
  assert.equal(await call("return viewer.isMoving('c');"), false, 'the ride ended');
}

async function destroysCleanly() {
  await call('viewer.destroy();');
  const atDestroy = await call('return viewer.stats().frames;');
  await sleep(STOP_WAIT_MS);
  assert.equal(await call('return viewer.stats().frames;'), atDestroy, 'the loop stopped');
  assert.equal(await chrome.evaluate('window.__interiorLive()'), 0, 'no viewer left alive');
}

try {
  await loads();
  await switchesFloors();
  await wallsBlockAndDoorsOpen();
  await slidesToTheAlley();
  await destroysCleanly();
  console.log('interior smoke: ok');
} finally {
  chrome.close();
}
