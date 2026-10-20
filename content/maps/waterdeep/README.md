# Waterdeep runtime content and scene (D13)

This package turns the calibrated D05 reference into a navigable 3D Waterdeep. The reference is
read-only input: this package never edits `docs/maps/waterdeep/`, never downloads the raster, and
never stores map artwork.

Two kinds of data live here, kept apart on purpose:

| Kind | Source | Where |
| --- | --- | --- |
| Geography | D05 plan metres: coast control points, ward boxes and centroids, 20 control points, 10 places, 7 street label anchors | `reference.ts`, `bounds.ts`, `zones.ts`, `coast.ts`, `plan.ts` |
| Street pilot | Raster-traced Market approaches and open-square interior, with interpreted widths | `streets.ts`, [comparison](../../../docs/reports/d13-street-comparison.md) |
| Facades | D13 interpretation: lot grid, density, footprint, height, roof tone | `buildings.ts`, `zones.ts` profiles |

Every building carries `heightSource: 'interpreted'`. D05 records no building heights, so no height
is presented as measured. The shoreline and the harbour basin in `coast.ts` are an explicitly
labelled visual reading, not a vector coastline.

## What is in the scene

- The whole map in D04 metres: 3560 x 7256 px at `0.983225806451613` m/px.
- 435 sectors of 250 m; 13,607 generated lots in 8 ward zones.
- 10 places with a D04 `Place` record and one `PlaceAnchor` each (`waterdeepPlaces()`).
- 20 D05 control-point markers and 7 street label anchors, off by default in the demo.
- A far shell with every lot at low detail (one instanced batch per roof tone) and streamed
  walls and roofs around the focus. Maximum detail is limited to 20 sectors; the rest of the city
  is never drawn at that level.

Ward boxes are calibration aids, not legal boundaries. Lots are assigned to the ward whose centre
is nearest among the boxes that contain the point, so overlapping boxes do not double-build. Street
anchors are points, not polylines: the scene never invents a street graph from them. Three Market
approaches are traced separately from the raster and reserve their full width plus roof clearance.
The Market square stays open. This is a small pilot, not a reconstructed full-city road network.

## Places and the catalog

`waterdeepPlaces()` returns D04 records with fixed UUID ids (`d1300000-...`), one anchor on
`WATERDEEP_MAP_ID`, `provenance.evidence: 'interpretation'` and `y_m: 0` (the source stores no
elevation). D05 slugs stay as `catalogId = waterdeep:<d05 slug>` and as source references. Lore
text is not copied or invented: the knowledge import owns it.

## Run it

```sh
pnpm install
pnpm dev --port 5211
open http://127.0.0.1:5211/waterdeep.html          # WebGPU when available
open http://127.0.0.1:5211/waterdeep.html?backend=webgl2
```

Drag pans, shift-drag or right-drag orbits, the wheel and pinch zoom, `0` resets. The panel lists
places, toggles the D05 control points and street anchors, and shows live sector and memory stats.

Headless check in a real Chrome (screenshot paths are optional):

```sh
node tests/browser/waterdeep-smoke.mjs http://127.0.0.1:5211 /tmp/waterdeep.png
```

It fails unless the scene renders, the far shell covers the city, resident detail stays under the
cap, pan moves the focus, zoom changes the radius, and selecting `castle-waterdeep` succeeds. It
also verifies close-zoom pointer selection and actual browser touch pan/pinch without native
scrolling, zoom or pointer cancellation on a freshly loaded 600×900 mobile page. It writes a
sector view, overview, near-top view with D05 control points, and a Market pilot view. Two ten-place
sweeps visit 80 sectors in the latest run (the count varies with camera damping) and verify that
old instance buffers are freed, the far shell stays intact, and retained CPU growth stays below
8 MiB after an identical second cycle.

## Budget observed in the smoke run

| Measure | Value |
| --- | --- |
| Far-shell lots | 13,607 (about 0.83 MiB of instance matrices) |
| Resident detail sectors | 8 typical (cap 20), 2 near + 6 mid |
| Detailed buildings | 599 typical (wall + roof matrix each) |
| Estimated matrix bytes | about 0.93 MiB total in the smoke run |
| Estimated draw calls | about 34 typical |
| Sector grid | 250 m, 435 sectors |

`SectorCity.stats().matrixBytes` is only the legacy instance estimate, explicitly labelled in the
panel. It is **not** the scene memory budget. `MapViewer.memoryStats()` exposes device allocation
counters for textures, geometry (including instances), and uniform/storage buffers.

The browser audit includes those resources, real WebGL renderbuffer storage (including MSAA),
and CDP heap/backing/embedder usage, including the CPU building caches. Device counters are
observed each frame after readiness, so earlier/between-frame texture/buffer peaks are unverified.
The renderbuffer hook and CPU sampling start before navigation. Budgets at 1440×900,
DPR 1, high quality, Chrome WebGL2: **192 MiB graphics, 192 MiB CPU, 320 MiB combined**.
Latest observed peaks: **64.3 MiB graphics, 67.6 MiB CPU, 131.9 MiB combined**. Earlier CPU peaks
varied between 75.1 and 119.7 MiB, still within budget. Mobile gestures run separately after the
desktop audit; mobile allocations are not certified by this budget.
The audit fails on unsupported renderbuffer formats, missing counters, budget excess or retained
growth. See [measurement scope and results](../../../docs/reports/d13-rework.md).

These are measured browser-visible resource allocations, not physical VRAM. Driver/compiler,
swapchain and browser-process overhead are excluded. WebGPU and other screen sizes require a
separate run and budget validation; they are not certified by the WebGL2 result.

## Expanding to another city

`src/lib/engine/plan/` and `src/lib/engine/render/sector-city.ts` are generic. A new map package
only supplies a `MapDefinition`: grid, bounds, land spans, `sector(index)`, places, control points,
street anchors, optional visual road corridors, and a seed. Nothing in those engine modules
mentions Waterdeep.

## Known limits

- One detail level per sector (far shell, mid flat roofs, near gables); no ground texture
  streaming yet.
- The far shell is always resident, so its matrix buffer grows with the number of lots.
- The demo page is a Vite entry like `engine-smoke.html`; it is not part of `pnpm build` outputs.
- Ward tint is a roof tone for orientation, not a claim about ward boundaries.
