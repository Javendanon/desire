// Place, control-point and street markers for the map viewer, with the pick spheres for places.
// Marker size follows the orbit radius so a whole-city overview still shows the D05 points.

import * as pc from 'playcanvas';

import type { MapDefinition, MapMarker } from '../plan/map-definition.ts';
import type { SphereTarget } from '../math/ray.ts';
import { part } from '../render/kit.ts';

export type MarkerGroup = 'place' | 'control' | 'street';

interface BoxShape {
  width: number;
  height: number;
  tone: number;
}

interface MarkerRecord {
  marker: MapMarker;
  entity: pc.Entity;
  group: MarkerGroup;
}

const PLACE_PICK_RADIUS = 60;
const PLACE_CONE_Y = 26;
const SCALE_MIN = 0.5;
const SCALE_MAX = 3.5;
const SCALE_PER_RADIUS = 1 / 1400;
const SELECTED_BOOST = 1.5;

function markerMaterial(color: string, emissive: number): pc.StandardMaterial {
  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color().fromString(color);
  material.emissive = new pc.Color().fromString(color);
  material.emissiveIntensity = emissive;
  material.useMetalness = true;
  material.gloss = 0.4;
  material.update();
  return material;
}

export class MapMarkers {
  readonly root = new pc.Entity('markers');
  readonly targets: SphereTarget[];
  private readonly map: MapDefinition;
  private readonly records: MarkerRecord[] = [];
  private readonly materials: pc.StandardMaterial[];

  constructor(map: MapDefinition) {
    this.map = map;
    this.materials = [
      markerMaterial('#f0c36a', 0.6),
      markerMaterial('#e055c8', 1.2),
      markerMaterial('#d98b3a', 0.4),
    ];
    this.targets = map.places.map((place) => ({
      id: place.id,
      center: { x: place.at.x, y: PLACE_CONE_Y, z: place.at.z },
      radius: PLACE_PICK_RADIUS,
    }));
    this.build();
  }

  private build(): void {
    for (const place of this.map.places) this.buildPlace(place);
    for (const point of this.map.controlPoints) {
      this.buildBox(point, 'control', { width: 4, height: 22, tone: 1 });
    }
    for (const street of this.map.streets) {
      this.buildBox(street, 'street', { width: 2, height: 14, tone: 2 });
    }
  }

  private buildPlace(marker: MapMarker): void {
    const entity = new pc.Entity(`place-${marker.id}`);
    entity.setLocalPosition(marker.at.x, 0, marker.at.z);
    part(entity, {
      type: 'cylinder',
      material: this.materials[0],
      position: [0, 11, 0],
      scale: [3, 22, 3],
    });
    part(entity, {
      type: 'cone',
      material: this.materials[0],
      position: [0, 26, 0],
      scale: [6, 10, 6],
    });
    this.root.addChild(entity);
    this.records.push({ marker, entity, group: 'place' });
  }

  private buildBox(marker: MapMarker, group: MarkerGroup, shape: BoxShape): void {
    const entity = new pc.Entity(`${group}-${marker.id}`);
    entity.setLocalPosition(marker.at.x, 0, marker.at.z);
    part(entity, {
      type: 'box',
      material: this.materials[shape.tone],
      position: [0, shape.height / 2, 0],
      scale: [shape.width, shape.height, shape.width],
    });
    this.root.addChild(entity);
    this.records.push({ marker, entity, group });
  }

  setGroupVisible(group: MarkerGroup, visible: boolean): void {
    for (const record of this.records) {
      if (record.group === group) record.entity.enabled = visible;
    }
  }

  /** Scale the whole marker layer for a camera radius, keeping the selection a bit larger. */
  updateScale(radius: number, selected: string | null): void {
    const base = Math.min(SCALE_MAX, Math.max(SCALE_MIN, radius * SCALE_PER_RADIUS));
    for (const record of this.records) {
      const chosen = record.group === 'place' && record.marker.id === selected;
      const scale = chosen ? base * SELECTED_BOOST : base;
      record.entity.setLocalScale(scale, scale, scale);
    }
    for (const target of this.targets) {
      target.center.y = PLACE_CONE_Y * base;
      target.radius = PLACE_PICK_RADIUS * Math.max(1, base);
    }
  }

  destroy(): void {
    this.root.destroy();
    for (const material of this.materials) material.destroy();
  }
}
