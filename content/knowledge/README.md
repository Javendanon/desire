# Local knowledge compendium

This package seeds the Desire compendium with a small, offline, Spanish-language
catalog of spells, classes and conditions. The JSON data is Spanish because the
product searches and displays Spanish entries; file names, fields, code and
documentation stay English.

## Layout

| Path | Purpose |
| --- | --- |
| `sources.json` | Registered sources, rules edition and license. |
| `canon/` | Canonical entries: `spells.json`, `classes.json`, `conditions.json`. |
| `campaign/demo-campaign.json` | Synthetic demo lore, never imported into canon. |
| `compendium.json` | Generated deterministic import output; do not edit by hand. |

## Content rules

- Every entry cites `source_id`, `license`, `source_locator` and D04 `provenance`.
- Only the D&D System Reference Documents listed in `sources.json` are used. They are
  CC-BY-4.0. This is not a license for all D&D content, so a new source must register
  its own license before the importer accepts it.
- Canon entries cannot use a synthetic source or synthetic provenance evidence, even
  with a registered SRD source and matching license. A source edition and license must
  match the entry.
- Bodies are short Spanish interpretive summaries, not verbatim SRD text. The
  `translation_status` field is explicit; the seed uses `translated`, not `reviewed`.
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
python3 -m tools.knowledge.search --query fuego --kind spell --edition dnd_2024
python3 -m unittest discover -s tools/knowledge/tests -p 'test_*.py'
```

All commands read local files only. No command requires network access.
