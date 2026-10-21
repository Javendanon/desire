# Asset pipeline (D18)

Offline TypeScript converter from calibrated illustration manifests to navigable `.glb` assets.
No inference, network access, new npm dependencies, or runtime viewer changes. Uses the installed
TypeScript compiler, Node's native type stripping (Node 22.13+ or 24+), and local `dwebp`
(libwebp 1.6.0 tested) to decode images before publication. A missing decoder fails the build.

Design: [`docs/asset-pipeline.md`](../../docs/asset-pipeline.md).
Rework evidence: [`docs/reports/d18-rework.md`](../../docs/reports/d18-rework.md).

## Commands

```sh
# Strict type checking, including the CLI (no changes to shared package manifests)
pnpm exec tsc -p tools/assets/tsconfig.json

# Build beside the source manifest
node --experimental-strip-types tools/assets/asset-pipeline.ts \
  --manifest tools/assets/samples/sample-harbor/asset.json

# Portable output: geometry AND compressed images are embedded in the GLB
node --experimental-strip-types tools/assets/asset-pipeline.ts \
  --manifest tools/assets/samples/sample-harbor/asset.json --out /tmp/asset-out

# Regression tests; JS deliberately permits malformed input fixtures
pnpm test:assets   # or: node --test --experimental-test-coverage "tools/assets/tests/*.test.ts"

# Quality metrics (kimun 0.26.0; tests excluded by its default filter)
km score tools/assets
km smells tools/assets --max-lines 40 --max-params 4
km smells tools/assets --max-lines 25 --max-params 3
km cycom tools/assets --per-function
km cogcom tools/assets --per-function
km dups tools/assets --exclude-ext json
```

Exit `0` means all acceptance checks passed; exit `2` means failure. Filesystem errors such as
unsafe symlinks fail explicitly. Builds stage `scene-<id>.glb.pending` and publish only after
checks pass. A failed rebuild, including manifest validation failure, quarantines a previous
artifact of the same safe ID as `scene-<id>.glb.stale`. Unsafe/missing IDs cannot select a prior
artifact; their reports fail without touching an arbitrary asset. Output directories must be
owned by the caller and not modified concurrently by another writer.

## Consumer contract

- Load the glTF default scene (`scene: 0`) for **ground and LOD0 only**.
- The auxiliary scene `lod1` selects ground and a merged mesh with material-grouped primitives.
  Switch scenes, do not append it to LOD0. It reduces draw calls, not triangles.
- The auxiliary scene `collision` contains collision geometry only. Do not render it; absence
  of a material does **not** make it invisible. Physics reads it separately.
- Images are embedded buffer views with actual `baseColorTexture` bindings and `TEXCOORD_0`.
  Consumers must support the required `EXT_texture_webp` extension; there is no fallback image.
  KTX2 is rejected until a genuine BasisU encoder/decoder fixture is verified. UVs are normalized per quad: placeholder tiling, not recovered
  illustration detail. Image extras and report entries include `width_px` / `height_px`.
- GLB and `report.json` are the output package; no source manifest or texture sidecars are
  needed at load time. Keep the source manifest as the authoring record. The report names the
  artifact by file name (no absolute path), so a committed report reproduces on any machine;
  `tests/review-regressions.test.ts` rebuilds the sample and compares the whole report.

## Adding an asset

1. Copy `samples/sample-harbor/asset.json`. Set a filename-safe `id` (1–64 ASCII letters,
   digits, `_`, `-`, starting with a letter or digit), label, license and provenance.
2. Use D04 calibration fields. Nonzero origins shift ground and anchors together; rotation
   must remain zero until ground, collision and navigation support it together.
3. Declare heights only with cited evidence: `verified` needs `source_ref`, interpretation
   and synthetic data need a rationale. Unknown heights remain absent from solid geometry.
4. Keep WebP images next to the source manifest under relative paths. Resolved symlinks must
   also remain inside that directory. Declare the byte budget and integer `width_px` /
   `height_px`; dimensions must match and `dwebp` must decode the exact exported bytes.
5. Run the converter and fix every failing acceptance check before shipping.

The sample is synthetic, not Waterdeep. Calibrated Waterdeep content stays under D05/D13.

## Layout and checks

`src/types.ts` defines authored data; `src/gltf-types.ts` defines the emitted glTF subset.
`manifest.ts` / `surface-manifest.ts` / `heights.ts` validate untrusted JSON; `calibration.ts` / `scene.ts` create metric
layout; `geometry.ts` / `glb.ts` export it. `gltf-read.ts` reads back the artifact; `check.ts`,
`textures.ts` and `nav.ts` check scale, provenance, texture budgets/dimensions, collision coverage,
default render selection and every waypoint's membership in the reached free grid component.
`output.ts` contains path/symlink guards; `pipeline.ts` stages, validates and publishes artifacts.

Preflight limits: 1024 places, 256 materials, 64 textures, 1024 waypoints, 1,000,000 grid cells,
256 KiB per image, 16 MiB total compressed images, and 4096×4096 pixels per image. The decoder
writes a temporary PNG (never a piped stdout) and has a five-second timeout; the decoded header
must match the declared resolution. Larger assets require measured chunking, not silent
allocation.

The local checks do not replace an external glTF validator or D11 browser/physics integration.
The sample exercises decoded WebP. KTX2/BasisU is explicitly unsupported. See the rework report for coverage,
review findings and remaining integration blockers.
