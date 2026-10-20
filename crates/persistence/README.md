# PostgreSQL persistence

D08 implements the D04 v1 contract without changing generated DTOs or domain code.

## Design and scope

- `postgres` 0.19 (locked to 0.19.14) provides parameterized SQL and transactions.
  There is no ORM, database service, pool, SQL code generator, or build-time database.
  Callers supply an already-connected `postgres::Client`, including their TLS policy.
  This is a synchronous adapter: async API handlers must use a blocking worker, not
  call it on a Tokio runtime thread. Add pooling only when the API needs it.
- `catalog` holds shared editorial content; `campaign` holds mutable campaign data;
  `private` holds DM secret bodies. Catalog imports are atomic and append-only by
  stable ID/revision: identical rows are accepted, differences return `SeedMismatch`.
  Removed or duplicate anchors are errors too. Nothing silently overwrites installed content.
- All contract entities have normalized storage, including logical `maps`, place
  anchors, travel coordinates, and typed secret subjects. Composite foreign keys
  enforce city, campaign, controller membership, and rules-edition relationships.
  The deferred owner FK permits atomic campaign/DM-membership creation, but rejects
  a missing owner or subsequent owner demotion at commit.
- Initial repositories cover campaign creation/read/CAS rename, catalog seeding,
  scene create/update/read with transactional outbox/idempotency, sessions, journal,
  campaign knowledge, and separately accessed secrets. Remaining CRUD and HTTP
  validation belong to D09, identity and transport to D10, not this crate.
- `SceneWrite.expected_revision = None` means create at revision 1; updates require
  exactly the previous revision plus one. A per-campaign stream row lock serializes
  concurrent writers. Entity write, stream increment, event, and idempotency key
  commit together. Key reuse with a different request is a conflict.
- The outbox stores normalized public references, not arbitrary JSON or private
  note bodies. The implemented writer emits `SceneChanged`. Before adding a
  `TravelUpdated` writer, persist its immutable travel snapshot in the same
  transaction; do not reconstruct an old event from a later mutable travel row.

## Security boundary

These adapters are not an authorization service. D09/D10 must authenticate the
caller and verify membership/DM permissions **before** calling a repository.
Campaign-owned reads require both campaign ID and resource ID. Player journal and
knowledge reads filter `visibility = 'players'` in SQL and return player-only DTOs.
Secret queries never participate in those reads. No RLS policy is claimed here.

Use a deployment/migration role only for explicit upgrades. Runtime roles should
receive `USAGE` and `SELECT` on `catalog`, not editorial mutation or DDL rights;
receive only necessary DML on `campaign`; and receive `private` privileges only for
the authorized DM path. New schemas/tables do not grant public access; `private`
explicitly revokes it. Role provisioning belongs to the deployment/auth owner,
not migrations that create cluster-wide users. Tests use a disposable superuser,
so deployment-role grants and API authorization remain integration work.

Errors expose operation/IDs and SQLSTATE, not PostgreSQL row details, in `Display`
and `Debug`. The original error remains available through `Error::source()` for
controlled diagnostics; never serialize/log that source to an untrusted audience.
Do not log connection strings or secret/note bodies.

## Safe upgrades

Call `desire_persistence::migrations::apply(&mut client)` explicitly after checking a
backup and rehearsing the upgrade against an isolated restored copy. Connecting or
constructing a repository never runs migrations. `apply_through` supports rehearsal
of any forward prefix, not downgrade.

The four numbered SQL files are embedded in the crate. An advisory transaction
lock serializes migration runners. History is always stored in
`public.persistence_migrations`, independent of connection `search_path`. The
installed ordered prefix and exact SQL
text must match before any new SQL runs. History recording and all pending DDL
are in one transaction. Unknown, edited, missing, or out-of-order history and
requests to downgrade fail without modifying data. Do not edit a deployed file;
add a new numbered migration and extend the embedded list. These initial scripts
contain no drops, truncation, cascading deletes, or destructive automatic upgrade.

No production upgrade, backup/restore, PostgreSQL volume, Docker service, or network
port was touched for this task. Database lifecycle is not an application side effect.

## Reproduce the checks

Prerequisites: Cargo/Rust 1.97.1 and the PostgreSQL server binaries (`initdb`,
`pg_ctl`). `psql` is only needed for manual inspection; the automated checks do not use it.

```sh
bash crates/persistence/test-postgres.sh
bash crates/persistence/tests/test-environment.sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
python3 tools/quality/gate.py --json .local/d08/after.json
km score crates/persistence
km smells crates/persistence --max-lines 40 --max-params 4
km cycom crates/persistence --per-function
km cogcom crates/persistence --per-function
km dups crates/persistence
```

The harness initializes a fresh cluster under this worktree's `.local/d08/`, disables
TCP listening, clears inherited libpq environment settings, and uses a private Unix
socket. The environment regression wrapper supplies hostile routing settings and
must still pass. Each Rust integration test creates a separate database in that
cluster (names include the PID, a timestamp and a per-process counter, so a recycled
PID cannot collide). The harness then runs the entire Rust workspace suite and
stops/removes only its own cluster, also on failure.

The harness no longer seeds a schema of its own: `tests/sql_constraints.rs` installs
the schema with `migrations::apply` and executes `tests/schema.sql` and
`tests/constraints.sql` against that database, so the "from zero" path exercised by
CI is the production migration runner and the SQL rejection assertions run inside it.
A direct `cargo test --workspace` without `DESIRE_TEST_SOCKET` fails with instructions
rather than skipping database checks or falling back to an existing database. Never
point that variable at another service. Trust authentication and disabled fsync are
for this disposable, socket-only test cluster, not deployment settings.

`tests/pipeline.rs` guards the pipeline contract: it fails if CI or `package.json`
go back to a bare `cargo test --workspace` or stop running the frontend, test
type-check and contract suites. It reads tracked repository files, so a sparse
checkout must include `.github/` and `package.json`.

## Manifest handoff to D01

Only the workspace member in root `Cargo.toml` and generated `Cargo.lock` were
changed outside D08's directories. All new dependency declarations are in this
crate's manifest; no frontend, toolchain, Compose, core contract, or API manifest
was changed. D01/integrator review of this narrow manifest delta is still required;
no external coordination or approval is claimed.

## CI handoff to D24/integrator

The PR that follows this change wires the harness instead of leaving the blocker for
the merge queue: the `rust-test` job puts the runner's PostgreSQL binaries on `PATH`
and runs `bash crates/persistence/test-postgres.sh`; `frontend-check` also runs
`pnpm test:frontend` and `pnpm check:tests`, and `quality-gate` runs
`python3 tools/contracts/generate.py --check` plus the contract `unittest` suite.
`package.json` `test:rust` (and therefore `pnpm test`) points at the same harness.

`.github/workflows/ci.yml` and `package.json` are `never_paths` in
`merge-policy.json`, so this is `T2-never`: the CI owner and the D01/integrator must
review and own the workflow and script edits, and the job names stay the merge-policy
contract. The workflow was not executed remotely from this worktree; the wiring is
verified locally by `tests/pipeline.rs` and by running the harness the job now runs.
