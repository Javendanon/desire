"""Build the deterministic offline compendium from the canon datasets."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from . import campaign, contract, loader
from .model import CONTENT_DIR, DEFAULT_LANGUAGE, Entry

SCHEMA_VERSION = 1


def catalog_record(entry: Entry) -> dict:
    """Keep D07 metadata beside the D04 KnowledgeEntry projection."""
    return {
        "slug": entry.slug,
        "kind": entry.kind,
        "translation_status": entry.translation_status,
        "source_id": entry.source_id,
        "license": entry.license,
        "source_locator": entry.source_locator,
        "references": [
            {"target": reference.target, "relation": reference.relation}
            for reference in entry.references
        ],
    }


def render_compendium(entries: list[Entry]) -> dict:
    """Return a deterministic document: the same entries always produce the same bytes."""
    ordered = sorted(entries, key=lambda entry: (entry.rules_edition, entry.kind, entry.slug))
    document = {
        "schema_version": SCHEMA_VERSION,
        "language": DEFAULT_LANGUAGE,
        "rules_editions": sorted({entry.rules_edition for entry in ordered}),
        "knowledge_entries": [entry.contract() for entry in ordered],
        "catalog": {entry.id: catalog_record(entry) for entry in ordered},
    }
    contract.validate_knowledge_entries(document["knowledge_entries"])
    return document


def serialize(document: dict) -> str:
    return json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def is_current(content_dir: Path = CONTENT_DIR) -> bool:
    entries = loader.load_entries(content_dir)
    expected = serialize(render_compendium(entries))
    path = content_dir / "compendium.json"
    return path.exists() and path.read_text(encoding="utf-8") == expected


def sync(content_dir: Path = CONTENT_DIR, check: bool = False) -> bool:
    """Write the compendium; return True when the file was already current."""
    entries = loader.load_entries(content_dir)
    text = serialize(render_compendium(entries))
    path = content_dir / "compendium.json"
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return True
    if check:
        raise ValueError(f"{path} is stale; run python3 -m tools.knowledge.importer")
    path.write_text(text, encoding="utf-8")
    return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--content", type=Path, default=CONTENT_DIR)
    parser.add_argument("--check", action="store_true", help="fail if compendium.json is stale")
    args = parser.parse_args(argv)
    try:
        campaign.load_campaign(args.content)
        current = sync(args.content, check=args.check)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    count = len(loader.load_entries(args.content))
    state = "current" if current else "written"
    print(f"{count} knowledge entries; compendium {state}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
