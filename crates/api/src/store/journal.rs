//! Journal operations coordinate authorization and typed storage.
use super::{Scope, Target, check_revision, next_id, record_target};
use crate::{
    access,
    error::ApiError,
    payloads::{NewJournal, PatchJournal},
};
use desire_core::contracts::{campaign::JournalEntry, common::Visibility};
use desire_persistence::{JournalUpdate, NotesRepository};
use postgres::Client;

visible_reads!(
    JournalEntry,
    NotesRepository,
    list_journal,
    get_journal,
    "journal entry not found"
);

pub fn create(
    client: &mut Client,
    scope: Scope<'_>,
    body: NewJournal,
) -> Result<JournalEntry, ApiError> {
    access::require_member(client, scope.caller, scope.campaign_id)?;
    if body.visibility == Visibility::Dm {
        access::require_dm(client, scope.caller, scope.campaign_id)?;
    }
    let entry = JournalEntry {
        id: next_id(client, scope.caller)?,
        campaign_id: scope.campaign_id.to_string(),
        session_id: body.session_id,
        body: body.body,
        visibility: body.visibility,
        revision: 1,
    };
    NotesRepository::create_journal(client, &entry)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?;
    Ok(entry)
}

pub fn update(
    client: &mut Client,
    target: Target<'_>,
    body: PatchJournal,
) -> Result<JournalEntry, ApiError> {
    let caller = target.scope.caller;
    access::require_dm(client, caller, target.scope.campaign_id)?;
    get(client, target)?;
    let update = JournalUpdate {
        target: record_target(target),
        body: &body.body,
        visibility: body.visibility,
        expected_revision: body.expected_revision,
    };
    let changed = NotesRepository::update_journal(client, &update)
        .map_err(|error| ApiError::from_persistence(error, caller))?;
    check_revision(changed, caller)?;
    get(client, target)
}

pub fn delete(client: &mut Client, target: Target<'_>) -> Result<(), ApiError> {
    let caller = target.scope.caller;
    access::require_dm(client, caller, target.scope.campaign_id)?;
    let removed = NotesRepository::delete_journal(client, record_target(target))
        .map_err(|error| ApiError::from_persistence_delete(error, caller))?;
    if !removed {
        return Err(ApiError::not_found(caller, "journal entry not found"));
    }
    Ok(())
}
