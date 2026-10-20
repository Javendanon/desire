# Knowledge import and search tooling

The tooling projects canonical content into the D04 `KnowledgeEntry` DTO and keeps
D07 metadata (`slug`, `kind`, `translation_status`, `license`, references) in a
catalog sidecar. It reuses `tools/contracts/validate.py` instead of duplicating the
contract rules.

## Modules

| Module | Responsibility |
| --- | --- |
| `model.py` | Frozen entry/reference/provenance/source records and allowed values. |
| `loader.py` | Canon JSON reading, identity, source/license/synthetic and relation checks. |
| `campaign.py` | Synthetic campaign records, explicit visibility and D04 campaign validation. |
| `contract.py` | D04 schema adapter for knowledge entries and campaign records. |
| `importer.py` | Deterministic compendium rendering, idempotent sync and `--check`. |
| `fixtures.py` | Shape validation of the shared search fixtures that D09 and D15 consume. |
| `search.py` | **Verification CLI only** — not the reference implementation of search. |

## `search.py` is not the reference implementation

The normative search semantics — accent and case normalization, all-token matching,
the `kind`, `rules_edition`, `language` and `translation_status` filters and the
2014/2024 split — live in `content/knowledge/search-fixtures.json` as shared
query → expected-ids cases under `schema_version: 1`; a consumer must reject any other
version. D09 (Rust) and D15 (TypeScript) implement against that
file. `search.py` is a stand-in so the Python tests and `--verify-fixtures` can prove
the committed compendium still satisfies those fixtures; it must not be treated as
the source of truth, and changing it is not how you change search behaviour. Edit the
fixtures first, then make every consumer — including `search.py` — pass them.

The fixture `language` filter is an open tag, so a fixture may target a language the
seed does not have yet (`en`); the `--language` CLI flag still accepts only the seed
languages. Use `--verify-fixtures` to reproduce every case in the artifact.

## Invariants enforced by tests

- Importing twice writes the same bytes; `--check` fails on a stale artifact.
- Every generated entry passes the D04 schema projection.
- Duplicate IDs and duplicate `(rules_edition, slug)` keys fail.
- Unknown sources, license mismatches, sources flagged `synthetic: true` and dangling
  references fail.
- Every shared search fixture holds; the fixture set covers all four filter dimensions,
  both rules editions, a status that matches nothing, a title-only word, a kind-only
  word and a multi-token query whose tokens appear in reverse order.
  `test_search.py` pins a required set of thirteen property fixtures by name, so none of
  those can be deleted without a failure; fixtures outside that set are free to change.
- The fixture file itself is validated: a required `semantics` block with all six
  keys, known filter names, closed-vocabulary filter values, UUID expectations, no
  duplicate fixture or expected id and no empty fixture list.
- Campaign demo lore and DM secrets stay outside canon and keep explicit visibility.
- Import and search run with the network socket disabled.

## Commands

```sh
python3 -m tools.knowledge.importer                 # rebuild compendium.json
python3 -m tools.knowledge.importer --check         # fail when the artifact is stale
python3 -m tools.knowledge.search --verify-fixtures # check every shared fixture
python3 -m tools.knowledge.search --query fuego --kind spell --edition dnd_2024
python3 -m unittest discover -s tools/knowledge/tests -p 'test_*.py'
```

All commands read local files only. No command requires network access.
