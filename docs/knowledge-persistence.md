# Knowledge persistence handoff — D28

Owner: D28, card `64a28941-4819-4d75-821e-3c75b155e9b8`. Consumers: D09 (Rust API) and D15 (TypeScript UI).
This contract separates D07 editorial content from D08 runtime persistence. It does not implement either delivery.

## Canonical seed and runtime storage

The canonical seed is UTF-8 JSON, versioned in Git under `content/knowledge/`. D07 owns its publication and validation.
Git commits identify seed releases. Each entry retains its stable UUID and positive `revision` across releases.
Entry fields follow [`KnowledgeEntry`](../contracts/schema.json): `id`, `revision`, `rules_edition`, `language`,
`title`, `body`, and `provenance` (`source`, `attribution`, `evidence`). D04 owns this closed wire schema.
The [D04 model](modelo-de-datos.md) defines identities, revisions, authorization, and migration constraints.
`contracts/examples.json` is synthetic test data, not the canonical seed or an API response.

PostgreSQL is the runtime storage, not a cache or an alternative to JSON authoring. D08 owns the database delivery.
D08 imports validated D07 seed releases into `knowledge_entries` through migrations and repositories.
Runtime writes never rewrite the seed. Editorial changes enter through D07 review and a new seed release.
Campaign notes remain separate `CampaignKnowledge` records. They never enter the shared catalog seed.

## Ownership and consumer reads

| Card | Owner's delivery | Reads |
| --- | --- | --- |
| D28 | This persistence handoff and its ownership boundaries | D04 contracts and coordination rules |
| D04 | `contracts/schema.json` and generated Rust/TS DTOs | Approved domain requirements |
| D07 | Canonical JSON, editorial metadata, licensing evidence, seed validation and authoring tools | Authorized source material and D04 entry schema |
| D08 | PostgreSQL migrations, seed loader, import bookkeeping and repositories | Validated D07 JSON at an explicit Git commit |
| D09 | Rust API, runtime validation and authorization | PostgreSQL through D08 repositories, using generated Rust DTOs |
| D15 | TypeScript knowledge UI | D09 `/api/v1` responses, using `src/generated/contracts.ts` |

D09 must not serve seed files as a fallback. D15 must not read seed files or access PostgreSQL directly.
D09 filters campaign records before serialization. Player reads use authorized `PlayerKnowledge` projections.
Private records never reach player clients.

## Import and version rules

D08 imports a release atomically and records its Git commit. Repeating an identical ID/revision/payload is a no-op.
A different payload at the same ID/revision is an error. A higher revision preserves previously referenced catalog versions.
Imports must not delete referenced entries, downgrade revisions, overwrite campaign notes, or silently replace conflicting data.
D08 owns relational checks and import failure tests. D09 owns API validation and permission tests. D15 owns consumer integration tests.

## Pending fields and delivery work

These items have assigned owners. They do not reopen the JSON/PostgreSQL decision or add fields to the current closed DTO.

| Pending item | Owner and card | Required delivery |
| --- | --- | --- |
| Seed file paths, JSON envelope, release inventory | D07 seed publisher — D07 | Publish the package layout and validator under its existing content/tools scope |
| License identifier and permission evidence for each distributed source | D07 content editor — D07 | Define seed-only metadata and record distribution rights outside `KnowledgeEntry` |
| Imported Git commit, import outcome, retained ID/revision keys | D08 persistence implementer — D08 | Define database bookkeeping fields, constraints and transactional loader tests |
| Revision selector for catalog references | D04 contract owner — D04 | Define the revision field alongside `Condition.knowledge_entry_id` and regenerate DTOs for D08/D09 |

## Verification

Run `python3 tools/contracts/generate.py --check`, `python3 tools/contracts/validate.py`, and `git diff --check` from the repository root.
These checks cover existing schema consistency and whitespace, not seed availability, SQL behavior, API authorization, or UI integration.
