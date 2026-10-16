# Verificación del entorno · 15 de octubre de 2026

## Comprobado

- Rust 1.97.1 y Cargo 1.97.1 instalados por Homebrew.
- `cargo metadata --no-deps --format-version 1 --offline`: correcto; reconoce los tres crates del workspace.
- `cargo fmt --all --check`: correcto.
- Compilación de `crates/core/src/lib.rs` con `rustc --edition=2024 --crate-type=lib`: correcta. El núcleo solo contiene una constante de protocolo; no constituye un benchmark ni valida lógica de juego.
- Node y Corepack disponibles. Se observaron resoluciones de Node 22.17.1 y 26.5.0 según el comando/gestor; `.nvmrc` fija la versión recomendada sin cambiar configuraciones globales.
- Versiones de Svelte, plugin Svelte y PlayCanvas contrastadas con sus releases oficiales. El plugin 7.3.1 declara compatibilidad con Svelte >=5.46.4 y Vite 8.

## Bloqueos concretos

1. **Registro de paquetes inaccesible desde la terminal del agente.** La instalación inicial falló con `getaddrinfo ENOTFOUND registry.npmjs.org`. Después de la instrucción de usar pnpm, se fijó pnpm 12.11.2 y se intentó `corepack pnpm --version` con caché dentro de `.local`; falló al descargar pnpm por el mismo error DNS. No hay pnpm instalado, dependencias resueltas ni lockfile.
2. **Rust offline incompleto.** `cargo check --workspace --offline` falla porque Axum no está en la caché de crates. No se ha compilado ni arrancado la API completa.
3. **WebAssembly pendiente.** Homebrew solo tiene el target nativo `aarch64-apple-darwin`. No están instalados rustup ni wasm-pack. El crate existe, pero no hay artefacto Wasm generado ni worker conectado.
4. **Docker fuera del permiso del agente.** `docker info` falla al conectar con `/Users/javendano/.docker/run/docker.sock`: `operation not permitted`. Esto no demuestra que Docker Desktop esté apagado. No se intentó cambiar permisos ni reconfigurar el daemon.

## Alternativa mínima

Ejecutar la preparación del README desde una terminal del usuario con acceso a red y a Docker. Después, comprobar build del frontend, API, artefacto Wasm y salud de PostgreSQL. No se necesita cerrar Chrome ni reiniciar su perfil.

Actualización: las reglas entregadas por el usuario están activas en `docs/reglas-de-codigo.md` y enlazadas desde `AGENTS.md`. El diagnóstico de calidad inicial está en `outputs/quality/estado-inicial.md`. Solo se habían añadido configuración, el punto de entrada del frontend y diagnósticos mínimos; el borrador anterior permanece fuera de la compilación y su retirada deberá resolverse respetando la regla de código muerto.

## Referencias de versiones

- [PlayCanvas 2.23.2](https://github.com/playcanvas/engine/releases/tag/v2.23.2)
- [Svelte 5.57.2](https://github.com/sveltejs/svelte/releases/tag/svelte@5.57.2)
- [Plugin Svelte 7.3.1](https://github.com/sveltejs/vite-plugin-svelte/releases/tag/@sveltejs/vite-plugin-svelte@7.3.1)
- [Axum 0.8.9](https://docs.rs/crate/axum/0.8.9)
- [pnpm 12.11.2](https://github.com/pnpm/pnpm/releases/tag/v12.11.2) e [instalación](https://pnpm.io/installation)
