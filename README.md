# Desire · Mesa de campaña

Primer destino: Waterdeep. La intención es soportar otras ciudades y campañas con contenido separado del motor. Las [reglas de código](docs/reglas-de-codigo.md) ya están activas; [AGENTS.md](AGENTS.md) las establece como instrucciones del proyecto. El alcance actual es preparar y evaluar el entorno antes de implementar el producto.

## Stack configurado

| Capa | Elección | Estado |
| --- | --- | --- |
| Interfaz | Svelte 5 + TypeScript + Vite 8 | Configuración y pantalla de diagnóstico |
| Motor 3D | PlayCanvas 2.23.2 | Dependencia; aún no hay escena ni prueba de GPU |
| Servidor | Rust + Axum + Tokio | Esqueleto con `GET /api/health` |
| Núcleo compartido | Rust, crate `desire-core` | Compilación nativa directa verificada |
| WebAssembly | `wasm-bindgen` + `wasm-pack` | Crate preparado; target y herramienta pendientes |
| Datos | PostgreSQL 17 en Docker Compose | Configurado; servicio aún no verificado |
| Paquetes frontend | pnpm 12.11.2 | Fijado en `packageManager`; descarga bloqueada |

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

## Preparación en una terminal con acceso a red

Node recomendado: 22.17.1, indicado en `.nvmrc`; también se admiten versiones >=24. La sesión tiene gestores Node superpuestos: comprobar `node --version` en la terminal que se vaya a usar. Con nvm instalado puede seleccionarse la versión mediante `nvm use`.

Corepack está disponible, pero pnpm no pudo descargarse en el entorno del agente. Con acceso al registro:

```sh
cd /Users/javendano/dev/desire
corepack enable pnpm
pnpm --version
pnpm install
cargo fetch
```

También se puede invocar `corepack pnpm` sin habilitar un comando global. No se ha generado un lockfile artificial: `pnpm-lock.yaml` y `Cargo.lock` deben salir de una resolución real y conservarse en el repositorio cuando termine la instalación. Las versiones directas del frontend están fijadas, salvo los tipos de Node; las transitivas aún no están bloqueadas.

Rust nativo ya está instalado por Homebrew. WebAssembly requiere el target `wasm32-unknown-unknown`, ausente en esa instalación, y `wasm-pack`, también ausente. Para gestionar ese target mediante rustup, seguir su [instalación oficial](https://rustup.rs/) y seleccionar el toolchain del proyecto:

```sh
rustup toolchain install 1.97.1 --profile minimal --component rustfmt --component clippy --target wasm32-unknown-unknown
cargo install wasm-pack --locked
pnpm build:wasm
```

Verificar que `cargo` y `rustc` resuelven al toolchain gestionado por rustup antes de compilar Wasm. No se modificó el Rust de Homebrew ni el perfil de shell del usuario. La exportación inicial solo informa la versión de protocolo; los workers y cálculos se implementarán después de acordar las reglas.

## Verificación y arranque

```sh
pnpm check
pnpm build
pnpm check:rust
pnpm test:rust
pnpm build:wasm
pnpm db:up
docker compose exec -T db pg_isready -U umbra -d umbra
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

Ver [docs/entorno.md](docs/entorno.md) y el [diagnóstico de calidad](outputs/quality/estado-inicial.md). El entorno está configurado, **no verificado de extremo a extremo**. Las reglas están activas; la implementación sigue pendiente de resolver la instalación y establecer una red de tests para los cambios.
