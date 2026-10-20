"""Spanish search and edition filters over the generated compendium."""

from contextlib import contextmanager
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from tools.knowledge import importer, loader, search
from tools.knowledge.search import SearchFilters


@contextmanager
def compendium_content(document):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "compendium.json"
        path.write_text(json.dumps(document), encoding="utf-8")
        yield Path(directory)


class SearchTests(unittest.TestCase):
    def test_spanish_query_ignores_case_and_accents(self):
        self.assertGreaterEqual(len(search.find("fuego", SearchFilters(kind="spell"))), 2)
        self.assertGreaterEqual(len(search.find("FUEGO", SearchFilters(kind="spell"))), 2)
        self.assertGreaterEqual(
            len(search.find("bola de fuego", SearchFilters(kind="spell"))), 2
        )

    def test_edition_filter_separates_2014_and_2024(self):
        old = search.find("fuego", SearchFilters(kind="spell", edition="dnd_2014"))
        new = search.find("fuego", SearchFilters(kind="spell", edition="dnd_2024"))
        self.assertTrue(old)
        self.assertTrue(new)
        self.assertEqual({entry["rules_edition"] for entry in old}, {"dnd_2014"})
        self.assertEqual({entry["rules_edition"] for entry in new}, {"dnd_2024"})

    def test_kind_and_language_filters(self):
        classes = search.find("", SearchFilters(kind="class", language="es"))
        self.assertGreaterEqual(len(classes), 2)
        self.assertEqual({entry["kind"] for entry in classes}, {"class"})

    def test_english_slug_is_findable(self):
        self.assertGreaterEqual(len(search.find("fireball")), 2)

    def test_references_are_returned_with_the_entry(self):
        entry = search.find("fireball", SearchFilters(edition="dnd_2014"))[0]
        targets = {reference["target"] for reference in entry["references"]}
        self.assertIn("dnd_2014:wizard", targets)

    def test_campaign_lore_is_not_in_the_canonical_search(self):
        self.assertEqual(search.find("puerto"), [])

    def test_missing_query_returns_all_canonical_entries(self):
        self.assertGreaterEqual(len(search.find()), 8)

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
