// Typed access to the D05 Waterdeep reference package. This module only reads and checks the
// calibrated reference; it adds no geography, heights or lore of its own.

import raw from '../../../docs/maps/waterdeep/data/waterdeep-reference.json' with { type: 'json' };

export interface PixelPoint {
  x: number;
  y: number;
}

export interface PlanPoint {
  x_m: number;
  z_m: number;
}

export interface PixelBox {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

export interface ReferenceWard {
  name: string;
  centroid_pixel: PixelPoint;
  bbox_pixel: PixelBox;
  source: string;
  centroid_plan_m: PlanPoint;
}

export interface ReferenceMarker {
  id: string;
  name: string;
  pixel: PixelPoint;
  plan_m: PlanPoint;
  source_ref: string | null;
  provenance: string[];
}

export interface ReferenceStreet extends ReferenceMarker {
  kind: 'street-label-anchor';
}

export interface ReferencePoint extends ReferenceMarker {
  kind: string;
}

export interface ReferencePlace extends ReferenceMarker {
  ward: string | null;
  role: string;
}

export interface ReferenceCalibration {
  origin_px_x: number;
  origin_px_y: number;
  meters_per_pixel: number;
  rotation_radians: number;
  provenance: {
    source: string;
    attribution: string;
    evidence: string;
  };
}

export interface WaterdeepReference {
  schema: string;
  status: string;
  attribution: {
    map_artwork: string;
    artwork_url: string;
    hosted_by: string;
    page_url: string;
    image_url: string;
    note: string;
  };
  image: {
    mime: string;
    width: number;
    height: number;
    local_path: string | null;
  };
  scale: {
    source_constant: string;
    source_comment: string;
    meters_per_pixel: number;
    status: string;
  };
  calibration: ReferenceCalibration;
  coast: {
    description: string;
    evidence: string;
    control_point_ids: string[];
  };
  wards: ReferenceWard[];
  main_streets_status: string;
  main_streets: ReferenceStreet[];
  control_points: ReferencePoint[];
  initial_places: ReferencePlace[];
  doubts: string[];
}

const EXPECTED = {
  controlPoints: 20,
  wards: 8,
  places: 10,
  streets: 7,
} as const;

function fail(problem: string): never {
  throw new Error(`waterdeep reference: ${problem}`);
}

function checkReference(value: unknown): WaterdeepReference {
  const reference = value as WaterdeepReference;
  if (!reference || typeof reference !== 'object') fail('the JSON root is not an object');
  if (!reference.calibration) fail('missing calibration');
  if (!(reference.calibration.meters_per_pixel > 0)) fail('calibration scale is not positive');
  if (!reference.image || !(reference.image.width > 0)) fail('missing image frame');
  const counts = [
    ['control points', reference.control_points?.length, EXPECTED.controlPoints],
    ['wards', reference.wards?.length, EXPECTED.wards],
    ['places', reference.initial_places?.length, EXPECTED.places],
    ['streets', reference.main_streets?.length, EXPECTED.streets],
  ] as const;
  for (const [label, found, expected] of counts) {
    if (found !== expected) fail(`expected ${expected} ${label}, got ${String(found)}`);
  }
  return reference;
}

/** The checked D05 package. Importing it twice returns the same object. */
export const WATERDEEP_REFERENCE: WaterdeepReference = checkReference(raw);

/** D04 plan frame for a raster pixel: x east, z south, no elevation. */
export function planMeters(pixel: PixelPoint, metersPerPixel: number): PlanPoint {
  if (!(metersPerPixel > 0)) {
    throw new Error(`planMeters: scale must be positive, got ${metersPerPixel}`);
  }
  return {
    x_m: pixel.x * metersPerPixel,
    z_m: pixel.y * metersPerPixel,
  };
}
