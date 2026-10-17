"""Pruebas de la clasificación piso/objetivo y de los falsos positivos."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quality import config, evaluate
from quality.evaluate import AVISA, BLOQUEA, Hallazgo


def _smell(path: str, kind: str, line: int) -> dict:
    return {"path": path, "smells": [{"kind": kind, "line": line, "detail": f"{kind}@{line}"}]}


def _funcion(path: str, nombre: str, complexity: int) -> dict:
    ficha = {"name": nombre, "start_line": 1, "complexity": complexity}
    return {"path": path, "functions": [ficha]}


class ScoreTest(unittest.TestCase):
    def test_bajo_piso_bloquea(self):
        self.assertEqual(evaluate.evaluar_score(70.0, "D")[0].severidad, BLOQUEA)

    def test_entre_piso_y_objetivo_avisa(self):
        self.assertEqual(evaluate.evaluar_score(80.0, "B")[0].severidad, AVISA)

    def test_en_objetivo_limpio(self):
        self.assertEqual(evaluate.evaluar_score(90.0, "A-"), [])


class SmellsTest(unittest.TestCase):
    def test_piso_bloquea_y_objetivo_avisa(self):
        piso = [_smell("./a.ts", "long_function", 3)]
        objetivo = [_smell("./a.ts", "long_function", 3), _smell("./a.ts", "long_function", 9)]
        hallazgos = evaluate.evaluar_smells(piso, objetivo)
        severidades = {(h.ubicacion, h.severidad) for h in hallazgos}
        self.assertIn(("a.ts:3", BLOQUEA), severidades)
        self.assertIn(("a.ts:9", AVISA), severidades)


class ComplejidadTest(unittest.TestCase):
    def test_ciclomatica_sobre_piso(self):
        hallazgos = evaluate.evaluar_complejidad([_funcion("./a.rs", "f", 16)], [])
        self.assertEqual(hallazgos[0].regla, "F4")
        self.assertEqual(hallazgos[0].severidad, BLOQUEA)

    def test_cognitiva_sobre_objetivo(self):
        hallazgos = evaluate.evaluar_complejidad([], [_funcion("./a.rs", "f", 12)])
        self.assertEqual(hallazgos[0].regla, "F5")
        self.assertEqual(hallazgos[0].severidad, AVISA)


class DuplicacionTest(unittest.TestCase):
    def test_ratio_sobre_piso(self):
        dups = {"metrics": {"duplication_percentage": 11.0}, "groups": []}
        self.assertEqual(evaluate.evaluar_duplicacion(dups)[0].severidad, BLOQUEA)

    def test_regla_de_tres_bloquea(self):
        grupo = {"line_count": 8, "locations": [{"file_path": f"{n}.ts"} for n in "abc"]}
        hallazgos = evaluate.evaluar_duplicacion({"metrics": {"duplication_percentage": 0.0}, "groups": [grupo]})
        self.assertTrue(any(h.severidad == BLOQUEA for h in hallazgos))


class FalsosPositivosTest(unittest.TestCase):
    def test_suprime_con_justificacion(self):
        falso = config.FalsoPositivo(
            origen="km-smells",
            regla="F2",
            path="vite.config.ts",
            contiene="defineConfig",
            justificacion="defineConfig recibe un objeto",
        )
        hallazgo = Hallazgo("F2", BLOQUEA, "vite.config.ts:4", "function `defineConfig` has 6 params", "km-smells")
        admitidos, suprimidos = evaluate.aplicar_falsos_positivos([hallazgo], [falso])
        self.assertEqual(admitidos, [])
        self.assertEqual(len(suprimidos), 1)

    def test_no_suprime_si_no_coincide(self):
        falso = config.FalsoPositivo("km-smells", "F2", "otro.ts", "defineConfig", "otro")
        hallazgo = Hallazgo("F2", BLOQUEA, "vite.config.ts:4", "function `defineConfig`", "km-smells")
        admitidos, _ = evaluate.aplicar_falsos_positivos([hallazgo], [falso])
        self.assertEqual(len(admitidos), 1)


if __name__ == "__main__":
    unittest.main()
