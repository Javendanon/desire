# Waterdeep reference package

Status: **calibration reference, not runtime content**. This package records the map source,
its pixel frame, a calibration to D04 world meters, a small verified place selection, and
the open questions. It does not generate a fictional city called Waterdeep, and it does not
claim that every marker on the source map is a distinct canonical location.

## What is here

| File | Purpose |
| --- | --- |
| [`sources.md`](sources.md) | Source catalog, access method, checksums, attribution, and what each source does and does not prove |
| [`calibration.md`](calibration.md) | Frame, orientation, scale, transform formulas, control points, hidden assumptions, and doubts |
| [`data/waterdeep-reference.json`](data/waterdeep-reference.json) | Machine-readable reference: image frame, scale, 20 control points, 8 ward boxes, 7 main streets, 10 initial places |
| [`overlay.svg`](overlay.svg) | Generated overlay: source map by URL plus control points and ward bounding boxes |
| [`verify-waterdeep-reference.mjs`](verify-waterdeep-reference.mjs) | Zero-dependency verifier for the JSON; `--image` checks the source JPEG and `--dataset` recomputes every derived claim from `dataW.js` |
| [`source-dataset.mjs`](source-dataset.mjs), [`source-checks.mjs`](source-checks.mjs) | Text parser for `dataW.js` (never evaluated) and the comparison used by `--dataset`; tests in `source-checks.test.mjs` use a synthetic dataset |
| [`render-waterdeep-overlay.mjs`](render-waterdeep-overlay.mjs) | Regenerates `overlay.svg` from the JSON |

The JSON is deliberately small. It is not a dump of the AideDD database: marker names and
pixel positions are recorded only for the selected control points and places. Lore text from
the source is not copied.

## Attribution

Map artwork: **Jason Engle**, <https://www.inprnt.com/gallery/j_a_e/waterdeep/>.
The interactive atlas is hosted by AideDD: <https://www.aidedd.org/atlas/es/waterdeep>.
The raster is copyrighted and is **not** stored in this repository. `overlay.svg` references
the public image URL, so it needs network access to display the map underneath the overlay.

## Quick verification

```sh
pnpm run verify:waterdeep          # verifier tests + JSON consistency; also runs in CI
node docs/maps/waterdeep/render-waterdeep-overlay.mjs
open docs/maps/waterdeep/overlay.svg
```

To check against the source itself, pass local copies of the raster and the dataset (see
[`sources.md`](sources.md) for the download commands):

```sh
node docs/maps/waterdeep/verify-waterdeep-reference.mjs \
  --image /path/to/waterdeep-3560-7256.jpg --dataset /path/to/dataW.js
```

`--image` checks byte size and SHA-256. `--dataset` checks the SHA-256, then recomputes the
frame, scale, marker counts, duplicates, ward boxes and centroids, and finds the marker under
every named point. Neither file is shipped, so these checks run locally, not in CI.

## Confirmed by this pass

- The source image is 3560 x 7256 pixels, SHA-256
  `45f5f862095ebd7d279592b8c20ad23a8b52918504f6cc87369cf3b246790e16`.
- The AideDD dataset declares `factorDist = 310` and a source comment `310 px = 1000 ft`.
- The plan is north-up: the Sea of Swords is on the left, Waterdeep Harbor at the bottom,
  and the City of the Dead east of Castle Ward.
- The dataset contains 768 active marker entries, 8 ward zones, and 2 duplicate names plus
  2 shared coordinate pairs. **768 entries are not 768 unique places.**
- Twenty control points from gates, ward centroids, and landmarks fall inside the image. All
  twenty are enumerated with their visual cross-check result in [`calibration.md`](calibration.md).
- The straight-line North Gate to South Gate distance implied by the source scale is about
  3.36 miles. This is a derived distance, not independent scale validation or the city's extent.

## Interpretation, not confirmed canon

- Ward bounding boxes and centroids are derived from AideDD overlay paths. Only the boxes and
  centroids are kept; the boundary lines are not reproduced.
- The shoreline is described from visual inspection and is not a vector coastline.
- The marker database mixes periods and editions. It is not a single-era snapshot.
- The scale, and so the calibration, is the source's own constant: its D04 provenance is
  `interpretation`. Elevation is unknown and not stored. D13 owns scene generation and turns
  these places into D04 `Place` records with a `PlaceAnchor`.
- No building heights, terrain mesh, street graph, latitude/longitude, or official JSON API
  were found in the observed source.

## Acceptance mapping

| Requirement | Evidence |
| --- | --- |
| Verifiable control-point overlay | `overlay.svg` + 20 points in JSON + verifier bounds/plan checks + `--dataset` marker check |
| Justified or explicitly unknown scale | AideDD dataset constant and comment: 310 px per 1000 ft; explicitly not independently georeferenced |
| Small initial place selection with provenance | 10 entries in `initial_places`, each with source ref (when present) and provenance tags |
| Verifiable main-street anchors | 7 `street-label-anchor` entries in `main_streets`, each with an id and provenance enforced by the verifier |
| No fictional city labelled Waterdeep | This package is reference/calibration only; no procedural geometry is generated |
| Data design coordinated with D04 | `calibration` has D04's `Calibration` shape; points use D04's X east / Z south frame; D04 gained `PlaceAnchor` so places can carry these positions |

## Independent review

A separate read-only review of the uncommitted diff checked the source data, checksums, and
overlay. It found one P2: New Olamn was assigned to Sea Ward although `(712, 2701)` lies outside
that ward's reduced bounding box and the AideDD reference places it under the Castle Ward hint
used by this package. The assignment and the calibration table were corrected, and the verifier
checks ward membership as a consistency invariant. The boxes and the hint stay calibration aids,
not boundaries. No other findings were raised.

A second review (round 3, see [`docs/reports/d05.md`](../../reports/d05.md)) recomputed the
dataset claims from the source, cropped the doubtful points and compared the package with the
D04 contract merged meanwhile. Its findings are fixed in the same round.
