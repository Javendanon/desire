# Gate de calidad de Desire

Envoltorio reproducible sobre `km` (kimün 0.26.0) más comprobaciones propias para
lo que `km` no mide. Los umbrales viven en `quality/config.py` y provienen de
`docs/reglas-de-codigo.md`. El piso bloquea (salida != 0); el objetivo solo avisa.

## Uso

```sh
python3 tools/quality/gate.py                 # mide el proyecto actual
python3 tools/quality/gate.py --root <ruta>   # mide otro árbol (p. ej. antes/después)
python3 tools/quality/gate.py --json salida.json
python3 tools/quality/gate.py --no-km         # solo comprobaciones de texto (sin km)
```

Salida: `0` si ningún hallazgo viola el piso; `2` si alguno lo viola. El aviso de
"bajo objetivo" no cambia la salida. El gate **nunca** imprime aprobación integral:
mientras existan reglas manuales pendientes o lenguajes sin medir, la aprobación
integral es explícitamente `NO`.

## Qué mide

| Alcance | Comprobaciones |
| --- | --- |
| `rs/ts/js` (km) | score, F1/F2 (olores), F4/F5 (complejidad), F9 (duplicación) |
| script de `src/App.svelte` | olores y complejidad del bloque `<script>`, extraído a temporal |
| `tools/quality/*.py` (km) | F1/F2/F4/F5 sobre el propio tooling (sin dimensión de tamaño) |
| HTML/CSS/Svelte (texto) | F6 (tamaño de archivo), F16 (ancho y compresión), F11 (errores silenciosos) |

## Falsos positivos

`known-false-positives.json` documenta, uno por uno, hallazgos que la heurística de
texto de `km` produce sin ser violaciones reales. Cada entrada cita archivo, regla,
patrón y justificación, y suprime **solo esa ocurrencia**: ninguna regla se desactiva
de forma global. Ejemplo: `defineConfig` en `vite.config.ts` recibe un objeto de
configuración, no una función de seis parámetros.

## Pruebas del gate

```sh
python3 -m unittest discover -s tools/quality/tests -p 'test_*.py'
```

Incluyen la aceptación pedida: una violación de F11 o F16 en un fixture produce
salida `!= 0`, y una fuente limpia produce `0`.

## Límites

- Si `km` no está en PATH, el gate **falla** (exit 2) en lugar de quedar verde sin
  medir score, olores, complejidad ni duplicación. Solo `--no-km` (explícito) omite
  esas métricas.
- `public/vendor/` (motor scroll-world upstream) queda excluido del score como fuente
  de terceros; el score sin esa exclusión es mucho menor (D+) y no se usa como
  aprobación. La exclusión se imprime en la cobertura.
- `km` no analiza `.svelte`; la plantilla y el CSS se cubren por heurística de texto
  y revisión manual.
- Markdown, JSON, TOML y el artefacto Wasm quedan fuera de medición.
- La lista de revisión manual (`config.REVISION_MANUAL`) se imprime en cada corrida y
  no bloquea; impide declarar aprobación integral.
