// An encounter as contract records and its initiative order. No turn state lives here.

import type {
  ActorCondition,
  Encounter,
  EncounterParticipant,
  Id,
  Provenance,
  RulesEdition,
} from '../../generated/contracts.ts';
import type { ActorSheet } from '../characters/sheet-model.ts';

export interface EncounterBundle {
  encounter: Encounter;
  participants: readonly EncounterParticipant[];
  /** Participants' sheets, plus known characters who are not taking part. */
  sheets: readonly ActorSheet[];
  provenance: Provenance;
  /** The campaign's edition: the Encounter contract does not carry its own. */
  rulesEdition: RulesEdition;
}

/** A place picked on the map, reduced to what an encounter needs. No engine types cross here. */
export interface PickedPlace {
  contractId: Id;
  name: string;
}

export type PlaceSubscription = (listener: (place: PickedPlace) => void) => () => void;

function byInitiative(a: EncounterParticipant, b: EncounterParticipant): number {
  if (a.initiative === null) return b.initiative === null ? 0 : 1;
  if (b.initiative === null) return -1;
  return b.initiative - a.initiative;
}

/** Highest first; ties keep their record order and an unset initiative goes last. O(n log n). */
export function turnOrder(participants: readonly EncounterParticipant[]): EncounterParticipant[] {
  return [...participants].sort(byInitiative);
}

/** The participants who can take a turn: this feature never rolls a missing initiative. */
export function rolledOrder(participants: readonly EncounterParticipant[]): EncounterParticipant[] {
  return turnOrder(participants).filter((participant) => participant.initiative !== null);
}

export function indexSheets(sheets: readonly ActorSheet[]): Map<Id, ActorSheet> {
  return new Map(sheets.map((sheet) => [sheet.actor.id, sheet]));
}

/** Fails at the boundary with the missing actor, instead of showing a partial turn order. O(n). */
export function assertBundleComplete(bundle: EncounterBundle): void {
  const sheets = indexSheets(bundle.sheets);
  for (const { actor_id: actorId } of bundle.participants) {
    if (!sheets.has(actorId)) throw new Error(`encounter: no sheet for actor ${actorId}`);
  }
}

export function encounterOutsiders(bundle: EncounterBundle): ActorSheet[] {
  const inside = new Set(bundle.participants.map((participant) => participant.actor_id));
  return bundle.sheets.filter((sheet) => !inside.has(sheet.actor.id));
}

export function participantConditions(bundle: EncounterBundle): ActorCondition[] {
  const inside = new Set(bundle.participants.map((participant) => participant.actor_id));
  return bundle.sheets
    .filter((sheet) => inside.has(sheet.actor.id))
    .flatMap((sheet) => [...sheet.conditions]);
}
