"""Tests for tamper_check. Fixtures are assembled from pieces, like the checker's own patterns.

    python3 -m unittest discover -s tools/ci -p 'test_*.py'
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import tamper_check  # isort: skip — needs the sys.path line above

TS_IGNORE = "@" + "ts-ignore"
RUST_ALLOW = "#" + "[allow(dead_code)]"
RUST_IGNORE = "#" + "[ignore]"


def diff_of(path: str, added=(), removed=(), deleted=False) -> str:
    header = [f"diff --git a/{path} b/{path}"]
    if deleted:
        header.append("deleted file mode 100644")
    header += [f"--- a/{path}", f"+++ b/{path}" if not deleted else "+++ /dev/null", "@@ -1 +1 @@"]
    body = [f"-{line}" for line in removed] + [f"+{line}" for line in added]
    return "\n".join(header + body) + "\n"


class Flags(unittest.TestCase):
    def assert_flags(self, diff: str, needle: str) -> None:
        found = tamper_check.findings(diff)
        self.assertTrue(any(needle in f for f in found), found)

    def test_added_ts_suppression(self):
        self.assert_flags(diff_of("src/map.ts", added=[f"  // {TS_IGNORE}"]), "suppression added")

    def test_added_rust_allow(self):
        self.assert_flags(diff_of("crates/core/src/lib.rs", added=[RUST_ALLOW]), "suppression added")

    def test_skipped_test(self):
        self.assert_flags(diff_of("tests/health.test.ts", added=["it" + ".skip('parses', () => {"]),
                          "test disabled")

    def test_ignored_rust_test(self):
        self.assert_flags(diff_of("crates/core/tests/protocol.rs", added=[RUST_IGNORE]), "test disabled")

    def test_deleted_test_file(self):
        self.assert_flags(diff_of("tests/health.test.ts", removed=["test('x', ...)"], deleted=True),
                          "test file deleted")

    def test_loosened_floor(self):
        self.assert_flags(diff_of("tools/quality/quality/config.py", removed=["MIN_SCORE = 77"],
                                  added=["MIN_SCORE = 70"]), "threshold loosened: MIN_SCORE 77 -> 70")

    def test_loosened_ceiling(self):
        self.assert_flags(diff_of("tools/quality/config.json", removed=['  "max_lines": 40,'],
                                  added=['  "max_lines": 60,']), "max_lines 40 -> 60")


class Clean(unittest.TestCase):
    def test_clean_code_change_reports_nothing(self):
        diff = diff_of("crates/core/src/lib.rs", added=["let rest = items.iter().skip(1);",
                                                        "std::process::exit(1);"])
        diff += diff_of("src/lib/latest_values.ts", deleted=True, removed=["export const x = 1;"])
        self.assertEqual(tamper_check.findings(diff), [])

    def test_tightened_threshold_is_not_flagged(self):
        diff = diff_of("tools/quality/config.py", removed=["MIN_SCORE = 77"], added=["MIN_SCORE = 87"])
        self.assertEqual(tamper_check.findings(diff), [])

    def test_pragmas_in_markdown_are_not_code(self):
        diff = diff_of("docs/ci.md", added=[f"The check rejects `{TS_IGNORE}`."])
        self.assertEqual(tamper_check.findings(diff), [])

    def test_checker_and_its_tests_contain_no_literal_pattern(self):
        here = Path(__file__).resolve().parent
        for name in ("tamper_check.py", "test_tamper_check.py"):
            source = (here / name).read_text()
            for pattern in tamper_check.SUPPRESSIONS + tamper_check.SKIPS:
                with self.subTest(file=name, pattern=pattern):
                    self.assertFalse(tamper_check._contains(source, pattern))


class FailClosed(unittest.TestCase):
    def test_unreadable_diff_exits_2(self):
        with tempfile.TemporaryDirectory() as empty:
            proc = subprocess.run([sys.executable, tamper_check.__file__, "origin/main"], cwd=empty,
                                  capture_output=True, text=True)
        self.assertEqual(proc.returncode, 2, proc.stderr)

    def test_bad_arguments_exit_2(self):
        self.assertEqual(tamper_check.main(["tamper_check.py"]), 2)


if __name__ == "__main__":
    unittest.main()
