"""Validate synthetic campaign lore and explicit visibility against D04."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from . import contract
from .loader import identifier, read_json, require, require_list, require_object, text
from .model import CONTENT_DIR, SYNTHETIC_EVIDENCE, VISIBILITIES


def load_campaign(content_dir: Path = CONTENT_DIR) -> dict:
    package = read_json(content_dir / "campaign/demo-campaign.json")
    validate_campaign(package)
    return package


def validate_campaign(package: dict) -> None:
    """Separate synthetic demo lore from canon and require explicit visibility."""
    require(isinstance(package, dict), "campaign: expected object")
    notice = text(package, "notice", "campaign")
    require(
        SYNTHETIC_EVIDENCE in notice.lower(),
        "campaign.notice: must mark the demo as synthetic",
    )
    campaign = require_object(package.get("campaign"), "campaign.campaign")
    knowledge = require_list(package.get("knowledge"), "campaign.knowledge")
    secrets = require_list(package.get("secrets"), "campaign.secrets")
    check_campaign_records(campaign, knowledge, secrets)
    contract.validate_campaign(package)


@dataclass(frozen=True)
class CampaignRecordContext:
    """Shared campaign identity, claimed IDs and current record location."""

    campaign_id: str
    identifiers: set
    location: str


def check_campaign_records(campaign: dict, knowledge: list, secrets: list) -> None:
    campaign_id = text(campaign, "id", "campaign.campaign")
    identifiers = set()
    for collection, records in (("knowledge", knowledge), ("secrets", secrets)):
        for index, raw in enumerate(records):
            location = f"campaign.{collection}[{index}]"
            record = require_object(raw, location)
            context = CampaignRecordContext(campaign_id, identifiers, location)
            check_campaign_record(record, collection, context)


def check_campaign_record(record: dict, collection: str, context: CampaignRecordContext) -> None:
    record_id = identifier(record, context.location)
    require(record_id not in context.identifiers, f"{context.location}: duplicate id {record_id}")
    context.identifiers.add(record_id)
    require(
        record.get("campaign_id") == context.campaign_id,
        f"{context.location}: campaign mismatch",
    )
    check_visibility(collection, record, context.location)
    check_synthetic(record.get("provenance"), context.location)


def check_visibility(collection: str, record: dict, location: str) -> None:
    visibility = record.get("visibility")
    require(visibility in VISIBILITIES, f"{location}.visibility: expected players or dm")
    if collection == "secrets":
        require(visibility == "dm", f"{location}.visibility: secrets are DM-only")


def check_synthetic(provenance: object, location: str) -> None:
    record = require_object(provenance, f"{location}.provenance")
    require(
        record.get("evidence") == SYNTHETIC_EVIDENCE,
        f"{location}.provenance: demo must be synthetic",
    )
