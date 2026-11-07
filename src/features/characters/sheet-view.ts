// Pure view models for a sheet's numbers. The only rules computed are the ones tested here.

import type {
  AbilityScores,
  ActorState,
  ActorStats,
  ActorStatus,
  CharacterClass,
} from '../../generated/contracts.ts';
import { RULES_EDITION_LABELS } from './rule-book.ts';
import {
  hasSheetData,
  sheetBadge,
  type ActorSheet,
  type EvidenceBadge,
} from './sheet-model.ts';

const MODIFIER_BASELINE = 10;
const FULL_PERCENT = 100;

const ABILITIES: readonly { key: keyof AbilityScores, name: string, short: string }[] = [
  { key: 'strength', name: 'Strength', short: 'STR' },
  { key: 'dexterity', name: 'Dexterity', short: 'DEX' },
  { key: 'constitution', name: 'Constitution', short: 'CON' },
  { key: 'intelligence', name: 'Intelligence', short: 'INT' },
  { key: 'wisdom', name: 'Wisdom', short: 'WIS' },
  { key: 'charisma', name: 'Charisma', short: 'CHA' },
];

const STATUS_WORDS: Record<ActorStatus, string> = {
  active: 'Active',
  dead: 'Dead',
  removed: 'Removed',
};

export interface AbilityRow {
  short: string;
  score: number;
  modifier: string;
  spoken: string;
}

export interface HealthView {
  text: string;
  temporary: string | null;
  status: string;
  percent: number;
}

/** Same in both supported editions: floor((score - 10) / 2). */
export function abilityModifier(score: number): number {
  return Math.floor((score - MODIFIER_BASELINE) / 2);
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

export function abilityRows(stats: ActorStats): AbilityRow[] {
  return ABILITIES.map(({ key, name, short }) => {
    const score = stats.abilities[key];
    const modifier = signed(abilityModifier(score));
    return { short, score, modifier, spoken: `${name} ${score}, modifier ${modifier}` };
  });
}

export function totalLevel(classes: readonly CharacterClass[]): number {
  return classes.reduce((sum, entry) => sum + entry.level, 0);
}

function hpPercent(state: ActorState): number {
  if (state.max_hp <= 0) return 0;
  const ratio = state.current_hp / state.max_hp;
  return Math.round(Math.min(1, Math.max(0, ratio)) * FULL_PERCENT);
}

/** Zero HP is reported as a fact: only the recorded status can say an actor is dead. */
export function healthView(state: ActorState): HealthView {
  const downed = state.status === 'active' && state.current_hp === 0;
  return {
    text: `${state.current_hp} of ${state.max_hp} HP`,
    temporary: state.temporary_hp > 0 ? `${state.temporary_hp} temporary HP` : null,
    status: downed ? 'At 0 HP' : STATUS_WORDS[state.status],
    percent: hpPercent(state),
  };
}

/** A sheet without data must not imply it was built against a confirmed edition. */
export function rulesLine(sheet: ActorSheet): string {
  if (!hasSheetData(sheet)) return 'Rules edition not confirmed for this character';
  return `Rules: ${RULES_EDITION_LABELS[sheet.actor.rules_edition]}`;
}

export interface SheetHeader {
  supplied: boolean;
  editionLine: string;
  badge: EvidenceBadge;
}

/**
 * Header facts, read from the record. The session view drops dismissed conditions, so a sheet whose
 * only data is conditions would look empty after its last one expired.
 */
export function sheetHeader(record: ActorSheet): SheetHeader {
  return {
    supplied: hasSheetData(record),
    editionLine: rulesLine(record),
    badge: sheetBadge(record),
  };
}
