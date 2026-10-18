# D03 second rework verification

Scope: only `docs/design/`. Baseline commit for this round: `ac73b09`, the previous rework
snapshot. The board, application entry point, contracts, assets and dependency manifests are
unchanged. All new code, comments and file names are English; existing Spanish table copy is
retained.

## Review findings and regression evidence

| # | Finding | Fix | Runnable evidence |
| --- | --- | --- | --- |
| 1 (medium) | Enter in the lore query closed the search dialog through implicit `method="dialog"` submission. | `prototype/search.js:56,92,101-103`: the form submit event is intercepted, the default is prevented and the first result is activated; a pending debounce is resolved first (`:57-61`). The close control is a real `type="button"` with `data-action="close-search"` (`prototype/index.html:303-304`, `prototype/controls.js:123`). | `checkSearchEnterSelectsResult` in `rework-smoke.mjs`: Enter with no results keeps the dialog open, Enter after a quick query opens the first result, and Enter after the debounce does the same. RED captured before the fix in a throwaway `dd438ab` checkout: `AssertionError: Enter keeps an empty search open`. |
| 2 (low) | `components.md` claimed the log list carries `aria-live="polite"`. | `docs/design/components.md:22` now states the list is visual only and combat feedback is announced through the toast, matching `index.html` and `components.md:44`. | Source review; `rework-smoke.mjs` asserts the toast is `role="status"`. |
| 3 (low) | `components.md` described the fallen row as reduced opacity. | `docs/design/components.md:34` now states the dashed border and opaque text, matching `components.css` and `accessibility.md`. | `checkFallenContrast` asserts ancestor opacity equals 1 and rendered contrast >= 4.5. |
| 4 (low) | `tokens.md` named `styles.css` as the contrast guard input. | `docs/design/tokens.md:29` now names `tokens.css`, the file `tokens.test.js:6` actually reads. | `tokens.test.js` recomputes every documented pair from `tokens.css`. |
| 5 (low) | Duplicated CSS file headers. | Removed the duplicate in `layout.css:2`, the stale second header in `components.css` and the repeated file header in `overlays.css:80`. | `grep -n '^/\*'` on the four stylesheets shows one header per file plus section headers. |
| 6 (low) | The `griffin-crash` event lore could not jump to its scenario because the scenario id is `broken-crane`. | `prototype/lore-data.js:85` now uses id `broken-crane`, matching the scenario id, so `scenarioForEntry` resolves it. | `lore-data.test.js` fails before the rename (`event entry cannot jump to a scenario: griffin-crash`) and passes after; `checkScenarioLoreJump` exercises both `well-whispers` and `broken-crane` and asserts the visible `Abrir escenario` button. |
| 7 (low) | `app.js` was 343 lines, above the 50-300 LOC objective for a new file. | Split into `app.js` (32) entry wiring, `table-state.js` (71) state and selectors, `views.js` (106) rendering and `controls.js` (199) actions. Every function is module level and short; a first factory split was rejected because Kimun flagged `createControls`/`createViews` as long functions. | `km smells ... --max-lines 40` reports zero long functions; `km score` reports no file above the floor and `controls.js` scores 93.4 A. |

The RED test commit is `dd438ab` (`test(design): reproduce enter dismissal and crane scenario
jump`); the fixes follow in the GREEN commit for this round. Two limits are stated on purpose:

- The committed RED smoke stops earlier than the Enter check, at `checkSearchDismissal`
  (`AssertionError: visible cancel control in idle`), because the new `data-action="close-search"`
  control does not exist in that snapshot. To isolate finding 1, a throwaway checkout of
  `dd438ab` was run with the dismissal selector pointed at the submit button that does exist
  there; it fails with `AssertionError: Enter keeps an empty search open`.
- The empty-state and debounce Enter assertions were added while addressing an independent
  review of this rework, after `dd438ab`. They therefore have no committed RED snapshot, but they
  fail against the pre-fix `onSubmit` (implicit dismissal) and are exercised by every later smoke
  run.

## Before / after, identical tool and directory scope

Kimun 0.26.0, default cognitive model, `docs/design/prototype`, no vendor included:

| Metric | Baseline `ac73b09` | This round |
| --- | ---: | ---: |
| Default score | 96.83 A+ | 97.41 A++ |
| Score with `--include-tests` | 97.17 A++ | 97.66 A++ |
| Default analyzed JS files | 7 | 10 |
| Default code LOC | 1263 | 1371 |
| Duplicate lines / groups | 0 / 0 | 0 / 0 |
| Maximum cyclomatic complexity | 10 | 10 |
| Maximum cognitive complexity | 7 | 7 |
| Functions above 40 lines / 4 parameters | 0 / 0 | 0 / 0 |
| Unit checks | 17 passing | 18 passing |

Both measured scores exceed target 87 and floor 77. Reproduce:

```sh
km score docs/design/prototype --trend ac73b09 --fail-below B-
km score docs/design/prototype --include-tests --trend ac73b09 --fail-below B-
km smells docs/design/prototype --max-lines 40 --max-params 4
km cycom docs/design/prototype --per-function
km cogcom docs/design/prototype --per-function
km dups docs/design/prototype
```

## Executed checks

Runtime: Node v26.7.0, pnpm 12.11.2, Cargo 1.97.1, Chrome 155.

- `node --test docs/design/prototype/*.test.js`: 18 passing, 0 failing.
- `node docs/design/prototype/smoke.mjs`: passed against a worktree-local Vite server on 5199,
  covering desktop 1440x1000 and mobile 390x844, keyboard focus, live HP, search cancellation,
  Enter selection (empty, pending debounce and settled query), both event-lore scenario jumps,
  rendered contrast and reduced motion.
- `node --test --experimental-test-coverage docs/design/prototype/*.test.js`: imported modules
  95.31% line / 91.43% branch / 87.50% function; `ui-state.js` 100% / 94.64%, `render.js`
  82.24% / 76.92%. This excludes the browser controller, which the smoke test exercises without
  collecting a percentage.
- `pnpm check`, `pnpm build`, `cargo test --workspace`, `cargo fmt --all --check`,
  `git diff --check`: passed. Cargo has zero tests, so success proves compilation and harness
  execution, not Rust behavior coverage.
- `awk 'length > 100'` over the prototype JS, MJS, CSS and HTML: no lines found.

**Coverage limitation:** Kimun scores JavaScript only. HTML/CSS and manual accessibility are
checked by source review and browser regressions, not by a complete automated gate. The complete
project gate is not declared green.

## Remaining limits

- `index.html` (371) and `components.css` (326) remain under the 400-line floor but above the
  300-line target; they were not part of the flagged finding.
- `pnpm check`/`build` and `cargo test` generated untracked `Cargo.lock` and `pnpm-lock.yaml` in
  this worktree. They are build artifacts of the verification commands and are not committed
  because this card is scoped to `docs/design/`.
- The smoke runner keeps fixed waits and a fixed Chrome debug port; see the first rework report.
- Enter with no matching result does nothing by design and the dialog stays open; this is
  asserted, not silent.

## Independent advisor

Two read-only Claude Code sessions reviewed the rework (the Codex CLI available in this
environment had exhausted its usage quota). Neither session edited files, committed or touched
services. Both ran the unit suite and the Kimun commands; neither ran the browser smoke, to avoid
colliding on the shared debug port, so browser claims rest on the author's runs.

**Round 1 verdict: CHANGES REQUESTED.** Dispositions:

| Finding | Disposition |
| --- | --- |
| Must-fix F16: a `rework-smoke.mjs` line over 100 columns. | Fixed; the assertion is wrapped and `awk 'length>100'` is clean. |
| Should-fix: dead re-export and unused imports in `table-state.js`. | Fixed; the re-export and the unused `campaign`/`mapMarkers` imports are gone. |
| Should-fix: inaccurate evidence and wrong `controls.js` line in this report. | Fixed; the citation is `controls.js:123` and the RED story now matches what `dd438ab` produces. |
| Should-fix: the Enter regression only discriminated through the side-panel title. | Fixed; the empty-state assertion now fails directly against the implicit-dismissal bug. |
| Should-fix: duplicate state construction. | Fixed; `createInitialState` reuses `resetParticipants`/`resetLog`. |
| Consider: Enter does nothing during the debounce or empty state. | Fixed for the debounce (`search.js:57-61` resolves the pending query); the empty state is asserted as intentional. |
| Consider: module-level `toastTimer`, SRP in `controls.js`, HTML/CSS over the 300 target. | Accepted as pre-existing or documented debt; see Remaining limits. |

**Round 2 verdict: CHANGES REQUESTED.** It confirmed points 1, 2, 4 and 5 fixed, the 100-column
check clean, the controls imports used, and no duplication. It still asked for accurate evidence
numbers and for the debounce Enter case; both were fixed afterwards, and the repeated
query-setting block was extracted into `typeQuery` in `rework-smoke.mjs`.

**Round 3 verdict: CHANGES REQUESTED, numbers only.** It confirmed the citation and RED story,
the `typeQuery` extraction, the debounce fix and the advisor section. Its remaining items were the
metrics rows (0.5% duplication had already become 0% after the extraction, and the LOC/score had
shifted) and two `search.js` line references.

**Round 4 verdict: PASS.** After those corrections it confirmed the unit suite, the score rows
(96.83 → 97.41 default, 97.17 → 97.66 with tests, LOC 1263 → 1371), zero duplication, the function
and parameter maximums, the 100-column check and every cited line, with no remaining must-fix. It
still did not run the browser smoke, the coverage percentages or the pnpm/cargo commands; those
claims rest on the author's runs, as stated above. None of the rounds claims a full all-language
gate.
