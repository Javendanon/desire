//! Character application operations; storage and actor transactions belong to persistence.
use super::{Scope, Target, next_id, next_revision, record_target, updated};
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
    next_revision(body.expected_revision, caller)?;
    let update = CharacterUpdate {
        target: record_target(target),
        name: &body.name,
        controller_id: &body.controller_id,
        expected_revision: body.expected_revision,
    };
    updated(CharacterRepository::update(client, &update), caller)
}

pub fn delete(client: &mut Client, target: Target<'_>) -> Result<(), ApiError> {
    let caller = target.scope.caller;
    access::require_dm(client, caller, target.scope.campaign_id)?;
    let removed = CharacterRepository::delete(client, record_target(target))
        .map_err(|error| ApiError::from_persistence_delete(error, caller))?;
    if !removed {
        return Err(ApiError::not_found(caller, MISSING));
    }
    Ok(())
}

fn ensure_exists(client: &mut Client, target: Target<'_>) -> Result<(), ApiError> {
    CharacterRepository::get(client, record_target(target), Audience::All)
        .map_err(|error| ApiError::from_persistence(error, target.scope.caller))?
        .map(|_| ())
        .ok_or_else(|| ApiError::not_found(target.scope.caller, MISSING))
}
