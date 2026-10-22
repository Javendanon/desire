# D08 tabletop expansion: persistent actors and inhabited places

Requested after the user inspected the original database diagram and identified
missing party travel, sheets, creature instances and place populations.
Baseline `46750ca`, worktree `d08-review`, branch `fix/d08-review`, PR #17.
The user explicitly expanded the D04/D08 scope; coordination is recorded in Flow.

## Delivered behaviour

- Reusable creature templates/actions; separate campaign actors, base statistics,
  HP/temporary HP, resource counters, conditions and concentration.
- Character-sheet records for ancestry/background/experience/biography, classes,
  proficiencies, equipment and spells. No real character data is invented.
- Multiple parties per campaign and journeys with a persistent participant snapshot.
  A party change does not rewrite previous travel membership.
- Place inhabitants independent of combat; separate scene placements and encounters.
  Entering combat reuses the actor and does not reset its state.
- Prepared place population with an explicit chosen quantity and stable IDs.
  Activation is atomic, campaign-scoped and once per rule. Revisits, including
  simultaneous entries, return existing instances without healing or respawning.
- Public resident projection filters campaign, presence and both visibility flags,
  and returns only identity, name, kind and disposition. No hidden creature stats.
- Migrations 0006–0009 preserve the installed 0001–0005 SQL/history. Characters,
  journeys and conditions are backfilled; unknown character scores/HP stay absent.
- Frozen v1 JSON definitions remain byte-for-byte equivalent as parsed JSON. New
  DTOs are generated into dedicated Rust modules and TypeScript; group journeys
  require explicit protocol version 2. Existing v1 events are not repurposed.
- [Model](../tabletop-model.md), [DBML](../database/desire.dbml) and
  [diagram](../database/desire.mmd). DBML has 47 tables and 85 foreign keys.
  The external copy at `/Users/javendano/dev/outputs/desire-db/desire.dbml` is current.

## RED and regression evidence

Generated logs are local `/tmp/desire-tabletop-*.log`, not versioned claims:

- Initial schema tests failed because actor tables did not exist. The final tests
  exercise independent HP, missing/wrong ability fields, campaign/edition FKs,
  character-sheet constraints, group membership snapshots, presence without combat,
  encounter ownership and upgrade of populated v5 data.
- Population tests initially failed compilation until the adapter existed. They now
  verify identical IDs after revisits, retained damage/death/conditions, complete
  rollback on duplicate IDs, cross-campaign refusal and player disclosure filtering.
- The independent advisor found REPEATABLE READ write skew in the first minimum-one
  participant guard. A concurrent two-connection test reproduced **two successful
  commits**, leaving no participant (`desire-tabletop-concurrency-red.log`).
  The guard now writes a parent MVCC version; the parent constraint trigger runs
  only on INSERT, avoiding recursive scheduling. Both READ COMMITTED and REPEATABLE
  READ tests require one failed commit and one surviving participant.
- Concurrent population activation returns the same IDs exactly once, including
  sessions configured with REPEATABLE READ defaults: the adapter explicitly opens
  READ COMMITTED transactions. It locks the rule before checking activation.
- Adapter tests caught an ambiguous PostgreSQL JSON parameter in the state CAS
  update; the SQL now casts `$1::jsonb`. Tests cover stale revisions, sheet rollback,
  valid group readback, duplicate/foreign actors and encounter state retention.
- Contract tests reject missing/invalid fields, bad scores, non-boolean sheet flags,
  negative HP, v1 group payloads and empty/duplicate participant lists. Signed
  initiative generates `i32`. Every preexisting v1 fixture still validates.

## Executed validation

All commands below passed on the final local sources. No tests were ignored.

| Command / scope | Result |
| --- | --- |
| `bash crates/persistence/test-postgres.sh` | 80 Rust workspace tests; PostgreSQL 14.19, socket-only disposable cluster |
| `cargo fmt --all --check` | pass |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | pass |
| `python3 tools/contracts/generate.py --check` | pass |
| `python3 tools/contracts/check-rust.py` | isolated core tests/Clippy pass |
| contract Python suite | 37 pass |
| quality Python suite | 42 pass |
| CI anti-tamper Python suite | 13 pass |
| `pnpm check`, `check:tests`, `check:assets` | pass; Svelte has 0 errors/warnings |
| frontend / asset tests | 89 / 137 pass |
| knowledge importer / shared fixtures | 8 entries current / 20 fixtures match |
| official `dbml2sql --postgres` | parses exported 47-table/85-FK DBML |
| `git diff --check` | clean |

The DBML was exported from metadata of a fresh cluster using these migrations,
not from a production database. Domains use base types plus checks/notes; generated
columns, deferred FKs and partial-index predicates are annotated. DBML does not
replace SQL functions/triggers or executable migrations.

## Metrics and coverage

Kimun **0.26.0**, unchanged thresholds and directory selectors:

| Scope | Before | After |
| --- | --- | --- |
| `crates/persistence` | 97.9/A++, 10 files, 749 LOC | 98.2/A++, 15 files, 1234 LOC |
| persistence duplication | 0% | 0% |
| `tools/contracts` | 93.6/A+, 4 files, 293 LOC | 93.9/A+, 4 files, 313 LOC |
| project gate | 95.20/A+, 124 files, 10140 LOC | 95.51/A+, 132 files, 10976 LOC |
| Rust tests | 64 | 80 |
| contract Python tests | 29 | 37 |

The selectors are the same, but new files expand the analyzed project/persistence
scope; these scores are not proof that every unchanged file improved. The generator
was refactored to keep primitive representations separate from composite traversal;
its individual score remains above the A- target (89.7).

Project gate: 0 floor blocks, 25 preexisting target warnings, `OK (partial)`.
`Integral approval: NO`: SQL, DBML, shell, JSON/Markdown, template semantics and
manual rules are not universally measured. Focused smells at 25 lines/3 parameters
have no new production violation; the preexisting `error.rs` function-length and
`secrets.rs` numeric-placeholder findings remain. Tests remain below the 40-line
hard function ceiling after fixture/worker extraction. No coverage percentage,
PostgreSQL 17 execution or production-role validation is claimed.

## Independent advisor

The advisor reviewed the complete expansion diff, ran 37 contract tests and generator
checks, and compared v1 definitions. Initial CHANGES_REQUESTED identified two issues:
REPEATABLE READ write skew and an overlong population function. Both were fixed with
regression evidence and smaller helpers. The final code review returned APPROVED,
with closure requested for explicit READ COMMITTED and this report; those are now
present. The reviewer did not independently rerun the database suite or Clippy.

## Remaining integration boundaries

- D09/D10 authenticate and authorize callers before adapters; campaign UUIDs are
  not permissions. No RLS, deployed grants or new HTTP endpoints are implemented.
- D14 connects place entry to population activation, scene rendering and v2 realtime
  travel events. A full v2 travel event must persist its immutable participants.
- D16 builds the sheet/encounter UI and validates game semantics. References to
  generic knowledge entries currently enforce existence/edition, not D07's catalog
  kind. Automatic class progression, preparation limits and AC are not claimed.
- Explicit replenishment uses a new authored rule; no reset or automatic respawn.
- Remote checks for the new head and final integration into main remain pending
  at report creation. Local Wasm compilation remains unavailable because the
  Homebrew toolchain lacks wasm32; CI must run the mandatory wasm-build gate.
