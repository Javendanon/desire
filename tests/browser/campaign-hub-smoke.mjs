// Required browser gate for the campaign hub: real Chrome over the dev server, with the API
// stubbed. Covers focus after navigation, parked panels, tab order, the 760px layout, campaign
// isolation, the kind filter and the empty/offline/error copy. Unit-level search, route and
// loader logic stay in tests/*.test.ts.
import assert from 'node:assert/strict';
import { startVite, stopServer, waitForServer } from '../../tools/ci/dev-server.mjs';
import { connectChrome } from './cdp.mjs';
import {
  ALFA,
  API_PORT,
  BETA,
  GAMMA,
  PLACE,
  createStubApi,
  state,
} from './campaign-hub-fixture.mjs';

const PORT = Number(process.env.CAMPAIGN_SMOKE_PORT ?? 5221);
const BASE = process.argv[2] ?? `http://127.0.0.1:${PORT}`;

let send;
let evaluate;
let waitFor;
let click;
let navigate;
let reload;
let tabOrder;
let columns;

const text = () => evaluate('document.body.innerText');
const activeId = () => evaluate('document.activeElement?.id ?? ""');
const hash = () => evaluate('location.hash');

async function openHub() {
  await navigate(`${BASE}/#/campaigns`);
  await waitFor("document.body.innerText.includes('Alfa')", 'campaign list');
}

async function focusAndTabs() {
  await openHub();
  await click('a.campaign');
  await waitFor("document.activeElement?.id === 'content'", 'focus main');
  await waitFor("document.querySelector('h1.name')?.textContent === 'Alfa'", 'campaign A');

  await click('a[href$="/atlas"]');
  await waitFor(`document.getElementById('atlas-place-${PLACE}') !== null`, 'place list');
  assert.equal(await activeId(), 'content', 'atlas opens on the main region');
  await click(`#atlas-place-${PLACE}`);
  await click('.selected a[href*="/lore"]');
  await waitFor("document.querySelector('.lore') !== null", 'lore panel');
  assert.equal(await activeId(), 'content', 'lore opens on the main region');
  await waitFor("document.querySelector('.result') !== null", 'lore result');
  await click('.result');
  await waitFor("document.querySelector('article.detail') !== null", 'entry detail');
  await click('article.detail a.action');
  await waitFor("location.hash.includes('/atlas')", 'back on the map');
  await waitFor(
    "document.querySelector('.places [aria-pressed=\"true\"]') !== null",
    'selected place',
  );
  const target = await evaluate(
    "document.querySelector('.places [aria-pressed=\"true\"]')?.id ?? ''",
  );
  assert.match(target, /^atlas-place-/);
  await waitFor(
    `document.activeElement?.id === ${JSON.stringify(target)}`,
    'focus lands on the place',
  );

  await click('.tab[href*="/summary"]');
  await waitFor("document.querySelector('.summary') !== null", 'summary');
  await waitFor(
    "getComputedStyle(document.querySelector('.atlas.parked')).visibility === 'hidden'",
    'parked panel hidden',
  );
  const parked = await evaluate(`(() => {
    const element = document.getElementById('atlas-place-${PLACE}');
    if (!element) return null;
    return {
      parked: Boolean(element.closest('.parked')),
      inert: Boolean(element.closest('[inert]')),
      visibility: getComputedStyle(element).visibility,
    };
  })()`);
  assert.ok(parked?.parked, 'the atlas is parked outside its panel');
  assert.equal(parked.visibility, 'hidden', 'a parked panel is hidden');
  assert.ok(parked.inert, 'a parked panel is inert and not focusable');

  const order = await tabOrder(14, 'content');
  const intruders = order.filter((entry) => entry.parked);
  assert.deepEqual(intruders, [], 'tab never enters a parked panel');

  await reload();
  await waitFor("document.querySelector('.summary') !== null", 'summary reload');
  const fresh = await tabOrder(16);
  assert.ok(fresh.some((entry) => entry.classes.includes('skip')), 'tab reaches the skip link');
  assert.ok(fresh.some((entry) => entry.classes.includes('tab')), 'tab reaches the tabs');
}

async function kindFollowsTheRoute() {
  await navigate(`${BASE}/#/campaigns/${ALFA}/atlas?place=${PLACE}`);
  await waitFor(`document.getElementById('atlas-place-${PLACE}') !== null`, 'place list');
  await click('.selected a[href*="/lore"]');
  await waitFor("document.querySelector('#lore-kind option[value=\"spell\"]') !== null", 'kinds');
  await evaluate(`(() => {
    const select = document.getElementById('lore-kind');
    select.value = 'spell';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("location.hash.includes('kind=spell')", 'kind in the URL');

  await click('.tab[href*="/atlas"]');
  await waitFor(`document.getElementById('atlas-place-${PLACE}') !== null`, 'place list');
  await click('.selected a[href*="/lore"]');
  await waitFor(
    "document.getElementById('lore-kind')?.value === 'all'",
    'the control follows the cleared kind',
  );

  await navigate(`${BASE}/#/campaigns/${ALFA}/lore?kind=spell&q=bola`);
  await waitFor(
    "document.getElementById('lore-kind')?.value === 'spell'",
    'a restored kind selects its option',
  );
}

async function campaignIsolation() {
  await navigate(`${BASE}/#/campaigns/${ALFA}/atlas?place=${PLACE}`);
  await waitFor(`document.getElementById('atlas-place-${PLACE}') !== null`, 'place list');
  await click('.tab[href*="/lore"]');
  await waitFor("document.querySelector('#lore-query') !== null", 'lore query');
  await evaluate(`(() => {
    const input = document.getElementById('lore-query');
    input.value = 'portal';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor("location.hash.includes('q=portal')", 'query in the URL');

  await click('a[href="#/campaigns"]');
  await waitFor("document.body.innerText.includes('Beta')", 'campaign list');
  await evaluate(`(() => {
    const link = [...document.querySelectorAll('a.campaign')]
      .find((entry) => entry.textContent.includes('Beta'));
    link.click();
  })()`);
  await waitFor("document.querySelector('h1.name')?.textContent === 'Beta'", 'campaign B');
  assert.equal(await hash(), `#/campaigns/${BETA}/summary`, 'campaign B starts clean');
  assert.equal(await evaluate("document.getElementById('lore-query')"), null);
  assert.equal(await evaluate("document.querySelector('[id^=\"atlas-place-\"]')"), null);

  await click('.tab[href*="/atlas"]');
  await waitFor("document.querySelector('[id^=\"atlas-place-\"]') !== null", 'B place list');
  assert.equal(
    await evaluate("document.querySelector('.places [aria-pressed=\"true\"]')"),
    null,
    'no place carried over',
  );
  await click('.tab[href*="/lore"]');
  await waitFor("document.querySelector('#lore-query') !== null", 'B lore');
  assert.equal(await evaluate("document.getElementById('lore-query').value"), '');
  assert.equal(await evaluate("document.getElementById('lore-kind').value"), 'all');
}

async function createCampaign() {
  await navigate(`${BASE}/#/campaigns`);
  await waitFor("document.querySelector('#campaign-name') !== null", 'campaign form');
  await evaluate(`(() => {
    const input = document.getElementById('campaign-name');
    input.value = 'Gamma';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.form.requestSubmit();
  })()`);
  await waitFor("document.querySelector('h1.name')?.textContent === 'Gamma'", 'created campaign');
  assert.equal(await hash(), `#/campaigns/${GAMMA}/summary`, 'creation opens the new campaign');
}

async function degradedStates() {
  state.mode = 'empty';
  await navigate(`${BASE}/#/campaigns`);
  await waitFor("document.body.innerText.includes('Aún no tienes campañas')", 'empty state');
  assert.ok((await text()).includes('Crea la primera con el formulario.'));

  state.mode = 'error';
  await reload();
  await waitFor("document.body.innerText.includes('No se pudieron cargar tus campañas')", 'error');
  assert.ok((await text()).includes('Reintentar'));
  state.mode = 'data';
  await click('.notice button');
  await waitFor("document.body.innerText.includes('Alfa')", 'retry recovers');

  await send('Network.enable');
  await send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  });
  await waitFor(
    "document.body.innerText.includes('Sin conexión. Lo ya cargado sigue disponible.')",
    'offline copy',
  );
  assert.ok((await text()).includes('Alfa'), 'loaded data survives losing the network');
  await send('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });
  await waitFor("document.body.innerText.includes('Servidor conectado')", 'reconnect');
}

async function responsiveLayout() {
  for (const [width, expected] of [[1400, 2], [700, 1]]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await navigate(`${BASE}/#/campaigns`);
    await waitFor("document.querySelector('.hub') !== null", 'hub');
    assert.equal(await columns('.hub'), expected, `${width}px hub`);

    await navigate(`${BASE}/#/campaigns/${ALFA}/atlas`);
    await waitFor("document.querySelector('.atlas > .atlas') !== null", 'atlas');
    assert.equal(await columns('.atlas > .atlas'), expected, `${width}px atlas`);

    await navigate(`${BASE}/#/campaigns/${ALFA}/lore`);
    await waitFor("document.querySelector('.lore') !== null", 'lore');
    assert.equal(await columns('.lore'), expected, `${width}px lore`);

    await navigate(`${BASE}/#/campaigns/${ALFA}/summary`);
    await waitFor("document.querySelector('.summary') !== null", 'summary');
    assert.equal(await columns('.summary'), expected, `${width}px summary`);
  }
}

const api = createStubApi();
let exitCode = 0;
let chrome;
const ownServer = process.argv[2] ? null : startVite(PORT);
try {
  await new Promise((resolve, reject) => {
    api.once('error', reject);
    api.listen(API_PORT, '127.0.0.1', resolve);
  });
  if (ownServer) await waitForServer(ownServer, BASE);
  chrome = await connectChrome('campaign-smoke');
  ({ send, evaluate, waitFor, click, navigate, reload, tabOrder, columns } = chrome);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1400, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });

  await focusAndTabs();
  await kindFollowsTheRoute();
  await campaignIsolation();
  await createCampaign();
  await degradedStates();
  await responsiveLayout();
  console.log(JSON.stringify({ ok: true, focus: true, tabs: true, states: true }));
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ok: false, error: reason }, null, 1));
  exitCode = 1;
} finally {
  chrome?.close();
  if (ownServer) stopServer(ownServer);
  await new Promise((resolve) => api.close(resolve));
}
process.exitCode = exitCode;
