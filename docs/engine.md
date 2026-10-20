# Table viewer (D11)

`src/lib/engine/` renders the table in 3D with PlayCanvas 2.23.2 (engine only, no editor): a test
city seen from far away, a district, and a harbour scene where miniatures stand on a hex board.
The Svelte side only mounts it through `ViewerHost.svelte`. Nothing per-frame goes through Svelte
reactivity.

The city is **test geometry**, not Waterdeep's cartography. The viewer always shows the label
`TEST_CITY_LABEL`, and the district ids are placeholders until the atlas card provides real data.

## Layout

| Path | Role | GPU |
| --- | --- | --- |
| `math/` | seeded random, hex grid, orbit camera rig and intro path, ray hits | no |
| `plan/` | test city plan and scene board: cells, placement, reach, approach | no |
| `scene/camera-goals.ts` | resting camera per zoom level and the intro keys | no |
| `render/` | textures, instanced city, harbour, water, miniatures, fog and post | yes |
| `scene/pieces.ts`, `scene/board-overlay.ts` | miniatures on the board, reach and grid | yes |
| `picking.ts`, `input.ts` | screen rays and canvas-only pointer, wheel, pinch and keys | yes |
| `boot.ts` | WebGPU device with WebGL 2 fallback, app with three component systems | yes |
| `viewer.ts` | `TableViewer`: lifecycle, frame loop, public API, events | yes |
| `ViewerHost.svelte` | canvas, loading and error states, prop to call forwarding | yes |

Everything under "no" is covered by `tests/engine-math.test.ts` and `tests/engine-plan.test.ts`
and runs in `pnpm test:frontend` without a browser.

## API

```ts
const viewer = await createViewer(canvas, { quality, timeOfDay, fog, reducedMotion, backend });
viewer.on('district' | 'hover' | 'piece' | 'cell' | 'zoom' | 'introEnd', listener); // returns off()
viewer.setLevel(level, district?);   // 0 city, 1 district, 2 scene; eases the camera
viewer.setPieces(specs);             // places each piece on the free cell nearest its spot
viewer.setTurn(id); viewer.setSelected(id); viewer.setFallen(id, fallen);
viewer.setMoveMode(steps | null);    // shows reachable cells; a click on one emits 'cell'
viewer.movePiece(id, cell);          // carries the miniature with a small lift
viewer.approach(id, targetId, steps) // moves toward a piece, returns the distance left
viewer.setMood(timeOfDay, fog);
viewer.stats(); viewer.destroy();
```

The viewer never changes its own level from input: wheel, pinch and `+`/`-` emit `zoom` and the
host decides. A failed device raises `ViewerError` with a message for the player.

## Lifecycle

`createViewer` boots the device, builds the scene and starts the loop. `destroy` removes every
listener (canvas, `ResizeObserver`, `visibilitychange`), destroys materials, textures and the
camera frame, then the app. The tab hidden pauses time. `liveViewerCount()` reports viewers that
were created and not destroyed.

## Budget and fallbacks

- Houses, roofs, trees and tombs are hardware-instanced: one draw call per kind and material.
- Pixel ratio is capped at 2 (1 on `quality: 'low'`). SSAO only runs on `high`.
- `reducedMotion` skips the intro flight, the camera jumps instead of easing, and water and ships
  stand still.
- WebGPU first, WebGL 2 otherwise. `backend: 'webgl2'` forces the fallback for testing.

## Smoke test

With the dev server running (`pnpm dev --port 5200`):

```sh
node tests/browser/engine-smoke.mjs http://127.0.0.1:5200          # WebGPU when available
node tests/browser/engine-smoke.mjs http://127.0.0.1:5200 webgl2   # forced fallback
```

It drives `engine-smoke.html` in headless Chrome over CDP: five create/destroy cycles per backend,
checking that frames render, that the loop stops on destroy and that no viewer stays alive. It
needs a local Chrome, so it is not part of CI yet.

## Quality gate notes

`tools/quality/gate.py` counts `;` inside one-line type literals and comments as extra
statements (F16). The engine uses named interfaces and avoids `;` in comments instead of carrying
that false positive. The fix to the rule belongs to a separate change in `tools/quality/`.

Remaining below-target warnings (functions over 25 lines or 3 parameters in `render/`, files over
300 LOC in `viewer.ts`, `miniatures.ts` and the design page) are listed by the gate and are not
floor blocks.

## Map viewer (D13)

A second, generic viewer renders calibrated city maps. It takes a `MapDefinition` and never
mentions a city by name, so other cities and campaigns can supply their own content package.

| Path | Role |
| --- | --- |
| `plan/map-definition.ts` | Grid, bounds, land spans, sector content, places and markers |
| `plan/sectors.ts` | Sector grid, resident set around a focus, detail levels, memory estimate |
| `plan/polygon.ts` | Point-in-polygon and scanline land spans |
| `scene/map-camera.ts` | Pan, orbit, zoom, clamps and projection as pure functions |
| `scene/map-markers.ts` | Place, control-point and street markers plus pick spheres |
| `input/map-input.ts` | Canvas pan/orbit/pinch/wheel/key input for the map |
| `render/sector-city.ts` | Far shell plus instanced walls and roofs per resident sector |
| `map-viewer.ts` | `createMapViewer(canvas, map, options)`, frame loop, events, stats |

`content/maps/waterdeep/` provides the first `MapDefinition`. The waterdeep demo lives in
`waterdeep.html` and `content/maps/waterdeep/demo.ts`; `tests/browser/waterdeep-smoke.mjs`
checks it in a real browser. Sector streaming caps maximum detail and keeps a low-detail shell
resident so panning never shows a hole.

Shared additions used by both viewers: `page-watch.ts` (resize and tab visibility) and
`flatMesh()` in `render/kit.ts`. They replaced duplicated code in `viewer.ts`, `city.ts` and
`water.ts` (F9 rule of three).
