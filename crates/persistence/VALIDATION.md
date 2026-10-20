# D08 validation

Card: `df202da4-146f-4c3c-9855-4919e35af73f`.
Branch: `task/d08-crear-migraciones-postgresql-y-repositor`.
Baseline: `dd8b200` (the available merged D01/D04 dependency baseline from
`origin/main`, fast-forwarded into this worktree before implementation).
The board assignment/status was not changed.

## Before and after

Same worktree, gate configuration, exclusions, and kimun **0.26.0**:

| Measurement | Before | After |
| --- | --- | --- |
| Project `rs/ts/js` score | 94.99 (A+) | 95.48 (A+) |
| Analyzed product files / LOC | 41 / 3513 | 50 / 4231 |
| Floor-blocking findings | 0 | 0 |
| Target warnings | 25 | 26 |
| Rust workspace tests | 15 passed | 34 passed |
| New persistence integration tests | No persistence crate | 19 passed |
| Focused persistence score | No persistence crate | 97.9 (A++) |
| Focused duplication | No persistence crate | 0% |

The scope is the current project sources selected by the unchanged gate, including
new files after implementation; the before state has no persistence sources to score.
Both runs exceed floor 77 and target 87. This is **not overall approval**: SQL,
shell, tests, TOML, Markdown and deployment authorization need explicit/manual review.
`km` excludes tests and does not correctly identify every Rust function (some are
labeled `Ok`). Its observed complexity maxima are cyclomatic 4 and cognitive 4,
not proof that every function was parsed. Public signatures use at most 3 parameters.

The baseline has 25 target warnings in pre-existing UI/engine code. Additional
Rust heuristic warnings vary with function grouping (for example `error.rs`'s
`Ok` is not a declared function); no gate suppression or threshold was changed.
The focused smells command reports numeric SQL placeholders and the shell's
`2>&1` redirect as magic numbers, not domain constants. SQL constraints use the
contract's named PostgreSQL revision/edition/finite-number domains.

## Executed checks

- `bash crates/persistence/test-postgres.sh` and the hostile-environment regression
  `bash crates/persistence/tests/test-environment.sh`: PostgreSQL **14.19**, all 34
  Rust workspace tests passed (19 new DB integration tests), plus 25 SQL rejection
  assertions and schema-presence assertions. No ignored/skipped DB tests.
- `cargo fmt --all --check`: passed.
- `cargo clippy --workspace --all-targets --locked -- -D warnings`: passed.
- `python3 tools/quality/gate.py --json .local/d08/after.json`: exit 0 for measured
  floor checks; manual/unmeasured coverage remains explicitly unapproved.
- Focused `km score`, `smells --max-lines 40 --max-params 4`, `cycom --per-function`,
  `cogcom --per-function`, and `dups`: executed.
- `corepack pnpm install --frozen-lockfile`: passed without manifest changes.
- `corepack pnpm run test:frontend`: 41 passed.
- `corepack pnpm run check`, `check:tests`, and `build`: passed.
- Quality tooling Python suite: 42 passed; contract Python suite: 29 passed.
- `python3 tools/contracts/generate.py --check`: passed.
- `git diff --check`: passed.

`pnpm run test:holdout` exited 0 but ran **zero tests** because this worktree's
pre-existing sparse checkout excludes `tests/holdout/`. That is not holdout coverage.
No holdout file was read or materialized. No Wasm build, browser E2E, PostgreSQL 17
run, production upgrade, backup/restore rehearsal, deployment-role test, or numerical
line/branch coverage measurement is claimed.

## Behavioral coverage

- Fresh schema installation; every version prefix 0–4 upgraded to current; repeated
  migration runs; preservation of saved campaign/catalog data across upgrade.
- Schema-qualified migration history remains stable after connection search-path
  changes. Rejection of edited history, unknown target, and downgrade; failed DDL rolls back
  both the schema and migration history.
- Idempotent catalog imports including calibration, chunks and anchors; mismatch
  errors; partial seed rollback; removed anchors reported without deletion;
  duplicate anchor identities rejected with rollback of newly inserted anchors.
- Two campaigns share a city but not scenes, journals, lore, or secrets. Player
  queries omit DM records, and secret reads require campaign and secret ID.
- Scene changes and events roll back together on an outbox conflict; idempotent
  retries do not increment the stream; stale revisions and changed key reuse fail;
  concurrent connections allocate distinct sequential revisions.
- Campaign CAS rename and atomic owner membership; contextual SQLSTATE errors with
  redacted display/debug output and inspectable source errors.
- SQL rejection checks cover duplicate membership, missing/demoted owner, character
  edition/controller mismatch, condition edition mismatch, cross-campaign session,
  travel, outbox and secret references, missing/ambiguous secret subject, wrong
  district/anchor city, invalid visibility/edition/revision, overflow, non-finite
  coordinates, negative distance, null provenance evidence, and zero calibration.
- The base place name and second campaign remain unchanged by a first-campaign
  override. All fixtures are synthetic; no external credentials or private data.

## Self-audit and boundaries

Checked correctness, parameter binding and allowlisted identifiers, scope, errors,
transaction rollback, fixed-field DTO boundaries, SRP, and linear input traversal.
No new service, frontend dependency, domain abstraction, or API/auth implementation.
Only root Cargo workspace membership and the generated lockfile cross D08 scope;
D01/integrator review remains required, with no approval claimed.

**CI integration (reviewer blocker, now wired):** the `rust-test` job used to run plain
`cargo test --workspace --locked`, which is exit 101 without `DESIRE_TEST_SOCKET` for every
integration test in this crate. It now puts the runner's PostgreSQL binaries on `PATH` and
invokes `bash crates/persistence/test-postgres.sh`; `package.json` `test:rust` and `test`
route through the same harness, `frontend-check` runs `test:frontend` and `check:tests`, and
`quality-gate` runs the contract generator drift check and the contract `unittest` suite.
`tests/pipeline.rs` fails if any of that wiring regresses. No tests were disabled or skipped.
`.github/workflows/ci.yml` and `package.json` are `merge-policy.json` `never_paths`, so the
change is `T2-never`: the CI owner and D01/integrator must review and own those two files.
Remote CI was not executed from this worktree.

Repository calls assume an authorized server caller; deployment privileges and
identity checks are D09/D10 integration obligations. Further CRUD and immutable
travel event snapshots are explicitly not implemented by the initial adapters;
see `README.md`. There is no production migration runner side effect.

## Independent advisor

Round 1: reviewer A scored 91/100 and reviewer B scored 92/100, both requesting
changes with file/line evidence and independent executable probes. A reproduced
inherited `PGHOSTADDR` bypassing the test socket (`test-postgres.sh:15`); B reproduced
duplicate anchors masking removal (`src/catalog.rs:111-151`). Both identified
F1 violations in long tests (`tests/isolation.rs:46,138`, `tests/repositories.rs:90`).
A also requested shorter catalog/migration/scene functions.

Added failing regression checks before fixes. The harness now clears all inherited
`PG*` settings; its hostile-environment wrapper passes without external connections.
Anchor imports reject duplicate map-version IDs before set cardinality can be
misinterpreted; a failed replacement rolls back the new anchor. Test scenarios and
fixtures are split into functions below the hard F1 ceiling, and the named source
functions were shortened. No threshold or metric suppression was changed.
Round 2: both independent reviewers returned scoped PASS, **96/100** each, with
no must-fix findings. A and B noted one 101-column SQL line; B additionally
reproduced history lookup failure after changing `search_path`. Wrapped the SQL
line and added a failing search-path regression before qualifying the history
table as `public.persistence_migrations`. Some fixture-heavy tests remain 26–35
lines: below the hard ceiling, kept explicit rather than adding more factories.
Round 3: two fresh-context reviewers independently verified the follow-up diff
`d5ed1f4..f6db31e`, including the search-path regression, SQL line width, and CI
handoff. Both returned targeted **PASS, 98/100**, with no remaining findings.
Both reran the hostile-environment suite (34 Rust tests, 19 persistence tests,
25 SQL rejection checks), fmt, Clippy, and scoped diff checks successfully.
Evidence cites `src/migrations.rs:31,48,60`, `tests/repositories.rs:23-43`, and
`migrations/0003_notes.sql:72-73`. Full scoped review passed in round 2; round 3
approved its follow-ups. Neither approval covers remote CI, PostgreSQL 17,
deployment roles, production upgrades, or backup/restore.

Implementation is committed through `f6db31e`; this validation record is committed
separately. Integration remains blocked on D01 manifest review and D24/integrator
CI harness wiring. The card was not moved or reassigned.

Local raw evidence is under `.local/d08/` (gitignored): baseline/final test logs,
RED logs, gate JSON/logs, focused metrics, frontend/tooling results, and reviewer
reports. Reproduce with the commands above instead of treating these scores as
frozen invariants.

## Rework round: pipeline findings

Card rework addressed the two review findings and the three suspicions.

| Finding | Change | Evidence |
| --- | --- | --- |
| BLOCKER `ci.yml:79` bare `cargo test --workspace` | `rust-test` adds the runner's PostgreSQL `bin` directory to `GITHUB_PATH` (newest installed major, printed; fails closed if none) and runs the harness; `package.json` `test:rust` and the `merge-policy.json` `rust-test` gate `cmd` run the same harness | `tests/pipeline.rs` (RED before the edits: 3 failed; green after: 4 passed) |
| MEDIUM `ci.yml:48` suites never run | `frontend-check` runs `test:frontend` + `check:tests`; `quality-gate` runs `tools/contracts/generate.py --check` + contract `unittest` discover. Existing jobs extended, no job renamed (merge-policy contract) | `tests/pipeline.rs::ci_runs_every_existing_suite` |
| Suspicion: PID-based database names never dropped | `tests/support/mod.rs` names databases with PID + wall-clock nanosecond stamp + counter, so a recycled PID cannot collide within one cluster | `tests/support/mod.rs:20-33`; 19 DB tests pass |
| Suspicion: harness seeded a schema with `psql -f`, never recording `public.persistence_migrations` | `test-postgres.sh` now only starts/stops the cluster; `tests/sql_constraints.rs` installs the schema with `migrations::apply` and runs `schema.sql` + `constraints.sql` on it. The from-zero path under test is the production runner | sabotage run (expected SQLSTATE changed to `99999`) failed the harness with exit 101; restored file passes |
| Suspicion: PG 14 here vs PG 17 in `compose.yaml` | Not closed. Local evidence is PostgreSQL 14.19 on macOS; CI runs the runner image's newest installed major. No PG 17 run, container, or volume was created | see the boundary list above |

Executed after the rework, same toolchain and gate configuration:

- `bash crates/persistence/test-postgres.sh`: exit 0, **43** Rust tests passed (15 test
  binaries/doc-test targets), including the 3 `sql_constraints` tests carrying the
  25 SQL rejection assertions plus the migration-embedding guard, and the 6 `pipeline`
  tests. No test ignored or skipped.
  The hostile-environment wrapper (`tests/test-environment.sh`) also exits 0.
- `cargo fmt --all --check` and
  `cargo clippy --workspace --all-targets --locked -- -D warnings`: exit 0.
- `corepack pnpm run test:frontend` (41 passed), `corepack pnpm run check:tests`,
  `python3 tools/contracts/generate.py --check`, contract `unittest` suite (29 passed).
- `python3 tools/quality/gate.py --json .local/d08/rework.json`: exit 0 for floor checks.
- Focused `km score`/`smells`/`cycom`/`cogcom`/`dups` on `crates/persistence`: unchanged
  thresholds, no suppression added.

`pnpm test:rust` now requires PostgreSQL server binaries on `PATH`, which is a public
behaviour change of an existing script; `README.md` and `docs/app-tests-plan.md` record it.
`.github/workflows/ci.yml`, `package.json` and `merge-policy.json` are `never_paths`
(`T2-never`): the CI, policy and D01/integrator owners must review and own those edits.
The `frontend-check` and `quality-gate` policy `cmd` values remain approximations of their
CI jobs; aligning them is the policy owner's call. CI wiring, the PG 17 gap, and
deployment-role behaviour remain unverified from here.

### Independent advisor on the rework

Two fresh-context reviewers reviewed commit `f6d8259` with adversarial instructions and
cited `file:line`. Both returned `CHANGES_REQUESTED` (76/100 and 72/100) for the same
BLOCKER: `merge-policy.json` still ran `cargo test --workspace --locked` in its `rust-test`
gate `cmd`, so the local gate stayed red even though the CI job was wired. Taken for this
follow-up: the gate `cmd` now runs the harness; `tests/pipeline.rs` asserts the gate `cmd`
and parses CI **job blocks** instead of raw file text, so a comment or a neighbouring job
cannot satisfy it; the PostgreSQL `PATH` step fails closed with an explicit `::error::`
message instead of an empty `GITHUB_PATH` line. Both reviewers confirmed the schema-seeding
and PID-collision suspicions closed and PG 17 still open.

Round 3 (same two reviewers, adversarial, on `ceec9c7`) returned **87/100 PASS** and 76/100
`CHANGES_REQUESTED`. Taken from it: the job parser drops comment lines (and a parser test
proves a commented-out command does not satisfy the guard), the harness runs `cargo test`
unconditionally instead of exiting 0 when `crates/persistence/Cargo.toml` is absent, the
PostgreSQL discovery path now reaches its explicit `::error::` with no binaries and no
`pg_config` (reproduced: exit 1 with the message), and the README no longer claims the local
gate and CI share one command verbatim.

Round 4 (fresh contexts, `3cf0a8c`) asked for stricter step parsing and flagged a
150-column fixture. Taken: `runs()` now only accepts a `run:` value or a line inside a
`run: |`/`>` block, so `- run: echo <cmd>` no longer counts; parser tests cover inline,
block, sequence, `name:` and `echo` forms; the fixture is `concat!`ed; the timestamp claim
is corrected to wall-clock.

Round 5 (`7e36bff`) asked for two more items. Taken: `runs()` no longer treats a line of a
multi-line `name:` as a step, and CI stopped probing `psql --version`, so the documented
prerequisite list (`initdb`, `pg_ctl`; `psql` only for manual inspection) is true again.

Round 6 (`268025f`) found that `starts_with` still accepted `bash ... || true` and that the
`pnpm test` check accepted a substring. Taken: a block command must equal the command
line-for-line, `pnpm test` must equal `pnpm run test:frontend && pnpm run test:rust`, and
parser tests cover the `|| true` and `echo` forms. Also taken: `merge-policy.json` gates are
now one field per line (the array was 115–153 columns wide), and the README describes the
wiring as part of this change instead of as a future PR.

Round 7 (`75f3f0b`) confirmed both reported CI findings fixed and raised three minor items.
Taken: `test-postgres.sh` registers its `EXIT` trap right after the cluster directory exists
and tolerates a failed `pg_ctl stop`, so a failed `initdb` leaves no cluster behind
(reproduced: a failing `initdb` exits 1 and `.local/d08` stays empty). Documented instead of
fixed: the guard is a tripwire against accidental reverts, not a workflow policy engine, so a
step guarded by `if:` can still slip through — such edits are `never_paths` and need an owner
review. PostgreSQL 17 stays open for the same reason as above.

Round 8 (`6337cb4`) reported the ROLLBACK-leak check as vacuous: the constraint fixture and
the seed share the world name it asserted. The mechanism was already sound — the seed compares
every row and fails with `SeedMismatch` — proven by deleting `ROLLBACK;` from
`constraints.sql` and running the harness: exit 101, `SeedMismatch: catalog worlds
"…0001" differs from installed content`; the file was restored. The assertion was still
rewritten to a value that differs between the fixtures (city `Waterdeep` vs `City one`) so
it distinguishes the two states on its own. Also taken: `every_migration_file_is_embedded_in_
the_runner` compares `migrations/*.sql` with the installed history, closing the coverage the
deleted `psql` loop used to give; reproduced RED by adding an unembedded
`migrations/0005_guard_check.sql` (harness exit 101), then removed it.

Left open by decision: the `frontend-check` and `quality-gate` gate `cmd` approximations
(policy owner's call, and their CI jobs now run the suites) and PostgreSQL 17 compatibility
(needs a runner or image this worktree cannot create).
