"""Active source analysis: discovery, F16, F11 and file size.

Covers Svelte, HTML and CSS, which `km` does not analyze. The heuristics are
text based and are documented as such; they do not replace an AST.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from . import config

COMMENT_PREFIXES = ("//", "*", "/*", "*/", "<!--")

F11_PATTERNS = (
    ("Rust", re.compile(r"\blet\s+_\s*="), "discarded value without handling (unused Result)"),
    ("Python", re.compile(r"except\s*:\s*pass"), "except without handling"),
    ("JS/TS", re.compile(r"catch\s*(\([^)]*\))?\s*\{\s*\}"), "empty catch"),
)

SCRIPT_SELECTOR = re.compile(r"<script[^>]*>(.*?)</script>", re.DOTALL)
FOR_PATTERN = re.compile(r"\bfor\s*\(")
STATEMENT_END = re.compile(r";\s*\S")
HTML_TAGS = re.compile(r"><")


@dataclass(frozen=True)
class SourceFile:
    path: str
    lines: tuple[str, ...]
    code_lines: int


def discover_sources(root: Path) -> list[SourceFile]:
    sources = []
    for path in sorted(root.rglob("*")):
        if not _is_source(root, path):
            continue
        sources.append(read_source(root, path))
    return sources


def _is_source(root: Path, path: Path) -> bool:
    if not path.is_file() or path.suffix not in config.SOURCE_EXTS:
        return False
    relative = path.relative_to(root)
    if any(part in config.EXCLUDED_DIRS for part in relative.parts[:-1]):
        return False
    return not relative.name.endswith(".test.ts")


def read_source(root: Path, path: Path) -> SourceFile:
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = tuple(text.splitlines())
    return SourceFile(
        path=path.relative_to(root).as_posix(),
        lines=lines,
        code_lines=sum(1 for line in lines if is_code(line)),
    )


def is_code(line: str) -> bool:
    text = line.strip()
    return bool(text) and not text.startswith(COMMENT_PREFIXES)


def extract_scripts(source: str) -> str:
    return "\n".join(block.group(1) for block in SCRIPT_SELECTOR.finditer(source))


def is_compressed_line(line: str, path: str) -> bool:
    if path.endswith((".html", ".svelte")):
        return len(HTML_TAGS.findall(line)) >= 3 or _statements(line) >= 2
    if FOR_PATTERN.search(line):
        return False
    return _statements(line) >= 2


def _statements(line: str) -> int:
    return len(STATEMENT_END.findall(line))


def long_lines(source: SourceFile) -> list[tuple[int, int]]:
    return [
        (number, len(line))
        for number, line in enumerate(source.lines, start=1)
        if len(line) > config.MAX_COLUMNS
    ]


def silent_errors(source: SourceFile) -> list[tuple[int, str]]:
    found = []
    for number, line in enumerate(source.lines, start=1):
        for _, pattern, message in F11_PATTERNS:
            if pattern.search(line):
                found.append((number, message))
    return found
