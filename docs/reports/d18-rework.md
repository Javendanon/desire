# D18 · Rework evidence

Card `2409bc23-1cf7-4e2b-b285-7b9440bf411a`, branch
`task/d18-preparar-el-pipeline-de-arte-y-escenario`. Base of this round: commit `3c57ad4`
(`fix(assets): validate decoded inputs and bound offline resource use`).

This is the current approval evidence for D18. [`d18.md`](d18.md) is the historical delivery
record and explicitly does not carry current numbers; [`docs/asset-pipeline.md`](../asset-pipeline.md)
holds the design and [`tools/assets/README.md`](../../tools/assets/README.md) the operational
guide. Everything below was run in this worktree on the tree that produced the commit that adds
this file. Commands were not run anywhere else and nothing was asserted without running it.

## 1. Review findings and resolutions

| # | Severity | Finding | Resolution in this round |
| --- | --- | --- | --- |
| 1 | HIGH | `docs/asset-pipeline.md:5`, `docs/reports/d18.md:5` and `tools/assets/README.md:9` pointed at `docs/reports/d18-rework.md`, which did not exist. The change shipped no current record of metrics, tests, type check or blockers. | This file. The three links now resolve, and this file carries the before/after metrics, the run output, the finding status and the blockers. |
| 2 | HIGH | `tools/assets/src/textures.ts:70-71` piped the decoded image through `spawnSync` (`encoding: 'utf8'`, no `maxBuffer`), so a decoded PNG above the 1 MiB child-stdout cap would be reported as `dwebp decoder unavailable or failed`; only a 16×16 fixture exercised that path. | The decode now writes a temporary PNG (`dwebp -o <tmp>`), never a child stdout, and the PNG header of the decoded file must match the declared `width_px`/`height_px` before the temporary directory is deleted (`tools/assets/src/textures.ts`, `decodeRaster`/`pngDimensions`/`rasterProblem`). Regression fixture `tools/assets/tests/fixtures/detail-640.webp` (125 546 B compressed, decodes to a 1 218 680 B PNG, i.e. above 1 MiB) is covered by `tests/review-regressions.test.js`. |
| 3 | MEDIUM | `tools/assets/samples/sample-harbor/report.json:152` stored the author's absolute worktree path, so the committed evidence was machine-bound and had already drifted from a rebuild. No test compared the committed report to a fresh build. | `buildReport` records `path.basename(artifactPath)` through `reportedArtifactName` (`tools/assets/src/check.ts`), `stale_path` is recorded the same way (`tools/assets/src/pipeline.ts`), and the report was regenerated. `tests/review-regressions.test.js` rebuilds the sample into a temporary directory and deep-compares the whole report with the committed one. |

The handoff announced four findings and quoted three. The three quoted are closed above. The
tree was re-read against the same areas (`textures.ts`, report writing, the three entry
documents) and no fourth defect with the same shape was found; if the fourth finding was not
quoted it is **not** verified as addressed by this report.

## 2. What changed in this round

- `tools/assets/src/textures.ts` — decode to a temporary PNG file instead of a captured child
  stdout; verify the decoded PNG header against the declared resolution; split decoding,
  declared-payload checks and raster checks into `decodeRaster`, `declaredProblem` and
  `rasterProblem` so each stays small and single-purpose. Message `dwebp decoded` became
  `dwebp decoded PNG`.
- `tools/assets/src/check.ts` — `reportedArtifactName` (bare file name) for `artifact.path`.
- `tools/assets/src/pipeline.ts` — publish/quarantine by the real output path, record
  `stale_path` as a bare file name.
- `tools/assets/tests/fixtures/detail-640.webp` — new fixture whose decoded raster exceeds 1 MiB.
- `tools/assets/tests/review-regressions.test.js` — two regressions: large decoded raster still
  publishes; committed sample report is reproducible and repository-relative.
- `tools/assets/tests/helpers.js` — `fixturePath`.
- `tools/assets/samples/sample-harbor/report.json` — regenerated (relative artifact path).
- `docs/asset-pipeline.md`, `tools/assets/README.md` — decode target, raster verification and
  report portability documented next to the code that does it.

Note on finding 2's premise: on Node v26.7.0 the old call did **not** die with `ENOBUFS`. With no
`-o`, `dwebp` decodes and discards the raster, so stdout stayed empty and the 1 MiB cap never
applied. The old code therefore verified only the exit status — a decoded raster was never
inspected. The fix closes that real gap (a real PNG on disk, header checked) and removes the
buffer-limit class of failure instead of raising `maxBuffer`, which would have kept the
verification blind.

## 3. Evidence actually run

```text
$ node --test tools/assets/tests/*.test.js
ℹ tests 70
ℹ suites 0
ℹ pass 70
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 314.692875

$ pnpm exec tsc -p tools/assets/tsconfig.json
(no output)                     # exit 0, strict TypeScript 5.9.3

$ pnpm run check
svelte-check found 0 errors and 0 warnings

$ git diff --check
(no output)
```

Test count grew from 68 to 70 with the two regressions above. No test is skipped and no test
touches the network. Rust and the Svelte runtime were not modified in this round: `cargo test`
was not run, so this report makes no Rust claim.

Coverage (`node --experimental-test-coverage --test tools/assets/tests/*.test.js`):

```text
all files             | line 96.19 | branch 85.71 | funcs 99.51
src/textures.ts       | line 93.75 | branch 82.76 | funcs 100.00
src/check.ts          | line 100.00 | branch 77.94 | funcs 100.00
src/pipeline.ts       | line 100.00 | branch 97.30 | funcs 100.00
```

Uncovered `textures.ts` branches and why they stay uncovered:

- `decoded raster does not match the declared resolution` — `dwebp` derives its output size from
  the same header the check parses, so a mismatch was not reproducible with a real decoder. The
  branch is a guard against a future decoder or output-format change, not a reachable input.
- `dwebp decoder unavailable or failed` — only reachable when the binary is missing.
- Aggregate texture budget — with 64 textures capped at 256 KiB each the sum cannot exceed the
  16 MiB aggregate limit through the validated manifest; the same defensive-invariant status
  already documented for `artifact.embedded`.
- Lossless (`VP8L`) header branch — no lossless fixture ships. Pre-existing gap, unchanged here.

## 4. Metrics, same scope and same tool (kimün 0.26.0)

"Before" is the tree of `3c57ad4` extracted to a temporary directory, measured with the same
commands; "after" is this working tree. The scope is `tools/assets` (the card's scope), plus the
whole repository for context.

| Measurement | Before (`3c57ad4`) | After |
| --- | --- | --- |
| `km score tools/assets` | A+ 93.5, 18 files, 1 688 LOC | A+ 93.5, 18 files, 1 736 LOC |
| `km score .` (whole repo) | A- 87.4, 28 files, 2 126 LOC | A- 87.5, 28 files, 2 174 LOC |
| `km cycom tools/assets --per-function` (max) | 10 | 10 |
| `km cogcom tools/assets --per-function` (max) | 9 | 9 |
| `km smells tools/assets --max-lines 25 --max-params 3` | 11 findings, 4 files | 13 findings, 4 files |
| `km smells tools/assets --max-lines 40 --max-params 4` (floor) | 11 findings, 3 files | 11 findings, 3 files |
| `km dups tools/assets --exclude-ext json` | 0 groups, 0% | 0 groups, 0% |
| Lines over 100 columns in changed files | — | 0 |

The floor thresholds (F1–F6) hold; the score stays at the A+ / A- states above the B- (77)
floor and at the A- (87) target for the project tree. The two extra numeric findings are the
PNG/WebP byte offsets added to `textures.ts` (`0x89 0x50 …`, `12`, `16`, `20`, `24`, `26`, `30`),
already grouped in named `PNG` / `WEBP` constants. They are file-format offsets, not domain
magic numbers (F8 tolerates dimensions and indices); the analyzer counts them because it reads
literals inside the constant objects. `surface-manifest.ts:47,64` still exceed 100 columns —
pre-existing, untouched by this round, recorded instead of hidden.

## 5. Acceptance state after the rework

| Requirement | Evidence in this tree |
| --- | --- |
| Navigable sample scene | `samples/sample-harbor/report.json` → `navigation.pass: true`, 3/3 waypoints, 47 624/49 152 ground cells (96.9%, all free cells) |
| Collision separate | `collision` scene only, node without material or children; `collision.separate`, `collision.materialless`, per-solid footprint coverage |
| Scale validated | 224 m reference recomputed from the pixel frame, 0 m delta, 1 m tolerance, unrounded comparison |
| Compressed materials/textures | `image/webp` only, magic bytes, per-image and aggregate budgets, real `dwebp` decode with decoded raster resolution checked; sample texture 52 B |
| Provenance recorded | `asset.extras.desire.provenance`, per-node place id and height evidence, report `provenance` and `unknown_places` |
| Fidelity vs interpretation | `fidelity.tally` = verified 0, interpretation 1, synthetic 7, unknown 2; unknown heights emit no geometry |
| Inference outside the loop | build step only, no model called, no network code (`network_allowed: false`) |
| Splats only if measured | documented rejection with revisit conditions; no splat code |
| No paid service / private upload | no network code, remote texture URLs rejected, no credentials touched |

## 6. Blockers and open items

- No external glTF validator, browser consumer, physics engine or D11 integration was run. The
  acceptance is proven against the pipeline's own reader, not against a third-party consumer;
  that integration belongs to D11 and is not claimed here.
- The committed sample report is now reproducible byte-for-byte, but only while `dwebp` reports
  the same decoded size; the test asserts the report contents, not the GLB hash. A generated
  artifact that changed size would fail the report comparison, so drift surfaces as a test
  failure rather than as silent evidence rot.
- Decoding writes a temporary PNG per texture (up to ~67 MiB for a 4096×4096 image) into the OS
  temp directory and removes it immediately. Disk use during a build is therefore bounded by
  one decoded texture at a time, not by the compressed budget alone; this is a documented cost of
  verifying the raster instead of trusting the exit status.
- Pre-existing debt untouched: `gltf-read.ts` branch coverage (58.82%), `surface-manifest.ts`
  long lines, and the unreachable defensive branches listed in §3.
- `Cargo.lock` and `pnpm-lock.yaml` are untracked in this worktree from environment setup. They
  are not part of this change and were not committed.
