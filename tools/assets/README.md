# Asset pipeline (D18)

Offline TypeScript converter from calibrated illustration manifests to **map packages**: sector
data for the engine (D13 `MapBuilding` records, D04 chunks) and a cost grid for the router (D12).
No inference, network access, npm dependencies or runtime changes. Needs Node 24 (`.nvmrc`) for
native type stripping.

Design and the decision to drop the GLB output: [`docs/asset-pipeline.md`](../../docs/asset-pipeline.md).
Evidence: [`docs/reports/d18-rework.md`](../../docs/reports/d18-rework.md).

## Commands

```sh
pnpm check:assets   # strict tsc over sources, CLI and tests
pnpm test:assets    # node --test "tools/assets/tests/*.test.ts"; both run in CI (frontend-check)

# Build beside the source manifest, or into --out
node tools/assets/asset-pipeline.ts --manifest tools/assets/samples/sample-harbor/asset.json
node tools/assets/asset-pipeline.ts --manifest <asset.json> --out /tmp/maps

# Coverage
node --test --experimental-test-coverage "tools/assets/tests/*.test.ts"

# Quality metrics (kimün 0.26.0; the project gate is python3 tools/quality/gate.py --root .)
km score tools/assets
km dups tools/assets --exclude-ext json
```

Exit `0` means every acceptance check passed; exit `2` means failure, with `FAIL <check>` lines
on stderr. `report.json` is written in both cases.

## Output

```text
<out>/report.json
<out>/map-<id>/map.json             D04 map version, D13 sector grid, chunks, places, nav header
<out>/map-<id>/sectors/<index>.json  MapBuilding records + place_id, height_evidence, provenance
<out>/map-<id>/nav-costs.bin         row-major u32 LE: 1 free, 0xFFFFFFFF blocked (D12)
```

Builds stage `map-<id>.pending`, read it back through `map.json` and each chunk URI, and publish
only when every check passes. A failed rebuild, including a manifest validation failure,
renames the previous `map-<id>` to `map-<id>.stale`. Unsafe or missing ids never select a
directory. Output names are containment-checked and symlinks are rejected. One writer per
output directory.

## Consumer contract

- **Engine (D13).** Read `map.json`, then the chunk files you need. `grid` is a D13
  `SectorGrid`, each building a D13 `MapBuilding` (extra evidence fields can be ignored or shown).
  `rotation` uses the engine's convention. Places without a known height are listed with
  `height_known: false` and have no building.
- **Router (D12).** Build a `RoutingGrid(nav.width, nav.height, costs)` from `nav-costs.bin`.
  Cell `(column, row)` is D12's `(x, y)`; convert plan metres with `nav.origin_*` and `nav.cell_m`.
- **Catalog (D04).** `chunks[]` are D04 `Chunk` records of `map_version.id`, with stable UUIDs.

## Adding a map

1. Copy `samples/sample-harbor/asset.json` (schema `desire.asset-scene/2`). Set a filename-safe
   `id`, the D04 `map_version` (UUIDs and revision), label, license and provenance.
2. Use D04 calibration fields; calibration rotation stays 0. Building rotation goes in each
   place's `rotation_radians`.
3. Declare heights only with evidence: `verified` needs `source_ref`; `interpretation` and
   `synthetic` need a `rationale`. Unknown heights stay `null` and produce no building.
4. Give each place a `style` from the engine kit: `roof` 0–4, `tone` ≥ 0, `stone` true or false.
5. Pick `sector_size_m` (Waterdeep uses 250) and a `nav_cell_m` that keeps the grid within
   1,048,576 cells.
6. Run the converter and fix every failing check.

The sample is synthetic, not Waterdeep. Waterdeep's scene content is D13's.

## Layout

| File | Role |
| --- | --- |
| `src/types.ts`, `src/map-types.ts` | Manifest contract; package contract (D13/D04/D12 shapes) |
| `src/manifest.ts`, `src/map-manifest.ts`, `src/heights.ts`, `src/values.ts` | Validation of untrusted JSON |
| `src/calibration.ts`, `src/scene.ts` | D04 transform and the metric scene |
| `src/footprint.ts`, `src/nav.ts` | Rotated footprints, cost grid, reachability walk |
| `src/package.ts` | Sector grid, chunks and buildings (pure) |
| `src/package-io.ts`, `src/io.ts`, `src/output.ts` | The only file access, with containment |
| `src/package-check.ts`, `src/check.ts` | Acceptance checks over the package read back from disk |
| `src/pipeline.ts`, `asset-pipeline.ts` | Staging, publish, quarantine; CLI |

Preflight limits: 1024 places, 1024 waypoints, 65,536 sectors, 1,048,576 navigation cells
(D12's limit, pinned by a test against the Rust constant), footprints ≤ 200 m, heights ≤ 400 m.
