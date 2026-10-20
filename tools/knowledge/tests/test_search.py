"""Shared search fixtures plus compendium shape guards.

The normative search semantics live in ``content/knowledge/search-fixtures.json``
so that D09 (Rust) and D15 (TypeScript) consume the same expectations.
"""

from contextlib import contextmanager
from dataclasses import replace
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from tools.knowledge import fixtures, importer, loader, search
from tools.knowledge.model import RULES_EDITIONS
from tools.knowledge.search import SearchFilters

FIXTURES = fixtures.load_fixtures()


@contextmanager
def compendium_content(document):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "compendium.json"
        path.write_text(json.dumps(document), encoding="utf-8")
        yield Path(directory)


class SharedSearchFixtureTests(unittest.TestCase):
    """Every shared fixture must hold against the committed compendium."""

    def test_every_shared_fixture_holds(self):
        for fixture in FIXTURES:
            filters = SearchFilters.from_record(fixture.filters)
            found = search.find(fixture.query, filters)
            with self.subTest(fixture=fixture.name):
                self.assertEqual({entry["id"] for entry in found}, set(fixture.expected_ids))

    def test_fixtures_cover_every_filter_dimension(self):
        used = set()
        for fixture in FIXTURES:
            used.update(fixture.filters)
        self.assertEqual(used, set(fixtures.FILTER_FIELDS))

    def test_fixtures_cover_both_editions_and_a_non_translated_status(self):
        editions = {
            fixture.filters["rules_edition"]
            for fixture in FIXTURES
            if "rules_edition" in fixture.filters
        }
        statuses = {
            fixture.filters["translation_status"]
            for fixture in FIXTURES
            if "translation_status" in fixture.filters
        }
        self.assertEqual(editions, set(RULES_EDITIONS))
        self.assertIn("reviewed", statuses)

    def test_verify_fixtures_reports_no_mismatch(self):
        self.assertEqual(search.verify_fixtures(), 0)

    def test_verify_fixtures_detects_a_drifted_expectation(self):
        drifted = replace(FIXTURES[0], expected_ids=())
        message = search.check_fixture(drifted)
        self.assertIsNotNone(message)
        self.assertIn(drifted.name, message)
        self.assertIn("expected", message)


class CompendiumShapeTests(unittest.TestCase):
    def test_invalid_compendium_shape_has_context(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "compendium.json"
            path.write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "invalid compendium"):
                search.find("", content_dir=Path(directory))

    def test_catalog_record_missing_fields_is_rejected(self):
        document = importer.render_compendium(loader.load_entries())
        first_id = next(iter(document["catalog"]))
        del document["catalog"][first_id]["references"]
        with compendium_content(document) as content:
            with self.assertRaisesRegex(ValueError, "invalid compendium"):
                search.find("", content_dir=content)

    def test_catalog_references_must_be_an_array(self):
        document = importer.render_compendium(loader.load_entries())
        first_id = next(iter(document["catalog"]))
        document["catalog"][first_id]["references"] = {}
        with compendium_content(document) as content:
            with self.assertRaisesRegex(ValueError, "invalid compendium"):
                search.find("", content_dir=content)

    def test_entry_without_catalog_record_is_rejected(self):
        document = importer.render_compendium(loader.load_entries())
        first_id = next(iter(document["catalog"]))
        del document["catalog"][first_id]
        with compendium_content(document) as content:
            with self.assertRaisesRegex(ValueError, "invalid compendium"):
                search.find("", content_dir=content)

    def test_missing_compendium_has_recovery_hint(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "tools.knowledge.importer"):
                search.find("", content_dir=Path(directory))


if __name__ == "__main__":
    unittest.main()
