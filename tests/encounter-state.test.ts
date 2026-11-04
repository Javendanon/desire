import test from 'node:test';
import assert from 'node:assert/strict';

import type { ActorCondition, EncounterParticipant } from '../src/generated/contracts.ts';
import { DEMO_RULE_ENTRIES } from '../src/features/characters/demo-sheets.ts';
import { createRuleBook } from '../src/features/characters/rule-book.ts';
import { createDemoEncounter } from '../src/features/encounters/demo-encounter.ts';
import {
  assertBundleComplete,
  encounterOutsiders,
  rolledOrder,
  turnOrder,
} from '../src/features/encounters/encounter-model.ts';
import {
  adjustHp,
  applyLocal,
  canAdvance,
  dismissCondition,
  hasLocalChanges,
  localEdits,
  nextTurn,
  startLocalState,
} from '../src/features/encounters/encounter-state.ts';
import { scopeNote } from '../src/features/encounters/interaction-scope.ts';
import { participantViews } from '../src/features/encounters/tactical-view.ts';

const PLACE = 'place-under-test';
const bundle = createDemoEncounter(PLACE);
const rules = createRuleBook(DEMO_RULE_ENTRIES);

function participant(actorId: string, initiative: number | null): EncounterParticipant {
  return { campaign_id: 'c', encounter_id: 'e', actor_id: actorId, initiative };
}

function condition(id: string, remaining: number | null): ActorCondition {
  return {
    id,
    campaign_id: 'c',
    actor_id: 'a',
    knowledge_entry_id: 'k',
    rules_edition: 'dnd_2014',
    remaining_rounds: remaining,
    revision: 1,
  };
}

test('the demo encounter sits on the place it is given and contains no city identity', () => {
  assert.equal(bundle.encounter.place_id, PLACE);
  assert.equal(bundle.provenance.evidence, 'synthetic');
  assert.doesNotMatch(JSON.stringify(bundle), /Waterdeep/i);
  assertBundleComplete(bundle);
});

test('a bundle that misses a participant sheet fails with the actor id', () => {
  const broken = { ...bundle, sheets: [] };
  assert.throws(() => assertBundleComplete(broken), /no sheet for actor/);
});

test('turn order is highest first, stable on ties, unset last, negatives allowed', () => {
  const order = turnOrder([
    participant('unset', null),
    participant('low', -2),
    participant('tie-a', 12),
    participant('tie-b', 12),
    participant('high', 18),
  ]);
  assert.deepEqual(order.map((p) => p.actor_id), ['high', 'tie-a', 'tie-b', 'low', 'unset']);
});

test('only participants with initiative take turns', () => {
  const rolled = rolledOrder([participant('unset', null), participant('low', 1)]);
  assert.deepEqual(rolled.map((p) => p.actor_id), ['low']);
});

test('advancing needs an active encounter with at least one set initiative', () => {
  const { encounter } = bundle;
  assert.equal(canAdvance({ ...encounter, status: 'active' }, 2), true);
  assert.equal(canAdvance({ ...encounter, status: 'active' }, 0), false);
  assert.equal(canAdvance({ ...encounter, status: 'planned' }, 2), false);
  assert.equal(canAdvance({ ...encounter, status: 'completed' }, 2), false);
});

test('the round only advances when the turn wraps, and durations tick once per round', () => {
  const conditions = [condition('timed', 2), condition('open', null)];
  const start = startLocalState({ ...bundle.encounter, round_number: 4 });
  assert.equal(start.round, 4);

  const second = nextTurn(start, { rolledCount: 2, conditions });
  assert.deepEqual([second.round, second.turnIndex], [4, 1]);
  assert.deepEqual(second.conditionRounds, {});

  const wrapped = nextTurn(second, { rolledCount: 2, conditions });
  assert.deepEqual([wrapped.round, wrapped.turnIndex], [5, 0]);
  assert.deepEqual(wrapped.conditionRounds, { timed: 1 });
});

test('an elapsed duration stops at zero and is never removed automatically', () => {
  const conditions = [condition('timed', 1)];
  const context = { rolledCount: 1, conditions };
  const first = nextTurn(startLocalState(bundle.encounter), context);
  const second = nextTurn(first, context);
  assert.deepEqual(second.conditionRounds, { timed: 0 });
  assert.deepEqual(second.dismissedConditions, []);
});

test('next turn without anyone to act changes nothing', () => {
  const start = startLocalState(bundle.encounter);
  assert.equal(nextTurn(start, { rolledCount: 0, conditions: [] }), start);
});

test('HP edits clamp to the sheet maximum and zero, and leave other actors alone', () => {
  const sheet = bundle.sheets.find((entry) => entry.state !== null);
  assert.ok(sheet?.state);
  const state = sheet.state;
  const recordedBefore = structuredClone(state);
  const start = startLocalState(bundle.encounter);
  const up = adjustHp(start, state, state.max_hp + 50);
  assert.equal(up.hp[state.actor_id], state.max_hp);
  const down = adjustHp(up, state, -(state.max_hp + 50));
  assert.equal(down.hp[state.actor_id], 0);
  assert.equal(Object.keys(down.hp).length, 1);
  assert.deepEqual(state, recordedBefore, 'the record stays untouched');
});

test('local changes overlay a sheet without mutating it, and say what they changed', () => {
  const sheet = bundle.sheets.find((entry) => entry.state && entry.conditions.length > 1);
  assert.ok(sheet?.state);
  const [first, second] = sheet.conditions;
  assert.ok(first && second);
  const recordedHp = sheet.state.current_hp;

  const clean = startLocalState(bundle.encounter);
  assert.equal(applyLocal(sheet, clean).state?.current_hp, recordedHp);
  assert.deepEqual(localEdits(sheet, clean), { hp: false, conditions: false });

  const edited = dismissCondition(adjustHp(clean, sheet.state, -1), first.id);
  const overlay = applyLocal(sheet, edited);
  assert.equal(overlay.state?.current_hp, Math.max(0, recordedHp - 1));
  assert.deepEqual(overlay.conditions.map((entry) => entry.id), [second.id]);
  assert.deepEqual(localEdits(sheet, edited), { hp: true, conditions: true });
  assert.equal(sheet.state.current_hp, recordedHp);
  assert.equal(sheet.conditions.length, 2);
});

test('a sheet without state has nothing to overlay', () => {
  const sheet = encounterOutsiders(bundle)[0];
  assert.ok(sheet);
  const overlay = applyLocal(sheet, startLocalState(bundle.encounter));
  assert.equal(overlay.state, null);
});

test('hasLocalChanges notices each local edit and is clear after a restart', () => {
  const start = startLocalState(bundle.encounter);
  assert.equal(hasLocalChanges(start, bundle.encounter), false);
  const advanced = nextTurn(start, { rolledCount: 3, conditions: [] });
  assert.equal(hasLocalChanges(advanced, bundle.encounter), true);
  assert.equal(hasLocalChanges(dismissCondition(start, 'x'), bundle.encounter), true);
  const sheet = bundle.sheets.find((entry) => entry.state);
  assert.ok(sheet?.state);
  assert.equal(hasLocalChanges(adjustHp(start, sheet.state, -1), bundle.encounter), true);
});

test('outsiders are the known sheets that do not take part in the encounter', () => {
  const names = encounterOutsiders(bundle).map((sheet) => sheet.actor.name);
  assert.deepEqual(names, ['Ionyth']);
});

test('participant views carry words for side, turn, HP and conditions, not only colour', () => {
  const state = startLocalState(bundle.encounter);
  const views = participantViews({ bundle, state, rules });
  assert.equal(views.length, bundle.participants.length);
  const current = views.filter((view) => view.currentTurn);
  assert.equal(current.length, 1);
  assert.equal(current[0]?.actorId, turnOrder(bundle.participants)[0]?.actor_id);
  for (const view of views) {
    assert.match(view.dispositionText, /^(Friendly|Neutral|Hostile)$/);
    assert.match(view.hpText, /HP/);
    assert.ok(view.conditionsText.length > 0);
    assert.match(view.initiativeText, /^Initiative /);
  }
});

test('a planned encounter marks no current turn', () => {
  const planned = { ...bundle, encounter: { ...bundle.encounter, status: 'planned' as const } };
  const state = startLocalState(planned.encounter);
  const views = participantViews({ bundle: planned, state, rules });
  assert.equal(views.some((view) => view.currentTurn), false);
});

test('each interaction scope states its reach in its own words', () => {
  const notes = (['session', 'device', 'read-only'] as const).map(scopeNote);
  assert.equal(new Set(notes.map((note) => note.text)).size, notes.length);
  assert.match(scopeNote('session').text, /not saved/i);
  assert.match(scopeNote('session').text, /Nivel20/);
  assert.match(scopeNote('device').text, /this browser/i);
  assert.ok(notes.every((note) => note.label.length > 0));
});
