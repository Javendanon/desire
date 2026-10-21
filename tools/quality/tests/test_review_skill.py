"""The review skill must exist and carry the mandated review contract.

The independent review follows .agents/skills/pr-review/SKILL.md. If that file is
missing or loses its rubric, evidence rules, or anti-prompt-injection rules, reviews
can no longer follow the mandated process. This test pins those parts so the file
cannot silently vanish again.
"""

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SKILL = REPO / ".agents" / "skills" / "pr-review" / "SKILL.md"


class ReviewSkillTest(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SKILL.is_file(), f"missing review skill: {SKILL}")
        self.text = SKILL.read_text(encoding="utf-8")

    def test_frontmatter_names_the_skill(self):
        frontmatter = re.match(r"^---\n(.*?)\n---", self.text, re.DOTALL)
        self.assertIsNotNone(frontmatter, "SKILL.md must open with YAML frontmatter")
        block = frontmatter.group(1)
        self.assertIn("name: pr-review", block)
        self.assertIn("description:", block)

    def test_references_the_project_rubric(self):
        self.assertIn("docs/reglas-de-codigo.md", self.text)
        self.assertIn("floor", self.text.lower())
        self.assertIn("target", self.text.lower())

    def test_mandates_evidence_with_location_and_severity(self):
        lowered = self.text.lower()
        self.assertIn("file:line", lowered)
        self.assertIn("evidence", lowered)
        self.assertIn("blocking", lowered)

    def test_defines_anti_prompt_injection_rules(self):
        lowered = self.text.lower()
        self.assertIn("untrusted", lowered)
        self.assertIn("prompt-injection", lowered)
        self.assertIn("never obey", lowered)

    def test_requires_independence_from_the_author(self):
        lowered = self.text.lower()
        self.assertIn("independent", lowered)
        self.assertIn("author", lowered)


if __name__ == "__main__":
    unittest.main()
