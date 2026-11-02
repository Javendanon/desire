"""Tests for floor/target classification and for false positives."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quality import config, evaluate
from quality.evaluate import BLOCKS, WARNS, Finding


def _smell(path: str, kind: str, line: int) -> dict:
    return {"path": path, "smells": [{"kind": kind, "line": line, "detail": f"{kind}@{line}"}]}


def _function(path: str, name: str, complexity: int) -> dict:
    record = {"name": name, "start_line": 1, "complexity": complexity}
    return {"path": path, "functions": [record]}


class ScoreTest(unittest.TestCase):
    def test_below_floor_blocks(self):
        self.assertEqual(evaluate.evaluate_score(70.0, "D")[0].severity, BLOCKS)

    def test_between_floor_and_target_warns(self):
        self.assertEqual(evaluate.evaluate_score(80.0, "B")[0].severity, WARNS)

    def test_at_target_clean(self):
        self.assertEqual(evaluate.evaluate_score(90.0, "A-"), [])


class SmellsTest(unittest.TestCase):
    def test_floor_blocks_and_target_warns(self):
        floor = [_smell("./a.ts", "long_function", 3)]
        target = [_smell("./a.ts", "long_function", 3), _smell("./a.ts", "long_function", 9)]
        findings = evaluate.evaluate_smells(floor, target)
        severities = {(f.location, f.severity) for f in findings}
        self.assertIn(("a.ts:3", BLOCKS), severities)
        self.assertIn(("a.ts:9", WARNS), severities)


class ComplexityTest(unittest.TestCase):
    def test_cyclomatic_above_floor(self):
        findings = evaluate.evaluate_complexity([_function("./a.rs", "f", 16)], [])
        self.assertEqual(findings[0].rule, "F4")
        self.assertEqual(findings[0].severity, BLOCKS)

    def test_cognitive_above_target(self):
        findings = evaluate.evaluate_complexity([], [_function("./a.rs", "f", 12)])
        self.assertEqual(findings[0].rule, "F5")
        self.assertEqual(findings[0].severity, WARNS)


class DuplicationTest(unittest.TestCase):
    def test_ratio_above_floor(self):
        dups = {"metrics": {"duplication_percentage": 11.0}, "groups": []}
        self.assertEqual(evaluate.evaluate_duplication(dups)[0].severity, BLOCKS)

    def test_rule_of_three_blocks(self):
        group = {"line_count": 8, "locations": [{"file_path": f"{n}.ts"} for n in "abc"]}
        findings = evaluate.evaluate_duplication(
            {"metrics": {"duplication_percentage": 0.0}, "groups": [group]}
        )
        self.assertTrue(any(f.severity == BLOCKS for f in findings))


class FalsePositivesTest(unittest.TestCase):
    def test_suppresses_with_justification(self):
        false_positive = config.FalsePositive(
            origin="km-smells",
            rule="F2",
            path="vite.config.ts",
            contains="defineConfig",
            justification="defineConfig takes an object",
        )
        finding = Finding("F2", BLOCKS, "vite.config.ts:4", "function `defineConfig` has 6 params", "km-smells")
        accepted, suppressed = evaluate.apply_false_positives([finding], [false_positive])
        self.assertEqual(accepted, [])
        self.assertEqual(len(suppressed), 1)

    def test_does_not_suppress_on_mismatch(self):
        false_positive = config.FalsePositive("km-smells", "F2", "other.ts", "defineConfig", "other")
        finding = Finding("F2", BLOCKS, "vite.config.ts:4", "function `defineConfig`", "km-smells")
        accepted, _ = evaluate.apply_false_positives([finding], [false_positive])
        self.assertEqual(len(accepted), 1)


if __name__ == "__main__":
    unittest.main()
