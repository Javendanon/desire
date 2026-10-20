# D13 review rework

Base: `999a4d3`. Card: `529b87a9-eec0-42e0-b08c-abf7f5719edb`.
The existing assigned worktree/branch is retained; no board mutations are requested.

## Plan and impact (before implementation)

1. Add an inside-sphere regression, then fix the shared intersection calculation. Callers:
   `picking.ts` (D11 pieces) and `map-viewer.ts` (places), through `closestSphere`.
2. Add actual browser touch pan/pinch and close-zoom pointer-selection checks, then disable
   native canvas gestures. Preserve existing input handling.
3. Trace only the Market approach corridors from the checksum-verified D05 raster, not from
   street label anchors. Test calibration, independent trace checkpoints, and footprint
   clearance; render the same generic corridor data used by lot reservation.
4. Measure allocated graphics resources and CPU heap through a representative sector sweep
   and unload/reload cycle. Set explicit budgets and assert them, including geometry,
   textures, render targets, and content caches, not just instance matrices.
5. Add `test:frontend` to the existing required `frontend-check` job and local merge policy.
   The explicit review request authorizes these two shared policy files; no job is renamed.
6. Run tests, same-scope km gate, self-audit and independent advisors; record results and commit.

Risk: medium. Rendering is shared by map viewers; the optional corridor input must preserve
maps without streets. D04 generated contracts and D05 reference JSON remain untouched.
No dependencies, lockfiles, Rust code, Docker services or external data integrations change.
The five requested fixes are the approved work plan; no new release-planning scaffold is needed.

## Baseline

- `pnpm test`: 71 frontend tests pass; Rust workspace tests pass.
- `python3 tools/quality/gate.py`: km 0.26.0, A+ 94.87, 58 files / 5424 LOC;
  zero floor blocks, 23 target warnings, partial coverage only.
- Logs: `outputs/d13-before-tests.log`, `outputs/d13-before-gate.log` (local ignored artifacts).
- Raster `/tmp/waterdeep.jpg` matches D05 SHA-256
  `45f5f862095ebd7d279592b8c20ad23a8b52918504f6cc87369cf3b246790e16`.
  Source crops in `outputs/d13-reference-*.png` are local only, not redistributed.

## Changes and regression evidence

| Review request | Correction and check |
| --- | --- |
| Principal axes missing | Three Market approaches traced in raster pixels, converted with D05 scale, reserved with roof clearance and rendered from the same data. Independent pixel checkpoints and a visual comparison are recorded in [d13-street-comparison.md](d13-street-comparison.md). No further street expansion. |
| Memory limit missing | Device counters observed after readiness, GL renderbuffer storage instrumented from navigation, and CDP CPU heap sampled from startup through a two-cycle sector sweep. Explicit per-category and combined budget assertions. |
| Frontend suite omitted in CI | Existing required `frontend-check` job and local policy both execute `test:frontend` and keep reference verification. The gate name is unchanged. |
| Inside-sphere picking | Shared ray math uses the positive exit when the entry is behind the origin. Unit regression failed with `null !== 105`; close-zoom actual pointer picking passes at less than 50 m orbit radius. |
| Browser owns touch gestures | Canvas uses `touch-action: none`. Actual CDP touch events test pan/pinch, unchanged selection, no scrolling/viewport zoom and no `pointercancel`. Narrow canvas grid sizing also prevents intrinsic width from forcing browser zoom-out. |

RED commits are separate from their implementation commits. Logs for the ray, CI and corridor
failures are in `outputs/d13-*-red.log`. The first browser gesture run reached the CSS assertion
and failed with `'auto' !== 'none'`. The memory run initially failed because the resource-counter
API did not exist. During instrumentation the meter rejected an unaccounted GL format
(`R11F_G11F_B10F`) rather than silently counting it as zero; the format is now measured.

The first close-zoom test wait was too short for camera damping, so it was increased before
recording the intended CSS failure. No test was disabled. The source comparison also exposed
pre-existing depth striping, fixed with an orbit-scaled near clip, not by suppressing shadows.
Viewer types were separated to keep the runtime implementation below the 300 LOC target.

## Measured allocation budget

Backend: real headless Chrome, PlayCanvas 2.23.2, WebGL2 (SwiftShader available), high quality,
1440×900 CSS pixels, DPR 1. A separate fresh navigation at 600×900 exercises mobile touch after
the desktop memory audit. Mobile allocations are not certified by the desktop memory budget.
The fresh load is necessary: changing emulation on an already-loaded desktop page retains the
old meta viewport and can produce a misleading zoomed-out desktop layout.

| Allocation scope | Explicit limit | Final observed run |
| --- | --- | --- |
| Graphics resources | 192 MiB | 64.3 MiB observed peak bound |
| CPU heap + backing + embedder | 192 MiB | 67.6 MiB sampled peak |
| Combined | 320 MiB | 131.9 MiB conservative observed peak bound |
| Retained CPU growth, repeated sweep | 8 MiB | 0.37 MiB |

Final source verification: `outputs/d13-final-source.log`, `ok: true`, 479 heap samples, fresh-load
600×900 touch gestures pass with canvas width 600, viewport scale 1 and zero pointer cancellations.
Earlier successful desktop runs observed CPU peaks between 75.1 and 119.7 MiB, still within budget. Both sweeps visit the same ten catalog places
in order, traversing 80 distinct resident sectors in the final run (76–78 in previous runs;
camera damping affects edge transitions). The geometry counter minus the two live
64-byte instance matrices per detailed lot must remain constant, proving unloaded buffers do
not accumulate. Every waypoint also requires a healthy scene and an unchanged far shell.

Measurement includes device texture allocations (procedural maps, shadows and postprocessing
attachments), vertex/index buffers (shared meshes, markers, ground, roads, far/detail matrices),
uniform/storage buffers, and WebGL renderbuffers including their queried sample counts. The
renderbuffer hook counts storage replacements/deletions and rejects unknown formats. No texture
attachment is counted again as a renderbuffer. Graphics counters are observed each frame **after viewer readiness**;
renderbuffer allocations are observed at the GL calls from before navigation. Texture/buffer
allocations before readiness and peaks between frames are not continuously instrumented. The
graphics result is an observed allocation bound, not proof of an absolute lifetime maximum. Independent category maxima are summed
conservatively. CPU is sampled every 100 ms from `Runtime.getHeapUsage` and includes the entire
page's content caches and rendering objects, not a per-sector estimate. Garbage collection is
forced only for retained-growth endpoints, not to reduce the running peak measurement.

Limits: these are browser-visible allocated-resource measurements, **not physical VRAM** or
whole-browser RSS. Driver allocation alignment, shader/compiler caches, default swapchain,
external canvas backing not reported by CDP and other browser-process overhead are excluded.
CPU peaks shorter than the sampling interval may be missed. WebGPU, other devices, resolutions
and DPRs are unverified. `matrixBytes` remains explicitly labelled as a legacy estimate and is
not used for the scene budget. Before rework, complete allocated-resource memory was unmeasured,
so there is no comparable measured "before" total to fabricate.

## Tests and same-scope quality gate

| Check | Before | After (latest completed run) |
| --- | --- | --- |
| Project gate, km 0.26.0 | A+ 94.87, 58 files / 5424 LOC | A+ 94.85, 61 files / 5567 LOC |
| Floor blocks / target warnings | 0 / 23 | 0 / 22 |
| Frontend suite | 71 pass | 78 pass |
| Rust workspace suite | pass | pass, no Rust changes |
| Svelte and TS checks | baseline passed in initial delivery | 0 errors / warnings |
| Test typecheck | not rerun for baseline | pass |
| Production build | not rerun for baseline | pass, existing large-chunk warning |
| D05 verification | initial delivery passed | 6 verifier tests pass; 20 controls / 8 wards / 10 places PASS |
| D11 WebGL2 browser smoke | not rerun for baseline | pass, render/destroy cycles |
| CI anti-tamper tooling unit suite | not rerun for baseline | 13 pass |
| Quality-tooling suite | not rerun for baseline | 42 pass |
| Rust formatting / clippy | not rerun for baseline | pass |
| Wasm release build | not rerun for baseline | BLOCKED: target standard library missing (E0463), and no `rustup` executable is available to install it |
| Frozen-lockfile install | existing dependencies | pass, no manifest/lockfile change |

All gate runs use the same root, exclusions and version. The new browser helpers are outside the
project gate's source enumeration, so they were measured separately: `km score tests/browser`
A+ 95.5 in the final helper run, zero functions above 25 effective lines in the latest
`km smells tests/browser --max-lines 25 --max-params 3 --format json` output. Remaining browser smoke parameter
warnings are pre-existing DevTools payload false positives. Geometry widths, source pixels,
viewport sizes, camera clipping, wait durations and budgets are intentional data/tuning knobs.
Four initial F16 blocks were false positives on semicolons in prose comments/HTML; the prose was
reworded and the unchanged gate rerun. No suppression, threshold or exclusion was added.

## Self-audit before independent review

- PASS scope: only the five corrections, their regressions, depth precision exposed by the
  required comparison and narrow canvas sizing exposed by mobile verification. Shared engine
  and CI/policy edits are the explicit review-requested exceptions. D04 contracts untouched.
- PASS correctness: shared picking callers inspected, deterministic geometry and roof clearance
  tested, no changes to existing sector residency/LOD logic, far shell retained.
- PASS F1–F6: zero floor violations; edited runtime files at target sizes after extracting only
  viewer types. Existing unrelated D11/tooling target warnings are reported, not waived.
- PASS F7–F14: content geography stays out of generic engine code, CPU diagnostics separated
  from scene allocation, typed public boundaries, explicit unsupported-format failures.
- PASS F15–F16: existing tests run before changes, new RED checks, all current frontend/Rust tests
  pass, no compressed runtime statements. Source crops are not redistributed.
- PASS security/supply chain: no added dependency, secret, external write, credential access,
  auth change or untrusted HTML insertion. CI gates are strengthened, not bypassed.
- PASS test quality: fast deterministic unit checks plus a separate real-browser hardware-bound
  smoke. Browser resource/gesture checks are intentionally not disguised as unit tests. F.I.R.S.T:
  fast unit suite under one second, independent deterministic inputs, repeatable seeded lots and
  bounded browser assertions, self-validating failures, and tests introduced before each fix.
  Browser timings/hardware are integration constraints, not claims of pure unit repeatability.
- No new Fowler abstraction smells found. The diagnostic object is a small public counter read,
  not a factory/framework. Tests repeat independent geometric expectations intentionally.
- No production WebGPU or physical-driver-memory approval is claimed. Full city street fidelity,
  production routing integration and unmeasured language/manual-rule coverage remain outside
  this small pilot. These limits are not a green acceptance for those unexecuted checks.

## Independent advisors

Round 1: two fresh read-only Codex reviewers independently inspected the full diff from
`999a4d3` and untracked files, ran the targeted tests (28 pass at that point), all frontend tests
(77 at that point), and test typecheck. Their Node 22 sandbox required explicit type stripping;
the author's Node 26 runs the declared Node ≥24 commands directly. Reviewer B independently
reproduced product score 94.845. Their full gate and browser reruns were blocked by read-only
sandbox temporary-directory restrictions, not recorded as passing.

Both requested changes; neither found an additional production correctness bug:

| Finding with evidence | Disposition |
| --- | --- |
| A: `map-gestures.mjs:52`, current mobile run lacked completed passing evidence | Fixed test setup: fresh mobile navigation applies the meta viewport instead of resizing an already-loaded desktop page. The final full run passes gestures, width/scale assertions, desktop sweeps and memory budgets. |
| B: `map-gestures.mjs:52`, 29 effective function lines exceeded target 25 | Cohesive mobile-load setup extracted; current km target check reports zero long functions. No floor/target was changed. |
| A+B: `waterdeep-smoke.mjs:89`, frame-observed graphics counters start after readiness | Documented explicitly above and in the content README: unobserved startup/between-frame texture/buffer peaks are not claimed covered. Renderbuffers and CPU begin earlier. |
| B (consider): `map-corridors.test.ts:47`, centreline-only tests were weaker than square caps | Added an independent check against every rendered quad boundary and its square caps, including roof radii. Also cover invalid widths and duplicate vertices. Frontend count is now 78. |

Round 2: **both reviewers APPROVED the scoped rework**, with zero remaining must-fix or
should-fix findings. Each independently ran 29 targeted tests, all 78 frontend tests and the test
typecheck, reproduced km 94.845, inspected the raster/render comparison and checked the final
browser evidence. A cited `map-memory.mjs:84` and `map-corridors.test.ts:51`; B cited
`streets.ts:48`, `map-memory.mjs:81` and `ray.ts:39`. They confirmed the five fixes and honest
measurement limits, unchanged D04 contracts and no generic-engine city identity. Raw local
reports: `outputs/d13-advisor-{a,b}-round2.txt`. Their sandbox restrictions still prevented
independent Chrome/full-gate reruns. No integral project or Wasm approval is inferred.

A final formatting self-check wrapped three overlong test lines. Mobile canvas assertions were
kept in the cohesive mobile-load helper so the unchanged 25-line function target also holds.
The complete Chrome check was rerun on that final source and passed again, including all memory
budgets and mobile gestures (`outputs/d13-final-source.log`).

## Coverage and remaining blockers

Node's instrumented frontend coverage (excluding tests and dependencies) was measured separately.
It covers imported modules, not every file in the project. Final run: 97.08% lines,
92.70% branches overall; `streets.ts` and `corridors.ts` 100% lines/branches/functions,
and `ray.ts` 100% lines / 93.33% branches. GPU renderers, camera projection and canvas input are exercised by the browser smoke,
not counted as Node unit coverage. No universal coverage percentage is claimed.

The project gate remains **partial**, not integral approval: Markdown/JSON/TOML and full
Svelte/HTML semantics require manual review, and physical GPU memory/WebGPU are unmeasured.
The native Rust suite, formatting and clippy pass. The additional Wasm build is **blocked** by
missing `wasm32-unknown-unknown` standard libraries; the attempted installation command is also
blocked because `rustup` is not installed in this shell. See `outputs/d13-wasm.log` and
`outputs/d13-wasm-target.log`. Do not interpret the frontend or quality-gate success as a
passing Wasm CI gate. No Docker service, external integration, board state or D04 contract changed.
