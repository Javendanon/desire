"""Reuse the D04 JSON Schema validator instead of copying contract rules."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_FILE = ROOT / "contracts/schema.json"
VALIDATOR_FILE = ROOT / "tools/contracts/validate.py"


def _load_validator():
    spec = importlib.util.spec_from_file_location("desire_d04_validate", VALIDATOR_FILE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.validate


_SCHEMA = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
_VALIDATE = _load_validator()


def _shell() -> dict:
    required = _SCHEMA["$defs"]["Examples"]["required"]
    return {name: [] for name in required}


def _section(package: dict, field: str) -> object:
    if not isinstance(package, dict):
        raise ValueError("campaign: expected object")
    value = package.get(field)
    if value is None:
        raise ValueError(f"campaign.{field}: missing")
    return value


def _list_section(package: dict, field: str) -> list:
    value = _section(package, field)
    if not isinstance(value, list):
        raise ValueError(f"campaign.{field}: expected array")
    return value


def validate_knowledge_entries(records: list[dict]) -> None:
    """Validate the D04 projection of every canonical entry."""
    shell = _shell()
    shell["entries"] = list(records)
    _VALIDATE(shell, _SCHEMA)


def validate_campaign(package: dict) -> None:
    """Validate campaign records against D04, dropping D07-only source metadata."""
    shell = _shell()
    shell["campaigns"] = [_section(package, "campaign")]
    shell["knowledge"] = _list_section(package, "knowledge")
    shell["secrets"] = [
        _secret_contract(secret) for secret in _list_section(package, "secrets")
    ]
    _VALIDATE(shell, _SCHEMA)


def _secret_contract(secret: dict) -> dict:
    """DmSecret has no visibility or provenance; its type is already DM-only."""
    local_fields = {"visibility", "provenance"}
    return {key: value for key, value in secret.items() if key not in local_fields}
