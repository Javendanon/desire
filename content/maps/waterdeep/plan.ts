// The Waterdeep map as the generic viewer consumes it: calibrated bounds, land, sector content,
// places and control points. Places are also exposed as D04 records with one anchored position.

import type { Place } from '../../../src/generated/contracts.ts';
import type {
  MapDefinition,
  MapMarker,
  MapPlace,
} from '../../../src/lib/engine/plan/map-definition.ts';
import { WATERDEEP_BOUNDS, WATERDEEP_GRID } from './bounds.ts';
import { waterdeepSector } from './buildings.ts';
import { WATERDEEP_COAST, waterdeepIsLand, waterdeepLandSpans } from './coast.ts';
import { WATERDEEP_REFERENCE, type PlanPoint } from './reference.ts';
import { zoneForWard } from './zones.ts';
import { WATERDEEP_ROADS } from './streets.ts';

export { WATERDEEP_COAST, waterdeepIsLand } from './coast.ts';
export { WATERDEEP_ZONES } from './zones.ts';
export { allWaterdeepBuildings, waterdeepSector } from './buildings.ts';

// D04 ids are UUIDs. This fixed block keeps the same values across loads and tools, while the
// D05 slugs stay as catalog keys and source references.
const ID_PREFIX = 'd1300000-0000-4000-8000-';
const CITY_SLOT = 0x1;
const MAP_SLOT = 0x2;

/** Explicit slots: adding a place to the D05 JSON cannot renumber the existing ids. */
type Slots = Record<string, number>;

const PLACE_SLOTS: Slots = {
  'castle-waterdeep': 0x101,
  'piergeirons-palace': 0x102,
  'the-yawning-portal': 0x103,
  'blackstaff-tower': 0x104,
  'the-market': 0x105,
  'harborwatch-tower': 0x106,
  'city-of-the-dead-center': 0x107,
  'new-olamn': 0x108,
  'south-gate': 0x109,
  'deepwater-beacon': 0x10a,
};

const DISTRICT_SLOTS: Slots = {
  'field-ward': 0x11,
  'castle-ward': 0x12,
  'dock-ward': 0x13,
  'north-ward': 0x14,
  'sea-ward': 0x15,
  'southern-ward': 0x16,
  'trades-ward': 0x17,
  'city-of-the-dead': 0x18,
};

function stableId(slot: number): string {
  if (!Number.isInteger(slot) || slot < 0) throw new Error(`stableId: invalid slot ${slot}`);
  return `${ID_PREFIX}${slot.toString(16).padStart(12, '0')}`;
}

export const WATERDEEP_CITY_ID = stableId(CITY_SLOT);
export const WATERDEEP_MAP_ID = stableId(MAP_SLOT);
export const WATERDEEP_CATALOG_NAMESPACE = 'waterdeep';

function slotId(table: Slots, key: string | null, kind: string): string | null {
  if (!key) return null;
  const slot = table[key];
  if (slot === undefined) {
    throw new Error(`waterdeep ids: no ${kind} slot for "${key}"`);
  }
  return stableId(slot);
}

/** Stable UUID for a D05 place slug, shared by the scene marker and the D04 record. */
export function placeContractId(slug: string): string {
  const id = slotId(PLACE_SLOTS, slug, 'place');
  if (!id) throw new Error(`waterdeep ids: missing place slug for "${slug}"`);
  return id;
}

const ATTRIBUTION = WATERDEEP_REFERENCE.attribution;
const SOURCE_ATTRIBUTION = `${ATTRIBUTION.map_artwork} / ${ATTRIBUTION.hosted_by}`;

const places: readonly MapPlace[] = WATERDEEP_REFERENCE.initial_places.map((place) => ({
  id: place.id,
  name: place.name,
  at: { x: place.plan_m.x_m, z: place.plan_m.z_m },
  ward: place.ward,
  contractId: placeContractId(place.id),
  catalogId: `${WATERDEEP_CATALOG_NAMESPACE}:${place.id}`,
  sourceRef: place.source_ref,
  provenance: place.provenance,
}));

interface PlanEntry {
  id: string;
  name: string;
  plan_m: PlanPoint;
}

function markers(entries: readonly PlanEntry[]): MapMarker[] {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    at: { x: entry.plan_m.x_m, z: entry.plan_m.z_m },
  }));
}

export const WATERDEEP_MAP: MapDefinition = {
  id: WATERDEEP_MAP_ID,
  name: 'Waterdeep',
  seed: 20261018,
  grid: WATERDEEP_GRID,
  bounds: WATERDEEP_BOUNDS,
  coast: WATERDEEP_COAST,
  sector: waterdeepSector,
  places,
  controlPoints: markers(WATERDEEP_REFERENCE.control_points),
  streets: markers(WATERDEEP_REFERENCE.main_streets),
  roads: WATERDEEP_ROADS,
  isLand: waterdeepIsLand,
  landSpans: waterdeepLandSpans,
};

/** The ten selected D05 places as D04 records, with elevation fixed at plan level 0. */
export function waterdeepPlaces(): Place[] {
  return WATERDEEP_REFERENCE.initial_places.map((place) => {
    const zone = zoneForWard(place.ward);
    return {
      id: placeContractId(place.id),
      city_id: WATERDEEP_CITY_ID,
      district_id: slotId(DISTRICT_SLOTS, zone?.id ?? null, 'district'),
      name: place.name,
      provenance: {
        source: WATERDEEP_REFERENCE.calibration.provenance.source,
        attribution: SOURCE_ATTRIBUTION,
        evidence: 'interpretation',
      },
      anchors: [
        {
          map_version_id: WATERDEEP_MAP_ID,
          position: { x_m: place.plan_m.x_m, y_m: 0, z_m: place.plan_m.z_m },
          provenance: {
            source: 'docs/maps/waterdeep/data/waterdeep-reference.json',
            attribution: 'D05 plan metres; elevation fixed at 0 because the source stores none',
            evidence: 'interpretation',
          },
        },
      ],
    };
  });
}
