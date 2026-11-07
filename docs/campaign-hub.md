# Campaign hub, atlas and lore search

Card D15. The app shell composes the campaign selector, session summary, atlas, table entrance
and lore search. Rules stay with D16/D17, the scene with D11 and permissions with the server.

## Layout

| Path | Responsibility |
| --- | --- |
| `src/App.svelte` | Route, connection state, focus after navigation, skip link |
| `src/app/routes.ts` | Hash routes; the URL owns the campaign, panel, place, query and open entry |
| `src/app/latest-loader.ts` | One load at a time; a stale answer is dropped, never published |
| `src/app/connection.ts` | Connection state and `ServerMonitor`: one health probe at a time, with a timeout |
| `src/app/cities.ts` | City registry: the only app module that names a city |
| `src/app/identity.ts` | Development identity for the `x-desire-user` seam |
| `src/app/flags.ts` | Browser side of the runtime flags: parses the file Vite injects as a meta tag |
| `src/app/LegacyShell.svelte` | The page before the hub; mounted while `campaign_hub` is off |
| `src/app/messages.ts`, `messages.es.json` | Spanish copy as data behind English keys |
| `src/features/campaign/` | Selector, summary, atlas and table panels and their pure logic |
| `src/features/knowledge/` | Compendium matcher, merged lore index, search panel |

## Behaviour that must hold

- **No contamination.** `App.svelte` keys the workspace by campaign id, so opening another one
  destroys its state. `openCampaign` starts from an empty context, and `LatestLoader` drops a slow
  answer for a campaign the user already left.
- **Context survives.** A place, query and open entry live in the URL. Going from lore to the map
  and back restores them. The atlas stays mounted while hidden so its camera does not reset, and
  lore stays mounted so notes already loaded survive losing the network. Notes are read once per
  visit to a campaign, or again through the retry when that read failed.
- **Search semantics.** `searchCompendium` implements the normative
  `content/knowledge/search-fixtures.json`, and every fixture runs against it. The panel itself
  uses the lore index, which shares its normalization and haystack; it is tested only against
  fixtures whose filters it can express, because the UI has no language or translation filter.
  The index adds map places and the campaign's notes, and shows only the compendium entries of
  the campaign's rules edition.
- **Degraded lore.** Places and the compendium ship with the app, so a failing API leaves them
  searchable and reports that campaign notes are missing.
- **Controls follow the route.** The kind filter is driven by the route through the select's
  `value`, not by option attributes, so a cleared or restored `?kind=` always matches the results.
- **Show on map.** Returning to the atlas from a lore entry centers the selected place again even
  when that place was already selected, and focus lands on its button in the place list.
- **Behind a flag.** `campaign_hub` is off by default ([flags](flags.md)): `src/main.ts` mounts
  this shell only when the flags file turns it on, and otherwise mounts `LegacyShell`, the page the
  app showed before. Hiding the hub is not authorization — the server still refuses every write.
- **Authorization.** `canManage` only decides which controls to show. No view filters data by
  role; DM-only rows are absent because the server left them out, and a refused write is shown.

## Verification

`tests/browser/campaign-hub-smoke.mjs` drives real Chrome over the dev server with a stub API. It
covers focus after navigation (place button or `#content`), the parked atlas being hidden and not
reachable by Tab, the skip link and tabs in the tab order, campaign isolation after opening another
campaign, the kind filter following the URL, the 760px layout for hub, atlas, lore and summary, and
the Spanish empty/offline/error copy. It also asserts that the page carries the flags file and
mounts the hub with `campaign_hub` on. It runs from `pnpm run test:browser`, which points
`DESIRE_FLAGS_FILE` at `tests/browser/flags.gate.txt`. Pure route, loader, search, flag and overview
logic stays in `tests/*.test.ts`.

## Copy

Product text is Spanish and lives in `src/app/messages.es.json`, the same split as
`content/knowledge`: data is Spanish, while code, keys, file names and documentation are English.
Add a key there rather than a literal in a view. `ViewerHost` takes its error copy from the
catalog (`table.viewer_failed`) and keeps the engine's raw text in the console; the built-in
default only serves the design demo. Older `src/lib/ui` components still hold their own Spanish
labels.

## Known gaps

- **Still on the development identity.** The hub sends `x-desire-user` with a UUID generated per
  browser. Since D10 the API accepts that header only with `DESIRE_DEV_IDENTITY=1` on loopback;
  shared deployments use the Google OIDC cookie session, which the hub does not call yet. Moving
  the client to `/api/v1/auth/login` and the session cookie is follow-up work, and the hub stays
  behind the off-by-default `campaign_hub` flag until then.
- **No city on new campaigns.** `campaigns.city_id` references `catalog.cities`, which no migration
  fills, so the hub sends `null` and the atlas uses the first registered city. An unknown id shows
  an explicit state instead of another city's map.
- **No scene creation.** `scenes.map_version_id` references `catalog.map_versions`, also unseeded,
  so the table panel only lists scenes.
- **No "latest session".** `Session` has no date and the API orders by random id, so the summary
  lists every session rather than guessing. This needs a contract change (D04).
- **Places have no lore text.** They are found by name, ward and catalog id; D05 and D13 ship no
  body, and nothing links a campaign note to a place yet.
- **The table is a placeholder.** It mounts the D11 viewer without pieces; D16/D17 add the game.
- **Hidden atlas cost.** The parked viewer keeps rendering while another panel is open, so the
  table panel runs two GPU contexts at once.
- **Selection cannot clear on the map.** `MapViewer` has no deselect, so browser Back to a route
  without a place leaves the marker highlighted. Fixing it belongs to D11.
- **Truncated lists.** `collectPages` stops at 5 pages of 100 and tells the user. The caller's
  role comes from the owner record or that page; a non-owner DM whose row falls outside the budget
  still sees the member role as unknown until the server exposes the caller's own membership.
- **No retry for a failed table chunk.** Browsers may keep a failed dynamic import, so a button
  could not promise anything. Leaving the panel and returning tries again.
- **Unused health helpers.** The hub only needs `parseHealth`; `checkHealth`, `healthMessage` and
  `loadEngine` in `src/lib/health.ts` are read by `LegacyShell`, the flag-off branch. Deleting them
  would take the pre-flag page with them.
