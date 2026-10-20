// Public map-viewer options, diagnostics and events. No runtime state or map identity.
import type { Point2 } from './math/hex.ts';
import type { MapPlace } from './plan/map-definition.ts';
import type { Quality, TimeOfDay } from './render/atmosphere.ts';
import type { SectorCityStats } from './render/sector-city.ts';

export interface MapViewerOptions {
  quality?: Quality;
  timeOfDay?: TimeOfDay;
  fog?: number;
  reducedMotion?: boolean;
  backend?: 'auto' | 'webgl2';
  sectorLimit?: number;
  detailRadiusM?: number;
}

export interface MapViewerStats {
  frames: number;
  backend: string;
  radius: number;
  azimuth: number;
  polar: number;
  focus: Point2;
  selected: string | null;
  sectors: SectorCityStats;
}

/** Device-tracked allocations, not physical VRAM. The browser audit also measures renderbuffers. */
export interface MapMemoryStats {
  textures: number;
  geometry: number;
  buffers: number;
}

export interface MapViewerEvents {
  place: MapPlace;
  hover: MapPlace | null;
}
