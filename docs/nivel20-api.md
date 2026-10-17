# Nivel20 · Read-only API evidence

Read-only investigation carried out on 16 October 2026 (America/Santiago). Scope: what can
really be read from Nivel20 (campaign «La maldicion de la luz ✨» and character Ionyth)
without executing writes or persisting credentials. It does not implement the importer;
D19 will consume this inventory.

## Evidence legend

| Mark | Meaning | Strength |
|---|---|---|
| **T** | Observed traffic (Network/HAR/CDP/WebSocket frames) | Network proof |
| **U** | Authenticated UI (navigation and DOM attributes) | Does not prove method or body |
| **C** | Contract expected by the public JavaScript client | Client intent |
| **H** | Prior HTTP kept in the input files | Historical capture, not repeated |
| **P** | New HTTP probe from this session | Reproducible today |

## Source map (capture identifiers)

Every row below cites one of these capture identifiers. Inputs live outside this worktree at
`/Users/javendano/Documents/Codex/2026-10-15/estoy-pensando-en-hacer-un-wrapper/work/nivel20-scan/`;
the prior report is `/Users/javendano/dev/nivel20-api-investigation/outputs/nivel20-api-scan.md`.
This document copies no cookies, tokens or credentials; the campaign description is redacted.

| ID | File / offset | Size | Integrity | Used for |
|---|---|---:|---|---|
| **C1** | `application.js`, character offsets (0-based) | 2 080 054 B | SHA-256 `3ba89129229015561f198c31f2173a2b91e0536875bfad69cd53590d25fadebd` | Client contracts (**C**) |
| **C2** | `tabletop.html`, lines 41–42 (CSRF meta) | 58 577 B | SHA-256 `41dd029e79c669dae25f781850aca8da391bb2c93ae3245e9f8a4836d663de6b` | CSRF presence (**C**) |
| **H1** | `headers.txt` lines 1–20 | 994 B | — | `/tabletop` 200 (**H**) |
| **H2** | `character-headers.txt` lines 1–15, `character-body.txt` line 1 | 511 / 74 B | — | Ionyth 401 (**H**) |
| **H3** | `folders-headers.txt` lines 1–13, `folders-body.txt` | 412 / 7 227 B | — | `/folders.json` 403 (**H**) |
| **U** | Authenticated UI session (navigation + DOM attributes) | — | — | Interface observations (**U**) |
| **P** | New HTTP probes from this session | — | — | Reproducible-today results (**P**) |
| **PREV** | Prior report `nivel20-api-scan.md` | 24 089 B | — | Corroboration of **C/U** |

Offsets are character indices into the minified bundle read as text, not line or byte offsets.
The bundle hash matches the script referenced by the authenticated page
(`/assets/application-3ba89129229015561f198c31f2173a2b91e0536875bfad69cd53590d25fadebd.js`);
the interface reported version `v2.20.5`.

## Result and limits

- The network is available in this session (**P**): `nivel20.com` resolves and responds.
- **One** unauthenticated read endpoint is confirmed: campaign metadata in JSON (**P**).
  The remaining character and state reads could not be reproduced without a session
  (**P** → 401/403).
- **There is no T evidence**: no authenticated request/response and no WebSocket frame was
  captured. Character sheet, equipment, spells, actions, journal and combat log remain at
  **C/U** level, as in the prior report.
- Therefore **no complete character API in JSON nor an external authenticated HTTP client is
  demonstrated**. This is a partial inventory, not a contract.

## Concrete blocker for the authenticated capture

Chrome is open and authenticated, but it **does not expose debugging**:

- There is neither a `DevToolsActivePort` file in the default profile nor a listening CDP
  socket (`lsof -nP -iTCP -sTCP:LISTEN | grep -iE 'chrome|9222|9229'` → no results). Without
  the startup flag it is not possible to attach to an already-running instance.
- Restarting Chrome with `--remote-debugging-port` is out of scope (the protocol and the card
  forbid restarting it or closing the profile).
- The supported automation interface exposes `viewport` and `pageAssets`, but not
  request/response events or HAR export; two attempts to open DevTools through that path
  ended in timeout.
- A fresh profile with CDP would only serve **unauthenticated** traffic, which is what **P**
  already covers; it does not provide the missing authenticated capture.

Conclusion: the **T** capture is **pending and blocked by tooling**, not by missing data. The
minimum path remains manual and user-driven (DevTools → Network with Preserve log, filter
`domain:nivel20.com`, export a **sanitized** HAR; review bodies, query and headers before
sharing). Reference: [Chrome DevTools, Network reference](https://developer.chrome.com/docs/devtools/network/reference).

## Base URLs and IDs verified in the interface (U)

```text
ORIGIN       = https://nivel20.com
CAM          = /games/dnd-5/campaigns/109662-la-maldicion-de-la-luz
CHAR         = CAM/characters/1479371-ionyth
COMBAT_BASE  = CAM
SPELL_BASE   = CHAR
```

| Relation | Evidence U |
|---|---|
| Campaign → character | The `CAM/characters` listing links to `CHAR` |
| Combat → campaign | In `CAM/tracking_log`, `.combat-tracking[data-base-url]` equals `CAM` |
| Spells → character | In the sheet, `.character-magic-panel[data-base-url]` equals `CHAR` |
| Character → profession | `.spell-list-panel[data-profession-id]` equals `68`; its server entity is unverified |
| Campaign/character → message room | `body[data-messages-room-id]` equals `181220` in both Ionyth and `tracking_log` |
| Inventory → item instance | Edit links to items under `CHAR/items/4180199-cuero`, among others; not opened |
| Character → level | Link to `CHAR/character_levels/8444174/edit`; not opened |

`room_id=181220` is a messaging ID; it is **not proven** to share the ID space with
`tabletop_room`. The slug is part of the visible path; whether the server accepts the number
alone was not tested, and no third-party IDs were enumerated.

## Read inventory

Columns: method and query/body are the client-declared contract for **C** rows and the
observed navigation for **U** rows. "Response MIME" distinguishes the **observed** type from
the type **expected by the client**; where a value was never captured it is marked
`not captured`. "Evidence" cites the capture ID from the source map.

| # | Route | Method | Query / body | Response MIME | Evidence |
|---|---|---|---|---|---|
| 1 | `/tabletop` | GET | none | **observed** `text/html; charset=utf-8` (200) | **H1** `headers.txt:1`; **P** (HEAD 200 `text/html; charset=utf-8`) |
| 2 | `CAM` (Accept JSON) | GET | header `Accept: application/json`; no body | **observed** `application/json; charset=utf-8`, 537 B (200) | **P** |
| 3 | `CAM` (navigation) | not captured | none | **observed** `text/html` (rendered page) | **U** |
| 4 | `CAM/characters` | not captured | none | **expected** `text/html` (authenticated listing) | **U**; **PREV** |
| 5 | `CHAR` (Accept JSON) | GET | header `Accept: application/json`; no body | **observed** `application/json; charset=utf-8`, 74 B (401) | **H2** `character-headers.txt:1-2`, `character-body.txt:1`; **P** |
| 6 | `CHAR` (navigation) | not captured | none | **observed** `text/html` (rendered sheet) | **U** |
| 7 | `CAM/log` | not captured | none | **observed** `text/html` (journal page) | **U**; pagination not observed |
| 8 | `CAM/tracking_log` | not captured | none | **observed** `text/html` (Characters/Dice/chat view) | **U** |
| 9 | `COMBAT_BASE/status` | GET | no explicit `data`; jQuery default body | **expected** `json` (`dataType: json`); server MIME `not captured` | **C1** @ 746 291 |
| 10 | `COMBAT_BASE/tracking_rows` | GET | `character_ids` copied from the current URL (`searchParams.getAll` then `set`, so the last value wins) | **expected** JSON envelope whose `response` field is HTML; server MIME `not captured` | **C1** @ 752 367 |
| 11 | `COMBAT_BASE/resources/{row_id}` | GET (via `loadModal`) | `modal=true` added by the loader | **expected** HTML fragment (no `dataType`); server MIME `not captured` | **C1** @ 752 200, 763 563 |
| 12 | `SPELL_BASE/spell_list` | GET | `query` (lowercased), `order`, `spell_levels` (ints), `schools` (ints), `tags` (ints), `profession_id`, `list` (`prepared`\|`known`\|`available`\|`all`), `page` | **expected** HTML (no `dataType`); server MIME `not captured` | **C1** @ 929 900–932 900; **U** (`list` options, `profession_id=68`) |
| 13 | `/folders.json` | GET | `content_type`, `all=true`; variant `moving_folder_id`, `target_folder_type`; no `page` | **expected** JSON `results`; **observed** without auth `text/html`, 7 227 B (403) | **C1** @ 965 405, 966 377; **H3** `folders-headers.txt:1-3` |
| 14 | `/tabletop_assets.json` | GET | `owned=true`, `asset_type`, `tabletop_room`, `tags`, `q`, `order`, `folder_type`, `folder_id`, `page`, `per_page=15` | **expected** JSON (`results`, `pagination`, optional `pinned_results`); server MIME `not captured` | **C1** @ 770 900–772 000, 971 790 |
| 15 | `/games/dnd-5/conditions.json` | not captured | query `not captured` (async select `data-url` in `tracking_log`) | **observed** `application/json` (200, 19 490 B) then `not captured` (202, empty body); see note | **U**; **P** (partial) |

Unavailable details are marked `not captured`: for U navigation rows the HTTP method is
pending; for C rows the method is the client's `type` value but the server's accepted method
and real MIME type are pending. No authenticated response body was captured for any C row.

### Pagination and parameters

- **`spell_list`**: the first page replaces `.spell-list-content`; later pages append. The
  next page number comes from the `data-page` of the load-more control. Server page size and
  end condition `not captured`. (**C** via **PREV** line 106; **C1** @ 929 900–932 900.)
- **`tabletop_assets.json`**: the loader adds `page` and `per_page` (15) and consumes
  `pagination.current_page`, `pagination.more`, `pagination.total_results` and `results`;
  `pinned_results` is optional and may carry folders and pinned results, so totals may refer
  only to paginated results. Server semantics `not captured`. (**C1** @ 771 187, 771 728.)
- **`tracking_rows`**: the client reads `searchParams.getAll("character_ids")` but calls
  `set("character_ids", id)` inside the loop, so a multi-value URL keeps the last value. This
  is a client observation, not a server contract and not a multi-character test. (**C1** @
  752 461.)
- **`folders.json`**: `all=true` is sent and no `page` field is observed; pagination
  contract `not captured`. (**C1** @ 965 405.)
- **`CAM/log`**: no conventional pagination was found in the DOM; global absence of
  pagination is not proven. (**U**.)
- jQuery receives objects and arrays; the exact serialization, including `[]` suffixes, empty
  values and Content-Type on the wire, is `not captured`. (**PREV** line 109.)

### Public campaign metadata (new finding, P)

`GET CAM` with `Accept: application/json`, **unauthenticated**, returns 200 and a JSON object.
Observed structure (description redacted):

```json
{
  "id": 109662,
  "game_id": 3,
  "name": "La maldicion de la luz ✨",
  "description": "<REDACTED>",
  "created_at": "2025-03-05T13:05:22.000-03:00",
  "updated_at": "2026-10-03T22:38:30.000-03:00",
  "url": "https://nivel20.com/campaigns/109662-la-maldicion-de-la-luz.json"
}
```

This is real structured read, but limited to **header metadata**: it includes no sheet,
characters, combat state, inventory or lore. It is an internal **undocumented** endpoint with
no stability or availability guarantee and must not be treated as a contract. The `url` field
is a server-returned value: the `/campaigns/<id>.json` form (without the `/games/dnd-5`
prefix) was **not** verified as a valid endpoint or canonical form.

### Note on `conditions.json`

The first read returned 200 `application/json` with ~19 KB; an immediate repeat returned 202
with an empty body and `x-cache: Error from cloudfront`. The inconsistency indicates a
perimeter control (WAF/CloudFront), not a stable contract. **The endpoint was not forced**;
it remains a probable read pending confirmation and is not used as a design basis.

### Authenticated read from an external client (P → failed)

No sheet read worked without a session (`CHAR` → 401; `folders.json` → 403). The JSON 401
only proves the login message (`{"error":"Tienes que iniciar sesión o registrarte para poder
continuar."}`); it does **not** prove the existence of a JSON sheet. No cookies or tokens were
transferred to any client for a retry.

## Writes detected — documented, NOT executed (C)

| Route | Method | Known fields / effect | Evidence |
|---|---|---|---|
| `COMBAT_BASE/set_row_status` | POST | `row_id`, `row_type`, `row_index`, `damage`, `temp_hp`, `max_hp`, `resources`, `notes`, `conditions`; expects JSON | **C1** @ 745 863 |
| `COMBAT_BASE/set_characters_status` | POST | `characters` and `creatures` indexed by ID; observed for initiative `{initiative: ...}` | **C1** @ 746 044, 748 700–749 400 |
| `SPELL_BASE/update_spell` | POST | `spell_id`, `profession_id`, `spell_action`: `add`, `remove`, `prepare`, `unprepare`; expects JSON | **C1** @ 931 396 |
| `/room_messages` | POST | `room_message`: `room_id`, `sender_info`, `visibility`, `data`, `message_type`, `icon_url`, `parent_icon_url`, `icon_id`, `parent_icon_id` | **C1** @ 2 068 192 |
| `/room_messages/clear_chat` | POST | `room_id`; clears chat | **C1** @ 2 072 139 |
| `/folders.json` | POST | `folder[name]`, `folder[content_type]`, `folder[parent_folder_id]` | **C1** @ 965 915 |
| `/folders/{id}.json` | PATCH | `folder`: name, parent_folder_id, folder_type | **C1** @ 967 327 |
| `/folders/{id}.json` | DELETE | Folder deletion | **C1** @ 968 346 |
| `/tabletop_assets/{id}.json` | DELETE | Asset deletion | **C1** @ 970 450 |

All of the above is client contract (**C**). None was executed and the list is not assumed
complete. The combat code also has a helper that POSTs to a URL received as an argument. The
sheet contains edit, create, import and a `?update_cache=true` link; none was followed. Not
every link that looks like navigation is a safe read.

## Authentication, CSRF and session

- The session is an `HttpOnly` Rails cookie; its name and value were **not** persisted or
  shown. Server expiry/renewal attributes: unknown.
- `tabletop.html` lines 41–42 include `<meta name="csrf-param">` and `csrf-token`; Rails UJS
  copies the token to `X-CSRF-Token`. Presence confirmed; value not read. Any HAR must be
  reviewed before sharing. (**C2**.)
- `Access-Control-Allow-Origin: *` appears in responses, but it does not prove authenticated
  CORS or a public API: preflight, `credentials` and real permissions remain untested.
- The prior `/tabletop` header carries a `Set-Cookie` with `HttpOnly` and no explicit
  `Expires`/`Max-Age`; that sample does not establish the attributes of the authenticated
  cookie. Its value is **not** reproduced here. (**H1** `headers.txt:15`.)

## ActionCable / WebSocket

Only **C/U** evidence; no handshake, effective endpoint nor real frame.

- The bundle calls `ActionCable.createConsumer()`; with no `action-cable-url` meta the default
  path is `/cable` → predicted `wss://nivel20.com/cable` (pending capture). (**C1** @ 2 057 654.)
- Protocols: `actioncable-v1-json` and `actioncable-unsupported`.
- Subscription `{channel:"RoomChannel", room:<messages-room-id>}` if
  `[data-channel-subscribe="room"]` is present (two in `tracking_log`, none in Ionyth).
  (**C1** @ 2 071 018.)
- Receives `chat`, `dice_roll`, `status_update`, `clear_messages`. Chat and dice are sent via
  POST `/room_messages`; reception goes through RoomChannel.

## Architecture decision (provisional, conditional)

| Option | Evaluation against the evidence |
|---|---|
| Backend directly to Nivel20 | **Not justified yet.** Missing supported authentication, external authenticated reads and a stable contract. It would concentrate session handling |
| Local bridge / extension | **Candidate** for personal use because the session already lives in Chrome; it must be limited to explicit reads and return normalized data without credentials. Capability not implemented or tested yet |
| Combination | **Preferred, conditional:** local read bridge + own backend for campaigns and 3D maps, with references to source IDs. Keep Nivel20 secrets out of the backend |

The decision is **not** closed: without **T** evidence, viability cannot be promised. Before
designing the adapter, real contracts must be captured and it must be checked whether the
sheet can be obtained without parsing HTML. DOM scraping is not adopted as a first option.

## Pending tests and closing criterion

1. Real Network capture per section (method, URL, query, body, status, Content-Type,
   sequence), with secrets redacted before persisting.
2. Distinguish initial HTML from JSON/fragments/background requests when loading Ionyth.
3. Verify `status`, `tracking_rows`, `spell_list` and pagination via authenticated reads
   (no writes).
4. Confirm exact array serialization (`[]` suffixes, empty values, Content-Type).
5. Capture the existing WS (handshake, protocol, RoomChannel confirmation, ping) without
   sending frames.
6. Check session attributes and expiry from metadata, without values.
7. Reproduce ≥ 2 authenticated GETs with an external client and verify equivalence, using a
   safe authentication method.
8. Confirm the `conditions.json` contract despite the observed perimeter control.

The analysis is complete with that evidence, not by the mere presence of routes in the
JavaScript. No full API schema, compatibility guarantee or official support is attributed.

## Secret hygiene

No cookies, CSRF tokens or personal data were saved in this document, in the repository or in
logs. Examples are structural or redacted. The `nivel20-scan/` inputs lived outside the
working tree and were **not** copied.
