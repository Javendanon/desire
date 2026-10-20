// Instanced, streamed city rendering for any MapDefinition: one low-detail shell for the whole
// map plus walls and roofs rebuilt per resident sector. No map identity lives here.

import * as pc from 'playcanvas';

import type { Point2 } from '../math/hex.ts';
import type { MapDefinition } from '../plan/map-definition.ts';
import {
  activeSectors,
  detailFor,
  residentBytes,
  sectorCenter,
  type DetailLevel,
  type DetailThresholds,
} from '../plan/sectors.ts';
import { gableMesh, geometryMesh, material } from './kit.ts';
import {
  batch,
  farMatrix,
  flatRoofMatrix,
  gableMatrix,
  groundMesh,
  groupByTone,
  roadMesh,
  wallsMatrix,
  type Batch,
} from './sector-geometry.ts';
import { destroyTextures, paintTextures, type Textures } from './textures.ts';

export interface SectorCityOptions {
  /** Resident detail sectors around the focus. */
  limit?: number;
  /** Radius in metres that may receive more than the far shell. */
  radiusM?: number;
  thresholds?: DetailThresholds;
}

export interface SectorCityStats {
  sectors: number;
  /** Sector indices resident with detail 1 or 2 right now. */
  resident: number[];
  near: number;
  mid: number;
  detailedBuildings: number;
  farInstances: number;
  /** Legacy instance/sector estimate only, not a complete scene memory budget. */
  matrixBytes: number;
  drawCalls: number;
}

interface SectorRecord {
  detail: 1 | 2;
  entity: pc.Entity;
  batches: Batch[];
}

const DEFAULTS = {
  limit: 20,
  radiusM: 900,
  thresholds: { nearM: 160, midM: 420 },
} as const;

const ROOF_TINTS = ['#7c8792', '#b8714f', '#5f6a74', '#8f8770', '#a35f45', '#6d7f5e'];
const GROUND_COLOR = '#7c8468';
const WATER_LEVEL = -0.6;

export class SectorCity {
  readonly root = new pc.Entity('map');
  private readonly app: pc.AppBase;
  private readonly map: MapDefinition;
  private readonly options: Required<SectorCityOptions>;
  private readonly textures: Textures;
  private readonly box: pc.Mesh;
  private readonly gable: pc.Mesh;
  private readonly ground: pc.Mesh;
  private readonly wallStone: pc.StandardMaterial;
  private readonly wallTimber: pc.StandardMaterial;
  private readonly roofs: pc.StandardMaterial[];
  private readonly groundMaterial: pc.StandardMaterial;
  private readonly waterMaterial: pc.StandardMaterial;
  private readonly roadMaterial = material({ color: '#b3a287', twoSided: true });
  private readonly records = new Map<number, SectorRecord>();
  private farCount = 0;
  private farBatches = 0;
  private readonly farBuffers: pc.VertexBuffer[] = [];

  constructor(app: pc.AppBase, map: MapDefinition, options: SectorCityOptions = {}) {
    this.app = app;
    this.map = map;
    this.options = {
      limit: options.limit ?? DEFAULTS.limit,
      radiusM: options.radiusM ?? DEFAULTS.radiusM,
      thresholds: options.thresholds ?? DEFAULTS.thresholds,
    };
    const device = app.graphicsDevice;
    this.textures = paintTextures(device, map.seed);
    this.box = geometryMesh(device, new pc.BoxGeometry());
    this.gable = gableMesh(device);
    this.ground = groundMesh(device, map);
    // PlayCanvas destroys a mesh when its last MeshInstance releases it. These three are shared
    // by every sector, so the owner keeps a reference for the whole renderer lifetime.
    [this.box, this.gable, this.ground].forEach((mesh) => mesh.incRefCount());
    this.wallStone = material({ map: this.textures.stone, color: '#cfc6b4', gloss: 0.15 });
    this.wallTimber = material({ map: this.textures.timber, color: '#d8c6a4', gloss: 0.1 });
    this.roofs = ROOF_TINTS.map((color) =>
      material({ map: this.textures.shingle, color, gloss: 0.3, twoSided: true }),
    );
    this.groundMaterial = material({ map: this.textures.turf, color: GROUND_COLOR });
    this.waterMaterial = material({ color: '#173847', gloss: 0.78, metalness: 0.25 });
    this.root.addChild(this.buildGround());
    if (map.roads?.length) this.root.addChild(this.buildRoads());
    this.root.addChild(this.buildFarShell());
    this.root.addChild(this.buildWater());
    app.root.addChild(this.root);
  }

  private buildGround(): pc.Entity {
    const entity = new pc.Entity('ground');
    entity.addComponent('render', {
      meshInstances: [new pc.MeshInstance(this.ground, this.groundMaterial)],
      receiveShadows: true,
    });
    return entity;
  }

  private buildRoads(): pc.Entity {
    const entity = new pc.Entity('road-corridors');
    entity.addComponent('render', {
      meshInstances: [new pc.MeshInstance(roadMesh(this.app.graphicsDevice, this.map),
        this.roadMaterial)],
      castShadows: false,
      receiveShadows: true,
    });
    return entity;
  }

  private buildFarShell(): pc.Entity {
    const container = new pc.Entity('far-shell');
    const byTone = groupByTone(this.map, this.roofs.length);
    for (const [tone, buildings] of byTone) {
      const matrices = buildings.map(farMatrix);
      const result = batch(this.app.graphicsDevice, {
        mesh: this.box,
        material: this.roofs[tone],
        matrices,
      });
      this.farCount += buildings.length;
      if (result.buffer) this.farBuffers.push(result.buffer);
      if (result.entity.render) result.entity.render.castShadows = false;
      container.addChild(result.entity);
      this.farBatches++;
    }
    return container;
  }

  /** Rebuild only the sectors whose detail level changed and drop the ones out of range. */
  update(focus: Point2): void {
    const active = activeSectors(this.map.grid, focus, {
      radiusM: this.options.radiusM,
      limit: this.options.limit,
    });
    const wanted = new Map<number, DetailLevel>();
    for (const index of active) {
      const centre = sectorCenter(this.map.grid, index);
      const distance = Math.hypot(centre.x - focus.x, centre.z - focus.z);
      wanted.set(index, detailFor(distance, this.options.thresholds));
    }
    for (const index of [...this.records.keys()]) {
      const detail = wanted.get(index) ?? 0;
      if (detail === 0) this.remove(index);
    }
    for (const [index, detail] of wanted) {
      if (detail === 0) continue;
      const record = this.records.get(index);
      if (record?.detail === detail) continue;
      this.remove(index);
      this.records.set(index, this.buildSector(index, detail));
    }
  }

  private buildSector(index: number, detail: 1 | 2): SectorRecord {
    const stone: pc.Mat4[] = [];
    const timber: pc.Mat4[] = [];
    const roofs = new Map<number, pc.Mat4[]>();
    for (const building of this.map.sector(index).buildings) {
      (building.stone ? stone : timber).push(wallsMatrix(building));
      const tone = building.tone % this.roofs.length;
      const list = roofs.get(tone) ?? [];
      list.push(detail === 2 ? gableMatrix(building) : flatRoofMatrix(building));
      roofs.set(tone, list);
    }
    const device = this.app.graphicsDevice;
    const roofMesh = detail === 2 ? this.gable : this.box;
    const entity = new pc.Entity(`sector-${index}`);
    const batches = [
      batch(device, { mesh: this.box, material: this.wallStone, matrices: stone }),
      batch(device, { mesh: this.box, material: this.wallTimber, matrices: timber }),
      ...[...roofs].map(([tone, matrices]) =>
        batch(device, { mesh: roofMesh, material: this.roofs[tone], matrices }),
      ),
    ];
    for (const entry of batches) entity.addChild(entry.entity);
    this.root.addChild(entity);
    return { detail, entity, batches };
  }

  private remove(index: number): void {
    const record = this.records.get(index);
    if (!record) return;
    this.records.delete(index);
    record.entity.destroy();
    for (const entry of record.batches) entry.buffer?.destroy();
  }

  stats(): SectorCityStats {
    let near = 0;
    let mid = 0;
    let detailedBuildings = 0;
    let detailedBatches = 0;
    for (const [index, record] of this.records) {
      if (record.detail === 2) near++;
      else mid++;
      detailedBuildings += this.map.sector(index).buildings.length;
      detailedBatches += record.batches.length;
    }
    return {
      sectors: this.records.size,
      resident: [...this.records.keys()],
      near,
      mid,
      detailedBuildings,
      farInstances: this.farCount,
      // Each detailed building allocates a wall matrix and a roof matrix.
      matrixBytes: residentBytes(this.records.size, detailedBuildings * 2 + this.farCount),
      drawCalls: 2 + (this.map.roads?.length ? 1 : 0) + this.farBatches + detailedBatches,
    };
  }

  /** Water plane under the whole map frame. */
  private buildWater(): pc.Entity {
    const width = this.map.bounds.maxX - this.map.bounds.minX;
    const depth = this.map.bounds.maxZ - this.map.bounds.minZ;
    const entity = new pc.Entity('sea');
    entity.addComponent('render', { type: 'box', receiveShadows: true });
    if (entity.render) entity.render.material = this.waterMaterial;
    entity.setLocalPosition(
      (this.map.bounds.minX + this.map.bounds.maxX) / 2,
      WATER_LEVEL - 2,
      (this.map.bounds.minZ + this.map.bounds.maxZ) / 2,
    );
    entity.setLocalScale(width * 1.4, 4, depth * 1.4);
    return entity;
  }

  destroy(): void {
    for (const index of [...this.records.keys()]) this.remove(index);
    this.root.destroy();
    for (const buffer of this.farBuffers) buffer.destroy();
    [this.box, this.gable, this.ground].forEach((mesh) => {
      mesh.decRefCount();
      mesh.destroy();
    });
    this.wallStone.destroy();
    this.wallTimber.destroy();
    for (const roof of this.roofs) roof.destroy();
    this.groundMaterial.destroy();
    this.waterMaterial.destroy();
    this.roadMaterial.destroy();
    destroyTextures(this.textures);
  }
}
