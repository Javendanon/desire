"""Campaign visibility, synthesis and D04 rejection tests."""

from copy import deepcopy
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from tools.knowledge import campaign, contract, loader


class CampaignTests(unittest.TestCase):
    def setUp(self):
        self.package = campaign.load_campaign()

    def test_campaign_records_pass_the_d04_contract(self):
        campaign.validate_campaign(self.package)

    def test_invalid_d04_projection_is_rejected(self):
        record = loader.load_entries()[0].contract()
        record["kind"] = "spell"
        with self.assertRaisesRegex(ValueError, "unknown"):
            contract.validate_knowledge_entries([record])

    def test_missing_campaign_section_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "campaign.campaign: missing"):
            contract.validate_campaign({})

    def test_every_lore_record_has_explicit_visibility(self):
        visibilities = {record["visibility"] for record in self.package["knowledge"]}
        self.assertEqual(visibilities, {"players", "dm"})

    def test_every_secret_is_explicitly_dm_only(self):
        for secret in self.package["secrets"]:
            self.assertEqual(secret["visibility"], "dm")

    def test_non_dm_secret_is_rejected(self):
        package = deepcopy(self.package)
        package["secrets"][0]["visibility"] = "players"
        with self.assertRaisesRegex(ValueError, "secrets are DM-only"):
            campaign.validate_campaign(package)

    def test_demo_lore_is_synthetic(self):
        records = [*self.package["knowledge"], *self.package["secrets"]]
        self.assertTrue(all(record["provenance"]["evidence"] == "synthetic" for record in records))
        self.assertIn("synthetic", self.package["notice"].lower())

    def test_non_synthetic_campaign_record_is_rejected(self):
        package = deepcopy(self.package)
        package["knowledge"][0]["provenance"]["evidence"] = "verified"
        with self.assertRaisesRegex(ValueError, "demo must be synthetic"):
            campaign.validate_campaign(package)

    def test_campaign_id_mismatch_is_rejected(self):
        package = deepcopy(self.package)
        package["knowledge"][0]["campaign_id"] = "00000000-0000-4000-8000-000000000099"
        with self.assertRaisesRegex(ValueError, "campaign mismatch"):
            campaign.validate_campaign(package)

    def test_duplicate_campaign_id_is_rejected(self):
        package = deepcopy(self.package)
        package["secrets"][0]["id"] = package["knowledge"][0]["id"]
        with self.assertRaisesRegex(ValueError, "duplicate id"):
            campaign.validate_campaign(package)

    def test_notice_must_declare_the_demo_synthetic(self):
        package = deepcopy(self.package)
        package["notice"] = "Real campaign lore"
        with self.assertRaisesRegex(ValueError, "must mark the demo as synthetic"):
            campaign.validate_campaign(package)


if __name__ == "__main__":
    unittest.main()
