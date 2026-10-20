# Knowledge import and search tooling

The tooling projects canonical content into the D04 `KnowledgeEntry` DTO and keeps
D07 metadata (`slug`, `kind`, `translation_status`, `license`, references) in a
catalog sidecar. It reuses `tools/contracts/validate.py` instead of duplicating the
contract rules.

## Modules

| Module | Responsibility |
| --- | --- |
| `model.py` | Frozen entry/reference/provenance/source records and allowed values. |
| `loader.py` | Canon JSON reading, identity, source/license and relation checks. |
| `campaign.py` | Synthetic campaign records, explicit visibility and D04 campaign validation. |
| `contract.py` | D04 schema adapter for knowledge entries and campaign records. |
| `importer.py` | Deterministic compendium rendering, idempotent sync and `--check`. |
| `search.py` | Accent-insensitive Spanish text search with kind/edition/language/status filters. |

## Invariants enforced by tests

- Importing twice writes the same bytes; `--check` fails on a stale artifact.
- Every generated entry passes the D04 schema projection.
- Duplicate IDs and duplicate `(rules_edition, slug)` keys fail.
- Unknown sources, license mismatches, synthetic canon sources and dangling references fail.
- Spanish queries are case- and accent-insensitive; 2014 and 2024 entries remain distinct.
- Campaign demo lore and DM secrets stay outside canon and keep explicit visibility.
- Import and search run with the network socket disabled.
