# Campaign API v1

Status: implemented in `crates/api`. D10 replaces the development identity header before any
shared deployment; D17 owns player projections in the UI.

## Boundary

- Base path: `/api/v1`. Liveness stays at `/api/health`.
- Responses reuse the generated D04 DTOs in `crates/core/src/contracts/`. Requests are
  hand-written payloads because create/update shapes differ from stored records.
- Handlers parse input, then call `access` (membership/role policy) and `store` (SQL).
  No handler contains SQL or domain calculations.
- `x-desire-user: <uuid>` is the caller identity. It is a development seam, not
  authentication: the server refuses a non-loopback bind unless `DESIRE_DEV_IDENTITY=1`
  is set explicitly. D10 must replace it with authenticated identity.
- `DATABASE_URL` is required and parsed at startup; the process builds its own Tokio
  runtime only after the first connection exists, so the blocking client never blocks
  inside a runtime. Apply the D08 migrations first
  (`DATABASE_URL=... cargo run -p desire-api -- --migrate`).
- One blocking `postgres::Client` behind a mutex serializes requests until a pool exists.
  Each request starts with a `SELECT 1` liveness ping: a client the server closed is
  replaced from the same settings, so a restarted database breaks at most the request
  already in flight. `/api/health` stays a liveness check and never touches the database.

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
| GET/PATCH/DELETE | `/campaigns/{campaign}/journal/{entry}` | member / DM | hidden entries return 404 |
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
  not deduplicated.

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
canonical UUID.

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
- Scene deletion is not exposed: the D08 outbox keeps a reference to every written
  scene. Character deletion is blocked (409) when sheets, conditions or encounters
  still reference their actor.
- No pagination totals, filtering, sorting or search.
- Nivel20 remains read-only and untouched.
