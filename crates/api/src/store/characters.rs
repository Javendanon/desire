//! Character CRUD. D08 had no campaign-character repository, so the SQL lives here.
//!
//! A trigger gives every character an actor row: uncontrolled characters are DM-only,
//! controlled ones are player-visible. The joins below apply that rule to reads, and the
//! update keeps the actor row in step when the controller changes.
use super::{Scope, Target, Visible, execute, list_visible, next_id, visible_row};
use crate::{
    access,
    error::{ApiError, INTERNAL},
    extract::Caller,
    payloads::{NewCharacter, PatchCharacter},
    query::{Page, PageBody},
};
use desire_core::contracts::{campaign::Character, common::RulesEdition};
use postgres::Client;

const LIST_DM: &str = "SELECT to_jsonb(c) FROM campaign.characters c \
     WHERE c.campaign_id = $1::text::uuid ORDER BY c.id LIMIT $2 OFFSET $3";
const LIST_PLAYER: &str = "SELECT to_jsonb(c) FROM campaign.characters c \
     JOIN campaign.actors a ON a.campaign_id = c.campaign_id AND a.id = c.id \
     WHERE c.campaign_id = $1::text::uuid AND a.visibility = 'players' \
     ORDER BY c.id LIMIT $2 OFFSET $3";
const GET_DM: &str = "SELECT to_jsonb(c) FROM campaign.characters c \
     WHERE c.campaign_id = $1::text::uuid AND c.id = $2::text::uuid";
const GET_PLAYER: &str = "SELECT to_jsonb(c) FROM campaign.characters c \
     JOIN campaign.actors a ON a.campaign_id = c.campaign_id AND a.id = c.id \
     WHERE c.campaign_id = $1::text::uuid AND c.id = $2::text::uuid \
     AND a.visibility = 'players'";
const UPDATE: &str = "UPDATE campaign.characters SET name = $3, \
     controller_id = $4::text::uuid, revision = revision + 1 \
     WHERE campaign_id = $1::text::uuid AND id = $2::text::uuid AND revision = $5::bigint \
     RETURNING rules_edition::text";
const UPDATE_ACTOR: &str = "UPDATE campaign.actors SET name = $3, \
     kind = CASE WHEN $4::text IS NULL THEN 'npc' ELSE 'character' END, \
     visibility = CASE WHEN $4::text IS NULL THEN 'dm'::campaign.visibility \
     ELSE 'players'::campaign.visibility END \
     WHERE campaign_id = $1::text::uuid AND id = $2::text::uuid";

const MISSING: &str = "character not found";

pub fn list(
    client: &mut Client,
    scope: Scope<'_>,
    page: Page,
) -> Result<PageBody<Character>, ApiError> {
    list_visible(
        client,
        scope,
        page,
        Visible {
            dm: LIST_DM,
            player: LIST_PLAYER,
        },
    )
}

pub fn get(client: &mut Client, target: Target<'_>) -> Result<Character, ApiError> {
    visible_row(
        client,
        target,
        Visible {
            dm: GET_DM,
            player: GET_PLAYER,
        },
        MISSING,
    )
}

pub fn create(
    client: &mut Client,
    scope: Scope<'_>,
    body: NewCharacter,
) -> Result<Character, ApiError> {
    access::require_dm(client, scope.caller, scope.campaign_id)?;
    let character = draft(client, scope, body)?;
    insert(client, scope.caller, &character)?;
    Ok(character)
}

fn draft(client: &mut Client, scope: Scope<'_>, body: NewCharacter) -> Result<Character, ApiError> {
    Ok(Character {
        id: next_id(client, scope.caller)?,
        campaign_id: scope.campaign_id.to_string(),
        controller_id: body.controller_id,
        name: body.name,
        rules_edition: body.rules_edition,
        revision: 1,
    })
}

fn insert(client: &mut Client, caller: &Caller, character: &Character) -> Result<(), ApiError> {
    execute(
        client,
        "INSERT INTO campaign.characters \
         (id, campaign_id, controller_id, name, rules_edition, revision) \
         VALUES ($1::text::uuid, $2::text::uuid, $3::text::uuid, $4, \
         $5::text::catalog.edition, $6::bigint)",
        &[
            &character.id,
            &character.campaign_id,
            &character.controller_id,
            &character.name,
            &edition_name(&character.rules_edition),
            &i64::from(character.revision),
        ],
        caller,
    )?;
    Ok(())
}

pub fn update(
    client: &mut Client,
    target: Target<'_>,
    body: PatchCharacter,
) -> Result<Character, ApiError> {
    let caller = target.scope.caller;
    access::require_dm(client, caller, target.scope.campaign_id)?;
    ensure_exists(client, target)?;
    let revision = body
        .expected_revision
        .checked_add(1)
        .ok_or_else(|| ApiError::invalid(caller, "expected_revision is too large"))?;
    let edition = apply_update(client, target, &body)?;
    Ok(Character {
        id: target.id.to_string(),
        campaign_id: target.scope.campaign_id.to_string(),
        controller_id: body.controller_id,
        name: body.name,
        rules_edition: edition,
        revision,
    })
}

/// The character and its trigger-created actor row change in one transaction, so assigning
/// or clearing a controller also moves the actor between DM-only and player visibility.
fn apply_update(
    client: &mut Client,
    target: Target<'_>,
    body: &PatchCharacter,
) -> Result<RulesEdition, ApiError> {
    let caller = target.scope.caller;
    let mut tx = client
        .transaction()
        .map_err(|error| ApiError::from_postgres(&error, caller))?;
    let row = tx
        .query_opt(
            UPDATE,
            &[
                &target.scope.campaign_id,
                &target.id,
                &body.name,
                &body.controller_id,
                &i64::from(body.expected_revision),
            ],
        )
        .map_err(|error| ApiError::from_postgres(&error, caller))?;
    let Some(row) = row else {
        return Err(ApiError::revision_conflict(caller));
    };
    tx.execute(
        UPDATE_ACTOR,
        &[
            &target.scope.campaign_id,
            &target.id,
            &body.name,
            &body.controller_id,
        ],
    )
    .map_err(|error| ApiError::from_postgres(&error, caller))?;
    let edition = edition_from(&row.get::<_, String>(0), caller)?;
    tx.commit()
        .map_err(|error| ApiError::from_postgres(&error, caller))?;
    Ok(edition)
}

/// A character owns an actor row created by a trigger, so both leave in one transaction.
/// Sheets, conditions or encounters that still reference the actor block the delete.
pub fn delete(client: &mut Client, target: Target<'_>) -> Result<(), ApiError> {
    let caller = target.scope.caller;
    access::require_dm(client, caller, target.scope.campaign_id)?;
    ensure_exists(client, target)?;
    let mut tx = client
        .transaction()
        .map_err(|error| ApiError::from_postgres(&error, caller))?;
    remove_actor_rows(&mut tx, target)?;
    tx.execute(
        "DELETE FROM campaign.characters \
         WHERE campaign_id = $1::text::uuid AND id = $2::text::uuid",
        &[&target.scope.campaign_id, &target.id],
    )
    .map_err(|error| ApiError::from_delete(&error, caller))?;
    tx.commit()
        .map_err(|error| ApiError::from_delete(&error, caller))
}

fn remove_actor_rows(
    tx: &mut postgres::Transaction<'_>,
    target: Target<'_>,
) -> Result<(), ApiError> {
    let caller = target.scope.caller;
    for table in ["actor_stats", "actor_state"] {
        delete_actor_table(tx, table, target)?;
    }
    tx.execute(
        "DELETE FROM campaign.actors \
         WHERE campaign_id = $1::text::uuid AND character_id = $2::text::uuid",
        &[&target.scope.campaign_id, &target.id],
    )
    .map_err(|error| ApiError::from_delete(&error, caller))?;
    Ok(())
}

fn delete_actor_table(
    tx: &mut postgres::Transaction<'_>,
    table: &str,
    target: Target<'_>,
) -> Result<(), ApiError> {
    let sql = format!(
        "DELETE FROM campaign.{table} s USING campaign.actors a \
         WHERE a.campaign_id = $1::text::uuid AND a.character_id = $2::text::uuid \
         AND s.campaign_id = a.campaign_id AND s.actor_id = a.id"
    );
    tx.execute(&sql, &[&target.scope.campaign_id, &target.id])
        .map_err(|error| ApiError::from_delete(&error, target.scope.caller))?;
    Ok(())
}

fn ensure_exists(client: &mut Client, target: Target<'_>) -> Result<(), ApiError> {
    let caller = target.scope.caller;
    let exists = client
        .query_opt(
            "SELECT 1 FROM campaign.characters \
             WHERE campaign_id = $1::text::uuid AND id = $2::text::uuid",
            &[&target.scope.campaign_id, &target.id],
        )
        .map_err(|error| ApiError::from_postgres(&error, caller))?;
    exists
        .map(|_| ())
        .ok_or_else(|| ApiError::not_found(caller, MISSING))
}

fn edition_name(edition: &RulesEdition) -> &'static str {
    match edition {
        RulesEdition::Dnd2014 => "dnd_2014",
        RulesEdition::Dnd2024 => "dnd_2024",
    }
}

fn edition_from(value: &str, caller: &Caller) -> Result<RulesEdition, ApiError> {
    match value {
        "dnd_2014" => Ok(RulesEdition::Dnd2014),
        "dnd_2024" => Ok(RulesEdition::Dnd2024),
        _ => Err(ApiError::new(
            INTERNAL,
            "internal",
            "campaign edition is not a known value",
            &caller.request_id,
        )),
    }
}
