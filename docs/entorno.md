# Environment verification · 18 October 2026

Scope: D01 only — manifests, lockfiles, toolchains, Compose and installation
documentation. No product logic was implemented. Every result below comes from a
command executed in this worktree; nothing blocked is reported as passing.

## Toolchain selection

| Tool | Version used | Selection note |
| --- | --- | --- |
| Node | 24.18.0 | Pinned in `.nvmrc`. Node 22.17.1 ships Corepack 0.33.0, which cannot run pnpm 12.11.2 (writes `bin/pnpm.cjs`, while pnpm ships `bin/pnpm.mjs`). |
| Corepack | 0.35.0 | Bundled with Node 24.18.0. Required to launch pnpm 12.11.2. |
| pnpm | 12.11.2 | Resolved from `packageManager`; reports `12.11.2`. |
| Rust / Cargo | 1.97.1 | Pinned by `rust-toolchain.toml`. Rustup-managed toolchain is used for Wasm; Homebrew Rust 1.97.1 reports the same compiler version for native gates. |
| rustup | 1.29.1 | Installed under `.local/rustup` (gitignored), with `--no-modify-path`. |
| wasm-pack | 0.15.0 | Installed with `cargo install wasm-pack --locked` under `.local/cargo` (gitignored). |
| wasm32 target | `wasm32-unknown-unknown` | Installed by rustup for the 1.97.1 toolchain. |
| Docker | 28.1.1 | Daemon reachable; no daemon restart was performed. |
| PostgreSQL | 17.11 (`postgres:17-alpine`) | Started through the existing Compose project, then stopped; volume preserved. |

The isolated rustup/Cargo homes keep the Wasm toolchain inside the worktree. They
are already covered by the `.local/` gitignore rule, so no machine-wide Rust
installation was replaced or added. The default Corepack cache contained a pnpm
12.11.2 entry written by Corepack 0.33.0 with the wrong `bin/pnpm.cjs` path; that
cache entry was replaced by a fresh download. No global pnpm package was installed.

## Before vs after

| Blocker in the 15 October report | Result now | Evidence |
| --- | --- | --- |
| Package registry unreachable; no pnpm, no lockfile | Resolved | `pnpm install` resolved 52 packages; `pnpm-lock.yaml` generated and `pnpm install --frozen-lockfile` passes. |
| `cargo check --offline` failed because Axum was not cached | Resolved | `cargo check --workspace --locked` passes with the registry available; `Cargo.lock` generated. |
| No Wasm target or wasm-pack | Resolved | rustup installed `wasm32-unknown-unknown`; `pnpm build:wasm` produced `src/generated/wasm/desire_wasm_bg.wasm`. |
| Docker unreachable from the agent | Resolved | `docker info` returns 28.1.1; the project database was started and stopped without touching other containers. |

## Frontend gates

```sh
corepack pnpm check
corepack pnpm build
```

- `pnpm check`: `svelte-check found 0 errors and 0 warnings`; the TypeScript project
  for `tsconfig.node.json` also passed.
- `pnpm build`: 1359 modules transformed, production build completed in 410 ms.
  Output: `dist/index.html`, one CSS bundle and two JS bundles.
- `pnpm install --frozen-lockfile`: `Lockfile is up to date, resolution step is skipped`.

## Rust gates

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo check --workspace --locked
```

All four commands exit 0. Clippy reports no warnings. `cargo test` runs the three
crate binaries plus doc-tests: **0 tests, 0 failures**. That is an empty suite, not
coverage of product behavior; no product logic exists yet.

## Wasm gate

```sh
pnpm build:wasm
```

`wasm-pack 0.15.0` compiled `crates/wasm`, installed `wasm-bindgen-cli 0.2.128`,
optimized the binary and wrote `src/generated/wasm/` (36 KB total, including
`desire_wasm_bg.wasm` at 13,329 bytes). The artifact directory is gitignored; it is
a build product, not a source file.

## API health and frontend consumption

The API was started with `cargo run -p desire-api --locked` and probed directly:

```text
GET http://127.0.0.1:3001/api/health -> 200
{"service":"desire-api","status":"ok","scope":"liveness","protocol_version":1}
```

The Vite dev server was then started and the page was loaded in headless Chromium.
The rendered status list contained:

```text
Servidor Rust conectado
PlayCanvas 2.23.2 importado · GPU aún no comprobada
```

`GET http://127.0.0.1:5173/api/health` also returned the same JSON, confirming the
Vite `/api` proxy path used by `src/App.svelte`. This proves the liveness endpoint is
consumed by the frontend. It does not prove GPU rendering, database access from the
API, or any gameplay behavior.

## PostgreSQL verification

Pre-check before starting anything:

- Port `55432` had no listener (`lsof -nP -iTCP:55432` returned nothing).
- `docker compose config` still resolves to the existing identity:
  project `monas-chinas-medievales`, volume `monas-chinas-medievales_umbra_data`,
  port mapping `127.0.0.1:55432:5432`.
- No other running container used port 55432. Unrelated running containers were
  left untouched.

Then:

```sh
docker compose up -d db
docker compose exec -T db pg_isready -U umbra -d umbra
docker compose exec -T db psql -U umbra -d umbra -tAc 'select version();'
docker compose stop db
```

Results: the service became `healthy`; `pg_isready` reported
`/var/run/postgresql:5432 - accepting connections`; the server is PostgreSQL 17.11.
The container was stopped afterwards and the named volume still exists. No volume
was deleted and no foreign container or Docker daemon was modified.

The API does not open database connections yet; this verifies the database service,
not API persistence.

## Quality gate (km 0.26.0)

The reproducible active scope from `outputs/quality/estado-inicial.md` was measured
again with the same filters (Rust, TS and JS; vendor, archive, build output,
dependencies and generated files excluded):

- `km score`: 100.0 / A++ — unchanged from the initial report.
- `km dups`: 0.0% duplication, 0 groups.
- `km smells --max-lines 40 --max-params 4`: only the two documented false positives
  in `vite.config.ts` (the `defineConfig` object parameter and the dev port literal).

The full-tree score is not compared here: the dependency install now creates
`node_modules`, while the original full-tree run predates it. The filtered active
scope is the only comparable baseline. Svelte templates and CSS are still not
analyzed directly by `km`; that limitation is unchanged and is not counted as a pass.

## Remaining limitations

- No product tests exist; `cargo test` passes an empty suite.
- The synthetic WebAssembly export is only `protocol_version`; no worker is wired to
  the frontend.
- PlayCanvas is imported, but GPU rendering is not verified.
- The API health check is liveness only; it does not read PostgreSQL.
- The Nivel20 integration remains out of scope and untouched.
- The `vite.config.ts` smells are documented false positives, not fixes.

## Review notes

- Only `.nvmrc`, the two generated lockfiles and documentation changed; no product
  source code was touched.
- `pnpm-lock.yaml` and `Cargo.lock` are generated artifacts; they were not edited by
  hand.
- The comparable `km` active-scope score is unchanged, so no quality improvement is
  claimed from this environment work.
- The known `vite.config.ts` smells and the Svelte analysis gap remain pre-existing
  debt; they are not silently waived.
- No separate reviewer agent was available in this session. The diff and command
  logs were self-reviewed, but the independent advisor step is still pending.

## Reproduction

```sh
# Node 24.18.0 + Corepack 0.35.0
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm build

cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked

# Isolated Wasm toolchain (already gitignored under .local/)
export RUSTUP_HOME="$PWD/.local/rustup"
export CARGO_HOME="$PWD/.local/cargo"
export PATH="$CARGO_HOME/bin:$PATH"
corepack pnpm build:wasm

# Database: check the port first, then start and stop without deleting data
lsof -nP -iTCP:55432 -sTCP:LISTEN
docker compose up -d db
docker compose exec -T db pg_isready -U umbra -d umbra
docker compose stop db
```
