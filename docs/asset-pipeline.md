# Art and scene pipeline (D18)

Status: **implemented as an offline build step**. Card `2409bc23-1cf7-4e2b-b285-7b9440bf411a`.
Code: [`tools/assets/`](../tools/assets/README.md). Delivery evidence: [`reports/d18.md`](reports/d18.md).

This document describes how a fantasy illustration or map becomes a scene artifact, what is
measured and what is interpreted, and which tools were rejected after a small-sample
evaluation. It does not describe the runtime viewer (D11) or the Waterdeep content package
(D13); both consume the artifact described here.

## 1. Scope

In scope: the manifest contract, the offline converter, the acceptance checks, one synthetic
sample scene, and this documentation.

Out of scope and deliberately untouched:

- `content/maps/waterdeep/` (D13) and `src/lib/engine/` (D11).
- The calibrated Waterdeep package (D05). This pipeline can consume a manifest derived from
  it, but must never fabricate a city labelled Waterdeep.
- Display assets, splats and runtime streaming. No runtime code was changed.

## 2. Stages

```text
illustration + calibration + places (JSON manifest)
        │  validate: schema, provenance, heights, textures, no network
        ▼
metric scene: ground extents, solid footprints, unknown places, fidelity tally
        │  geometry: flat-shaded boxes, ground quad
        ▼
scene-<id>.glb: render/ground, render/lod0/<place>, render/lod1, collision
        │  read the written artifact back
        ▼
report.json: scale, fidelity, collision, LOD, textures, navigation, provenance
```

Every stage is a pure function except `src/io.js`, `src/textures.js` and `src/pipeline.js`,
which touch the filesystem. Nothing fetches, nothing renders, nothing infers geometry.
Running the sample takes about 0.1 s.

## 3. Manifest contract

The manifest reuses D04's vocabulary so a D05-derived calibration needs no translation:

- `calibration` has exactly D04's `Calibration` shape: `origin_px_x`, `origin_px_y`,
  `meters_per_pixel`, `rotation_radians`, and a `provenance` with `source`, `attribution`
  and `evidence` (`verified` | `interpretation` | `synthetic`).
- The transform is D04's: `x` grows east, `z` grows south, and `y` is **never** derived
  from the raster. Rotation is applied around the pixel origin.
- Places carry a pixel anchor and a footprint in meters. Positions become `plan_m` values in
  meters, rounded to millimetres only in the report.

Validation is strict on purpose. A manifest is rejected when: the schema or label is missing,
the illustration has no license, the calibration is absent or non-positive, `places`,
`materials` or `waypoints` are not arrays, `ground.material` is missing, there is no
`scale_check` reference distance, a place id repeats, a footprint exceeds 200 m, a place
pixel falls outside the illustration frame, the spawn or a waypoint falls outside the
calibrated ground, there is no waypoint, no place declares a height, a place references an
unknown material, a texture is not compressed, a texture budget exceeds 256 KiB, a texture
path escapes the asset directory, `rotation_radians` is not 0, or heights violate the policy
in §4.

`rotation_radians` is rejected while non-zero because the ground quad and the navigation grid
are axis-aligned. Anchor rotation alone would place the scene off its own ground. Supporting
rotation means rotating the ground, the collision quads and the nav grid together; that is a
contract change, not a hidden correction in the renderer.

## 4. Fidelity versus interpretation

The pipeline is built so that an interpretation cannot silently become a measurement.

| Height label | Required evidence | Meaning |
| --- | --- | --- |
| `verified` | `source_ref` | A source states the height (survey, plan, authored asset) |
| `interpretation` | `rationale` | Derived from the illustration with an explicit argument |
| `synthetic` | `rationale` | Invented sample or placeholder data |
| `null` (absent) | — | Unknown. No solid geometry is emitted |

Rules enforced in code, not in prose:

- An unknown height is never replaced by a default, an average, or a guess. The place is
  recorded in `unknown_places`, excluded from render and collision geometry, and counted in
  the report.
- `height_evidence` without `height_m`, or `height_m` without evidence, is a validation error.
- Heights above 400 m are rejected: an illustration cannot justify a skyscraper, and a
  hallucinated landmark should fail loudly.
- Every solid node in the GLB carries `extras.desire.height_evidence`, and `asset.extras`
  carries the whole fidelity tally.

An LLM may help a human read an illustration, name candidate places, or propose a rationale.
It is not part of the build: no model is called, and a proposal only becomes geometry after a
human writes `height_m` plus evidence into the manifest. Spatial facts the illustration does
not show (heights, interiors, hidden alleys) stay unknown by construction.

## 5. Geometry, LOD, collision and navigation

- **Render LOD0**: one flat-shaded box per solid place, one node each, one material each.
  Per-place nodes keep picking and per-place highlighting possible.
- **Render LOD1**: the same boxes merged into one mesh and one node. This reduces draw calls
  (9 render nodes to 2 including the ground), not triangles: the report records
  `lod0_triangles` and `lod1_triangles` side by side, and the sample shows 80 and 80.
  Triangle decimation is deferred until a real authored mesh exists to measure.
- **Collision**: a separate `collision` node, merged boxes, no material, no children. It is
  never shaded and never parented under a render node. The acceptance check reads the artifact
  to prove both properties.
- **Navigation**: a 1 m grid over the ground, blockers taken from the collision quads, and a
  4-neighbour flood fill from the spawn. A waypoint counts as reachable when a reached cell
  centre lies within 1.5 m. Blocking is conservative: a cell is blocked when a collision quad
  overlaps it, so the check can only under-report reachability, never over-report it. The
  sample reaches 47 624 of 49 152 ground cells (96.9%) and all three waypoints.
- **Coverage**: the check recomputes, from the artifact's collision quads, that every solid
  footprint lies inside some collision quad. A collision mesh that covers one building out of
  eight fails the build.

The artifact is glTF 2.0 binary with an embedded buffer and no images, so a consumer needs no
second download. Materials carry PBR factors; the declared texture is referenced by id in
`material.extras.desire.texture` and resolved by the runtime from the manifest.

## 6. Textures and materials

- Only `image/webp` and `image/ktx2` are accepted. PNG and JPEG are rejected at validation,
  before any build.
- Checks read the magic bytes and the file size, so a renamed file cannot pass.
- The sample ships a 52-byte WebP ground texture; a synthetic 16×16 pattern produced once with
  `cwebp`. The pipeline itself does not depend on `cwebp`.
- WebP was chosen over KTX2 because it needs no encoder dependency and is accepted by browsers
  today. KTX2 stays in the allowlist for the moment a GPU-format measurement justifies it; the
  policy, not an implementation detail, is what the check enforces.
- Images are **not** embedded into the GLB. glTF 2.0 core images are PNG or JPEG; embedding
  WebP would require `EXT_texture_webp` and a fallback image. Keeping textures as sidecar
  assets referenced from the manifest keeps the artifact conformant.

## 7. Tool evaluation (small sample, measured)

The card requires evaluating tools before choosing. The sample is one synthetic illustration,
10 places, 8 solids, one texture.

| Option | Evidence | Verdict |
| --- | --- | --- |
| Blender headless + export scripts | `blender` is not installed on the development machine; adopting it adds a large external binary and a Python bridge | Not chosen now. Revisit when authored meshes must be decimated or animated |
| `@gltf-transform` / Draco CLI | Needs an npm install and vendored versions; dependency ownership belongs to D01, and the sample needs no decimation, quantization or merging beyond one `Buffer.concat` | Not chosen now. Revisit when triangle budgets require compression |
| `cwebp` | Present (`/opt/homebrew/bin/cwebp`); used once to generate the 52-byte sample texture | Used as a one-off authoring tool, not a build dependency |
| Hand-written glTF 2.0 GLB writer | 0 dependencies, ~200 lines, deterministic, fully covered by tests; sample builds in 0.08 s into 30 KB | **Chosen** |
| Splats (Gaussian) | No measured benefit, no collision representation, no streaming budget, and no way to derive metric scale from an illustration today | Rejected for now, see §8 |

The small sample also produced the budgets this pipeline enforces: a 30 KB scene artifact, a
52-byte texture, and a build plus full check suite under a second. Numbers measured on the
development machine, not project invariants.

## 8. Splats and streaming

Splats are not implemented and no splat path exists in the code. They add value only if all of
these are measured first, otherwise they are expensive decoration:

1. a collision or navigation representation derived from the same data;
2. a streaming budget with measured cold-load time and peak memory, per D21;
3. a scale calibration that ties the splat cloud to D04 meters.

Until then the artifact stays a compact mesh scene. The card's instruction — "splats only if
they add value and with measured collision/streaming" — is therefore answered with a documented
rejection, not a stub.

## 9. Provenance, privacy and cost

- Every manifest declares illustration provenance (source, attribution, evidence) and a license.
  Both are copied into `asset.extras.desire` and the report. Each solid node also carries its
  place id, height evidence and provenance tags, so a place can be traced back from the artifact
  without opening the input manifest.
- `network_allowed: true` is rejected. The pipeline has no network code, and texture URLs are
  rejected by validation. Nothing leaves the machine, so no private material is uploaded.
- No paid service is used and no API key is required. The only external binary used during
  authoring was the locally installed `cwebp`.
- The sample illustration is synthetic and generated for this repository: no third-party map
  artwork is redistributed.

## 10. Relationship with Waterdeep and future cities

- D05 provides the calibrated pixel frame, scale provenance and place anchors. A Waterdeep
  manifest is a copy of the calibration block plus per-place heights that must be marked
  `interpretation` or left `null`; the AideDD plan does not state building heights.
- D13 owns the Waterdeep scene content. This pipeline provides the format and the checks; it
  does not ship a Waterdeep scene, and the sample label says explicitly that it is not Waterdeep.
- Other cities use the same manifest. City identity lives in content files, never in the
  converter, so a second city needs no engine change.

## 11. Acceptance mapping

| Card requirement | Evidence |
| --- | --- |
| Sample scene is navigable | `report.json` → `navigation`: spawn free, 3/3 waypoints reachable, 96.9% of free cells reached |
| Collision is separate | GLB node `collision` with no material, no children; `collision.separate` and `collision.materialless` checks |
| Scale is validated | `calibration` matches D04; `scale.checks` recomputes a 224 m reference distance from the pixel frame with 1 m tolerance |
| Materials/textures are compressed | only WebP/KTX2 accepted plus magic-byte and byte-budget check; sample texture 52 B |
| Provenance is recorded | `asset.extras.desire.provenance`, per-place provenance tags, report `provenance` and `unknown_places` |
| Fidelity versus interpretation is marked | height evidence per solid, node extras, `fidelity.tally` and `unknown_places` |
| Inference outside the interactive loop | build step only; no runtime code touched; no model called |
| Splats only if measured | documented rejection with the conditions to revisit (§8) |
| No paid services, no private uploads | no network code, `network_allowed` guard, local-only build |
| Tools evaluated on a small sample | §7 with the measured sample |

## 12. Limits and debt

- The nav grid is conservative and axis-aligned: a rotated wall over-blocks. This can hide a
  reachable waypoint but never claim a blocked one. Upgrade path: rasterize triangles exactly.
- Rotation is rejected, not implemented (see §3). Circular or north-rotated plans need the
  ground, collision and grid to rotate together.
- Some checks are structural invariants rather than evidence: `artifact.embedded` can only fail
  if the writer starts emitting URIs or images, and `fidelity.tally` compares the tally against
  the same manifest it was built from. They guard against regressions, not against a bad input.
- The public boundary is plain JavaScript objects with runtime validation. Nothing in the repo
  type-checks `tools/assets` (`tsconfig.json` covers `src/**` only, `tsconfig.node.json` covers
  `vite.config.ts`), so F13 is enforced by validation and tests, not by a type checker. A
  `checkJs` target belongs to the gate work in D02.
- `reachable_ratio` divides reached cells by all ground cells, not by free cells; blocked cells
  are reported separately as `blocked_cells`.
- LOD1 does not reduce triangles yet. It is a draw-call LOD, measured as such.
- Footprints are axis-aligned boxes. Arbitrary silhouettes need an authored mesh path (Blender
  or `gltf-transform`) that this sample did not justify.
- Heights and shapes are still authored by a person. The pipeline cannot recover what the
  illustration does not show, by design.
- The GLB is not validated by an external glTF validator in CI. The container, accessors and
  buffer views are checked by the local reader and its tests; a standards validator should be
  added with network access or a vendored binary (D02/D21).
- `package.json` has no script for these commands: manifest changes belong to D01. The commands
  are documented in `tools/assets/README.md`.
