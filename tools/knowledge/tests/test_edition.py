"""Edition verification: 2024 content must not be presented as verified unexamined."""

from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from tools.knowledge import importer, loader
from tools.knowledge.model import VERIFICATION_STATUSES, VERIFIED
from tools.knowledge.tests import support
from tools.knowledge.tests.support import EntryTarget, mutate_entry

FIREBALL_2024 = EntryTarget("spells.json", "fireball", "dnd_2024")
GREASE_2024 = EntryTarget("spells.json", "grease", "dnd_2024")
PRONE_2024 = EntryTarget("conditions.json", "prone", "dnd_2024")
SCOPE_2024 = (FIREBALL_2024, GREASE_2024, PRONE_2024)


def key(target: EntryTarget) -> str:
    return f"{target.edition}:{target.slug}"


class EditionVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.content = support.copy_content(Path(self.temp.name))

    def tearDown(self):
        self.temp.cleanup()

    def test_every_entry_declares_edition_verification(self):
        for path in sorted((self.content / "canon").glob("*.json")):
            for index, entry in enumerate(support.read(path)["entries"]):
                with self.subTest(source=f"{path.name}[{index}]"):
                    self.assertIn("edition_verification", entry)
                    self.assertIn(
                        entry["edition_verification"]["status"], VERIFICATION_STATUSES
                    )

    def test_scope_entries_are_verified_against_a_citation(self):
        index = loader.build_index(loader.load_entries(self.content))
        for target in SCOPE_2024:
            entry = index[key(target)]
            with self.subTest(entry=entry.key):
                self.assertEqual(entry.edition_verification.status, VERIFIED)
                self.assertIn(entry.source_locator, entry.edition_verification.citation)

    def test_2024_entry_without_verification_is_rejected(self):
        def change(entry):
            entry.pop("edition_verification")

        mutate_entry(self.content, FIREBALL_2024, change)
        with self.assertRaisesRegex(ValueError, "edition_verification: expected object"):
            loader.load_entries(self.content)

    def test_importer_rejects_a_2024_entry_without_verification(self):
        def change(entry):
            entry.pop("edition_verification")

        mutate_entry(self.content, GREASE_2024, change)
        with self.assertRaisesRegex(ValueError, "edition_verification: expected object"):
            importer.sync(self.content)

    def test_2024_entry_may_stay_pending_review(self):
        def change(entry):
            entry["edition_verification"] = {"status": "pending_review", "citation": ""}

        mutate_entry(self.content, FIREBALL_2024, change)
        index = loader.build_index(loader.load_entries(self.content))
        self.assertEqual(index[key(FIREBALL_2024)].edition_verification.status, "pending_review")

    def test_verified_entry_requires_a_citation(self):
        def change(entry):
            entry["edition_verification"] = {"status": VERIFIED, "citation": ""}

        mutate_entry(self.content, GREASE_2024, change)
        with self.assertRaisesRegex(ValueError, "citation"):
            loader.load_entries(self.content)

    def test_verified_citation_must_name_the_registered_document(self):
        def change(entry):
            entry["edition_verification"]["citation"] = entry["source_locator"]

        mutate_entry(self.content, FIREBALL_2024, change)
        with self.assertRaisesRegex(ValueError, "does not name the registered document"):
            loader.load_entries(self.content)

    def test_verified_entry_needs_a_registered_document(self):
        path = self.content / "sources.json"
        document = support.read(path)
        source = next(item for item in document["sources"] if item["id"] == "srd-5.2")
        source.pop("document_sha256")
        support.save(path, document)
        with self.assertRaisesRegex(ValueError, "registered document hash"):
            loader.load_entries(self.content)

    def test_unknown_verification_status_is_rejected(self):
        def change(entry):
            entry["edition_verification"]["status"] = "assumed"

        mutate_entry(self.content, PRONE_2024, change)
        with self.assertRaisesRegex(ValueError, "expected one of"):
            loader.load_entries(self.content)

    def test_catalog_reports_the_verification_state(self):
        entries = loader.load_entries(self.content)
        catalog = importer.render_compendium(entries)["catalog"]
        index = loader.build_index(entries)
        for target in SCOPE_2024:
            entry = index[key(target)]
            with self.subTest(entry=entry.key):
                record = catalog[entry.id]["edition_verification"]
                self.assertEqual(record["status"], VERIFIED)
                self.assertIn(entry.source_locator, record["citation"])


if __name__ == "__main__":
    unittest.main()
