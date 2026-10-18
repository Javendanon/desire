# Source catalog

Access date: **2026-10-18 UTC**. All requests were plain unauthenticated `GET` requests over
HTTPS. No credentials were used, no client block was bypassed, and no proxy or spoofed user
agent was introduced. The earlier note in [`docs/waterdeep-atlas.md`](../../waterdeep-atlas.md)
recorded that Chrome returned a client-side block when opening the data resource; a direct
request to the same public URL now returned HTTP 200. The observation is recorded here rather
than treated as a permanent block.

## Primary sources

| Source | Request/result | Snapshot evidence | What it establishes |
| --- | --- | --- | --- |
| AideDD Waterdeep atlas page | `GET https://www.aidedd.org/atlas/es/waterdeep` -> 200 | 18,012 bytes; SHA-256 `9660a2ecc3dbe08a17ee971db21227e8923fb8dd6891a923d24224324094d7d7` | Page title, attribution link to Jason Engle, declared scripts, Spanish UI |
| AideDD map dataset | `GET https://www.aidedd.org/atlas/dataW.js?v=7` -> 200 | 155,973 bytes; SHA-256 `72f0baff203370bf46bf966d3acd742b1a8a03468b976362dda29ee8c870af93`; `Last-Modified: Sat, 03 Oct 2026 00:44:11 GMT` | Image dimensions, `factorDist = 310`, `310 px = 1000 ft`, 8 ward zone paths, 768 active marker entries |
| AideDD map raster | `GET https://www.aidedd.org/atlas/images/waterdeep-3560-7256.jpg` -> 200 | 12,039,169 bytes; SHA-256 `45f5f862095ebd7d279592b8c20ad23a8b52918504f6cc87369cf3b246790e16`; `Last-Modified: Tue, 27 Jul 2021 00:01:49 GMT`; 3560 x 7256 JPEG | The artwork used for visual control-point cross-checks; not independent scale validation |
| AideDD mobile raster | `GET https://www.aidedd.org/atlas/images/waterdeep-1780-3628.jpg` -> 200 | 3,544,158 bytes; `Content-Length` observed in `HEAD` | Same map at half resolution; not used for calibration |
| Jason Engle artwork page | `https://www.inprnt.com/gallery/j_a_e/waterdeep/` | Linked by AideDD as the author page; not mirrored here | Attribution target for the map artwork |

Reproduction commands:

```sh
curl -sS -L -o /tmp/waterdeep-atlas.html https://www.aidedd.org/atlas/es/waterdeep
curl -sS -L -o /tmp/dataW.js 'https://www.aidedd.org/atlas/dataW.js?v=7'
curl -sS -L -o /tmp/waterdeep.jpg https://www.aidedd.org/atlas/images/waterdeep-3560-7256.jpg
shasum -a 256 /tmp/waterdeep-atlas.html /tmp/dataW.js /tmp/waterdeep.jpg
node docs/maps/waterdeep/verify-waterdeep-reference.mjs --image /tmp/waterdeep.jpg
```

## What each source supports

| Claim | Supported by | Confidence |
| --- | --- | --- |
| Image frame is 3560 x 7256 | `imageW`, `imageH` in `dataW.js`; JPEG header | Confirmed |
| Scale is 310 px per 1000 ft | `factorDist = 310` and the comment `310 px = 1000 ft` | Source-asserted; not independently georeferenced |
| North is up | Visual: sea west, harbor south, City of the Dead east | Confirmed by inspection, not by a compass rose |
| Eight named wards and their extents | `zones[]` paths, reduced to bounding boxes and centroids | Geometry confirmed from the source; boundary accuracy not audited |
| 768 marker entries | `groupe[]` filtered to non-`GROUP`, non-zero rows | Confirmed count; not a count of unique places |
| Place names and pixels | `groupe[]` entries for the selected places | Confirmed against the source data and visually cross-checked |
| Place lore | Not used | Deliberately not copied |

## What the sources do not provide

- No official JSON export, REST API, or versioned data contract.
- No street graph, routable network, or travel-time model beyond AideDD's pixel scale.
- No building footprints, heights, terrain mesh, or 3D data.
- No latitude/longitude or georeferenced control points.
- No single campaign date or edition. The marker database mixes periods and media.
- No scale bar in the artwork that could be read independently. The scale comes from the
  dataset constant and its comment.

## Copyright and attribution

The map artwork is by **Jason Engle**. The raster is copyrighted and is not committed to this
repository. `overlay.svg` embeds only the public URL; the verifier can check a locally
downloaded copy but does not distribute it. The AideDD marker names, coordinates, and ref
codes are recorded only for the selected calibration set. AideDD lore text is not copied into
the JSON, the overlay, or the docs.

## Reuse limits

- Do not treat this package as a license to redistribute the raster.
- Do not expand the JSON into a bulk copy of the AideDD database.
- Keep the source URL, access date, and checksums when refreshing the snapshot.
- If the source changes, update the snapshot values and rerun the verifier rather than
  weakening the checks.
