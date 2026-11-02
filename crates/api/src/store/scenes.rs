//! Scene CRUD. Writes reuse the D08 transactional outbox and idempotency path.
use super::{Scope, Target, next_id};
use crate::{
    access,
    error::ApiError,
    payloads::{NewScene, PatchScene},
};
use desire_core::contracts::campaign::Scene;
use desire_persistence::{SceneRepository, SceneWrite};
use postgres::Client;

const LIST: &str = "SELECT to_jsonb(s) FROM campaign.scenes s \
     WHERE s.campaign_id = $1::text::uuid ORDER BY s.id LIMIT $2 OFFSET $3";

collection_crud!(Scene, LIST, "campaign.scenes", "scene not found");

pub fn get(client: &mut Client, target: Target<'_>) -> Result<Scene, ApiError> {
    let scope = target.scope;
    access::require_member(client, scope.caller, scope.campaign_id)?;
    SceneRepository::get(client, scope.campaign_id, target.id)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?
        .ok_or_else(|| ApiError::not_found(scope.caller, "scene not found"))
}

/// Scenes route their writes through the D08 outbox, so they keep an explicit entry point.
pub fn create(
    client: &mut Client,
    scope: Scope<'_>,
    body: NewScene,
    idempotency_key: Option<String>,
) -> Result<Scene, ApiError> {
    access::require_dm(client, scope.caller, scope.campaign_id)?;
    let scene = Scene {
        id: next_id(client, scope.caller)?,
        campaign_id: scope.campaign_id.to_string(),
        map_version_id: body.map_version_id,
        name: body.name,
        revision: 1,
    };
    let event_id = next_id(client, scope.caller)?;
    let write = SceneWrite {
        scene: scene.clone(),
        expected_revision: None,
        event_id: event_id.clone(),
        key: idempotency_key.unwrap_or(event_id),
    };
    SceneRepository::save_and_enqueue(client, &write)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?;
    Ok(scene)
}

pub fn update(
    client: &mut Client,
    target: Target<'_>,
    body: PatchScene,
) -> Result<Scene, ApiError> {
    let caller = target.scope.caller;
    access::require_dm(client, caller, target.scope.campaign_id)?;
    get(client, target)?;
    let revision = body
        .expected_revision
        .checked_add(1)
        .ok_or_else(|| ApiError::invalid(caller, "expected_revision is too large"))?;
    let scene = Scene {
        id: target.id.to_string(),
        campaign_id: target.scope.campaign_id.to_string(),
        map_version_id: body.map_version_id,
        name: body.name,
        revision,
    };
    let write = SceneWrite {
        scene: scene.clone(),
        expected_revision: Some(body.expected_revision),
        event_id: next_id(client, caller)?,
        key: next_id(client, caller)?,
    };
    SceneRepository::save_and_enqueue(client, &write)
        .map_err(|error| ApiError::from_persistence(error, caller))?;
    Ok(scene)
}
