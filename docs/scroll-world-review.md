# Evaluación de scroll-world

Revisado: 15 de octubre de 2026. Fuente: rama main pública, consultada mediante navegador web; no se instaló ni ejecutó el repositorio.

## Veredicto

Puede servir para una introducción cinematográfica o un prólogo de campaña. No proporciona el mundo 3D caminable ni el motor de mesa que buscamos.

## Evidencia

El [README](https://github.com/oso95/scroll-world) describe una skill de producción de landing pages: genera imágenes y clips de vídeo, conecta sus fotogramas extremos y vincula el recorrido al scroll. Los assets se producen para cada proyecto. La generación depende de servicios externos y puede consumir créditos. No se iniciaron generaciones con esos servicios.

En [scrub-engine.js](https://github.com/oso95/scroll-world/blob/main/skills/scroll-world/references/scrub-engine.js), `loadClip` descarga cada clip como Blob, crea un elemento video y asigna una object URL. El bucle `raf` cambia `video.currentTime` según el scroll. La apariencia espacial proviene del vídeo; no hay geometría navegable en ese código. El movimiento permite adelantar y retroceder por una trayectoria predeterminada, sin cambiar libremente de punto de vista.

El archivo contempla fuentes móviles, posters, seeks coalescidos y movimiento reducido. No se ve una función de desmontaje, cancelación del RAF o revocación de object URLs. Reutilizarlo dentro de una aplicación con rutas exigiría añadir limpieza. Se cargan clips próximos al scroll, pero los ya cargados no se descargan explícitamente de memoria en el código inspeccionado. No se midieron FPS, memoria ni comportamiento real en móvil.

## Encaje funcional

| Necesidad | Encaje |
|---|---|
| Prólogo visual del mundo | Sí, sujeto a producir clips y adaptar diseño |
| Recapitulación de sesiones | Sí, como contenido audiovisual |
| Paseo libre y cámara orbitable | No lo aporta |
| Colisiones, rutas y escala de juego | No lo aporta |
| Miniaturas y estados con posición 3D | No lo aporta |
| Convertir ilustración en geometría editable | No lo aporta |

Su fluidez de reproducción no es un benchmark de un motor 3D: las cargas de trabajo son diferentes.

## Reutilización

El repositorio declara [licencia MIT](https://github.com/oso95/scroll-world/blob/main/LICENSE): al copiar o adaptar código hay que conservar el aviso correspondiente. La licencia del repositorio no sustituye las condiciones de los proveedores de generación ni los derechos de los assets usados.

Propuesta: mantenerlo como recurso opcional de presentación; evaluar el escenario caminable mediante geometría/splats más colisiones y navegación reales. No adoptar sus vídeos como representación del estado de partida.

## Implemented adaptation (D20)

Card `8a224ea3-f252-43c7-8fae-4922c85d6161`. The vendored copy stays untouched in
`public/vendor/scroll-world/` (`LICENSE` plus `scrub-engine.upstream.js`); the adaptation lives in
`src/features/prologue/` and keeps the MIT notice in the module header.

| Upstream behaviour | Adapted behaviour |
| --- | --- |
| Video clips fetched as blobs and scrubbed by `requestAnimationFrame` | One existing illustration (`public/assets/abbey.jpg`) in three framings. No clips, no blob URLs, no animation loop: stills cross-dissolve on `scroll`. |
| Builds its own DOM and injects global CSS | The markup and the scoped CSS live in `Prologue.svelte`; the controller only writes inline `opacity`/`transform`. |
| No teardown | `destroy()` removes the single passive `scroll` listener. There is no RAF handle and no object URL to release; a future clip path must revoke its blobs there. |
| Reduced motion keeps the stills but drops the clips | Reduced motion renders one static scene with no scroll track and attaches no listener at all. |
| `hint`, route dots, nav, particles | Not adapted: the entry screen has one control, the always-available "Saltar a la mesa" button, plus Escape. |

Optional and reversible: the `campaign_prologue` runtime flag (off by default) turns the screen on,
and the shell behind it stays mounted, inert and untouched. If the illustration or the component
fails, the gradient backdrop and the skip button remain, and the table keeps working.

No performance claim is made for this screen: no FPS, memory or mobile decode measurement was
taken, because no video is decoded.
