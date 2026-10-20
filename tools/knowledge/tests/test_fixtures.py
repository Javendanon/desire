"""Shape guards for the shared search fixture file that D09 and D15 consume."""

import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from tools.knowledge import fixtures

VALID_FIXTURE = {
    "name": "valid_fixture",
    "query": "",
    "filters": {"kind": "spell"},
    "expected_ids": ["140fec29-95f8-5b36-8ed5-f58d6f40e190"],
}
SEMANTICS = {key: "documented rule" for key in fixtures.SEMANTIC_KEYS}


def document(fixtures_list=None) -> dict:
    return {
        "schema_version": fixtures.SCHEMA_VERSION,
        "semantics": dict(SEMANTICS),
        "fixtures": [VALID_FIXTURE] if fixtures_list is None else fixtures_list,
    }


class FixtureFileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.content = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, payload) -> None:
        path = self.content / fixtures.FIXTURE_FILE
        path.write_text(json.dumps(payload), encoding="utf-8")

    def assert_rejected(self, payload, pattern: str) -> None:
        self.write(payload)
        with self.assertRaisesRegex(ValueError, pattern):
            fixtures.load_fixtures(self.content)

    def test_valid_document_is_loaded(self):
        self.write(document())
        loaded = fixtures.load_fixtures(self.content)
        self.assertEqual(loaded[0].name, VALID_FIXTURE["name"])
        self.assertEqual(loaded[0].filters, VALID_FIXTURE["filters"])

    def test_missing_file_is_reported(self):
        with self.assertRaisesRegex(ValueError, "missing file"):
            fixtures.load_fixtures(self.content)

    def test_schema_version_must_match(self):
        payload = {**document(), "schema_version": 2}
        self.assert_rejected(payload, "schema_version")

    def test_schema_version_must_be_an_integer(self):
        payload = {**document(), "schema_version": True}
        self.assert_rejected(payload, "schema_version")

    def test_unknown_kind_value_is_rejected(self):
        payload = document([{**VALID_FIXTURE, "filters": {"kind": "spelll"}}])
        self.assert_rejected(payload, "filters.kind: expected one of")

    def test_unknown_translation_status_value_is_rejected(self):
        payload = document([{**VALID_FIXTURE, "filters": {"translation_status": "translatedd"}}])
        self.assert_rejected(payload, "filters.translation_status: expected one of")

    def test_language_values_stay_open(self):
        self.write(document([{**VALID_FIXTURE, "filters": {"language": "en"}}]))
        self.assertEqual(fixtures.load_fixtures(self.content)[0].filters, {"language": "en"})

    def test_missing_name_is_rejected(self):
        payload = {key: value for key, value in VALID_FIXTURE.items() if key != "name"}
        self.assert_rejected(document([payload]), "name: non-empty string")

    def test_semantics_block_is_required(self):
        payload = {key: value for key, value in document().items() if key != "semantics"}
        self.assert_rejected(payload, "semantics: expected object")

    def test_missing_semantic_key_is_rejected(self):
        semantics = {key: value for key, value in SEMANTICS.items() if key != "haystack"}
        self.assert_rejected({**document(), "semantics": semantics}, "semantics.haystack")

    def test_empty_fixture_list_is_rejected(self):
        self.assert_rejected(document([]), "non-empty array")

    def test_unknown_filter_is_rejected(self):
        payload = document([{**VALID_FIXTURE, "filters": {"edition": "dnd_2014"}}])
        self.assert_rejected(payload, "unknown filter")

    def test_non_string_filter_value_is_rejected(self):
        payload = document([{**VALID_FIXTURE, "filters": {"kind": 5}}])
        self.assert_rejected(payload, "filters.kind: string")

    def test_duplicate_fixture_name_is_rejected(self):
        self.assert_rejected(document([VALID_FIXTURE, dict(VALID_FIXTURE)]), "duplicate name")

    def test_invalid_expected_id_is_rejected(self):
        payload = document([{**VALID_FIXTURE, "expected_ids": ["not-a-uuid"]}])
        self.assert_rejected(payload, "invalid UUID")

    def test_duplicate_expected_id_is_rejected(self):
        repeated = [VALID_FIXTURE["expected_ids"][0]] * 2
        payload = document([{**VALID_FIXTURE, "expected_ids": repeated}])
        self.assert_rejected(payload, "duplicate id")

    def test_missing_query_is_rejected(self):
        payload = {**VALID_FIXTURE}
        del payload["query"]
        self.assert_rejected(document([payload]), "query: string")


if __name__ == "__main__":
    unittest.main()
