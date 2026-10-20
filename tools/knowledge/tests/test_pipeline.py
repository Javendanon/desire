"""End-to-end rejection tests through the production load/import paths."""

from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from tools.knowledge import campaign, importer, loader
from tools.knowledge.tests import support
from tools.knowledge.tests.support import EntryTarget, mutate_entry

SPELL_2014 = EntryTarget("spells.json", "fireball", "dnd_2014")
SPELL_2024 = EntryTarget("spells.json", "fireball", "dnd_2024")


class CanonPipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.content = support.copy_content(Path(self.temp.name))

    def tearDown(self):
        self.temp.cleanup()

    def test_load_entries_rejects_unknown_source(self):
        def change(entry):
            entry["source_id"] = "unknown-source"

        mutate_entry(self.content, SPELL_2014, change)
        with self.assertRaisesRegex(ValueError, "unknown source"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_source_edition_mismatch(self):
        def change(entry):
            entry["source_id"] = "srd-5.2"

        mutate_entry(self.content, SPELL_2014, change)
        with self.assertRaisesRegex(ValueError, "source edition mismatch"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_license_mismatch(self):
        def change(entry):
            entry["license"] = "CC-BY-NC-4.0"

        mutate_entry(self.content, SPELL_2014, change)
        with self.assertRaisesRegex(ValueError, "license mismatch"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_dangling_reference(self):
        def change(entry):
            entry["references"][0]["target"] = "dnd_2014:missing"

        mutate_entry(self.content, SPELL_2014, change)
        with self.assertRaisesRegex(ValueError, "missing reference"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_illegal_relation(self):
        def change(entry):
            entry["references"][0]["relation"] = "applies_condition"

        mutate_entry(self.content, SPELL_2014, change)
        with self.assertRaisesRegex(ValueError, "invalid applies_condition relation"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_previous_edition_from_old_source(self):
        def change(entry):
            entry["references"].append(
                {"target": "dnd_2014:prone", "relation": "previous_edition"}
            )

        mutate_entry(self.content, SPELL_2014, change)
        with self.assertRaisesRegex(ValueError, "previous edition needs dnd_2024"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_previous_edition_to_new_target(self):
        def change(entry):
            entry["references"].append(
                {"target": "dnd_2024:prone", "relation": "previous_edition"}
            )

        mutate_entry(self.content, SPELL_2024, change)
        with self.assertRaisesRegex(ValueError, "previous edition needs dnd_2014"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_duplicate_id(self):
        _, classes = support.canon(self.content, "classes.json")
        duplicate = support.entry(classes, "wizard", "dnd_2014")["id"]

        def change(entry):
            entry["id"] = duplicate

        mutate_entry(self.content, SPELL_2014, change)
        with self.assertRaisesRegex(ValueError, "duplicate id"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_duplicate_reference_target(self):
        def change(entry):
            entry["references"].append(dict(entry["references"][0]))

        mutate_entry(self.content, SPELL_2014, change)
        with self.assertRaisesRegex(ValueError, "duplicate reference target"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_malformed_canon_document(self):
        path = self.content / "canon/spells.json"
        path.write_text("[]", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "expected object"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_wrong_canon_kind(self):
        path, document = support.canon(self.content, "spells.json")
        document["kind"] = "class"
        support.save(path, document)
        with self.assertRaisesRegex(ValueError, "expected class, got spell"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_invalid_slug(self):
        def change(entry):
            entry["slug"] = "Fire Ball"

        mutate_entry(self.content, SPELL_2014, change)
        with self.assertRaisesRegex(ValueError, "invalid slug"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_invalid_uuid(self):
        def change(entry):
            entry["id"] = "not-a-uuid"

        mutate_entry(self.content, SPELL_2014, change)
        with self.assertRaisesRegex(ValueError, "invalid UUID"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_non_positive_revision(self):
        def change(entry):
            entry["revision"] = 0

        mutate_entry(self.content, SPELL_2014, change)
        with self.assertRaisesRegex(ValueError, "positive integer"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_invalid_json(self):
        path = self.content / "canon/spells.json"
        path.write_text("{", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "invalid JSON"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_missing_sources_file(self):
        (self.content / "sources.json").unlink()
        with self.assertRaisesRegex(ValueError, "missing file"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_sources_object_shape(self):
        support.save(self.content / "sources.json", [])
        with self.assertRaisesRegex(ValueError, "sources: expected object"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_sources_array_shape(self):
        support.save(self.content / "sources.json", {"sources": {}})
        with self.assertRaisesRegex(ValueError, "sources: expected array"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_duplicate_source_id(self):
        path = self.content / "sources.json"
        document = support.read(path)
        document["sources"].append(dict(document["sources"][0]))
        support.save(path, document)
        with self.assertRaisesRegex(ValueError, "duplicate source"):
            loader.load_entries(self.content)


class CampaignPipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.content = support.copy_content(Path(self.temp.name))

    def tearDown(self):
        self.temp.cleanup()

    def mutate_campaign(self, change) -> None:
        path = self.content / "campaign/demo-campaign.json"
        package = support.read(path)
        change(package)
        support.save(path, package)

    def test_load_campaign_rejects_contract_invalid_record(self):
        def change(package):
            package["knowledge"][0]["unknown"] = True

        self.mutate_campaign(change)
        with self.assertRaisesRegex(ValueError, "unknown"):
            campaign.load_campaign(self.content)

    def test_load_campaign_rejects_non_dm_secret(self):
        def change(package):
            package["secrets"][0]["visibility"] = "players"

        self.mutate_campaign(change)
        with self.assertRaisesRegex(ValueError, "secrets are DM-only"):
            campaign.load_campaign(self.content)

    def test_load_campaign_rejects_non_synthetic_lore(self):
        def change(package):
            package["knowledge"][0]["provenance"]["evidence"] = "verified"

        self.mutate_campaign(change)
        with self.assertRaisesRegex(ValueError, "demo must be synthetic"):
            campaign.load_campaign(self.content)

    def test_load_campaign_rejects_non_array_knowledge(self):
        def change(package):
            package["knowledge"] = {"unexpected": True}

        self.mutate_campaign(change)
        with self.assertRaisesRegex(ValueError, "campaign.knowledge: expected array"):
            campaign.load_campaign(self.content)

    def test_load_campaign_rejects_non_array_secrets(self):
        def change(package):
            package["secrets"] = {"unexpected": True}

        self.mutate_campaign(change)
        with self.assertRaisesRegex(ValueError, "campaign.secrets: expected array"):
            campaign.load_campaign(self.content)

    def test_load_campaign_wires_d04_validation(self):
        with mock.patch(
            "tools.knowledge.contract.validate_campaign",
            side_effect=ValueError("contract rejected"),
        ):
            with self.assertRaisesRegex(ValueError, "contract rejected"):
                campaign.load_campaign()

    def test_importer_main_rejects_invalid_campaign(self):
        def change(package):
            package["secrets"][0]["visibility"] = "players"

        self.mutate_campaign(change)
        with mock.patch("sys.stdout"), mock.patch("sys.stderr"):
            exit_code = importer.main(["--content", str(self.content)])
        self.assertEqual(exit_code, 1)


class ImporterPipelineTests(unittest.TestCase):
    def test_sync_rejects_synthetic_canon_provenance_without_overwriting_compendium(self):
        def change(entry):
            entry["provenance"]["evidence"] = "synthetic"

        for target in (SPELL_2014, SPELL_2024):
            with self.subTest(edition=target.edition), tempfile.TemporaryDirectory() as directory:
                content = support.copy_content(Path(directory))
                path = content / "compendium.json"
                original = path.read_bytes()
                mutate_entry(content, target, change)
                with self.assertRaisesRegex(ValueError, "synthetic provenance cannot be canon"):
                    importer.sync(content)
                self.assertEqual(path.read_bytes(), original)

    def test_render_compendium_wires_d04_validation(self):
        entries = loader.load_entries()
        with mock.patch(
            "tools.knowledge.contract.validate_knowledge_entries",
            side_effect=ValueError("contract rejected"),
        ):
            with self.assertRaisesRegex(ValueError, "contract rejected"):
                importer.render_compendium(entries)


if __name__ == "__main__":
    unittest.main()
