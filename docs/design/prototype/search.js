// Lore search dialog: debounce, empty, loading and error states, keyboard movement.
import { searchResultMarkup } from './render.js';
import { resolveSearchView } from './ui-state.js';

const DEBOUNCE_MS = 250;
const SKELETON_ROWS = 3;
const ERROR_MESSAGE = 'La búsqueda no respondió. Revisá la conexión y probá otra vez.';
const EMPTY_HINT = 'Probá con «puerto», «guardia» o «pozo», o abrí un marcador del atlas.';

function skeletonMarkup() {
  return Array.from({ length: SKELETON_ROWS }, () => '<li class="skeleton"></li>').join('');
}

function paintSearch(elements, view, query) {
  const { status, results } = elements;
  if (view.kind === 'loading') {
    status.textContent = 'Buscando en el lore…';
    results.innerHTML = skeletonMarkup();
    return;
  }
  if (view.kind === 'error') {
    status.textContent = 'No se pudo consultar el lore.';
    results.innerHTML = `<li><p class="state-note state-note--error">${ERROR_MESSAGE}
      <button type="button" class="button" data-action="retry-search">Reintentar</button>
      </p></li>`;
    return;
  }
  if (view.kind === 'empty') {
    status.textContent = `Sin resultados para «${query}».`;
    results.innerHTML = `<li><p class="state-note">${EMPTY_HINT}</p></li>`;
    return;
  }
  status.textContent = `${view.items.length} resultado(s) en el lore.`;
  results.innerHTML = view.items.map(searchResultMarkup).join('');
}

function renderSearch(context) {
  const { status, results, entries } = context.options;
  const query = context.query;
  const searchView = resolveSearchView({ entries, query, requestState: context.requestState });
  paintSearch({ status, results }, searchView, query);
}

function scheduleSearch(context) {
  context.query = context.options.input.value;
  context.requestState = 'loading';
  renderSearch(context);
  clearTimeout(context.timer);
  context.timer = setTimeout(() => {
    context.requestState = 'idle';
    renderSearch(context);
  }, DEBOUNCE_MS);
}

// Enter before the debounce resolves the query at once, then activates the first match.
function activateFirstResult(context) {
  if (context.requestState === 'loading') {
    clearTimeout(context.timer);
    context.requestState = 'idle';
    renderSearch(context);
  }
  context.options.results.querySelector('.result')?.click();
}

function openSearch(context) {
  context.query = '';
  context.requestState = 'idle';
  context.options.input.value = '';
  renderSearch(context);
  if (!context.options.dialog.open) context.options.dialog.showModal();
  context.options.input.focus();
}

function moveResultFocus(results, event) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const buttons = [...results.querySelectorAll('.result')];
  if (buttons.length === 0) return;
  event.preventDefault();
  const step = event.key === 'ArrowDown' ? 1 : -1;
  const index = buttons.indexOf(document.activeElement);
  const next = Math.min(buttons.length - 1, Math.max(0, index + step));
  buttons[next].focus();
}

function bindSearch(options, handlers) {
  const { dialog, input, results } = options;
  const form = dialog.querySelector('form');
  const onKeydown = (event) => moveResultFocus(results, event);
  input.addEventListener('input', handlers.schedule);
  input.addEventListener('keydown', onKeydown);
  results.addEventListener('keydown', onKeydown);
  form?.addEventListener('submit', handlers.onSubmit);
  dialog.addEventListener('close', handlers.onClose);
}

export function createSearch(options) {
  const context = { options, query: '', requestState: 'idle', timer: 0 };
  bindSearch(options, {
    schedule: () => scheduleSearch(context),
    // Enter in the query field activates the first result instead of dismissing the dialog.
    onSubmit: (event) => {
      event.preventDefault();
      activateFirstResult(context);
    },
    onClose: () => {
      clearTimeout(context.timer);
      context.requestState = 'idle';
    },
  });
  return {
    open: () => openSearch(context),
    close: () => {
      if (options.dialog.open) options.dialog.close();
    },
    setRequestState: (next) => {
      clearTimeout(context.timer);
      context.requestState = next;
      renderSearch(context);
    },
  };
}
