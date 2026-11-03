//! Character application operations; storage and actor transactions belong to persistence.
use super::{Scope, Target, next_id, record_target};
use crate::{
    access,
    error::ApiError,
    payloads::{NewCharacter, PatchCharacter},
};
use desire_core::contracts::campaign::Character;
use desire_persistence::{Audience, CharacterRepository, CharacterUpdate};
use postgres::Client;

const MISSING: &str = "character not found";

visible_reads!(Character, CharacterRepository, list, get, MISSING);

pub fn create(
    client: &mut Client,
    scope: Scope<'_>,
    body: NewCharacter,
) -> Result<Character, ApiError> {
    access::require_dm(client, scope.caller, scope.campaign_id)?;
    let character = Character {
        id: next_id(client, scope.caller)?,
        campaign_id: scope.campaign_id.to_owned(),
        controller_id: body.controller_id,
        name: body.name,
        rules_edition: body.rules_edition,
        revision: 1,
    };
    CharacterRepository::create(client, &character)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?;
    Ok(character)
}

pub fn update(
    client: &mut Client,
    target: Target<'_>,
    body: PatchCharacter,
) -> Result<Character, ApiError> {
    let caller = target.scope.caller;
    access::require_dm(client, caller, target.scope.campaign_id)?;
    ensure_exists(client, target)?;
    body.expected_revision
        .checked_add(1)
        .ok_or_else(|| ApiError::invalid(caller, "expected_revision is too large"))?;
    let update = CharacterUpdate {
        target: record_target(target),
        name: &body.name,
        controller_id: &body.controller_id,
        expected_revision: body.expected_revision,
    };
    CharacterRepository::update(client, &update)
        .map_err(|error| ApiError::from_persistence(error, caller))?
        .ok_or_else(|| ApiError::revision_conflict(caller))
}

pub fn delete(client: &mut Client, target: Target<'_>) -> Result<(), ApiError> {
    let caller = target.scope.caller;
    access::require_dm(client, caller, target.scope.campaign_id)?;
    ensure_exists(client, target)?;
    CharacterRepository::delete(client, record_target(target))
        .map_err(|error| ApiError::from_persistence_delete(error, caller))?;
    Ok(())
}

fn ensure_exists(client: &mut Client, target: Target<'_>) -> Result<(), ApiError> {
    CharacterRepository::get(client, record_target(target), Audience::All)
        .map_err(|error| ApiError::from_persistence(error, target.scope.caller))?
        .map(|_| ())
        .ok_or_else(|| ApiError::not_found(target.scope.caller, MISSING))
}
