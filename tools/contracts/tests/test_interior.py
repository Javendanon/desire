"""Validate the authored interior floor plans and the prop catalogue against the contract."""
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate import validate

ROOT = Path(__file__).resolve().parents[3]
PLAN = ROOT / 'content/maps/waterdeep/trollskull/floor-plan.json'
CATALOG = ROOT / 'content/props/catalog.json'


class InteriorContractTests(unittest.TestCase):
    def setUp(self):
        self.definitions = json.loads((ROOT / 'contracts/schema.json').read_text())['$defs']
        self.plan = json.loads(PLAN.read_text())
        self.catalog = json.loads(CATALOG.read_text())

    def check(self, kind, value):
        validate(value, {'$ref': '#/$defs/' + kind, '$defs': self.definitions})

    def test_trollskull_plan_and_catalogue_match_their_contracts(self):
        self.check('FloorPlan', self.plan)
        self.check('PropCatalog', self.catalog)

    def test_furniture_rotates_only_in_quarter_turns(self):
        plan = copy.deepcopy(self.plan)
        plan['floors'][1]['furniture'][0]['rotation'] = 45
        with self.assertRaises(ValueError):
            self.check('FloorPlan', plan)

    def test_rooms_need_at_least_one_rectangle(self):
        plan = copy.deepcopy(self.plan)
        plan['floors'][1]['rooms'][0]['cells'] = []
        with self.assertRaises(ValueError):
            self.check('FloorPlan', plan)


if __name__ == '__main__':
    unittest.main()
