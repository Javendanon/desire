# Application test net

Without tests there is no deterministic gate: the loop can only verify what it can run. This plan
builds on the net D02 created and adds the parts that keep agents from weakening it: a holdout,
the anti-tamper rule, and a cross-crate contract test.

## Runners

| Side | Runner | Why |
| --- | --- | --- |
| Frontend (TypeScript) | Node's built-in `node:test` (D02) | No new dependency. Node 24 (`.nvmrc`, D01) strips TypeScript types natively; Node 22.17 needed `--experimental-strip-types` |
| Rust | `cargo test` through `crates/persistence/test-postgres.sh` | The persistence integration tests need `DESIRE_TEST_SOCKET`, so bare `cargo test` fails closed; the harness owns a disposable cluster |
| Gate tooling (Python) | `unittest` | D02's `test:quality` |

Scripts (`package.json`):

| Script | Runs |
| --- | --- |
| `pnpm test:frontend` | `tests/*.test.ts`: the visible tests, top level only |
| `pnpm test:holdout` | `tests/holdout/*.test.ts`: CI only, see below |
| `pnpm test:rust` | `bash crates/persistence/test-postgres.sh`: disposable PostgreSQL cluster + `cargo test --workspace` |
| `pnpm test` | frontend + rust (not holdout) |

`test:frontend` used the glob `tests/**/*.test.ts`, which would also pick up the holdout. It is now
the top level only, so the holdout runs where it is meant to run and nowhere else.

## Layout

```text
src/lib/health.ts                 /api/health contract and logic, injected I/O (D02)
tests/health.test.ts              visible frontend tests (D02)
tests/holdout/*.test.ts           holdout: hidden from the implementing agent, run in CI
crates/api/src/main.rs            unit tests next to the code (D02)
crates/wasm/tests/protocol.rs     contract: wasm reports the core protocol version
crates/<crate>/tests/*.rs         Rust integration tests, one file per contract
```

Rust contract: `crates/core` exposes only `PROTOCOL_VERSION` today, so the first cross-crate
invariant is that the WebAssembly module reports the version the core defines; otherwise the
browser and the server would disagree silently. The DTO and contract tests for `core` come with
D04, which owns those contracts, under `crates/core/tests/` with the same rules.

## Holdout

`tests/holdout/` holds cases the implementing agent never sees, so an agent cannot make the net
green by fitting the code to the tests it can read. Example of the value: if `checkHealth` were
softened to treat a body that is not JSON as "connected", the 11 visible tests still pass and
the holdout fails.

- **Hidden from the agent**: the loop's dispatcher excludes the directory with sparse-checkout in
  every worktree it hands to an agent (implementation and review), including worktrees created
  before this rule:

  ```sh
  git -C <worktree> sparse-checkout set --no-cone '/*' '!/tests/holdout/'
  ```

  The merge actor's candidate worktree is full.
- **Limit, stated plainly**: sparse-checkout keeps the files out of the working tree; it is not a
  security boundary. An agent with a shell can still read them from git history
  (`git show HEAD:tests/holdout/...`). It stops accidental fitting, not a determined agent. The
  strong form keeps the holdout outside this repository (a private repository or a CI secret that
  only CI checks out); move to it when the holdout starts to matter.
- **Run in CI**: `frontend-check` in `.github/workflows/ci.yml` should also run
  `corepack pnpm test:frontend` and `corepack pnpm test:holdout`. This card does not edit the
  workflow (it is a deny-list path that needs its own human-reviewed change); the step is
  requested on the D24 card. **Until that step exists, nothing runs the holdout
  automatically**; run `pnpm test:holdout` by hand.
- Holdout tests are written by a separate step (a person, or a test-writing card that is not the
  implementation card), never by the agent implementing the feature they cover.

## Anti-tamper rule

1. An implementation card **may not modify existing assertions**. If a test is wrong, that is a
   separate card with its own review.
2. New tests are written in a separate step from the code they test. A card that implements a
   feature and writes its tests in the same diff gets more scrutiny, not more trust.
3. A diff that touches tests and code together is flagged by the merge policy and reviewed with
   that in mind (`changes tests and code together` is recorded as a reason on the card).

What enforces each rule today:

| Rule | Enforced by |
| --- | --- |
| No new skip/only, no deleted test, no suppression pragma, no loosened threshold | `tools/ci/tamper_check.py` in the `quality-gate` CI job (D24), and the loop's anti-tamper check on the integrated diff before merging |
| Tests and code together raise scrutiny | The loop's tier classifier with `merge-policy.json` (D25) |
| Existing assertions are not modified | **Review only**: no deterministic check yet. A changed `assert`/`expect` line in an existing test file is something the reviewer must raise |
| Holdout hidden from the agent | sparse-checkout in the loop's agent worktrees (not a security boundary: see Holdout) |

The CI step that fails on an added `.skip`, a deleted test or a lowered threshold is D24's
`tools/ci/tamper_check.py`; it is referenced here, not duplicated.
