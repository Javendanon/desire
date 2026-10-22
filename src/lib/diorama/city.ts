// The city diorama: the whole map on the shared stage, its sectors streamed in around the camera
// target (sector-streamer.ts) from the sector payloads and ground tiles under `base`.

import * as pc from 'playcanvas';

import { createCityLife, lifeMover, releaseLife, type CityLife } from './city-life.ts';
import type { GroundGrid, GroundTile } from './ground-mesh.ts';
import { roofTones } from './roof-palette.ts';
import {
  createStreamer, stopStreamer, streamSectors, type Streamer,
} from './sector-streamer.ts';
import { fetchOk, SECTOR_FORMAT, type SectorIndex } from './slice-data.ts';
import { createStage, type Diorama, type DioramaOptions, type Stage } from './stage.ts';

const GROUND_FORMAT = 'desire.ground-tiles/1';
/** The camera rests on land height (tools/assets/src/slice.ts). */
const LAND_Y = 1;

/** `ground.json` written by the ground stage. */
interface GroundIndex extends GroundGrid {
  format: string;
  rows: number;
  tiles: GroundTile[];
}

/** A point in map metres. */
export interface MapPoint {
  x_m: number;
  z_m: number;
}

export interface CitySpec {
  /** Directory holding `sectors/` and `ground/`. */
  base: string;
  /** Where the camera looks first, or the map centre when absent. */
  focus?: MapPoint;
  options: DioramaOptions;
}

async function readIndex<T extends { format: string }>(url: string, format: string): Promise<T> {
  const index = await fetchOk(url).then((response) => response.json() as Promise<T>);
  if (index.format !== format) throw new Error(`${url}: format ${index.format}, want ${format}`);
  return index;
}

function focusOf(spec: CitySpec, sectors: SectorIndex): pc.Vec3 {
  const { columns, rows, size_m } = sectors.grid;
  const focus = spec.focus ?? { x_m: (columns * size_m) / 2, z_m: (rows * size_m) / 2 };
  return new pc.Vec3(focus.x_m, LAND_Y, focus.z_m);
}

/** Both indexes, checked to describe the same grid: a ground tile per sector. */
async function readIndexes(base: string): Promise<[SectorIndex, GroundIndex]> {
  const [sectors, ground] = await Promise.all([
    readIndex<SectorIndex>(`${base}/sectors/index.json`, SECTOR_FORMAT),
    readIndex<GroundIndex>(`${base}/ground/ground.json`, GROUND_FORMAT),
  ]);
  const { columns, rows } = sectors.grid;
  if (ground.columns !== columns || ground.rows !== rows) {
    const found = `${ground.columns}×${ground.rows}`;
    throw new Error(`${base}: ground grid ${found}, sectors ${columns}×${rows}`);
  }
  return [sectors, ground];
}

/** The streamer and the city-wide houses, ships and ambience it feeds, moving with the stage. */
function populate(stage: Stage, spec: CitySpec, indexes: [SectorIndex, GroundIndex]) {
  const [sectors, ground] = indexes;
  const { app, textures } = stage;
  const roofCentres = sectors.roof_centres;
  const life = createCityLife(app, textures, roofTones([], roofCentres).colours);
  const listed = new Set(sectors.sectors.map((entry) => entry.index));
  const kit = { app, textures, ground, roofCentres };
  const streamer = createStreamer({ kit, grid: sectors.grid, base: spec.base, listed, life });
  stage.movers.add((moment) => streamSectors(streamer, moment));
  stage.movers.add(lifeMover(life));
  return { streamer, life };
}

type City = {
  stage: Stage;
  streamer: Streamer;
  life: CityLife;
};

function dioramaOf(city: City): Diorama {
  const { stage, streamer, life } = city;
  const { app } = stage;
  const houses = () => [...streamer.views.values()].reduce((sum, view) => sum + view.houses, 0);
  return {
    app,
    frame: stage.frame,
    orbit: stage.orbit,
    stats: () => ({ frames: stage.live().frames, houses: houses(),
      radius: stage.live().rig.radius, backend: app.graphicsDevice.deviceType }),
    destroy: () => {
      stopStreamer(streamer);
      releaseLife(life);
      stage.destroy();
    },
  };
}

export async function createCity(canvas: HTMLCanvasElement, spec: CitySpec): Promise<Diorama> {
  const indexes = await readIndexes(spec.base);
  const { grid } = indexes[0];
  const extent_m = Math.max(grid.columns, grid.rows) * grid.size_m;
  const stage = await createStage(canvas, { centre: focusOf(spec, indexes[0]), extent_m,
    options: spec.options });
  return dioramaOf({ stage, ...populate(stage, spec, indexes) });
}
