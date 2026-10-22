// Frees what an entity tree put on the GPU: instance buffers, materials and the textures those
// materials own. Meshes go with their entities. Textures in `shared` (the stage's painted set)
// stay, since other entities draw with them.

import type * as pc from 'playcanvas';

const TEXTURE_SLOTS = ['diffuseMap', 'opacityMap', 'emissiveMap'] as const;

export function releaseGpu(root: pc.Entity, shared: Set<pc.Texture>) {
  const renders = root.findComponents('render') as pc.RenderComponent[];
  const instances = renders.flatMap((render) => render.meshInstances);
  const buffers = new Set(instances.map((instance) => instance.instancingData?.vertexBuffer));
  const materials = new Set(instances.map((instance) => instance.material as pc.StandardMaterial));
  const textures = new Set([...materials].flatMap((material) =>
    TEXTURE_SLOTS.map((slot) => material[slot])));
  root.destroy();
  buffers.forEach((buffer) => buffer?.destroy());
  materials.forEach((material) => material.destroy());
  textures.forEach((texture) => texture && !shared.has(texture) && texture.destroy());
}
