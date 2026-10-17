"""Gate thresholds, scope and review lists. A single place of truth.

Thresholds come from docs/reglas-de-codigo.md (§1 and §2). The floor blocks;
the target only warns. No rule is disabled globally: false positives are
documented one by one in known-false-positives.json.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

SCORE_FLOOR = 77.0
SCORE_TARGET = 87.0

MAX_FUNCTION_LINES_FLOOR = 40
MAX_FUNCTION_LINES_TARGET = 25

MAX_PARAMS_FLOOR = 4
MAX_PARAMS_TARGET = 3

CYCOM_FLOOR = 15
CYCOM_TARGET = 10

COGCOM_FLOOR = 15
COGCOM_TARGET = 10

DUP_RATIO_FLOOR = 10.0
DUP_RATIO_TARGET = 5.0
DUP_COPIES_RULE_OF_THREE = 3

LOC_FILE_FLOOR = 400
LOC_FILE_TARGET = 300

MAX_COLUMNS = 100

EXCLUDED_DIRS = (
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

PRODUCT_EXTS = ("rs", "ts", "js")
SOURCE_EXTS = (".rs", ".ts", ".js", ".svelte", ".html", ".css", ".py")

SVELTE = "src/App.svelte"

MANUAL_REVIEW = (
    ("F7", "SRP: una razón para cambiar por archivo; nombres con 'y' o 'manager'."),
    ("F8", "Números mágicos de dominio que km no distingue (reglas D&D, precios)."),
    ("F10", "Nombres con intención: verificar sobre el diff, no automático."),
    ("F12/F14", "Fronteras de I/O y un nivel de abstracción por función."),
    ("F13", "Tipos en la frontera pública; estructura de campos fijos, no dicts sueltos."),
    ("Svelte", "Plantilla y CSS de App.svelte: km no analiza .svelte; revisión estructural."),
    ("HTML", "index.html: semántica y accesibilidad, no solo longitud de línea."),
    ("Deuda", "docs/archive/react-draft/: retirar tras consolidar historial Git."),
)

COVERAGE = (
    ("km (rs/ts/js)", "score, olores, complejidad ciclomática y cognitiva, duplicación"),
    ("scripts Svelte extraídos", "olores y complejidad del bloque <script>, vía km"),
    ("herramientas (py)", "olores y complejidad de tools/quality, vía km"),
    ("HTML/CSS/plantilla Svelte", "longitud de línea, compresión y LOC; el resto manual"),
    ("Markdown/JSON/TOML/Wasm", "fuera de medición: solo revisión manual"),
    ("public/vendor/", "fuente de terceros excluida del score; no cuenta como aprobación"),
)


@dataclass(frozen=True)
class FalsePositive:
    """Automatically discarded finding, identified by origin, file and reason."""

    origin: str
    rule: str
    path: str
    contains: str
    justification: str
    line: int | None = None

    def describe(self) -> str:
        return f"{self.path} · {self.rule}: {self.justification}"


def load_false_positives(path: Path) -> list[FalsePositive]:
    if not path.exists():
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    return [FalsePositive(**entry) for entry in raw]
