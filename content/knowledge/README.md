# Local knowledge compendium

This package seeds the Desire compendium with a small, offline, Spanish-language
catalog of spells, classes and conditions. The JSON data is Spanish because the
product searches and displays Spanish entries; file names, fields, code and
documentation stay English.

## Layout

| Path | Purpose |
| --- | --- |
| `sources.json` | Sources: edition, license, `synthetic` flag, document URL and SHA-256. |
| `canon/` | Canonical entries: `spells.json`, `classes.json`, `conditions.json`. |
| `campaign/demo-campaign.json` | Synthetic demo lore, never imported into canon. |
| `search-fixtures.json` | Normative search/filter cases, shared with D09 (Rust) and D15 (TS). |
| `compendium.json` | Generated deterministic import output; do not edit by hand. |

## Search semantics

`search-fixtures.json` is the normative artifact for search behaviour, not
`tools/knowledge/search.py`. It carries `schema_version: 1` and each case is a
`query`, a required `filters` object that may be empty but only accepts the `kind`,
`rules_edition`, `language` and `translation_status` keys, and the `expected_ids` it
must return, evaluated against `compendium.json` (`knowledge_entries` joined with
`catalog[id]`). The `semantics` block in the file states the rules: normalized text is case-folded and stripped of
combining marks, every query token must appear, the haystack is title + body + slug +
kind + reference targets, and results are compared as a set of entry ids. `kind`,
`rules_edition` and `translation_status` values are validated against the model
vocabularies; `language` is an open tag, because a filter may legitimately match no
entry yet. D09 and D15 implement from this file; the Python module only re-runs the
fixtures as a check (`--verify-fixtures`). Change the fixtures before changing any
matcher.

## Content rules

- Every entry cites `source_id`, `license`, `source_locator` and D04 `provenance`.
- Only the D&D System Reference Documents listed in `sources.json` are used. They are
  CC-BY-4.0. This is not a license for all D&D content, so a new source must register
  its own license before the importer accepts it.
- Canon entries cannot use a source flagged `synthetic: true` in `sources.json`, nor
  synthetic provenance evidence, even with a registered SRD source and matching license.
  A source edition and license must match the entry. The guard is the explicit flag,
  not a license spelling: a demo source declaring `CC-BY-4.0` is still rejected as
  canon.
- Bodies are short Spanish interpretive summaries, not verbatim SRD text. The
  `translation_status` field is explicit; the seed uses `translated`, not `reviewed`.
- Every entry declares `edition_verification`: `verified` with a `citation`, or
  `pending_review`, which may omit it. The importer rejects an entry without the block,
  an unknown status, a `verified` entry without a citation and a `verified` citation
  that does not contain the SHA-256 of the entry's registered source document. A
  document is registered once in `sources.json` with `document_url` and
  `document_sha256`; a reviewer repeats the check by fetching that document, matching
  the digest and locating the cited section, because the importer runs offline and can
  only enforce the digest. The delivery report lists the URL, digest and locators.
- `dnd_2014` and `dnd_2024` are separate entries and can link with `previous_edition`.
- References use `edition:slug` targets. The importer rejects dangling, duplicate,
  self or relation-incompatible links.
- IDs and `(rules_edition, slug)` keys are unique. Import is deterministic and
  idempotent, so running it twice produces identical bytes.

## Campaign separation

`campaign/demo-campaign.json` is synthetic demo lore. It is not the real campaign and
must never be attributed to it. The file is validated against the D04 `Campaign`,
`CampaignKnowledge` and `DmSecret` contracts. Campaign lore uses explicit
`visibility` (`players` or `dm`), and every demo secret is explicitly `dm`. The import
tool validates the package but never writes its text into `compendium.json`.

## Commands

```sh
python3 -m tools.knowledge.importer          # rebuild compendium.json
python3 -m tools.knowledge.importer --check  # fail when the generated file is stale
python3 -m tools.knowledge.search --verify-fixtures
python3 -m tools.knowledge.search --query fuego --kind spell --edition dnd_2024
python3 -m unittest discover -s tools/knowledge/tests -p 'test_*.py'
```

All commands read local files only. No command requires network access.
