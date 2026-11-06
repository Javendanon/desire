// Demo page: the Waterdeep map with the encounter panels over it. Only this file knows the city.

import { mount } from 'svelte';

import '../../../src/lib/design/tokens.css';
import '../../../src/lib/design/fonts.css';
import '../../../src/lib/design/base.css';
import { DEMO_RULE_ENTRIES } from '../../../src/features/characters/demo-sheets.ts';
import {
  createRuleBook,
  entriesFromCompendium,
} from '../../../src/features/characters/rule-book.ts';
import TacticalOverlay from '../../../src/features/encounters/TacticalOverlay.svelte';
import { createDemoEncounter } from '../../../src/features/encounters/demo-encounter.ts';
import { openEffectsStorage } from '../../../src/features/encounters/effects.ts';
import {
  assertBundleComplete,
  type PlaceSubscription,
} from '../../../src/features/encounters/encounter-model.ts';
import { createMapViewer, type MapViewer } from '../../../src/lib/engine/map-viewer.ts';
import compendium from '../../knowledge/compendium.json';
import { WATERDEEP_MAP } from './plan.ts';

const ENCOUNTER_PLACE = 'castle-waterdeep';

interface TacticalProbe {
  ready: boolean;
  error: string;
  viewer: MapViewer | null;
}

declare global {
  interface Window {
    __tactical?: TacticalProbe;
  }
}

const probe: TacticalProbe = { ready: false, error: '', viewer: null };
window.__tactical = probe;

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`tactical demo: missing #${id}`);
  return element;
}

function placeEvents(viewer: MapViewer): PlaceSubscription {
  return (listener) =>
    viewer.on('place', (place) => listener({ contractId: place.contractId, name: place.name }));
}

async function boot(): Promise<void> {
  const place = WATERDEEP_MAP.places.find((entry) => entry.id === ENCOUNTER_PLACE);
  if (!place) throw new Error(`tactical demo: no place "${ENCOUNTER_PLACE}"`);
  const bundle = createDemoEncounter(place.contractId);
  assertBundleComplete(bundle);
  const canvas = requireElement('map') as HTMLCanvasElement;
  const requestedBackend = new URLSearchParams(location.search).get('backend');
  const backend = requestedBackend === 'webgl2' ? 'webgl2' : 'auto';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const viewer = await createMapViewer(canvas, WATERDEEP_MAP, { backend, reducedMotion });
  probe.viewer = viewer;
  mount(TacticalOverlay, {
    target: requireElement('overlay'),
    props: {
      bundle,
      rules: createRuleBook([...entriesFromCompendium(compendium), ...DEMO_RULE_ENTRIES]),
      placeName: place.name,
      subscribePlace: placeEvents(viewer),
      effectsStorage: openEffectsStorage(() => window.localStorage),
    },
  });
  probe.ready = true;
}

boot().catch((error: unknown) => {
  probe.error = error instanceof Error ? error.message : String(error);
  requireElement('boot-error').textContent = probe.error;
});
