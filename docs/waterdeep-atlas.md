# Waterdeep · Referencia cartográfica inicial

Primera ciudad solicitada para la campaña actual. Las demás ciudades quedan como expansión futura, sin prometer una cobertura completa de D&D.

## Fuente observada

[Atlas de Waterdeep en español, AideDD](https://www.aidedd.org/atlas/es/waterdeep), consultado el 15 de octubre de 2026 en una pestaña nueva de Chrome. La página atribuye el plano a **Jason Engle** y enlaza su [obra](https://www.inprnt.com/gallery/j_a_e/waterdeep/).

La interfaz ofrece búsqueda, información de lugares, zonas, distancias, tiempos y marcadores personales. Se comprobó visualmente que el mapa y los marcadores cargan.

## Evidencia técnica observada en el DOM

- El plano es un fondo de imagen: `images/waterdeep-3560-7256.jpg`, presentado con dimensiones CSS de 3560 × 7256.
- Una capa SVG, creada con Raphaël 2.3.0, superpone geometría al plano. Se contaron 8 paths con IDs `zone*` y 768 círculos. Ese recuento **no equivale** a 768 lugares únicos: puede incluir elementos auxiliares.
- Ejemplo de un círculo: `id="circ1"`, `cx="1781"`, `cy="4238"`. No se ha establecido su relación con un lugar ni una escala en metros.
- Scripts externos declarados: `lang_es.js?v=2`, `fonctions.js?v=5`, `dataW.js?v=7`, además de jQuery y Raphaël.

Esto prueba una representación de imagen + geometría superpuesta. No prueba una API JSON, una exportación oficial, un grafo de calles, coordenadas geográficas ni alturas de edificios. No se capturó tráfico de red. La herramienta web no pudo leer los scripts; navegar al recurso de datos en Chrome devolvió un bloqueo del cliente y no se intentó sortearlo. El 18 de octubre de 2026 una petición directa sin credenciales a `dataW.js?v=7` devolvió HTTP 200, sin autenticación ni evasión de bloqueos. El paquete [`docs/maps/waterdeep/`](maps/waterdeep/README.md) registra el snapshot, la escala declarada, veinte puntos de control y diez lugares iniciales con procedencia. No se copió el lore ni se incorporó la base completa de marcadores.

## Uso previsto, pendiente de implementar

Conservar la distribución reconocible del plano, registrar su fuente y calibrar las coordenadas antes de medir distancias. Separar el plano y sus referencias de las alturas, fachadas y detalles interpretados en 3D. El atlas no proporciona por sí solo una ciudad 3D caminable.

Propuesta: vista elevada estilizada, calles y barrios reconocibles, hexágonos opcionales para movimiento, escenas de encuentro con mayor detalle y carga del mundo por sectores. El salto del DM y la velocidad de animación deben ser independientes del tiempo narrativo; acelerar una transición no cambia automáticamente el reloj de la campaña.

El contenido base de la ciudad y las modificaciones de cada campaña deberán almacenarse por separado. La referencia externa se mantendrá como fuente, sin convertir su disponibilidad en una dependencia necesaria durante una sesión de juego. El esquema definitivo se acordará después de las reglas de código.

Pendiente: confirmar de forma independiente la escala (por ahora solo está declarada por la fuente), la edición/época de Waterdeep, la fuente de geometría reutilizable, la relación marcador–lugar y la procedencia de cada entrada de lore. No se ha generado una ciudad ficticia etiquetada como Waterdeep.
