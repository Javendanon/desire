"""Regressions for the shared boundary and the generated artifacts."""

import copy
import json
from pathlib import Path
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate import validate

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = ROOT / 'contracts/schema.json'


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.schema = json.loads(SCHEMA.read_text())
        self.fixture = json.loads((ROOT / 'contracts/examples.json').read_text())

    def test_examples_match_the_contract(self):
        validate(self.fixture, self.schema)

    def test_unknown_field_is_rejected(self):
        self.fixture['campaigns'][0]['dm_secret'] = 'hidden'
        with self.assertRaisesRegex(ValueError, 'dm_secret'):
            validate(self.fixture, self.schema)

    def test_rules_editions_cannot_be_mixed(self):
        self.fixture['campaigns'][0]['rules_edition'] = 'dnd_2025'
        with self.assertRaisesRegex(ValueError, 'rules_edition'):
            validate(self.fixture, self.schema)

    def test_invalid_uuid_is_rejected(self):
        self.fixture['campaigns'][0]['id'] = 'campaign-a'
        with self.assertRaisesRegex(ValueError, 'id'):
            validate(self.fixture, self.schema)

    def test_revision_overflow_is_rejected(self):
        self.fixture['campaigns'][0]['revision'] = 2 ** 32
        with self.assertRaisesRegex(ValueError, 'revision'):
            validate(self.fixture, self.schema)

    def test_booleans_are_not_integer_revisions(self):
        self.fixture['campaigns'][0]['revision'] = True
        with self.assertRaisesRegex(ValueError, 'revision'):
            validate(self.fixture, self.schema)

    def test_required_nullable_field_cannot_be_omitted(self):
        del self.fixture['places'][0]['district_id']
        with self.assertRaisesRegex(ValueError, 'district_id'):
            validate(self.fixture, self.schema)

    def test_nonfinite_coordinates_are_rejected(self):
        self.fixture['maps'][0]['calibration']['meters_per_pixel'] = float('nan')
        with self.assertRaisesRegex(ValueError, 'meters_per_pixel'):
            validate(self.fixture, self.schema)

    def test_dm_fields_do_not_fit_player_snapshot(self):
        snapshot = copy.deepcopy(self.fixture['snapshots'][0])
        snapshot['secrets'] = []
        definition = {'$ref': '#/$defs/PlayerSnapshot', '$defs': self.schema['$defs']}
        with self.assertRaisesRegex(ValueError, 'secrets'):
            validate(snapshot, definition)

    def test_unknown_protocol_version_is_rejected(self):
        self.fixture['scene_events'][0]['protocol_version'] = 2
        with self.assertRaisesRegex(ValueError, 'protocol_version'):
            validate(self.fixture, self.schema)

    def test_negative_travel_duration_is_rejected(self):
        self.fixture['travels'][0]['narrative_seconds'] = -1
        with self.assertRaisesRegex(ValueError, 'narrative_seconds'):
            validate(self.fixture, self.schema)

    def test_wrong_event_kind_is_rejected(self):
        self.fixture['scene_events'][0]['kind'] = 'travel_updated'
        with self.assertRaisesRegex(ValueError, 'kind'):
            validate(self.fixture, self.schema)

    def test_generated_files_are_current(self):
        subprocess.run([sys.executable, 'tools/contracts/generate.py', '--check'],
                       cwd=ROOT, check=True)


if __name__ == '__main__':
    unittest.main()
