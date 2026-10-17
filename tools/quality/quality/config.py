"""Umbrales, alcance y listas de revisión del gate. Un solo lugar de verdad.

Los umbrales provienen de docs/reglas-de-codigo.md (§1 y §2). El piso bloquea;
el objetivo solo avisa. Ninguna regla se desactiva de forma global: los falsos
positivos se documentan uno por uno en known-false-positives.json.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

PISO_SCORE = 77.0
OBJETIVO_SCORE = 87.0

MAX_LINEAS_FUNCION_PISO = 40
MAX_LINEAS_FUNCION_OBJETIVO = 25

MAX_PARAMETROS_PISO = 4
MAX_PARAMETROS_OBJETIVO = 3

CYCOM_PISO = 15
CYCOM_OBJETIVO = 10

COGCOM_PISO = 15
COGCOM_OBJETIVO = 10

DUP_RATIO_PISO = 10.0
DUP_RATIO_OBJETIVO = 5.0
DUP_COPIAS_REGLA_TRES = 3

LOC_ARCHIVO_PISO = 400
LOC_ARCHIVO_OBJETIVO = 300

MAX_COLUMNAS = 100

DIRS_EXCLUIDOS = (
    "docs",
    "vendor",
    ".agents",
    ".local",
    ".git",
    ".venv",
    "target",
    "node_modules",
    "generated",
    "dist",
    "outputs",
    "tests",
    "__pycache__",
)

EXTS_PRODUCTO = ("rs", "ts", "js")
EXTS_FUENTE = (".rs", ".ts", ".js", ".svelte", ".html", ".css", ".py")

SVELTE = "src/App.svelte"

REVISION_MANUAL = (
    ("F7", "SRP: una razón para cambiar por archivo; nombres con 'y' o 'manager'."),
    ("F8", "Números mágicos de dominio que km no distingue (reglas D&D, precios)."),
    ("F10", "Nombres con intención: verificar sobre el diff, no automático."),
    ("F12/F14", "Fronteras de I/O y un nivel de abstracción por función."),
    ("F13", "Tipos en la frontera pública; estructura de campos fijos, no dicts sueltos."),
    ("Svelte", "Plantilla y CSS de App.svelte: km no analiza .svelte; revisión estructural."),
    ("HTML", "index.html: semántica y accesibilidad, no solo longitud de línea."),
    ("Deuda", "docs/archive/react-draft/: retirar tras consolidar historial Git."),
)

COBERTURA = (
    ("km (rs/ts/js)", "score, olores, complejidad ciclomática y cognitiva, duplicación"),
    ("scripts Svelte extraídos", "olores y complejidad del bloque <script>, vía km"),
    ("herramientas (py)", "olores y complejidad de tools/quality, vía km"),
    ("HTML/CSS/plantilla Svelte", "longitud de línea, compresión y LOC; el resto manual"),
    ("Markdown/JSON/TOML/Wasm", "fuera de medición: solo revisión manual"),
    ("public/vendor/", "fuente de terceros excluida del score; no cuenta como aprobación"),
)


@dataclass(frozen=True)
class FalsoPositivo:
    """Hallazgo automático descartado por nombre, archivo y motivo explícitos."""

    origen: str
    regla: str
    path: str
    contiene: str
    justificacion: str
    linea: int | None = None

    def describe(self) -> str:
        return f"{self.path} · {self.regla}: {self.justificacion}"


def cargar_falsos_positivos(ruta: Path) -> list[FalsoPositivo]:
    if not ruta.exists():
        return []
    crudos = json.loads(ruta.read_text(encoding="utf-8"))
    return [FalsoPositivo(**entrada) for entrada in crudos]
