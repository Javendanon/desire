"""Tests for the source heuristics (F16, F11 and script extraction)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quality import sources
from quality.sources import SourceFile


def source(path: str, *lines: str) -> SourceFile:
    return SourceFile(path=path, lines=tuple(lines), code_lines=len(lines))


class F16LongLinesTest(unittest.TestCase):
    def test_detects_more_than_100_columns(self):
        self.assertEqual(sources.long_lines(source("src/x.ts", "a" * 101)), [(1, 101)])

    def test_tolerates_exactly_100(self):
        self.assertEqual(sources.long_lines(source("src/x.ts", "a" * 100)), [])


class F16CompressedTest(unittest.TestCase):
    def test_html_with_three_consecutive_tags(self):
        line = "<i></i><i></i><i></i><i></i>"
        self.assertTrue(sources.is_compressed_line(line, "index.html"))

    def test_svelte_with_script_on_one_line(self):
        line = "<script>a = 1; b = 2; c = 3;</script>"
        self.assertTrue(sources.is_compressed_line(line, "src/App.svelte"))

    def test_js_with_several_statements(self):
        self.assertTrue(sources.is_compressed_line("let a = 1; let b = 2; let c = 3;", "src/x.ts"))

    def test_js_with_one_statement_is_not_compressed(self):
        self.assertFalse(sources.is_compressed_line("let a = 1;", "src/x.ts"))

    def test_for_with_semicolons_is_not_compressed(self):
        self.assertFalse(sources.is_compressed_line("for (let i = 0; i < 3; i++) {", "src/x.ts"))

    def test_exactly_two_statements_are_compressed(self):
        for line in ("a = 1; b = 2;", "a = 1; b = 2", "let x = read(); use(x);"):
            with self.subTest(line=line):
                self.assertTrue(sources.is_compressed_line(line, "src/x.ts"))

    def test_semicolons_that_do_not_separate_statements(self):
        for line in ("let buf = [0u8; 32];", 'const s = "a;b";', "return a; }",
                     "x = 1; // note; more", "f(a, b);"):
            with self.subTest(line=line):
                self.assertFalse(sources.is_compressed_line(line, "src/x.rs"))


class StatementLinesTest(unittest.TestCase):
    def test_python_docstrings_are_prose_not_statements(self):
        lines = ('"""Module.', "", "Text based; not an AST.", '"""',
                 'X = """a; b"""', "a = 1; b = 2")
        numbers = [number for number, _ in sources.statement_lines(source("a.py", *lines))]
        self.assertEqual(numbers, [6])

    def test_other_languages_keep_every_line(self):
        lines = ("*ptr = 1; *other = 2;", "let a = 1;")
        numbers = [number for number, _ in sources.statement_lines(source("a.rs", *lines))]
        self.assertEqual(numbers, [1, 2])


class F11SilentErrorsTest(unittest.TestCase):
    def test_detects_discarded_result_in_rust(self):
        cases = sources.silent_errors(source("a.rs", "    let _ = read();"))
        self.assertEqual(len(cases), 1)

    def test_detects_except_without_handling(self):
        self.assertEqual(len(sources.silent_errors(source("a.py", "except: pass"))), 1)

    def test_detects_empty_catch(self):
        self.assertEqual(len(sources.silent_errors(source("a.ts", "} catch (e) {}"))), 1)

    def test_detects_empty_catch_without_binding(self):
        self.assertEqual(len(sources.silent_errors(source("a.ts", "} catch {}"))), 1)

    def test_does_not_flag_catch_with_body(self):
        self.assertEqual(len(sources.silent_errors(source("a.ts", "} catch (e) { warn(e); }"))), 0)

    def test_detects_multiline_empty_catch_on_the_catch_line(self):
        found = sources.silent_errors(source("a.ts", "try {", "  f();", "} catch (error) {", "}"))
        self.assertEqual(found, [(3, "empty catch")])

    def test_detects_multiline_except_pass_on_the_except_line(self):
        found = sources.silent_errors(source("a.py", "try:", "    f()", "except:", "    pass"))
        self.assertEqual(found, [(3, "except without handling")])

    def test_detects_typed_except_pass(self):
        typed = source("a.py", "try:", "    f()", "except ValueError:", "    pass")
        found = sources.silent_errors(typed)
        self.assertEqual(len(found), 1)

    def test_does_not_flag_multiline_handlers_with_a_body(self):
        ts = source("a.ts", "} catch (error) {", "  report(error);", "}")
        py = source("a.py", "except ValueError as error:", "    log(error)", "    pass")
        self.assertEqual(sources.silent_errors(ts) + sources.silent_errors(py), [])


class SvelteExtractionTest(unittest.TestCase):
    def test_extracts_script_block(self):
        svelte = '<p>x</p><script lang="ts">const a = 1;</script>'
        self.assertEqual(sources.extract_scripts(svelte).strip(), "const a = 1;")

    def test_concatenates_several_blocks(self):
        svelte = "<script>one</script><script>two</script>"
        self.assertEqual(sources.extract_scripts(svelte), "one\ntwo")


class CodeTest(unittest.TestCase):
    def test_ignores_blank_lines_and_comments(self):
        self.assertFalse(sources.is_code("   "))
        self.assertFalse(sources.is_code("// comment"))
        self.assertFalse(sources.is_code("<!-- html -->"))
        self.assertTrue(sources.is_code("let a = 1;"))


if __name__ == "__main__":
    unittest.main()
