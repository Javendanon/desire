"""Análisis de fuentes activas: descubrimiento, F16, F11 y tamaño de archivo.

Cubre Svelte, HTML y CSS, que `km` no analiza. Las heurísticas son de texto y
se documentan como tales; no sustituyen un AST.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from . import config

PREFIJOS_COMENTARIO = ("//", "*", "/*", "*/", "<!--")

PATRONES_F11 = (
    ("Rust", re.compile(r"\blet\s+_\s*="), "valor descartado sin manejo (Result sin usar)"),
    ("Python", re.compile(r"except\s*:\s*pass"), "except sin manejo"),
    ("JS/TS", re.compile(r"catch\s*(\([^)]*\))?\s*\{\s*\}"), "catch vacío"),
)

SELECTOR_SCRIPT = re.compile(r"<script[^>]*>(.*?)</script>", re.DOTALL)
PAR_FOR = re.compile(r"\bfor\s*\(")
FIN_SENTENCIA = re.compile(r";\s*\S")
ETIQUETAS_HTML = re.compile(r"><")


@dataclass(frozen=True)
class SourceFile:
    path: str
    lineas: tuple[str, ...]
    code_lines: int


def descubrir_fuentes(root: Path) -> list[SourceFile]:
    fuentes = []
    for ruta in sorted(root.rglob("*")):
        if not _es_fuente(root, ruta):
            continue
        fuentes.append(leer_fuente(root, ruta))
    return fuentes


def _es_fuente(root: Path, ruta: Path) -> bool:
    if not ruta.is_file() or ruta.suffix not in config.EXTS_FUENTE:
        return False
    relativa = ruta.relative_to(root)
    if any(parte in config.DIRS_EXCLUIDOS for parte in relativa.parts[:-1]):
        return False
    return not relativa.name.endswith(".test.ts")


def leer_fuente(root: Path, ruta: Path) -> SourceFile:
    texto = ruta.read_text(encoding="utf-8", errors="replace")
    lineas = tuple(texto.splitlines())
    return SourceFile(
        path=ruta.relative_to(root).as_posix(),
        lineas=lineas,
        code_lines=sum(1 for linea in lineas if es_codigo(linea)),
    )


def es_codigo(linea: str) -> bool:
    texto = linea.strip()
    return bool(texto) and not texto.startswith(PREFIJOS_COMENTARIO)


def extraer_scripts(fuente: str) -> str:
    return "\n".join(bloque.group(1) for bloque in SELECTOR_SCRIPT.finditer(fuente))


def linea_comprimida(linea: str, path: str) -> bool:
    if path.endswith((".html", ".svelte")):
        return len(ETIQUETAS_HTML.findall(linea)) >= 3 or _sentencias(linea) >= 2
    if PAR_FOR.search(linea):
        return False
    return _sentencias(linea) >= 2


def _sentencias(linea: str) -> int:
    return len(FIN_SENTENCIA.findall(linea))


def lineas_largas(fuente: SourceFile) -> list[tuple[int, int]]:
    return [
        (numero, len(linea))
        for numero, linea in enumerate(fuente.lineas, start=1)
        if len(linea) > config.MAX_COLUMNAS
    ]


def errores_silenciosos(fuente: SourceFile) -> list[tuple[int, str]]:
    encontrados = []
    for numero, linea in enumerate(fuente.lineas, start=1):
        for _, patron, mensaje in PATRONES_F11:
            if patron.search(linea):
                encontrados.append((numero, mensaje))
    return encontrados
