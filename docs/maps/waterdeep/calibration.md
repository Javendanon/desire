# Calibration and provenance

This document describes the pixel frame of the AideDD/Jason Engle Waterdeep plan, the
calibration to D04 world meters, the control points used to check it, and the parts that
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

The JSON `calibration` block has the shape of D04's `Calibration`: origin `(0, 0)`, scale
`s = 0.983225806451613` m/px and rotation `0`. Its provenance evidence is `interpretation`,
because the scale is the source's own constant and was not measured independently.

With D04's formula ([`docs/modelo-de-datos.md`](../../modelo-de-datos.md), "Coordenadas y
calibración": X east, Y up, Z south) and `u0 = v0 = θ = 0`:

```text
x_m = pixel_x * 0.983225806451613      pixel_x = x_m / 0.983225806451613
z_m = pixel_y * 0.983225806451613      pixel_y = z_m / 0.983225806451613
y_m = elevation, unknown in the source and never inferred from the raster
```

Points therefore carry `plan_m: {x_m, z_m}` and no `y_m`. A runtime `Position` gets its
elevation from the scene (D13), not from this package. Stored values are rounded to 3
decimals (about 1 mm), which is bookkeeping precision, not survey accuracy.

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

The data side is repeatable with `--dataset`: the verifier parses a local copy of `dataW.js`
as text and requires every named point to sit exactly on a marker with its name (or recorded
`source_name`) and ref, every ward box and centroid to match the zone path, and every count
in `source_snapshot.derived` to match the source.

All twenty control points were checked with the crop-and-cross method. The table records what
landed under the cross.

| # | ID | Result of the visual cross-check |
| --- | --- | --- |
| 1 | `north-gate` | Cross lands on the North Gate gatehouse on the northern wall. |
| 2 | `troll-gate` | Cross lands on the Troll Gate at the northwest corner, on the northern wall. |
| 3 | `west-gate` | Cross lands on the West Gate gatehouse on the western wall. |
| 4 | `field-ward-center` | Cross lands inside Field Ward. |
| 5 | `sea-ward-center` | Cross lands inside Sea Ward. |
| 6 | `north-ward-center` | Cross lands inside North Ward. |
| 7 | `blackstaff-tower` | Cross lands on the tower near Swords Street. |
| 8 | `new-olamn` | Cross lands on the Cliffride building the dataset calls "New Olamn's academy of music and other arts" (`C72`). |
| 9 | `city-of-the-dead-center` | Cross lands inside the walled cemetery. |
| 10 | `castle-waterdeep` | Cross lands inside the castle courtyard. |
| 11 | `piergeirons-palace` | Cross lands inside the palace compound. |
| 12 | `the-market` | Cross lands in the open market square. |
| 13 | `the-yawning-portal` | Cross lands on the building at the Rainrun Street / Cook Street area. |
| 14 | `trades-ward-center` | Cross lands inside Trades Ward. |
| 15 | `river-gate` | Cross lands on the River Gate on the eastern wall. |
| 16 | `harborwatch-tower` | Cross lands on the coastal tower. |
| 17 | `dock-ward-center` | Cross lands inside Dock Ward. |
| 18 | `southern-ward-center` | Cross lands inside Southern Ward. |
| 19 | `south-gate` | Cross lands on the South Gate gatehouse. |
| 20 | `deepwater-beacon` | Cross lands on the small beacon structure at the southern tip. |

Streets are a different case. The AideDD dataset stores one marker per street, so
`main_streets` holds **label anchors**, not polylines. Each entry carries the
`street-label-anchor` kind and the `aidedd-dataW-street-marker` provenance; the verifier
rejects a street without provenance. Do not read a road shape into these points. The source
provides no street geometry.

The overlay artifact makes the same check repeatable in a browser:

```sh
node docs/maps/waterdeep/render-waterdeep-overlay.mjs
open docs/maps/waterdeep/overlay.svg
```

## 4. Wards

Only bounding boxes and centroids are stored. The original AideDD zone paths are not copied.
The "centroid" is the mean of the path's vertices (curve control points included), not the
area centroid; it is a stable label point inside the ward, not its center of mass.
Boxes are axis-aligned and therefore over-cover irregular ward shapes; they are calibration
aids, not legal boundaries.

A place gets a `ward` value from two hints, neither of which is authoritative: the reduced
bounding box that contains its pixel, and the letter prefix AideDD uses in its `ref` codes
(`C` = Castle Ward, `N` = North Ward, `D` = Dock Ward, `T` = Trades Ward, `S` = Southern
Ward, `H` = harbor/coast). The prefix convention is the dataset author's; AideDD does not
document it, and the over-covering boxes match several wards at once, so the convention was
observed rather than proven. The verifier checks the box as a consistency invariant, not as a
boundary claim.

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
- `aidedd-zone-centroid`: pixel is the vertex mean of the AideDD ward zone, not a marker entry.
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
| Calibration to D04 meters | D04 shape; evidence `interpretation` (scale is source-asserted) |
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
7. **D04 contract.** The calibration and the `plan_m` coordinates follow D04's frame. Place
   ids here are local; D13 imports them as `Place` records with a `PlaceAnchor` on the
   Waterdeep map version, assigning contract ids and the elevation then.
8. **D13 handoff.** Scene generation should consume the calibrated control points and the
   small place set first; it must not invent a full street graph or building inventory and
   label it Waterdeep.
