# Instrucciones del proyecto

Las [reglas de código fundamentales](docs/reglas-de-codigo.md) están activas y mandan
cuando hay dudas. Leerlas antes de escribir o modificar código en cualquier lenguaje.
Para tomar o entregar tarjetas, seguir [desarrollo paralelo](docs/desarrollo-paralelo.md).

- Usar pnpm para el frontend y Cargo para Rust.
- El tooling en `tools/` no se escribe en JavaScript sin tipos. Si comparte tipos o contratos
  con la app, el motor o el worker (por ejemplo `tools/assets`, que emite datos para D12/D13),
  se escribe en TypeScript estricto con `node:test`. Las herramientas que ya están en Python 3
  con la biblioteca estándar y `unittest` (`tools/contracts`, `tools/quality`, `tools/ci`,
  `tools/knowledge`) siguen así.
- Apuntar al objetivo A- (87), no solo al piso B- (77).
- Aplicar F1–F16 y el flujo RED → implementación → gate → tests → advisor → reporte.
- El advisor independiente es obligatorio para cambios de más de 50 líneas o archivos
  con olores. Debe citar archivo, línea y evidencia verificable.
- No afirmar que un gate pasa si hay lenguajes sin medir, tests bloqueados o reglas
  manuales pendientes. Documentar cobertura, falsos positivos y deuda preexistente.
- El diagnóstico inicial está en `outputs/quality/estado-inicial.md`; no usar una
  cifra de ese informe como invariante congelado. Comparar antes/después con el mismo
  alcance y versión de herramientas.
- Primera ciudad: Waterdeep. El contenido de otras ciudades y campañas deberá poder
  incorporarse sin acoplar su identidad al motor.
- La integración con Nivel20 permanece de solo lectura. No ejecutar escrituras,
  extraer credenciales ni guardar secretos en reportes o comandos.
- No reiniciar Docker ni modificar servicios existentes para preparar este proyecto.

Estas instrucciones no convierten los bloqueos documentados en una aprobación del
estado actual ni autorizan omitir pruebas antes de un refactor.
