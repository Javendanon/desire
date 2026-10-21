"""Load the shared, language-neutral search fixtures of the compendium.

``content/knowledge/search-fixtures.json`` is the normative description of how
searching and filtering must behave. Every consumer (D09 Rust, D15 TypeScript)
implements from that file; this loader only validates its shape.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .loader import read_json, require
from .model import CONTENT_DIR, KINDS, RULES_EDITIONS, TRANSLATION_STATUSES, UUID_PATTERN

SCHEMA_VERSION = 1
FIXTURE_FILE = "search-fixtures.json"
FILTER_FIELDS = ("kind", "rules_edition", "language", "translation_status")
SEMANTIC_KEYS = ("document", "normalization", "query", "haystack", "filters", "results")
# `language` stays open on purpose: a filter may legitimately match no entry yet
# (there are no English entries), while a typo in a closed vocabulary is caught.
FILTER_VALUES = {
    "kind": KINDS,
    "rules_edition": RULES_EDITIONS,
    "translation_status": TRANSLATION_STATUSES,
}


@dataclass(frozen=True)
class SearchFixture:
    """One query, its normative filters and the entry ids it must return."""

    name: str
    query: str
    filters: dict
    expected_ids: tuple[str, ...]


def fixture_filters(raw: object, location: str) -> dict:
    """Validate the documented filter names and values; unknown names are rejected."""
    require(isinstance(raw, dict), f"{location}.filters: expected object")
    unknown = sorted(set(raw) - set(FILTER_FIELDS))
    require(not unknown, f"{location}.filters: unknown filter {unknown}")
    for field, value in raw.items():
        message = f"{location}.filters.{field}: string"
        require(isinstance(value, str) and bool(value.strip()), message)
        allowed = FILTER_VALUES.get(field)
        if allowed is not None:
            require(value in allowed, f"{location}.filters.{field}: expected one of {allowed}")
    return dict(raw)


def expected_ids(raw: object, location: str) -> tuple[str, ...]:
    """Entry ids are D04 identities: UUIDs, unique within one fixture."""
    require(isinstance(raw, list), f"{location}.expected_ids: expected array")
    for index, value in enumerate(raw):
        require(
            isinstance(value, str) and UUID_PATTERN.fullmatch(value) is not None,
            f"{location}.expected_ids[{index}]: invalid UUID",
        )
    require(len(raw) == len(set(raw)), f"{location}.expected_ids: duplicate id")
    return tuple(raw)


def parse_fixture(raw: object, index: int) -> SearchFixture:
    location = f"fixtures[{index}]"
    require(isinstance(raw, dict), f"{location}: expected object")
    name = raw.get("name")
    require(isinstance(name, str) and bool(name.strip()), f"{location}.name: non-empty string")
    query = raw.get("query")
    require(isinstance(query, str), f"{location}.query: string")
    return SearchFixture(
        name=name,
        query=query,
        filters=fixture_filters(raw.get("filters"), location),
        expected_ids=expected_ids(raw.get("expected_ids"), location),
    )


def semantics(raw: object) -> None:
    """The prose contract D09 and D15 read must exist, not only the cases."""
    require(isinstance(raw, dict), f"{FIXTURE_FILE}.semantics: expected object")
    for key in SEMANTIC_KEYS:
        value = raw.get(key)
        message = f"{FIXTURE_FILE}.semantics.{key}: non-empty string"
        require(isinstance(value, str) and bool(value.strip()), message)


def load_fixtures(content_dir: Path = CONTENT_DIR) -> list[SearchFixture]:
    """Read and validate the fixture file; an empty file is never a pass."""
    path = content_dir / FIXTURE_FILE
    document = read_json(path)
    require(isinstance(document, dict), f"{FIXTURE_FILE}: expected object")
    require(
        type(document.get("schema_version")) is int
        and document["schema_version"] == SCHEMA_VERSION,
        f"{FIXTURE_FILE}.schema_version: expected {SCHEMA_VERSION}",
    )
    raw_fixtures = document.get("fixtures")
    semantics(document.get("semantics"))
    require(
        isinstance(raw_fixtures, list) and bool(raw_fixtures),
        f"{FIXTURE_FILE}.fixtures: expected non-empty array",
    )
    fixtures = [parse_fixture(raw, index) for index, raw in enumerate(raw_fixtures)]
    names = [fixture.name for fixture in fixtures]
    require(len(names) == len(set(names)), f"{FIXTURE_FILE}.fixtures: duplicate name")
    return fixtures
