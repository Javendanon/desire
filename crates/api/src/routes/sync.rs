//! Campaign synchronization endpoint: snapshot start and cursor-based catch-up.
use crate::{
    AppState,
    error::ApiError,
    extract::{ApiQuery, Caller},
    routes::{id_path, respond, scope},
    store,
};
use axum::{
    Json,
    extract::{Path, State},
};
use desire_core::contracts::transport::SyncBatch;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct SyncQuery {
    pub after: Option<u32>,
}

pub async fn batch(
    State(state): State<AppState>,
    caller: Caller,
    Path(campaign_id): Path<String>,
    ApiQuery(query): ApiQuery<SyncQuery>,
) -> Result<Json<SyncBatch>, ApiError> {
    let campaign_id = id_path(&caller, campaign_id, "campaign_id")?;
    respond(&state, caller.request_id.clone(), move |client| {
        store::sync::batch(client, scope(&caller, &campaign_id), query.after)
    })
    .await
}
