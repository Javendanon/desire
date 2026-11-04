import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { KnowledgeEntry } from '../src/generated/contracts.ts';
import {
  DEMO_RULE_ENTRIES,
  DEMO_SHEETS,
  IONYTH_SHEET,
  demoKnowledgeIds,
} from '../src/features/characters/demo-sheets.ts';
import {
  createRuleBook,
  describeRule,
  entriesFromCompendium,
  type CompendiumFile,
  type RuleEntry,
} from '../src/features/characters/rule-book.ts';
import {
  actionGroups,
  concentrationView,
  conditionRows,
  durationText,
  spellRows,
} from '../src/features/characters/sheet-rows.ts';
import { evidenceBadge, hasSheetData } from '../src/features/characters/sheet-model.ts';
import {
  abilityModifier,
  abilityRows,
  healthView,
  rulesLine,
  totalLevel,
} from '../src/features/characters/sheet-view.ts';

const compendium = JSON.parse(
  readFileSync(new URL('../content/knowledge/compendium.json', import.meta.url), 'utf8'),
) as CompendiumFile;

const PRONE_2014_ENTRY = '895aa639-5a48-58f8-9ab8-9d0e83391086';

const PROVENANCE: KnowledgeEntry['provenance'] = {
  source: 'Test source',
  attribution: 'Test attribution',
  evidence: 'verified',
};

const RULE: RuleEntry = {
  id: 'rule-1',
  revision: 1,
  rules_edition: 'dnd_2014',
  language: 'es',
  title: 'Prone',
  body: 'Body',
  provenance: PROVENANCE,
  kind: 'condition',
  sourceLocator: 'SRD 5.1, Conditions',
  verification: 'pending_review',
};

test('ability modifiers follow the 5e formula, rounding down for odd low scores', () => {
  assert.equal(abilityModifier(10), 0);
  assert.equal(abilityModifier(11), 0);
  assert.equal(abilityModifier(16), 3);
  assert.equal(abilityModifier(9), -1);
  assert.equal(abilityModifier(1), -5);
});

test('ability rows speak the score and the signed modifier', () => {
  const stats = DEMO_SHEETS[0]?.stats;
  assert.ok(stats);
  const rows = abilityRows(stats);
  assert.equal(rows.length, 6);
  assert.equal(rows[0]?.short, 'STR');
  assert.match(rows[0]?.spoken ?? '', /^Strength \d+, modifier [+-]\d+$/);
});

test('total level is the sum of class levels, never a stored value', () => {
  const base = { campaign_id: 'c', actor_id: 'a', rules_edition: 'dnd_2014' as const };
  const classes = [
    { ...base, class_entry_id: 'x', level: 3, subclass_entry_id: null, hit_die: 8 },
    { ...base, class_entry_id: 'y', level: 2, subclass_entry_id: null, hit_die: 6 },
  ];
  assert.equal(totalLevel(classes), 5);
  assert.equal(totalLevel([]), 0);
});

test('health is written in words and never inferred as death from zero HP', () => {
  const state = {
    campaign_id: 'c',
    actor_id: 'a',
    max_hp: 20,
    current_hp: 0,
    temporary_hp: 3,
    status: 'active' as const,
    revision: 1,
  };
  const zero = healthView(state);
  assert.equal(zero.text, '0 of 20 HP');
  assert.equal(zero.status, 'At 0 HP');
  assert.equal(zero.temporary, '3 temporary HP');
  assert.equal(zero.percent, 0);
  assert.equal(healthView({ ...state, status: 'dead' }).status, 'Dead');
  const healthy = healthView({ ...state, current_hp: 10, temporary_hp: 0 });
  assert.equal(healthy.status, 'Active');
  assert.equal(healthy.temporary, null);
  assert.equal(healthy.percent, 50);
});

test('durations say what is known and flag an ended one for review', () => {
  assert.equal(durationText(null), 'No fixed duration recorded');
  assert.equal(durationText(0), 'Duration ended, review it');
  assert.equal(durationText(1), '1 round left');
  assert.equal(durationText(3), '3 rounds left');
});

test('a rule lookup reports its source, or the exact reason it cannot be trusted', () => {
  const book = createRuleBook([RULE]);
  const found = describeRule(book.lookup('rule-1', 'dnd_2014'));
  assert.equal(found.name, 'Prone');
  assert.equal(found.problem, null);
  assert.equal(found.language, 'es');
  assert.match(found.source, /SRD 5\.1, Conditions/);
  assert.match(found.source, /D&D 5e \(2014\)/);
  assert.match(found.source, /Pending review/);

  const missing = describeRule(book.lookup('nope', 'dnd_2014'));
  assert.equal(missing.body, null);
  assert.match(missing.problem ?? '', /nope/);

  const wrong = describeRule(book.lookup('rule-1', 'dnd_2024'));
  assert.equal(wrong.body, null, 'another edition must not pass for this one');
  assert.match(wrong.problem ?? '', /D&D 5e \(2014\).*D&D 5e \(2024\)/);
});

test('the compendium parser keeps sources and refuses anything it cannot vouch for', () => {
  const entries = entriesFromCompendium(compendium);
  assert.equal(entries.length, compendium.knowledge_entries.length);
  const prone = entries.find((entry) => entry.id === PRONE_2014_ENTRY);
  assert.equal(prone?.rules_edition, 'dnd_2014');
  assert.equal(prone?.kind, 'condition');
  assert.ok(prone?.sourceLocator?.includes('SRD 5.1'));

  const orphan: CompendiumFile = { ...compendium, catalog: {} };
  assert.throws(() => entriesFromCompendium(orphan), /no catalog row/);
  const [first] = compendium.knowledge_entries;
  assert.ok(first);
  const badEdition = { ...first, rules_edition: 'dnd_1974' };
  assert.throws(
    () => entriesFromCompendium({ ...compendium, knowledge_entries: [badEdition] }),
    /dnd_1974/,
  );
  const badEvidence = { ...first, provenance: { ...first.provenance, evidence: 'rumour' } };
  assert.throws(
    () => entriesFromCompendium({ ...compendium, knowledge_entries: [badEvidence] }),
    /rumour/,
  );
});

test('every rule the demo sheets reference resolves in their own edition', () => {
  const book = createRuleBook([...entriesFromCompendium(compendium), ...DEMO_RULE_ENTRIES]);
  for (const sheet of DEMO_SHEETS) {
    for (const id of demoKnowledgeIds(sheet)) {
      const lookup = book.lookup(id, sheet.actor.rules_edition);
      assert.equal(lookup.status, 'found', `${sheet.actor.name} → ${id}`);
    }
  }
});

test('demo data declares itself as synthetic, and is labelled without relying on colour', () => {
  for (const sheet of DEMO_SHEETS) {
    assert.equal(sheet.provenance.evidence, 'synthetic', sheet.actor.name);
  }
  for (const entry of DEMO_RULE_ENTRIES) {
    assert.equal(entry.provenance.evidence, 'synthetic', entry.title);
  }
  const badge = evidenceBadge('synthetic');
  assert.equal(badge.label, 'Demo');
  assert.ok(badge.glyph.length > 0);
  assert.notEqual(evidenceBadge('verified').glyph, badge.glyph);
  assert.notEqual(evidenceBadge('interpretation').glyph, badge.glyph);
});

test('the Ionyth record is identity only: no statistic is invented', () => {
  assert.equal(IONYTH_SHEET.actor.name, 'Ionyth');
  assert.equal(IONYTH_SHEET.provenance.evidence, 'verified');
  assert.equal(hasSheetData(IONYTH_SHEET), false);
  const { stats, state, details, concentration } = IONYTH_SHEET;
  assert.deepEqual([stats, state, details, concentration], [null, null, null, null]);
  const lists = [
    IONYTH_SHEET.classes,
    IONYTH_SHEET.features,
    IONYTH_SHEET.proficiencies,
    IONYTH_SHEET.equipment,
    IONYTH_SHEET.spells,
    IONYTH_SHEET.resources,
    IONYTH_SHEET.actions,
    IONYTH_SHEET.conditions,
  ];
  assert.ok(lists.every((list) => list.length === 0));
  assert.match(rulesLine(IONYTH_SHEET), /not confirmed/);
  assert.equal(DEMO_SHEETS.some((sheet) => sheet.actor.name === 'Ionyth'), false);
});

test('a full sheet states its rules edition', () => {
  const [sheet] = DEMO_SHEETS;
  assert.ok(sheet);
  assert.equal(hasSheetData(sheet), true);
  assert.equal(rulesLine(sheet), 'Rules: D&D 5e (2014)');
});

test('concentration, conditions, actions and spells come back readable from one sheet', () => {
  const book = createRuleBook([...entriesFromCompendium(compendium), ...DEMO_RULE_ENTRIES]);
  const concentrating = DEMO_SHEETS.find((sheet) => sheet.concentration !== null);
  assert.ok(concentrating);
  const view = concentrationView(concentrating, book);
  assert.match(view.text, /^Concentrating on /);
  assert.ok(view.rule);
  const idle = DEMO_SHEETS.find((sheet) => sheet.concentration === null && sheet.stats !== null);
  assert.ok(idle);
  assert.deepEqual(concentrationView(idle, book), { text: 'Not concentrating', rule: null });

  const conditioned = DEMO_SHEETS.find((sheet) => sheet.conditions.length > 0);
  assert.ok(conditioned);
  const [row] = conditionRows(conditioned, book);
  assert.ok(row && row.rule.source.length > 0 && row.duration.length > 0);

  const caster = DEMO_SHEETS.find((sheet) => sheet.spells.length > 0);
  assert.ok(caster);
  assert.ok(spellRows(caster, book).every((spell) => /prepared/i.test(spell.preparation)));
});

test('actions are grouped by contract kind in a stable order, skipping empty kinds', () => {
  const action = { id: 'i', template_id: 't', description: 'd' };
  const groups = actionGroups([
    { ...action, id: '1', name: 'Parry', kind: 'reaction' },
    { ...action, id: '2', name: 'Bite', kind: 'action' },
    { ...action, id: '3', name: 'Claw', kind: 'action' },
  ]);
  assert.deepEqual(groups.map((group) => group.label), ['Actions', 'Reactions']);
  assert.deepEqual(groups[0]?.actions.map((entry) => entry.name), ['Bite', 'Claw']);
});
