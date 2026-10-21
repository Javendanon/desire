# Desire · Campaign table

First destination: Waterdeep. The intent is to support other cities and campaigns with
content kept separate from the engine. The [code rules](docs/reglas-de-codigo.md) are
already active; [AGENTS.md](AGENTS.md) establishes them as project instructions. The
current scope is to prepare and evaluate the environment before implementing the
product.

## Configured stack

| Layer | Choice | State |
| --- | --- | --- |
| Interface | Svelte 5 + TypeScript + Vite 8 | Diagnostic screen; `check` and `build` pass |
| 3D engine | PlayCanvas 2.23.2 | Imported by the screen; GPU rendering not verified |
| Server | Rust + Axum + Tokio | `GET /api/health` runs and the frontend consumes it |
| Shared core | Rust, crate `desire-core` | Native compilation verified |
| WebAssembly | `wasm-bindgen` + `wasm-pack` | `build:wasm` produces `src/generated/wasm/` |
| Data | PostgreSQL 17 in Docker Compose | Verified on `127.0.0.1:55432`; stopped with the volume preserved |
| Frontend packages | pnpm 12.11.2 | Single-document lockfile; `--frozen-lockfile` passes |

There is no implementation of maps, authentication, persistence, synchronization, or an
authenticated Nivel20 integration. The HTTP diagnostic only checks that the process is
alive; it does not check PostgreSQL. No Nivel20 operation is performed.

## Structure

Agent, branch and handoff coordination lives in
[docs/desarrollo-paralelo.md](docs/desarrollo-paralelo.md).

```text
src/                  # Svelte and TypeScript
crates/api/           # Native Rust process
crates/core/          # Shared core, no browser dependencies
crates/wasm/          # Browser exports
public/               # Assets and vendored references
docs/                 # Research and environment state
docs/archive/         # Earlier draft, outside the build
compose.yaml          # Local PostgreSQL
pnpm-workspace.yaml   # pnpm project settings (keeps the lockfile single-document)
```

The React/Zustand draft is kept in `docs/archive/react-draft`; it is no longer part of
the active dependencies or entry points. Scroll World and the design instructions remain
available for later use, without activating paid services or adding a table intro yet.

## Setup on a machine with registry access

Node 24.18.0 is the verified default and is pinned in `.nvmrc`; the `engines` field
requires Node >=24. Use a Node version whose bundled Corepack is 0.35.0 or newer.
Corepack 0.33.0 (bundled with Node 22.17.1) cannot launch pnpm 12.11.2 on a clean
cache.

```sh
nvm use
corepack pnpm --version   # must print 12.11.2
corepack pnpm install
cargo fetch
```

`pnpm-lock.yaml` and `Cargo.lock` come from a real resolution and are committed. The
lockfile is a single YAML document; `pnpm-workspace.yaml` sets `pmOnFail: ignore` so
pnpm 12 does not append its leading package-manager env document. Corepack still
enforces the `packageManager` version from `package.json`.
`corepack pnpm install --frozen-lockfile` must pass after a clean checkout.

Native Rust 1.97.1 is installed by Homebrew. WebAssembly needs rustup, the
`wasm32-unknown-unknown` target and `wasm-pack`. The verified isolated setup keeps
the extra toolchain inside the worktree (`.local/` is gitignored):

```sh
export RUSTUP_HOME="$PWD/.local/rustup"
export CARGO_HOME="$PWD/.local/cargo"
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --no-modify-path --profile minimal \
      --default-toolchain 1.97.1 \
      --component rustfmt --component clippy \
      --target wasm32-unknown-unknown
export PATH="$CARGO_HOME/bin:$PATH"
cargo install wasm-pack --locked
corepack pnpm build:wasm
```

Verify that `cargo` and `rustc` resolve to the rustup-managed toolchain before
building Wasm. A per-user rustup installation with the same commands works too.
The initial Wasm export only reports the protocol version; workers and calculations
will be implemented after the rules are agreed.

## Verification and startup

Every command below was executed on 18 October 2026; results and exact versions are
recorded in [docs/entorno.md](docs/entorno.md).

```sh
pnpm check
pnpm build
pnpm check:rust
pnpm test:rust
pnpm build:wasm
lsof -nP -iTCP:55432 -sTCP:LISTEN   # must be empty before starting the db
pnpm db:up
docker compose exec -T db pg_isready -U umbra -d umbra
pnpm db:stop                        # keeps the named volume and its data
```

In two separate terminals:

```sh
pnpm dev:api
```

```sh
pnpm dev
```

Interface: `http://127.0.0.1:5173`. API: `http://127.0.0.1:3001/api/health`. Vite
proxies `/api` during development; `vite preview` provides neither a backend nor a
production proxy. The engine check on screen only validates its import, not rendering.

PostgreSQL is exposed on `127.0.0.1:55432` to avoid occupying the usual port 5432. The
values in `.env.example` are local only. The API does not load that file or open
database connections yet. To stop the database without deleting data: `pnpm db:stop`.

## Verification state

See [docs/entorno.md](docs/entorno.md) and the
[quality diagnosis](outputs/quality/estado-inicial.md). The listed environment gates
were executed: frontend `check`/`build`, Rust `fmt`/`clippy`/`test`, the Wasm build,
the `/api/health` round trip and the PostgreSQL service check. The Rust test suite is
empty (0 tests), GPU rendering is not verified, and the API does not read PostgreSQL
yet, so this is not an end-to-end product validation. The Nivel20 integration remains
read-only and untouched.
