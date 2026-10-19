"""Anti-tamper check for CI: fail when a diff weakens the test net instead of fixing code.

    python3 tools/ci/tamper_check.py <base-ref> [<head-ref>]

Flags, on the diff `base...head` (head defaults to HEAD):
  * suppression pragmas added in code: TypeScript ignore/expect-error comments, eslint and tslint
    disables, Python noqa/type-ignore/no-cover pragmas, Rust allow attributes, svelte ignores;
  * tests disabled or focused: skip/only/todo on test APIs, x-prefixed tests, Rust ignore
    attributes, pytest/unittest skips;
  * test files deleted;
  * thresholds loosened (`MIN_SCORE = 77` -> `70`, `max_lines: 40` -> `60`).

Exit 0 = no finding, 1 = findings (printed), 2 = the diff could not be read. Fail-closed: a git
error is never a pass. Markdown and plain text are not scanned — a pragma in prose has no effect.

The patterns are assembled from pieces on purpose: this file must not contain the literal strings
it detects, or the pull request that adds it would fail its own check. No path is exempt.
"""
from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import PurePosixPath

AT, HASH, DOT = "@", "#", "."
SUPPRESSIONS = (
    AT + "ts-" + "ignore", AT + "ts-" + "expect-error", "eslint-" + "disable", "tslint:" + "disable",
    HASH + " no" + "qa", HASH + " type: " + "ignore", HASH + "[al" + "low(", HASH + "![al" + "low(",
    HASH + " pragma: no " + "cover", "svelte-" + "ignore",
)
# Test-API receivers only: a bare `.skip(` would also match Rust's `iter().skip(1)`.
SKIPS = tuple(f"{receiver}.{verb}(" for receiver in ("it", "test", "describe", "t", "suite")
              for verb in ("skip", "only", "todo")) + (
    "xit" + "(", "xdescribe" + "(", HASH + "[ig" + "nore]", "skip: " + "true",
    AT + "pytest.mark." + "skip", "unittest." + "skip", "pytest." + "skip(",
)
UNSCANNED_SUFFIXES = (".md", ".txt", ".rst")
PREVIEW_CHARS = 120
ARGC_BASE_ONLY = 2
ARGC_BASE_AND_HEAD = 3
TEST_DIRS = ("test", "tests", "__tests__", "spec", "holdout")
TEST_NAME_MARKERS = (".test.", ".spec.", "_test.")
THRESHOLD = re.compile(r"^\s*['\"]?([A-Za-z_][A-Za-z0-9_\-]*)['\"]?\s*[:=]\s*(-?\d+(?:\.\d+)?)\s*,?\s*$")
LOWER_IS_LOOSER = ("min", "floor", "threshold", "score", "coverage")
HIGHER_IS_LOOSER = ("max", "limit", "ceiling", "budget", "timeout")


@dataclass
class FileDiff:
    path: str
    deleted: bool = False
    added: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)


def is_test_path(path: str) -> bool:
    parts = PurePosixPath(path.lower()).parts
    if any(part in TEST_DIRS for part in parts[:-1]):
        return True
    if not parts:
        return False
    name = parts[-1]
    return name.startswith("test_") or any(marker in name for marker in TEST_NAME_MARKERS)


def parse_diff(diff: str) -> list[FileDiff]:
    """Split a unified diff into per-file added/removed lines and deletions. O(lines)."""
    files: list[FileDiff] = []
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            files.append(FileDiff(line.partition(" b/")[2].strip()))
        elif not files:
            continue
        elif line.startswith("deleted file mode"):
            files[-1].deleted = True
        elif line.startswith("+") and not line.startswith("+++"):
            files[-1].added.append(line[1:])
        elif line.startswith("-") and not line.startswith("---"):
            files[-1].removed.append(line[1:])
    return files


def _contains(line: str, pattern: str) -> bool:
    """Substring match that respects a word start: an x-prefixed test call is not `sys.exit`."""
    start = line.find(pattern)
    while start != -1:
        before = line[start - 1] if start else " "
        if not (pattern[0].isalnum() and (before.isalnum() or before == "_")):
            return True
        start = line.find(pattern, start + 1)
    return False


def _pattern_findings(diff: FileDiff) -> list[str]:
    findings = []
    for line in diff.added:
        for pattern in SUPPRESSIONS:
            if _contains(line, pattern):
                findings.append(f"{diff.path}: suppression added ({pattern}): {line.strip()[:PREVIEW_CHARS]}")
        for pattern in SKIPS:
            if _contains(line, pattern):
                findings.append(f"{diff.path}: test disabled or focused ({pattern}): {line.strip()[:PREVIEW_CHARS]}")
    return findings


def _thresholds(lines: list[str]) -> dict[str, float]:
    values = {}
    for line in lines:
        match = THRESHOLD.match(line)
        if match:
            values[match.group(1)] = float(match.group(2))
    return values


def _loosened(key: str, before: float, after: float) -> bool:
    lowered = key.lower()
    if any(word in lowered for word in LOWER_IS_LOOSER):
        return after < before
    if any(word in lowered for word in HIGHER_IS_LOOSER):
        return after > before
    return False


def _threshold_findings(diff: FileDiff) -> list[str]:
    before, after = _thresholds(diff.removed), _thresholds(diff.added)
    return [f"{diff.path}: threshold loosened: {key} {before[key]:g} -> {after[key]:g}"
            for key in sorted(before.keys() & after.keys()) if _loosened(key, before[key], after[key])]


def findings(diff: str) -> list[str]:
    found: list[str] = []
    for file_diff in parse_diff(diff):
        if file_diff.deleted and is_test_path(file_diff.path):
            found.append(f"{file_diff.path}: test file deleted")
        if PurePosixPath(file_diff.path).suffix.lower() in UNSCANNED_SUFFIXES:
            continue
        found.extend(_pattern_findings(file_diff))
        found.extend(_threshold_findings(file_diff))
    return found


def read_diff(base: str, head: str) -> str:
    proc = subprocess.run(["git", "diff", "--no-color", "--unified=0", f"{base}...{head}"],
                          capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"git diff {base}...{head} failed: {proc.stderr.strip()}")
    return proc.stdout


def main(argv: list[str]) -> int:
    if len(argv) not in (ARGC_BASE_ONLY, ARGC_BASE_AND_HEAD):
        print(__doc__, file=sys.stderr)
        return 2
    head = argv[2] if len(argv) == ARGC_BASE_AND_HEAD else "HEAD"
    try:
        diff = read_diff(argv[1], head)
    except (OSError, RuntimeError) as exc:
        print(f"tamper-check: cannot read the diff, failing closed: {exc}", file=sys.stderr)
        return 2
    found = findings(diff)
    for finding in found:
        print(f"::error::{finding}")
    print(f"tamper-check: {len(found)} finding(s) in {argv[1]}...{head}")
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
