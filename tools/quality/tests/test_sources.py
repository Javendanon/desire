"""Pruebas de las heurísticas de fuentes (F16, F11 y extracción de scripts)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quality import sources
from quality.sources import SourceFile


def fuente(path: str, *lineas: str) -> SourceFile:
    return SourceFile(path=path, lineas=tuple(lineas), code_lines=len(lineas))


class F16LargoTest(unittest.TestCase):
    def test_detecta_mas_de_100_columnas(self):
        self.assertEqual(sources.lineas_largas(fuente("src/x.ts", "a" * 101)), [(1, 101)])

    def test_tolera_exactamente_100(self):
        self.assertEqual(sources.lineas_largas(fuente("src/x.ts", "a" * 100)), [])


class F16ComprimidoTest(unittest.TestCase):
    def test_html_con_tres_etiquetas_seguidas(self):
        linea = "<i></i><i></i><i></i><i></i>"
        self.assertTrue(sources.linea_comprimida(linea, "index.html"))

    def test_svelte_con_script_en_una_linea(self):
        linea = "<script>a = 1; b = 2; c = 3;</script>"
        self.assertTrue(sources.linea_comprimida(linea, "src/App.svelte"))

    def test_js_con_varias_sentencias(self):
        self.assertTrue(sources.linea_comprimida("let a = 1; let b = 2; let c = 3;", "src/x.ts"))

    def test_js_con_una_sentencia_no_es_comprimido(self):
        self.assertFalse(sources.linea_comprimida("let a = 1;", "src/x.ts"))

    def test_for_con_puntos_y_coma_no_es_comprimido(self):
        self.assertFalse(sources.linea_comprimida("for (let i = 0; i < 3; i++) {", "src/x.ts"))


class F11SilenciososTest(unittest.TestCase):
    def test_detecta_result_descartado_en_rust(self):
        casos = sources.errores_silenciosos(fuente("a.rs", "    let _ = leer();"))
        self.assertEqual(len(casos), 1)

    def test_detecta_except_sin_manejo(self):
        self.assertEqual(len(sources.errores_silenciosos(fuente("a.py", "except: pass"))), 1)

    def test_detecta_catch_vacio(self):
        self.assertEqual(len(sources.errores_silenciosos(fuente("a.ts", "} catch (e) {}"))), 1)

    def test_detecta_catch_vacio_sin_binding(self):
        self.assertEqual(len(sources.errores_silenciosos(fuente("a.ts", "} catch {}"))), 1)

    def test_no_marca_catch_con_cuerpo(self):
        self.assertEqual(len(sources.errores_silenciosos(fuente("a.ts", "} catch (e) { aviso(e); }"))), 0)


class ExtraccionSvelteTest(unittest.TestCase):
    def test_extrae_el_bloque_script(self):
        svelte = '<p>x</p><script lang="ts">const a = 1;</script>'
        self.assertEqual(sources.extraer_scripts(svelte).strip(), "const a = 1;")

    def test_concadena_varios_bloques(self):
        svelte = "<script>uno</script><script>dos</script>"
        self.assertEqual(sources.extraer_scripts(svelte), "uno\ndos")


class CodigoTest(unittest.TestCase):
    def test_ignora_lineas_vacias_y_comentarios(self):
        self.assertFalse(sources.es_codigo("   "))
        self.assertFalse(sources.es_codigo("// comentario"))
        self.assertFalse(sources.es_codigo("<!-- html -->"))
        self.assertTrue(sources.es_codigo("let a = 1;"))


if __name__ == "__main__":
    unittest.main()
