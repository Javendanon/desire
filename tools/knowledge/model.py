"""D07 knowledge model: canon entries, references and licensed sources."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
CONTENT_DIR = ROOT / "content/knowledge"
CANON_DIR = CONTENT_DIR / "canon"
SOURCES_FILE = CONTENT_DIR / "sources.json"
COMPENDIUM_FILE = CONTENT_DIR / "compendium.json"
CAMPAIGN_FILE = CONTENT_DIR / "campaign/demo-campaign.json"

KINDS = ("spell", "class", "condition")
RULES_EDITIONS = ("dnd_2014", "dnd_2024")
LANGUAGES = ("es",)
TRANSLATION_STATUSES = ("translated", "reviewed", "pending", "source_language")
EVIDENCE_VALUES = ("verified", "interpretation", "synthetic")
VERIFICATION_STATUSES = ("verified", "pending_review")
VISIBILITIES = ("players", "dm")
RELATIONS = ("available_to_class", "applies_condition", "previous_edition")

DEFAULT_LANGUAGE = LANGUAGES[0]
PREVIOUS_EDITION = RULES_EDITIONS[0]
CURRENT_EDITION = RULES_EDITIONS[1]
SYNTHETIC_EVIDENCE = EVIDENCE_VALUES[2]
VERIFIED = VERIFICATION_STATUSES[0]

UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class Reference:
    """A link from one canonical entry to another, resolved by edition and slug."""

    target: str
    relation: str


@dataclass(frozen=True)
class Provenance:
    """D04 provenance fields; evidence says how far the text is from its source."""

    source: str
    attribution: str
    evidence: str

    def signing(self) -> dict[str, str]:
        return {
            "source": self.source,
            "attribution": self.attribution,
            "evidence": self.evidence,
        }


@dataclass(frozen=True)
class Source:
    """A registered source; ``synthetic`` marks demo provenance that is never canon."""

    id: str
    name: str
    rules_edition: str
    license: str
    license_url: str
    url: str
    synthetic: bool = False
    document_url: str = ""
    document_sha256: str = ""


@dataclass(frozen=True)
class EditionVerification:
    """How far an entry's body was checked against the source of its rules edition."""

    status: str
    citation: str = ""

    def catalog(self) -> dict[str, str]:
        return {"status": self.status, "citation": self.citation}


@dataclass(frozen=True)
class Entry:
    """Canonical entry before it is projected into the D04 KnowledgeEntry DTO."""

    id: str
    slug: str
    revision: int
    kind: str
    rules_edition: str
    language: str
    title: str
    body: str
    translation_status: str
    source_id: str
    license: str
    source_locator: str
    provenance: Provenance
    edition_verification: EditionVerification
    references: tuple[Reference, ...] = ()

    @property
    def key(self) -> str:
        return f"{self.rules_edition}:{self.slug}"

    def contract(self) -> dict:
        """Project only the D04 KnowledgeEntry fields, never local metadata."""
        return {
            "id": self.id,
            "revision": self.revision,
            "rules_edition": self.rules_edition,
            "language": self.language,
            "title": self.title,
            "body": self.body,
            "provenance": self.provenance.signing(),
        }
