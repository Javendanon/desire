# D13 Market pilot: D05 visual comparison

## Source and scope

The source is the Jason Engle raster hosted by AideDD, as recorded in
[`../maps/waterdeep/sources.md`](../maps/waterdeep/sources.md). Its SHA-256 was checked locally:
`45f5f862095ebd7d279592b8c20ad23a8b52918504f6cc87369cf3b246790e16`.
The copyrighted raster and source crops are not committed.

Only the Market approach portions of Trader's Way, Bazaar Street and the High Road are traced.
Their endpoints are **pilot cut lines**, not claims that the streets end there. The pilot covers
roughly raster x=1200–2120, y=2430–3020 (about 0.52 square kilometres), crossing several 250 m
streaming sectors. All other street markers remain label anchors; no full-city street graph
or routing network is claimed. The untraced low-detail background remains an interpretation.

[`../../content/maps/waterdeep/streets.ts`](../../content/maps/waterdeep/streets.ts) records the
traced pixel vertices and interpreted widths. The only conversion is D05's scale,
`304.8 / 310` metres per pixel, with x east and z south. Road widths are stylized approximations,
not surveyed measurements. The open Market polygon is a conservative interior trace, not a
building inventory: source stalls and ornamental features are omitted deliberately.

## Inspection and results

Comparison performed with the full-resolution raster crop and the generated WebGL2 scene:

| Feature | Source inspection | Scene result |
| --- | --- | --- |
| Trader's Way | Near-horizontal north edge of the Market, bends southeast into the High Road | Same orientation and junction; no roofs on the reserved corridor |
| Bazaar Street | South edge curves northeast toward the High Road | Same bend and connection; continuous across sector boundaries |
| High Road | North–south axis east of the Market | Preserved east of both approaches; not replaced by a jittered building grid |
| Market D05 control point `(1548,2719)` | Inside the open square between the two approaches | Calibrated marker lies inside the reserved open-ground polygon |
| Blackstaff Tower `(989,2842)` | Southwest of the Market | Marker remains southwest; its D05 anchor is unchanged |
| New Olamn `(712,2701)` | West and slightly north of the Market | Marker remains west and slightly north; its D05 anchor is unchanged |

Independent centreline spot checks, selected from the raster rather than the vertex list:
Trader's Way `(1510,2585)`, `(1940,2585)`; Bazaar Street `(1690,2895)`, `(1990,2780)`;
High Road `(2080,2550)`, `(2090,2910)`. The automated maximum distance allowance is **12 pixels**
(11.8 m). This is a coarse trace tolerance, not D05 positional uncertainty or survey precision.
`tests/map-corridors.test.ts` checks these samples and roof-radius clearance for every lot.
The Market polygon is also reserved, including roof overhangs.

The first screenshot exposed pre-existing kilometre-scale depth striping: a fixed 1.5 m near
plane lost depth precision over almost coplanar ground strips. The map camera now scales its
near plane to 1% of orbit radius (minimum 1.5 m). Reinspection of the Market screenshot shows
solid road surfaces and continuous ground, without the prior stripes. Ground shadows remain
enabled; the fix does not hide geometry or disable lighting.

## Reproduce

```sh
shasum -a 256 /tmp/waterdeep.jpg
ffmpeg -y -i /tmp/waterdeep.jpg -vf 'crop=1400:800:800:2350' \
  -frames:v 1 outputs/d13-reference-detail.png
pnpm dev --port 5213 --strictPort
node tests/browser/waterdeep-smoke.mjs http://127.0.0.1:5213 outputs/d13-streets.png
node --test tests/map-corridors.test.ts tests/waterdeep-content.test.ts
```

Inspect `outputs/d13-streets-market.png` against the source crop. The browser test focuses the
Market, points north up and saves that view plus the whole-city overview/top view. It also
runs pan, zoom, close picking, actual touch gestures and unload/reload checks. The screenshots
are local regenerated evidence, not a pixel-perfect automated comparison to copyrighted art.
This records the small pilot comparison before any later street expansion; **no other
corridors are approved by this comparison**. Facades, roof heights, ward colours, the coast
and the background grid remain explicitly interpreted rather than authenticated geography.
