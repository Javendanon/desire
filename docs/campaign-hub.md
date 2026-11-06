# Campaign hub, atlas and lore search

Card D15. The app shell composes the campaign selector, session summary, atlas, table entrance
and lore search. Rules stay with D16/D17, the scene with D11 and permissions with the server.

## Layout

| Path | Responsibility |
| --- | --- |
| `src/App.svelte` | Route, connection state, focus after navigation, skip link |
| `src/app/routes.ts` | Hash routes; the URL owns the campaign, panel, place, query and open entry |
| `src/app/latest-loader.ts` | One load at a time; a stale answer is dropped, never published |
| `src/app/cities.ts` | City registry: the only app module that names a city |
| `src/app/identity.ts` | Development identity for the `x-desire-user` seam |
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
- **Authorization.** `canManage` only decides which controls to show. No view filters data by
  role; DM-only rows are absent because the server left them out, and a refused write is shown.

## Copy

Product text is Spanish and lives in `src/app/messages.es.json`, the same split as
`content/knowledge`: data is Spanish, while code, keys, file names and documentation are English.
Add a key there rather than a literal in a view. Older `src/lib/ui` and `src/lib/engine`
components still hold their own Spanish labels.

## Known gaps

- **No authentication.** `x-desire-user` uses a UUID generated per browser. It is a development
  seam until D10, and clearing site data loses access to that identity's campaigns.
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
- **Raw engine errors.** `ViewerHost` shows the engine's own error text, which may not be Spanish.
- **Truncated lists.** `collectPages` stops at 5 pages of 100 and tells the user.
- **"Show on map" for the selected place.** The route does not change, so the camera stays where
  the user left it. Choosing the place in the atlas list centers it again.
- **No retry for a failed table chunk.** Browsers may keep a failed dynamic import, so a button
  could not promise anything. Leaving the panel and returning tries again.
- **Component behaviour is untested.** No test renders a component. Focus, the parked panels and
  the responsive layout need a browser check.
- **Unused health helpers.** The shell only needs `parseHealth`, so `checkHealth`, `healthMessage`
  and `loadEngine` in `src/lib/health.ts` now serve only their tests. Deleting tests needs its own
  card under the anti-tamper rule in [the test plan](app-tests-plan.md).
