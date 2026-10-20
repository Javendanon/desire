# Asset pipeline (D18)

Offline pipeline that turns a calibrated illustration manifest into a navigable `.glb` scene
plus an acceptance report. It runs as a build step, never inside the interactive table, and it
has no dependencies: Node standard library only.

Design and decisions: [`docs/asset-pipeline.md`](../../docs/asset-pipeline.md).
Delivery report: [`docs/reports/d18.md`](../../docs/reports/d18.md).

## Commands

```sh
# Build the scene and its report (writes scene-<id>.glb and report.json)
node tools/assets/asset-pipeline.js --manifest tools/assets/samples/sample-harbor/asset.json

# Build somewhere else (input textures still resolve next to the manifest)
node tools/assets/asset-pipeline.js \
  --manifest tools/assets/samples/sample-harbor/asset.json --out /tmp/asset-out

# Unit and end-to-end tests
node --test tools/assets/tests/*.test.js

# Quality gate for this scope (kimün 0.26.0)
km score tools/assets
km smells tools/assets --max-lines 25 --max-params 3
km cycom tools/assets --per-function
km cogcom tools/assets --per-function
km dups tools/assets --exclude-ext json
```

Exit code is `0` only when every acceptance check passes, `2` otherwise. The report is written
even when the build fails, so the failure is auditable. A failing build leaves no `.glb` next
to the report: the artifact is staged as `scene-<id>.glb.pending` and only renamed into place
when every check passes.

## Layout

| Path | Role |
| --- | --- |
| `asset-pipeline.js` | CLI: `--manifest`, optional `--out` |
| `src/io.js` | Reads and validates the manifest |
| `src/manifest.js` | Pure manifest validation (schema, provenance, heights, textures) |
| `src/calibration.js` | D04 pixel-to-meter transform and scale checks |
| `src/scene.js` | Metric scene: solids, unknown places, fidelity tally |
| `src/geometry.js` | Flat-shaded boxes and ground quad |
| `src/glb.js` | glTF 2.0 binary writer: render LODs plus separated collision |
| `src/gltf-read.js` | Reads the artifact back for checks |
| `src/nav.js` | Conservative walkability (grid flood fill) |
| `src/textures.js` | Reads textures: magic bytes and byte budgets |
| `src/check.js` | Acceptance findings and report |
| `src/pipeline.js` | Orchestration: validate, build, write, check |
| `samples/sample-harbor/` | Input manifest, texture, generated `.glb` and report |
| `tests/` | 32 tests across 7 files, `node --test` |

## Adding an asset

1. Copy `samples/sample-harbor/asset.json` and edit `id`, `label`, illustration provenance,
   `calibration` and place anchors. Calibration fields match D04's `Calibration`.
2. Declare a `height_m` **only** from a source you can cite. Use `verified` with a
   `source_ref`, `interpretation`/`synthetic` with a `rationale`, or `null` to leave the
   height unknown. Unknown places stay out of the solid geometry and are listed in the report.
3. Keep textures compressed (`image/webp` or `image/ktx2`) and inside `max_bytes`.
4. Run the CLI. Fix every failing check before shipping the artifact.

Never rename a generated scene to Waterdeep: the calibrated Waterdeep package is D05 and the
runtime scene is D13.

## What the checks prove

`scale.checks` recomputes declared reference distances from the calibration; `fidelity.tally`
counts verified, interpreted, synthetic and unknown heights; `collision.*` proves the collision
node exists, has no material and that every solid footprint lies inside a collision quad;
`lod.levels` proves LOD nodes exist; `artifact.accessors` proves every vertex attribute count is
an integer matching POSITION; `artifact.embedded` proves the buffer is embedded and no image is
downloaded; `textures.compressed` reads magic bytes and byte budgets; `navigation.waypoints`
floods the ground from the spawn and requires at least one declared waypoint to be reachable.

The checks inspect the written `.glb`, not the in-memory plan.
