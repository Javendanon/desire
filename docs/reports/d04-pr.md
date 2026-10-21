# D04: definir contratos versionados para campañas y ciudades

Desire necesita contratos comunes antes de implementar persistencia, API y visor.
Este cambio define el modelo multi campaña/ciudad y genera DTOs Rust/TypeScript desde
un único JSON Schema. Incluye IDs, reglas 2014/2024, calibración, revisiones, procedencia,
proyecciones de jugador separadas de secretos DM y dos eventos v1.

Las fixtures sintéticas muestran dos campañas compartiendo Waterdeep sin compartir
modificaciones y una escena de caverna en mapa independiente. Se incluye un plan de
migraciones, validador offline, comprobación de referencias y detección de artefactos
generados desactualizados.

## Validación

- 24 pruebas Python y 5 pruebas Rust de contratos.
- Clippy del core aislado con `-D warnings`, formato Rust y tipos TS comprobados.
- Kimün 0.26.0: score 100 → 98.1 A++, duplicación 0 → 0.6%, CC máx. 8,
  cognitiva máx. 10; mismos 2 smells preexistentes fuera de D04.
- Revisión independiente con corrección de referencias anidadas y regresiones.

La suite workspace offline está bloqueada por Axum ausente, igual que la base.
Los tests Rust se ejecutaron con el core exacto en workspace temporal sin API/Wasm.
TS se comprobó con compilador local 7.0.2, no con el 5.9.3 declarado en Desire.
Svelte/HTML y validación integral del producto siguen pendientes de D01/D02.

## Coordinación

Core añade Serde workspace y serde_json como dependencia de tests; D01 debe incorporar
su resolución al lockfile real. No hay cambios UI, Docker ni integración Nivel20.
D08/D09/D10 deberán implementar restricciones SQL, validación runtime y autorización.
Los tipos por sí solos no validan todas las restricciones semánticas.

Detalle y evidencia: `docs/modelo-de-datos.md` y `docs/reports/d04.md`.
No desbloquear consumidores ni marcar D04 Done hasta revisión e integración en main.
