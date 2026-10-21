# Continuous integration

Workflow: `.github/workflows/ci.yml`. Triggers: `pull_request` (against `main`) and
`merge_group`. Without `merge_group` the merge queue never receives a result and waits forever.

## Jobs

The job names are a contract: `merge-policy.json` (D25) lists one gate per job with the same name,
and the loop's merge actor refuses to merge unless every policy gate has a green check with that
name. Renaming a job is a policy change.

| Job | What it runs | Toolchain |
| --- | --- | --- |
| `frontend-check` | install from lockfile, `pnpm check`, `check:assets`, `test:assets`, `test:frontend`, `check:tests`, `verify:waterdeep` | Node from `.nvmrc` (its bundled corepack), pnpm from `packageManager` |
| `rust-fmt` | `cargo fmt --all --check` | `rust-toolchain.toml` |
| `rust-clippy` | `cargo clippy --workspace --all-targets --locked -- -D warnings` | `rust-toolchain.toml` |
| `rust-test` | `bash crates/persistence/test-postgres.sh` (isolated cluster, then workspace tests) | `rust-toolchain.toml` + PostgreSQL server binaries |
| `wasm-build` | `cargo build -p desire-wasm --target wasm32-unknown-unknown --release --locked` | `rust-toolchain.toml` (wasm32 target) |
| `quality-gate` | anti-tamper and its tests, contract generator drift and contract tests, quality gate | `rust-toolchain.toml` + `kimun` 0.26.0 |

The `rust-test` job discovers the runner's PostgreSQL binaries and adds them to `PATH`
before running the harness. Local runs require `initdb` and `pg_ctl` on `PATH`.

## Fail-closed, on purpose

- Every job installs its own toolchain (`tools/ci/install-rust-toolchain.sh` installs exactly the
  channel, components and targets pinned in `rust-toolchain.toml`) or fails. No step is skipped
  because a tool is missing.
- `--frozen-lockfile` and `--locked` refuse to resolve dependencies on the fly. **Until D01 lands
  `pnpm-lock.yaml` and `Cargo.lock` on `main`, `frontend-check` and the cargo jobs fail.** That is
  the correct outcome: a build that resolves fresh dependencies on every run proves nothing.
- `quality-gate` fails if `tools/quality/gate.py` is absent. That gate is delivered by D02; until
  it is merged this job is red. The card named `tools/km-gate.py . crates src`, which is the
  workspace tool outside this repository; the repository's own gate (D02) is
  `tools/quality/gate.py --root .`, with its baseline and false-positive list, so CI runs that one.
  `kimun` is pinned to 0.26.0, the version the D02 measurements were taken with; upgrading it is a
  deliberate change because scores move between versions.
- Third-party actions are pinned to a commit SHA, with the tag in a comment.
- pnpm 12 needs the corepack bundled with Node 24 (0.35): the one in Node 22.17 (0.33) expects
  `bin/pnpm.cjs` and fails with `MODULE_NOT_FOUND`. If `.nvmrc` ever drops below 24, pin corepack.

## Anti-tamper check

`tools/ci/tamper_check.py <base> HEAD` reads the diff of the change and fails when it:

- adds a suppression pragma in code (TypeScript ignore/expect-error comments, eslint/tslint
  disables, Python noqa/type-ignore/no-cover pragmas, Rust allow attributes, svelte ignores);
- disables or focuses a test (skip/only/todo on a test API, x-prefixed tests, Rust ignore
  attributes, pytest/unittest skips);
- deletes a test file;
- loosens a threshold: a `min`/`floor`/`threshold`/`score`/`coverage` key goes down, or a
  `max`/`limit`/`ceiling`/`budget`/`timeout` key goes up.

Markdown and plain text are not scanned: a pragma in prose has no effect. No path is exempt; the
checker builds its patterns from pieces so its own source does not trip it, and a test enforces
that. It exits 2 when the diff cannot be read: an unreadable diff is never a pass.

A finding means a human looks at the change. Legitimate cases exist (a test that is genuinely
obsolete); they are argued in the pull request, not silenced in the code.

## GitHub settings (cannot be applied from the repository)

Enable these on `main` in **Settings → Rules → Rulesets** (D25's `docs/rulesets.md` explains the
reasoning in full):

1. **Require status checks to pass**, with the six job names above, each pinned to the
   **GitHub Actions** app as its source. A check pinned to the app cannot be satisfied by a commit
   status posted with a token.
2. **Require branches to be up to date** is replaced by the merge queue: enable **Require merge
   queue** with the same six required checks. The queue runs this workflow on the `merge_group`
   event, on the integrated candidate.
3. **Require a pull request before merging** with **Require approval of the most recent reviewable
   push** (`require_last_push_approval`): a push after approval invalidates the approval.
4. **Require conversation resolution before merging**.
5. **Block force pushes** and **Restrict deletions** on `main`.

What this cannot verify from a worktree: that the workflow runs on GitHub. It is validated locally
with a YAML parser and `actionlint`; the first pull request is the real test.
