// Prototype entry point: wire the table state, views, controls and lore search.
import { init } from './controls.js';
import { loreEntries } from './lore-data.js';
import { createSearch } from './search.js';
import { createInitialState } from './table-state.js';
import * as views from './views.js';

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

const state = createInitialState();
const search = createSearch({
  dialog: dom.search,
  input: dom.searchInput,
  status: dom.searchStatus,
  results: dom.searchResults,
  entries: loreEntries,
});

init({ state, dom, views, search });
