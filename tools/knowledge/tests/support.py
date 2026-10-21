"""Temporary content trees for end-to-end rejection tests."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import shutil

from tools.knowledge.model import CONTENT_DIR


@dataclass(frozen=True)
class EntryTarget:
    filename: str
    slug: str
    edition: str


def copy_content(directory: Path) -> Path:
    target = directory / "knowledge"
    shutil.copytree(CONTENT_DIR, target)
    return target


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save(path: Path, document: dict) -> None:
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def canon(content: Path, filename: str) -> tuple[Path, dict]:
    path = content / "canon" / filename
    return path, read(path)


def entry(document: dict, slug: str, edition: str) -> dict:
    return next(
        item
        for item in document["entries"]
        if item["slug"] == slug and item["rules_edition"] == edition
    )


def mutate_entry(content: Path, target: EntryTarget, change) -> None:
    path, document = canon(content, target.filename)
    change(entry(document, target.slug, target.edition))
    save(path, document)
