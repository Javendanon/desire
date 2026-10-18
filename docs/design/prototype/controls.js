// Table controls: view routing, map controls, combat actions and panel focus.
import {
  ZOOM_STEP,
  changeHp,
  clampZoom,
  conditionAfter,
  hpLogLine,
  isTypingTarget,
  nextTurn,
  shortcutAction,
} from './ui-state.js';
import {
  activeParticipant,
  currentScenario,
  placeOf,
  resetLog,
  resetParticipants,
} from './table-state.js';

const VIEW_KEYS = { 1: 'start', 2: 'atlas', 3: 'encounter', 4: 'characters' };
const VIEW_PREFIX = 'view-';
const DEFAULT_MEMBER = 'aubrey';
const DAMAGE_STEP = 5;
const HEAL_STEP = 5;
const TOAST_MS = 2400;

let toastTimer = 0;

function toast(dom, message) {
  dom.toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.textContent = '';
  }, TOAST_MS);
}

function setView(context, view) {
  const { state, dom } = context;
  state.view = view;
  dom.app.dataset.view = view;
  document.querySelectorAll('.view').forEach((section) => {
    section.hidden = section.id !== `${VIEW_PREFIX}${view}`;
  });
  document.querySelectorAll('.rail__item').forEach((item) => {
    item.setAttribute('aria-current', item.dataset.view === view ? 'page' : 'false');
  });
}

function openPanel(context, panel) {
  const { state, dom, views } = context;
  state.panelReturnFocus = document.activeElement;
  state.panel = panel;
  views.renderPanel(state, dom);
  dom.panel.querySelector('[data-action="close-panel"]').focus();
}

function closePanel(context) {
  const { state, dom, views } = context;
  state.panel = null;
  views.renderPanel(state, dom);
  const opener = state.panelReturnFocus;
  const memberId = opener?.dataset.member;
  const currentOpener = opener?.isConnected
    ? opener
    : document.querySelector(`[data-action="open-sheet"][data-member="${memberId}"]`);
  currentOpener?.focus();
}

function setScenario(context, id) {
  const { state, dom, views } = context;
  state.scenarioId = id;
  const scenario = currentScenario(state);
  state.log.unshift(`Escenario activo: ${scenario.title} (${placeOf(scenario).title}).`);
  views.renderScenarios(state);
  views.renderEncounter(state);
  views.renderMarkers(state, dom);
  toast(dom, `Escenario: ${scenario.title}`);
}

function advanceTurn(context) {
  const { state, dom, views } = context;
  state.activeParticipantId = nextTurn(state.participants, state.activeParticipantId);
  views.renderEncounter(state);
  toast(dom, `Turno de ${activeParticipant(state).name}`);
}

function applyHp(context, delta) {
  const { state, dom, views } = context;
  const active = activeParticipant(state);
  const changed = changeHp(active, delta);
  const updated = { ...changed, condition: conditionAfter(active, changed.hp) };
  state.participants = state.participants.map((item) => (item.id === updated.id ? updated : item));
  const line = hpLogLine(updated, delta);
  state.log.unshift(line);
  views.renderEncounter(state);
  views.refreshPartyDisplays(state, dom);
  toast(dom, line);
}

function resetEncounter(context) {
  const { state, dom, views } = context;
  state.participants = resetParticipants();
  state.log = resetLog();
  state.activeParticipantId = state.participants[0].id;
  views.renderEncounter(state);
  views.refreshPartyDisplays(state, dom);
  toast(dom, 'Encuentro reiniciado');
}

function setZoom(context, next) {
  const { state, dom } = context;
  state.zoom = clampZoom(next);
  dom.mapStage.style.transform = state.zoom === 1 ? '' : `scale(${state.zoom})`;
}

function setToggle(action, pressed) {
  document.querySelector(`[data-action="${action}"]`).setAttribute('aria-pressed', String(pressed));
}

const ACTIONS = {
  'set-view': (context, el) => setView(context, el.dataset.view),
  'open-search': (context) => context.search.open(),
  'close-search': (context) => context.search.close(),
  'open-help': (context) => context.dom.help.showModal(),
  'open-sheet': (context, el) => openPanel(context, {
    kind: 'sheet',
    id: el.dataset.member ?? DEFAULT_MEMBER,
  }),
  'show-scenarios': (context) => setView(context, 'encounter'),
  'close-panel': (context) => closePanel(context),
  'retry-search': (context) => context.search.setRequestState('idle'),
  'demo-state': (context, el) => context.search.setRequestState(el.dataset.demoState),
  'open-lore': (context, el) => {
    context.search.close();
    openPanel(context, { kind: 'lore', id: el.dataset.lore });
  },
  'use-scenario': (context, el) => {
    context.search.close();
    setScenario(context, el.dataset.scenario);
    setView(context, 'encounter');
  },
  'select-participant': (context, el) => {
    context.state.activeParticipantId = el.dataset.participant;
    context.views.renderEncounter(context.state);
  },
  'zoom-in': (context) => setZoom(context, context.state.zoom * ZOOM_STEP),
  'zoom-out': (context) => setZoom(context, context.state.zoom / ZOOM_STEP),
  'zoom-reset': (context) => setZoom(context, 1),
  'toggle-labels': (context) => {
    context.state.labels = !context.state.labels;
    context.dom.mapStage.classList.toggle('map-stage--labels-off', !context.state.labels);
    setToggle('toggle-labels', context.state.labels);
  },
  'toggle-hex': (context) => {
    context.state.hex = !context.state.hex;
    context.dom.mapStage.classList.toggle('map-stage--hex', context.state.hex);
    setToggle('toggle-hex', context.state.hex);
  },
  'next-turn': (context) => advanceTurn(context),
  damage: (context) => applyHp(context, -DAMAGE_STEP),
  heal: (context) => applyHp(context, HEAL_STEP),
  'reset-encounter': (context) => resetEncounter(context),
};

function handleClick(context, event) {
  const trigger = event.target.closest('[data-action]');
  if (!trigger) return;
  ACTIONS[trigger.dataset.action]?.(context, trigger);
}

function handleKeydown(context, event) {
  if (isTypingTarget(event.target)) return;
  const action = shortcutAction(event);
  if (action === 'open-search') {
    event.preventDefault();
    context.search.open();
    return;
  }
  if (action === 'help') {
    event.preventDefault();
    context.dom.help.showModal();
    return;
  }
  if (action === 'close' && context.state.panel && !context.dom.search.open) {
    closePanel(context);
    return;
  }
  if (!event.metaKey && !event.ctrlKey && VIEW_KEYS[event.key]) {
    setView(context, VIEW_KEYS[event.key]);
  }
}

export function init(context) {
  const { dom } = context;
  dom.app.addEventListener('click', (event) => handleClick(context, event));
  document.addEventListener('keydown', (event) => handleKeydown(context, event));
  context.views.renderAll(context.state, dom);
  setView(context, context.state.view);
}
