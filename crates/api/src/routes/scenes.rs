//! Scene endpoints. Collection writes accept an optional Idempotency-Key UUID.
use super::{Json, Path, State, StatusCode};

use crate::{
    AppState, db,
    error::ApiError,
    extract::{ApiJson, Caller},
    payloads::NewScene,
    routes::id_path,
    store,
};
use desire_core::contracts::campaign::Scene;

use crate::payloads::PatchScene;

list_handler!(scenes, Scene);
get_handler!(scenes, Scene, "scene_id");
update_handler!(scenes, Scene, PatchScene, "scene_id");

/// Scene creation accepts the idempotency key because D08 writes an outbox event.
pub async fn create(
    State(state): State<AppState>,
    caller: Caller,
    Path(campaign_id): Path<String>,
    ApiJson(body): ApiJson<NewScene>,
) -> Result<(StatusCode, Json<Scene>), ApiError> {
    let campaign_id = id_path(&caller, campaign_id, "campaign_id")?;
    let body = body.clean(&caller)?;
    let key = caller.idempotency_key.clone();
    let scene = db::blocking(&state.db, move |client| {
        let scope = crate::routes::scope(&caller, &campaign_id);
        store::scenes::create(client, scope, body, key)
    })
    .await?;
    Ok((StatusCode::CREATED, Json(scene)))
}
