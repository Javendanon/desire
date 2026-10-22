"""Validate the expanded tabletop boundary while preserving every v1 fixture."""
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate import validate
from generate import type_name

ROOT = Path(__file__).resolve().parents[3]


class TabletopTests(unittest.TestCase):
    def setUp(self):
        self.definitions = json.loads((ROOT / 'contracts/schema.json').read_text())['$defs']
        self.examples = json.loads((ROOT / 'contracts/tabletop-examples.json').read_text())

    def check(self, kind, value):
        validate(value, {'$ref': '#/$defs/' + kind, '$defs': self.definitions})

    def test_every_tabletop_example_matches_its_closed_contract(self):
        for kind, records in self.examples.items():
            for record in records:
                self.check(kind, record)

    def test_hit_points_and_resources_cannot_be_negative(self):
        for kind, field in [('ActorState', 'current_hp'), ('ActorResource', 'remaining')]:
            record = copy.deepcopy(self.examples[kind][0])
            record[field] = -1
            with self.assertRaises(ValueError):
                self.check(kind, record)

    def test_prepared_and_equipped_require_booleans(self):
        for kind, field in [('CharacterSpell', 'prepared'), ('CharacterEquipment', 'equipped')]:
            record = copy.deepcopy(self.examples[kind][0])
            record[field] = 'false'
            with self.assertRaises(ValueError):
                self.check(kind, record)

    def test_initiative_accepts_negative_values_and_generates_signed_rust(self):
        record = copy.deepcopy(self.examples['EncounterParticipant'][0])
        record['initiative'] = -2
        self.check('EncounterParticipant', record)
        self.assertEqual(type_name(self.definitions['SignedInteger'], 'rs'), 'i32')

    def test_ability_scores_reject_missing_unknown_or_out_of_range_fields(self):
        baseline = self.examples['ActorStats'][0]['abilities']
        for value in [dict(baseline, strength=0), dict(baseline, extra=10), {}]:
            with self.assertRaises(ValueError):
                self.check('AbilityScores', value)

    def test_group_travel_requires_v2_and_explicit_participants(self):
        record = copy.deepcopy(self.examples['GroupTravel'][0])
        record['protocol_version'] = 1
        with self.assertRaises(ValueError):
            self.check('GroupTravel', record)
        del record['protocol_version']
        with self.assertRaises(ValueError):
            self.check('GroupTravel', record)

    def test_player_resident_projection_rejects_hidden_actor_details(self):
        record = copy.deepcopy(self.examples['PlayerResident'][0])
        record['current_hp'] = 2
        with self.assertRaises(ValueError):
            self.check('PlayerResident', record)

    def test_group_travel_rejects_empty_or_duplicate_participants(self):
        for participants in [[], [self.examples['Actor'][0]['id']] * 2]:
            record = copy.deepcopy(self.examples['GroupTravel'][0])
            record['participants'] = participants
            with self.assertRaises(ValueError):
                self.check('GroupTravel', record)
