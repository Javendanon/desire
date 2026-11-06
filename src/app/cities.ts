// City package registry: the only app module that names a city. Views receive a generic
// MapDefinition, so adding a city means adding an entry here and no view changes.
import type { Id } from '../generated/contracts.ts';
import type { MapDefinition } from '../lib/engine/plan/map-definition.ts';

export interface CityMap {
  id: Id;
  map: MapDefinition;
}

export async function loadCityMaps(): Promise<readonly CityMap[]> {
  const waterdeep = await import('../../content/maps/waterdeep/plan.ts');
  return [{ id: waterdeep.WATERDEEP_CITY_ID, map: waterdeep.WATERDEEP_MAP }];
}

/**
 * A campaign without a city uses the first registered one. An unknown city yields null rather
 * than showing a map from somewhere else. O(cities).
 */
export function resolveCityMap(
  cities: readonly CityMap[],
  cityId: Id | null,
): MapDefinition | null {
  if (cityId === null) return cities[0]?.map ?? null;
  return cities.find((city) => city.id === cityId)?.map ?? null;
}

export async function loadCampaignMap(cityId: Id | null): Promise<MapDefinition | null> {
  return resolveCityMap(await loadCityMaps(), cityId);
}
