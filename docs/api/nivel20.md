# Nivel20 import API v1

Status: implemented in `crates/api/src/nivel20` (adapter), `crates/api/src/routes/nivel20.rs`
and `crates/api/src/store/nivel20.rs`; schema in `migrations/0012_nivel20_imports.sql`.

Scope: **one** read confirmed by D06 — campaign metadata with `Accept: application/json`.
The card forbids inventing the rest of the API. Characters, sheets, inventory, journal,
combat state and any HTML fragment are out of scope and are not parsed.

## Boundary

- Base path `/api/v1`. Source origin: `NIVEL20_BASE_URL` (default `https://nivel20.com`),
  validated at startup; it is never taken from a request body.
- `GET /api/v1/campaigns/{campaign_id}/nivel20` returns the last imported snapshot. It never
  contacts Nivel20, so it keeps working while the source is down or the session expired.
- `POST /api/v1/campaigns/{campaign_id}/nivel20/preview` reads the source once and returns
  what an import would change. It writes nothing.
- `POST /api/v1/campaigns/{campaign_id}/nivel20/import` reads the source once and stores the
  snapshot when it is new or changed.
- All three require the campaign DM; a non-member receives 404, a player 403. All three also
  require the `nivel20_import` runtime flag (`docs/flags.md`), which is off by default: while it
  is off, or the flags file is missing or malformed, every route answers 404 and no outbound
  request is made.
- Request body: `{"source_path": "/games/dnd-5/campaigns/<id>-<slug>"}`. Only the path shown
  in the browser is accepted: absolute URLs, query strings, fragments, traversal and a
  non-numeric campaign id are 400 `invalid_request`. The numeric id in the path is the
  external id; the adapter never guesses a different endpoint shape.
- No write request is ever built. `set_row_status`, `update_spell`, `/room_messages` and the
  other writes documented in [`../nivel20-api.md`](../nivel20-api.md) are not called.

## Mapping and change detection

`campaign.nivel20_campaigns` maps one external campaign to one local campaign:
`campaign_id` (primary key, references `campaign.campaigns`), `external_id` (unique,
`> 0`), `source_path`, `external_updated_at`, `snapshot` (`jsonb`) and `imported_at`.
A second local campaign importing an external id that is already mapped gets 409
`conflict`; that is the mapping invariant, not a bug. Both `preview` and `import` resolve the
mapping **before** the source read: a conflicting request is rejected without contacting
Nivel20 (so it still answers 409 while the source is down), no row is stored for the second
campaign, and a request that cannot be imported never reaches the source.

The response DTO is `CampaignMetadata`: `id`, `game_id`, `name`, `description`,
`created_at`, `updated_at`, `url`. Unknown fields are ignored, `name` is required and must
be non-blank (300 chars max), `description` is capped at 100,000 chars, and a payload whose
`id` differs from the id in `source_path` is rejected — a response for another campaign is
never mapped onto this one.

`status` is `new`, `unchanged` or `changed`. `changed_fields` lists the top-level fields a
reimport would overwrite (`external_id`, `game_id`, `name`, `description`, `created_at`,
`updated_at`, `url`). The comparison is the stored snapshot against the fresh read.

An `unchanged` import writes nothing: it keeps `imported_at`, so a repeated import is
idempotent and cannot make the change history look newer than the data. `preview` always
reports `stored: null` and `imported: false`; only `import` fills them.

## Session, CSRF and credentials

The adapter holds no session. It sends a bare `GET` with `Accept: application/json` and a
product user agent: no cookie jar, no `Cookie`, no `Authorization`, no `X-CSRF-Token`, no
credentials from Chrome, its profile database or the OS keychain. Because it never builds a
state-changing request, there is no CSRF token to handle; the "CSRF" requirement is met by
never crossing into the authenticated write surface at all.

Consequence for an expired session: the unverified reads this adapter uses are anonymous,
so expiry shows up as 401/403 from the perimeter, not as a reason to re-authenticate inside
the backend. `Nivel20Error::SessionExpired` / `AccessDenied` / `Redirected` map to
`source_requires_session` (502) and end the operation. Redirects are disabled
(`max_redirects(0)`): a login redirect is a refusal to report, not something to follow, and
`a_login_redirect_is_a_session_error_and_is_not_followed` proves the `Location` target is never
contacted.

## Source failures

| Source result | API status | `code` | Retry |
| --- | --- | --- | --- |
| 200 + valid JSON for the same id | 200 | — | — |
| 401, 403, 3xx | 502 | `source_requires_session` | none |
| 404 | 404 | `source_not_found` | none |
| 429 | 503 | `source_rate_limited` | none |
| 5xx, timeout (8 s), connection failure | 503 | `source_unavailable` | none |
| non-JSON, oversized (> 200 KB), wrong id, other 2xx (e.g. 202), unexpected 4xx (e.g. 406) | 502 | `source_rejected` | none |

There is no background polling, no backoff loop, no 403/CAPTCHA evasion and no second
attempt of any kind: one request per call, and the caller decides when to call again. The
adapter's own failure is logged by the shared error path with the caller's `request_id` and
no headers, bodies or source text.

## Sanitized example

Synthetic identifiers only; no Nivel20 account, session or content is involved.

```sh
DM=x-desire-user:00000000-0000-4000-8000-00000000005a
curl -s -X POST http://127.0.0.1:3001/api/v1/campaigns/$CAMPAIGN/nivel20/preview \
  -H "$DM" -H 'content-type: application/json' \
  -d '{"source_path":"/games/dnd-5/campaigns/109662-synthetic"}'
```

```json
{
  "source": "nivel20",
  "campaign_id": "00000000-0000-4000-8000-0000000000c1",
  "external_id": 109662,
  "source_path": "/games/dnd-5/campaigns/109662-synthetic",
  "status": "changed",
  "changed_fields": ["name", "updated_at"],
  "campaign": {"id": 109662, "game_id": 3, "name": "Synthetic campaign", "description": "..."},
  "previous": {"campaign": {"name": "Synthetic campaign (old)"}, "imported_at": "..."},
  "stored": null,
  "imported": false
}
```

## Known gaps

- Only campaign metadata is imported. Everything D06 left at contract/UI evidence level
  stays unimplemented, as the card requires.
- No scheduled sync and no push updates: import is a DM action, by design.
- The stored `snapshot` is replaced, not versioned; the previous row is returned in the
  response but no per-import history table exists yet.
- The adapter cannot authenticate, so it cannot read anything behind a session. A local
  bridge/extension delivering already-normalized data is the documented next option; it
  must not forward cookies either.
- `description` is stored in the snapshot but not projected into any local domain table.
- Import reads the stored row, then the source, then writes; it is not one transaction. Two
  concurrent imports of the same campaign can both report `changed` and the last write wins.
  That is acceptable for a DM action; a row lock is the fix if a concurrent sync ever exists.
- One source read is bounded at 8 s (connect + body) and the request deadline for database
  work does not shorten it, so a slow source can hold a request for that long.
