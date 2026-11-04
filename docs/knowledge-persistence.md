# Knowledge persistence handoff — D28

Owner: D28, card `64a28941-4819-4d75-821e-3c75b155e9b8`. Consumers: D09 (Rust API) and D15 (TypeScript UI).
This contract separates D07 editorial content from D08 runtime persistence. It does not implement either delivery.

## Canonical seed and runtime storage

The canonical seed is UTF-8 JSON, versioned in Git under `content/knowledge/`. D07 owns its publication and validation.
Git commits identify seed releases, not entry revisions or wire schema versions.
Each entry retains its stable UUID. Unchanged entries keep their positive `revision` across releases.
D07 increments the entry revision for every editorial change, including sidecar and source metadata changes affecting that entry.
Entry fields follow [`KnowledgeEntry`](../contracts/schema.json): `id`, `revision`, `rules_edition`, `language`,
`title`, `body`, and `provenance` (`source`, `attribution`, `evidence`). D04 owns this closed wire schema.
D07 keeps package metadata outside entry objects. D08 rejects unknown entry fields before import.
The [D04 model](modelo-de-datos.md) defines identities, revisions, authorization, and migration constraints.
`contracts/examples.json` is synthetic test data, not the canonical seed or an API response.

PostgreSQL is the runtime storage, not a cache or an alternative to JSON authoring. D08 owns the database delivery.
D08 imports validated D07 seed releases into `catalog.knowledge_entries` through migrations and repositories.
This document assigns seed publication and validation to D07 and runtime import to D08; the
[coordination table](desarrollo-paralelo.md#propiedad-inicial-de-archivos) still groups both under D07 until D00 records the split.
The table entry and the D04 model wording are pending items below, not part of this delivery.
Runtime writes never rewrite the seed. Editorial changes enter through D07 review and a new seed release.
Campaign notes remain separate `CampaignKnowledge` records. They never enter the shared catalog seed.

## Ownership and consumer reads

| Card | Owner's delivery | Reads |
| --- | --- | --- |
| D28 | This persistence handoff and its ownership boundaries | D04 contracts and coordination rules |
| D04 | `contracts/schema.json` and generated Rust/TS DTOs, including the pending catalog read contract below | Approved domain requirements |
| D07 | Canonical JSON, editorial metadata, licensing evidence, seed validation and authoring tools | Authorized source material and D04 entry schema |
| D08 | PostgreSQL migrations, seed loader, sidecar/source storage, import bookkeeping and repositories | Validated D07 JSON at an explicit Git commit |
| D09 | Rust API, runtime validation and authorization | PostgreSQL through D08 repositories, using generated Rust DTOs |
| D15 | TypeScript knowledge UI | D09 `/api/v1` responses, using `src/generated/contracts.ts` |

D09 must not serve seed files as a fallback. D15 must not read seed files or access PostgreSQL directly.
D09 filters campaign records before serialization. Player campaign-note reads use authorized `PlayerKnowledge` projections.
Shared catalog reads use the new D04 catalog read DTO: an unchanged `KnowledgeEntry` plus its sidecar and source metadata.
D09 exposes that new resource under `/api/v1` for D15; it must not add fields to existing closed v1 DTOs.
D04, D08 and D09 must deliver the pending read path below before D15 integrates catalog search.
Private records never reach player clients.

## Import and version rules

D08 validates the complete release before import, including D07 licensing evidence and D04 relational constraints.
D08 imports a release atomically and records its Git commit. Failed imports leave the active catalog unchanged.
Repeating an identical ID/revision/payload is a no-op; payload includes entry, sidecar and resolved source metadata.
A different payload at the same ID/revision is an error.
Keep the shipped `catalog.knowledge_entries` keys: `PRIMARY KEY (id)` and `UNIQUE (id, rules_edition)`.
A higher revision atomically replaces that ID's entry and metadata in place, with its `rules_edition` unchanged.
There is one runtime row per ID, not retained rows keyed by `(id, revision)`; Git retains editorial history.
All catalog references select `(entry_id, rules_edition)`, not revision. This includes `Condition`/`ActorCondition`,
`CharacterSpell`, `ActorConcentration`, `CharacterClass.class_entry_id`/`subclass_entry_id`, and `ClassFeature.feature_entry_id`.
Existing references therefore read the updated catalog text; neither the database nor DTOs gain revision selectors.
Map-version retention is unchanged. The [D04 model](modelo-de-datos.md) still pins catalog entries by
ID/revision, which contradicts the shipped keys above; reconciling that normative sentence and its
migration outline is D04 work listed below. Until then the model text is stale for knowledge entries,
while these rules describe the keys the migrations actually enforce.
Imports must not delete referenced entries, downgrade revisions, overwrite campaign notes, or silently replace conflicting data.
D08 owns relational checks and import failure tests. D09 owns API validation and permission tests. D15 owns consumer integration tests.

## Pending fields and delivery work

These items have assigned owners and cards. They do not reopen the JSON/PostgreSQL decision.
D28 defines the contract, not implementation readiness. The existing D08 loader rejects changed installed rows
and imports knowledge only as `KnowledgeEntry` DTOs; higher-revision updates and D07 package ingestion remain D08 work.
D08 stores the complete sidecar and source registry in PostgreSQL, joined by entry ID and `source_id`.
D04 defines a new generated catalog read DTO, without extending `KnowledgeEntry` or `PlayerKnowledge`.
D09 serves that DTO under `/api/v1` and runs the normative D07 search fixtures; D15 reads only this API.
All runtime metadata rows below require D04 contract, D08 storage and D09 exposure before D15 integration.

| Pending item | Owner and card | Required delivery |
| --- | --- | --- |
| Seed package layout and validation | D07 seed publisher — D07; D08 loader — D08 | Consume the shipped `compendium.json` envelope (`schema_version`, `language`, `rules_editions`, `knowledge_entries`, `catalog`) and `sources.json`; validate both before import |
| `kind` | D04 contracts — D04; D08 storage — D08; D09 API — D09 | Store and expose the sidecar kind; support the normative kind filter. D16 owns reference-kind validation under D16 before automated rules |
| `translation_status` | D04 contracts — D04; D08 storage — D08; D09 API — D09 | Store, expose and filter the editorial status without inferring review from edition verification |
| `references` (`target`, `relation`) | D04 contracts — D04; D08 storage — D08; D09 API — D09 | Store and expose links, validate edition/slug targets, and include targets in the search haystack |
| `slug` | D04 contracts — D04; D08 storage — D08; D09 API — D09 | Store and expose it; enforce `(rules_edition, slug)` uniqueness and include it in search |
| `source_id`, `license`, `source_locator` | D07 licensing evidence — D07; D04 contracts — D04; D08 storage — D08; D09 API — D09 | Retain and expose attribution metadata outside `KnowledgeEntry`; join the source registry on `source_id` |
| `edition_verification.status`, `edition_verification.citation` | D04 contracts — D04; D08 storage — D08; D09 API — D09 | Preserve and expose the verification state and citation, including `pending_review`; do not upgrade evidence on import |
| Source registry: `id`, `name`, `rules_edition`, `license`, `license_url`, `url`, `document_url`, `document_sha256`, `synthetic` | D07 source evidence — D07; D04 contracts — D04; D08 storage — D08; D09 API — D09 | Validate, store and expose source metadata with catalog reads, including license URLs and document evidence; reject synthetic canon sources |
| Coordination-table split and model retention rule | D00 coordination protocol — D00, with the D07 and D08 owners; D04 data model — D04 | Record the D07 publication / D08 import boundary in `docs/desarrollo-paralelo.md`, and restate catalog-entry retention by ID/edition with its rationale in `docs/modelo-de-datos.md`, replacing the ID/revision pin for entries while map versions stay pinned |
| Imported Git commit and import outcome | D08 persistence implementer — D08 | Store release bookkeeping and implement same-revision conflict rejection, higher-revision in-place updates and transactional failure tests, including sidecar/source changes |
| Catalog consumer integration | D09 API — D09; D15 UI — D15 | Serve and consume the new catalog read DTO and all four normative filters (`kind`, `rules_edition`, `language`, `translation_status`); verify D07 fixtures through the runtime path |

## Verification

Run `python3 tools/contracts/generate.py --check`, `python3 tools/contracts/validate.py`, and `git diff --check` from the repository root.
These checks cover existing schema consistency and whitespace, not seed availability, SQL behavior, API authorization, or UI integration.
