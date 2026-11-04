// Session-only changes to an encounter, as pure transitions. Records are never mutated or sent.

import type {
  ActorCondition,
  ActorState,
  Encounter,
  Id,
} from '../../generated/contracts.ts';
import type { ActorSheet } from '../characters/sheet-model.ts';

export interface LocalEncounterState {
  round: number;
  turnIndex: number;
  hp: Readonly<Record<Id, number>>;
  conditionRounds: Readonly<Record<Id, number>>;
  dismissedConditions: readonly Id[];
}

export interface TurnContext {
  rolledCount: number;
  conditions: readonly ActorCondition[];
}

export interface SheetEdits {
  hp: boolean;
  conditions: boolean;
}

/** Shown beside the panel: the complete list of what it computes for the table. */
export const AUTOMATED_RULES: readonly string[] = [
  'Ability modifiers: (score − 10) ÷ 2, rounded down.',
  'Turn order: highest initiative first, ties keep their recorded order.',
  'Rounds: the counter rises when the turn order wraps.',
  'Durations: each timed condition loses one round when the round rises, stopping at 0.',
  'HP edits: the value stays between 0 and the recorded maximum.',
];

export const NOT_AUTOMATED: readonly string[] = [
  'Dice rolls and saving throws, including concentration checks.',
  'Damage, temporary HP, death and unconsciousness.',
  'Ending a condition when its duration reaches 0: it is flagged for you to review.',
  'Spell preparation, and any change on Nivel20.',
];

export function startLocalState(encounter: Encounter): LocalEncounterState {
  return {
    round: encounter.round_number,
    turnIndex: 0,
    hp: {},
    conditionRounds: {},
    dismissedConditions: [],
  };
}

export function canAdvance(encounter: Encounter, rolledCount: number): boolean {
  return encounter.status === 'active' && rolledCount > 0;
}

function tickDurations(
  state: LocalEncounterState,
  conditions: readonly ActorCondition[],
): Record<Id, number> {
  const rounds: Record<Id, number> = { ...state.conditionRounds };
  for (const { id, remaining_rounds: recorded } of conditions) {
    if (recorded === null) continue;
    rounds[id] = Math.max(0, (rounds[id] ?? recorded) - 1);
  }
  return rounds;
}

/** Moves to the next turn. Durations tick once, when the order wraps. O(conditions). */
export function nextTurn(
  state: LocalEncounterState,
  { rolledCount, conditions }: TurnContext,
): LocalEncounterState {
  if (rolledCount <= 0) return state;
  const turnIndex = state.turnIndex + 1;
  if (turnIndex < rolledCount) return { ...state, turnIndex };
  return {
    ...state,
    turnIndex: 0,
    round: state.round + 1,
    conditionRounds: tickDurations(state, conditions),
  };
}

export function adjustHp(
  state: LocalEncounterState,
  recorded: ActorState,
  delta: number,
): LocalEncounterState {
  const current = state.hp[recorded.actor_id] ?? recorded.current_hp;
  const next = Math.min(recorded.max_hp, Math.max(0, current + delta));
  return { ...state, hp: { ...state.hp, [recorded.actor_id]: next } };
}

export function dismissCondition(state: LocalEncounterState, id: Id): LocalEncounterState {
  return { ...state, dismissedConditions: [...state.dismissedConditions, id] };
}

/** The sheet as this session sees it; the recorded sheet stays intact. O(conditions). */
export function applyLocal(sheet: ActorSheet, state: LocalEncounterState): ActorSheet {
  const localHp = state.hp[sheet.actor.id];
  const recorded = sheet.state;
  const dismissed = new Set(state.dismissedConditions);
  const conditions = sheet.conditions
    .filter((condition) => !dismissed.has(condition.id))
    .map((condition) => ({
      ...condition,
      remaining_rounds: state.conditionRounds[condition.id] ?? condition.remaining_rounds,
    }));
  if (!recorded || localHp === undefined) return { ...sheet, conditions };
  return { ...sheet, state: { ...recorded, current_hp: localHp }, conditions };
}

/** Which parts of this sheet differ from its record because of a session change. O(conditions). */
export function localEdits(sheet: ActorSheet, state: LocalEncounterState): SheetEdits {
  const recordedHp = sheet.state?.current_hp;
  const localHp = state.hp[sheet.actor.id];
  const dismissed = new Set(state.dismissedConditions);
  return {
    hp: localHp !== undefined && localHp !== recordedHp,
    conditions: sheet.conditions.some(
      ({ id, remaining_rounds: recorded }) =>
        dismissed.has(id) || (state.conditionRounds[id] ?? recorded) !== recorded,
    ),
  };
}

export function hasLocalChanges(state: LocalEncounterState, encounter: Encounter): boolean {
  return (
    state.round !== encounter.round_number ||
    state.turnIndex !== 0 ||
    Object.keys(state.hp).length > 0 ||
    Object.keys(state.conditionRounds).length > 0 ||
    state.dismissedConditions.length > 0
  );
}
