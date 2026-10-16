# Opciones de gráficos y lenguajes para la mesa

Investigación: 15 de octubre de 2026. Estado: decisión de motor y backend abierta. El esqueleto React/TypeScript existente es provisional; todavía no hay una aplicación ejecutable completa, benchmark ni motor seleccionado definitivamente.

## Qué significa «actual»

Se comprobaron documentación y anuncios oficiales, implementaciones y ejemplos. Estas fuentes demuestran soporte y algunos usos reales; no aportan una encuesta de cuota de mercado ni prueban qué motor es el más rápido para nuestra carga. Las recomendaciones de este documento son evaluación técnica, no resultados de benchmarks.

## Opciones comprobadas

| Lenguaje y stack | Navegador / escritorio | Fortaleza para esta mesa | Coste o límite |
|---|---|---|---|
| TypeScript + Babylon.js | Navegador, WebGPU y WebGL | Motor integrado, materiales, partículas, herramientas e instrumentación | El código CPU y el número de objetos siguen importando; hay que agrupar recursos y gestionar selección |
| TypeScript + PlayCanvas | Navegador, WebGPU y WebGL 2 | Motor web con herramientas, iluminación agrupada e instancing | Su documentación aún etiqueta WebGPU Beta; evaluar el flujo de trabajo y edición local |
| TypeScript + Three.js/R3F | Navegador, WebGPU o WebGL 2 según renderer | Integración con UI web y control fino de una escena personalizada | Hay que componer más piezas del motor; R3F es un adaptador de React, no un renderer distinto |
| Rust + Bevy/wgpu + WebAssembly | Navegador y nativo | ECS, estructuras de datos controladas, lógica Rust y render multiplataforma | Bevy advierte de APIs cambiantes; la integración con UI HTML, el tamaño y la carga requieren trabajo |
| C# + Unity 6.6 | Web y nativo | Editor visual, animación esquelética y herramientas de VFX | Integrar formularios, búsqueda y accesibilidad web exige decidir una frontera UI/motor; medir descarga y memoria |
| C++ + Emscripten + WebGPU | WebAssembly y nativo | Control de bajo nivel y reutilización de bibliotecas | Mucho trabajo de infraestructura para crear un editor/VTT propio; no es una solución lista para usar |
| GDScript/C++ + Godot | Web y nativo, con diferencias | Motor abierto con editor completo | La documentación estable de exportación web indica WebGL 2, sin WebGPU y sin exportación web de proyectos C# de Godot 4 |

### Babylon.js

Soporta WebGPU desde la versión 5.0; el proyecto documenta también shaders WGSL. Sus thin instances representan muchas copias mediante buffers, evitando un objeto JS por copia. Son apropiadas para decoración estática, pero tienen compromisos: se consideran como un conjunto para visibilidad y añadir/eliminar copias cuesta más que con instancias normales. No confundir «diez mil copias de un árbol» con «diez mil entidades animadas independientes».

Fuentes: [WebGPU en el repositorio oficial](https://github.com/BabylonJS/Documentation/blob/master/content/setup/support/webGPU.md), [thin instances](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/thinInstances/), [optimización e instrumentación](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene/).

### PlayCanvas

La documentación enumera WebGPU (Beta), WebGL 2 y fallback automático. Tiene instancing y clustered lighting: organiza luces espacialmente para consultar las relevantes al sombrear. Su implementación documentada de hardware instancing no hace frustum culling por instancia. Conviene agrupar por zonas si el mapa crece.

Fuentes: [gráficos](https://developer.playcanvas.com/user-manual/graphics/), [luces agrupadas](https://developer.playcanvas.com/user-manual/graphics/lighting/clustered-lighting/), [hardware instancing](https://developer.playcanvas.com/user-manual/graphics/advanced-rendering/hardware-instancing/).

### Three.js y React Three Fiber

WebGPURenderer intenta WebGPU y puede recurrir a WebGL 2. R3F documenta render bajo demanda, reutilización de geometrías/materiales, instancing, niveles de detalle y ajuste de resolución. Estas técnicas son aplicables sin convertir cada cambio de animación en un render de React. El soporte de una técnica no demuestra rendimiento equivalente entre motores.

Fuentes: [WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html), [escalado R3F](https://r3f.docs.pmnd.rs/advanced/scaling-performance), [errores de rendimiento](https://r3f.docs.pmnd.rs/advanced/pitfalls).

### Rust: Bevy, wgpu y Wasm

wgpu documenta ejecución en navegador compilando a WebAssembly, con WebGPU y una ruta WebGL 2 que no tiene todas las funciones. Bevy aporta ECS, escena, animaciones y renderer 3D. La guía consultada utiliza Bevy 0.19. Su propia introducción advierte de funciones faltantes y cambios incompatibles aproximadamente trimestrales; esto debe entrar en el coste de mantenimiento.

Rust también puede limitarse a un módulo de cálculo —visibilidad, navegación, procesamiento de mapas o reglas— mientras la UI y el renderer permanecen web. Esa arquitectura híbrida evita reescribir la experiencia de formularios y navegación. No se ha implementado ni medido aquí.

Fuentes: [wgpu en web](https://wgpu.rs/doc/wgpu/documentation/platforms/web/index.html), [características Bevy](https://bevy.org/), [versión en guía](https://bevy.org/learn/quick-start/getting-started/), [advertencia de estabilidad](https://bevy.org/learn/quick-start/introduction/).

### C#: Unity

El anuncio de Unity 6.6 confirma que WebGPU salió de experimental. Continúa siendo opt-in y WebGL 2 es el predeterminado. El anuncio enumera compute shaders, GPU Resident Drawing, GPU Occlusion Culling, VFX Graph y compute skinning. Son capacidades del motor; no una garantía de que todos los equipos de nuestros jugadores soporten la misma configuración. Elegir Unity permitiría construir mucho dentro del editor, a cambio de integrar una aplicación web alrededor del runtime.

Fuentes: [anuncio del equipo](https://discussions.unity.com/t/webgpu-out-of-experimental-in-unity-6-6/1734694), [manual 6.6](https://docs.unity.com/en-us/engine/6000.6/manual/platform-specific/webgl/develop/graphics/web-gpu).

### C++, Godot y shaders

Emscripten documenta WebGPU mediante Emdawnwebgpu, con API C semejante a Dawn sobre WebGPU del navegador. Es una ruta real para C/C++, pero obliga a construir muchas piezas que un motor ya trae.

La documentación estable de Godot consultada exige Wasm y WebGL 2 para web. Indica que Godot 4 C# no se exporta a web y que WebGPU no está soportado en esa ruta estable. Un fork experimental no equivale a soporte estable oficial. Godot sigue siendo candidato si escritorio pesa más que navegador.

WGSL es el lenguaje de shaders de WebGPU, separado del lenguaje de UI o servidor. Puede ser relevante para niebla, agua y partículas tanto con Rust como con TypeScript. No requiere escribir toda la aplicación en un lenguaje de bajo nivel.

Fuentes: [Emscripten WebGPU](https://emscripten.org/docs/porting/multimedia_and_graphics/WebGPU-support.html), [Godot web estable](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html), [especificación WGSL](https://www.w3.org/TR/WGSL/).

## Evidencia de uso, sin inventar popularidad

- Foundry VTT v14 describe su mesa como un canvas WebGL con PixiJS. Es prueba de uso en un VTT real, principalmente 2D; no prueba que PixiJS sea el motor elegido para nuestro 3D. [API oficial](https://foundryvtt.com/api/classes/foundry.canvas.Canvas.html).
- TaleSpire mantiene herramientas de Unity para preparar miniaturas y su equipo documenta el uso de assets Unity. Es una referencia real de VTT 3D, con una experiencia distinta de una aplicación web ligera. [Herramienta oficial](https://talespire.com/taleweaverlite-install-guide), [arquitectura multiplataforma del equipo](https://bouncyrock.com/news/articles/the-road-to-multiplatform).
- Bevy publica ejemplos web con pruebas WebGPU/Wasm y WebGL 2. Esto demuestra ejecución de ejemplos, no adopción equivalente a Unity ni producción de VTT a gran escala. [Resultados oficiales](https://example-runs.bevy.org/).
- El tutorial de extensiones de Owlbear Rodeo utiliza JS y Vite. Solo acredita su flujo de extensiones; no se usa como evidencia del renderer interno. [Tutorial](https://docs.owlbear.rodeo/extensions/tutorial-hello-world/create-your-site/).

## Lenguaje, GPU y backend

Wasm es un formato de ejecución, no una GPU ni un motor. Rust/C++ pueden mejorar cálculo CPU cuando el diseño de datos y los límites entre módulos lo permiten. Si el cuello de botella son shaders, transparencias, sombras, textura o geometría en la GPU, cambiar el lenguaje CPU no lo resuelve necesariamente.

El backend no dibuja el mapa en un VTT con render local. Su trabajo es validar permisos, ordenar eventos y distribuir cambios autorizados. Elegir Rust, Go o TypeScript para servidor es independiente de escoger Babylon, Bevy o Unity para cliente. Un backend compilado tampoco elimina viajes de red, consultas ineficientes o errores de sincronización.

## Decisión y prueba propuesta

No hay ganador demostrado. Para una aplicación web con fichas y una biblioteca cuidada, Babylon.js/PlayCanvas y Three.js son candidatos directos. Para un núcleo mayoritariamente Rust y una posible app nativa, Bevy merece una prueba. Para una experiencia cercana a un videojuego y un editor de escenarios potente, Unity 6.6 merece una prueba con exportación web.

La comparación útil debe usar los mismos recursos, cámaras, resolución, sombras y efectos:

1. Decoración estática repetida: 1 000, 5 000 y 10 000 instancias, agrupadas por zona.
2. Miniaturas animadas: 25, 100 y 250 con el mismo rig y niveles de detalle.
3. Luces y VFX: 4, 16 y 64 luces, registrando por separado el coste de sombras; efectos limitados con ajustes equivalentes.
4. Interacción: mover cámara, seleccionar, arrastrar fichas y consultar la ficha mientras renderiza.
5. Métricas: p50/p95 de tiempo por frame, draw calls, tiempo de carga en frío, memoria cuando sea medible, respuesta de selección y pérdida/restauración del dispositivo gráfico.
6. Equipos: al menos uno integrado o portátil de gama media y los navegadores reales del grupo. La comparación nativa debe reportarse aparte.

Objetivo inicial sugerido: p95 de frame por debajo de 16,7 ms para 60 Hz en equipo de referencia, con modo reducido que apunte a 33,3 ms. Son presupuestos a validar, no resultados obtenidos. No reportar números de rendimiento sin ejecutar la prueba.

La instalación inicial de dependencias y el esqueleto React no constituyen una selección definitiva del stack. No se ha publicado una aplicación funcional ni se ha conectado la sesión de Nivel20 a esta base.
