# Calibration and provenance

This document describes the pixel frame of the AideDD/Jason Engle Waterdeep plan, the
proposed transform to plan meters, the control points used to check it, and the parts that
remain interpretation. The machine-readable values are in
[`data/waterdeep-reference.json`](data/waterdeep-reference.json).

## 1. Frame and orientation

| Property | Value | Basis |
| --- | --- | --- |
| Raster size | 3560 x 7256 px | `imageW`, `imageH` in `dataW.js`; JPEG header |
| Pixel origin | top-left `(0, 0)` | Image convention |
| x axis | increases east (right) | Visual inspection |
| y axis | increases south (down) | Image convention; harbor and Dock Ward at the bottom |
| North | up | Sea of Swords on the left, harbor at the bottom, City of the Dead east of Castle Ward |
| Projection | none; the plan is a stylized illustration | No latitude/longitude or survey grid was found |

The plan is not a survey drawing. Streets and buildings are hand-drawn, and marker centers
were placed by AideDD contributors. Positional error is therefore not claimed per point.

## 2. Scale and transform

The source dataset declares:

```js
var factorDist = 310;
/* 310 px = 1000 ft */
```

Derived constants:

| Constant | Value |
| --- | --- |
| pixels per 1000 ft | 310 |
| feet per pixel | 1000 / 310 = 3.225806451612903 |
| meters per pixel | 304.8 / 310 = 0.983225806451613 |
| pixels per meter | 310 / 304.8 = 1.0170603674540681 |

Proposed transform, pending the shared D04 coordinate contract:

```text
plan_x_m = pixel_x * 0.983225806451613
plan_y_m = pixel_y * 0.983225806451613
pixel_x   = plan_x_m / 0.983225806451613
pixel_y   = plan_y_m / 0.983225806451613
```

`plan_y_m` increases south because the image y axis points down. The 3D host may map plan y
to world `z` or `-z`; D04/D11 own that choice. Stored world values are rounded to 3 decimals
(about 1 mm), which is bookkeeping precision, not survey accuracy.

### Derived gate-to-gate distance

| Check | Result |
| --- | --- |
| North Gate `(2156, 559)` to South Gate `(3041, 5994)` | 5506.6 px |
| Implied length at 310 px per 1000 ft | 17,763 ft = 3.36 mi = 5.41 km |

This straight-line calculation uses the source scale; it does not independently validate it.
The gate-to-gate segment is not established as the city's full north-south extent.
The scale remains **source-asserted and not independently georeferenced**.
No scale bar was found on the artwork.

## 3. Control points

The 20 points below are stored in the JSON with pixel and plan-meter coordinates. `ref` is the
AideDD source reference when the marker entry has one.

| # | ID | Kind | Pixel | Ref |
| --- | --- | --- | --- | --- |
| 1 | `north-gate` | gate | 2156, 559 | N78 |
| 2 | `troll-gate` | gate | 825, 177 | - |
| 3 | `west-gate` | gate | 420, 1759 | $72 |
| 4 | `field-ward-center` | ward centroid | 2133, 945 | - |
| 5 | `sea-ward-center` | ward centroid | 988, 1337 | - |
| 6 | `north-ward-center` | ward centroid | 2685, 2526 | - |
| 7 | `blackstaff-tower` | landmark | 989, 2842 | C6 |
| 8 | `new-olamn` | landmark | 712, 2701 | C72 |
| 9 | `city-of-the-dead-center` | ward centroid | 2675, 3483 | - |
| 10 | `castle-waterdeep` | landmark | 1781, 4238 | C76 |
| 11 | `piergeirons-palace` | landmark | 1136, 3918 | C75 |
| 12 | `the-market` | landmark | 1548, 2719 | - |
| 13 | `the-yawning-portal` | landmark | 2053, 4472 | C48 |
| 14 | `trades-ward-center` | ward centroid | 2472, 3924 | - |
| 15 | `river-gate` | gate | 2944, 4398 | T48 |
| 16 | `harborwatch-tower` | coast | 540, 5198 | H1 |
| 17 | `dock-ward-center` | ward centroid | 2079, 5446 | - |
| 18 | `southern-ward-center` | ward centroid | 2861, 5228 | - |
| 19 | `south-gate` | gate | 3041, 5994 | S52 |
| 20 | `deepwater-beacon` | coast | 3078, 6644 | H7 |

### How the points were checked

1. Download the full raster to a temporary path (not committed to the repository).
2. Crop a 500 x 500 or 700 x 700 window centered on each candidate pixel.
3. Draw a red cross at the exact center of the crop.
4. Inspect the crop: the cross must land on the named gate, tower, palace, market square, or
   inside the named ward. Crops were generated locally with `ffmpeg` and were not committed
   because they reproduce the copyrighted artwork.

The visual checks confirmed, among others:

- The cross for Castle Waterdeep lands inside the castle courtyard.
- The Yawning Portal cross lands on the building at the Rainrun Street / Cook Street area.
- The Blackstaff Tower cross lands on the tower near Swords Street.
- Piergeiron's Palace lands inside the palace compound.
- The Market cross lands in the open market square.
- Harborwatch Tower lands on the coastal tower.
- The City of the Dead cross lands inside the walled cemetery.
- Field Ward, Sea Ward, North Ward, Trades Ward, Dock Ward, and Southern Ward centroids land
  inside their labeled areas.

The overlay artifact makes the same check repeatable in a browser:

```sh
node docs/maps/waterdeep/render-waterdeep-overlay.mjs
open docs/maps/waterdeep/overlay.svg
```

## 4. Wards

Only bounding boxes and centroids are stored. The original AideDD zone paths are not copied.
Boxes are axis-aligned and therefore over-cover irregular ward shapes; they are calibration
aids, not legal boundaries.

| Ward | Centroid px | Bounding box px |
| --- | --- | --- |
| Field Ward | 2133, 945 | 731, 176 to 2991, 1993 |
| Castle Ward | 1281, 4187 | 400, 2311 to 2239, 5077 |
| Dock Ward | 2079, 5446 | 1279, 4549 to 3044, 6237 |
| North Ward | 2685, 2526 | 1774, 907 to 3061, 3203 |
| Sea Ward | 988, 1337 | 305, 370 to 2079, 2359 |
| Southern Ward | 2861, 5228 | 2477, 4589 to 3155, 5997 |
| Trades Ward | 2472, 3924 | 2093, 2753 to 3037, 4766 |
| City of the Dead | 2675, 3483 | 2376, 2952 to 2990, 4035 |

## 5. Initial place selection

These ten places are enough to anchor a first scene and a first data-import test. They are
not a canonical gazetteer. Each entry keeps the AideDD source reference when one exists and
the provenance tags used in the JSON.

| Place | Ward | Pixel | Ref | Why it is in the first set |
| --- | --- | --- | --- | --- |
| Castle Waterdeep | Castle Ward | 1781, 4238 | C76 | Seat of government; central landmark |
| Piergeiron's Palace | Castle Ward | 1136, 3918 | C75 | Open Lord's palace; large readable compound |
| The Yawning Portal | Castle Ward | 2053, 4472 | C48 | Widely recognized inn; good story hook |
| Blackstaff Tower | Castle Ward | 989, 2842 | C6 | Wizard landmark; distinct tower |
| The Market | Castle Ward | 1548, 2719 | - | Open square; useful for crowds and travel tests |
| Harborwatch Tower | - (coastal) | 540, 5198 | H1 | Coastal landmark; checks the west shore |
| City of the Dead | City of the Dead | 2675, 3483 | - | Large ward-level area; checks the east side |
| New Olamn | Castle Ward | 712, 2701 | C72 | Bard college on the western cliffs |
| South Gate | Southern Ward | 3041, 5994 | S52 | Southern entry point; checks the far edge |
| Deepwater Beacon | - (coastal) | 3078, 6644 | H7 | Southern coastal landmark; checks the bottom edge |

Provenance tags used in the JSON:

- `aidedd-dataW-marker`: name, pixel, and optional ref come from the AideDD marker entry.
- `aidedd-zone-centroid`: pixel is the centroid of the AideDD ward zone, not a marker entry.
- `visual-cross-check-2026-10-18`: the pixel was inspected on the downloaded raster with a
  centered red cross.

Coastal points use `ward: null` because they fall outside the reduced ward bounding boxes; this is
not a claim that they belong to no administrative ward. No description, history, or lore text
from AideDD is included in these entries.

## 6. Confirmed versus interpretation

| Item | Status |
| --- | --- |
| Image dimensions and checksums | Confirmed from HTTP response and JPEG header |
| Scale constant and comment | Confirmed in the source dataset; source-asserted, not georeferenced |
| North-up orientation | Confirmed by visual inspection |
| Control-point pixels | Confirmed against the dataset and visually cross-checked |
| Ward boxes and centroids | Derived from source paths; boundary accuracy not audited |
| Coastline | Visual interpretation; not vectorized |
| Plan-meter transform | Proposed; pending D04 |
| 768 unique places | **False**. 768 entries, 2 duplicate names, 2 shared coordinate pairs |
| Building heights or 3D detail | Not present in the source; future artistic interpretation |

## 7. Doubts and coordination

1. **Edition/period.** The Jason Engle plan is the AideDD base map and shows Field Ward, a
   post-Spellplague ward, so the base plan is consistent with 5e-era Waterdeep. It is not
   tied to a specific in-world year. The marker database mixes periods and media (for example
   an entry dated 1494 DR and a Baldur's Gate 3 character), so it is not a single-date
   Waterdeep snapshot.
2. **Scale provenance.** `310 px = 1000 ft` is AideDD's internal distance constant. The gate
   distance is derived from that constant, not independent corroboration. No independent
   survey or scale bar was available.
3. **Marker identity.** 768 entries are not 768 unique places. Aliases and spelling variants
   exist. Future imports need an explicit identity and deduplication rule owned by D04.
4. **Ward boundaries.** The reduced boxes over-cover irregular wards. D13 should not treat
   them as authoritative polygons.
5. **Coast and terrain.** The shoreline and cliffs are visual only. Any 3D terrain is an
   artistic interpretation and must be labeled as such.
6. **Copyright.** The raster is not redistributed. Keep the URL, attribution, and checksums.
7. **D04 contract.** This package proposes plan meters and stable local IDs, but D04 owns
   IDs, units, DTOs, and events. Reconcile before turning the JSON into runtime content.
8. **D13 handoff.** Scene generation should consume the calibrated control points and the
   small place set first; it must not invent a full street graph or building inventory and
   label it Waterdeep.
