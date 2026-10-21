# D18 · Rework evidence

Card `2409bc23-1cf7-4e2b-b285-7b9440bf411a`, branch
`task/d18-preparar-el-pipeline-de-arte-y-escenario`. Base of this round: commit `3c57ad4`
(`fix(assets): validate decoded inputs and bound offline resource use`).

This is the current approval evidence for D18. [`d18.md`](d18.md) is the historical delivery
record and does not carry current numbers; [`docs/asset-pipeline.md`](../asset-pipeline.md) holds
the design and [`tools/assets/README.md`](../../tools/assets/README.md) the operational guide.
Every number and command below was produced in this worktree on the tree committed with this
file. Nothing is asserted that was not run; the commands in §3 re-run all of it.

## 1. Review findings and resolutions

| # | Severity | Finding | Resolution in this round |
| --- | --- | --- | --- |
| 1 | HIGH | `docs/asset-pipeline.md:5`, `docs/reports/d18.md:5` and `tools/assets/README.md:9` pointed at `docs/reports/d18-rework.md`, which did not exist. The change shipped no current record of metrics, tests, type check or blockers. | This file. The three links now resolve, and this file carries the before/after metrics, the run output, the finding status and the blockers. |
| 2 | HIGH | `tools/assets/src/textures.ts:70-71` captured the decode through `spawnSync` (`encoding: 'utf8'`, no `maxBuffer`) and never inspected the decoded raster, so the "decode" proof was only an exit status; the only decoded fixture was 16×16. | Decoding now writes a temporary PNG (`dwebp -o <tmp>`, no child stdout to cap) and the decoded PNG header must match the declared `width_px`/`height_px` before the temporary directory is deleted (`tools/assets/src/textures.ts`: `decodeRaster`, `readRaster`, `pngDimensions`, `rasterProblem`). A timeout is reported as a timeout, a missing binary as a missing decoder, and an unreadable output with its filesystem cause. Tests: `tests/fixtures/detail-640.webp` (125 546 B compressed, decodes to a 1 218 680 B PNG) plus scripted-decoder cases for mismatched raster, non-image output, empty output and missing binary. |
| 3 | MEDIUM | `tools/assets/samples/sample-harbor/report.json:152` was machine-bound evidence: the generator stored an absolute worktree path, and the committed file had already drifted (30 656 B, repo-relative path, stale `detail`), so no rebuild anywhere reproduced it. | `buildReport` records `path.basename(artifactPath)` through `reportedArtifactName` (`tools/assets/src/check.ts`), `stale_path` is recorded the same way (`tools/assets/src/pipeline.ts`), and the report was regenerated. `tests/review-regressions.test.js` rebuilds the sample into a temporary directory and deep-compares the whole report with the committed one, so any drift fails the suite. |

The handoff announced four findings and quoted three. The three quoted are closed above. The
tree was re-read against the same areas (`textures.ts`, report writing, the three entry
documents) and no fourth defect with the same shape was found; if the fourth finding was not
quoted, it is **not** verified as addressed here.

Premise correction for finding 2: on Node v26.7.0 the old call did **not** die with `ENOBUFS`.
Without `-o`, `dwebp` decodes and discards the raster, so stdout stayed empty and the 1 MiB cap
never applied. The old check therefore accepted any image the decoder exited `0` on, without
looking at the result. The fix closes that gap with a real PNG on disk and a header comparison,
and it removes the buffer-limit class of failure instead of raising `maxBuffer`, which would have
kept the verification blind.

## 2. What changed in this round

- `tools/assets/src/textures.ts` — decode to a temporary PNG file; verify its header against the
  declared resolution; distinguish timeout, missing decoder, bad payload and unreadable output;
  split decoding (`decodeRaster`), failure text (`decodeError`), raster read (`readRaster`) and
  the declared-payload rules (`declaredProblem`) so each function has one reason to change.
  Report detail text `dwebp decoded` became `dwebp decoded PNG`.
- `tools/assets/src/check.ts` — `reportedArtifactName` (bare file name) for `artifact.path`.
- `tools/assets/src/pipeline.ts` — publish and quarantine by the real output path, record
  `stale_path` as a bare file name and only when a file was actually quarantined.
- `tools/assets/tests/fixtures/detail-640.webp` — fixture whose decoded raster exceeds 1 MiB.
- `tools/assets/tests/review-regressions.test.js` — regressions: large decoded raster still
  publishes; committed sample report is reproducible and path-independent; scripted decoder
  writes a different raster, writes a non-image, writes nothing, or is missing.
- `tools/assets/tests/helpers.js` — `fixturePath`.
- `tools/assets/samples/sample-harbor/report.json` — regenerated (relative artifact path).
- `docs/asset-pipeline.md`, `tools/assets/README.md` — decode target, raster verification,
  timeout wording and report portability documented next to the code that implements them.

## 3. Evidence actually run

```text
$ node --test tools/assets/tests/*.test.js
ℹ tests 74
ℹ pass 74
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0

$ pnpm exec tsc -p tools/assets/tsconfig.json
(no output)                     # exit 0, strict TypeScript 5.9.3

$ pnpm run check
svelte-check found 0 errors and 0 warnings

$ git diff --check
(no output)
```

Test count grew from 68 (base) to 74. No test is skipped, none touches the network, and no test
asserts on the local `dwebp` version: the decoder is scripted when its behaviour is the subject,
so CI without libwebp still exercises the failure paths with a real process boundary.

Coverage (`node --experimental-test-coverage --test tools/assets/tests/*.test.js`):

```text
all files             | line 96.43 | branch 86.47 | funcs 99.51
src/textures.ts       | line 96.47 | branch 89.39 | funcs 100.00
src/check.ts          | line 100.00 | branch 77.94 | funcs 100.00
src/pipeline.ts       | line 100.00 | branch 97.22 | funcs 100.00
```

Uncovered `textures.ts` lines and why they stay uncovered:

- `58-61` — lossless (`VP8L`) header branch; no lossless fixture ships. Pre-existing gap.
- `157-158` — aggregate texture budget: with at most 64 textures capped at 256 KiB each, a
  validated manifest cannot exceed the 16 MiB aggregate limit. Same defensive-invariant status
  already documented for `artifact.embedded`.

## 4. Metrics, same scope and same tool (kimün 0.26.0)

"Before" is the tree of `3c57ad4` extracted to a temporary directory and measured with the same
commands; "after" is the committed tree. The scope is `tools/assets` (the card's scope), plus the
whole repository for context.

| Measurement | Before (`3c57ad4`) | After |
| --- | --- | --- |
| `km score tools/assets` | A+ 93.5, 18 files, 1 688 LOC | A+ 93.5, 18 files, 1 744 LOC |
| `km score .` (whole repo) | A- 87.4, 28 files, 2 126 LOC | A- 87.5, 28 files, 2 182 LOC |
| `km cycom tools/assets --per-function` (max) | 10 | 10 |
| `km cogcom tools/assets --per-function` (max) | 9 | 9 |
| `km smells tools/assets --max-lines 25 --max-params 3` | 11 findings, 4 files | 13 findings, 4 files |
| `km smells tools/assets --max-lines 40 --max-params 4` (floor) | 11 findings, 3 files | 11 findings, 3 files |
| `km dups tools/assets --exclude-ext json` | 0 groups, 0% | 0 groups, 0% |
| Lines over 100 columns in changed files | — | 0 |

The floor thresholds (F1–F6) hold and the score stays at or above the A- (87) target. The two
extra numeric findings are the PNG/WebP byte offsets added to `textures.ts` (`0x89 0x50 …`, `12`,
`16`, `20`, `24`, `26`, `30`), already grouped in named `PNG` / `WEBP` constants: file-format
offsets, not domain magic numbers (F8 tolerates dimensions and indices). The analyzer counts them
because it reads literals inside the constant objects. `surface-manifest.ts:47,64` still exceed
100 columns — pre-existing, untouched, recorded instead of hidden.

## 5. Acceptance state after the rework

| Requirement | Evidence in this tree |
| --- | --- |
| Navigable sample scene | `samples/sample-harbor/report.json` → `navigation.pass: true`, 3/3 waypoints, 47 624/49 152 ground cells (96.9%, all free cells) |
| Collision separate | `collision` scene only, node without material or children; `collision.separate`, `collision.materialless`, per-solid footprint coverage |
| Scale validated | 224 m reference recomputed from the pixel frame, 0 m delta, 1 m tolerance, unrounded comparison |
| Compressed materials/textures | `image/webp` only; magic bytes, per-image and aggregate budgets; real `dwebp` decode whose PNG header must match the declared resolution; sample texture 52 B |
| Provenance recorded | `asset.extras.desire.provenance`, per-node place id and height evidence, report `provenance` and `unknown_places` |
| Fidelity vs interpretation | `fidelity.tally` = verified 0, interpretation 1, synthetic 7, unknown 2; unknown heights emit no geometry |
| Inference outside the loop | build step only, no model called, no network code (`network_allowed: false`) |
| Splats only if measured | documented rejection with revisit conditions; no splat code |
| No paid service / private upload | no network code, remote texture URLs rejected, no credentials touched |

## 6. Independent advisor

An independent reviewer ran against `3c57ad4..HEAD` (read-only, no edits or commits). Its finding
and how each item was resolved:

| Advisor item | Resolution |
| --- | --- |
| Must-fix: the >1 MiB fixture was not a RED test, because the old code never captured the decode; the new raster checks had no test, and the missing-PNG branch was not listed as uncovered. | Scripted-decoder tests now cover a mismatched raster, a non-image, an empty output and a missing binary; `readRaster`'s catch is covered (funcs 100%), and the report no longer claims the mismatch is unreachable. The >1 MiB fixture stays as a guard for the stdout-cap class. |
| Should-fix: a decode timeout (`ETIMEDOUT`) was still reported as "decoder unavailable". | `decodeError` returns `dwebp decode exceeded 5000 ms` for `ETIMEDOUT` and keeps the unavailable wording for spawn failures. |
| Should-fix: `dwebp` exiting `0` without writing a file threw `ENOENT` out of `decodeRaster`, losing context (F11). | `readRaster` catches it and returns `decoded raster cannot be read: <cause>`; covered by the empty-output test. |
| Should-fix: `Raster` and `TextureFileSize` were duplicate types. | Merged into `TextureFileSize`. |
| Should-fix: four report claims did not match the code (`is covered`, the absolute-path premise, "byte-for-byte", "everything was run"). | Rewritten in §1–§3 above: the base file was stale and the generator wrote absolute paths, the comparison is over report contents including `artifact.bytes` (not a GLB hash), and every command is listed so it can be re-run. |
| Consider: test name said "repository-relative" but only the file name is stored. | Renamed to `... reproducible and path-independent`; §1 and the README state that the recorded path is relative to the report's own directory. |
| Consider: `stale_path = undefined` was assigned instead of omitted. | Restored conditional assignment; the key is absent unless a file was quarantined. |
| Consider: `decodeRaster` mixes folder handling, process spawn and PNG parsing (F14); `textures.ts` mixes probe, decode and header parsing (F7). | Accepted with justification: each function is ≤ 20 lines and one file (170 LOC) still has a single subject — the texture publication contract. A separate `raster-header.ts` would split a 20-line parser from its only caller; the path shim already made the boundary testable without dependency injection. |

## 7. Blockers and open items

- No external glTF validator, browser consumer, physics engine or D11 integration was run. The
  acceptance is proven against the pipeline's own reader, not against a third-party consumer;
  that integration belongs to D11 and is not claimed here.
- The committed sample report now reproduces on another machine as long as the build produces the
  same bytes. The test compares report contents, including `artifact.bytes`; the GLB itself is not
  hashed. A silent change in artifact size therefore fails the suite instead of rotting the
  evidence.
- Decoding writes one temporary PNG per texture (up to ~67 MiB for a 4096×4096 image) into the OS
  temporary directory and deletes it immediately. Peak disk use during a build is one decoded
  texture, and a raster that large also has to decode and encode inside the 5 s budget; the
  budget failure is reported as a timeout, not as a bad texture.
- Pre-existing debt untouched: `gltf-read.ts` branch coverage (58.82%), `surface-manifest.ts` long
  lines, the lossless `VP8L` branch and the aggregate-budget invariant.
- `Cargo.lock` and `pnpm-lock.yaml` are untracked in this worktree from environment setup; they are
  not part of this change and were not committed.

## 8. Round 3: CI gate, TypeScript tests and visual review

Base: `47a31e7`, merged with `main` (87 commits, no conflicts). The 15:36Z automated review did
not run (reviewer quota). Findings of the 15:15Z review already fixed by `ad682da`/`47a31e7`:
the missing rework report, the `dwebp` stdout limit and the machine-bound report path.

| Item | Resolution |
| --- | --- |
| Human request: TypeScript instead of plain JS | The eight test files are now `.ts` and type-check under the same strict `tsconfig` as the sources (122 errors resolved, no `any`). Malformed-input fixtures are passed as `unknown`, the type `validateManifest` already accepts. Source types were corrected where tests exposed them: `AssetExtras` listed 4 of the 9 fields the writer records, and calibration/accessor checks now take only the fields they read. `pnpm test:assets` / `pnpm check:assets` added. |
| CLI exit contract untested (LOW) | `tests/cli.test.ts` spawns the CLI: exit 0 with artifact and report, exit 2 with `FAIL` lines and a report, exit 2 with usage. RED: a missing manifest file crashed with a stack trace and exit 1. It now writes a failing report with `cannot read manifest <path>`. |
| `collision.triangles` counted quads (suspicion) | RED test expected 80 and got 40. It now counts index triangles like the LOD metrics; the sample report was regenerated (the GLB stayed byte-identical). |
| CI `quality-gate` failed: 57 F16 floor blocks | The gate counts any mid-line `;`, including JSDoc clauses and inline type literals. Comments became sentences and type fields one per line; two lines over 100 columns were wrapped. No rule relaxed. |
| Visual review (new) | Rendering the sample GLB with three.js `GLTFLoader` in headless Chrome showed **the default scene without ground**: `render/ground` was a root of both the default and `lod1` scenes, and the loader builds one object per node, so only `lod1` kept it. RED test, fix (`render/lod1/ground` reuses the mesh) and a new acceptance check `render.scenes_disjoint`. After the fix the default scene renders 9 meshes over 256 × 192 m; every footprint lies inside the ground. |

Evidence run on the final tree (Node 24.18, kimün 0.26.0):

| Command | Result |
| --- | --- |
| `pnpm test:assets` | 80 pass, 0 fail |
| `pnpm check:assets` | strict `tsc`, 0 errors, tests included |
| `node --test --experimental-test-coverage "tools/assets/tests/*.test.ts"` | all files 96.69 % lines, 86.31 % branches, 99.07 % functions; CLI 100 % |
| `python3 tools/quality/gate.py --root .` | 94.92 A+, 0 floor blocks; in `tools/assets` only 9 magic-number reviews (fixture constants) |
| `km score tools/assets` | 93.5 A+ at `47a31e7` → 93.9 A+ |
| `km dups tools/assets` | 1.0 % |
| `python3 tools/ci/tamper_check.py origin/main HEAD` | 0 findings |

Visual limits that remain: the 16 × 16 `paving.webp` is stretched over the whole 256 × 192 m
ground (normalized per-quad UVs, documented as placeholder tiling), so it reads as blurred blocks
rather than paving. The sample is synthetic massing (flat boxes); it validates the pipeline, not
art quality.
