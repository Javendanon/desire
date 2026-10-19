# Merge policy

`merge-policy.json` at the repository root is the versioned set of rules the agentic loop uses to
judge a change. The loop always reads it from the **default branch** (`main`), never from the
pull request: a change must not be able to loosen the rules it is judged by.

Current state: **version 1, mode `shadow`**. In shadow mode every gate runs and its result is
recorded on the card, but nothing is blocked and nothing is merged without a human.

## Modes

| Mode | Effect |
| --- | --- |
| `off` | The loop runs no gates; behaviour as before the policy existed. |
| `shadow` | Gates, tier and anti-tamper findings are recorded on the card. Nothing blocks. |
| `enforce` | A failing blocking gate or a tamper finding parks the card in `Blocked`. The merge actor may merge a `T0`/`T1` change only if every condition below holds. |

`enforce` is switched on by a human, in a pull request that edits this file, once the gates have
run green in shadow mode on real cards. The merge actor refuses to act unless `version >= 1` and
`mode` is `enforce`: no policy, no unattended merge.

## Gates

Each entry in `gates` is `{"name", "cmd", "timeout_s", "optional"}`. The names are exactly the CI
job names in `.github/workflows/ci.yml` (D24): `frontend-check`, `rust-fmt`, `rust-clippy`,
`rust-test`, `wasm-build`, `quality-gate`. The loop runs `cmd` locally on the integrated candidate
(the reviewed commits rebased onto current `main`) and, separately, requires a green GitHub check
with the same name. A gate with no matching CI check is a refusal, so renaming a CI job is a
policy change. A timeout, a missing binary or a non-zero exit is a failure, never a skip; zero
configured gates is a failure too.

## Tiers

A tier is computed from the diff, the same way every time. A card cannot declare its own tier.

| Tier | What | Evidence required |
| --- | --- | --- |
| `T0` deterministic | Documentation and assets only (`doc_extensions`), at most `t0_max_lines` lines in `t0_max_files` files | Deterministic gates |
| `T1` agent | Application code, or documentation over the T0 size | Gates, reviewer evidence and a compressed human decision |
| `T2-never` | Anything matching `never_paths`, or an empty diff | Never merged unattended, whatever the diff looks like |

`.json` is deliberately not a documentation extension: JSON files here are configuration (the
gate's false-positive list, TypeScript configuration) and change behaviour. Changes that touch
code and tests together stay `T1` but are flagged for more scrutiny, not more confidence. Diffs
over `max_review_lines` are flagged as too large to review well.

A runtime change that ships without a feature flag is not auto-mergeable either: see
`docs/flags.md` (D27). Until the loop can detect that from the diff, the reviewer treats an
unflagged runtime change as a blocking finding.

## Deny-list (`never_paths`)

`never_paths` wins over size: a one-line change to a workflow file is `T2-never`.

| Pattern | Why it needs a human |
| --- | --- |
| `.github/**` | CI defines what "green" means |
| `tools/ci/**`, `tools/quality/**` | The gate's own code and configuration |
| `merge-policy.json`, `CODEOWNERS` | The rules and who owns them |
| `**/migrations/**` | Schema changes are not reversible by a revert |
| `**/auth/**`, `**/*secret*`, `.env*` | Identity, permissions and secrets |
| `**/*.lock`, `pnpm-lock.yaml`, `Cargo.toml`, `package.json` | Supply chain: what code runs |

A pattern without `/` matches the file name at any depth (`Cargo.toml` also covers
`crates/api/Cargo.toml`). `CODEOWNERS` lists the same paths so GitHub requires an owner review.
`tools/ci/**`, `tools/quality/**` and `pnpm-lock.yaml` go beyond the list the card started from:
the first two because the gate must not approve changes to itself, the last because pnpm's
lockfile is a YAML file that `**/*.lock` does not match.

## Changing the policy

- Only a human merges a change to `merge-policy.json`: it matches its own deny-list.
- The gate cannot approve edits to itself. A pull request is judged by the policy on `main`, so a
  change that weakens a gate is evaluated under the stronger rule it is trying to remove. If the
  gate could approve that change, any agent that wanted to pass would first make the gate pass.
- Every merge records the policy version and the SHA of the commit that last changed this file,
  so a past merge can be reproduced under the policy that allowed it.

## Why a human always decides on agent-authored code

Public precedents agree on this. The best-documented tiered AI approver in production requires a
human for every agent-authored pull request. Reviewer recall on benchmarks is roughly 24–68%, and
METR found that about half of the agent pull requests that passed their tests would not have been
merged by the maintainers. Unattended merge of agent-written code is not supported by the
evidence. This policy uses automation to prepare and compress the human decision, not to replace
it. Sources: `merge-research/SYNTHESIS.md` in the shared workspace.
