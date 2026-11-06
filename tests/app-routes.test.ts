import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  focusTarget,
  formatRoute,
  HUB_ROUTE,
  openCampaign,
  parseRoute,
  withContext,
  withPanel,
  type Route,
} from '../src/app/routes.ts';
import { mapRouteFor } from '../src/features/knowledge/lore-view.ts';
import type { LoreEntry } from '../src/features/knowledge/lore-index.ts';

const CAMPAIGN_A = '00000000-0000-4000-8000-00000000000a';
const CAMPAIGN_B = '00000000-0000-4000-8000-00000000000b';

function placeEntry(placeId: string | null): LoreEntry {
  return {
    key: `place:${placeId}`,
    kind: 'place',
    title: 'Synthetic',
    body: '',
    attribution: null,
    visibility: null,
    placeId,
    haystack: 'synthetic',
  };
}

test('empty and campaign-list hashes open the hub', () => {
  for (const hash of ['', '#', '#/', '#/campaigns']) {
    assert.deepEqual(parseRoute(hash), HUB_ROUTE, hash);
  }
});

test('unknown addresses are missing rather than a guessed screen', () => {
  const unknown = [
    '#/other',
    '#/campaigns/x/unknown',
    '#/campaigns/x/atlas/y',
    '#/campaigns/%E0%A4',
  ];
  for (const hash of unknown) {
    assert.deepEqual(parseRoute(hash), { view: 'missing' }, hash);
  }
});

test('a campaign route without a panel opens its summary', () => {
  assert.deepEqual(parseRoute(`#/campaigns/${CAMPAIGN_A}`), openCampaign(CAMPAIGN_A));
});

test('routes survive a format and parse round trip, including reserved characters', () => {
  const route = withContext(withPanel(openCampaign(CAMPAIGN_A), 'lore'), {
    place: 'the-market',
    query: 'a&b=c? d/é',
    entry: 'compendium:1',
    kind: 'spell',
  });
  assert.deepEqual(parseRoute(formatRoute(route)), route);
});

test('opening another campaign drops the previous search and map context', () => {
  const first = withContext(withPanel(openCampaign(CAMPAIGN_A), 'lore'), {
    place: 'the-market',
    query: 'secret plan',
    entry: 'campaign:1',
  });
  const hash = formatRoute(first);
  const second = openCampaign(CAMPAIGN_B);

  assert.ok(hash.includes('secret'));
  assert.deepEqual(second.context, { place: null, query: '', entry: null, kind: null });
  assert.ok(!formatRoute(second).includes('secret'));
  assert.ok(!formatRoute(second).includes('the-market'));
});

test('leaving for the map and coming back keeps the query, entry, kind and place', () => {
  const lore = withContext(withPanel(openCampaign(CAMPAIGN_A), 'lore'), {
    place: 'the-market',
    query: 'portal',
    entry: 'compendium:7',
    kind: 'spell',
  });

  const map = mapRouteFor(lore, null);
  const back = withPanel(parseRoute(formatRoute(map)) as typeof map, 'lore');

  assert.equal(map.panel, 'atlas');
  assert.equal(map.context.place, 'the-market');
  assert.deepEqual(back, lore);
});

test('a place entry selects itself on the map; other entries keep the selection', () => {
  const lore = withContext(withPanel(openCampaign(CAMPAIGN_A), 'lore'), { place: 'the-market' });

  assert.equal(mapRouteFor(lore, placeEntry('south-gate')).context.place, 'south-gate');
  assert.equal(mapRouteFor(lore, placeEntry(null)).context.place, 'the-market');
});

test('focus moves to the place when returning to the map, otherwise to the main region', () => {
  const lore = withContext(withPanel(openCampaign(CAMPAIGN_A), 'lore'), { place: 'the-market' });
  const atlas = withPanel(lore, 'atlas');
  const hub: Route = HUB_ROUTE;

  assert.deepEqual(focusTarget(lore, atlas), { kind: 'place', placeId: 'the-market' });
  assert.deepEqual(focusTarget(atlas, lore), { kind: 'main' });
  assert.deepEqual(focusTarget(hub, openCampaign(CAMPAIGN_A)), { kind: 'main' });
});

// A text check, because no test renders components: the workspace loads its campaign only on
// mount, so this key is what stops campaign B from showing campaign A's data.
test('the shell remounts the workspace for each campaign', () => {
  const shell = readFileSync(new URL('../src/App.svelte', import.meta.url), 'utf8');
  assert.match(shell, /\{#key route\.campaignId\}\s*<CampaignWorkspace/);
});

test('editing the context keeps focus where the user is typing', () => {
  const lore = withPanel(openCampaign(CAMPAIGN_A), 'lore');
  assert.equal(focusTarget(lore, withContext(lore, { query: 'p' })), null);
});
