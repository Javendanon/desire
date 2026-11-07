// Pure rows for a sheet's lists: conditions, concentration, actions, spells, gear and classes.

import type {
  ActionKind,
  ActorResource,
  CharacterEquipment,
  CharacterProficiency,
  CreatureAction,
  ProficiencyCategory,
  ResourceRecovery,
  Training,
} from '../../generated/contracts.ts';
import { describeRule, type RuleBook, type RuleSummary } from './rule-book.ts';
import type { ActorSheet } from './sheet-model.ts';

export interface ConditionRow {
  id: string;
  rule: RuleSummary;
  duration: string;
}

export interface ConcentrationView {
  text: string;
  rule: RuleSummary | null;
}

export interface ActionGroup {
  label: string;
  actions: readonly CreatureAction[];
}

export interface SpellRow {
  id: string;
  rule: RuleSummary;
  preparation: string;
}

export interface ClassRow {
  id: string;
  rule: RuleSummary;
  subclass: RuleSummary | null;
  level: number;
  hitDie: string;
}

const ACTION_GROUPS: readonly { kind: ActionKind, label: string }[] = [
  { kind: 'action', label: 'Actions' },
  { kind: 'bonus_action', label: 'Bonus actions' },
  { kind: 'reaction', label: 'Reactions' },
  { kind: 'passive', label: 'Passive traits' },
];

const RECOVERY_WORDS: Record<ResourceRecovery, string> = {
  manual: 'recovered manually',
  short_rest: 'recovered on a short rest',
  long_rest: 'recovered on a long rest',
};

const CATEGORY_WORDS: Record<ProficiencyCategory, string> = {
  skill: 'Skill',
  saving_throw: 'Saving throw',
  tool: 'Tool',
  weapon: 'Weapon',
  armor: 'Armor',
};

const TRAINING_WORDS: Record<Training, string> = {
  untrained: 'untrained',
  half: 'half proficiency',
  proficient: 'proficient',
  expertise: 'expertise',
};

export function durationText(remainingRounds: number | null): string {
  if (remainingRounds === null) return 'No fixed duration recorded';
  if (remainingRounds === 0) return 'Duration ended, review it';
  if (remainingRounds === 1) return '1 round left';
  return `${remainingRounds} rounds left`;
}

function ruleFor(sheet: ActorSheet, book: RuleBook, id: string): RuleSummary {
  return describeRule(book.lookup(id, sheet.actor.rules_edition));
}

export function conditionRows(sheet: ActorSheet, book: RuleBook): ConditionRow[] {
  return sheet.conditions.map((condition) => ({
    id: condition.id,
    rule: ruleFor(sheet, book, condition.knowledge_entry_id),
    duration: durationText(condition.remaining_rounds),
  }));
}

export function concentrationView(sheet: ActorSheet, book: RuleBook): ConcentrationView {
  if (!sheet.concentration) return { text: 'Not concentrating', rule: null };
  const rule = ruleFor(sheet, book, sheet.concentration.knowledge_entry_id);
  return { text: `Concentrating on ${rule.name}`, rule };
}

/** Groups by contract kind in a fixed reading order. O(kinds · actions), both small. */
export function actionGroups(actions: readonly CreatureAction[]): ActionGroup[] {
  return ACTION_GROUPS.map(({ kind, label }) => ({
    label,
    actions: actions.filter((action) => action.kind === kind),
  })).filter((group) => group.actions.length > 0);
}

/** Preparation is read from the record. This feature never prepares a spell. */
export function spellRows(sheet: ActorSheet, book: RuleBook): SpellRow[] {
  return sheet.spells.map((spell) => ({
    id: spell.knowledge_entry_id,
    rule: ruleFor(sheet, book, spell.knowledge_entry_id),
    preparation: spell.prepared ? 'Prepared' : 'Not prepared',
  }));
}

export function classRows(sheet: ActorSheet, book: RuleBook): ClassRow[] {
  return sheet.classes.map((entry) => ({
    id: entry.class_entry_id,
    rule: ruleFor(sheet, book, entry.class_entry_id),
    subclass: entry.subclass_entry_id ? ruleFor(sheet, book, entry.subclass_entry_id) : null,
    level: entry.level,
    hitDie: `d${entry.hit_die}`,
  }));
}

export function featureRules(sheet: ActorSheet, book: RuleBook): RuleSummary[] {
  return sheet.features.map((feature) => ruleFor(sheet, book, feature.feature_entry_id));
}

/** Explains an empty list: character sheets have no action records in the contract. */
export function emptyActionsText(sheet: ActorSheet): string {
  if (sheet.actor.template_id !== null) return 'No actions recorded on its template.';
  return 'The contract records actions on creature templates, so this sheet lists none.';
}

export function equipmentText(item: CharacterEquipment): string {
  const quantity = item.quantity === 1 ? item.name : `${item.name} × ${item.quantity}`;
  const worn = item.equipped ? 'equipped' : 'carried';
  return `${quantity}, ${worn}${item.attuned ? ', attuned' : ''}`;
}

export function resourceText(resource: ActorResource): string {
  const left = `${resource.remaining} of ${resource.maximum} left`;
  return `${resource.name}: ${left}, ${RECOVERY_WORDS[resource.recovery]}`;
}

export function proficiencyText(entry: CharacterProficiency): string {
  const category = CATEGORY_WORDS[entry.category];
  return `${category}: ${entry.name}, ${TRAINING_WORDS[entry.training]}`;
}
