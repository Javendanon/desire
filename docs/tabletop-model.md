# Tabletop model: persistent actors, parties and inhabited places

This extends D04/D08 with migrations 0006–0009 and typed records generated from
`contracts/schema.json`. It is a persistence/domain boundary, not a character-sheet
UI, an authorization service or an automatic D&D rules engine. The v1 DTOs and their
fixtures remain unchanged. `GroupTravel` explicitly carries `protocol_version: 2`;
future endpoints for these resources belong under `/api/v2`.

## Actors and statistics

- `catalog.creature_templates` stores reusable, edition-specific creature statistics
  and provenance. `creature_actions` stores action/reaction/passive descriptions.
  No official bestiary or real character sheet is fabricated or redistributed.
- `campaign.actors` is a particular character, NPC or monster in one campaign.
  A template-backed instance copies its base statistics once into `actor_stats`;
  `actor_state` owns max/current/temporary HP, lifecycle status and revision.
  Damage never mutates the template or another instance. Modifiers calculated from
  ability scores are not stored as a second source of truth.
- Existing character IDs become the same actor IDs. Their scores/HP remain absent
  until explicitly supplied: upgrading never invents a sheet. Legacy NPCs default
  to DM-only visibility; controlled characters remain player-visible.
- New legacy character inserts register an actor. The v1 character record remains
  the identity/controller bridge; editing it is not an automatic edit of the actor's
  display name, visibility or instance statistics.
- Conditions now reference actors, including monsters. The legacy `character_id`
  is nullable and retained for v1 data; when present it must equal the actor ID.

## Character sheets

`character_sheets` contains biography, ancestry, background and experience.
`actor_stats` contains the six ability scores, base AC and movement speed in metres.
The character's HP and consumed resources remain separate mutable state.

`character_classes` records class levels; total level is the sum rather than a
second stored value. `character_proficiencies`, `character_equipment`,
`character_spells`, `actor_resources` and `actor_concentration` record the rest of
this first sheet boundary. Multi-column FKs preserve campaign and rules edition.
A sheet bundle is created atomically; a component for another actor aborts it all.

The catalog currently has generic knowledge entries. A class/spell reference checks
existence and edition, not its D07 catalog-sidecar kind; D28/D16 must carry that
metadata/semantic validation into the runtime before automating game rules. Features
such as automatic AC, spell preparation limits and class progression are not claimed.

## Parties and journeys

A campaign can have several `parties`; `party_members` relates each group to its
actors. The same creature/character can be used by movement and encounters.

`travels` now has an optional source `party_id`, with many `travel_participants`.
`TravelRepository::start_from_party` snapshots the membership in its transaction;
`create` accepts an explicit nonempty, distinct set of actors. Later party changes
cannot change who travelled. Existing single-character journeys are backfilled.

The legacy `travels.character_id` remains nullable for v1 compatibility. New callers
use participants; it is not an alternative source for a group journey. A deferred
constraint requires at least one participant and rejects cross-campaign membership.
It writes a new MVCC version of the parent without incrementing its domain revision,
so concurrent removals cannot empty a journey even under REPEATABLE READ. A caller
must retry a PostgreSQL serialization failure as a whole transaction.

`TravelUpdated` v1 still describes the old single-character DTO. The new adapter
never emits it for a group journey. D10/D14 must introduce a v2 event with an
immutable participant snapshot before enabling realtime group movement.

## Place presence and combat

A creature can be present before any encounter exists:

1. `place_occupants` relates an actor to a place, with `present`/`away` status and
   visibility. A partial unique index allows only one current place per actor.
2. `scene_placements` gives the same actor coordinates in a particular scene.
3. `encounters` and `encounter_participants` reference those existing actors when
   combat starts. Initiative can be negative. Entering combat never resets HP,
   concentration, conditions or resources.

Presence, visibility and disposition are independent. Hostile does not mean visible;
being present does not mean fighting. A dead actor can remain as a body at a place.
The database does not infer death, move actors or start combat from current HP.

## Prepared population and revisits

`place_population_rules` defines a campaign-specific place, template, quantity range,
visibility and disposition. A DM-authorized caller chooses the count and supplies
new stable actor IDs to `PresenceRepository::activate_for_dm`.

The adapter uses READ COMMITTED explicitly, locks the rule, records one `population_runs` row and creates all actors,
statistics, HP, occupants and `population_spawned_actors` links in one transaction.
A repeated or simultaneous activation returns the original actor IDs, including
instances that have died or left. It never rolls a new count, heals, resurrects or
moves them back. An invalid/duplicate ID aborts the full activation and permits a
clean retry. Deliberate replenishment requires a new explicitly authored rule; there
is no automatic respawn or destructive reset method.

This is the adapter D14 can invoke on entering a place; there is no implemented HTTP
enter-place endpoint or renderer hook in this change.

## Visibility and authorization

`player_residents` selects only occupants from the requested campaign/place with
`presence = present` and both occupant/actor visibility set to `players`. It returns
only actor ID, display name, kind and disposition. It does not expose hidden residents,
HP, templates, secrets or rules. Full activation/state methods are DM/server paths.

As in the existing repositories, D09/D10 must authenticate and authorize the caller
before calling an adapter. A supplied campaign UUID is not authorization; the test
superuser does not establish production-role permissions. Existing private secrets
remain in their separate schema; no RLS or complete API projection is claimed.

## Upgrade and inspection

Migrations 0001–0005 are unchanged. The runner embeds all nine versions, applies
pending DDL/history in one explicit transaction, and rejects edited history and
downgrades. Existing campaigns, characters, journeys, conditions and secrets survive.

- [Full DBML](database/desire.dbml): 47 tables, 85 foreign keys, generated from an
  isolated PostgreSQL schema and parsed with the official DBML CLI.
- [Diagram](database/desire.mmd): simplified relationships for reading the model.
- [Validation report](reports/d08-tabletop.md): actual commands, evidence and limits.
