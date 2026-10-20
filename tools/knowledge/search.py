"""Search and filter the local Spanish compendium without network access.

This module is a verification CLI over the shared fixtures, not the reference
implementation of search. The normative semantics live in
``content/knowledge/search-fixtures.json``; D09 (Rust) and D15 (TypeScript)
implement from that file and ``--verify-fixtures`` checks it here.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import sys
import unicodedata

from .fixtures import SearchFixture, load_fixtures
from .loader import read_json
from .model import CONTENT_DIR, KINDS, LANGUAGES, RULES_EDITIONS, TRANSLATION_STATUSES


@dataclass(frozen=True)
class SearchFilters:
    """Optional filters for one compendium query."""

    kind: str | None = None
    edition: str | None = None
    language: str | None = None
    status: str | None = None

    @classmethod
    def from_record(cls, record: dict) -> "SearchFilters":
        """Map the shared fixture field names to the CLI filter names."""
        return cls(
            kind=record.get("kind"),
            edition=record.get("rules_edition"),
            language=record.get("language"),
            status=record.get("translation_status"),
        )


def normalize(value: str) -> str:
    """Casefold and strip accents so 'FÚEGO' matches 'fuego'."""
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


ENTRY_FIELDS = ("id", "title", "body", "rules_edition", "language")
CATALOG_FIELDS = (
    "slug",
    "kind",
    "translation_status",
    "source_id",
    "license",
    "references",
)


def has_fields(record: object, fields: tuple) -> bool:
    return isinstance(record, dict) and all(field in record for field in fields)


def valid_references(record: dict) -> bool:
    references = record.get("references")
    if not isinstance(references, list):
        return False
    return all(isinstance(item, dict) and "target" in item for item in references)


def valid_compendium(document: dict) -> bool:
    entries = document.get("knowledge_entries")
    catalog = document.get("catalog")
    if not isinstance(entries, list) or not isinstance(catalog, dict):
        return False
    if not all(has_fields(entry, ENTRY_FIELDS) for entry in entries):
        return False
    if not all(
        has_fields(record, CATALOG_FIELDS) and valid_references(record)
        for record in catalog.values()
    ):
        return False
    return all(entry["id"] in catalog for entry in entries)


def load_compendium(content_dir: Path = CONTENT_DIR) -> dict:
    path = content_dir / "compendium.json"
    try:
        document = read_json(path)
    except ValueError as error:
        raise ValueError(f"{error}; run python3 -m tools.knowledge.importer") from error
    if not isinstance(document, dict) or not valid_compendium(document):
        raise ValueError(f"{path}: invalid compendium; run python3 -m tools.knowledge.importer")
    return document


def searchable_text(entry: dict, catalog: dict) -> str:
    references = " ".join(reference["target"] for reference in catalog["references"])
    fields = (entry["title"], entry["body"], catalog["slug"], catalog["kind"], references)
    return normalize(" ".join(fields))


def result(entry: dict, catalog: dict) -> dict:
    return {
        "id": entry["id"],
        "slug": catalog["slug"],
        "title": entry["title"],
        "body": entry["body"],
        "kind": catalog["kind"],
        "rules_edition": entry["rules_edition"],
        "language": entry["language"],
        "translation_status": catalog["translation_status"],
        "source_id": catalog["source_id"],
        "license": catalog["license"],
        "references": catalog["references"],
    }


def passes(entry: dict, catalog: dict, filters: SearchFilters) -> bool:
    return all(
        (
            filters.kind is None or catalog["kind"] == filters.kind,
            filters.edition is None or entry["rules_edition"] == filters.edition,
            filters.language is None or entry["language"] == filters.language,
            filters.status is None or catalog["translation_status"] == filters.status,
        )
    )


def find(
    query: str = "", filters: SearchFilters = SearchFilters(), content_dir: Path = CONTENT_DIR
) -> list[dict]:
    """Text search plus kind/edition/language/status filters; O(entries)."""
    document = load_compendium(content_dir)
    tokens = normalize(query).split()
    found = []
    for entry in document["knowledge_entries"]:
        catalog = document["catalog"][entry["id"]]
        if not passes(entry, catalog, filters):
            continue
        haystack = searchable_text(entry, catalog)
        if all(token in haystack for token in tokens):
            found.append(result(entry, catalog))
    return sorted(found, key=lambda item: (item["rules_edition"], item["kind"], item["title"]))


def check_fixture(fixture: SearchFixture, content_dir: Path = CONTENT_DIR) -> str | None:
    """Return a drift message, or None when the shared fixture still holds."""
    filters = SearchFilters.from_record(fixture.filters)
    found = {entry["id"] for entry in find(fixture.query, filters, content_dir)}
    if found == set(fixture.expected_ids):
        return None
    return f"{fixture.name}: expected {sorted(fixture.expected_ids)}, got {sorted(found)}"


def verify_fixtures(content_dir: Path = CONTENT_DIR) -> int:
    """Run every shared fixture through this matcher; non-zero on drift."""
    fixtures = load_fixtures(content_dir)
    failures = []
    for fixture in fixtures:
        failure = check_fixture(fixture, content_dir)
        if failure is not None:
            failures.append(failure)
    for failure in failures:
        print(f"mismatch: {failure}", file=sys.stderr)
    print(f"{len(fixtures)} fixtures, {len(failures)} mismatches")
    return int(bool(failures))


def print_results(results: list[dict]) -> None:
    for entry in results:
        fields = (
            entry["rules_edition"],
            entry["kind"],
            entry["title"],
            entry["translation_status"],
        )
        print(f"{fields[0]:<8}  {fields[1]:<9}  {fields[2]:<16}  [{fields[3]}]")


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--query", default="", help="Spanish text or English slug")
    parser.add_argument("--kind", choices=KINDS)
    parser.add_argument("--edition", choices=RULES_EDITIONS)
    parser.add_argument("--language", choices=LANGUAGES)
    parser.add_argument("--status", choices=TRANSLATION_STATUSES)
    parser.add_argument("--content", type=Path, default=CONTENT_DIR)
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--verify-fixtures", action="store_true", help="check the shared search fixtures"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.verify_fixtures:
            return verify_fixtures(args.content)
        filters = SearchFilters(args.kind, args.edition, args.language, args.status)
        results = find(args.query, filters, args.content)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print_results(results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
