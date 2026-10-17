"""Aceptación del gate: romper una regla produce salida no cero."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
GATE = RAIZ / "gate.py"
REPO = RAIZ.parents[1]


def _correr_gate(root: Path, *extra: str) -> subprocess.CompletedProcess:
    comando = [sys.executable, str(GATE), "--root", str(root), *extra]
    return subprocess.run(comando, capture_output=True, text=True)


def _fixture(contenido: dict[str, str]) -> tempfile.TemporaryDirectory:
    temporal = tempfile.TemporaryDirectory()
    for relativo, texto in contenido.items():
        destino = Path(temporal.name) / relativo
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_text(texto, encoding="utf-8")
    return temporal


class GateAceptacionTest(unittest.TestCase):
    def test_linea_larga_falla(self):
        linea = 'pub const TEXTO: &str = "' + "x" * 120 + '";\n'
        with _fixture({"src/roto.rs": linea}) as root:
            resultado = _correr_gate(Path(root), "--no-km")
        self.assertEqual(resultado.returncode, 2)
        self.assertIn("F16", resultado.stdout)

    def test_error_silencioso_falla(self):
        with _fixture({"src/roto.rs": "pub fn f() {\n    let _ = leer();\n}\n"}) as root:
            resultado = _correr_gate(Path(root), "--no-km")
        self.assertEqual(resultado.returncode, 2)
        self.assertIn("F11", resultado.stdout)

    def test_fuente_limpia_pasa(self):
        with _fixture({"src/bien.rs": "pub fn suma(a: i32) -> i32 {\n    a + 1\n}\n"}) as root:
            resultado = _correr_gate(Path(root), "--no-km")
        self.assertEqual(resultado.returncode, 0)

    def test_repositorio_actual_pasa(self):
        with tempfile.TemporaryDirectory() as temporal:
            destino = str(Path(temporal) / "gate.json")
            resultado = _correr_gate(REPO, "--json", destino)
        self.assertEqual(resultado.returncode, 0)


if __name__ == "__main__":
    unittest.main()
