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
- `DATABASE_URL` is required. The process uses one blocking `postgres::Client` behind a
  mutex; requests are serialized until a pool exists. Apply the D08 migrations first.

## Endpoints

| Method | Path | Role | Result |
| --- | --- | --- | --- |
| GET | `/campaigns` | any caller | member campaigns |
| POST | `/campaigns` | any caller | 201 campaign; owner becomes DM |
| GET | `/campaigns/{campaign}` | member | campaign |
| PATCH | `/campaigns/{campaign}` | DM | rename with `expected_revision` |
| GET | `/campaigns/{campaign}/members` | member | memberships |
| POST | `/campaigns/{campaign}/members` | DM | 201 membership |
| DELETE | `/campaigns/{campaign}/members/{user}` | DM | 204; owner removal is 409 |
| GET | `/campaigns/{campaign}/scenes` | member | scenes |
| POST | `/campaigns/{campaign}/scenes` | DM | 201 scene, emits a D08 outbox event |
| GET | `/campaigns/{campaign}/scenes/{scene}` | member | scene |
| PATCH | `/campaigns/{campaign}/scenes/{scene}` | DM | update with `expected_revision` |
| DELETE | `/campaigns/{campaign}/scenes/{scene}` | DM | 409 while outbox history references it |
| GET | `/campaigns/{campaign}/characters` | member | characters |
| POST | `/campaigns/{campaign}/characters` | DM | 201 character and its actor row |
| GET | `/campaigns/{campaign}/characters/{character}` | member | character |
| PATCH | `/campaigns/{campaign}/characters/{character}` | DM | update with `expected_revision` |
| DELETE | `/campaigns/{campaign}/characters/{character}` | DM | 204; 409 if sheets/encounters reference the actor |
| GET | `/campaigns/{campaign}/journal` | member | players see `players` entries only |
| POST | `/campaigns/{campaign}/journal` | member | `players` entry; `dm` requires DM |
| GET/PATCH/DELETE | `/campaigns/{campaign}/journal/{entry}` | member / DM | hidden entries return 404 |
| GET | `/campaigns/{campaign}/knowledge` | member | players see `players` entries only |
| POST | `/campaigns/{campaign}/knowledge` | DM | 201 knowledge entry |
| GET | `/campaigns/{campaign}/knowledge/{entry}` | member | DM entries return 404 for players |
| PATCH/DELETE | `/campaigns/{campaign}/knowledge/{entry}` | DM | revision-checked update/delete |

Non-members receive 404, not 403, so campaign existence is not leaked. A member with the
wrong role receives 403. Deletes that violate a foreign key return 409
`resource_in_use`. Updates of a missing campaign-owned row return 404 before any
revision check; stale `expected_revision` values return 409 `revision_conflict`.

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
- Unknown JSON fields are rejected. Request bodies are capped at 64 KiB.
- IDs are assigned by PostgreSQL (`gen_random_uuid`); clients do not choose them.
- `Idempotency-Key` on scene creation is an optional canonical UUID. Omitting it uses
  the generated event ID, so retries are not deduplicated.

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
`invalid_request` (400), `conflict` / `revision_conflict` / `resource_in_use` (409),
`internal` (500). `x-request-id` is echoed when it is a canonical UUID.

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

Handler and store scaffolding for list/get/create/update/delete lives in macros in
`crates/api/src/routes/mod.rs` and `crates/api/src/store/mod.rs`; each resource module
declares only its SQL, payload types and role policy. Every handler still delegates
authorization and SQL to those layers.

Types for the frontend live in `src/lib/api/client.ts` and `src/lib/api/campaigns.ts`.
They derive request shapes with `Omit` from `src/generated/contracts.ts`, so a contract
change breaks the client at type-check time instead of creating a second schema.

## Known gaps

- D10 authentication and realtime transport are not implemented.
- D17 owns the final player projection and UI visibility; this API filters DM rows and
  returns 404 for hidden items as a safe default.
- Session creation is not exposed (the card does not include it), so journal entries
  need a session seeded by another path.
- Hard deletion of scenes is blocked by D08 outbox history; hard deletion of characters
  is blocked when sheets, conditions or encounters still reference their actor.
- No pagination totals, filtering, sorting or search.
- Nivel20 remains read-only and untouched.
