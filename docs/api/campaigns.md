# Campaign API v1

Status: implemented in `crates/api`. D10 replaces the development identity header before any
shared deployment; D17 owns player projections in the UI.

## Boundary

- Base path: `/api/v1`. Liveness stays at `/api/health`.
- Responses reuse the generated D04 DTOs in `crates/core/src/contracts/`. Requests are
  hand-written payloads because create/update shapes differ from stored records.
- Handlers parse input, then call `access` (membership/role policy) and `store`
  (application operations). Business SQL and transactions live in typed repositories in
  `desire-persistence`; the API does not bind rows or SQL parameters. See
  [the database-access boundary](../database-access.md) for the driver decision and limits.
- `x-desire-user: <uuid>` is the caller identity. It is a development seam, not
  authentication: the server refuses a non-loopback bind unless `DESIRE_DEV_IDENTITY=1`
  is set explicitly. D10 must replace it with authenticated identity.
- `DATABASE_URL` is required and parsed at startup; the process builds its own Tokio
  runtime only after the first connection exists, so the blocking client never blocks
  inside a runtime. Apply the D08 migrations first
  (`DATABASE_URL=... cargo run -p desire-api -- --migrate`).
- One blocking `postgres::Client` serializes requests until a pool exists. Each request starts
  with a liveness check bounded by the database deadline. A dead client is replaced after a
  cancellable handshake probe, and the blocking connection that follows runs under the same
  bound. `/api/health` stays a liveness check and never touches the database.
- Every database-backed request has a 5-second deadline covering its queue wait and work, and
  the startup connection is bounded the same way. `connect_timeout` in `DATABASE_URL` can only
  shorten it. A database that stops answering yields 500 `internal`; service returns on a later
  request once the database answers.
- A deadline does not cancel work that already started: a timed-out write **may still commit**.
  Work that had not started when the deadline passed never starts. Read the record before
  retrying. A create generates a new ID per attempt, so list the collection first; only scenes
  accept an idempotency key.
- The server enforces 15-second statement, lock and idle-in-transaction limits, except during
  migrations. A write the API stopped waiting for therefore ends by itself unless the connection
  is lost. Options in `DATABASE_URL` can override these limits. They do not shrink with
  `connect_timeout`, so a shorter deadline can abandon lanes before the server ends their work.
- An operation still running after three deadlines is abandoned and later requests use a new
  connection, so it can overlap them. Revision guards and scene idempotency still apply. At most
  eight such lanes exist; past that, requests fail at their deadline until one ends.
- The cap covers lanes, not connections. A probe opens one short-lived extra connection, and a
  retired client keeps its thread and connection until its close finishes. A peer that repeatedly
  goes silent and returns can therefore accumulate them while its sockets stay open.
- A peer that answers the probe and then stalls the blocking handshake holds a helper thread until
  its socket dies. At most eight can exist; past that, reconnection fails at once, until one ends.
- The server limits travel in the `options` startup parameter. A connection pooler that rejects
  it needs to be configured to ignore it, in which case these limits do not apply.
- Successful `PATCH` responses for campaigns, journal and knowledge come from the update's
  own `RETURNING` row, so a concurrent writer cannot change or remove what is reported.
- Persistence failures reach stderr as `request_id=<id> persistence_error=<kind>: <operation>
  (SQLSTATE <code>)`, and connection failures as `request_id=<id> database_failure="<reason>"`
  plus `cause=<category>`: an SQLSTATE, an I/O kind, `none`, `unclassified` or the handshake cap.
  Both use the caller's request ID, and lane events log it without a cause. Responses stay sanitized.
  The lines carry no request bodies or credentials, but operation names can include record IDs
  and a client's idempotency key.

## Endpoints

| Method | Path | Role | Result |
| --- | --- | --- | --- |
| GET | `/campaigns` | any caller | member campaigns |
| POST | `/campaigns` | any caller | 201 campaign; owner becomes DM |
| GET | `/campaigns/{campaign}` | member | campaign |
| PATCH | `/campaigns/{campaign}` | DM | rename with `expected_revision` |
| GET | `/campaigns/{campaign}/members` | member | memberships |
| POST | `/campaigns/{campaign}/members` | DM | 201 membership |
| DELETE | `/campaigns/{campaign}/members/{user}` | DM | 204; owner or controlled-character removal is 409 |
| GET | `/campaigns/{campaign}/sessions` | member | sessions |
| POST | `/campaigns/{campaign}/sessions` | DM | 201 session |
| GET | `/campaigns/{campaign}/scenes` | member | scenes |
| POST | `/campaigns/{campaign}/scenes` | DM | 201 scene, emits a D08 outbox event |
| GET | `/campaigns/{campaign}/scenes/{scene}` | member | scene |
| PATCH | `/campaigns/{campaign}/scenes/{scene}` | DM | update with `expected_revision` |
| GET | `/campaigns/{campaign}/characters` | member | controlled characters; NPCs are DM-only |
| POST | `/campaigns/{campaign}/characters` | DM | 201 character and its actor row |
| GET | `/campaigns/{campaign}/characters/{character}` | member | uncontrolled characters 404 for players |
| PATCH | `/campaigns/{campaign}/characters/{character}` | DM | update with `expected_revision`; `controller_id` is required, `null` clears it |
| DELETE | `/campaigns/{campaign}/characters/{character}` | DM | 204; 409 if sheets/encounters reference the actor |
| GET | `/campaigns/{campaign}/journal` | member | players see `players` entries only |
| POST | `/campaigns/{campaign}/journal` | member | `players` entry; `dm` requires DM |
| GET | `/campaigns/{campaign}/journal/{entry}` | member | hidden entries return 404 |
| PATCH/DELETE | `/campaigns/{campaign}/journal/{entry}` | DM | revision-checked update/delete |
| GET | `/campaigns/{campaign}/knowledge` | member | players see `players` entries only |
| POST | `/campaigns/{campaign}/knowledge` | DM | 201 knowledge entry |
| GET | `/campaigns/{campaign}/knowledge/{entry}` | member | DM entries return 404 for players |
| PATCH/DELETE | `/campaigns/{campaign}/knowledge/{entry}` | DM | revision-checked update/delete |

Non-members receive 404, not 403, so campaign existence is not leaked. A member with the
wrong role receives 403, and rows hidden from players also return 404. Deletes that
violate a foreign key return 409 `resource_in_use`. Updates of a missing campaign-owned
row return 404 before any revision check; stale `expected_revision` values return 409
`revision_conflict`.

Scenes have no DELETE in v1. Every scene write keeps a D08 outbox event that references
the scene, so the only possible answer was 409; exposing the route would advertise
deletion the API cannot perform. Archiving scenes needs a migration and a scope
decision, not an endpoint that always fails.

## Shared client contracts

The TypeScript `ApiProblem` name aliases the generated D04 `ApiError`; it is not a
second error schema. The existing DTO generator does not express generic type
parameters, so the generic collection envelope is pinned separately by the shared
`contracts/api-page.json` wire fixture. TypeScript derives all page metadata keys and
types from that fixture and replaces only the generic item array. A Rust test serializes
`Page::finish` with a real look-ahead row against the same fixture; client transport and
TypeScript compilation check its consumer. No frozen v1 DTO is changed.

The client transport takes `request(context, options)`: typed options group method,
path, JSON body and optional headers, while caller identity and cancellation remain in
`ApiContext`. Resource wrappers preserve the existing HTTP methods and payloads.

## Pagination

Collections accept `limit` (1–100, default 20) and `offset` (0–1,000,000, default 0):

```json
{"items": [], "limit": 20, "offset": 0, "has_more": false}
```

The server reads one extra row to compute `has_more`; there is no separate count query.

## Validation and limits

- Identifiers: canonical lowercase UUID (`8-4-4-4-12` hex).
- Campaign/scene/character names and knowledge titles: trimmed, 1–120/200 characters.
- Journal and knowledge bodies: trimmed, 1–20,000 characters.
- Provenance source/attribution: trimmed, 1–300 characters.
- `expected_revision`: positive `u32`.
- Text must not contain NUL characters: PostgreSQL rejects them, so they are a 400
  instead of a 500.
- Unknown JSON fields are rejected. Request bodies are capped at 64 KiB.
- Identifiers are 36-character canonical lowercase UUIDs; malformed `limit`/`offset`
  values also use the shared error DTO.
- IDs are assigned by PostgreSQL (`gen_random_uuid`); clients do not choose them.
- `Idempotency-Key` on scene creation is an optional canonical UUID. A retry with the
  same key and the same `name`/`map_version_id` replays the first result: same scene ID,
  same outbox event, one row of history. The same key with a different body returns 409
  `idempotency_conflict`. Omitting the key uses the generated event ID, so retries are
  not deduplicated. The header is validated on every request but only honored on scene
  creation: on the other endpoints it is ignored, not rejected.

## Error shape

Every handler error uses the D04 `ApiError` transport DTO:

```json
{
  "code": "revision_conflict",
  "message": "the expected revision is stale",
  "request_id": "2f8d4f3e-1a4b-4c6d-8e0f-123456789abc"
}
```

Codes: `unauthenticated` (401), `forbidden` (403), `not_found` (404),
`invalid_request` (400), `conflict` / `revision_conflict` / `idempotency_conflict` /
`resource_in_use` (409), `internal` (500). `x-request-id` is echoed when it is a
canonical UUID. This shape covers handler and store failures; a path that matches no
route, or a method that a route does not accept, is answered by the router itself (404
or 405 with an empty body), so a client must handle those two statuses without a `code`.

## Sanitized example

Synthetic identifiers and text; no Nivel20 data is read or written.

```sh
curl -s -X POST http://127.0.0.1:3001/api/v1/campaigns \
  -H 'x-desire-user: 00000000-0000-4000-8000-00000000005a' \
  -H 'content-type: application/json' \
  -d '{"name":"Synthetic campaign","rules_edition":"dnd_2014","city_id":null}'
```

```json
{
  "id": "00000000-0000-4000-8000-0000000000c1",
  "owner_id": "00000000-0000-4000-8000-00000000005a",
  "city_id": null,
  "name": "Synthetic campaign",
  "rules_edition": "dnd_2014",
  "revision": 1
}
```

A session and a player-visible journal entry, in the order the API requires them:

```sh
curl -s -X POST http://127.0.0.1:3001/api/v1/campaigns/$CAMPAIGN/sessions \
  -H "x-desire-user: $DM" -H 'content-type: application/json' \
  -d '{"title":"Synthetic session"}'

curl -s -X POST http://127.0.0.1:3001/api/v1/campaigns/$CAMPAIGN/journal \
  -H "x-desire-user: $DM" -H 'content-type: application/json' \
  -d '{"session_id":"<session id>","body":"Synthetic recap","visibility":"players"}'
```

Handler and store scaffolding for list/get/create/update/delete lives in macros in
`crates/api/src/routes/mod.rs` and `crates/api/src/store/mod.rs`; each resource module
declares only its SQL, payload types and role policy. Every handler still delegates
authorization and SQL to those layers.

Types for the frontend live in `src/lib/api/client.ts` and `src/lib/api/campaigns.ts`.
Every request shape is derived with `Omit` from `src/generated/contracts.ts`; there are
no hand-written draft interfaces left, so a contract change breaks the client at
type-check time instead of creating a second schema. The client covers campaigns,
members, sessions, scenes (no delete), characters, journal and knowledge, including the
single-entry reads.

## Known gaps

- D10 authentication and realtime transport are not implemented.
- D17 owns the final player projection and UI visibility; this API filters DM rows and
  returns 404 for hidden items as a safe default.
- Campaigns have no DELETE in v1. Deleting a campaign means choosing what happens to its
  memberships, scenes, actors, notes, secrets and outbox rows; that is a migration and
  scope decision, not a handler. `POST`/`GET`/`PATCH` are exposed, `DELETE` is not.
- Scene deletion is not exposed: the D08 outbox keeps a reference to every written
  scene. Character deletion is blocked (409) when sheets, conditions or encounters
  still reference their actor.
- Journal entries support update and delete for a DM only; a player can create a
  `players` entry but cannot edit or remove it afterwards.
- No pagination totals, filtering, sorting or search.
- Nivel20 remains read-only and untouched.
