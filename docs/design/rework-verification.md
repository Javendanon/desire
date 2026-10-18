# D03 review rework verification

Scope: only `docs/design/`. Baseline: `6c376b1`. The board, application entry point,
contracts, assets and dependency manifests are unchanged. Existing Spanish copy is retained;
the new close label is English as required by the rework instruction.

## Review findings and regression evidence

| Finding | Fix | Runnable evidence |
| --- | --- | --- |
| Search cannot be cancelled by touch | `prototype/index.html:304`: native dialog submit button, outside result-state rendering, bypasses query validation. | `checkSearchDismissal`: mouse and mobile touch dismissal in results, empty, loading and error states; focus returns to the opener. |
| Event lore has no scenario jump | `prototype/ui-state.js:94`: exact scenario ID takes precedence over place/marker fallback. | Unit test for exact-match precedence and fallback; `checkScenarioLoreJump` searches the existing event title, opens its lore and jumps to the encounter. |
| Character HP is stale | `prototype/app.js:85`: project current HP without overwriting character names or attributes; `refreshPartyDisplays` runs after damage, healing and reset. | `checkLiveHp`: 17/26 after damage, 22/26 after healing/reset, in the encounter, an open sheet, group cards and campaign summary. |
| Initiative selection loses focus | `prototype/app.js:156`: capture the focused row ID before rendering and restore it afterward. | `checkInitiativeFocus`: Tab/Enter through three rows, including a fallen member; focus-visible outline survives; Tab continues to the next row. |
| Fallen HP text loses contrast | `prototype/components.css:209`: dashed border instead of whole-button opacity. | `checkFallenContrast`: computed foreground/background contrast >= 4.5 and opaque ancestors, in both active/inactive states, desktop/mobile and reduced motion. |
| Smoke activates hidden combat controls | `prototype/smoke.mjs:114`: visibility, disabled-state and hit-target checks precede real CDP pointer input. | `checkTable` rejects hidden Next turn, navigates to the encounter, then operates visible combat controls. Keyboard checks use CDP Tab/Enter, not DOM `.click()`. |

Every reported defect was reproduced before its fix. RED commits are followed by GREEN commits:
scenario lookup (`204b036` / `1784001`), hidden controls (`1251f27` / `1a53647`),
live HP (`7027976` / `fe7f32a`), initiative focus (`21d2ff1` / `76c99de`),
search cancellation (`1f7cd9a` / `481c8c2`), rendered contrast (`0f177fe` / `cf01460`).
The smoke runner covers browser state; the unit runner covers pure behavior and markup.

## Before / after, identical tool and directory scope

Kimun 0.26.0, default cognitive model, `docs/design/prototype`, no vendor included:

| Metric | Baseline | Rework |
| --- | ---: | ---: |
| Default score (excludes `*.test.js`, includes smoke scripts) | 97.11 A++ | 96.83 A+ |
| Score with `--include-tests` | 97.49 A++ | 97.17 A++ |
| Default analyzed JS files | 6 | 7 |
| Default code LOC | 1012 | 1263 |
| Duplicate lines | 0 | 0 |
| Maximum cyclomatic complexity | 10 | 10 |
| Maximum cognitive complexity | 7 | 7 |
| Functions above 40 lines / 4 parameters | 0 / 0 | 0 / 0 |
| Unit checks | 16 passing | 17 passing |

The small score decrease is in Halstead effort after adding real-input and regression checks.
Both measured scores exceed target 87 and floor 77. No frozen baseline assertion is used.
Reproduce the numeric floor check:

```sh
km score docs/design/prototype --trend 6c376b1 --fail-below B-
km score docs/design/prototype --include-tests --trend 6c376b1 --fail-below B-
km smells docs/design/prototype --max-lines 40 --max-params 4
km cycom docs/design/prototype --per-function
km cogcom docs/design/prototype --per-function
km dups docs/design/prototype
```

**Coverage limitation:** these scores cover JavaScript only. An explicit HTML/CSS-only score
analyzes zero files, not a passing score. HTML/CSS are checked through source review and browser
regressions, not a complete automated F1–F16 gate. The complete project gate is not declared green.
`app.js` (343 lines), `smoke.mjs` (331), HTML (371) and components CSS (327) remain under the
400-line floor but above the 300-line target. No unrelated file splitting was introduced.

Smell triage: baseline 44 magic-number hits and 16 JSDoc false positives; rework 50 and 16.
The extra numeric literals describe WCAG/sRGB math and keyboard protocol codes, not domain rules.
The existing content literals are fixtures. With tests included, the heuristic also mistakes
commas inside assertion callbacks for function parameters; inspect actual signatures before
classifying these as F2 failures. There are no new dependencies or secrets.

## Executed checks

Runtime: Node v26.7.0, pnpm 12.11.2, Cargo 1.97.1, Chrome 155.0.8059.80.

- Baseline and rework: `node --test docs/design/prototype/*.test.js` passed.
- Baseline and rework: `node docs/design/prototype/smoke.mjs` passed with a worktree-local Vite
  server on 5199. Rework exercises 1440x1000 desktop and 390x844 mobile, touch dismissal,
  rendered contrast, keyboard focus, scenario navigation and reduced motion.
- Baseline and rework: `pnpm check`, `pnpm build`, `cargo test --workspace`,
  `cargo fmt --all --check` passed. Cargo currently has **zero tests**, so success proves
  compilation/test harness execution, not Rust behavior coverage.
- Rework: `cargo clippy --workspace --all-targets -- -D warnings` passed.
- Rework: `git diff --check` passed.
- Rework: `node --test --experimental-test-coverage docs/design/prototype/*.test.js` passed:
  imported modules have 91.64% line, 91.30% branch and 87.50% function coverage.
  `ui-state.js`: 100% line / 94.64% branch; `render.js`: 82.24% / 76.92%.
  This excludes the browser controller/search and is **not whole-prototype coverage**.
  Browser regressions exercise those modules but collect no coverage percentage.

## Self-audit and remaining limits

- PASS: changes confined to design; no application/contracts, dependency, service or art changes.
- PASS: regression checks for all six findings; no swallowed runtime errors added; static local
  IDs only; existing escaping retained; live HP projection is O(party + participants).
- PASS: F1–F5 numeric checks, F9 duplication and new-line width <= 100.
- MANUAL: F7/F10–F14/F16 source review; independent advisor results recorded separately below.
- NOT EXECUTED: screen reader, axe, manual device audit and cross-browser visual inspection.
- Existing fixed waits and fixed Chrome debug port remain smoke-runner limits. One initial mobile
  viewport transition hit an obstruction; waiting two animation frames after resize addresses
  the layout race. Subsequent runs passed; this does not prove absence of all timing flakes.
- No new art was added; `art-provenance.md` remains authoritative.

## Independent advisor

Round 1: two fresh Codex CLI sessions, read-only, each reviewing the complete diff and metrics.
Both independently ran all 17 unit checks and the Kimun commands; neither ran browser smoke
(to avoid collisions on the shared debug port). Reviewer A requested changes; reviewer B found
no must-fix. Both noted test-strengthening opportunities. Raw local reports are ignored logs.

| Review evidence | Disposition |
| --- | --- |
| A, `prototype/app.js:173,201,210`: HP refresh detaches a Group card's stored sheet opener, so closing cannot restore focus. | Reproduced in Chrome with `checkGroupSheetReturnFocus` before fixing (`f1dcf8d` RED / `f43c587` GREEN). `closePanel` now resolves the replacement opener by member ID. The check opens by Tab/Enter, changes HP, heals, resets, returns to Group and asserts focus-visible on the replacement opener. |
| A/B, `prototype/rework-smoke.mjs:78`: dismissal did not assert the demonstrated search state. | Added `assertSearchState`: visible result/empty-note/skeleton/error marker plus nonempty live status before closing in each state, with mouse and mobile touch. |
| B, `prototype/rework-smoke.mjs:65`: scenario-jump check started on its destination. | It now selects a different scenario, navigates to Atlas, asserts both initial conditions, then searches and verifies the destination encounter. |
| Existing F13 boundary typing, file-size targets, fixed waits/port. | Documented limits, not full gate approval; no out-of-scope framework, type-system or runner rewrite. |

Round 2: two new, independent read-only Codex sessions both returned **PASS**, with no must-fix.
A scored the corrected-code checklist 23/24 (95.8%); B scored it 24/24 (100%). Both reran all
17 unit checks and independently measured 96.84 / 97.18 before the final advisory-only changes.
Their sandboxes could not write the temporary directories needed for `km --trend`, so the baseline
comparison remains author-executed evidence. Reviewer A used a different Node runtime (22.17.1).
Neither reviewer ran Chrome, frontend builds, Rust checks or a screen reader.

Final nonblocking advice and disposition:

- A, `prototype/index.html:304`: English close label inherited the document's Spanish language.
  Added `lang="en"` and assert it in every cancellation state.
- A/B, `prototype/rework-smoke.mjs:98`: close the Group sheet after each HP operation, rather than
  once after all three. Updated the regression to reopen and verify return focus separately for
  damage, healing and reset. Three consecutive full Chrome runs passed afterward.
- F13: new smoke exports retain the runner's undocumented dynamic page interface. This test-only
  typing debt is accepted and not claimed as automated F13 compliance; production lookup remains
  documented with JSDoc. A future typed browser driver can remove this limit without changing UI.
- B, `prototype/rework-smoke.mjs:25,35,91`: broader per-member HP cases, future translucent-color
  compositing and exact announcement text are optional hardening, not evidence of current failures.
  Fixtures use opaque colors and the acceptance regression intentionally targets Aubrey.

The final author-measured scores are 96.83 / 97.17 after those small advisory changes. The
reported review scores apply to the round-2 snapshot; the final HTML language attribute and
stronger test assertions were checked by the author, not independently re-reviewed.
