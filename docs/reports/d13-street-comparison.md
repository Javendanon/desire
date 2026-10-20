# D13 street pilot: D05 visual comparison

## Source and scope

The source is the Jason Engle raster hosted by AideDD, as recorded in
[`../maps/waterdeep/sources.md`](../maps/waterdeep/sources.md). Its SHA-256 was checked locally:
`45f5f862095ebd7d279592b8c20ad23a8b52918504f6cc87369cf3b246790e16`.
The copyrighted raster and source crops are not committed.

Two scopes share one generic pipeline. The **Market pilot** traces Trader's Way, Bazaar Street and
the High Road precisely; its endpoints are pilot cut lines, not claims that the streets end there.
It covers roughly raster x=1200–2120, y=2430–3020 (about 0.52 square kilometres) and its
checkpoints use a 12 px (11.8 m) tolerance. The **citywide axis pilot** adds one coarse axis per
ward so the whole-city view keeps recognisable streets instead of a free block grid: the High Road
north of the Market (Field and North Wards), Julthoon Street (Sea Ward), Waterdeep Way (Trades
Ward), the Way of the Dragon (Southern Ward), Dock Street (Dock Ward) and the Beaconmarch beside
the eastern wall (City of the Dead). Castle Ward is crossed by the Market pilot. The coarse axes
use a 30 px tolerance: one grid cell of the annotated raster crop is 50 px, so the number stays an
honest coarse trace and not metrology.

This is still **one axis per ward, not a street network**. The blocks between the traced axes
remain the interpreted 26 m lot grid, and no routing graph, alleys or full-city street inventory is
claimed. Invented facades stop at the traced corridors.

[`../../content/maps/waterdeep/streets.ts`](../../content/maps/waterdeep/streets.ts) records the
traced pixel vertices and interpreted widths. The only conversion is D05's scale,
`304.8 / 310` metres per pixel, with x east and z south. Road widths are stylized approximations,
not surveyed measurements. The open Market polygon is a conservative interior trace, not a
building inventory: source stalls and ornamental features are omitted deliberately.

## Inspection and results

Comparison performed with the full-resolution raster crop and the generated WebGL2 scene. The
traces were drawn over the source raster at 1:1 (cyan bands, magenta centreline, `file://` SVG
screenshot at 3560×7256) and each axis was inspected against the street it follows.

| Feature | Source inspection | Scene result |
| --- | --- | --- |
| Trader's Way | Near-horizontal north edge of the Market, bends southeast into the High Road | Same orientation and junction; no roofs on the reserved corridor |
| Bazaar Street | South edge curves northeast toward the High Road | Same bend and connection; continuous across sector boundaries |
| High Road | North–south axis east of the Market | Preserved east of both approaches; not replaced by a jittered building grid |
| High Road north (Field/North) | Wide avenue from the North Gate south to the Market approach | Same straight line; lots reserved along its whole length |
| Julthoon Street (Sea Ward) | Near-horizontal street just north of The God Catcher | Traced across Sea Ward to the High Road; keeps its slight drift south |
| Waterdeep Way (Trades) | Wide east–west avenue west of the High Road junction | Same band and junction; reserved through the Trades blocks |
| The Way of the Dragon (Southern) | North–south street drifting east, then southeast toward the South Gate | Same drift; the High Road stays a separate avenue east of it |
| Dock Street (Dock) | Short diagonal from the quay up into the Dock blocks | Same diagonal between the wharves and the block grid |
| The Beaconmarch (City of the Dead) | Road along the eastern wall, through the wall towers | Same line along the wall; tombs reserved beside it |
| Market D05 control point `(1548,2719)` | Inside the open square between the two approaches | Calibrated marker lies inside the reserved open-ground polygon |
| Blackstaff Tower `(989,2842)` | Southwest of the Market | Marker remains southwest; its D05 anchor is unchanged |
| New Olamn `(712,2701)` | West and slightly north of the Market | Marker remains west and slightly north; its D05 anchor is unchanged |

Independent centreline spot checks, selected from the raster rather than the vertex list:
Trader's Way `(1510,2585)`, `(1940,2585)`; Bazaar Street `(1690,2895)`, `(1990,2780)`;
High Road `(2080,2550)`, `(2090,2910)`; High Road north `(2073,1050)`, `(2077,1520)`,
`(2088,2120)`; Julthoon Street `(800,2325)`, `(1600,2328)`, `(2040,2315)`; Waterdeep Way
`(1700,4067)`, `(2000,4063)`, `(2200,4055)`; Way of the Dragon `(2522,5080)`, `(2570,5480)`,
`(2596,5680)`; Dock Street `(2150,5538)`, `(2100,5596)`, `(2050,5630)`; Beaconmarch
`(2900,3010)`, `(2983,3083)`, `(2922,3480)`. The automated maximum distance allowance is
**12 pixels** for the Market pilot and **30 pixels** for the coarse axes. Three earlier
checkpoints duplicated trace vertices; they were replaced with raster-read points.
`tests/map-corridors.test.ts` checks these samples, one traced axis per ward, and roof-radius
clearance for every lot. The Market polygon is also reserved, including roof overhangs.

A luminance probe cross-checks the checkpoints independently: mean luminance of a 6 px disc on the
checkpoint versus a 40–80 px ring around it. 21 of 24 checkpoints are at least 16 levels brighter
on-axis (range +16 to +93), which is what a pale road between dark roofs looks like. The
Beaconmarch is the exception (−3 to +10): it runs beside the wall, so the ring mixes the lit field
with the shadowed embankment. That axis is verified visually, not by luminance. The probe is local
evidence; the decoded raster is 77 MB of raw RGB and is not committed.

The first screenshot exposed pre-existing kilometre-scale depth striping: a fixed 1.5 m near
plane lost depth precision over almost coplanar ground strips. The map camera now scales its near
plane to 1% of orbit radius (minimum 1.5 m). Reinspection of the Market screenshot shows solid
road surfaces and continuous ground, without the prior stripes. Ground shadows remain enabled; the
fix does not hide geometry or disable lighting.

## Reproduce

```sh
shasum -a 256 /tmp/waterdeep.jpg
ffmpeg -y -i /tmp/waterdeep.jpg -vf 'crop=1400:800:800:2350' \
  -frames:v 1 outputs/d13-reference-detail.png
# Trace overlay: draw WATERDEEP_ROAD_TRACES as polylines over file:///tmp/waterdeep.jpg at 1:1
# in an SVG, then screenshot it with headless Chrome (--window-size=3560,7256).
ffmpeg -y -i /tmp/waterdeep.jpg -f rawvideo -pix_fmt rgb24 /tmp/wd.rgb  # luminance probe input
pnpm dev --port 5213 --strictPort
node tests/browser/waterdeep-smoke.mjs http://127.0.0.1:5213 outputs/d13-streets.png
node --test tests/map-corridors.test.ts tests/waterdeep-content.test.ts
```

Inspect `outputs/d13-streets-market.png` against the source crop. The browser test focuses the
Market, points north up and saves that view plus the whole-city overview/top view. It also
runs pan, zoom, close picking, actual touch gestures and unload/reload checks. The screenshots
are local regenerated evidence, not a pixel-perfect automated comparison to copyrighted art.
Facades, roof heights, ward colours, the coast and the background grid remain explicitly
interpreted rather than authenticated geography. **No street beyond the nine traced axes is
approved by this comparison**; the full city street inventory remains a follow-up card.
