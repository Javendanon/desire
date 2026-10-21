"""Load, license-check and cross-link the D07 datasets without network I/O."""

from __future__ import annotations

import json
from pathlib import Path

from .model import (
    CONTENT_DIR,
    CURRENT_EDITION,
    EVIDENCE_VALUES,
    KINDS,
    LANGUAGES,
    PREVIOUS_EDITION,
    RELATIONS,
    RULES_EDITIONS,
    SLUG_PATTERN,
    SYNTHETIC_EVIDENCE,
    TRANSLATION_STATUSES,
    UUID_PATTERN,
    Entry,
    Provenance,
    Reference,
    Source,
)


def read_json(path: Path) -> dict:
    """Read one UTF-8 JSON document; errors carry the path."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError(f"missing file: {path}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid JSON in {path}: {error}") from error


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def text(raw: dict, field: str, location: str) -> str:
    value = raw.get(field)
    require(isinstance(value, str) and bool(value.strip()), f"{location}.{field}: non-empty string")
    return value


def optional_text(raw: dict, field: str, location: str) -> str:
    value = raw.get(field, "")
    require(isinstance(value, str), f"{location}.{field}: string")
    return value


def flag(raw: dict, field: str, location: str) -> bool:
    """Read an optional boolean; a truthy string is not accepted as a boolean."""
    value = raw.get(field, False)
    require(type(value) is bool, f"{location}.{field}: boolean")
    return value


def choice(value: object, allowed: tuple, location: str) -> str:
    require(isinstance(value, str) and bool(value.strip()), f"{location}: non-empty string")
    require(value in allowed, f"{location}: expected one of {allowed}")
    return value


def positive_int(raw: dict, field: str, location: str) -> int:
    value = raw.get(field)
    require(type(value) is int and value >= 1, f"{location}.{field}: positive integer")
    return value


def identifier(raw: dict, location: str) -> str:
    value = text(raw, "id", location)
    require(UUID_PATTERN.fullmatch(value) is not None, f"{location}.id: invalid UUID")
    return value


def slug(raw: dict, location: str) -> str:
    value = text(raw, "slug", location)
    require(SLUG_PATTERN.fullmatch(value) is not None, f"{location}.slug: invalid slug")
    return value


def parse_reference(raw: object, location: str) -> Reference:
    require(isinstance(raw, dict), f"{location}: expected object")
    target = text(raw, "target", location)
    edition, separator, target_slug = target.partition(":")
    require(separator and edition in RULES_EDITIONS, f"{location}.target: expected edition:slug")
    require(SLUG_PATTERN.fullmatch(target_slug) is not None, f"{location}.target: invalid slug")
    relation = choice(raw.get("relation"), RELATIONS, f"{location}.relation")
    return Reference(target=target, relation=relation)


def parse_references(raw: object, location: str) -> tuple[Reference, ...]:
    require(isinstance(raw, list), f"{location}: expected array")
    references = tuple(
        parse_reference(item, f"{location}[{index}]") for index, item in enumerate(raw)
    )
    targets = [reference.target for reference in references]
    require(len(targets) == len(set(targets)), f"{location}: duplicate reference target")
    return references


def parse_provenance(raw: object, location: str) -> Provenance:
    require(isinstance(raw, dict), f"{location}: expected object")
    return Provenance(
        source=text(raw, "source", location),
        attribution=text(raw, "attribution", location),
        evidence=choice(raw.get("evidence"), EVIDENCE_VALUES, f"{location}.evidence"),
    )


def parse_entry(raw: object, kind: str, location: str) -> Entry:
    require(isinstance(raw, dict), f"{location}: expected object")
    entry_kind = choice(raw.get("kind"), KINDS, f"{location}.kind")
    require(entry_kind == kind, f"{location}.kind: expected {kind}, got {entry_kind}")
    return Entry(
        id=identifier(raw, location),
        slug=slug(raw, location),
        revision=positive_int(raw, "revision", location),
        kind=entry_kind,
        rules_edition=choice(
            raw.get("rules_edition"), RULES_EDITIONS, f"{location}.rules_edition"
        ),
        language=choice(raw.get("language"), LANGUAGES, f"{location}.language"),
        title=text(raw, "title", location),
        body=text(raw, "body", location),
        translation_status=choice(
            raw.get("translation_status"), TRANSLATION_STATUSES, f"{location}.translation_status"
        ),
        source_id=text(raw, "source_id", location),
        license=text(raw, "license", location),
        source_locator=text(raw, "source_locator", location),
        provenance=parse_provenance(raw.get("provenance"), f"{location}.provenance"),
        references=parse_references(raw.get("references", []), f"{location}.references"),
    )


def parse_source(raw: object, location: str) -> Source:
    require(isinstance(raw, dict), f"{location}: expected object")
    return Source(
        id=text(raw, "id", location),
        name=text(raw, "name", location),
        rules_edition=choice(
            raw.get("rules_edition"), RULES_EDITIONS, f"{location}.rules_edition"
        ),
        license=text(raw, "license", location),
        license_url=optional_text(raw, "license_url", location),
        url=optional_text(raw, "url", location),
        synthetic=flag(raw, "synthetic", location),
    )


def load_sources(content_dir: Path = CONTENT_DIR) -> dict[str, Source]:
    document = read_json(content_dir / "sources.json")
    require(isinstance(document, dict), "sources: expected object")
    raw_sources = document.get("sources")
    require(isinstance(raw_sources, list), "sources: expected array")
    sources: dict[str, Source] = {}
    for index, raw in enumerate(raw_sources):
        source = parse_source(raw, f"sources[{index}]")
        require(source.id not in sources, f"sources: duplicate source {source.id}")
        sources[source.id] = source
    return sources


def load_entries(content_dir: Path = CONTENT_DIR) -> list[Entry]:
    """Read every canon file, then enforce identity, license and link invariants."""
    entries: list[Entry] = []
    for path in sorted((content_dir / "canon").glob("*.json")):
        document = read_json(path)
        require(isinstance(document, dict), f"{path.name}: expected object")
        kind = choice(document.get("kind"), KINDS, f"{path.name}.kind")
        raw_entries = document.get("entries")
        require(isinstance(raw_entries, list), f"{path.name}.entries: expected array")
        entries.extend(
            parse_entry(raw, kind, f"{path.name}[{index}]") for index, raw in enumerate(raw_entries)
        )
    check_sources(entries, load_sources(content_dir))
    check_references(entries)
    return entries


def build_index(entries: list[Entry]) -> dict[str, Entry]:
    """Index by edition:slug and reject duplicate IDs or natural keys."""
    index: dict[str, Entry] = {}
    identifiers = set()
    for entry in entries:
        require(entry.id not in identifiers, f"{entry.key}: duplicate id {entry.id}")
        require(entry.key not in index, f"{entry.key}: duplicate edition slug")
        identifiers.add(entry.id)
        index[entry.key] = entry
    return index


def check_sources(entries: list[Entry], sources: dict[str, Source]) -> None:
    """Every canon entry must cite a registered source with the matching license."""
    for entry in entries:
        source = sources.get(entry.source_id)
        require(source is not None, f"{entry.key}.source_id: unknown source {entry.source_id}")
        require(
            source.rules_edition == entry.rules_edition, f"{entry.key}: source edition mismatch"
        )
        require(source.license == entry.license, f"{entry.key}: source license mismatch")
        require(
            source.name == entry.provenance.source,
            f"{entry.key}: provenance source mismatch",
        )
        require(not source.synthetic, f"{entry.key}: synthetic source cannot be canon")
        require(
            entry.provenance.evidence != SYNTHETIC_EVIDENCE,
            f"{entry.key}: synthetic provenance cannot be canon",
        )


def check_references(entries: list[Entry]) -> None:
    """Resolve every reference and enforce the relation's direction and edition."""
    index = build_index(entries)
    for entry in entries:
        for reference in entry.references:
            target = index.get(reference.target)
            require(
                target is not None,
                f"{entry.key}.references: missing reference {reference.target}",
            )
            check_relation(entry, target, reference.relation)


def check_relation(source: Entry, target: Entry, relation: str) -> None:
    require(source.key != target.key, f"{source.key}: self reference")
    if relation == "previous_edition":
        require(
            source.rules_edition == CURRENT_EDITION,
            f"{source.key}: previous edition needs {CURRENT_EDITION}",
        )
        require(
            target.rules_edition == PREVIOUS_EDITION,
            f"{source.key}: previous edition needs {PREVIOUS_EDITION}",
        )
        require(source.kind == target.kind, f"{source.key}: previous edition kind mismatch")
        return
    require(source.rules_edition == target.rules_edition, f"{source.key}: cross-edition reference")
    expected = ("spell", "class") if relation == "available_to_class" else ("spell", "condition")
    require((source.kind, target.kind) == expected, f"{source.key}: invalid {relation} relation")


def require_object(value: object, location: str) -> dict:
    require(isinstance(value, dict), f"{location}: expected object")
    return value


def require_list(value: object, location: str) -> list:
    require(isinstance(value, list), f"{location}: expected array")
    return value
