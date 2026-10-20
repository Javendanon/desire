"""Isolation and coherence of the two-campaign examples."""

import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from examples import check_examples

ROOT = Path(__file__).resolve().parents[3]


class ExampleTests(unittest.TestCase):
    def setUp(self):
        self.schema = json.loads((ROOT / 'contracts/schema.json').read_text())
        self.fixture = json.loads((ROOT / 'contracts/examples.json').read_text())

    def test_fixture_links_are_coherent(self):
        check_examples(self.fixture, self.schema)

    def test_place_anchor_requires_an_existing_map(self):
        anchor = self.fixture['places'][0]['anchors'][0]
        anchor['map_version_id'] = '00000000-0000-4000-8000-000000000999'
        with self.assertRaisesRegex(ValueError, 'anchors.map_version_id: missing reference'):
            check_examples(self.fixture, self.schema)

    def test_place_anchor_map_must_belong_to_the_place_city(self):
        anchor = self.fixture['places'][0]['anchors'][0]
        anchor['map_version_id'] = self.fixture['maps'][1]['id']
        with self.assertRaisesRegex(ValueError, 'anchors.map_version_id: map city mismatch'):
            check_examples(self.fixture, self.schema)

    def test_place_anchor_needs_a_calibrated_map(self):
        self.fixture['maps'][0]['calibration'] = None
        with self.assertRaisesRegex(ValueError, 'anchors.map_version_id: map is not calibrated'):
            check_examples(self.fixture, self.schema)

    def test_missing_reference_is_rejected(self):
        self.fixture['cities'] = []
        with self.assertRaisesRegex(ValueError, 'missing reference'):
            check_examples(self.fixture, self.schema)

    def test_duplicate_identity_is_rejected(self):
        self.fixture['places'][0]['id'] = self.fixture['cities'][0]['id']
        with self.assertRaisesRegex(ValueError, 'duplicate id'):
            check_examples(self.fixture, self.schema)

    def test_travel_cannot_reference_another_campaign_scene(self):
        self.fixture['travels'][0]['scene_id'] = self.fixture['scenes'][1]['id']
        with self.assertRaisesRegex(ValueError, 'cross-campaign'):
            check_examples(self.fixture, self.schema)

    def test_character_cannot_use_another_rules_edition(self):
        self.fixture['characters'][0]['rules_edition'] = 'dnd_2024'
        with self.assertRaisesRegex(ValueError, 'rules edition mismatch'):
            check_examples(self.fixture, self.schema)

    def test_player_snapshot_cannot_mix_campaigns(self):
        self.fixture['snapshots'][0]['scenes'].append(self.fixture['scenes'][1])
        with self.assertRaisesRegex(ValueError, 'cross-campaign'):
            check_examples(self.fixture, self.schema)

    def test_travel_event_cannot_mix_campaigns(self):
        other_campaign = self.fixture['campaigns'][1]['id']
        self.fixture['travel_events'][0]['travel']['campaign_id'] = other_campaign
        with self.assertRaisesRegex(ValueError, 'cross-campaign'):
            check_examples(self.fixture, self.schema)

    def test_snapshot_character_must_match_campaign_edition(self):
        self.fixture['snapshots'][0]['characters'][0]['rules_edition'] = 'dnd_2024'
        with self.assertRaisesRegex(ValueError, 'rules edition mismatch'):
            check_examples(self.fixture, self.schema)

    def test_snapshot_journal_requires_existing_session(self):
        self.fixture['snapshots'][0]['journal'][0]['session_id'] = (
            '00000000-0000-4000-8000-000000000999')
        with self.assertRaisesRegex(ValueError, 'missing reference'):
            check_examples(self.fixture, self.schema)

    def test_snapshot_cannot_publish_dm_text(self):
        self.fixture['journal'][0]['visibility'] = 'dm'
        with self.assertRaisesRegex(ValueError, 'private entry'):
            check_examples(self.fixture, self.schema)

    def test_public_entries_reject_visibility_field(self):
        self.fixture['snapshots'][0]['journal'][0]['visibility'] = 'dm'
        with self.assertRaisesRegex(ValueError, 'visibility'):
            check_examples(self.fixture, self.schema)


if __name__ == '__main__':
    unittest.main()
