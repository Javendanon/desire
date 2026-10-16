# Nivel20 · Evidencia de API en modo lectura

Investigación de solo lectura retomada el 16 de octubre de 2026 (America/Santiago).
Alcance: qué puede leerse realmente de Nivel20 (campaña «La maldicion de la luz ✨» e
Ionyth) sin ejecutar escrituras ni persistir credenciales. No implementa el importador;
D19 consumirá este inventario.

Fuentes base (fuera de este worktree):
`/Users/javendano/dev/nivel20-api-investigation/outputs/nivel20-api-scan.md` (informe previo)
y los insumos de sesión en
`/Users/javendano/Documents/Codex/2026-10-15/estoy-pensando-en-hacer-un-wrapper/work/nivel20-scan/`
(`tabletop.html`, `application.js`, cabeceras y respuestas character/folders). Este documento
no copia cookies, tokens ni credenciales; la descripción de campaña se redacta.

## Leyenda de evidencia

| Marca | Significado | Fuerza |
|---|---|---|
| **T** | Tráfico observado (Network/HAR/CDP/frames) | Prueba de red |
| **U** | Interfaz autenticada (navegación y DOM) | No acredita método ni cuerpo |
| **C** | Contrato esperado por el código JavaScript público | Intención del cliente |
| **H** | HTTP previo conservado en los insumos | Captura histórica, no repetida |
| **P** | Prueba HTTP nueva de esta sesión | Prueba reproducible hoy |

## Resultado y límites

- La red sí está disponible en esta sesión (**P**): `nivel20.com` resuelve y responde.
- Se confirma **un** endpoint de lectura pública sin autenticación: metadatos de campaña
  en JSON (**P**). El resto de lecturas de ficha y estado no se pudo reproducir sin sesión
  (**P** → 401/403).
- **No hay evidencia T**: no se capturó ningún request/response autenticado ni frame
  WebSocket. La ficha, el equipo, los conjuros, las acciones, el diario y el registro siguen
  en nivel **C/U**, igual que en el informe previo.
- Por tanto **no se ha demostrado una API completa de fichas en JSON ni un cliente HTTP
  autenticado externo**. Este documento es un inventario parcial, no un contrato.

## Bloqueo concreto de la captura autenticada

Chrome está abierto y con sesión, pero **no expone depuración**:

- No existe `DevToolsActivePort` en el perfil por defecto ni un socket CDP escuchando
  (`lsof -nP -iTCP -sTCP:LISTEN | grep -iE 'chrome|9222|9229'` → sin resultados). Sin el flag
  de arranque no es posible atacharse a una instancia ya iniciada.
- Reiniciar Chrome con `--remote-debugging-port` está fuera de alcance (el protocolo y la
  tarjeta prohíben reiniciarlo o cerrar el perfil).
- La interfaz de automatización soportada expone `viewport` y `pageAssets`, no eventos
  request/response ni exportación HAR; dos intentos de abrir DevTools por esa vía
  terminaron en timeout.
- Un perfil nuevo con CDP serviría solo para tráfico **sin** sesión, que es lo que ya cubre
  **P**; no aporta la captura autenticada que falta.

Conclusión: la captura `T` queda **pendiente y bloqueada por herramienta**, no por falta de
datos. La vía mínima sigue siendo manual y del usuario (DevTools → Network con Preserve log,
filtro `domain:nivel20.com`, exportar HAR **sanitizado**; revisar cuerpos, query y
cabeceras antes de compartir). Referencia: [Chrome DevTools, Network reference](https://developer.chrome.com/docs/devtools/network/reference).

## URLs base e IDs verificados en la interfaz (U)

```text
ORIGIN       = https://nivel20.com
CAM          = /games/dnd-5/campaigns/109662-la-maldicion-de-la-luz
CHAR         = CAM/characters/1479371-ionyth
COMBAT_BASE  = CAM
SPELL_BASE   = CHAR
```

IDs de interfaz (U), sin validar como entidades de servidor: `profession_id=68`,
`messages-room_id=181220`, `character_levels/8444174`, `items/4180199-cuero`. No se
enumeraron IDs ajenos ni se asumió que `181220` comparta espacio con `tabletop_room`.

## Lecturas: qué está probado y con qué fuerza

| Ruta | Fuerza | Resultado |
|---|---|---|
| `/tabletop` | H + P | H: 200 `text/html`; P (HEAD): 200 `text/html; charset=utf-8` |
| `CAM` (Accept JSON) | **P** | 200 `application/json; charset=utf-8`, 537 bytes, metadatos públicos |
| `CAM` (navegación) | U | Página autenticada |
| `CAM/characters` | U | Listado autenticado con enlace a Ionyth |
| `CHAR` | H + P | H: 401 JSON sin sesión; P: 401 `application/json`, 74 bytes |
| `CHAR` (navegación) | U | Ficha renderizada; contenido ya presente en el DOM |
| `CAM/log` | U | Diario accesible; paginación convencional no observada |
| `CAM/tracking_log` | U | Personajes, tiradas y chat; base de combate y sala verificadas |
| `COMBAT_BASE/status` | C | `dataType: json`; consume stamps, characters, creatures |
| `COMBAT_BASE/tracking_rows` | C | `character_ids`; JSON cuyo `response` es HTML |
| `COMBAT_BASE/resources/{id}` | C | HTML de modal vía `loadModal` |
| `SPELL_BASE/spell_list` | C | HTML; `query`, `order`, `page`, `profession_id`, `list`… |
| `/folders.json` | H + C + **P** | P: 403 `text/html`, 7227 bytes (página de error estática, mismo tamaño que H); C espera JSON `results` |
| `/tabletop_assets.json` | C | JSON paginado (`results`, `pagination`, `pinned_results`) |
| `/games/dnd-5/conditions.json` | **P (parcial)** | 200 `application/json` (19 490 bytes) y luego 202 vacío; ver nota |

### Metadatos de campaña públicos (hallazgo nuevo, P)

`GET CAM` con `Accept: application/json`, **sin sesión**, devuelve 200 y un objeto JSON. La
estructura observada (descripción redactada):

```json
{
  "id": 109662,
  "game_id": 3,
  "name": "La maldicion de la luz ✨",
  "description": "<REDACTADO>",
  "created_at": "2025-03-05T13:05:22.000-03:00",
  "updated_at": "2026-10-03T22:38:30.000-03:00",
  "url": "https://nivel20.com/campaigns/109662-la-maldicion-de-la-luz.json"
}
```

Es lectura estructurada real, pero limitada a **metadatos de cabecera**: no incluye ficha,
personajes, estado de combate, inventario ni lore. Es un endpoint interno **no documentado**,
sin garantía de estabilidad ni disponibilidad futura, y no debe tratarse como contrato. El
campo `url` es un valor devuelto por el servidor: el formato `/campaigns/<id>.json` (sin el
prefijo `/games/dnd-5`) **no** se verificó como endpoint válido ni como forma canónica.

### Nota sobre `conditions.json`

La primera lectura devolvió 200 `application/json` con ~19 KB; una repetición inmediata
devolvió 202 con cuerpo vacío y `x-cache: Error from cloudfront`. La inconsistencia indica
un control perimetral (WAF/CloudFront), no un contrato estable. **No se forzó el endpoint**;
queda como lectura probable pendiente de confirmar, sin usarla como base de diseño.

### Lectura autenticada desde cliente externo (P → fallida)

Ninguna lectura de ficha funcionó sin sesión (`CHAR` → 401; `folders.json` → 403). El 401
JSON solo demuestra el mensaje de login (`{"error":"Tienes que iniciar sesión o
registrarte para poder continuar."}`); **no** prueba la existencia de una ficha JSON. No se
trasladaron cookies ni tokens a ningún cliente para reintentar.

## Escrituras detectadas — documentadas, NO ejecutadas (C)

| Ruta | Método | Efecto |
|---|---|---|
| `COMBAT_BASE/set_row_status` | POST | Daño, PG, recursos, condiciones |
| `COMBAT_BASE/set_characters_status` | POST | Estado por personaje/criatura |
| `SPELL_BASE/update_spell` | POST | add/remove/prepare/unprepare |
| `/room_messages` | POST | Mensajes y tiradas |
| `/room_messages/clear_chat` | POST | Vaciar chat |
| `/folders.json` y `/folders/{id}.json` | POST/PATCH/DELETE | Carpetas |
| `/tabletop_assets/{id}.json` | DELETE | Recurso de tablero |

Todo lo anterior es contrato de cliente (**C**). No se ejecutó ninguna. No se presupone la
lista completa.

## Autenticación, CSRF y sesión

- La sesión es una cookie Rails `HttpOnly`; su nombre y valor **no** se persistieron ni
  mostraron. Atributos de caducidad/renovación del servidor: desconocidos.
- `tabletop.html` incluye `<meta name="csrf-param">` y `csrf-token`; Rails UJS copia el token
  a `X-CSRF-Token`. Presencia confirmada; valor no leído. Cualquier HAR debe revisarse antes
  de compartirse.
- `Access-Control-Allow-Origin: *` aparece en respuestas, pero no acredita CORS autenticado
  ni una API pública: preflight, `credentials` y permisos reales siguen sin probar.

## ActionCable / WebSocket

Solo evidencia **C/U**; sin handshake, endpoint efectivo ni frame real.

- El bundle crea `ActionCable.createConsumer()`; sin meta `action-cable-url` la ruta por
  defecto es `/cable` → se predice `wss://nivel20.com/cable` (pendiente de captura).
- Protocolos: `actioncable-v1-json` y `actioncable-unsupported`.
- Suscripción `{channel:"RoomChannel", room:<messages-room-id>}` si hay
  `[data-channel-subscribe="room"]` (dos en `tracking_log`, ninguno en Ionyth).
- Recibe `chat`, `dice_roll`, `status_update`, `clear_messages`. El envío de chat/tiradas va
  por POST `/room_messages`; la recepción por RoomChannel.

## Decisión de arquitectura (provisional, condicional)

| Opción | Evaluación con la evidencia |
|---|---|
| Backend directo a Nivel20 | **No justificado todavía.** Falta autenticación soportada, lecturas autenticadas externas y contrato estable. Concentraría el manejo de sesiones |
| Puente local / extensión | **Candidato** para uso personal porque la sesión ya vive en Chrome; debe limitarse a lecturas explícitas y entregar datos normalizados sin credenciales. Capacidad aún no implementada ni probada |
| Combinación | **Preferida, condicional:** puente local de lectura + backend propio para campañas y mapas 3D, con referencias a los IDs de origen. Mantener secretos de Nivel20 fuera del backend |

La decisión **no** está cerrada: sin evidencia `T` no se puede prometer viabilidad. Antes de
diseñar el adaptador hay que capturar contratos reales y comprobar si la ficha se obtiene
sin analizar HTML. No se adopta el scraping del DOM como primera opción.

## Pruebas pendientes y criterio de cierre

1. Captura Network real por sección (método, URL, query, cuerpo, status, Content-Type,
   secuencia), con secretos redactados antes de persistir.
2. Distinguir HTML inicial de JSON/fragmentos/peticiones de fondo en la carga de Ionyth.
3. Verificar `status`, `tracking_rows`, `spell_list` y paginación mediante lecturas
   autenticadas (sin escrituras).
4. Confirmar serialización exacta de arrays (sufijos `[]`, valores vacíos, Content-Type).
5. Capturar WS existente (handshake, protocolo, confirmación de RoomChannel, ping) sin
   enviar frames.
6. Comprobar atributos y caducidad de sesión con metadatos, sin valores.
7. Reproducir ≥ 2 GET autenticados con cliente externo y verificar equivalencia, con un
   método seguro de autenticación.
8. Confirmar el contrato de `conditions.json` pese al control perimetral observado.

El análisis estará completo con esas evidencias, no por la mera presencia de rutas en el
JavaScript. No se atribuye esquema completo de API, compatibilidad ni soporte oficial.

## Higiene de secretos

No se guardaron cookies, tokens CSRF ni datos personales en este documento, en el repositorio
ni en logs. Los ejemplos son estructurales o redactados. Los insumos `nivel20-scan/` vivieron
fuera del árbol de trabajo y **no** se copiaron.
