// Markup builders escape table text and expose the state attributes the CSS reads.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  escapeHtml,
  itemMarkup,
  loreMarkup,
  markerMarkup,
  scenarioChipMarkup,
  searchResultMarkup,
  turnMarkup,
} from './render.js';

const entry = {
  id: 'deep-harbor',
  title: 'Puerto <Profundo>',
  kind: 'place',
  district: 'Puerto',
  summary: 'Muelles & grúas.',
  tags: ['puerto'],
  source: { kind: 'original', label: 'Original', note: 'Map art is original.' },
};

test('escapeHtml neutralises the markup characters', () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.equal(itemMarkup('a & b'), '<li>a &amp; b</li>');
});

test('marker markup escapes the label and keeps its position', () => {
  const marker = { id: 'deep-harbor', label: '1', x: 62, y: 74, title: 'Puerto <x>' };
  const html = markerMarkup(marker, true);
  assert.match(html, /left:62%;top:74%/);
  assert.match(html, /aria-label="Puerto &lt;x&gt;"/);
  assert.match(html, /aria-current="true"/);
});

test('scenario chips signal the active scenario', () => {
  const scenario = { id: 's1', title: 'La grúa', placeId: 'deep-harbor', markerId: 'deep-harbor' };
  assert.match(scenarioChipMarkup(scenario, true), /aria-current="true"/);
  assert.match(scenarioChipMarkup(scenario, false), /aria-current="false"/);
});

test('turn rows flag low health, fallen state and conditions', () => {
  const participant = {
    id: 'a',
    name: 'Sera',
    hp: 0,
    maxHp: 20,
    initiative: 9,
    condition: 'Caída',
  };
  const html = turnMarkup(participant, 'a');
  assert.match(html, /data-fallen="true"/);
  assert.match(html, /data-active="true"/);
  assert.match(html, /hp-bar hp-bar--low/);
  assert.match(html, /Caída/);
});

test('lore and search markup escape text and include the source note', () => {
  const scenario = { id: 's1', title: 'La grúa', placeId: 'deep-harbor', markerId: 'deep-harbor' };
  const lore = loreMarkup(entry, scenario);
  assert.match(lore, /Muelles &amp; grúas\./);
  assert.match(lore, /Map art is original\./);
  assert.match(lore, /data-scenario="s1"/);
  assert.match(searchResultMarkup(entry), /Puerto &lt;Profundo&gt;/);
});
