"""Field and shape guards that must fail through the production paths."""

from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from tools.knowledge import campaign, contract, loader
from tools.knowledge.tests import support
from tools.knowledge.tests.support import EntryTarget, mutate_entry

SPELL_2014 = EntryTarget("spells.json", "fireball", "dnd_2014")
SPELL_2024 = EntryTarget("spells.json", "fireball", "dnd_2024")


class CanonGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.content = support.copy_content(Path(self.temp.name))

    def tearDown(self):
        self.temp.cleanup()

    def test_load_entries_rejects_empty_title(self):
        def change(entry):
            entry["title"] = ""

        mutate_entry(self.content, SPELL_2014, change)
        with self.assertRaisesRegex(ValueError, "non-empty string"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_non_string_source_url(self):
        path = self.content / "sources.json"
        document = support.read(path)
        document["sources"][0]["url"] = 5
        support.save(path, document)
        with self.assertRaisesRegex(ValueError, "url: string"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_unknown_translation_status(self):
        def change(entry):
            entry["translation_status"] = "unknown"

        mutate_entry(self.content, SPELL_2014, change)
        with self.assertRaisesRegex(ValueError, "expected one of"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_previous_edition_kind_mismatch(self):
        def change(entry):
            entry["references"].append(
                {"target": "dnd_2014:wizard", "relation": "previous_edition"}
            )

        mutate_entry(self.content, SPELL_2024, change)
        with self.assertRaisesRegex(ValueError, "previous edition kind mismatch"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_non_object_reference(self):
        def change(entry):
            entry["references"][0] = "dnd_2014:wizard"

        mutate_entry(self.content, SPELL_2014, change)
        with self.assertRaisesRegex(ValueError, "expected object"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_non_object_provenance(self):
        def change(entry):
            entry["provenance"] = "SRD 5.1"

        mutate_entry(self.content, SPELL_2014, change)
        with self.assertRaisesRegex(ValueError, "expected object"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_non_array_references(self):
        def change(entry):
            entry["references"] = {}

        mutate_entry(self.content, SPELL_2014, change)
        with self.assertRaisesRegex(ValueError, "expected array"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_non_object_entry(self):
        path, document = support.canon(self.content, "spells.json")
        document["entries"][0] = "spell"
        support.save(path, document)
        with self.assertRaisesRegex(ValueError, "expected object"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_non_object_source(self):
        path = self.content / "sources.json"
        document = support.read(path)
        document["sources"][0] = "srd-5.1"
        support.save(path, document)
        with self.assertRaisesRegex(ValueError, "expected object"):
            loader.load_entries(self.content)

    def test_load_entries_rejects_non_array_entries(self):
        path, document = support.canon(self.content, "spells.json")
        document["entries"] = {}
        support.save(path, document)
        with self.assertRaisesRegex(ValueError, "expected array"):
            loader.load_entries(self.content)


class CampaignGuardTests(unittest.TestCase):
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

    def test_load_campaign_rejects_non_object_package(self):
        support.save(self.content / "campaign/demo-campaign.json", [])
        with self.assertRaisesRegex(ValueError, "campaign: expected object"):
            campaign.load_campaign(self.content)

    def test_load_campaign_rejects_non_object_provenance(self):
        def change(package):
            package["knowledge"][0]["provenance"] = "SRD 5.1"

        self.mutate_campaign(change)
        with self.assertRaisesRegex(ValueError, "expected object"):
            campaign.load_campaign(self.content)

    def test_load_campaign_rejects_unknown_visibility(self):
        def change(package):
            package["knowledge"][0]["visibility"] = "secret"

        self.mutate_campaign(change)
        with self.assertRaisesRegex(ValueError, "expected players or dm"):
            campaign.load_campaign(self.content)

    def test_contract_rejects_non_object_package(self):
        with self.assertRaisesRegex(ValueError, "campaign: expected object"):
            contract.validate_campaign([])

    def test_contract_rejects_non_array_knowledge(self):
        package = {"campaign": {}, "knowledge": {}, "secrets": []}
        with self.assertRaisesRegex(ValueError, "campaign.knowledge: expected array"):
            contract.validate_campaign(package)


if __name__ == "__main__":
    unittest.main()
