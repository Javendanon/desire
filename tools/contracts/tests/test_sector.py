"""The sector-render contract: consistent with itself, reproduced by its fixture, and enforced."""

import copy
import json
import math
from pathlib import Path
import struct
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sector import artifacts, check_layout, decode, encode, validate_payload

ROOT = Path(__file__).resolve().parents[3]
CONTRACT = json.loads((ROOT / 'contracts/sector-render.json').read_text())
FIXTURE = ROOT / 'crates/core/tests/fixtures/sector-v1.bin'
# The payload first written by hand from the prose spec (commit 71d5eda), kept as an anchor:
# moving the spec into the contract must not change a single byte.
ANCHOR = bytes.fromhex(
    '445345430100030007000000002000440000804400c0ef430000000000000000'
    '0100000002000000200000005000000002000000010000000c00000090000000'
    '03000000000000000c0000009c0000000200030000101644009089440000d040'
    '00001c410000c03f0000e840785a4601030003000080184400a089440000a040'
    '00000041000080be000080405a646e0000202f440008964400004040')


def with_word(data: bytes, offset: int, value: int) -> bytes:
    patched = bytearray(data)
    struct.pack_into('<I', patched, offset, value)
    return bytes(patched)


def with_float(data: bytes, offset: int, value: float) -> bytes:
    patched = bytearray(data)
    struct.pack_into('<f', patched, offset, value)
    return bytes(patched)


class LayoutTests(unittest.TestCase):
    def test_the_contract_is_consistent(self):
        check_layout(CONTRACT)

    def test_overlapping_fields_are_rejected(self):
        broken = copy.deepcopy(CONTRACT)
        broken['sections'][0]['fields'][2]['offset'] = 6
        with self.assertRaisesRegex(ValueError, 'houses.z_m'):
            check_layout(broken)

    def test_a_field_past_its_stride_is_rejected(self):
        broken = copy.deepcopy(CONTRACT)
        broken['sections'][1]['stride'] = 8
        with self.assertRaisesRegex(ValueError, 'berths.heading_radians'):
            check_layout(broken)


class PayloadTests(unittest.TestCase):
    def setUp(self):
        self.example = CONTRACT['example']
        self.payload = encode(CONTRACT, self.example)

    def test_the_example_encodes_to_the_anchor_and_the_fixture(self):
        self.assertEqual(self.payload, ANCHOR)
        self.assertEqual(FIXTURE.read_bytes(), ANCHOR)

    def test_decoding_gives_the_example_back(self):
        self.assertEqual(decode(CONTRACT, self.payload), self.example)

    def test_a_valid_payload_passes(self):
        validate_payload(CONTRACT, self.payload)

    def test_header_violations_are_rejected(self):
        cases = {
            'magic': b'XSEC' + self.payload[4:],
            'version': self.payload[:4] + b'\x02\x00' + self.payload[6:],
            'reserved_0': with_word(self.payload, 24, 1),
            'size_m': with_float(self.payload, 20, -1.0),
            'truncated': self.payload[:20],
        }
        for reason, payload in cases.items():
            with self.subTest(reason), self.assertRaisesRegex(ValueError, reason):
                validate_payload(CONTRACT, payload)

    def test_section_violations_are_rejected(self):
        cases = {
            'houses misaligned': with_word(self.payload, 44, 81),
            'houses stride': with_word(self.payload, 40, 16),
            'berths out of bounds': self.payload[:150],
        }
        for reason, payload in cases.items():
            with self.subTest(reason), self.assertRaisesRegex(ValueError, reason):
                validate_payload(CONTRACT, payload)

    def test_record_violations_are_rejected(self):
        first_house = 80
        cases = {
            'houses[0].width_m': with_float(self.payload, first_house + 12, 0.0),
            'houses[0].x_m': with_float(self.payload, first_house + 4, math.nan),
            'houses[0].flags': self.payload[:first_house + 31] + b'\x82'
            + self.payload[first_house + 32:],
        }
        for reason, payload in cases.items():
            with self.subTest(reason), self.assertRaisesRegex(ValueError, reason):
                validate_payload(CONTRACT, payload)

    def test_unknown_kinds_and_wider_strides_are_accepted(self):
        unknown = with_word(self.payload, 64, 9)
        self.assertEqual(decode(CONTRACT, unknown)['trees'], [])
        validate_payload(CONTRACT, unknown)
        wider = with_word(with_word(self.payload + b'\xaa' * 4, 56, 16), 76, 160)
        validate_payload(CONTRACT, wider)
        self.assertEqual(decode(CONTRACT, wider), self.example)


class GeneratedTests(unittest.TestCase):
    def test_generated_files_are_fresh(self):
        for path, content in artifacts(CONTRACT).items():
            with self.subTest(str(path.relative_to(ROOT))):
                self.assertEqual(path.read_bytes() if path.suffix == '.bin'
                                 else path.read_text(), content)


if __name__ == '__main__':
    unittest.main()
