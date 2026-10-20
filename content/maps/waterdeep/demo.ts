// Demo page for the Waterdeep map viewer: mounts the scene, draws HTML labels, lists places and
// exposes a small probe for the headless smoke test. Content only; the engine stays generic.

import {
  createMapViewer,
  type MapViewer,
  type MapViewerStats,
} from '../../../src/lib/engine/map-viewer.ts';
import type { Point2 } from '../../../src/lib/engine/math/hex.ts';
import { sectorCount, sectorIndexAt } from '../../../src/lib/engine/plan/sectors.ts';
import { WATERDEEP_MAP, WATERDEEP_ZONES } from './plan.ts';
import type { MapPlace } from '../../../src/lib/engine/plan/map-definition.ts';

const TOTAL_SECTORS = sectorCount(WATERDEEP_MAP.grid);
const MAX_DETAIL_SECTORS = 20;

interface LabelEntry {
  element: HTMLElement;
  at: Point2;
  height: number;
}

interface ProbeResult {
  ok: boolean;
  stats: MapViewerStats;
  totalSectors: number;
  maxDetailSectors: number;
  focusSectorResident: boolean;
  error?: string;
}

interface WaterdeepProbe {
  ready: boolean;
  error: string;
  viewer: MapViewer | null;
  check(): ProbeResult;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`demo: missing #${id}`);
  return element as T;
}

const params = new URLSearchParams(location.search);
const backend = params.get('backend') === 'webgl2' ? 'webgl2' : 'auto';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = byId<HTMLCanvasElement>('map');
const labelsHost = byId<HTMLDivElement>('labels');
const statsLine = byId<HTMLDivElement>('stats');
const placesList = byId<HTMLUListElement>('places');
const selectedPanel = byId<HTMLElement>('selected');

const probe: WaterdeepProbe = {
  ready: false,
  error: '',
  viewer: null,
  check(): ProbeResult {
    const viewer = probe.viewer;
    if (!viewer) {
      return {
        ok: false,
        stats: emptyStats(),
        totalSectors: TOTAL_SECTORS,
        maxDetailSectors: MAX_DETAIL_SECTORS,
        focusSectorResident: false,
        error: probe.error || 'viewer not created',
      };
    }
    const stats = viewer.stats();
    const focusSector = sectorIndexAt(WATERDEEP_MAP.grid, stats.focus);
    const focusSectorResident =
      focusSector !== null && stats.sectors.resident.includes(focusSector);
    return {
      ok: isHealthy(stats) && focusSectorResident,
      stats,
      totalSectors: TOTAL_SECTORS,
      maxDetailSectors: MAX_DETAIL_SECTORS,
      focusSectorResident,
    };
  },
};

function isHealthy(stats: MapViewerStats): boolean {
  return (
    stats.frames > 0 &&
    stats.sectors.farInstances > 0 &&
    stats.sectors.sectors > 0 &&
    stats.sectors.sectors <= MAX_DETAIL_SECTORS &&
    stats.sectors.sectors < TOTAL_SECTORS
  );
}

function emptyStats(): MapViewerStats {
  return {
    frames: 0,
    backend: 'none',
    radius: 0,
    azimuth: 0,
    polar: 0,
    focus: { x: 0, z: 0 },
    selected: null,
    sectors: {
      sectors: 0,
      resident: [],
      near: 0,
      mid: 0,
      detailedBuildings: 0,
      farInstances: 0,
      matrixBytes: 0,
      drawCalls: 0,
    },
  };
}

interface LabelSpec {
  text: string;
  at: Point2;
  height: number;
  kind: string;
}

function addLabel(spec: LabelSpec): LabelEntry {
  const element = document.createElement('span');
  element.className = `label ${spec.kind}`;
  element.textContent = spec.text;
  labelsHost.append(element);
  return { element, at: spec.at, height: spec.height };
}

function buildLabels(): LabelEntry[] {
  const entries = WATERDEEP_MAP.places.map((place) =>
    addLabel({ text: place.name, at: place.at, height: 34, kind: 'place' }),
  );
  for (const zone of WATERDEEP_ZONES) {
    const spec = { text: zone.name, at: zone.center, height: 6, kind: 'ward' };
    entries.push(addLabel(spec));
  }
  return entries;
}

function updateLabels(viewer: MapViewer, entries: readonly LabelEntry[]): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  for (const entry of entries) {
    const projected = viewer.project(entry.at, entry.height);
    const inside = projected.visible && projected.x > 0 && projected.x < width;
    const visible = inside && projected.y > 0 && projected.y < height;
    entry.element.hidden = !visible;
    if (!visible) continue;
    entry.element.style.left = `${projected.x}px`;
    entry.element.style.top = `${projected.y}px`;
  }
}

function showStats(viewer: MapViewer): void {
  const stats = viewer.stats();
  const sectors = stats.sectors;
  const megabytes = (sectors.matrixBytes / (1024 * 1024)).toFixed(2);
  statsLine.textContent =
    `${stats.frames} frames · ${stats.backend} · radius ${Math.round(stats.radius)} m · ` +
    `focus ${Math.round(stats.focus.x)}, ${Math.round(stats.focus.z)} · ` +
    `${sectors.sectors}/${TOTAL_SECTORS} sectors resident ` +
    `(${sectors.near} near, ${sectors.mid} mid) · ` +
    `${sectors.detailedBuildings} detailed / ${sectors.farInstances} far lots · ` +
    `~${megabytes} MiB instance estimate · ~${sectors.drawCalls} draws`;
}

function bindPlaceList(viewer: MapViewer): void {
  for (const place of WATERDEEP_MAP.places) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = place.name;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      viewer.focusPlace(place.id);
      choose(viewer, place);
    });
    item.append(button);
    placesList.append(item);
  }
}

function choose(viewer: MapViewer, place: MapPlace): void {
  viewer.selectPlace(place.id);
  byId('selected-name').textContent = place.name;
  byId('selected-where').textContent = place.ward
    ? `${place.ward} · anchored at the D05 plan point`
    : 'Coastal landmark · anchored at the D05 plan point';
  byId('selected-catalog').textContent = place.catalogId;
  byId('selected-record').textContent = place.contractId;
  byId('selected-ref').textContent = place.sourceRef ?? 'no dataset reference';
  byId('selected-provenance').textContent = place.provenance.join(', ');
  selectedPanel.hidden = false;
  for (const button of placesList.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', button.textContent === place.name ? 'true' : 'false');
  }
}

function bindToggles(viewer: MapViewer): void {
  byId<HTMLInputElement>('control-points').addEventListener('change', (event) => {
    viewer.setMarkersVisible('control', (event.target as HTMLInputElement).checked);
  });
  byId<HTMLInputElement>('streets').addEventListener('change', (event) => {
    viewer.setMarkersVisible('street', (event.target as HTMLInputElement).checked);
  });
  byId('reset').addEventListener('click', () => viewer.reset());
}

async function boot(): Promise<void> {
  try {
    const viewer = await createMapViewer(canvas, WATERDEEP_MAP, { backend, reducedMotion });
    probe.viewer = viewer;
    viewer.on('place', (place) => choose(viewer, place));
    viewer.on('hover', (place) => {
      canvas.style.cursor = place ? 'pointer' : 'grab';
    });
    bindPlaceList(viewer);
    bindToggles(viewer);
    const entries = buildLabels();
    updateLabels(viewer, entries);
    viewer.onFrame(() => updateLabels(viewer, entries));
    window.setInterval(() => showStats(viewer), 250);
    showStats(viewer);
    probe.ready = true;
  } catch (error) {
    probe.error = error instanceof Error ? error.message : String(error);
    statsLine.textContent = probe.error;
  }
}

declare global {
  interface Window {
    __waterdeep?: WaterdeepProbe;
  }
}

window.__waterdeep = probe;
void boot();
