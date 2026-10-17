"""Gate acceptance: breaking a rule produces a non-zero exit."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GATE = ROOT / "gate.py"
REPO = ROOT.parents[1]


def _run_gate(root: Path, *extra: str) -> subprocess.CompletedProcess:
    command = [sys.executable, str(GATE), "--root", str(root), *extra]
    return subprocess.run(command, capture_output=True, text=True)


def _fixture(content: dict[str, str]) -> tempfile.TemporaryDirectory:
    tmp = tempfile.TemporaryDirectory()
    for relative, text in content.items():
        dest = Path(tmp.name) / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text, encoding="utf-8")
    return tmp


class GateAcceptanceTest(unittest.TestCase):
    def test_long_line_fails(self):
        line = 'pub const TEXTO: &str = "' + "x" * 120 + '";\n'
        with _fixture({"src/roto.rs": line}) as root:
            result = _run_gate(Path(root), "--no-km")
        self.assertEqual(result.returncode, 2)
        self.assertIn("F16", result.stdout)

    def test_silent_error_fails(self):
        with _fixture({"src/roto.rs": "pub fn f() {\n    let _ = leer();\n}\n"}) as root:
            result = _run_gate(Path(root), "--no-km")
        self.assertEqual(result.returncode, 2)
        self.assertIn("F11", result.stdout)

    def test_clean_source_passes(self):
        with _fixture({"src/bien.rs": "pub fn suma(a: i32) -> i32 {\n    a + 1\n}\n"}) as root:
            result = _run_gate(Path(root), "--no-km")
        self.assertEqual(result.returncode, 0)

    def test_current_repository_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = str(Path(tmp) / "gate.json")
            result = _run_gate(REPO, "--json", dest)
        self.assertEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
