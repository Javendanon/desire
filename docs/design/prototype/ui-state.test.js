// Behaviour checks for the pure table state used by the visual prototype.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  changeHp,
  clampZoom,
  conditionAfter,
  findById,
  hpLogLine,
  isTypingTarget,
  nextTurn,
  resolveSearchView,
  scenarioForEntry,
  searchLore,
  shortcutAction,
} from './ui-state.js';

const entries = [
  {
    id: 'deep-harbor',
    title: 'Puerto Profundo',
    kind: 'place',
    district: 'Puerto',
    summary: 'Muelles, grúas y almacenes donde llega casi todo el grano del norte.',
    tags: ['puerto', 'comercio', 'muelle'],
  },
  {
    id: 'bostezante',
    title: 'Portal Bostezante',
    kind: 'place',
    district: 'Castillo',
    summary: 'Posada de aventureros con un pozo que baja a las alcantarillas.',
    tags: ['posada', 'aventura', 'pozo'],
  },
  {
    id: 'aubrey',
    title: 'Aubrey Valcourt',
    kind: 'person',
    district: 'Castillo',
    summary: 'Exploradora de la Guardia Gris que conoce los túneles del puerto.',
    tags: ['guardia', 'exploradora', 'aliada'],
  },
];

test('search ignores case and accents', () => {
  assert.deepEqual(
    searchLore(entries, 'PORTAL').map((entry) => entry.id),
    ['bostezante'],
  );
  assert.deepEqual(
    searchLore(entries, 'posada').map((entry) => entry.id),
    ['bostezante'],
  );
  assert.deepEqual(
    searchLore(entries, 'grúas').map((entry) => entry.id),
    ['deep-harbor'],
  );
});

test('search requires every token and returns an empty list when nothing matches', () => {
  assert.deepEqual(
    searchLore(entries, 'puerto grano').map((entry) => entry.id),
    ['deep-harbor'],
  );
  assert.deepEqual(searchLore(entries, 'dragón inexistente'), []);
  assert.deepEqual(searchLore(entries, '   '), entries);
});

test('search view reports loading, error, empty and results states', () => {
  const base = { entries, query: 'grano' };
  assert.equal(resolveSearchView({ ...base, requestState: 'loading' }).kind, 'loading');
  assert.equal(resolveSearchView({ ...base, requestState: 'error' }).kind, 'error');
  assert.equal(resolveSearchView({ ...base, query: 'nada', requestState: 'idle' }).kind, 'empty');
  const results = resolveSearchView({ ...base, requestState: 'idle' });
  assert.equal(results.kind, 'results');
  assert.equal(results.items.length, 1);
  assert.throws(
    () => resolveSearchView({ ...base, requestState: 'bogus' }),
    /unknown search state: bogus/,
  );
});

test('lookup helpers find entries and their scenario', () => {
  assert.equal(findById(entries, 'aubrey')?.title, 'Aubrey Valcourt');
  assert.equal(findById(entries, 'missing'), undefined);
  const scenarios = [{ id: 's1', title: 'Uno', placeId: 'aubrey', markerId: 'aubrey' }];
  assert.equal(scenarioForEntry(scenarios, 'aubrey')?.id, 's1');
  assert.equal(scenarioForEntry(scenarios, 'bostezante'), undefined);
});

test('scenario lore resolves by its own id before a shared place match', () => {
  const scenarios = [
    { id: 'other-scene', placeId: 'well-whispers', markerId: 'shared-marker' },
    { id: 'well-whispers', placeId: 'shared-place', markerId: 'shared-marker' },
  ];
  assert.equal(scenarioForEntry(scenarios, 'well-whispers'), scenarios[1]);
  assert.equal(scenarioForEntry(scenarios, 'shared-place'), scenarios[1]);
  assert.equal(scenarioForEntry(scenarios, 'shared-marker'), scenarios[0]);
  assert.equal(scenarioForEntry(scenarios, 'missing'), undefined);
});

test('initiative advances, wraps and skips fallen participants', () => {
  const party = [
    { id: 'a', hp: 8 },
    { id: 'b', hp: 0 },
    { id: 'c', hp: 5 },
  ];
  assert.equal(nextTurn(party, 'a'), 'c');
  assert.equal(nextTurn(party, 'c'), 'a');
  assert.equal(nextTurn(party, 'b'), 'c', 'a fallen active participant still advances forward');
  assert.equal(nextTurn([{ id: 'a', hp: 0 }], 'a'), 'a');
});

test('hp changes clamp between zero and the maximum', () => {
  const target = { id: 'a', hp: 4, maxHp: 9 };
  assert.equal(changeHp(target, -10).hp, 0);
  assert.equal(changeHp(target, 2).hp, 6);
  assert.equal(changeHp(target, 99).hp, 9);
  assert.equal(target.hp, 4, 'the original participant must not mutate');
});

test('conditions follow the hit point outcome', () => {
  const standing = { id: 'a', hp: 9, condition: 'Concentrada' };
  const fallen = { id: 'b', hp: 0, condition: 'Caída' };
  assert.equal(conditionAfter(standing, 0), 'Caída');
  assert.equal(conditionAfter(standing, 5), 'Concentrada');
  assert.equal(conditionAfter(fallen, 4), '');
});

test('hp log lines name the action and the new total', () => {
  const damage = { name: 'Sera', hp: 14, maxHp: 24 };
  const heal = { name: 'Sera', hp: 19, maxHp: 24 };
  assert.equal(hpLogLine(damage, -5), 'Sera recibe 5 de daño (14/24 PV).');
  assert.equal(hpLogLine(heal, 5), 'Sera recupera 5 PV (19/24 PV).');
});

test('zoom clamps to the supported range', () => {
  assert.equal(clampZoom(0.1), 0.7);
  assert.equal(clampZoom(9), 2.4);
  assert.equal(clampZoom(1.45), 1.45);
});

test('shortcuts stay quiet while typing and map the palette keys', () => {
  const typing = { key: 'k', metaKey: true, target: { tagName: 'INPUT' } };
  assert.equal(shortcutAction(typing), null);
  assert.equal(isTypingTarget({ tagName: 'INPUT' }), true);
  assert.equal(isTypingTarget({ tagName: 'BODY' }), false);
  const keyK = { key: 'k', metaKey: true, target: { tagName: 'BODY' } };
  assert.equal(shortcutAction(keyK), 'open-search');
  assert.equal(shortcutAction({ key: '/', target: { tagName: 'BODY' } }), 'open-search');
  assert.equal(shortcutAction({ key: 'Escape', target: { tagName: 'BODY' } }), 'close');
  assert.equal(shortcutAction({ key: '?', target: { tagName: 'BODY' } }), 'help');
  assert.equal(shortcutAction({ key: 'x', target: { tagName: 'BODY' } }), null);
});
