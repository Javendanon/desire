// Pure rows for the tactical panel. Side, turn and status are always words, never only colour.

import type {
  Disposition,
  EncounterParticipant,
  EncounterStatus,
  Id,
} from '../../generated/contracts.ts';
import type { RuleBook } from '../characters/rule-book.ts';
import { concentrationView, conditionRows } from '../characters/sheet-rows.ts';
import type { ActorSheet } from '../characters/sheet-model.ts';
import { healthView } from '../characters/sheet-view.ts';
import { indexSheets, rolledOrder, turnOrder, type EncounterBundle } from './encounter-model.ts';
import { applyLocal, localEdits, type LocalEncounterState } from './encounter-state.ts';

export interface ParticipantView {
  actorId: Id;
  name: string;
  initiativeText: string;
  dispositionText: string;
  hpText: string;
  canAdjustHp: boolean;
  conditionsText: string;
  concentrationText: string | null;
  currentTurn: boolean;
  edited: boolean;
  /** Only shown when set: the record is limited to the DM. */
  visibilityText: string | null;
}

export interface TacticalViewInput {
  bundle: EncounterBundle;
  state: LocalEncounterState;
  rules: RuleBook;
}

const DISPOSITION_WORDS: Record<Disposition, string> = {
  friendly: 'Friendly',
  neutral: 'Neutral',
  hostile: 'Hostile',
};

const STATUS_WORDS: Record<EncounterStatus, string> = {
  planned: 'Planned',
  active: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function encounterStatusText(status: EncounterStatus): string {
  return STATUS_WORDS[status];
}

function currentActorId({ bundle, state }: TacticalViewInput): Id | null {
  if (bundle.encounter.status !== 'active') return null;
  return rolledOrder(bundle.participants)[state.turnIndex]?.actor_id ?? null;
}

function conditionsText(sheet: ActorSheet, rules: RuleBook): string {
  const rows = conditionRows(sheet, rules);
  if (rows.length === 0) return 'No conditions';
  return rows.map((row) => `${row.rule.name} (${row.duration})`).join('; ');
}

function concentrationText(sheet: ActorSheet, rules: RuleBook): string | null {
  return sheet.concentration ? concentrationView(sheet, rules).text : null;
}

function toView(
  participant: EncounterParticipant,
  sheet: ActorSheet,
  input: TacticalViewInput,
): Omit<ParticipantView, 'currentTurn'> {
  const local = applyLocal(sheet, input.state);
  const edits = localEdits(sheet, input.state);
  const { initiative } = participant;
  return {
    actorId: sheet.actor.id,
    name: sheet.actor.name,
    initiativeText: initiative === null ? 'Initiative not set' : `Initiative ${initiative}`,
    dispositionText: DISPOSITION_WORDS[sheet.actor.disposition],
    hpText: local.state ? healthView(local.state).text : 'HP not recorded',
    canAdjustHp: local.state !== null,
    conditionsText: conditionsText(local, input.rules),
    concentrationText: concentrationText(local, input.rules),
    edited: edits.hp || edits.conditions,
    visibilityText: sheet.actor.visibility === 'dm' ? 'DM only' : null,
  };
}

/** Rows in turn order. Sheets are indexed once, so this stays O(n log n). */
export function participantViews(input: TacticalViewInput): ParticipantView[] {
  const sheets = indexSheets(input.bundle.sheets);
  const current = currentActorId(input);
  return turnOrder(input.bundle.participants).map((participant) => {
    const sheet = sheets.get(participant.actor_id);
    if (!sheet) throw new Error(`encounter: no sheet for actor ${participant.actor_id}`);
    return { ...toView(participant, sheet, input), currentTurn: participant.actor_id === current };
  });
}
