# Interior models (D33)

Builds the Trollskull Manor GLBs in `public/models/trollskull/` from the floor plan data. The data
is the source of truth: change `content/maps/waterdeep/trollskull/floor-plan.json`,
`content/props/catalog.json` or `tools/interior/prop-parts.json`, then rebuild.

## Rebuild

Needs Blender 5.2 (`/Applications/Blender.app`) and Node 24.

```sh
mkdir -p .local/interior
node tools/interior/derive.ts .local/interior/scene.json
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/interior/build.py -- \
  .local/interior/scene.json public/models/trollskull .local/interior/trollskull.blend
node --test tests/interior-model.test.ts tests/interior-glb.test.ts
```

`derive.ts` validates the plan first and refuses to write anything if it has problems. The build
writes `manifest.json` with the sha256 of everything it was given. CI does not need Blender:
`tests/interior-glb.test.ts` fails when the plan, the catalogue or `prop-parts.json` changed without
a rebuild, when a model is missing, when a cylinder faces inward, or when the size budget is exceeded.

## What gets built

| File | Contents |
| --- | --- |
| `<floor id>.glb` | One model per floor: `suelos`, `muros`, `vanos` (door lintels, window sills and lintels), `vidrios`, `escaleras`, merged per category |
| `tobogan.glb` | The slide: a U-shaped trough swept along its path, and its posts |
| `props/<kind>.glb` | One low-poly model per catalogue kind, placed by the engine from the plan |

Furniture parts with material `variant` are tinted at runtime with the catalogue variant colour,
so recolouring a piece needs no new model. Every part is described in `prop-parts.json`: `x`, `z`,
`w` and `d` are fractions of the footprint, `y`, `h` and `r` are metres.

The geometry is computed in TypeScript (`src/`, tested by `tests/interior-model.test.ts`).
`build.py` only turns those primitives into Blender meshes and exports them, because Blender's API
is Python.

## Editing by hand in Blender

Open `.local/interior/trollskull.blend` (not in git). Everything under the `Generado` collection is
replaced on every build. To add a hand-made piece to a floor, put it in a collection named
`Manual/<floor id>` inside a top-level `Manual` collection. The build keeps it and exports it with
that floor.

## Known limits

- The turret is drawn square; its octagonal chamfers come later.
- There are no roofs or ceilings: the interior scene shows one floor at a time from above.
- No baked ambient occlusion yet; the engine adds SSAO on the high quality setting.
- Stairs fit their whole flight inside one square, so they are steep (about 63°). They read as
  stairs from above; a longer flight needs a two-square stair in the plan.
