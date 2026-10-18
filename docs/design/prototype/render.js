// Pure markup builders. No DOM access, so the controller stays small and testable.
/** @typedef {import('./ui-state.js').LoreEntry} LoreEntry */
/** @typedef {import('./ui-state.js').Participant} Participant */
/** @typedef {import('./ui-state.js').Scenario} Scenario */

/**
 * @typedef {Object} Member
 * @property {string} id
 * @property {string} name
 * @property {string} role
 * @property {number} level
 * @property {number} hp
 * @property {number} maxHp
 * @property {number} armor
 * @property {Record<string, number>} stats
 * @property {string[]} skills
 * @property {string} notes
 */

/**
 * @typedef {Object} Marker
 * @property {string} id
 * @property {string} label
 * @property {number} x
 * @property {number} y
 * @property {string} title
 */

export const KIND_LABELS = {
  place: 'Lugar',
  person: 'Persona',
  faction: 'Facción',
  event: 'Suceso',
};

const LOW_HP_PERCENT = 30;

/** @param {unknown} value @returns {string} */
export function escapeHtml(value) {
  const equalities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return String(value).replace(/[&<>"]/g, (char) => equalities[char]);
}

/** @param {unknown} value @returns {string} */
export function itemMarkup(value) {
  return `<li>${escapeHtml(value)}</li>`;
}

/**
 * @param {Marker} marker
 * @param {boolean} active
 * @returns {string}
 */
export function markerMarkup(marker, active) {
  const style = `left:${marker.x}%;top:${marker.y}%`;
  return `<button type="button" class="marker" style="${style}" data-action="open-lore"
    data-lore="${escapeHtml(marker.id)}" aria-current="${active}"
    aria-label="${escapeHtml(marker.title)}">${escapeHtml(marker.label)}</button>`;
}

/** @param {Scenario} scenario @param {boolean} active @returns {string} */
export function scenarioChipMarkup(scenario, active) {
  return `<li><button type="button" class="scenario-chip" data-action="use-scenario"
    data-scenario="${escapeHtml(scenario.id)}" aria-current="${active}">
      ${escapeHtml(scenario.title)}
    </button>
  </li>`;
}

/** @param {Participant} participant @param {string} activeId @returns {string} */
export function turnMarkup(participant, activeId) {
  const pct = Math.round((participant.hp / participant.maxHp) * 100);
  const low = pct <= LOW_HP_PERCENT ? 'hp-bar--low' : '';
  const condition = participant.condition ? ` · ${escapeHtml(participant.condition)}` : '';
  return `<li><button type="button" class="turn" data-action="select-participant"
    data-participant="${escapeHtml(participant.id)}" data-active="${participant.id === activeId}"
    data-fallen="${participant.hp === 0}">
    <span class="turn__init">${participant.initiative}</span>
    <span class="turn__name">${escapeHtml(participant.name)}</span>
    <span class="hp-bar ${low}"><span style="width:${pct}%"></span></span>
    <span class="turn__meta">${participant.hp}/${participant.maxHp} PV${condition}</span>
  </button></li>`;
}

/** @param {Member} member @returns {string} */
function memberSummary(member) {
  const hp = `${member.hp}/${member.maxHp} PV`;
  return `${escapeHtml(member.role)} · nivel ${member.level} · ${hp} · CA ${member.armor}`;
}

/** @param {Member} member @returns {string} */
export function partyCardMarkup(member) {
  return `<li class="party-card">
    <h2>${escapeHtml(member.name)}</h2>
    <p class="party-card__meta">${memberSummary(member)}</p>
    <p>${escapeHtml(member.notes)}</p>
    <button type="button" class="button" data-action="open-sheet"
      data-member="${escapeHtml(member.id)}">Abrir ficha</button>
  </li>`;
}

/** @param {Member} member @returns {string} */
export function sheetMarkup(member) {
  const stats = Object.entries(member.stats)
    .map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${value}</dd></div>`)
    .join('');
  const skills = member.skills.map(itemMarkup).join('');
  return `
    <p class="party-card__meta">${memberSummary(member)}</p>
    <dl class="stat-grid">${stats}</dl>
    <h3>Pericias</h3>
    <ul class="plain-list">${skills}</ul>
    <h3>Notas</h3>
    <p>${escapeHtml(member.notes)}</p>
    <p class="source-note">Original prototype content for card D03.</p>`;
}

/** @param {LoreEntry} entry @param {Scenario | undefined} scenario @returns {string} */
export function loreMarkup(entry, scenario) {
  const tags = entry.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
  const jump = scenario
    ? `<button type="button" class="button button--primary" data-action="use-scenario"
        data-scenario="${escapeHtml(scenario.id)}">
        Abrir escenario «${escapeHtml(scenario.title)}»</button>`
    : '';
  return `
    <p class="party-card__meta">${KIND_LABELS[entry.kind]} · ${escapeHtml(entry.district)}</p>
    <p>${escapeHtml(entry.summary)}</p>
    <div class="tag-row">${tags}</div>
    ${jump}
    <p class="source-note">${escapeHtml(entry.source.label)}. ${escapeHtml(entry.source.note)}</p>`;
}

/** @param {LoreEntry} entry @returns {string} */
export function searchResultMarkup(entry) {
  return `<li><button type="button" class="result" data-action="open-lore"
    data-lore="${escapeHtml(entry.id)}">
    <span class="result__title">${escapeHtml(entry.title)}</span>
    <span class="result__meta">${KIND_LABELS[entry.kind]} · ${escapeHtml(entry.district)}</span>
    <span class="result__summary">${escapeHtml(entry.summary)}</span>
  </button></li>`;
}

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} template
 * @returns {string}
 */
export function listMarkup(items, template) {
  return items.map(template).join('');
}
