"""desire.sector-render/1 payloads read and written from the contract's layout: checking the
layout itself, encoding, decoding and validating. Pure: bytes in, data out."""

from dataclasses import dataclass
import math
import struct
from typing import Any, Callable

Record = dict[str, Any]
# Header fields that describe the file itself rather than the sector.
STRUCTURE = ('magic', 'version', 'section_count')


# --- Field types: one codec per type ------------------------------------------------------

@dataclass(frozen=True)
class Codec:
    """How one field type sits in the bytes: struct code, size and natural alignment."""
    code: str
    size: int
    align: int
    to_bytes: Callable[[Any], tuple] = lambda value: (value,)
    from_bytes: Callable[[tuple], Any] = lambda values: values[0]

    def pack(self, buffer: bytearray, at: int, value: Any) -> None:
        struct.pack_into('<' + self.code, buffer, at, *self.to_bytes(value))

    def unpack(self, data: bytes, at: int) -> Any:
        return self.from_bytes(struct.unpack_from('<' + self.code, data, at))


CODECS = {
    'u8': Codec('B', 1, 1),
    'u16': Codec('H', 2, 2),
    'u32': Codec('I', 4, 4),
    'f32': Codec('f', 4, 4),
    'ascii4': Codec('4s', 4, 1, lambda text: (text.encode('ascii'),),
                    lambda values: values[0].decode('ascii', errors='replace')),
    'rgb8': Codec('3B', 3, 1, tuple, list),
}


def codec(field: Record) -> Codec:
    return CODECS[field['type']]


def read_fields(fields: list[Record], data: bytes, base: int) -> Record:
    return {field['name']: codec(field).unpack(data, base + field['offset']) for field in fields}


def write_fields(fields: list[Record], values: Record, target: tuple[bytearray, int]) -> None:
    buffer, base = target
    for field in fields:
        codec(field).pack(buffer, base + field['offset'], values.get(field['name'], 0))


# --- Layout -------------------------------------------------------------------------------

def check_fields(name: str, fields: list[Record], size: int) -> None:
    """Fields lie inside `size`, on their natural alignment, without overlapping."""
    end = 0
    for field in sorted(fields, key=lambda item: item['offset']):
        label = f"{name}.{field['name']}"
        if field['offset'] % codec(field).align:
            raise ValueError(f'{label}: offset {field["offset"]} not {codec(field).align}-aligned')
        if field['offset'] < end:
            raise ValueError(f'{label}: overlaps the previous field')
        end = field['offset'] + codec(field).size
        if end > size:
            raise ValueError(f'{label}: ends at {end}, past {size}')


def check_layout(contract: Record) -> None:
    """Raises ValueError naming the first inconsistent part of the contract."""
    check_fields('header', contract['header']['fields'], contract['header']['size'])
    check_fields('entry', contract['section_entry']['fields'], contract['section_entry']['size'])
    kinds = [section['kind'] for section in contract['sections']]
    if kinds != sorted(set(kinds)):
        raise ValueError('sections: kinds must be unique and ascending')
    for section in contract['sections']:
        if section['stride'] % contract['alignment']:
            raise ValueError(f"{section['name']}: stride not {contract['alignment']}-aligned")
        check_fields(section['name'], section['fields'], section['stride'])


# --- Encoding -----------------------------------------------------------------------------

def layout_of(contract: Record, sector: Record) -> list[Record]:
    """Section table entries in kind order, offsets after the header and the table."""
    table = len(contract['sections']) * contract['section_entry']['size']
    offset = contract['header']['size'] + table
    entries = []
    for section in contract['sections']:
        count = len(sector[section['name']])
        entries.append({'kind': section['kind'], 'count': count, 'stride': section['stride'],
                        'offset': offset})
        offset += count * section['stride']
    return entries


def encode(contract: Record, sector: Record) -> bytes:
    """The payload of a sector given as the contract's example spells it. O(records)."""
    entries = layout_of(contract, sector)
    buffer = bytearray(entries[-1]['offset'] + entries[-1]['count'] * entries[-1]['stride'])
    header = {**sector, 'magic': contract['magic'], 'version': contract['version'],
              'section_count': len(entries)}
    write_fields(contract['header']['fields'], header, (buffer, 0))
    entry = contract['section_entry']
    for number, values in enumerate(entries):
        write_fields(entry['fields'], values, (buffer, contract['header']['size']
                                               + number * entry['size']))
    for section, placed in zip(contract['sections'], entries):
        for record, values in enumerate(sector[section['name']]):
            write_fields(section['fields'], values, (buffer, placed['offset']
                                                     + record * placed['stride']))
    return bytes(buffer)


# --- Decoding -----------------------------------------------------------------------------

def read_header(contract: Record, data: bytes) -> Record:
    """Magic and version first, then the whole header once the length allows it."""
    fields = {field['name']: field for field in contract['header']['fields']}
    if len(data) < fields['version']['offset'] + codec(fields['version']).size:
        raise ValueError('truncated: no magic and version')
    if codec(fields['magic']).unpack(data, 0) != contract['magic']:
        raise ValueError('magic: not ' + contract['magic'])
    version = codec(fields['version']).unpack(data, fields['version']['offset'])
    if version != contract['version']:
        raise ValueError(f'version: {version} is not {contract["version"]}')
    if len(data) < contract['header']['size']:
        raise ValueError(f'truncated: {len(data)} bytes, header needs {contract["header"]["size"]}')
    return read_fields(contract['header']['fields'], data, 0)


def read_entries(contract: Record, data: bytes, count: int) -> list[Record]:
    entry = contract['section_entry']
    start = contract['header']['size']
    if len(data) < start + count * entry['size']:
        raise ValueError(f'truncated: section table of {count} entries')
    return [read_fields(entry['fields'], data, start + number * entry['size'])
            for number in range(count)]


def known_section(contract: Record, entry: Record, data_length: int) -> Record | None:
    """The known section an entry describes, after its structural checks, or None."""
    known = {section['kind']: section for section in contract['sections']}.get(entry['kind'])
    label = known['name'] if known else f"kind {entry['kind']}"
    if entry['offset'] % contract['alignment']:
        raise ValueError(f'{label} misaligned at {entry["offset"]}')
    if known and entry['stride'] < known['stride']:
        raise ValueError(f'{label} stride {entry["stride"]} < {known["stride"]}')
    if entry['offset'] + entry['count'] * entry['stride'] > data_length:
        raise ValueError(f'{label} out of bounds')
    return known


def read_records(section: Record, entry: Record, data: bytes) -> list[Record]:
    """A known section's records, reading only its known leading fields of each stride."""
    return [read_fields(section['fields'], data, entry['offset'] + record * entry['stride'])
            for record in range(entry['count'])]


def decode(contract: Record, data: bytes) -> Record:
    """The sector as the contract's example spells it. Unknown kinds are skipped. O(bytes)."""
    header = read_header(contract, data)
    sector = {name: value for name, value in header.items()
              if name not in STRUCTURE and not name.startswith('reserved')}
    sector.update({section['name']: [] for section in contract['sections']})
    for entry in read_entries(contract, data, header['section_count']):
        section = known_section(contract, entry, len(data))
        if section is not None:
            sector[section['name']] += read_records(section, entry, data)
    return sector


# --- Validation ---------------------------------------------------------------------------

def known_bits(field: Record) -> int:
    return sum(1 << bit for bit in field.get('bits', {}).values())


# Constraint table: (applies to the field, holds for the value, what the failure says).
CONSTRAINTS: list[tuple[Callable[[Record], bool], Callable[[Record, Any], bool], str]] = [
    (lambda field: field['type'] == 'f32', lambda _, value: math.isfinite(value), 'not finite'),
    (lambda field: field.get('positive', False), lambda _, value: value > 0, 'not positive'),
    (lambda field: field.get('zero', False), lambda _, value: value == 0, 'reserved, must be 0'),
    (lambda field: 'bits' in field, lambda field, value: value & ~known_bits(field) == 0,
     'unknown flag bits'),
]


def check_value(label: str, field: Record, value: Any) -> None:
    """Raises on the first constraint of the contract that the value breaks."""
    for applies, holds, failure in CONSTRAINTS:
        if applies(field) and not holds(field, value):
            raise ValueError(f'{label}: {failure} ({value!r})')


def validate_payload(contract: Record, data: bytes) -> Record:
    """Structure and every constraint of the contract. Returns the decoded sector."""
    header = read_header(contract, data)
    for field in contract['header']['fields']:
        check_value(field['name'], field, header[field['name']])
    sector = decode(contract, data)
    for section in contract['sections']:
        for number, record in enumerate(sector[section['name']]):
            check_record(f"{section['name']}[{number}]", section['fields'], record)
    return sector


def check_record(label: str, fields: list[Record], record: Record) -> None:
    for field in fields:
        check_value(f"{label}.{field['name']}", field, record[field['name']])
