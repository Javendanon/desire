"""Shared search fixtures plus compendium shape guards.

The normative search semantics live in ``content/knowledge/search-fixtures.json``
so that D09 (Rust) and D15 (TypeScript) consume the same expectations.
"""

from contextlib import contextmanager, redirect_stderr, redirect_stdout
from dataclasses import replace
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from tools.knowledge import fixtures, importer, loader, search
from tools.knowledge.model import CONTENT_DIR, RULES_EDITIONS
from tools.knowledge.search import SearchFilters


REQUIRED_FIXTURES = frozenset(
    {
        "accented_query_matches_ignoring_accents",
        "unaccented_query_matches_accented_body",
        "uppercase_query_ignores_case",
        "tokens_match_independently_of_order",
        "multi_token_query_requires_every_token",
        "kind_word_is_searchable",
        "title_only_word_is_searchable",
        "language_filter_rejects_unsupported_language",
        "edition_filter_separates_2014",
        "edition_filter_separates_2024",
        "reference_target_is_searchable",
        "status_filter_reviewed_matches_nothing",
        "campaign_lore_stays_out_of_canon",
    }
)


def shared_fixtures():
    """Read the shared artifact per test instead of at import time."""
    return fixtures.load_fixtures()


@contextmanager
def compendium_content(document):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "compendium.json"
        path.write_text(json.dumps(document), encoding="utf-8")
        yield Path(directory)


class SharedSearchFixtureTests(unittest.TestCase):
    """Every shared fixture must hold against the committed compendium."""

    def test_every_shared_fixture_holds(self):
        for fixture in shared_fixtures():
            filters = SearchFilters.from_record(fixture.filters)
            found = search.find(fixture.query, filters)
            with self.subTest(fixture=fixture.name):
                self.assertEqual({entry["id"] for entry in found}, set(fixture.expected_ids))

    def test_each_required_property_has_its_fixture(self):
        names = {fixture.name for fixture in shared_fixtures()}
        self.assertLessEqual(REQUIRED_FIXTURES, names)

    def test_token_order_fixture_stays_discriminating(self):
        fixture = next(
            item for item in shared_fixtures() if item.name == "tokens_match_independently_of_order"
        )
        every_id = {entry["id"] for entry in search.find("")}
        self.assertEqual(len(fixture.query.split()), 2)
        self.assertTrue(set(fixture.expected_ids) < every_id)

    def test_fixtures_cover_every_filter_dimension(self):
        used = set()
        for fixture in shared_fixtures():
            used.update(fixture.filters)
        self.assertEqual(used, set(fixtures.FILTER_FIELDS))

    def test_fixtures_cover_both_editions_and_a_non_translated_status(self):
        fixtures_used = shared_fixtures()
        editions = {
            fixture.filters["rules_edition"]
            for fixture in fixtures_used
            if "rules_edition" in fixture.filters
        }
        statuses = {
            fixture.filters["translation_status"]
            for fixture in fixtures_used
            if "translation_status" in fixture.filters
        }
        self.assertEqual(editions, set(RULES_EDITIONS))
        self.assertIn("reviewed", statuses)

    def test_verify_fixtures_reports_no_mismatch(self):
        with redirect_stdout(io.StringIO()):
            self.assertEqual(search.verify_fixtures(), 0)

    def test_verify_fixtures_detects_a_drifted_expectation(self):
        drifted = replace(shared_fixtures()[0], expected_ids=())
        message = search.check_fixture(drifted)
        self.assertIsNotNone(message)
        self.assertIn(drifted.name, message)
        self.assertIn("expected", message)

    def test_verify_fixtures_exit_code_and_cli_follow_the_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            content = shutil.copytree(CONTENT_DIR, Path(directory) / "knowledge")
            path = content / fixtures.FIXTURE_FILE
            document = json.loads(path.read_text(encoding="utf-8"))
            document["fixtures"][0]["expected_ids"] = []
            path.write_text(json.dumps(document), encoding="utf-8")
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(search.verify_fixtures(content), 1)
                self.assertEqual(search.main(["--verify-fixtures", "--content", str(content)]), 1)


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

    def test_catalog_record_must_carry_the_verification_state(self):
        document = importer.render_compendium(loader.load_entries())
        first_id = next(iter(document["catalog"]))
        del document["catalog"][first_id]["edition_verification"]
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
