//! Knowledge operations coordinate authorization and typed storage.
use super::{Scope, Target, check_revision, next_id, record_target};
use crate::{
    access,
    error::ApiError,
    payloads::{NewKnowledge, PatchKnowledge},
};
use desire_core::contracts::campaign::CampaignKnowledge;
use desire_persistence::{KnowledgeUpdate, NotesRepository};
use postgres::Client;

visible_reads!(
    CampaignKnowledge,
    NotesRepository,
    list_knowledge,
    get_knowledge,
    "knowledge entry not found"
);

pub fn create(
    client: &mut Client,
    scope: Scope<'_>,
    body: NewKnowledge,
) -> Result<CampaignKnowledge, ApiError> {
    access::require_dm(client, scope.caller, scope.campaign_id)?;
    let entry = CampaignKnowledge {
        id: next_id(client, scope.caller)?,
        campaign_id: scope.campaign_id.to_string(),
        title: body.title,
        body: body.body,
        visibility: body.visibility,
        revision: 1,
        provenance: body.provenance,
    };
    NotesRepository::create_knowledge(client, &entry)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?;
    Ok(entry)
}

pub fn update(
    client: &mut Client,
    target: Target<'_>,
    body: PatchKnowledge,
) -> Result<CampaignKnowledge, ApiError> {
    let caller = target.scope.caller;
    access::require_dm(client, caller, target.scope.campaign_id)?;
    get(client, target)?;
    let update = KnowledgeUpdate {
        target: record_target(target),
        title: &body.title,
        body: &body.body,
        visibility: body.visibility,
        expected_revision: body.expected_revision,
        provenance: &body.provenance,
    };
    let changed = NotesRepository::update_knowledge(client, &update)
        .map_err(|error| ApiError::from_persistence(error, caller))?;
    check_revision(changed, caller)?;
    get(client, target)
}

pub fn delete(client: &mut Client, target: Target<'_>) -> Result<(), ApiError> {
    let caller = target.scope.caller;
    access::require_dm(client, caller, target.scope.campaign_id)?;
    let removed = NotesRepository::delete_knowledge(client, record_target(target))
        .map_err(|error| ApiError::from_persistence_delete(error, caller))?;
    if !removed {
        return Err(ApiError::not_found(caller, "knowledge entry not found"));
    }
    Ok(())
}
