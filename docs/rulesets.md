# GitHub rulesets for `main`

These settings cannot be applied from the repository. Apply them in **Settings → Rules →
Rulesets → New branch ruleset**, target `main`, enforcement **Active**, with no bypass actors
except the repository owner for emergencies (and record every use).

| Setting | Value | Why |
| --- | --- | --- |
| Restrict deletions | on | `main` cannot be deleted |
| Block force pushes | on | Published history is never rewritten; attestations point at SHAs that must keep existing |
| Require a pull request before merging | on, 1 approval | No direct pushes; every change has a reviewable unit |
| Dismiss stale approvals when new commits are pushed | on | An approval is for the code that was reviewed |
| Require approval of the most recent reviewable push (`require_last_push_approval`) | on | The person who pushed last cannot be the one who approves: an author cannot push after approval and merge |
| Require review from Code Owners | on | Activates `CODEOWNERS`: deny-list paths need an owner's approval |
| Require conversation resolution before merging | on | A blocking review comment cannot be ignored by merging around it |
| Require status checks to pass | on: `frontend-check`, `rust-fmt`, `rust-clippy`, `rust-test`, `wasm-build`, `quality-gate` | Same names as `merge-policy.json` gates and the CI jobs |
| Status check source | **GitHub Actions** app for each check | A check pinned to the app cannot be faked with a commit status posted from a token |
| Require merge queue | on, same six required checks, merge method **squash** | The queue tests the integrated candidate (`merge_group` event), so a green branch behind a moved `main` cannot merge |
| Allowed merge methods | squash only | One commit per card on `main`: `git revert` of a card is one commit |

## Identities

- The **authoring agent** pushes branches and opens pull requests. It has no approval and no merge
  rights.
- The **merge actor** (the loop's `merger.py`) uses its own GitHub identity, configured through
  `FLOW_MERGE_GH_CONFIG_DIR`. It refuses to merge a pull request authored by itself.
- Humans approve. An approval from the authoring identity is not possible because of
  `require_last_push_approval`.

## What the merge actor checks on top of the ruleset

Before `gh pr merge --squash --match-head-commit <reviewed sha>`, the merge actor re-runs every
policy gate on the reviewed commits rebased onto current `main`, re-runs the anti-tamper check on
the integrated diff, and requires every GitHub check with a policy gate name to be green. After
merging it verifies that the merge commit is on `main` and that the touched paths equal the tested
tree, and only then marks the card done. The ruleset and the merge actor are independent layers:
either one alone refuses an unsafe merge.
