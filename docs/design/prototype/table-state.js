// Table state and the selectors that read it, shared by the views and the controls.
import { encounter, loreEntries, party, scenarios } from './lore-data.js';
import { findById } from './ui-state.js';

/** @returns {object} A fresh controller state for the prototype session. */
export function createInitialState() {
  const participants = resetParticipants();
  return {
    view: 'start',
    scenarioId: scenarios[0].id,
    activeParticipantId: participants[0].id,
    participants,
    log: resetLog(),
    zoom: 1,
    labels: true,
    hex: false,
    panel: null,
    panelReturnFocus: null,
  };
}

/** @param {object} state @returns {object} The active scenario record. */
export function currentScenario(state) {
  return findById(scenarios, state.scenarioId);
}

/** @param {object} scenario @returns {object} The lore entry for the scenario place. */
export function placeOf(scenario) {
  return findById(loreEntries, scenario.placeId);
}

/** @param {object} state @returns {object} The participant whose turn is active. */
export function activeParticipant(state) {
  return findById(state.participants, state.activeParticipantId);
}

// Project live encounter HP without overwriting character names or sheet attributes. O(p + n).
/** @param {object} state @returns {object[]} Party members with current HP. */
export function currentParty(state) {
  const participants = new Map(
    state.participants.map((participant) => [participant.id, participant]),
  );
  return party.map((member) => {
    const live = participants.get(member.id) ?? member;
    return { ...member, hp: live.hp, maxHp: live.maxHp };
  });
}

/** @param {object} state @param {string} id @returns {object} */
export function requireMember(state, id) {
  const member = findById(currentParty(state), id);
  if (!member) throw new Error(`unknown party member: ${id}`);
  return member;
}

/** @param {string} id @returns {object} */
export function requireEntry(id) {
  const entry = findById(loreEntries, id);
  if (!entry) throw new Error(`unknown lore entry: ${id}`);
  return entry;
}

/** @returns {object[]} A fresh initiative order for an encounter reset. */
export function resetParticipants() {
  return encounter.participants.map((participant) => ({ ...participant }));
}

/** @returns {string[]} A fresh scene log for an encounter reset. */
export function resetLog() {
  return [...encounter.log];
}
