// The slice diorama: one exported slice (or its stress tiling) on the shared stage, with its
// terrain, town, ships, lanterns, smoke and fog, and the haze that hides where its data ends.

import * as pc from 'playcanvas';

import { animateAmbience, buildAmbience, type Ambience } from './ambience.ts';
import { buildEdgeHaze, tiltEdgeHaze, type EdgeHaze } from './edge-haze.ts';
import { animateFleet, buildFleet, type Fleet } from './ships.ts';
import type { Slice } from './slice-data.ts';
import {
  createStage, glowWindows, type Diorama, type DioramaOptions, type Mover, type Stage,
} from './stage.ts';
import type { TiledSlice } from './stress-slice.ts';
import { buildTerrain } from './terrain.ts';
import { buildTown } from './town.ts';

export type { Diorama, DioramaOptions, DioramaStats } from './stage.ts';

function sceneCentre(slice: Slice): pc.Vec3 {
  return new pc.Vec3(slice.meta.width_m / 2, 1, slice.meta.depth_m / 2);
}

/** The source slice's terrain at every tile offset; clones share its mesh and material. */
function buildGround(app: pc.AppBase, layout: TiledSlice, detail: pc.Texture): pc.Entity {
  const ground = new pc.Entity('ground');
  const terrain = buildTerrain(app, layout.source, detail);
  layout.offsets.forEach((offset, index) => {
    const tile = index === 0 ? terrain : terrain.clone();
    tile.setPosition(offset.x_m, 0, offset.z_m);
    ground.addChild(tile);
  });
  return ground;
}

/** What moves in the slice besides the sea. */
type SliceLife = {
  fleet: Fleet;
  ambience: Ambience;
  edge: EdgeHaze;
};

const sliceMover = (life: SliceLife): Mover => (moment) => {
  animateFleet(life.fleet, moment.time);
  tiltEdgeHaze(life.edge, moment.rig.polar);
  const { right, up } = moment.camera;
  animateAmbience(life.ambience, { time: moment.time, right, up });
};

function populate(stage: Stage, layout: TiledSlice): SliceLife {
  const { app, textures } = stage;
  const { slice } = layout;
  const town = buildTown(app, { houses: slice.houses, roofCentres: slice.roofCentres }, textures);
  glowWindows(town.windowMaterials);
  const fleet = buildFleet(app, slice.features.berths, textures);
  const water = { heights: slice.heights, meta: slice.meta, origin: { x_m: 0, z_m: 0 } };
  const ambience = buildAmbience(app, { water, town });
  const edge = buildEdgeHaze(app, slice);
  const parts = [buildGround(app, layout, textures.cobble), town.root, fleet.root,
    ambience.root, edge.root];
  for (const part of parts) app.root.addChild(part);
  return { fleet, ambience, edge };
}

export async function createDiorama(
  canvas: HTMLCanvasElement,
  layout: TiledSlice,
  options: DioramaOptions = {},
): Promise<Diorama> {
  const { slice } = layout;
  const extent_m = Math.max(slice.meta.width_m, slice.meta.depth_m);
  const stage = await createStage(canvas, { centre: sceneCentre(slice), extent_m, options });
  stage.movers.add(sliceMover(populate(stage, layout)));
  const { app } = stage;
  return {
    app,
    frame: stage.frame,
    orbit: stage.orbit,
    stats: () => ({ frames: stage.live().frames, houses: slice.houses.length,
      radius: stage.live().rig.radius, backend: app.graphicsDevice.deviceType }),
    destroy: stage.destroy,
  };
}
