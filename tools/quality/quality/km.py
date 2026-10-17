"""Run kimün (km) with the agreed scope and parse its JSON output."""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

Alias = dict[str, str]


class KmError(RuntimeError):
    """km is not available or returned a runtime error."""


def has_km() -> bool:
    return shutil.which("km") is not None


@dataclass(frozen=True)
class Request:
    """km command and extra flags that do not depend on the file scope."""

    command: str
    extra: tuple[str, ...] = ()


@dataclass(frozen=True)
class Scope:
    """Scope of a measurement: path, excluded folders, extensions and alias."""

    path: str = "."
    dirs: tuple[str, ...] = ()
    exts: tuple[str, ...] = ()
    informative: bool = True
    alias: Alias | None = None

    def query(self, command: str, *extra: str) -> "Query":
        return Query(command, self.path, self._arguments(), tuple(extra))

    def _arguments(self) -> list[str]:
        dirs = [arg for name in self.dirs for arg in ("--exclude-dir", name)]
        exts = [arg for ext in self.exts for arg in ("--include-ext", ext)]
        return dirs + exts


@dataclass(frozen=True)
class Query:
    command: str
    path: str
    scope_flags: tuple[str, ...]
    extra: tuple[str, ...] = ()


def run(root: Path, query: Query) -> Any:
    parts = [
        "km",
        query.command,
        query.path,
        *query.scope_flags,
        *query.extra,
        "--format",
        "json",
    ]
    try:
        process = subprocess.run(parts, cwd=root, capture_output=True, text=True)
    except FileNotFoundError as error:
        raise KmError("km no está instalado en PATH") from error
    if process.returncode != 0:
        detail = process.stderr.strip()
        raise KmError(f"km {query.command} falló ({process.returncode}): {detail}")
    return json.loads(process.stdout)


def rewrite_paths(result: Any, alias: Alias) -> None:
    normalized = {key.lstrip("./"): value for key, value in alias.items()}
    for file in result:
        key = str(file.get("path", "")).lstrip("./")
        if key in normalized:
            file["path"] = normalized[key]
