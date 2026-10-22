# Sector render payload: `desire.sector-render/1`

Status: **contract**, M1 of [rust-chunk-pipeline.md](rust-chunk-pipeline.md). One file per sector,
`sectors/<index>.render.bin`, next to D18's `sectors/<index>.json`. It carries what the diorama
draws, in a typed layout a Worker can hand to the GPU without parsing.

**The normative layout is [`contracts/sector-render.json`](../../contracts/sector-render.json)**:
every field with its offset, type and constraint, and the example the fixture is made from. This
document explains the choices. `tools/contracts/sector.py` derives everything else from the
contract, so nothing restates offsets by hand:

| Command | Effect |
| --- | --- |
| `python3 tools/contracts/sector.py` | Writes `crates/core/src/sector/layout.rs`, `src/generated/sector-layout.ts` and the fixture `crates/core/tests/fixtures/sector-v1.bin` |
| `python3 tools/contracts/sector.py --check` | Fails when a generated file has drifted from the contract |
| `python3 tools/contracts/sector.py --validate <files>` | Checks payloads against every constraint (structure, finite values, positive sizes, zero reserved fields, known flag bits) |

The implementations, `crates/core/src/sector` (Rust) and `src/lib/map/sector-format.ts`
(TypeScript), use only the generated constants. Each must write the fixture byte for byte and
read it back. The fixture still equals the payload first written from this document's prose
(commit 71d5eda).

## Sector grid

The sector is a square of **1024 × 1024 source pixels**, about 479.6 m at z18 (0.4684 m/px), so a
sector's ground albedo is exactly one 1024² tile cut from the raster. Waterdeep's map is 7 × 9
sectors, and 29 of them hold houses. The grid follows D18 §5: the origin is the map's north-west
corner, `index = row * columns + column`, and a feature belongs to the sector that contains its
point.

Measured on the full map (13,919 houses) when choosing the size:

| Size | Grid | Sectors with houses | Houses per sector (median / p95 / max) | Sectors in a 600 m view |
| --- | --- | --- | --- | --- |
| 240 m | 13 × 18 | 82 | 172 / 321 / 373 | about 16 |
| **480 m** | 7 × 9 | 29 | 366 / 1087 / 1327 | about 9 |
| 960 m | 4 × 5 | 12 | 627 / 2821 / 4453 | about 4 |

At about 15 instanced batches per sector, 240 m would cost about 1,200 draw calls for the whole
city before LOD. 960 m would cull and stream too coarsely.

## Layout, in short

- A 32-byte header: magic `DSEC`, version, section count, sector index, origin and size in map
  metres, and two reserved words.
- A table of 16-byte entries, one per section: kind, record count, record stride and offset.
- Fixed-stride records, every section 4-byte aligned, all values little-endian. Coordinates are
  absolute map metres in `f32` (about 0.5 mm at 4.3 km). Rotation follows the engine:
  `setFromEulerAngles(0, θ, 0)`.
- Kinds: **1 houses** (32 B: id, centre, footprint, rotation, eave height, roof RGB, flags),
  **2 berths** (12 B: position, keel heading), **3 trees** (12 B: position, scale).

## Compatibility rules

- Readers reject the wrong magic, an unknown **major** version, a truncated header or table, and
  any section that overflows the file or is misaligned.
- Readers **skip unknown kinds** and accept a **larger stride** than they know, reading only
  the fields they know. A writer can add a field at the end of a record, or a new section,
  without breaking older readers.
- Writers emit sections in kind order, with known strides, and zero the reserved fields.

## Limits of version 1

- The house id is stable for a given source raster and pipeline version: blocks are numbered in
  trace order. A source change can renumber blocks. Ids that survive source edits (for example,
  keyed by D13 `place_id`) are a later decision, together with moving the house plan and roof tone
  offline (rust-chunk-pipeline.md §2).
- The house plan (storeys, roof type and the rest) and the roof tone are still derived by the
  viewer, as today. A later minor version adds them as fields at the end of the house record.

## Ground tiles: `desire.ground-tiles/1`

The terrain under the sectors, written by `atlas ground <classes> <map-width> <metres-per-pixel>
<out-dir>` (`crates/atlas/src/{ground,tiles}.rs`). Tiles follow the sector grid: tile `index`
covers the same 1024 × 1024 source pixels as sector `index` (partial at the map's right and
bottom edges). Every grid tile is written, sea included.

| File | Content |
| --- | --- |
| `ground.json` | `format`, `tile_px` (1024), `cell_px` (4), `metres_per_pixel`, grid `columns` and `rows`, and per tile its `width_px`, `height_px`, `cells_x`, `cells_y` |
| `<index>.jpg` | The tile's albedo, quality 85, one texel per source pixel |
| `<index>.heights.bin` | Vertex heights, `i16` little-endian centimetres above the water plane, row-major, `(cells_x + 1) × (cells_y + 1)` |

- **Vertices sit at cell centres.** Vertex `(i, j)` of tile `index` is the centre of map cell
  `(column + i, row + j)`, where `column` and `row` are the tile's first cell. A tile carries one
  extra vertex column and row taken from its right and lower neighbour, so meshes of
  neighbouring tiles share their edge vertices and close with no seam. At the map's edge the
  last cell repeats.
- **Seamless by construction.** The albedo noise uses map-wide pixel coordinates, and the heights
  are smoothed (two 3 × 3 box passes) over the whole map before cutting. No tile edge shows in
  the colour or the relief.
- **Albedo vs heights.** The albedo is painted from the classes (palette, value noise, shallows
  and foam within 40 px of the shore). It never copies the source artwork's pixels. Heights take
  the majority surface of each 4-px cell: seabed −2.5 m, pier 0.8 m, land 1 m.
- Whole Waterdeep map: 63 tiles, about 14 MB, written in 0.8 s.
