# Art and scene pipeline (D18)

Status: **implemented as an offline build step**. Card `2409bc23-1cf7-4e2b-b285-7b9440bf411a`.
Code: [`tools/assets/`](../tools/assets/README.md).
Current evidence: [`reports/d18-rework.md`](reports/d18-rework.md) (§9 covers this redesign).
Original delivery history: [`reports/d18.md`](reports/d18.md).

This document describes how a fantasy illustration or map becomes data the app consumes, what is
measured and what is interpreted, and why the output is a sector map package rather than a 3D
model file.

## 0. Decision: a sector map package, not a GLB

Decided on 2026-10-20 in the review of PR #16, by the project owner.

**Context.** The first version of this pipeline exported a self-contained GLB: one box mesh per
building, a merged LOD1 mesh and a separate collision mesh. An architecture review found that
nothing in the app could use it:

- The engine never loads GLB. D11 builds the city procedurally, and D13 (PR #18) renders a map from
  a `MapDefinition`: a sector grid whose sectors hold `MapBuilding` records
  (`x, z, width, depth, height, rotation, roof, tone, stone`). It draws them with hardware
  instancing and its own building kit (walls, flat or gable roofs, facade textures), and streams
  detail per sector (`DetailLevel` 0 to 2).
- D04 models map content as `MapVersion` + `Chunk { map_version_id, origin, size_m, asset_uri }`,
  and names D18 for the chunk assets.
- D12 routes over a row-major `u32` cost buffer with `BLOCKED_CELL`. The GLB had no routing data,
  and the pipeline kept a second, private walkability grid.

**Measurements** (sample scene, 8 buildings):

| | GLB (removed) | Map package |
| --- | --- | --- |
| Bytes per building | about 3 KB of geometry (LOD0, LOD1 and collision, 1,000 B each) plus about 1 KB of node JSON | 182 B compact JSON including evidence, 93 B for the `MapBuilding` fields alone; 371 B as committed (indented) |
| Draw calls per building | one per building in LOD0 | none of its own: the engine instances every building of a roof tone in one draw call (D13 measured about 34 for Waterdeep's 13,607 lots) |
| Streaming | one scene | one chunk per sector |
| Appearance | flat boxes, own materials | the engine kit, consistent with the rest of the app |
| Routing | not included | `nav-costs.bin` for D12, 49,152 cells, 192 KiB raw, 436 B gzipped |

Extrapolated linearly to Waterdeep's 13,607 lots, the GLB route would weigh about 40 MB of
geometry and need one draw call per lot at full detail; the package needs about 2.5 MB of
compact JSON (5 MB indented) before compression.

**Decision.**

1. The pipeline output is a **map package**: `map.json` (D04 map version, D13 sector grid, one
   D04 `Chunk` per non-empty sector), `sectors/<index>.json` with D13 `MapBuilding` records plus
   per-building evidence, and `nav-costs.bin`, the D12 cost buffer.
2. The GLB exporter, the hand-written glTF writer and reader, materials, textures and the WebP
   decode path are **removed**. They only served the GLB.
3. Unique authored pieces (a landmark, a ship) may need a 3D model file later. That is a
   separate path, to be chosen by measuring `gltf-transform` or Blender on a real piece, not this
   pipeline's job today.

**Consequences.**

- The pipeline produces data the engine and the router already know how to use, and the city's
  look comes from one place: the engine kit.
- Three card acceptance items change meaning; §10 maps each one. Compressed textures are no
  longer produced here because materials are the engine kit's (`roof`, `tone`, `stone`). LOD is
  the engine's per-sector `DetailLevel`, fed by the same records. Collision for movement is the
  blocked cells of the cost grid.
- `MapBuilding` and `SectorGrid` are mirrored from D13, which is not on `main` yet. A test pins
  their exact keys. When D13 merges, import its types and add the 30-line adapter
  (`map.json` + sector files → `MapDefinition`) in D13's loader.

## 1. Scope

In scope: the manifest contract, the offline converter, the acceptance checks, one synthetic
sample, and this documentation.

Out of scope and untouched: `content/maps/waterdeep/` (D13), `src/lib/engine/` (D11/D13) and the
calibrated Waterdeep package (D05). This pipeline can consume a manifest derived from D05, but
never fabricates a city labelled Waterdeep. D13 already owns Waterdeep's scene content.

## 2. Stages

```text
illustration + calibration + places (JSON manifest, schema 2)
        │  validate: schema, map version, provenance, heights, style, budgets, no network
        ▼
metric scene: ground extent, building footprints with rotation, unknown places, fidelity tally
        │  sector grid, chunks, D12 cost grid
        ▼
map-<id>/map.json, sectors/<index>.json, nav-costs.bin   (staged in map-<id>.pending)
        │  read back from disk through map.json and its chunk URIs
        ▼
report.json: scale, fidelity, package, navigation, provenance  →  publish or quarantine
```

Every stage is a pure function except `src/io.ts` (manifest), `src/package-io.ts` (package),
`src/output.ts` (path containment) and `src/pipeline.ts` (staging, publish, quarantine). Nothing
fetches, renders or infers geometry.

## 3. Manifest contract (`desire.asset-scene/2`)

- `map_version`: `id` and `map_id` (lowercase UUIDs) and a positive u32 `revision`: the D04
  `MapVersion` the package belongs to.
- `calibration`: exactly D04's `Calibration`. `x` grows east, `z` south, and `y` is never derived
  from the raster. `rotation_radians` must be 0: the ground, sector grid and cost grid are
  axis-aligned. Building rotation is a separate, supported field.
- `sector_size_m`: square sector size, as in D13 (`SECTOR_SIZE_M = 250` for Waterdeep). At most
  65,536 sectors.
- `nav_cell_m` (default 1): cost-grid cell size. The grid must fit D12's 1,048,576-cell limit.
- `places[]`: pixel anchor, `footprint_m` (≤ 200 m per side), optional `rotation_radians`
  (|θ| ≤ π), height policy fields (§4), `style { roof: 0–4, tone: ≥ 0, stone: boolean }` and
  provenance tags.
- `spawn` and `waypoints`: plan-metre anchors inside the calibrated ground.

Validation is strict and reports every violation; a manifest with any error builds nothing.

## 4. Fidelity versus interpretation

| Height label | Required evidence | Meaning |
| --- | --- | --- |
| `verified` | `source_ref` | A source states the height |
| `interpretation` | `rationale` | Read from the illustration with an explicit argument |
| `synthetic` | `rationale` | Invented sample or placeholder data |
| `null` (absent) | — | Unknown. No building is emitted |

- An unknown height is never replaced by a default. The place stays in `places` with
  `height_known: false`, is listed in `unknown_places`, and is absent from buildings and blocked
  cells.
- Heights above 400 m are rejected.
- Every building record carries `place_id`, `height_evidence` and provenance tags, so the engine
  can show what is measured and what is interpreted without opening the manifest.
- An LLM may help a person read an illustration. It is not part of the build: a proposal becomes
  data only after a person writes `height_m` plus evidence into the manifest.

## 5. The map package (`desire.map-package/1`)

- **Sector grid**: D13's `SectorGrid` semantics. Origin at the ground's north-west corner,
  `columns = ceil(width / size)`, index `row * columns + column`. A building belongs to the
  sector containing its centre (a centre on the far edge stays in the last sector).
- **Chunks**: one D04 `Chunk` per non-empty sector: `origin` is the sector corner with `y_m: 0`,
  `size_m` the sector size, `asset_uri` `sectors/<index>.json`. Chunk ids are name-based UUIDs
  (v5, RFC 9562) of the map version id and `chunk:<index>`, so a rebuild keeps every id. The
  algorithm is checked against Python's `uuid.uuid5`.
- **Buildings**: D13 `MapBuilding` fields (`x`, `z` = footprint centre in plan metres; `width`,
  `depth`, `height`, `rotation`, `roof`, `tone`, `stone`) plus `place_id`, `height_evidence` and
  `provenance`.
- **Rotation** follows the engine: D13's `trs` uses PlayCanvas `setFromEulerAngles(0, θ, 0)`, so
  local +x (width) points to (cos θ, −sin θ) in plan and local +z (depth) to (sin θ, cos θ).

## 6. Navigation: the D12 cost grid

- `nav-costs.bin`: row-major `u32` little-endian, one value per cell: `1` free,
  `0xFFFFFFFF` (`BLOCKED_CELL`) blocked. `map.json` → `nav` carries origin, `cell_m`, width and
  height. This is exactly D12's `RoutingGrid` input. Cell `(column, row)` is D12's `(x, y)`.
- A cell is blocked when a building footprint overlaps it, by a separating-axis test between the
  rotated footprint and the cell. Edge contact does not block. A thin wall still blocks every
  cell it crosses, and a diagonal building leaves its bounding-box corners free.
- The budget is D12's `MAX_GRID_CELLS` (1,048,576), pinned by a test that reads the Rust
  constant. Waterdeep at 1 m would need about 25 million cells: a city-scale grid needs
  `nav_cell_m` of about 5 m or per-sector grids. D14 owns that choice when it routes on real maps.
- Costs are uniform. Terrain costs (roads cheaper, rough ground dearer) are a later manifest
  field, not inferred.

## 7. Acceptance checks (read back from disk)

The package is written to `map-<id>.pending`, read back through `map.json` and each chunk's
`asset_uri` exactly as a consumer would, then checked:

| Check | What it proves |
| --- | --- |
| `scale.checks` | Every reference distance recomputed from the pixel frame, unrounded, within tolerance |
| `fidelity.tally` | Every place counted once by height evidence |
| `package.buildings` | Every building written once, in the sector containing its centre, with the scene's numbers |
| `package.chunks` | One chunk per written sector, UUID ids, unique, aligned to the grid, URI matching its sector |
| `nav.costs` | Buffer matches its header and the D12 encoding; every cell any written footprint overlaps is blocked (recomputed from the written buildings, not from the scene) |
| `package.provenance` | Calibration provenance present, unknown places listed, no network |
| `navigation.waypoints` | Spawn free and every waypoint in the free component reached from it, walking the written cost grid |

`pass` is true only when every check passes. Then the pending directory replaces `map-<id>`.
Otherwise it is removed and any previously published `map-<id>` is renamed `map-<id>.stale`, so a
consumer cannot load the predecessor of a failed build. Output names are flat and
containment-checked, and symlinks are rejected before any write, rename or removal.

## 8. Tool evaluation

| Option | Verdict |
| --- | --- |
| Hand-written glTF/GLB writer | **Removed** with the GLB output (§0) |
| `@gltf-transform` / Blender | Not needed for data output. Revisit, measured on a real piece, if unique authored models are required |
| Splats (Gaussian) | Rejected: no collision or routing representation, no streaming budget, no metric scale from an illustration |
| TypeScript + `node:test`, no dependencies | **Chosen**: the package mirrors TypeScript engine contracts, and tests run in CI (`pnpm check:assets`, `pnpm test:assets`) |

## 9. Provenance, privacy and cost

- The manifest declares illustration provenance and license, and the map version records the
  calibration provenance. Building records carry their own evidence and provenance tags.
- `network_allowed: true` is rejected; the pipeline has no network code and no paid service.
- The sample illustration is synthetic; no third-party artwork is redistributed.

## 10. Acceptance mapping

| Card requirement | Evidence |
| --- | --- |
| Navigable sample scene | `navigation.waypoints` over the written D12 cost grid: spawn free, 3/3 waypoints, 97.1% of cells reached |
| Separate collision | The cost grid is separate from render data; `nav.costs` recomputes coverage from the written footprints |
| Validated scale | `scale.checks` recomputes a 224 m reference from the pixel frame |
| Compressed materials/textures | **Changed by decision §0**: materials are the engine kit's; a building carries style indices only. No textures are produced or shipped |
| LOD | **Changed by decision §0**: the engine's per-sector `DetailLevel` 0–2 renders the same records |
| Recorded provenance | Map version calibration provenance, per-building evidence and tags, report `provenance` |
| Fidelity versus interpretation | `height_evidence` per building, `unknown_places`, `height_known`, `fidelity.tally` |
| Inference outside the interactive loop | Build step only; no model is called; no runtime code touched |
| Splats only if measured | Documented rejection (§8) |
| Tools evaluated on a small sample | §0 measurements and §8 |

## 11. Limits and debt

- `MapBuilding` and `SectorGrid` are copies of D13 types until D13 merges; the adapter to
  `MapDefinition` is not written yet.
- Footprints are rectangles. Arbitrary silhouettes would need a polygon field in D13's contract
  first.
- The sample is synthetic. No real illustration has gone through the pipeline, and D05 records no
  heights or footprints, so a D05-derived manifest would produce places only.
- City-scale routing needs a coarser `nav_cell_m` or per-sector grids (§6).
- Costs are uniform; no terrain cost model yet.
- Output is single-writer. Publishing removes the old directory and then renames the new one,
  so a reader can briefly see neither.
