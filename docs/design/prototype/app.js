// Prototype controller: table state, rendering and keyboard wiring for the mockup.
import { campaign, encounter, loreEntries, mapMarkers, party, scenarios } from './lore-data.js';
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
import { createSearch } from './search.js';
import {
  ZOOM_STEP,
  changeHp,
  clampZoom,
  conditionAfter,
  findById,
  hpLogLine,
  isTypingTarget,
  nextTurn,
  scenarioForEntry,
  shortcutAction,
} from './ui-state.js';

const VIEW_KEYS = { 1: 'start', 2: 'atlas', 3: 'encounter', 4: 'characters' };
const VIEW_PREFIX = 'view-';
const DEFAULT_MEMBER = 'aubrey';
const DAMAGE_STEP = 5;
const HEAL_STEP = 5;
const TOAST_MS = 2400;

const state = {
  view: 'start',
  scenarioId: scenarios[0].id,
  activeParticipantId: encounter.participants[0].id,
  participants: encounter.participants.map((participant) => ({ ...participant })),
  log: [...encounter.log],
  zoom: 1,
  labels: true,
  hex: false,
  panel: null,
  panelReturnFocus: null,
};

const dom = {
  app: document.querySelector('#app'),
  markerLayer: document.querySelector('#marker-layer'),
  mapStage: document.querySelector('#map-stage'),
  panel: document.querySelector('#side-panel'),
  panelTitle: document.querySelector('#side-panel-title'),
  panelBody: document.querySelector('#side-panel-body'),
  search: document.querySelector('#search-dialog'),
  searchInput: document.querySelector('#lore-input'),
  searchStatus: document.querySelector('#search-status'),
  searchResults: document.querySelector('#search-results'),
  help: document.querySelector('#help-dialog'),
  toast: document.querySelector('#toast'),
};

const search = createSearch({
  dialog: dom.search,
  input: dom.searchInput,
  status: dom.searchStatus,
  results: dom.searchResults,
  entries: loreEntries,
});

let toastTimer = 0;

function currentScenario() {
  return findById(scenarios, state.scenarioId);
}

function placeOf(scenario) {
  return findById(loreEntries, scenario.placeId);
}

function activeParticipant() {
  return findById(state.participants, state.activeParticipantId);
}

// Project live encounter HP without overwriting character names or sheet attributes. O(p + n).
function currentParty() {
  const participants = new Map(
    state.participants.map((participant) => [participant.id, participant]),
  );
  return party.map((member) => {
    const live = participants.get(member.id) ?? member;
    return { ...member, hp: live.hp, maxHp: live.maxHp };
  });
}

function requireMember(id) {
  const member = findById(currentParty(), id);
  if (!member) throw new Error(`unknown party member: ${id}`);
  return member;
}

function requireEntry(id) {
  const entry = findById(loreEntries, id);
  if (!entry) throw new Error(`unknown lore entry: ${id}`);
  return entry;
}

function toast(message) {
  dom.toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.textContent = '';
  }, TOAST_MS);
}

function setView(view) {
  state.view = view;
  dom.app.dataset.view = view;
  document.querySelectorAll('.view').forEach((section) => {
    section.hidden = section.id !== `${VIEW_PREFIX}${view}`;
  });
  document.querySelectorAll('.rail__item').forEach((item) => {
    item.setAttribute('aria-current', item.dataset.view === view ? 'page' : 'false');
  });
}

function renderHud() {
  document.querySelector('#hud-campaign').textContent = campaign.title;
  document.querySelector('#hud-clock').textContent = campaign.clock;
  document.querySelector('#hud-weather').textContent = campaign.weather;
}

function renderStart() {
  const members = currentParty().map(
    (member) => `${member.name} · ${member.role} · ${member.hp}/${member.maxHp} PV`,
  );
  document.querySelector('#start-party').innerHTML = listMarkup(members, itemMarkup);
  document.querySelector('#start-notes').innerHTML = listMarkup(campaign.notes, itemMarkup);
}

function renderMarkers() {
  const scenario = currentScenario();
  dom.markerLayer.innerHTML = listMarkup(mapMarkers, (marker) =>
    markerMarkup(marker, marker.id === scenario.markerId),
  );
}

function renderScenarios() {
  const scenario = currentScenario();
  document.querySelector('#scenario-current').textContent = scenario.title;
  document.querySelector('#atlas-place').textContent = placeOf(scenario).title;
  document.querySelector('#scenario-chips').innerHTML = listMarkup(scenarios, (item) =>
    scenarioChipMarkup(item, item.id === scenario.id),
  );
}

function renderEncounter() {
  const focusedParticipant = document.activeElement?.dataset.participant;
  const scenario = currentScenario();
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

function renderParty() {
  document.querySelector('#party-list').innerHTML = listMarkup(currentParty(), partyCardMarkup);
}

function refreshPartyDisplays() {
  renderStart();
  renderParty();
  if (state.panel?.kind === 'sheet') renderPanel();
}

function renderPanel() {
  if (!state.panel) {
    dom.panel.hidden = true;
    return;
  }
  if (state.panel.kind === 'sheet') {
    const member = requireMember(state.panel.id);
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

function openPanel(panel) {
  state.panelReturnFocus = document.activeElement;
  state.panel = panel;
  renderPanel();
  dom.panel.querySelector('[data-action="close-panel"]').focus();
}

function closePanel() {
  state.panel = null;
  renderPanel();
  const opener = state.panelReturnFocus;
  const memberId = opener?.dataset.member;
  const currentOpener = opener?.isConnected
    ? opener
    : document.querySelector(`[data-action="open-sheet"][data-member="${memberId}"]`);
  currentOpener?.focus();
}

function setScenario(id) {
  state.scenarioId = id;
  const scenario = currentScenario();
  state.log.unshift(`Escenario activo: ${scenario.title} (${placeOf(scenario).title}).`);
  renderScenarios();
  renderEncounter();
  renderMarkers();
  toast(`Escenario: ${scenario.title}`);
}

function advanceTurn() {
  state.activeParticipantId = nextTurn(state.participants, state.activeParticipantId);
  renderEncounter();
  toast(`Turno de ${activeParticipant().name}`);
}

function applyHp(delta) {
  const active = activeParticipant();
  const changed = changeHp(active, delta);
  const updated = { ...changed, condition: conditionAfter(active, changed.hp) };
  state.participants = state.participants.map((item) => (item.id === updated.id ? updated : item));
  const line = hpLogLine(updated, delta);
  state.log.unshift(line);
  renderEncounter();
  refreshPartyDisplays();
  toast(line);
}

function resetEncounter() {
  state.participants = encounter.participants.map((participant) => ({ ...participant }));
  state.log = [...encounter.log];
  state.activeParticipantId = state.participants[0].id;
  renderEncounter();
  refreshPartyDisplays();
  toast('Encuentro reiniciado');
}

function setZoom(next) {
  state.zoom = clampZoom(next);
  dom.mapStage.style.transform = state.zoom === 1 ? '' : `scale(${state.zoom})`;
}

function setToggle(action, pressed) {
  document.querySelector(`[data-action="${action}"]`).setAttribute('aria-pressed', String(pressed));
}

const actions = {
  'set-view': (el) => setView(el.dataset.view),
  'open-search': () => search.open(),
  'open-help': () => dom.help.showModal(),
  'open-sheet': (el) => openPanel({ kind: 'sheet', id: el.dataset.member ?? DEFAULT_MEMBER }),
  'show-scenarios': () => setView('encounter'),
  'close-panel': () => closePanel(),
  'retry-search': () => search.setRequestState('idle'),
  'demo-state': (el) => search.setRequestState(el.dataset.demoState),
  'open-lore': (el) => {
    search.close();
    openPanel({ kind: 'lore', id: el.dataset.lore });
  },
  'use-scenario': (el) => {
    search.close();
    setScenario(el.dataset.scenario);
    setView('encounter');
  },
  'select-participant': (el) => {
    state.activeParticipantId = el.dataset.participant;
    renderEncounter();
  },
  'zoom-in': () => setZoom(state.zoom * ZOOM_STEP),
  'zoom-out': () => setZoom(state.zoom / ZOOM_STEP),
  'zoom-reset': () => setZoom(1),
  'toggle-labels': () => {
    state.labels = !state.labels;
    dom.mapStage.classList.toggle('map-stage--labels-off', !state.labels);
    setToggle('toggle-labels', state.labels);
  },
  'toggle-hex': () => {
    state.hex = !state.hex;
    dom.mapStage.classList.toggle('map-stage--hex', state.hex);
    setToggle('toggle-hex', state.hex);
  },
  'next-turn': () => advanceTurn(),
  damage: () => applyHp(-DAMAGE_STEP),
  heal: () => applyHp(HEAL_STEP),
  'reset-encounter': () => resetEncounter(),
};

function handleClick(event) {
  const trigger = event.target.closest('[data-action]');
  if (!trigger) return;
  actions[trigger.dataset.action]?.(trigger);
}

function handleKeydown(event) {
  if (isTypingTarget(event.target)) return;
  const action = shortcutAction(event);
  if (action === 'open-search') {
    event.preventDefault();
    search.open();
    return;
  }
  if (action === 'help') {
    event.preventDefault();
    dom.help.showModal();
    return;
  }
  if (action === 'close' && state.panel && !dom.search.open) {
    closePanel();
    return;
  }
  if (!event.metaKey && !event.ctrlKey && VIEW_KEYS[event.key]) setView(VIEW_KEYS[event.key]);
}

function init() {
  dom.app.addEventListener('click', handleClick);
  document.addEventListener('keydown', handleKeydown);
  renderHud();
  renderStart();
  renderMarkers();
  renderScenarios();
  renderEncounter();
  renderParty();
  setView(state.view);
}

init();
