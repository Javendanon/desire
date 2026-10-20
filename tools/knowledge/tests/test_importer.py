"""RED tests for the D07 canonical compendium import."""

from dataclasses import replace
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from tools.knowledge import campaign, contract, importer, loader, search  # noqa: E402
from tools.knowledge.model import CONTENT_DIR, Provenance, Reference, Source  # noqa: E402
from tools.knowledge.search import SearchFilters  # noqa: E402


class ImporterTests(unittest.TestCase):
    def test_committed_compendium_is_current(self):
        self.assertTrue(importer.is_current())

    def test_render_is_deterministic(self):
        entries = loader.load_entries()
        ordered = importer.render_compendium(entries)
        reordered = importer.render_compendium(list(reversed(entries)))
        self.assertEqual(ordered, reordered)

    def test_sync_is_idempotent_on_disk(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "knowledge"
            shutil.copytree(CONTENT_DIR, target)
            (target / "compendium.json").unlink()
            self.assertFalse(importer.sync(target))
            first = (target / "compendium.json").read_bytes()
            self.assertTrue(importer.sync(target))
            self.assertEqual(first, (target / "compendium.json").read_bytes())

    def test_import_and_search_use_no_network(self):
        with mock.patch("socket.socket", side_effect=AssertionError("network used")):
            self.assertTrue(importer.is_current())
            self.assertGreaterEqual(len(search.find("fuego", SearchFilters(kind="spell"))), 2)

    def test_compendium_entries_match_d04(self):
        entries = loader.load_entries()
        document = importer.render_compendium(entries)
        contract.validate_knowledge_entries(document["knowledge_entries"])

    def test_duplicate_edition_slug_is_rejected(self):
        entries = loader.load_entries()
        spell = next(entry for entry in entries if entry.kind == "spell")
        duplicate = replace(spell, id="00000000-0000-4000-8000-000000000099")
        with self.assertRaisesRegex(ValueError, "duplicate edition slug"):
            loader.build_index([spell, duplicate])

    def test_duplicate_identity_is_rejected(self):
        entries = loader.load_entries()
        first, second = entries[0], entries[1]
        duplicate = replace(second, id=first.id)
        with self.assertRaisesRegex(ValueError, "duplicate id"):
            loader.build_index([first, duplicate])

    def test_dangling_reference_is_rejected(self):
        entries = loader.load_entries()
        linked = next(entry for entry in entries if entry.references)
        original = linked.references[0]
        broken = replace(
            linked,
            references=(contract_reference("dnd_2014:missing-entry", original.relation),),
        )
        with self.assertRaisesRegex(ValueError, "missing reference"):
            loader.check_references([broken])

    def test_unknown_source_is_rejected(self):
        entries = loader.load_entries()
        broken = replace(entries[0], source_id="unknown-source")
        with self.assertRaisesRegex(ValueError, "unknown source"):
            loader.check_sources([broken], loader.load_sources())

    def test_source_license_must_match_entry(self):
        entries = loader.load_entries()
        broken = replace(entries[0], license="CC-BY-NC-4.0")
        with self.assertRaisesRegex(ValueError, "license mismatch"):
            loader.check_sources([broken], loader.load_sources())

    def test_provenance_source_must_match_registry(self):
        entries = loader.load_entries()
        provenance = Provenance("Other source", "Other attribution", "interpretation")
        broken = replace(entries[0], provenance=provenance)
        with self.assertRaisesRegex(ValueError, "provenance source mismatch"):
            loader.check_sources([broken], loader.load_sources())

    def test_synthetic_canon_source_is_rejected(self):
        entries = loader.load_entries()
        entry = entries[0]
        source = Source(
            id="synthetic-source",
            name=entry.provenance.source,
            rules_edition=entry.rules_edition,
            license="synthetic",
            license_url="",
            url="",
        )
        broken = replace(entry, source_id=source.id, license=source.license)
        with self.assertRaisesRegex(ValueError, "synthetic source cannot be canon"):
            loader.check_sources([broken], {source.id: source})

    def test_duplicate_reference_target_is_rejected(self):
        raw = [
            {"target": "dnd_2014:wizard", "relation": "available_to_class"},
            {"target": "dnd_2014:wizard", "relation": "available_to_class"},
        ]
        with self.assertRaisesRegex(ValueError, "duplicate reference target"):
            loader.parse_references(raw, "test.references")

    def test_self_reference_is_rejected(self):
        entries = loader.load_entries()
        entry = next(item for item in entries if item.kind == "spell")
        with self.assertRaisesRegex(ValueError, "self reference"):
            loader.check_relation(entry, entry, "available_to_class")

    def test_illegal_relation_is_rejected(self):
        entries = loader.load_entries()
        spell = next(item for item in entries if item.kind == "spell")
        condition = next(item for item in entries if item.kind == "condition")
        with self.assertRaisesRegex(ValueError, "invalid available_to_class relation"):
            loader.check_relation(spell, condition, "available_to_class")

    def test_cross_edition_reference_is_rejected(self):
        entries = loader.load_entries()
        old_spell = next(
            item for item in entries if item.kind == "spell" and item.key == "dnd_2014:fireball"
        )
        new_class = next(
            item for item in entries if item.kind == "class" and item.key == "dnd_2024:wizard"
        )
        with self.assertRaisesRegex(ValueError, "cross-edition reference"):
            loader.check_relation(old_spell, new_class, "available_to_class")

    def test_campaign_is_separate_from_canon(self):
        package = campaign.load_campaign()
        campaign.validate_campaign(package)
        canon_ids = {entry.id for entry in loader.load_entries()}
        campaign_ids = {record["id"] for record in package["knowledge"]}
        self.assertFalse(campaign_ids & canon_ids)


def contract_reference(target: str, relation: str):
    return Reference(target=target, relation=relation)


if __name__ == "__main__":
    unittest.main()
