# Plan: the whole city in sectors, built by a Rust pipeline

Status: **plan**, agreed with the project owner on 2026-10-21. Nothing here is implemented yet.
It extends D18's map package (`docs/asset-pipeline.md` §0 and §5) and does not replace it.

## 1. Why

The Dock Ward slice (1,065 houses, 0.28 km²) runs at 120 fps on a 120 Hz display. A stress run
that tiles it over a city-sized area (`?stress=5x4`, about 21,000 houses) keeps about 1 ms of CPU
per frame and 139 draw calls. What does not scale is how the city is **built and loaded**:

- The slice is monolithic: one terrain mesh, one albedo texture, one `houses.json`, global
  instanced batches. Nothing can be culled per area, detailed per distance or streamed. The whole
  city's albedo (6319 × 9136 px) does not fit a single WebGPU texture (8192 max).
- How a house looks depends on its index in the global array (`planHouse` seed, global k-means
  roof palette, `everyNth` lanterns). A house loaded in a different set would change.
- The asset pipeline (TypeScript, `tools/assets`) takes about 100 s and needs
  `--max-old-space-size=12288` on the full map. The performance audit (2026-10-21) traced most of
  that to JS patterns, not to the algorithms: a `Map` per pixel in `majority` (35 s → 2.4 s when
  rewritten, identical output), about twelve `TypedArray.from(src, mapper)` copies (4.3 s and
  +1.4 GB heap each, 94 ms as a loop), `erode` 12.6 s → 0.8 s.

### What Rust is for, and what it is not for

Measured by the audit with the corrected algorithms: `majority` 2.37 s in JS vs 1.71 s in native
Rust, `shoreDistance` 0.57 s vs 0.62 s. Wasm usually runs at 1.1–1.5× native, so **Wasm in the
browser would not make the same loops faster**, and rendering does not move at all: WebGPU is
reached through JavaScript from any language, and the GPU does the drawing.

Rust earns its place for other reasons:

1. **A native, parallel offline pipeline.** Rayon over row bands uses every core, so we estimate
   4–8× on an 11-core machine (an estimate, to be measured). Strict types fit a long pipeline
   whose output is a contract.
2. **One implementation for both sides.** The sector format, ids, seeds and LOD decisions live in
   `crates/core`. The pipeline uses them natively. If the browser ever needs the same logic (for
   example, building a detail level from a coarse sector), the same code compiles to Wasm, as D12
   routing already does.

The renderer stays in PlayCanvas and TypeScript.

## 2. Target architecture

```
source raster + Tych vectors  ──►  pipeline (Rust, native, rayon)  ──►  map package /2
                                                                           │
                         browser: Worker (fetch + decode, transferable)  ◄─┘
                                        │
                         main thread: upload buffers, instance, cull, LOD (PlayCanvas)
```

### Map package `/2`: sectors that carry their render payload

D18's `/1` stays the canonical record for D13 and D12: `map.json` (map version, sector grid, one
D04 `Chunk` per non-empty sector), `sectors/<index>.json` with `MapBuilding` records, and
`nav-costs.bin`. Version `/2` adds, per sector:

| File | Content | Note |
| --- | --- | --- |
| `sectors/<index>.render.bin` | Little-endian, versioned header plus sections: houses, chimneys, lanterns, berths and trees | Typed and fixed-stride, so the Worker hands the buffers on without parsing |
| `sectors/<index>.ground.bin` | Height cells (f16) with one shared row and column at each edge, so neighbouring tiles join without cracks | 1.87 m cells as today |
| `sectors/<index>.albedo.webp` | Ground albedo tile, 1024² (about 480 m) | Within any GPU texture limit; mipmapped on upload |

A house record holds a **stable id** (block id plus lot index, hashed), its footprint, the plan
fields that today come from `planHouse` (storeys, jetty, roof type, stone, dormer, chimney) and a
**roof tone index into a city-wide palette computed offline**. Seeds derive from the id, never
from an array index. The same record therefore renders the same way in any sector set, at any
LOD.

The sector size is the open choice for M1. Candidates are 240 m and 480 m, matching the albedo
tile. Measure houses and bytes per sector on the real map before fixing it.

### Browser side

- **Worker loader**: keeps the sectors near the camera and their neighbours, fetches and decodes
  them, and transfers `Float32Array`/`Uint32Array` instance data to the main thread.
- **Per-sector batches** by part and material, each with its own bounds, so frustum culling and
  the shadow fit work per sector. The bounds fix from 2026-10-21 already makes that correct.
- **Detail by distance, per sector**:
  - **LOD0**: today's houses with storeys, jetties, dormers, chimneys and lanterns.
  - **LOD1**: one box and one roof per house.
  - **LOD2**: one extruded block per city block, with its mean height and roof tone.
  Shadows, smoke, halos and ships come from LOD0 sectors only.
- **Ambience on the GPU** (vertex shaders): smoke age and billboard, lantern halos and the sea
  swell. This is planned before this pipeline and is independent of it.

## 3. Crates

| Crate | Role | New dependencies (need approval) |
| --- | --- | --- |
| `crates/core` (exists) | Pure, `no_std`-friendly types: sector grid, stable ids, house plan, render-bin layout and its reader/writer | none |
| `crates/atlas` (new, native binary) | The pipeline: classify, refine, blocks, lots, features, ground tiles, writing the package | `image` (PNG/WebP), `rayon`; `serde_json` is already used in tests |
| `crates/wasm` (exists) | Exports only what the browser must share (render-bin reader, LOD from coarse data), if measurement asks for it | none beyond `wasm-bindgen` |

Building `crates/wasm` needs `wasm-pack` and the `wasm32-unknown-unknown` target, which this
machine lacks today. `crates/atlas` does not need them.

## 4. Milestones

Each milestone ends with the usual gate: km, tests, anti-tamper, the independent advisor, and a
measurement compared with the previous state on the same input.

| | Goal | Acceptance |
| --- | --- | --- |
| **M0** | Quick fixes in the TS pipeline from the audit (`majority`, `from` copies, `erode`/`dilate`, `paintAlbedo` noise) | Byte-identical `classes.bin` and slice outputs; full-map time and peak heap measured |
| **M1** | Write the format: `render.bin` and ground tile layout in `crates/core`, with a TS reader and round-trip tests on both sides; choose the sector size from real counts | One sector of the Dock Ward written by TS and read back in the viewer, same image as today |
| **M2** | `crates/atlas` ports the stages in order (classify → refine → blocks → lots → features → tiles). Each stage gets a **parity test** against the TS output on the same input | Parity per stage (identical rasters; equal polygons and lots within a stated tolerance); time per stage, native vs TS |
| **M3** | Viewer streams sectors through a Worker; per-sector batches and culling | The Dock Ward cut into sectors looks identical; hitches while panning measured with `?hud` |
| **M4** | LOD1/LOD2 and the distance policy | The whole map loaded; frame time, memory and dropped frames at city, ward and street zoom on the owner's display |
| **M5** | Retire the TS pipeline stages that Rust replaced | Docs updated; one pipeline |

Order note: M0 is cheap and shortens every later parity run, so it goes first even though Rust
replaces those stages at M2.

## 5. Risks and open questions

- **Parity of vector stages.** Douglas–Peucker, edge tracing and the lot placement are
  order-sensitive. Fix a deterministic order in both implementations, compare with tolerances,
  and keep the TS version as the reference until M5.
- **New dependencies.** `image` and `rayon` add to `Cargo.lock`. The workspace's merge policy
  asks for human approval of dependency changes.
- **Source licence.** Personal, non-commercial use. Rasters and derived packages stay under
  ignored `outputs/` and are never redistributed. Only code and attributed, derived layers enter
  the repository.
- **D04/D05 rescale.** The world scale is Tych's. The map version revision scaled by 1 / 1.84
  should land before sector ids are published, so ids are not minted twice.
- **Wasm in the browser** is out of scope until a measured hot spot remains after the Worker
  move (M3).
