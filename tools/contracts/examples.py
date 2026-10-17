"""Check references and isolation of the D04 fixtures; O(entities + links)."""

import json
from pathlib import Path

from validate import validate

ROOT = Path(__file__).resolve().parents[2]
TARGETS = {'world_id': 'worlds', 'era_id': 'eras', 'city_id': 'cities',
           'district_id': 'districts', 'map_version_id': 'maps', 'place_id': 'places',
           'campaign_id': 'campaigns', 'scene_id': 'scenes', 'character_id': 'characters',
           'knowledge_entry_id': 'entries', 'session_id': 'sessions'}


def check_reference(record: dict, target: dict, context: tuple) -> None:
    field, location, edition = context
    campaign = record.get('campaign_id')
    if campaign and target.get('campaign_id', campaign) != campaign:
        raise ValueError(f'{location}.{field}: cross-campaign reference')
    if edition and target.get('rules_edition', edition) != edition:
        raise ValueError(f'{location}.{field}: rules edition mismatch')
    if field == 'district_id' and target['city_id'] != record['city_id']:
        raise ValueError(f'{location}.{field}: district city mismatch')


def check_links(record: dict, index: dict, location: str) -> None:
    """Validate the references of a record; O(fields)."""
    campaign = index['campaigns'].get(record.get('campaign_id'), {})
    edition = record.get('rules_edition', campaign.get('rules_edition'))
    for field, value in record.items():
        if field not in TARGETS or value is None:
            continue
        target = index[TARGETS[field]].get(value)
        if target is None:
            raise ValueError(f'{location}.{field}: missing reference {value}')
        check_reference(record, target, (field, location, edition))


def check_projection(record: dict, index: dict, collection: str) -> None:
    source = index[collection].get(record['id'])
    if source is None:
        raise ValueError(f'snapshot.{collection}: missing reference {record["id"]}')
    if source.get('visibility', 'players') != 'players':
        raise ValueError(f'snapshot.{collection}: private entry')
    expected = {field: value for field, value in source.items() if field != 'visibility'}
    if record != expected:
        raise ValueError(f'snapshot.{collection}: inconsistent projection')


def check_snapshot(snapshot: dict, index: dict) -> None:
    """Check references and public projections of a snapshot; O(objects)."""
    campaign_id = snapshot['campaign']['id']
    if index['campaigns'].get(campaign_id) != snapshot['campaign']:
        raise ValueError('snapshot.campaign: inconsistent projection')
    for collection in ('scenes', 'characters', 'journal', 'knowledge'):
        for record in snapshot[collection]:
            if record['campaign_id'] != campaign_id:
                raise ValueError(f'snapshot.{collection}: cross-campaign reference')
            check_links(record, index, f'snapshot.{collection}')
            check_projection(record, index, collection)


def check_travel_event(event: dict, index: dict) -> None:
    if event['campaign_id'] != event['travel']['campaign_id']:
        raise ValueError('travel_events.travel: cross-campaign reference')
    check_links(event['travel'], index, 'travel_events.travel')


def build_index(examples: dict) -> dict:
    """Build indexes by ID and reject global duplicates; O(entities)."""
    index = {}
    identifiers = set()
    for collection, records in examples.items():
        index[collection] = {}
        for record in records:
            if 'id' not in record:
                continue
            identity = record['id']
            if identity in identifiers:
                raise ValueError(f'{collection}: duplicate id {identity}')
            identifiers.add(identity)
            index[collection][identity] = record
    return index


def check_examples(examples: dict, schema: dict) -> None:
    """Validate shape, global ID uniqueness and references; O(entities + links)."""
    validate(examples, schema)
    index = build_index(examples)
    for collection, records in examples.items():
        if collection == 'snapshots':
            continue
        for record in records:
            check_links(record, index, collection)
    for snapshot in examples['snapshots']:
        check_snapshot(snapshot, index)
    for event in examples['travel_events']:
        check_travel_event(event, index)


if __name__ == '__main__':
    check_examples(json.loads((ROOT / 'contracts/examples.json').read_text()),
                   json.loads((ROOT / 'contracts/schema.json').read_text()))
    print('Example references and campaign scopes are coherent')
