# Knowledge persistence handoff — D28

Owner: D28, card `64a28941-4819-4d75-821e-3c75b155e9b8`. Consumers: D09 (Rust API) and D15 (TypeScript UI).
This contract separates D07 editorial content from D08 runtime persistence. It does not implement either delivery.

## Canonical seed and runtime storage

The canonical seed is UTF-8 JSON, versioned in Git under `content/knowledge/`. D07 owns its publication and validation.
Git commits identify seed releases, not entry revisions or wire schema versions.
Each entry retains its stable UUID. Unchanged entries keep their positive `revision` across releases.
D07 increments the entry revision for every editorial change, including provenance changes.
Entry fields follow [`KnowledgeEntry`](../contracts/schema.json): `id`, `revision`, `rules_edition`, `language`,
`title`, `body`, and `provenance` (`source`, `attribution`, `evidence`). D04 owns this closed wire schema.
D07 keeps package metadata outside entry objects. D08 rejects unknown entry fields before import.
The [D04 model](modelo-de-datos.md) defines identities, revisions, authorization, and migration constraints.
`contracts/examples.json` is synthetic test data, not the canonical seed or an API response.

PostgreSQL is the runtime storage, not a cache or an alternative to JSON authoring. D08 owns the database delivery.
D08 imports validated D07 seed releases into `knowledge_entries` through migrations and repositories.
This supersedes the import responsibility in the D07 row of [the coordination table](desarrollo-paralelo.md#propiedad-inicial-de-archivos).
D07 publishes and validates the seed. D08 owns the import.
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

D08 validates the complete release before import, including D07 licensing evidence and D04 relational constraints.
D08 imports a release atomically and records its Git commit. Failed imports leave the active catalog unchanged.
Repeating an identical ID/revision/payload is a no-op.
A different payload at the same ID/revision is an error. A higher revision preserves previously referenced catalog versions.
D08 retains catalog versions as separate rows keyed by `(id, revision)`, not in-place updates or import logs alone.
For `knowledge_entries`, this supersedes the UUID-only primary key in the D04 migration outline. D08 owns the migration and reference constraints.
Imports must not delete referenced entries, downgrade revisions, overwrite campaign notes, or silently replace conflicting data.
D08 owns relational checks and import failure tests. D09 owns API validation and permission tests. D15 owns consumer integration tests.

## Pending fields and delivery work

These items have assigned owners. They do not reopen the JSON/PostgreSQL decision or add fields to `KnowledgeEntry`.
D28 defines the contract, not implementation readiness. D07 and D08 must deliver their listed work before runtime import.
Revision-pinned reads require the new D04 selector below, D08 repository support, and D09 API validation before D15 integration.

| Pending item | Owner and card | Required delivery |
| --- | --- | --- |
| Seed file paths, JSON envelope, release inventory | D07 seed publisher — D07 | Publish the package layout and validator under its existing content/tools scope |
| License identifier and permission evidence for each distributed source | D07 content editor — D07 | Define seed-only metadata and record distribution rights outside `KnowledgeEntry` |
| Imported Git commit, import outcome, retained ID/revision keys | D08 persistence implementer — D08 | Define database bookkeeping fields, retain catalog rows keyed by `(id, revision)`, and deliver reference constraints and transactional loader tests |
| Revision selector for catalog references | D04 contract owner — D04 | Add `knowledge_entry_revision` beside `Condition.knowledge_entry_id` for the referenced `KnowledgeEntry.revision`. Do not reuse `Condition.revision`, which is the condition's own optimistic-concurrency revision. Version the closed contract under D04 rules and regenerate Rust/TS DTOs for D08/D09/D15 |
| Revision-pinned consumer reads | D08 repositories — D08; D09 API — D09; D15 UI — D15 | Store and query `knowledge_entry_id` plus `knowledge_entry_revision`, validate that pair in the API, and consume it without a client-side latest-version fallback |

## Verification

Run `python3 tools/contracts/generate.py --check`, `python3 tools/contracts/validate.py`, and `git diff --check` from the repository root.
These checks cover existing schema consistency and whitespace, not seed availability, SQL behavior, API authorization, or UI integration.
