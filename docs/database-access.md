# Database access boundary

The HTTP API calls typed repositories in `desire-persistence`. It does not construct
business SQL, inspect PostgreSQL rows, bind SQL parameters, or own database transactions.
Request payloads, `Caller`, authorization policy, response pagination and `ApiError`
remain in `desire-api`. Repositories accept domain records or storage commands and
return domain DTOs, `Option`/affected-row results, and redacted persistence errors.

## SQL, repositories and an ORM

The current driver remains `postgres` 0.19. Queries use bound parameters; dynamic
identifiers exist only in private helpers whose table names are adapter constants.
This change introduces no dependency, schema migration, alternate database service,
or second set of generated domain models. Keeping explicit PostgreSQL transactions
preserves the existing campaign scoping, actor/character atomicity, optimistic
revisions, idempotency and outbox guarantees.

An ORM could reduce CRUD SQL and check more query structure, but it would not define
these application policies or transaction guarantees. Diesel validates its query DSL
against a Rust schema; SeaORM uses entity models and also supports raw SQL; SQLx keeps
SQL explicit and can check queries using database metadata. Those are alternative
persistence implementations, not a replacement for this layer boundary. Their benefits
must be weighed against maintaining additional storage mappings and replacing the
connection/transaction integration.

- [Diesel schema and query model](https://docs.diesel.rs/main/diesel/index.html)
- [SeaORM entity model and raw SQL](https://github.com/SeaQL/sea-orm)
- [SQLx checked SQL and offline metadata](https://github.com/launchbadge/sqlx)

The decision for this PR is to keep the existing driver and finish the typed repository
boundary. A later ORM or checked-SQL migration can preserve handlers, payloads and wire
DTOs, but it must still adapt repositories and the `Db` connection bridge. The repository
methods currently receive a concrete `postgres::Client`; this is not a driver-independent
port or a promise of a drop-in ORM migration.

## Responsibilities and preserved behavior

- `MembershipRepository` reads stored membership/owner data. The API decides whether
  an operation needs membership or DM rights and retains the non-member 404 behavior.
- `CharacterRepository` owns writes to characters and their actor projections in one
  transaction, including both revisions. Failed actor writes roll back the character.
- Note repositories choose `Audience::All` or `Audience::Players` in SQL; the API must
  derive that audience from an already-authorized membership. Repositories are not an
  authentication service and do not grant permissions by accepting an audience value.
- `FetchPage` describes a fetch window, including the look-ahead row. The API validates
  HTTP page limits and serializes `PageBody`; persistence does neither.
- `None` and affected-row results remain storage facts. The API maps absent reads to
  404, stale revisions to 409, and foreign-key failures on delete to `resource_in_use`.
- Scene writes keep D08's stream-lock/outbox transaction. The API retains request-body
  identity checks for replay, including a concurrent retry after the first transaction
  completes. SQL and transaction implementation remain in persistence.
- The synchronous driver still runs through `spawn_blocking`. `Db` retains connection
  setup, reconnection and its bounded liveness check. `tokio-postgres` is used only for a
  cancellable reconnection probe, because the blocking driver has no handshake deadline; these
  infrastructure concerns do not belong in each resource repository.

The architecture regression checks production API code for database execution/row-binding
primitives. HTTP integration
and direct repository tests exercise real PostgreSQL. Actor revision/rollback and two-client
scene replay tests remain behavioral checks rather than being replaced by source checks.
