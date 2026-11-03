//! Scene CRUD. Writes reuse the D08 transactional outbox and idempotency path.
use super::{Scope, Target, next_id};
use crate::{
    access,
    error::ApiError,
    payloads::{NewScene, PatchScene},
};
use desire_core::contracts::campaign::Scene;
use desire_persistence::{ErrorKind, SceneRepository, SceneWrite};
use postgres::Client;

collection_list!(Scene, SceneRepository, list);

pub fn get(client: &mut Client, target: Target<'_>) -> Result<Scene, ApiError> {
    let scope = target.scope;
    access::require_member(client, scope.caller, scope.campaign_id)?;
    SceneRepository::get(client, scope.campaign_id, target.id)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?
        .ok_or_else(|| ApiError::not_found(scope.caller, "scene not found"))
}

/// Scenes route their writes through the D08 outbox, so they keep an explicit entry point.
/// A key that already stored a write replays it, with the original scene and event IDs.
pub fn create(
    client: &mut Client,
    scope: Scope<'_>,
    body: NewScene,
    idempotency_key: Option<String>,
) -> Result<Scene, ApiError> {
    access::require_dm(client, scope.caller, scope.campaign_id)?;
    if let Some(key) = idempotency_key.as_deref()
        && let Some(scene) = replay(client, scope, &body, key)?
    {
        return Ok(scene);
    }
    let write = draft(client, scope, &body, idempotency_key.clone())?;
    if let Err(error) = SceneRepository::save_and_enqueue(client, &write) {
        // A second instance may commit after preflight. The failed transaction has ended,
        // so replay now sees its committed result even under REPEATABLE READ.
        let race = error.kind == ErrorKind::Conflict || error.sqlstate.as_deref() == Some("40001");
        if idempotency_key.is_some()
            && race
            && let Some(scene) = replay(client, scope, &body, &write.key)?
        {
            return Ok(scene);
        }
        return Err(ApiError::from_persistence(error, scope.caller));
    }
    Ok(write.scene)
}

fn draft(
    client: &mut Client,
    scope: Scope<'_>,
    body: &NewScene,
    key: Option<String>,
) -> Result<SceneWrite, ApiError> {
    let scene = Scene {
        id: next_id(client, scope.caller)?,
        campaign_id: scope.campaign_id.to_string(),
        map_version_id: body.map_version_id.clone(),
        name: body.name.clone(),
        revision: 1,
    };
    let event_id = next_id(client, scope.caller)?;
    Ok(SceneWrite {
        scene,
        expected_revision: None,
        key: key.unwrap_or_else(|| event_id.clone()),
        event_id,
    })
}

/// Only the client-supplied fields decide whether a retry is the same request.
fn replay(
    client: &mut Client,
    scope: Scope<'_>,
    body: &NewScene,
    key: &str,
) -> Result<Option<Scene>, ApiError> {
    let stored = SceneRepository::replay(client, scope.campaign_id, key)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?;
    let Some((scene, _event_id)) = stored else {
        return Ok(None);
    };
    if scene.name != body.name || scene.map_version_id != body.map_version_id {
        return Err(ApiError::idempotency_conflict(scope.caller));
    }
    Ok(Some(scene))
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
