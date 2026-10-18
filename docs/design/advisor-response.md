# Independent review response

An independent reviewer agent (Claude CLI, read-only, no shared context with the author) reviewed
the D03 files against `docs/reglas-de-codigo.md`. This is the disposition of every finding. The
review ran before the fixes below; each entry cites the current file and line as evidence.

## Blocking findings

| Id | Finding | Status and evidence |
| --- | --- | --- |
| B1 | Mesa and Grupo stayed invisible because `setView` never removed `hidden`, while only atlas and start had an author `display`. | Fixed. `setView` now toggles `section.hidden` (`app.js:108`), `.view[hidden]` is authoritative (`layout.css:21`), and `smoke.mjs` asserts real visibility with `checkVisibility()`. |
| B2 | Number keys switched views while focus was in the search input. | Fixed. `handleKeydown` returns early for typing targets (`app.js:289`) using `isTypingTarget` (`ui-state.js:151`). The smoke test fires `2` inside the input and asserts the view does not change. |
| B3 | Arrow-key navigation died after the first result. | Fixed. The keydown listener is bound to `#search-results` as well as the input (`search.js:80`), and the smoke test focuses the first result and checks `ArrowDown` reaches the second. |
| B4 | `styles.css` was 931 lines, twice the F6 ceiling. | Fixed. Split into `tokens.css` (129), `layout.css` (174), `components.css` (327) and `overlays.css` (299); the four are linked from `index.html`. |

## Rule findings

| Id | Rule | Status and evidence |
| --- | --- | --- |
| R1 | Fallen active participant restarted the order. | Fixed. `nextTurn` walks forward from the active index and wraps (`ui-state.js:106`); the test expects the fallen case to advance (`ui-state.test.js:100`). |
| R2 | Domain magic numbers. | Fixed in logic: `DAMAGE_STEP`, `HEAL_STEP`, `TOAST_MS` (`app.js:30-32`), `LOW_HP_PERCENT` (`render.js:36`), `DEBUG_PORT`, `CDP_TIMEOUT_MS`, `TARGET_POLL_ATTEMPTS`, `TARGET_POLL_MS` (`smoke.mjs:17-25`). The 44 remaining literal hits are campaign data (map coordinates, hit points, ability scores) and named constants; see the false-positive note below. |
| R3 | Rule of three: repeated `<li>` templates and `find` calls. | Fixed. `itemMarkup` (`render.js:45`) is reused by both lists, and `findById` (`ui-state.js:84`) replaces four lookups. `scenarioForEntry` (`ui-state.js:94`) replaces the compound find. |
| R4 | Silent failures. | Fixed for the reachable cases: unknown search state throws (`ui-state.js:75`), unknown party member or lore entry throws with the id (`app.js:86,92`). Click delegation still ignores elements without `data-action`, which is intended delegation, not a swallowed error. |
| R5 | CDP send had no timeout and hid `{error}` replies. | Fixed. `createSend` rejects after `CDP_TIMEOUT_MS` and on CDP errors (`smoke.mjs:76-101`). |
| R6 | No boundary types. | Addressed with JSDoc typedefs (`ui-state.js:12-42`, `render.js:2-24`) and parameter annotations on the exported functions. The project does not type-check JS, so this is documentation, not enforcement. |
| R7 | Domain lookup and log wording mixed into DOM code. | Fixed. `scenarioForEntry` (`ui-state.js:94`) and `hpLogLine` (`ui-state.js:141`) are pure, tested in `ui-state.test.js`, and called from `app.js`. |
| R8 | Inconsistent escaping. | Fixed. `markerMarkup`, `turnMarkup`, `scenarioChipMarkup`, `memberSummary`, `sheetMarkup`, `loreMarkup` and `searchResultMarkup` escape every interpolated field (`render.js`), and `render.test.js` asserts escaping and the state attributes. |
| R9 | Waterdeep sentence hard-coded in the renderer. | Fixed. The note moved into the data source (`lore-data.js:5`) and `loreMarkup` renders `entry.source.note` (`render.js:131`). |
| — | Error state was overwritten by a pending debounce. | Fixed. `setRequestState` clears the timer (`search.js:99`); the smoke test waits past the debounce and still sees the error note. |
| — | `aria-live` on the log re-announced the whole list. | Fixed. `aria-live` removed from `#encounter-log` (`index.html:256`); the toast with `role="status"` announces combat results. |
| — | Escape closed the dialog and the side panel together. | Fixed. The panel closes on Escape only when the search dialog is closed (`app.js:301`). |
| — | `close` used a boolean expression as a statement. | Fixed with an `if` (`search.js:96`). |

## False positives kept as documented exceptions

- `km smells` reports 44 magic numbers. They are campaign content, not logic: `mapMarkers`
  coordinates, participant hit points and initiative, member ability scores, and the named
  constants listed in R2. F8 tolerates data values; km's text heuristic does not distinguish them.
- `km smells` reports 16 `commented_out_code` lines. They are the JSDoc typedef and parameter
  blocks used for F13. The lines contain `: type` syntax, which the text heuristic reads as code.
- `km smells` no longer reports any long function or long parameter list after the splits.

## Reviewer observations accepted as documented limits

- Fixed sleeps in `smoke.mjs` can be flaky on a very slow machine. A retry loop for the search
  debounce would be the next improvement; the current wait is 600 ms for a 250 ms debounce.
- The smoke test checks the mobile rail direction and map minimum height, not every mobile rule.
- `render.js`, `search.js` and `app.js` now have markup and state tests, but the DOM controller
  itself is only covered by the end-to-end smoke test.
- The `pnpm-lock.yaml` created while installing dependencies is untracked and belongs to card D01;
  it is not part of this commit.
