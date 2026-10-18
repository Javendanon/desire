# Desire · Mesa de campaña

Primer destino: Waterdeep. La intención es soportar otras ciudades y campañas con contenido separado del motor. Las [reglas de código](docs/reglas-de-codigo.md) ya están activas; [AGENTS.md](AGENTS.md) las establece como instrucciones del proyecto. El alcance actual es preparar y evaluar el entorno antes de implementar el producto.

## Stack configurado

| Capa | Elección | Estado |
| --- | --- | --- |
| Interfaz | Svelte 5 + TypeScript + Vite 8 | Diagnostic screen; `check` and `build` pass |
| Motor 3D | PlayCanvas 2.23.2 | Imported by the screen; GPU rendering not verified |
| Servidor | Rust + Axum + Tokio | `GET /api/health` runs and the frontend consumes it |
| Núcleo compartido | Rust, crate `desire-core` | Native compilation verified |
| WebAssembly | `wasm-bindgen` + `wasm-pack` | `build:wasm` produces `src/generated/wasm/` |
| Datos | PostgreSQL 17 in Docker Compose | Verified on `127.0.0.1:55432`; stopped with volume preserved |
| Paquetes frontend | pnpm 12.11.2 | Real lockfile; `--frozen-lockfile` passes |

No hay implementación de mapas, autenticación, persistencia, sincronización, ni integración autenticada con Nivel20. El diagnóstico HTTP solo comprueba que el proceso vive; no comprueba PostgreSQL. No se ejecuta ninguna operación de Nivel20.

## Estructura

La coordinación de agentes, ramas y entregas está en
[docs/desarrollo-paralelo.md](docs/desarrollo-paralelo.md).

```text
src/                  # Svelte y TypeScript
crates/api/           # Proceso Rust nativo
crates/core/          # Núcleo común, sin dependencias de navegador
crates/wasm/          # Exportaciones al navegador
public/               # Recursos y referencias vendorizadas
docs/                 # Investigación y estado del entorno
docs/archive/         # Borrador anterior, fuera de la compilación
compose.yaml          # PostgreSQL local
```

El borrador React/Zustand se conserva en `docs/archive/react-draft`; ya no forma parte de las dependencias o entradas activas. Scroll World y las instrucciones de diseño permanecen disponibles para uso posterior, sin activar servicios de pago ni incorporar una intro a la mesa todavía.

## Setup on a machine with registry access

Node 24.18.0 is the verified default and is pinned in `.nvmrc`; the `engines`
field also admits Node >=24. Use a Node version whose bundled Corepack is 0.35.0
or newer. Corepack 0.33.0 (bundled with Node 22.17.1) cannot launch pnpm 12.11.2.

```sh
nvm use
corepack pnpm --version   # must print 12.11.2
corepack pnpm install
cargo fetch
```

`pnpm-lock.yaml` and `Cargo.lock` come from a real resolution and are committed.
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

## Verificación y arranque

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

En dos terminales separadas:

```sh
pnpm dev:api
```

```sh
pnpm dev
```

Interfaz: `http://127.0.0.1:5173`. API: `http://127.0.0.1:3001/api/health`. Vite hace proxy de `/api` durante desarrollo; `vite preview` no proporciona un backend ni un proxy de producción. La comprobación del motor en pantalla solo valida su importación, no el renderizado.

PostgreSQL se expone en `127.0.0.1:55432` para evitar ocupar el puerto habitual 5432. Los valores de `.env.example` son exclusivamente locales. La API aún no carga ese archivo ni abre conexiones a la base. Para detener la base sin borrar datos: `pnpm db:stop`.

## Estado de verificación

See [docs/entorno.md](docs/entorno.md) and the [quality diagnosis](outputs/quality/estado-inicial.md).
The listed environment gates were executed: frontend `check`/`build`, Rust
`fmt`/`clippy`/`test`, the Wasm build, the `/api/health` round trip and the
PostgreSQL service check. The Rust test suite is empty (0 tests), GPU rendering is
not verified, and the API does not read PostgreSQL yet, so this is not an
end-to-end product validation. The Nivel20 integration remains read-only and untouched.
