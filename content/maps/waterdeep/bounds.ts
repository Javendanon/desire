// The calibrated Waterdeep frame in D04 metres and the sector grid laid over it.

import {
  createGrid,
  type SectorBounds,
  type SectorGrid,
} from '../../../src/lib/engine/plan/sectors.ts';
import { planMeters, WATERDEEP_REFERENCE } from './reference.ts';

export const SECTOR_SIZE_M = 250;

function frameBounds(): SectorBounds {
  const scale = WATERDEEP_REFERENCE.calibration.meters_per_pixel;
  const southEast = planMeters(
    { x: WATERDEEP_REFERENCE.image.width, y: WATERDEEP_REFERENCE.image.height },
    scale,
  );
  return { minX: 0, minZ: 0, maxX: southEast.x_m, maxZ: southEast.z_m };
}

export const WATERDEEP_BOUNDS: SectorBounds = frameBounds();

export const WATERDEEP_GRID: SectorGrid = createGrid(SECTOR_SIZE_M, WATERDEEP_BOUNDS);
