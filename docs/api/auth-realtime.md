# Identity, permissions and table synchronization

Status: implemented in `crates/api` and `crates/persistence`; contract shapes are
generated from `contracts/schema.json`. This document records the security boundary,
the synchronization protocol and the limits that remain open.

## Identity

`POST /api/v1/auth/accounts` creates an account and returns its first session.
`POST /api/v1/auth/sessions` logs in with the same credentials.
`GET /api/v1/auth/identity` returns the authenticated account.
`DELETE /api/v1/auth/sessions/current` revokes the presented session.

- Usernames are trimmed, lowercased and limited to 3-64 ASCII letters, digits, `.`,
  `_` or `-`. Passwords are 12-200 characters; NUL is rejected.
- Passwords use PBKDF2-HMAC-SHA256 with 600,000 iterations, a 16-byte random salt and
  a 32-byte derived key. Only the encoded hash is stored.
- A session token is 32 random bytes encoded as lowercase hex. Only its SHA-256
  digest is stored in `identity.sessions`; the raw token is returned once.
- Sessions expire after 12 hours. Login uses one generic `unauthenticated` response
  for an unknown username and a wrong password, and an unknown username still pays
  the derivation cost.
- Requests authenticate with `Authorization: Bearer <token>`. An absent, malformed,
  expired or revoked token is `401 unauthenticated`.
- The legacy `x-desire-user` header is disabled by default, including on loopback.
  `DESIRE_DEV_IDENTITY=1` turns it back on only for a loopback bind; a non-loopback
  bind never trusts the header, so a shared deployment must use bearer sessions.

There is no password reset, account deletion, token refresh or multiple-device
session listing in this change.

## Permissions

Campaign membership is the authorization source; a campaign UUID in the path is
never authorization by itself.

| Operation | Non-member | Player | DM |
| --- | --- | --- | --- |
| Read campaign-owned resources | `404` | allowed, player projection | allowed |
| `POST /campaigns` | `401` when unauthenticated; otherwise allowed | allowed | allowed |
| Rename campaign, manage members, create scenes/sessions/knowledge | `404`/`403` | `403` | allowed |
| `GET /campaigns/{id}/sync` | `404` | snapshot/events for player-visible rows | full campaign rows |
| DM-only journal or knowledge | hidden | `404` | allowed |

The snapshot is built in SQL with the same visibility filters as the collection
endpoints. `private.dm_secrets` is never joined into a snapshot or event.

## Synchronization protocol

`GET /api/v1/campaigns/{campaign_id}/sync` returns `SyncBatch`:

```json
{
  "protocol_version": 1,
  "campaign_id": "<campaign uuid>",
  "role": "player",
  "revision": 7,
  "snapshot": null,
  "scene_events": [],
  "travel_events": []
}
```

- Without `after`, the server returns a snapshot at the current campaign stream
  revision. `snapshot` is `null` in an event batch.
- With `?after=<revision>`, the server replays ordered public events whose stream
  revision is greater than the cursor. `revision` is the campaign stream cursor,
  not an entity revision.
- A repeated request with the same cursor is a pure read: it returns the same event
  IDs. Clients also deduplicate by `event_id`.
- A cursor at the current revision returns an empty batch, even when the campaign's
  latest writes emitted no scene event; a caught-up client is never sent a new snapshot.
- A cursor that is ahead of the server, older than retained history, or farther than
  500 events behind receives a fresh snapshot instead of a silent gap.
- Event IDs and stream revisions are assigned in the same transaction as the scene
  write. A duplicate `Idempotency-Key` replays the original event instead of adding
  another one.
- Campaign, character, journal and knowledge writes advance the same stream revision
  but emit no `scene_changed` row. If the replay batch does not cover every revision
  between the cursor and the current revision, the server returns a fresh snapshot
  instead of dropping those changes. The snapshot row reads and its revision share
  one repeatable-read transaction.
- Scene updates require the current `expected_revision`; two writers with the same
  expected revision produce one `200` and one `409 revision_conflict`.
- Camera and animation state stay local. Only shared server-authoritative changes
  enter the outbox.

Snapshots are capped at 500 rows per collection and set `truncated: true` when the
cap is reached; the paginated collection endpoints remain the way to read more.
Event batches are capped at 500. This change emits `scene_changed`; `travel_events`
stays empty until D14 adds an authorized travel writer and the v2 group-journey event.

Sanitized client shape (the token is a placeholder, never a real secret):

```sh
curl -s -X POST http://127.0.0.1:3001/api/v1/auth/sessions \
  -H 'content-type: application/json' \
  -d '{"username":"synthetic-user","password":"<password-from-the-operator>"}'
```

```sh
curl -s 'http://127.0.0.1:3001/api/v1/campaigns/<campaign>/sync?after=7' \
  -H 'authorization: Bearer <session-token>'
```

## Threats and limits

| Risk | Current control | Remaining limit |
| --- | --- | --- |
| Stolen bearer token | 256-bit random token, hashed at rest, 12-hour expiry, explicit logout | No per-device revocation list or refresh rotation; anyone with the token acts as that user |
| Password cracking | PBKDF2-HMAC-SHA256, 600k iterations, per-account salt | Password policy is length-only; no breached-password check |
| Credential stuffing or CPU exhaustion | Generic login failure; validation before derivation | No login/registration rate limit, backoff or CAPTCHA; open registration can spend CPU |
| Token interception | Bearer token is not put in a URL or in the outbox; logs omit headers and bodies | TLS termination is an operator responsibility; plain HTTP on a shared network exposes tokens |
| CSRF | The token is sent in `Authorization`, not a cookie | A future cookie-based client would need an explicit CSRF design |
| Cross-campaign access | Membership check on every campaign route and sync | Deployment grants and database superuser boundaries remain operational work |
| Secret leakage | Player filtering happens in SQL before serialization; `private` schema is never joined | A future projection added outside the audience filter would need its own negative test |
| Event replay or gaps | Monotonic campaign stream, deterministic `after` cursor, event IDs, snapshot fallback | Outbox rows are never purged, so storage grows and old cursors stay valid until a retention job exists |
| Concurrent writes | Expected revisions and one transaction per entity plus its event | No automatic merge of two accepted edits; the losing writer retries |
| Snapshot memory | 500-row cap per collection plus `truncated` | A campaign above the cap needs the paginated endpoints; sync does not paginate a snapshot |
| Session table growth | Expired sessions fail authentication | Expired rows are not swept automatically |
| Development identity | Header is off by default and, with `DESIRE_DEV_IDENTITY=1`, only enabled on a loopback bind | A shared bind never trusts the header, so the opt-in cannot grant DM rights on a network |

No real password, token, Nivel20 credential or secret belongs in documentation,
fixtures, logs or commits. The examples above use synthetic values only.
