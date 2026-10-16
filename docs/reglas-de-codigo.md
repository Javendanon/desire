# Reglas de código — fundamentales

Estado: **activo**. Aplica a todo código que se escribe o se modifica en este proyecto,
en cualquier lenguaje.

**Regla de oro: el documento manda cuando hay duda, no el criterio del momento.**
Sin reglas escritas, cada archivo se escribe con el criterio del momento y el resultado
es deuda que nadie midió.

## 1. Piso vs objetivo

El **piso es bloqueante, no la meta**: un cambio no está terminado por cumplir el mínimo,
está terminado por apuntar al objetivo. Quedarse en el piso solo se acepta con deuda
preexistente justificada por escrito.

| dimensión | piso (falla) | objetivo por defecto | techo realista |
|---|---|---|---|
| score del proyecto | **B- (77)** | **A- (87)** | A++ — archivos nuevos |
| líneas por función | ≤ 40 | **≤ 25** | ≤ 15 |
| complejidad ciclomática | ≤ 15 | **≤ 10** | ≤ 5 |
| parámetros | ≤ 4 | **≤ 3** | 0–2 (dataclass de config) |
| duplicación | ≤ 10% | **≤ 5%** | 0% |
| LOC por archivo | ≤ 400 | **50–300** | ~150 |

Archivo nuevo, o archivo que se toca a fondo: **se escribe al objetivo, no al piso.**

## 2. Reglas duras (F1–F16)

| # | Regla | Umbral | Verificación |
|---|---|---|---|
| F1 | Cuerpo de función corto; ideal ≤ 25 líneas | **≤ 40** | `km smells --max-lines 40` |
| F2 | Parámetros acotados; si son 5+, agrupar en dataclass/objeto de config | **≤ 4** | `km smells --max-params 4` |
| F3 | Anidamiento ≤ 3 niveles; salir temprano (guard clauses) en vez de `elif` anidado | **≤ 3** | revisión + `km cogcom --per-function` |
| F4 | Complejidad ciclomática por función | **≤ 10** ideal, **≤ 15** tolerable, **> 25 prohibido** sin justificación escrita en el docstring | `km cycom --per-function` |
| F5 | Complejidad cognitiva por función | **≤ 15** | `km cogcom --per-function` |
| F6 | Tamaño de archivo 50–300 LOC; > 400 ⇒ partir en módulos por responsabilidad | **≤ 400** | `km score` (dimensión file size) |
| F7 | SRP: una sola razón para cambiar. Si el nombre necesita "y" o "manager", está mal partido | — | revisión |
| F8 | Cero números mágicos **de dominio**: `Decimal('0.19')` ⇒ `IVA_CLP`. Tolerados: 0, 1, 2, -1, índices triviales, dimensiones | — | `km smells` (filtra) |
| F9 | Regla de tres: a la tercera copia, extraer | 0 grupos con 3+ | `km dups` |
| F10 | Nombres con intención, no con tipo (`fecha_cierre`, no `ts2`); verbos para funciones, sustantivos para datos | — | revisión |
| F11 | Error explícito y con contexto: nada de `except: pass` ni silencios. Re-lanzar con el dato que falta (`raise ValueError(f'sin precio para {ticker}')`) | 0 silencios | revisión |
| F12 | Lógica pura separada de I/O: parsear/calcular ≠ leer red o DB. Las fronteras entran y salen por funciones que reciben y devuelven datos | — | revisión |
| F13 | Tipos en la frontera pública; estructuras de campos fijos como `dataclass`/`TypedDict`, no dicts sueltos | — | revisión |
| F14 | Un nivel de abstracción por función: no mezclar "leer GraphQL" con "calcular costo FIFO" | — | revisión |
| F15 | Refactor solo con red verde: los tests existentes corren antes y después; si no hay tests para lo que se toca, se escriben primero | — | suite del proyecto |
| F16 | Sin comprimir: nada de `a=1;b=2` en una línea, sin `if x: y(); z()`; una sentencia por línea, estilo del lenguaje, ≤ 100 columnas | — | revisión |

## 3. Patrones de diseño (cuando el problema lo pide, no por decorar)

| síntoma en el código | patrón |
|---|---|
| `if tipo == 'A' … elif tipo == 'B' …` que crece | tabla de despacho / **Strategy** |
| integración con API/broker externo mezclada con dominio | **Adapter** (frontera) + DTO |
| construcción con muchos parámetros/entorno | **Factory** / dataclass de configuración |
| SQL/consultas repartidas por todas las capas | **Repository** |
| números/dinero/fechas manipulados como primitivos | **Value Object** (`Decimal` + validación en el constructor) |
| función que devuelve dicts con claves acordadas a mano | **dataclass/Record** |
| acumulación con `for` + banderas booleanas | **reduce/pipeline declarativo** |
| estado compartido mutable entre módulos | inyección explícita (constructor), no globales |

Anti-regla: si el patrón agrega indirección sin eliminar una bifurcación real, no se usa.
Regla de tres también aquí: dos casos ⇒ función; tres casos ⇒ abstracción.

## 4. Complejidad algorítmica

- Ningún bucle anidado sobre datos de tamaño real sin justificación. Buscar dentro de listas
  dentro de bucles (O(n²)) ⇒ indexar en `dict`/`set` (O(n)).
- Docstring de una línea declarando el orden cuando la función recorre colecciones:
  `"""FIFO de lotes por ticker. O(t·l)."""`
- Ordenar una vez, no dentro del bucle. Caches explícitas y con nombre, nunca un cache
  escondiendo I/O.
- Presupuesto: una función recorre su entrada **una vez**; si necesita tres pasadas, son tres
  funciones con nombre.

## 5. Legibilidad

- El código se escribe para que lo lea una persona, no el intérprete.
- Espacios alrededor de operadores, sin punto y coma, ancho 100, sin líneas de 200 caracteres
  con cinco llamadas encadenadas.
- Docstring de módulo (contrato en una línea) y de función cuando el "por qué" no es obvio.
- Comentario = por qué, no qué. `# el broker redondea a 2 decimales; tolerancia 3 CLP` vale;
  `# suma` no.
- Un archivo = un tema. El nombre del archivo debe poder ponerse en una frase con el de la función.
- Código muerto y comentado se borra (queda en git).

## 6. Flujo obligatorio (gate + advisor)

```text
1. ANTES de escribir: leer la(s) función(es) que voy a tocar y los tests que las cubren.
2. RED: si no hay test que falle al romper la lógica, escribirlo primero.
3. IMPLEMENTAR: aplicando F1–F16. Refactor = cambio de forma, sin cambio de comportamiento.
4. GATE LOCAL: correr el medidor del proyecto con estos umbrales.
   - sale != 0 si viola el PISO; avisa (sin bloquear) si quedó bajo el OBJETIVO
   - apuntar al objetivo siempre: el gate es el freno, no el volante
5. TESTS: la suite del proyecto en verde (misma cantidad de fallos preexistentes, 0 nuevos).
6. ADVISOR: revisor independiente (otro agente o una persona que no escribió el código)
   con el diff + el reporte de métricas.
   - rol: adversario, no ayuda. Busca violaciones de F1–F16 y de SRP.
   - debe citar archivo:línea y métrica; sin evidencia no cuenta.
   - si el advisor marca algo, o se arregla o se deja escrito con justificación.
   El advisor no es opcional en cambios de > 50 líneas o en cualquier archivo con olores.
7. REPORTE: qué cambió, métricas antes/después, qué quedó pendiente.
```

## 7. Cómo verificar

Los comandos de referencia son de **kimün** (`km`); si el proyecto usa otra herramienta, los
umbrales de la §1 y la §2 son los que mandan igual:

```sh
km score <subdir>
km smells <subdir> --max-lines 40 --max-params 4
km cycom <subdir> --per-function
km cogcom <subdir> --per-function
km dups <subdir>
```

Un `km-gate.py` que corre todo eso, compara contra un baseline y sale != 0 bajo el piso es un
envoltorio útil, no la regla: si se copia a otro proyecto, se copia con sus umbrales y su
baseline propios.

Dos cosas que la práctica enseña y conviene no repetir:

- **Una regla sin comando que la ejecute no es una regla, es una intención.** Si se agrega una
  regla nueva, se agrega también la forma de verificarla, o se acepta que es revisión manual.
- **El invariante se enuncia como comparación, no como valor congelado.** Un hash o un número
  "pineado" deja de reproducir en cuanto cambia otra parte del árbol; lo verificable es la
  relación antes/después medida en el mismo estado.
