"""Ejecuta kimün (km) con el alcance acordado y parsea su salida JSON."""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

Alias = dict[str, str]


class KmError(RuntimeError):
    """km no está disponible o devolvió un error de ejecución."""


def hay_km() -> bool:
    return shutil.which("km") is not None


@dataclass(frozen=True)
class Peticion:
    """Comando km y flags extra que no dependen del alcance de archivos."""

    comando: str
    extra: tuple[str, ...] = ()


@dataclass(frozen=True)
class Scope:
    """Alcance de una medición: ruta, carpetas excluidas, extensiones y alias."""

    path: str = "."
    dirs: tuple[str, ...] = ()
    exts: tuple[str, ...] = ()
    informativos: bool = True
    alias: Alias | None = None

    def consulta(self, comando: str, *extra: str) -> "Consulta":
        return Consulta(comando, self.path, self._argumentos(), tuple(extra))

    def _argumentos(self) -> list[str]:
        dirs = [arg for nombre in self.dirs for arg in ("--exclude-dir", nombre)]
        exts = [arg for ext in self.exts for arg in ("--include-ext", ext)]
        return dirs + exts


@dataclass(frozen=True)
class Consulta:
    comando: str
    path: str
    alcance: tuple[str, ...]
    extra: tuple[str, ...] = ()


def ejecutar(root: Path, consulta: Consulta) -> Any:
    partes = [
        "km",
        consulta.comando,
        consulta.path,
        *consulta.alcance,
        *consulta.extra,
        "--format",
        "json",
    ]
    try:
        proceso = subprocess.run(partes, cwd=root, capture_output=True, text=True)
    except FileNotFoundError as error:
        raise KmError("km no está instalado en PATH") from error
    if proceso.returncode != 0:
        detalle = proceso.stderr.strip()
        raise KmError(f"km {consulta.comando} falló ({proceso.returncode}): {detalle}")
    return json.loads(proceso.stdout)


def reescribir_paths(resultado: Any, alias: Alias) -> None:
    normalizado = {clave.lstrip("./"): valor for clave, valor in alias.items()}
    for archivo in resultado:
        clave = str(archivo.get("path", "")).lstrip("./")
        if clave in normalizado:
            archivo["path"] = normalizado[clave]
