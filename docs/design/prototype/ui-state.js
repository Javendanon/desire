// Pure table state shared by the prototype UI and its behaviour checks.

export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 2.4;
export const ZOOM_STEP = 1.2;

const SEARCHABLE_FIELDS = ['title', 'summary', 'district'];
const SEARCH_STATES = ['idle', 'loading', 'error'];
const FALLEN_CONDITION = 'Caída';

/**
 * @typedef {Object} LoreEntry
 * @property {string} id
 * @property {string} title
 * @property {string} kind
 * @property {string} district
 * @property {string} summary
 * @property {string[]} tags
 * @property {{ kind: string, label: string, note: string }} source
 */

/**
 * @typedef {Object} Participant
 * @property {string} id
 * @property {string} name
 * @property {number} hp
 * @property {number} maxHp
 * @property {string} condition
 */

/**
 * @typedef {Object} Scenario
 * @property {string} id
 * @property {string} title
 * @property {string} placeId
 * @property {string} markerId
 * @property {string} hook
 */

/** @param {unknown} value @returns {string} */
export function foldText(value) {
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** @param {LoreEntry} entry @returns {string} */
function entryHaystack(entry) {
  const fields = SEARCHABLE_FIELDS.map((field) => entry[field] ?? '');
  return foldText([...fields, ...(entry.tags ?? []), ...(entry.aliases ?? [])].join(' '));
}

/**
 * Accent and case insensitive token search.
 * @param {LoreEntry[]} entries
 * @param {string} query
 * @returns {LoreEntry[]}
 */
export function searchLore(entries, query) {
  const tokens = foldText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return entries;
  return entries.filter((entry) => {
    const haystack = entryHaystack(entry);
    return tokens.every((token) => haystack.includes(token));
  });
}

/**
 * @param {{ entries: LoreEntry[], query: string, requestState: string }} input
 * @returns {{ kind: string, items: LoreEntry[] }}
 */
export function resolveSearchView({ entries, query, requestState }) {
  if (!SEARCH_STATES.includes(requestState)) {
    throw new Error(`unknown search state: ${requestState}`);
  }
  if (requestState === 'loading') return { kind: 'loading', items: [] };
  if (requestState === 'error') return { kind: 'error', items: [] };
  const items = searchLore(entries, query);
  return { kind: items.length > 0 ? 'results' : 'empty', items };
}

/** @param {Array<{ id: string }>} items @param {string} id */
export function findById(items, id) {
  return items.find((item) => item.id === id);
}

/**
 * Prefer the scenario's own lore entry, then related places or markers.
 * @param {Scenario[]} scenarios
 * @param {string} entryId
 * @returns {Scenario | undefined}
 */
export function scenarioForEntry(scenarios, entryId) {
  return findById(scenarios, entryId) ?? scenarios.find(
    (scenario) => scenario.placeId === entryId || scenario.markerId === entryId,
  );
}

/**
 * Next standing participant after the active one, in initiative order.
 * @param {Participant[]} participants
 * @param {string} activeId
 * @returns {string}
 */
export function nextTurn(participants, activeId) {
  const index = participants.findIndex((participant) => participant.id === activeId);
  const start = index === -1 ? participants.length - 1 : index;
  for (let step = 1; step <= participants.length; step += 1) {
    const candidate = participants[(start + step) % participants.length];
    if (candidate.hp > 0) return candidate.id;
  }
  return activeId;
}

/**
 * @param {Participant} participant
 * @param {number} delta
 * @returns {Participant}
 */
export function changeHp(participant, delta) {
  const hp = Math.min(participant.maxHp, Math.max(0, participant.hp + delta));
  return { ...participant, hp };
}

/**
 * @param {Participant} participant
 * @param {number} nextHp
 * @returns {string}
 */
export function conditionAfter(participant, nextHp) {
  if (nextHp === 0) return FALLEN_CONDITION;
  return participant.hp === 0 ? '' : participant.condition;
}

/**
 * @param {Participant} participant
 * @param {number} delta
 * @returns {string}
 */
export function hpLogLine(participant, delta) {
  const verb = delta < 0 ? `recibe ${Math.abs(delta)} de daño` : `recupera ${delta} PV`;
  return `${participant.name} ${verb} (${participant.hp}/${participant.maxHp} PV).`;
}

/** @param {number} value @returns {number} */
export function clampZoom(value) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** @param {EventTarget | null} target @returns {boolean} */
export function isTypingTarget(target) {
  const element = /** @type {HTMLElement | null} */ (target);
  const tag = element?.tagName;
  const editable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  return editable || Boolean(element?.isContentEditable);
}

/**
 * @param {{ key: string, metaKey?: boolean, ctrlKey?: boolean, target: EventTarget | null }} event
 * @returns {string | null}
 */
export function shortcutAction(event) {
  if (isTypingTarget(event.target)) return null;
  if (event.key === 'Escape') return 'close';
  if (event.key === '/' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) {
    return 'open-search';
  }
  if (event.key === '?') return 'help';
  return null;
}
