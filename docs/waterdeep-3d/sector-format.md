# Sector render payload: `desire.sector-render/1`

Status: **contract**, M1 of [rust-chunk-pipeline.md](rust-chunk-pipeline.md). One file per sector,
`sectors/<index>.render.bin`, next to D18's `sectors/<index>.json`. It carries what the diorama
draws, in a typed layout a Worker can hand to the GPU without parsing. Implementations:
`crates/core/src/sector` (Rust, reads and writes) and `src/lib/map/sector-format.ts` (TypeScript,
reads and writes). Both are tested against the same fixture, `crates/core/tests/fixtures/sector-v1.bin`.

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

## Layout

All values are **little-endian**. Offsets count from the start of the file. Every section starts
on a multiple of 4 bytes.

### Header (32 bytes)

| Offset | Type | Field |
| --- | --- | --- |
| 0 | `u8[4]` | magic `DSEC` |
| 4 | `u16` | version, `1` |
| 6 | `u16` | section count |
| 8 | `u32` | sector index |
| 12 | `f32` | origin x, map metres (sector's north-west corner) |
| 16 | `f32` | origin z, map metres |
| 20 | `f32` | sector size, metres |
| 24 | `u32` | reserved, `0` |
| 28 | `u32` | reserved, `0` |

### Section table (16 bytes per section, from offset 32)

| Offset | Type | Field |
| --- | --- | --- |
| 0 | `u32` | kind |
| 4 | `u32` | record count |
| 8 | `u32` | record stride, bytes |
| 12 | `u32` | offset of the first record |

### Records

Coordinates are **map metres** (absolute, x east and z south from the map's north-west corner). An
`f32` keeps about 0.5 mm at 4.3 km. Rotation follows the engine: `setFromEulerAngles(0, θ, 0)`.

**Kind 1, houses** (stride 32):

| Offset | Type | Field |
| --- | --- | --- |
| 0 | `u32` | id: block index × 4096 + lot index (see below) |
| 4 | `f32` | centre x |
| 8 | `f32` | centre z |
| 12 | `f32` | width (local x) |
| 16 | `f32` | depth (local z) |
| 20 | `f32` | rotation, radians |
| 24 | `f32` | eave height, metres |
| 28 | `u8[3]` | roof colour sampled from the map, RGB |
| 31 | `u8` | flags: bit 0 = faces a street |

**Kind 2, berths** (stride 12): `f32` x, `f32` z, `f32` heading (radians, keel along local +Z).

**Kind 3, trees** (stride 12): `f32` x, `f32` z, `f32` scale.

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
