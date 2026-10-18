// Guards the link between each event lore entry and the scenario it belongs to.
import assert from 'node:assert/strict';
import test from 'node:test';

import { loreEntries, scenarios } from './lore-data.js';
import { scenarioForEntry } from './ui-state.js';

test('every event lore entry can jump to its scenario', () => {
  const eventEntries = loreEntries.filter((entry) => entry.kind === 'event');
  assert.ok(eventEntries.length > 0, 'the fixture ships event-driven scenarios');
  for (const entry of eventEntries) {
    const scenario = scenarioForEntry(scenarios, entry.id);
    assert.ok(scenario, `event entry cannot jump to a scenario: ${entry.id}`);
    assert.equal(scenario.title, entry.title, `scenario title matches its event: ${entry.id}`);
  }
});
