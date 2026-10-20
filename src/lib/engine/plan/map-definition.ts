// What the map viewer needs from any map: a sector grid, land, buildings and markers. Pure data,
// no engine types, so a city package can be tested without a GPU and the viewer stays generic.

import type { Point2 } from '../math/hex.ts';
import type { Polygon } from './polygon.ts';
import type { SectorBounds, SectorGrid } from './sectors.ts';

/** One stylised building lot. Every field except the position is an interpretation. */
export interface MapBuilding {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  /** Rotation around Y in radians. */
  rotation: number;
  /** Roof tint index, 0 to 4. */
  roof: number;
  /** Ward/zone tone index used to group roof batches. */
  tone: number;
  stone: boolean;
}

export interface SectorContent {
  buildings: readonly MapBuilding[];
}

export interface MapMarker {
  id: string;
  name: string;
  at: Point2;
}

/** A place plus the stable reference used to link it to the catalog and the source. */
export interface MapPlace extends MapMarker {
  ward: string | null;
  /** Stable D04 UUID, the same one `waterdeepPlaces()` emits. */
  contractId: string;
  catalogId: string;
  sourceRef: string | null;
  provenance: readonly string[];
}

export interface MapDefinition {
  /** Stable map version id, also used as `PlaceAnchor.map_version_id`. */
  id: string;
  name: string;
  /** Seeds the procedural facade textures. */
  seed: number;
  grid: SectorGrid;
  bounds: SectorBounds;
  coast: Polygon;
  sector(index: number): SectorContent;
  places: readonly MapPlace[];
  controlPoints: readonly MapMarker[];
  streets: readonly MapMarker[];
  /** True where the map has land, including its own water bodies. */
  isLand(point: Point2): boolean;
  /** Land runs along one z row, used to build the ground mesh with no gaps. */
  landSpans(z: number): readonly [number, number][];
}
