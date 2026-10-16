# Modelo de datos y contratos v1 · D04

Estado: propuesta implementada y comprobable, pendiente de integración y aprobación.
Los consumidores siguen bloqueados hasta que el integrador verifique esta entrega.

## Fuente de verdad y frontera

`contracts/schema.json` es la fuente normativa de la forma JSON, basada en JSON Schema
2020-12. `tools/contracts/generate.py` produce los DTOs Serde de
`crates/core/src/contracts/` y `src/generated/contracts.ts`. No editar esos artefactos.
`--check` falla si el esquema y los tipos divergen. Los campos wire usan `snake_case`.
Los enums tienen valores explícitos, por ejemplo `dnd_2014` y `dnd_2024`.

La generación cubre un subconjunto deliberado: objetos cerrados, campos requeridos,
arrays, referencias locales, enums, constantes, nullable, UUID y límites numéricos.
`validate.py` valida ese subconjunto offline y rechaza keywords desconocidas al visitar
un nodo. No es un validador general de cualquier JSON Schema ni resuelve URLs.
No aceptar esquemas externos con esta herramienta.

Serde y TypeScript comprueban estructura; **no reemplazan la validación de dominio**.
En particular, `String` no valida UUID, `f64` no obliga escala positiva, `u32` admite cero
que `Revision` prohíbe, y Rust no restringe constantes numéricas/string automáticamente.
D09 debe validar entradas contra el esquema y las invariantes relacionales de este
informe antes de persistir. Los tipos TypeScript no validan JSON recibido en runtime.
No se añade todavía un servidor ni una frontera API que omita esa validación.

Los campos nullable siguen siendo obligatorios: hay que enviar `null` explícito.
Rust usa un deserializador de `Option` sin default para conservar esa distinción.
Los objetos rechazan campos desconocidos también mediante `deny_unknown_fields`.

## Identidades, revisiones y ownership

- IDs: UUID textual canónico en minúscula, asignado una sola vez por la autoridad
  creadora. PostgreSQL los almacenará como `uuid`. Nunca usar nombre, slug, índice de
  array o ID de Nivel20 como identidad interna. Los UUID de fixtures son sintéticos.
- Catálogo global: contenido mantenido por el editor del catálogo; campañas lo leen.
  `World` → `Era` → `City` → `District`/`Place`. No puede modificarse por permisos de DM.
- Campaña: `Campaign.owner_id` identifica al propietario. `Membership` relaciona usuario
  y campaña con rol `dm` o `player`, único por `(campaign_id, user_id)`. Debe existir un
  miembro DM que coincida con el propietario. Identidad de usuario pertenece a D10.
- Datos mutables: `revision` es entero positivo hasta `4294967295`; incrementa en una
  transacción. Update exige revisión esperada; conflicto se devuelve como 409, sin
  sobrescribir. No reciclar revisiones ni desbordarlas silenciosamente.
- Versiones de mapa y entradas de catálogo se fijan por ID/revisión. Un cambio editorial
  crea otra versión, no altera la geometría utilizada por una sesión ya guardada.
- El borrado de contenido referenciado se restringe; archivar campaña o usar tombstone
  de sincronización. Nada de cascadas destructivas sobre el catálogo compartido.

## Entidades y relaciones

| DTO | Propósito y restricciones relacionales |
| --- | --- |
| World / Era | Mundo y periodo nombrado, sin imponer calendario de una ambientación. |
| City | Pertenece a una época. Waterdeep solo aparece en el paquete de contenido. |
| District / Place | Barrio de una ciudad; lugar puede carecer de barrio. Si lo tiene, ambos deben pertenecer a la misma ciudad. |
| MapVersion | `map_id` estable agrupa versiones; `id` identifica una versión inmutable. Ciudad nullable permite cavernas, interiores u otros mapas. |
| Chunk | Pertenece a una versión de mapa; origen en metros, tamaño positivo, URI del asset. Validar URI permitida antes de descargar (D18). |
| KnowledgeEntry | Contenido base con idioma, procedencia y edición de reglas; nunca notas privadas de campaña. |
| Campaign | Configuración y edición única de reglas, ciudad inicial opcional. Puede abrir escenas de otras ciudades/mapas. |
| PlaceOverride | Nombre modificado de un lugar para una campaña; único por `(campaign_id, place_id)`. No actualiza el lugar base. |
| Scene | Referencia una versión de mapa y una campaña. La escena mantiene identidad aunque cambie su nombre. |
| Character | Pertenece a campaña; controlador nullable para NPC. Edición debe coincidir con campaña. No incluye una ficha inventada de Ionyth. |
| Condition | Instancia por personaje; referencia entrada de conocimiento de la misma edición. Rondas restantes positivas o null si duración indefinida. Cero implica retirar condición en D16. |
| Travel | Personaje y escena de la misma campaña; posición/destino en metros; estado explícito y tres magnitudes temporales/espaciales distintas. |
| Session / JournalEntry | Sesión de campaña; una entrada referencia sesión de la misma campaña y tiene visibilidad explícita. |
| CampaignKnowledge | Lore original o notas de campaña, con visibilidad y procedencia propias; no se añade al catálogo global. |
| DmSecret | Cuerpo privado separado, asociado a sujeto estable y campaña. Nunca forma parte de una proyección de jugador. |

`map_id` requiere tabla lógica `maps` en persistencia, aunque el DTO de lectura incluya
solo su ID en `MapVersion`. No es una FK a otra versión. `subject_id` de DmSecret puede
apuntar a un lugar base o un objeto propio; D08 debe almacenar tipo de sujeto y verificar
existencia/ownership mediante relaciones normalizadas, no una FK polimórfica sin control.
Los IDs externos se mantendrán en una tabla de mapeo `(provider, external_id, internal_id)`
por importación/campaña en D19, sin credenciales ni datos de Nivel20 en estas fixtures.

`Provenance` registra fuente, atribución y evidencia (`verified`, `interpretation`,
`synthetic`). No convierte una fuente en licencia ni garantiza que sea reutilizable:
D05/D07/D18 deben registrar licencia/autorización antes de distribuir contenido real.
Todos los textos y escalas de `examples.json` son sintéticos, incluso los asociados al
nombre Waterdeep. No son cartografía calibrada ni reglas D&D verificadas.

## Coordenadas y calibración

Sistema de mundo diestro: X al este, Y hacia arriba, Z al sur. Unidad común: metro;
ángulos en radianes. Coordenadas referidas al origen local de cada versión de mapa,
no latitud/longitud. Una posición solo tiene sentido junto a su escena/mapa.

Raster: u crece a la derecha, v hacia abajo. Para origen `(u0, v0)`, escala `s > 0`
y rotación `θ`, usar:

```text
a = (u - u0) × s
b = (v - v0) × s
x = a × cos(θ) - b × sin(θ)
z = a × sin(θ) + b × cos(θ)
y = elevación explícita, nunca inferida del color del raster
```

Inversa: `a = x cos(θ) + z sin(θ)`, `b = -x sin(θ) + z cos(θ)`,
`u = a/s + u0`, `v = b/s + v0`. Es un modelo de escala uniforme; deformaciones
no uniformes requieren un contrato nuevo, no correcciones ocultas en el renderer.
`calibration = null` significa escala desconocida; prohíbe calcular distancia real
hasta D05. No convertir el valor demo `1 m/px` en calibración real de Waterdeep.

`Travel.distance_m`, `narrative_seconds` y `visual_seconds` deben ser finitos y no
negativos. Saltar una animación no cambia automáticamente tiempo narrativo ni ruta:
D14 definirá el comando autorizado, cancelación y efecto narrativo explícito.

## Visibilidad y proyecciones

La autorización se evalúa en servidor antes de leer/serializar. Pertenencia de IDs a
campaña debe comprobarse aun cuando el cliente mande un UUID válido. El rol no viene
confiado desde un payload, sino de la identidad autenticada y Membership de D10.

`PlayerSnapshot` contiene `PlayerJournalEntry` y `PlayerKnowledge`, proyecciones
específicas sin el campo visibility. D09/D17 deben construirlas solo desde registros
`visibility = players`, nunca convirtiendo todos los objetos y ocultando notas por CSS.
Un tipo público puede contener texto privado si el servidor lo rellena mal: las pruebas
de permiso reales serán de API. DmSecret se consulta por una ruta DM separada; no va
adjunto al snapshot ni a eventos emitidos a una sala compartida con jugadores.
No se incluyen todavía objetos/geometría de niebla ni campos de ficha no definidos.

## DTOs y eventos versionados

Lecturas y comandos futuros se ubican bajo `/api/v1`. El valor `protocol_version = 1`
coincide con `desire_core::PROTOCOL_VERSION`. Un cliente rechaza una versión desconocida.
`ApiError` propone código estable, mensaje con contexto y `request_id`, sin secretos.
D09 puede extender los códigos en su contrato de endpoints, sin parsear mensajes.

- `SceneChanged`: `kind = scene_changed`, `event_id` deduplicable, campaña, revisión
  del stream de campaña y escena destino. La escena debe pertenecer a esa campaña.
- `TravelUpdated`: `kind = travel_updated`, misma envoltura y DTO Travel completo.
  La campaña exterior y la del viaje deben coincidir.
- El stream tiene revisión monotónica por campaña, asignada dentro de la transacción
  de persistencia; es distinta de las revisiones de entidades individuales.
- D10 debe reenviar solo eventos autorizados, ignorar duplicados y solicitar snapshot
  al detectar un hueco; no ordenar por reloj de cliente. Las revisiones antiguas no
  reactivan viajes cancelados. Correlación/cancelación detallada pertenece a D14.

Los dos DTOs de evento son una primera entrega, no un bus de eventos completo. Añadir
un nuevo evento requiere esquema, regeneración, fixture y pruebas negativas. Cualquier
cambio de nombre, significado, tipo, campo obligatorio o valor enum requiere v2 para
clientes v1: los objetos son cerrados, por lo que añadir campos también puede romperlos.

## Ejemplos verificables

`contracts/examples.json` contiene un agregado de pruebas, **no** un endpoint API.

1. Campañas demo 1 y 2 comparten `city_id` de Waterdeep. Una usa `dnd_2014` y otra
   `dnd_2024`. Solo campaña 1 cambia el nombre de un lugar mediante PlaceOverride.
   El lugar base y campaña 2 conservan su identidad y nombre originales.
2. La escena de campaña 2 usa un mapa de caverna sin ciudad y sin calibración.
   Demuestra que el motor no depende de Waterdeep ni de un mapa urbano.
3. Personaje, condición, viaje, sesión, diario y lore de campaña 1 están vinculados
   exclusivamente a ella. El secreto demo está separado de PlayerSnapshot.

`examples.py` comprueba referencias y aislamiento de estas fixtures. Es una comprobación
de evidencia de D04, no sustituye constraints SQL, autorización ni validación de todos
los futuros comandos. El esquema solo verifica forma, no integridad referencial. El checker no comprueba
unicidad de Membership ni propietario como miembro DM; son restricciones de D08.

## Plan de migraciones (D08)

1. `0001_catalog`: worlds, eras, cities, districts, places, maps, map_versions, chunks,
   knowledge_entries. UUID PK, UNIQUE(map_id, revision), FKs, CHECK edición/revisión,
   escala positiva y valores finitos. Contenido inicial se importa de forma idempotente
   por ID estable y revisión; diferencias se reportan, no se pisan silenciosamente.
2. `0002_campaign`: campañas y miembros (puente a identidad D10), escenas, personajes,
   overrides y condiciones. FKs compuestas `(campaign_id, id)` para impedir referencias
   entre campañas; índice por campaña. Constraints para edición y distrito/ciudad;
   si necesitan trigger, documentarlo y probarlo dentro de la misma transacción.
3. `0003_notes`: sesiones, diario, lore y secretos en almacenamiento separado. Rol de
   aplicación con consultas autorizadas; no exponer una vista que una privados y públicos.
4. `0004_realtime`: secuencia por campaña, eventos/outbox y claves de idempotencia;
   persistir cambio de entidad y evento juntos. Datos privados fuera del outbox público.
5. Cada upgrade: backup verificado, migración en base aislada, pruebas desde cero y de
   versión previa, restricciones negativas, rollback de transacción ante fallo. Cambios
   destructivos requieren migración explícita y decisión de conservación, sin arrancar
   servicios o borrar datos automáticamente. D04 no ejecuta SQL ni toca Docker.

D08 seleccionará el acceso SQL Rust. D09 implementará CRUD/validación, D10 identidad y
transporte. No anticipar su implementación dentro del core ni añadir repositorios vacíos.

## Comandos reproducibles

Desde la raíz del worktree, Python estándar y rustfmt en PATH:

```sh
python3 tools/contracts/generate.py
python3 tools/contracts/generate.py --check
python3 tools/contracts/validate.py
python3 tools/contracts/examples.py
python3 -m unittest discover -s tools/contracts/tests
python3 tools/contracts/check-rust.py
cargo fmt --all --check
```

`check-rust.py` copia el core y fixtures exactos a un workspace temporal, resuelve Serde
con `cargo --offline`, ejecuta tests y Clippy, y elimina el workspace al terminar.
No valida API/Wasm ni genera lockfile en el checkout. La suite completa se ejecuta con
`cargo test --workspace` cuando D01 haya resuelto dependencias. D01 debe revisar las
nuevas declaraciones Serde del manifiesto core y crear el lockfile real de workspace.
