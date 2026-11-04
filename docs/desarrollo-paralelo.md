# Desarrollo paralelo de Desire

Contrato: una tarjeta tiene un responsable, una rama y un alcance acordado.
Aplican AGENTS.md y las reglas de código; este protocolo no reemplaza sus gates.

## Punto de partida

- Board: http://localhost/board/1fa12ac3-23c6-4520-b8ca-a849641617de, nombre Desire.
- Checkout de integración: `/Users/javendano/dev/desire`, rama `main`.
- Worktrees: `/Users/javendano/dev/desire-worktrees/<codigo>`.
- Integrador inicial: Codex, sesión principal; cualquier relevo se registra en el board.
- D04 es responsable de contratos de dominio, IDs, unidades, DTOs y eventos.
- D01 es responsable de manifiestos, toolchains y lockfiles.
- D02 es responsable del gate y sus reglas de análisis.

Git ya existía con un commit que solo incluía el README. D00 registró el scaffold
preexistente como snapshot, sin cambiar lógica de producto. El diagnóstico sanitizado
`outputs/quality/estado-inicial.md` viaja con el repositorio; sus JSON, logs y capturas
son artefactos locales que se regeneran con los comandos del informe.

La disponibilidad de dependencias y la compilación completa siguen siendo D01.
Un worktree contiene fuentes y documentación; no hereda node_modules, cachés, .env
ni procesos. El snapshot no certifica la calidad del código que ya existía.

## Tomar una tarjeta

1. Leer la tarjeta completa, dependencias, AGENTS.md y las reglas de código.
2. Releer el board justo antes de tomarla. Debe estar disponible, sin responsable
   ni claim ajeno, y con los entregables de sus dependencias verificados.
3. Si el MCP expone claim atómico, usarlo y comprobar su resultado. Un conflicto
   significa que otro agente tiene la tarjeta; no sobrescribir al responsable.
4. Si solo expone update_card y move_card, el integrador serializa las asignaciones.
   Asigna, mueve a Doing y relee el board. Esta secuencia NO es un bloqueo atómico:
   dos agentes autónomos no deben reclamar simultáneamente con ese mecanismo.
5. Comentar responsable, alcance, rama, worktree y archivos compartidos necesarios.
6. Crear el worktree desde el main actual y trabajar únicamente dentro de él.

Ejemplo de creación, sustituyendo el código por la tarjeta reclamada:

```sh
git -C /Users/javendano/dev/desire worktree add \
  -b task/d03-diseno /Users/javendano/dev/desire-worktrees/d03 main
```

No reutilizar una carpeta o rama que ya pertenezca a otro agente. La verificación es
`git worktree list --porcelain` y la lectura del responsable/comentario en el MCP.
Asignar una tarjeta no autoriza tomar sus dependencias ni las tareas vecinas.

En la prueba D00, el servidor devolvió claimedBy/claimedAt/dependsOn, pero la sesión
solo anunció update_card/move_card: no se infiere una capacidad de claim invocable
por ver esos campos. Refrescar las herramientas disponibles antes de una nueva toma.

## Propiedad inicial de archivos

Los directorios siguientes son límites propuestos; algunos aún no existen. No son
una invitación a crear módulos vacíos. Ajustar el límite en un comentario antes de
invadir el alcance de otra tarjeta, conservando una sola persona responsable.

| Tarjeta | Responsabilidad y alcance principal |
| --- | --- |
| D00 | Protocolo de coordinación y preparación del historial Git |
| D01 | Manifiestos, toolchains, lockfiles, Compose y docs de instalación |
| D02 | Tooling/tests de calidad; diagnóstico actual coordinado con dueño de UI |
| D03 | `docs/design/`, tokens y prototipo visual aislado |
| D04 | `docs/modelo-de-datos.md` y fuente única de contratos compartidos |
| D05 | `docs/maps/waterdeep/`, referencias y calibración |
| D06 | Evidencia de APIs Nivel20, sin escrituras ni credenciales persistidas |
| D07 | `content/knowledge/` e importación de conocimiento |
| D08 | `crates/persistence/`, migraciones y repositorios |
| D09 | Handlers y servicios API por recurso en `crates/api/` |
| D10 | Módulos auth/realtime y transporte versionado |
| D11 | `src/lib/engine/` y host del visor |
| D12 | `crates/core/routing/`, exportaciones Wasm y worker de cálculo |
| D13 | `content/maps/waterdeep/` y generación de escena |
| D14 | Viaje/transiciones y controles relacionados |
| D15 | Features campaña/conocimiento; composición global App/rutas |
| D16 | Features de personajes y encuentros |
| D17 | Features DM y estado de visibilidad autorizado |
| D18 | `tools/assets/`, manifiesto de assets y documentación |
| D19 | Adapter Nivel20 y preview de importación de lectura |
| D20 | Prólogo opcional aislado de la mesa |
| D21 | Benchmarks, fixtures de carga e informes de rendimiento |
| D22 | E2E, validación visual y revisión de la primera sesión |

Un archivo compartido necesita coordinación adicional: D02 no cambia dependencias
de package.json sin acordarlo con D01; D11 no sustituye App.svelte mientras D02 lo
corrige; D09/D10 acuerdan los módulos API compartidos. D15 integra la composición
global después de esas entregas. Los worktrees aíslan archivos, no evitan conflictos
semánticos: las interfaces y modificaciones transversales deben revisarse igualmente.

## Orden de trabajo e integración

Las dependencias están en las descripciones Dxx; no se consideran cargadas en el
campo dependsOn hasta comprobarlo. El integrador mantiene la disponibilidad leyendo
los entregables y moviendo a Todo las tarjetas desbloqueadas. No deducir disponibilidad
de una lista MCP de tareas listas si sus dependencias estructuradas están vacías.

- D00 establece el protocolo; D01–D06 pueden avanzar en sus alcances independientes.
  D02 puede diseñarse en paralelo a D01, pero necesita su entorno para cerrar pruebas.
- D04 habilita D07; D01 + D04 habilitan D08; D08 habilita la API D09 y después D10.
- D01 + D03 + D04 habilitan D11; D01 + D02 + D04 habilitan D12.
- D05 + D11 + D04 habilitan D13; D10 + D12 + D13 habilitan D14.
- D03 + D07 + D09 + D11 habilitan D15 y D16, con alcances distintos.
- D10 + D13 + D14 habilitan D17; D04 + D05 + D11 habilitan D18.
- D04 + D06 + D09 habilitan D19; D03 + D15 habilitan D20.
- D12 + D13 + D14 + D16 habilitan D21; D02 + D14–D17 + D21 habilitan D22.

D19 y D20 son opcionales para la primera sesión. El orden es por dependencia,
no por número de tarjeta. Mantener inicialmente hasta tres tarjetas de implementación
en Doing y capacidad independiente para revisión; comprobar el conteo en get_board.
La coordinación documental D00 no consume una plaza de implementación.

## Entregar y revisar

1. Registrar en la tarjeta archivos tocados, commit, comportamiento obtenido y pruebas.
   Los datos de ejemplo llevan procedencia y no incluyen secretos.
2. Adjuntar métricas antes/después con idéntico alcance y cobertura. No comparar un
   score que incluye vendor con otro que lo excluye; Svelte/HTML necesitan cobertura.
3. Pedir advisor independiente cuando lo exijan las reglas. Entregarle diff, reporte
   y comandos; cada observación se corrige o queda justificada con evidencia.
4. El integrador verifica el estado de main y de su checkout antes de integrar.
   Si hay cambios ajenos, no usar reset, clean ni reemplazar archivos para forzar merge.
5. Integrar una rama revisada por vez. Preferir fast-forward cuando sea posible;
   resolver divergencias con su autor y repetir las verificaciones afectadas.
6. Confirmar en main el entregable y las verificaciones. Después marcar done=true,
   mover a Done y releer el board: done y columna son campos distintos en este MCP.
7. Añadir comentario de cierre y desbloquear solo las tarjetas cuyas dependencias
   completas estén verificadas. No lanzar nuevos agentes como efecto lateral.

Si hay un impedimento real, comentar causa, evidencia y acción necesaria y mover a
Blocked. No reasignar un claim abandonado solo porque pasó tiempo: el integrador debe
confirmar su liberación. No borrar worktrees ni ramas con cambios sin revisar.

Las tarjetas documentales se validan por coherencia, enlaces, diff y revisión;
no requieren añadir tests artificiales. Eso no exime de pruebas a cambios de lógica.
Un test bloqueado se registra como bloqueado, nunca como aprobado.
