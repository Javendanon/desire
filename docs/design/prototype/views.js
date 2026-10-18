// DOM rendering for the table shell. Every render reads the shared state object.
import { campaign, mapMarkers, scenarios } from './lore-data.js';
import {
  itemMarkup,
  listMarkup,
  loreMarkup,
  markerMarkup,
  partyCardMarkup,
  scenarioChipMarkup,
  sheetMarkup,
  turnMarkup,
} from './render.js';
import { scenarioForEntry } from './ui-state.js';
import {
  currentParty,
  currentScenario,
  placeOf,
  requireEntry,
  requireMember,
} from './table-state.js';

export function renderHud() {
  document.querySelector('#hud-campaign').textContent = campaign.title;
  document.querySelector('#hud-clock').textContent = campaign.clock;
  document.querySelector('#hud-weather').textContent = campaign.weather;
}

export function renderStart(state) {
  const members = currentParty(state).map(
    (member) => `${member.name} · ${member.role} · ${member.hp}/${member.maxHp} PV`,
  );
  document.querySelector('#start-party').innerHTML = listMarkup(members, itemMarkup);
  document.querySelector('#start-notes').innerHTML = listMarkup(campaign.notes, itemMarkup);
}

export function renderMarkers(state, dom) {
  const scenario = currentScenario(state);
  dom.markerLayer.innerHTML = listMarkup(mapMarkers, (marker) =>
    markerMarkup(marker, marker.id === scenario.markerId),
  );
}

export function renderScenarios(state) {
  const scenario = currentScenario(state);
  document.querySelector('#scenario-current').textContent = scenario.title;
  document.querySelector('#atlas-place').textContent = placeOf(scenario).title;
  document.querySelector('#scenario-chips').innerHTML = listMarkup(scenarios, (item) =>
    scenarioChipMarkup(item, item.id === scenario.id),
  );
}

export function renderEncounter(state) {
  const focusedParticipant = document.activeElement?.dataset.participant;
  const scenario = currentScenario(state);
  const place = placeOf(scenario);
  document.querySelector('#encounter-title').textContent = scenario.title;
  document.querySelector('#encounter-place').textContent = `${place.title} · ${scenario.hook}`;
  document.querySelector('#participant-list').innerHTML = listMarkup(
    state.participants,
    (participant) => turnMarkup(participant, state.activeParticipantId),
  );
  document.querySelector('#encounter-log').innerHTML = listMarkup(state.log, itemMarkup);
  if (focusedParticipant) {
    document.querySelector(`[data-participant="${focusedParticipant}"]`)?.focus();
  }
}

export function renderParty(state) {
  document.querySelector('#party-list').innerHTML = listMarkup(
    currentParty(state),
    partyCardMarkup,
  );
}

export function renderPanel(state, dom) {
  if (!state.panel) {
    dom.panel.hidden = true;
    return;
  }
  if (state.panel.kind === 'sheet') {
    const member = requireMember(state, state.panel.id);
    dom.panelTitle.textContent = member.name;
    dom.panelBody.innerHTML = sheetMarkup(member);
  } else {
    const entry = requireEntry(state.panel.id);
    const scenario = scenarioForEntry(scenarios, entry.id);
    dom.panelTitle.textContent = entry.title;
    dom.panelBody.innerHTML = loreMarkup(entry, scenario);
  }
  dom.panel.hidden = false;
}

export function refreshPartyDisplays(state, dom) {
  renderStart(state);
  renderParty(state);
  if (state.panel?.kind === 'sheet') renderPanel(state, dom);
}

export function renderAll(state, dom) {
  renderHud();
  renderStart(state);
  renderMarkers(state, dom);
  renderScenarios(state);
  renderEncounter(state);
  renderParty(state);
}
