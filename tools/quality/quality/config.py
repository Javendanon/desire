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
    ("F7", "SRP: one reason to change per file; names with 'and' or 'manager'."),
    ("F8", "Domain magic numbers km cannot tell apart (D&D rules, prices)."),
    ("F10", "Intent-revealing names: verify on the diff, not automatically."),
    ("F12/F14", "I/O boundaries and one level of abstraction per function."),
    ("F13", "Types at the public boundary; fixed-field structures, not loose dicts."),
    ("Svelte", "App.svelte template and CSS: km does not analyze .svelte; structural review."),
    ("HTML", "index.html: semantics and accessibility, not just line length."),
    ("Debt", "docs/archive/react-draft/: remove after consolidating the Git history."),
)

COVERAGE = (
    ("km (rs/ts/js)", "score, smells, cyclomatic and cognitive complexity, duplication"),
    ("extracted Svelte scripts", "smells and complexity of the <script> block, via km"),
    ("tools (py)", "smells and complexity of tools/quality, via km"),
    ("HTML/CSS/Svelte template", "line length, compression and LOC; the rest is manual"),
    ("Markdown/JSON/TOML/Wasm", "unmeasured: manual review only"),
    ("public/vendor/", "third-party source excluded from the score; not an approval"),
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
