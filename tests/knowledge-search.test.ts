import test from 'node:test';
import assert from 'node:assert/strict';

import compendiumJson from '../content/knowledge/compendium.json' with { type: 'json' };
import fixturesJson from '../content/knowledge/search-fixtures.json' with { type: 'json' };
import {
  ALL_KINDS,
  buildLoreIndex,
  CAMPAIGN_KIND,
  loreKinds,
  PLACE_KIND,
  searchLore,
} from '../src/features/knowledge/lore-index.ts';
import { collectLore } from '../src/features/knowledge/lore-sources.ts';
import {
  normalizeText,
  searchCompendium,
  type CompendiumDocument,
  type CompendiumFilters,
} from '../src/features/knowledge/search.ts';
import type { CampaignKnowledge } from '../src/generated/contracts.ts';
import type { MapPlace } from '../src/lib/engine/plan/map-definition.ts';

const compendium = compendiumJson as unknown as CompendiumDocument;

const PLACE: MapPlace = {
  id: 'yawning-portal',
  name: 'The Yawning Portal',
  at: { x: 0, z: 0 },
  ward: 'castle-ward',
  contractId: '00000000-0000-4000-8000-000000000101',
  catalogId: 'synthetic:yawning-portal',
  sourceRef: 'Synthetic source',
  provenance: [],
};

const NOTE: CampaignKnowledge = {
  id: '00000000-0000-4000-8000-000000000201',
  campaign_id: '00000000-0000-4000-8000-000000000001',
  title: 'Café rumor',
  body: 'A synthetic rumor heard at the harbor.',
  visibility: 'dm',
  revision: 1,
  provenance: { source: 'Synthetic', attribution: 'Synthetic notes', evidence: 'synthetic' },
};

const SOURCES = {
  places: [PLACE],
  campaignNotes: [NOTE],
  compendium,
  rulesEdition: 'dnd_2014' as const,
};

test('every normative search fixture returns exactly its expected ids', () => {
  assert.ok(fixturesJson.fixtures.length > 0);
  for (const fixture of fixturesJson.fixtures) {
    const filters = fixture.filters as CompendiumFilters;
    const found = searchCompendium(compendium, fixture.query, filters).map((entry) => entry.id);
    assert.deepEqual(new Set(found), new Set(fixture.expected_ids), fixture.name);
  }
});

test('the lore index the panel searches agrees with the fixtures it can express', () => {
  const editions = ['dnd_2014', 'dnd_2024'] as const;
  const indexes = editions.map((rulesEdition) =>
    buildLoreIndex({ places: [], campaignNotes: [], compendium, rulesEdition }),
  );
  const expressible = fixturesJson.fixtures.filter((fixture) =>
    Object.keys(fixture.filters).every((key) => key === 'kind'),
  );

  assert.ok(expressible.length > 0);
  for (const fixture of expressible) {
    const { kind } = fixture.filters as CompendiumFilters;
    const found = indexes.flatMap((index) => searchLore(index, fixture.query, kind));
    const expected = fixture.expected_ids.map((id) => `compendium:${id}`);
    assert.deepEqual(new Set(found.map((entry) => entry.key)), new Set(expected), fixture.name);
  }
});

test('normalization ignores case and accents', () => {
  assert.equal(normalizeText('CAFÉ'), 'cafe');
  assert.equal(normalizeText('Ñ'), 'n');
});

test('the index merges places, notes and only the campaign edition of the compendium', () => {
  const index = buildLoreIndex(SOURCES);
  const expected = compendium.knowledge_entries.filter(
    (entry) => entry.rules_edition === 'dnd_2014',
  );

  assert.equal(index.length, expected.length + 2);
  assert.ok(index.some((entry) => entry.kind === PLACE_KIND));
  assert.ok(index.some((entry) => entry.kind === CAMPAIGN_KIND));
  const leaked = compendium.knowledge_entries.find((entry) => entry.rules_edition === 'dnd_2024');
  assert.ok(leaked);
  assert.ok(!index.some((entry) => entry.key === `compendium:${leaked.id}`));
});

test('a place can be found by name and leads back to its map id', () => {
  const [found] = searchLore(buildLoreIndex(SOURCES), 'yawning');
  assert.equal(found.placeId, PLACE.id);
});

test('a spell is found through the kind filter and carries its attribution', () => {
  const spells = searchLore(buildLoreIndex(SOURCES), '', 'spell');
  assert.ok(spells.length > 0);
  assert.ok(spells.every((entry) => entry.kind === 'spell' && entry.attribution));
});

test('every token must match, in any order, without accents', () => {
  const index = buildLoreIndex(SOURCES);
  assert.equal(searchLore(index, 'harbor CAFE')[0]?.key, `campaign:${NOTE.id}`);
  assert.deepEqual(searchLore(index, 'harbor nothing-matches'), []);
});

test('notes keep the visibility the server returned and add none of their own', () => {
  const [note] = searchLore(buildLoreIndex(SOURCES), 'rumor', CAMPAIGN_KIND);
  assert.equal(note.visibility, 'dm');
  const withoutNotes = buildLoreIndex({ ...SOURCES, campaignNotes: [] });
  assert.deepEqual(searchLore(withoutNotes, 'rumor', CAMPAIGN_KIND), []);
});

test('kinds lists each present kind once and all means no filter', () => {
  const index = buildLoreIndex(SOURCES);
  const kinds = loreKinds(index);
  assert.equal(new Set(kinds).size, kinds.length);
  assert.equal(searchLore(index, '', ALL_KINDS).length, index.length);
});

test('an unavailable API keeps local lore and reports the failure', async () => {
  const failure = new TypeError('network down');
  const lore = await collectLore(
    { cityId: null, rulesEdition: 'dnd_2014' },
    {
      loadPlaces: async () => [PLACE],
      loadCompendium: async () => compendium,
      loadNotes: async () => {
        throw failure;
      },
    },
  );

  assert.equal(lore.notesFailure, failure);
  assert.ok(lore.index.some((entry) => entry.placeId === PLACE.id));
  assert.ok(!lore.index.some((entry) => entry.kind === CAMPAIGN_KIND));
});

test('an aborted notes request stays an abort instead of a partial result', async () => {
  const abort = new DOMException('stopped', 'AbortError');
  await assert.rejects(
    collectLore(
      { cityId: null, rulesEdition: 'dnd_2014' },
      {
        loadPlaces: async () => [],
        loadCompendium: async () => compendium,
        loadNotes: async () => {
          throw abort;
        },
      },
    ),
    (error: unknown) => error === abort,
  );
});
