# Identity, permissions and table synchronization

Status: implemented in `crates/api` and `crates/persistence`; contract shapes are
generated from `contracts/schema.json`. This document records the security boundary,
the synchronization protocol and the limits that remain open.

## Identity

| Route | Behavior |
| --- | --- |
| `GET /api/v1/auth/login` | Redirect to Google with Authorization Code, S256 PKCE, `state` and `nonce`; `429 oidc_rate_limited` when the client has eight pending flows |
| `GET /api/v1/auth/callback` | Consume the browser-bound flow, exchange the code, verify the ID token, set the session cookie, redirect to the public root |
| `GET /api/v1/auth/identity` | Return `AuthIdentity { user_id, email }`; the email is display data |
| `DELETE /api/v1/auth/sessions/current` | Delete the server session and expire the cookie; requires same-origin mutation |

Password registration/login routes, password hashes and PBKDF2 are removed. The
unmerged migration 0012 now creates accounts keyed by the unique `(issuer, subject)`
pair. Email changes update display data without changing identity. Two subjects
with the same email remain separate accounts. Do not modify an existing deployed
migration history: disposable databases from the password branch must be recreated.

`openidconnect` performs discovery/JWKS retrieval, authorization URL construction,
code exchange and ID-token signature/`iss`/`aud`/`exp`/`nonce` verification. The API
also requires a signed email claim with `email_verified: true` and applies the
optional email allowlist. Provider access/refresh tokens are neither stored nor
returned. Authentication failures use a generic `401 unauthenticated` response.

A session uses 32 OS-random bytes encoded as hex. Only its SHA-256 digest and expiry
are stored in `identity.sessions`. The raw token exists only in a host-only
`__Host-desire-session` cookie with `Path=/; HttpOnly; Secure; SameSite=Lax` and a
12-hour lifetime. There is no bearer-token response or JavaScript token storage.
Auth responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

Each login has a separate `__Host-desire-oidc-<state hash>` browser-binding cookie with the same
security flags and a 10-minute lifetime. Server-side pending state contains PKCE
and nonce values; a callback atomically consumes it before token exchange. Replays,
unknown state and another browser's cookie cannot create a session. Expired flows
are discarded. Pending flows are capped at eight per client IP and 1024 per process.
A client at its quota receives `429 oidc_rate_limited`, without a new binding cookie;
other clients can still log in. The global cap remains `503 oidc_busy`. A callback
or expiry releases its slot; rejected requests do not extend the expiry. Restarting
the API cancels pending logins. Flow-specific cookie names isolate overlapping callbacks,
including one already awaiting token exchange: completing one never clears another
flow's binding cookie. Flows may complete independently. The browser has one app
session, so the last successful callback response it processes selects the account;
there is no latest-started-attempt ordering guarantee. Multi-instance deployments
need sticky login routing or a
shared pending-flow store; persistent sessions already work across API instances.

Client identity for admission is the TCP peer IP, ignoring source ports and normalizing
IPv4-mapped IPv6 addresses. No forwarded IP header is trusted by default, including
`X-Forwarded-For`. Behind a proxy, explicitly set `DESIRE_TRUSTED_CLIENT_IP_HEADER`
to its authoritative single-IP header, for example `Fly-Client-IP`. The proxy must
strip client-supplied copies and overwrite it; restrict direct access to the API so
clients cannot bypass that proxy. When configured, a missing, invalid, list-valued
or repeated header returns `400 invalid_client_ip`. Without this setting, clients
behind one proxy share its peer-IP quota. Clients behind a shared NAT also share
a quota. These per-process bounds do not replace ingress limits against distributed
attacks or high request volume.

For non-read methods, a supplied `Origin` must exactly match the configured public
origin. Cookie-authenticated mutations also require `Origin` to be present. Missing,
foreign, `null` and duplicate Origins are rejected before the handler. Reverse
proxies must preserve the browser's Origin; Host and forwarded headers never choose
an OIDC redirect or authorize a mutation. No cross-origin CORS access is enabled.

Without OIDC, the binary refuses a non-loopback bind. The `x-desire-user` seam is
off by default, including on loopback; only `DESIRE_DEV_IDENTITY=1` plus a loopback
bind enables it. Startup rejects `DESIRE_DEV_IDENTITY=1` together with OIDC settings,
even on a loopback bind. The bind limits the listener, not the caller: a local reverse
proxy or tunnel can expose the seam to remote clients who can then impersonate any
member, including the DM. Use it only in isolated local development; never expose
that listener through a proxy or tunnel. It never overrides a presented session.
The frontend client omits this header unless the caller explicitly supplies a
development identity. For browser
development without OIDC, explicitly set `DESIRE_PUBLIC_URL=http://localhost:5173`
(or your exact loopback origin) alongside `DESIRE_DEV_IDENTITY=1`. Only that Origin
is accepted; no wildcard, Host-header inference or arbitrary loopback port is trusted.

## Google Cloud setup

1. Select a Google Cloud project. Open Google Auth Platform (or APIs & Services /
   OAuth consent screen). Configure the app's branding, audience and authorized
   domain. During external testing, add the permitted Google accounts as test users.
2. Create an OAuth client of type **Web application**. Use Authorization Code;
   the API supplies PKCE automatically. Request only the `openid` and `email` scopes.
3. Add exact authorized redirect URIs for both deployments, for example:
   - `https://table.example.test/api/v1/auth/callback` (replace with your domain).
   - `http://localhost:5173/api/v1/auth/callback` (Vite proxies `/api` to port 3001).
   - If using the API directly, also add `http://localhost:3001/api/v1/auth/callback`.
   Register `127.0.0.1` separately if you use it; it is not the same host as localhost.
4. Inject the client ID and secret into the API process through the deployment's
   secret manager or protected environment. Do not commit or print them, or paste
   them into shell history, reports or browser code.
5. Set the public URL to the exact browser-facing origin. Put UI and `/api` behind
   the same HTTPS origin in production. Visit `/api/v1/auth/login`, then inspect
   `/api/v1/auth/identity`. D15 provides the login screen, not D10.

| Environment variable | Meaning |
| --- | --- |
| `DESIRE_OIDC_ISSUER` | Defaults to `https://accounts.google.com` |
| `DESIRE_OIDC_CLIENT_ID` | OAuth Web client ID from Google Cloud |
| `DESIRE_OIDC_CLIENT_SECRET` | Server-only client secret, injected by the operator |
| `DESIRE_PUBLIC_URL` | Origin only, no credentials, path, query or fragment; callback is `{DESIRE_PUBLIC_URL}/api/v1/auth/callback` |
| `DESIRE_ALLOWED_EMAILS` | Optional comma-separated verified emails; trimmed and case-insensitive; unset/empty permits any verified Google account |
| `DESIRE_TRUSTED_CLIENT_IP_HEADER` | Optional authoritative single-IP proxy header for login admission; no default; the trusted proxy must overwrite it and prevent direct API access |

For OIDC, the client ID, secret and public URL must be configured together. The
public URL alone is permitted only with explicit loopback development identity and
must itself be a loopback origin. Discovery must
succeed before the listener opens. HTTPS is required except for loopback HTTP URLs.
The HTTP client has a 10-second request timeout and does not follow redirects.
Secure cookies are never weakened for local development: use localhost in a browser
that supports Secure cookies on localhost, or run a local HTTPS proxy. Keep the same
host throughout login and callback. No Google credentials are needed for tests.

JWKS is loaded at startup; restart the API to pick up provider key rotation. There
is no refresh-token flow, account deletion or multiple-device session listing.

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

The typed client in `src/lib/api/auth.ts` exposes `loginUrl`, `getIdentity`,
`logout` and `syncCampaign`. Navigate the browser to `loginUrl()`; do not fetch the
provider redirect with JavaScript. Other calls send same-origin credentials and
reuse the generated `AuthIdentity` and `SyncBatch` contracts. Clients deduplicate
scene invalidations by event ID, refetch the authorized entity and retain the
returned campaign cursor. D15 owns UI integration and polling lifecycle.

## Threats and limits

| Risk | Current control | Remaining limit |
| --- | --- | --- |
| Stolen session | 256-bit random cookie, hash at rest, HttpOnly, 12-hour expiry, server-side logout | A stolen cookie still acts as the user until revocation/expiry; no per-device session listing |
| Forged or substituted identity | Library verifies ID-token signature against JWKS plus issuer, audience, expiry and nonce | Provider trust and OAuth client configuration remain operator responsibilities; restart to refresh JWKS |
| Email reassignment/account linking | Stable `(issuer, subject)` key; verified email required; no email-based lookup or merge | Allowlist admission uses current verified email; removal does not revoke already-issued sessions |
| Login CSRF/code theft/replay | Random state, independent browser cookie, nonce, S256 PKCE, atomically consumed 10-minute flow | Restart cancels flows; replicas require sticky routing or shared pending storage |
| Token interception | Secure host-only cookie, provider tokens discarded, auth no-store/no-referrer; no token logs | Production TLS termination and proxy query-log redaction (callback codes/state) are operator responsibilities |
| CSRF | SameSite=Lax plus exact public-Origin validation on mutations; cookie mutations reject missing Origin | Same-origin XSS can still issue actions; CSP/UI escaping remain required |
| Login exhaustion | Eight pending flows per peer IP (or explicitly trusted proxy IP header), client-only `429`, 1024-flow global cap, expiry and bounded HTTP calls | Distributed clients can still fill the global cap; use ingress limits. Shared NATs/proxies share a quota. Proxy headers require overwrite and restricted direct access; limits are process-local |
| Cross-campaign access | Membership check on every campaign route and sync | Deployment grants and database superuser boundaries remain operational work |
| Secret leakage | Player filtering happens in SQL before serialization; `private` schema is never joined | A future projection added outside the audience filter would need its own negative test |
| Event replay or gaps | Monotonic campaign stream, deterministic `after` cursor, event IDs, snapshot fallback | Outbox rows are never purged, so storage grows and old cursors stay valid until a retention job exists |
| Concurrent writes | Expected revisions and one transaction per entity plus its event | No automatic merge of two accepted edits; the losing writer retries |
| Snapshot memory | 500-row cap per collection plus `truncated` | A campaign above the cap needs the paginated endpoints; sync does not paginate a snapshot |
| Session table growth | Expired sessions fail authentication | Expired rows are not swept automatically |
| Development identity | Header is off by default, requires `DESIRE_DEV_IDENTITY=1` plus a loopback bind, and cannot coexist with OIDC settings | Loopback restricts the listener, not the caller; a local proxy/tunnel can expose arbitrary member/DM impersonation. Keep the seam isolated and never proxy or tunnel it |

No real OAuth secret, token or Nivel20 credential belongs in documentation,
fixtures, logs or commits. The local test provider generates its own RSA keys at
runtime with OpenSSL; no test contacts Google or needs real OAuth credentials.
