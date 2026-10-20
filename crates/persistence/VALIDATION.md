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

**CI integration blocker:** `.github/workflows/ci.yml:79` still runs plain
`cargo test --workspace --locked` without the isolated PostgreSQL harness. Reproduced
that command without `DESIRE_TEST_SOCKET`: exit 101 with explicit setup errors.
The complete suite passes through the harness, but the current CI test job will
not pass until its owner supplies PostgreSQL binaries and invokes the harness.
No tests were silently disabled and no out-of-scope workflow edits were made.
See the D24/integrator handoff in `README.md`; remote CI was not executed.

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
