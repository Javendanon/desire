// One instanced batch fed from many sectors: its instance buffer grows in powers of two and is
// refilled in place when the sectors behind it change, so merging a sector costs a copy and an
// upload, not new GPU objects. One draw per pass for every house part of that kind on stage.

import * as pc from 'playcanvas';

import { boundsOf, type InstancedLook } from '../engine/render/kit.ts';

const FLOATS_PER_MATRIX = 16;
const MIN_CAPACITY = 64;

export interface MergedBatch {
  entity: pc.Entity;
  instance: pc.MeshInstance;
  buffer: pc.VertexBuffer | null;
  /** Instance data at the buffer's full size; the tail past the count is never drawn. */
  staging: Float32Array;
}

export function createMergedBatch(look: InstancedLook, castShadows: boolean): MergedBatch {
  const entity = new pc.Entity('merged');
  const instance = new pc.MeshInstance(look.mesh, look.material);
  entity.addComponent('render', { meshInstances: [instance], castShadows, receiveShadows: true });
  entity.enabled = false;
  return { entity, instance, buffer: null, staging: new Float32Array(0) };
}

/** A buffer for at least `count` instances, replacing a smaller one. */
function reserve(device: pc.GraphicsDevice, batch: MergedBatch, count: number) {
  const capacity = batch.staging.length / FLOATS_PER_MATRIX;
  if (count <= capacity) return;
  const size = Math.max(MIN_CAPACITY, 2 ** Math.ceil(Math.log2(count)));
  batch.buffer?.destroy();
  batch.staging = new Float32Array(size * FLOATS_PER_MATRIX);
  const format = pc.VertexFormat.getDefaultInstancingFormat(device);
  batch.buffer = new pc.VertexBuffer(device, format, size,
    { usage: pc.BUFFER_DYNAMIC, data: batch.staging });
  batch.instance.setInstancing(batch.buffer, true);
}

/** Replaces the batch's instances. O(instances). */
export function fillMergedBatch(device: pc.GraphicsDevice, batch: MergedBatch, data: Float32Array) {
  const count = data.length / FLOATS_PER_MATRIX;
  batch.entity.enabled = count > 0;
  if (count === 0) return;
  reserve(device, batch, count);
  batch.staging.set(data);
  batch.buffer!.setData(batch.staging);
  batch.instance.instancingCount = count;
  // The component hands its own bounds to its mesh instances, so they are set here.
  batch.entity.render!.customAabb = boundsOf(data);
}

export function releaseMergedBatch(batch: MergedBatch) {
  batch.entity.destroy();
  batch.buffer?.destroy();
}
