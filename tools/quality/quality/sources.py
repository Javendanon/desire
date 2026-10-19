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

# Matched against the whole file, so handlers split over several lines are caught too.
F11_PATTERNS = (
    ("Rust", re.compile(r"\blet\s+_\s*="), "discarded value without handling (unused Result)"),
    ("Python", re.compile(r"\bexcept\b[^:\n]*:[ \t]*(?:#[^\n]*)?\n?[ \t]*pass\b"),
     "except without handling"),
    ("JS/TS", re.compile(r"\bcatch\s*(\([^)]*\))?\s*\{\s*\}"), "empty catch"),
)

SCRIPT_SELECTOR = re.compile(r"<script[^>]*>(.*?)</script>", re.DOTALL)
FOR_PATTERN = re.compile(r"\bfor\s*\(")
QUOTES = "'\"`"
OPENERS = "(["
CLOSERS = ")]"
CLOSING_ONLY = re.compile(r"^[\s})\],]*$")
TRIPLE_QUOTES = ('"""', "'''")
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
        return len(HTML_TAGS.findall(line)) >= 3 or _statements(line, path) >= 2
    if FOR_PATTERN.search(line):
        return False
    return _statements(line, path) >= 2


def _code_part(line: str, path: str) -> str:
    """The line without string contents and without a trailing comment. O(len(line))."""
    comment_marks = ("//", "#") if path.endswith(".py") else ("//",)
    kept: list[str] = []
    quote = ""
    for index, char in enumerate(line):
        if quote:
            quote = "" if char == quote else quote
            continue
        if any(line.startswith(mark, index) for mark in comment_marks):
            break
        if char in QUOTES:
            quote = char
        kept.append(char)
    return "".join(kept)


def _statements(line: str, path: str) -> int:
    """`;` terminators outside brackets and strings, plus trailing code after the last one.

    `[0u8; 32]`, `"a;b"`, `return a; }` and `x = 1; // a; b` are one statement each.
    """
    code = _code_part(line, path)
    depth = 0
    terminators = 0
    tail_start = 0
    for index, char in enumerate(code):
        if char in OPENERS:
            depth += 1
        elif char in CLOSERS:
            depth = max(0, depth - 1)
        elif char == ";" and depth == 0:
            terminators += 1
            tail_start = index + 1
    trailing = 0 if CLOSING_ONLY.match(code[tail_start:]) else 1
    return terminators + trailing if terminators else trailing


def statement_lines(source: SourceFile) -> list[tuple[int, str]]:
    """(number, line) pairs that can hold statements: Python docstrings are prose. O(lines)."""
    is_python = source.path.endswith(".py")
    kept = []
    in_docstring = False
    for number, line in enumerate(source.lines, start=1):
        marks = sum(line.count(quote) for quote in TRIPLE_QUOTES) if is_python else 0
        if in_docstring or marks:
            in_docstring = in_docstring != (marks % 2 == 1)
            continue
        kept.append((number, line))
    return kept


def long_lines(source: SourceFile) -> list[tuple[int, int]]:
    return [
        (number, len(line))
        for number, line in enumerate(source.lines, start=1)
        if len(line) > config.MAX_COLUMNS
    ]


def silent_errors(source: SourceFile) -> list[tuple[int, str]]:
    """F11 findings as (line, message), reported on the line where each handler starts."""
    text = "\n".join(source.lines)
    found = []
    for _, pattern, message in F11_PATTERNS:
        for match in pattern.finditer(text):
            found.append((text.count("\n", 0, match.start()) + 1, message))
    return sorted(found)
