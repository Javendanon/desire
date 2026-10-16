# Evaluación inicial con Kimün

Estado: **NO APROBADO como gate integral**. Reglas activas en
`docs/reglas-de-codigo.md`. Herramienta: `km 0.26.0`.

Esta pasada activa las reglas y evalúa el estado existente. No modifica código de
producto ni corrige incumplimientos sin una red de pruebas. La evaluación independiente
fue realizada por un agente distinto del autor del código, en modo de solo lectura.

## Alcance y resultados

| Alcance | Resultado | Interpretación |
| --- | --- | --- |
| Árbol completo, `km score .` | 63,73 / D+, 10 archivos, 438 LOC | Incluye fuente vendorizada y borrador archivado; bajo el piso 77 |
| Código activo reconocido por `km` | 100 / A++, 6 archivos, 60 LOC | Supera 87, pero omite Svelte y HTML; no representa todo el proyecto |
| Duplicación del mismo código activo | 0%, 0 grupos, bloques mínimos de 6 líneas | Cumple piso 10% y objetivo 5% en ese alcance |
| Ciclomática activa reconocida | Máximo 2 | Cumple objetivo 10 en ese alcance |
| Cognitiva activa reconocida | Máximo 1 | Cumple límite 15 en ese alcance |
| Script de `App.svelte`, extraído sin alterar su contenido | Ciclomática 13, cognitiva 12 | Ciclomática sobre objetivo 10, dentro del piso 15 |
| Callback `onMount` en script Svelte | 27 líneas según heurística de `km`; 30 físicas en el cuerpo | Sobre objetivo 25, dentro del piso 40 |

El frontend Svelte no se analiza directamente en esta versión de `km`: se extrajo
solo su bloque TypeScript a un archivo temporal `.ts` y se midió aparte. Su plantilla
y CSS requieren revisión adicional. El medidor identifica `onMount` como una función
y agrupa decisiones de sus callbacks: es evidencia heurística, no un análisis AST
exacto de cada función anidada. No se inventó un score agregado para Svelte.

Los JSON originales están en `baseline/`. El resultado de la primera duplicación
incluía los propios JSON de métricas; se conserva como diagnóstico inválido para el
gate en `diagnostic-dups-with-artifacts.json`. Se corrigió el alcance excluyendo
`outputs` y limitándolo a las mismas extensiones de código del score. El 42% inicial
no era duplicación del producto y no se usa como baseline válido.

## Hallazgos contrastados por el advisor

| Estado | Evidencia | Regla y acción pendiente |
| --- | --- | --- |
| Bloqueante | `crates/api/src/main.rs:36`, `let _ = tokio::signal::ctrl_c().await` | F11: 1 error descartado sin contexto; necesita manejo explícito |
| Bloqueante | `index.html:1`, 470 columnas | F16: documento comprimido y límite 100 excedido |
| Bloqueante | `src/App.svelte:57`, 103 columnas | F16: límite 100 excedido; CSS también contiene varias declaraciones por línea |
| Bajo objetivo | `src/App.svelte:7`, callback `onMount` | F1/F4: 27 líneas heurísticas y ciclomática 13; objetivos 25 y 10 |
| Diseño pendiente | `src/App.svelte:11–20` | F12/F14: mezcla lectura HTTP, validación y presentación; separar lógica pura con pruebas primero |
| Documentación pendiente | `crates/api/src/main.rs:1`, `crates/wasm/src/lib.rs:1`, `src/main.ts:1`, `vite.config.ts:1`, `svelte.config.js:1` | §5: faltan contratos de módulo en 5 módulos |
| Deuda previa | `docs/archive/react-draft/` | §5: borrador inactivo conservado antes de estas reglas; retirarlo de la distribución tras establecer historial Git |

Las capturas de errores de `App.svelte:22` y `:30` muestran un estado en pantalla, pero
pierden la causa original. Revisar el contexto de diagnóstico durante su corrección;
no confundir estos casos con el descarte completamente silencioso de Rust.

`km smells` señala 6 parámetros en `vite.config.ts:4`. Es un **falso positivo**:
`defineConfig` recibe un único objeto de configuración; no declara una función de 6
parámetros. El literal 5173 señalado en `vite.config.ts:7` es configuración de red,
no un número mágico de dominio D&D. Ambas decisiones son revisión manual documentada,
no exclusiones globales de estas reglas.

No se encontraron archivos activos de más de 400 líneas ni algoritmos cuadráticos.
Los pequeños módulos de arranque quedan por debajo de 50 LOC: no se rellenarán con
código artificial para alcanzar el rango orientativo 50–300.

## Pruebas y límites del gate

- No se encontraron tests de producto existentes. Esto no equivale a suite verde.
- `cargo test --workspace --offline`: bloqueado; Axum no está en la caché.
- `corepack pnpm check`, con caché local: bloqueado al descargar pnpm por DNS.
- `cargo fmt --all --check`: correcto. Comprueba formato Rust, no comportamiento.
- No se ejecutó ni modificó Docker. La instalación y verificación del stack siguen
  pendientes; este análisis estático no las sustituye.
- No hay repositorio Git en este directorio; no existe un diff contra HEAD ni una
  comparación con historial. El advisor recibió el código actual y las métricas.
- No se ha implementado aún un envoltorio que haga cumplir automáticamente **todos**
  los umbrales. `km dups --max-dup-ratio 10` sí falla por exceso de duplicación;
  `km smells` no cambia su salida a error por cada olor. El éxito de un comando no
  significa éxito del gate. La cobertura restante es revisión manual explícita.

## Reproducción del alcance activo

Estos filtros excluyen dependencias, artefactos y código no compilado; la medición
sin filtros se conserva por separado para que esas exclusiones sean visibles.

```sh
set -- . \
  --exclude-dir docs --exclude-dir vendor --exclude-dir .agents \
  --exclude-dir .local --exclude-dir target --exclude-dir node_modules \
  --exclude-dir generated --exclude-dir dist --exclude-dir outputs \
  --include-ext rs --include-ext ts --include-ext js
km score "$@" --format json
km smells "$@" --max-lines 40 --max-params 4 --format json
km smells "$@" --max-lines 25 --max-params 3 --format json
km cycom "$@" --per-function --format json
km cogcom "$@" --per-function --format json
km dups "$@" --min-lines 6 --max-dup-ratio 10 --report --show-all --format json
```

Para repetir el diagnóstico complementario de Svelte:

```sh
mkdir -p /tmp/umbra-km-svelte
python3 - <<'PY'
from pathlib import Path

source = Path('src/App.svelte').read_text()
start = source.index('>', source.index('<script')) + 1
end = source.index('</script>', start)
Path('/tmp/umbra-km-svelte/App.script.ts').write_text(source[start:end])
PY
km smells /tmp/umbra-km-svelte --max-lines 25 --max-params 3 --format json
km cycom /tmp/umbra-km-svelte --per-function --format json
km cogcom /tmp/umbra-km-svelte --per-function --format json
```

Este extractor puntual sirve para el componente actual, con un único bloque script.
No es un parser general de Svelte ni el futuro gate del proyecto.

## Antes y después de esta evaluación

No cambió el código medido: el antes/después tiene las mismas métricas y los mismos
hallazgos. Se añadieron reglas, instrucciones y evidencia; no se atribuye una mejora
de score a cambios documentales. Este baseline es una observación inicial, no un
valor congelado que deba reproducirse después de cualquier cambio.

Próximo paso técnico: desbloquear dependencias, establecer tests que fallen al romper
la validación y el manejo de errores, corregir los incumplimientos, completar cobertura
Svelte/HTML y automatizar el gate. Cada refactor debe comparar antes/después con el
mismo alcance y recibir revisión independiente.
