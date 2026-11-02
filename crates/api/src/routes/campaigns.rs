//! Campaign collection and item endpoints.
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};

use crate::{
    AppState, db,
    error::ApiError,
    extract::{ApiJson, ApiQuery, Caller},
    payloads::{NewCampaign, PatchCampaign},
    query::{Page, PageBody, PageQuery},
    routes::{id_path, respond},
    store,
};
use desire_core::contracts::campaign::Campaign;

pub async fn list(
    State(state): State<AppState>,
    caller: Caller,
    ApiQuery(query): ApiQuery<PageQuery>,
) -> Result<Json<PageBody<Campaign>>, ApiError> {
    let page = Page::from_query(&query, &caller)?;
    respond(&state, move |client| {
        store::campaigns::list(client, &caller, page)
    })
    .await
}

pub async fn create(
    State(state): State<AppState>,
    caller: Caller,
    ApiJson(body): ApiJson<NewCampaign>,
) -> Result<(StatusCode, Json<Campaign>), ApiError> {
    let body = body.clean(&caller)?;
    let campaign = db::blocking(&state.db, move |client| {
        store::campaigns::create(client, &caller, body)
    })
    .await?;
    Ok((StatusCode::CREATED, Json(campaign)))
}

pub async fn get(
    State(state): State<AppState>,
    caller: Caller,
    Path(campaign_id): Path<String>,
) -> Result<Json<Campaign>, ApiError> {
    let campaign_id = id_path(&caller, campaign_id, "campaign_id")?;
    respond(&state, move |client| {
        let target = crate::routes::target(&caller, &campaign_id, &campaign_id);
        store::campaigns::get(client, target)
    })
    .await
}

pub async fn rename(
    State(state): State<AppState>,
    caller: Caller,
    Path(campaign_id): Path<String>,
    ApiJson(body): ApiJson<PatchCampaign>,
) -> Result<Json<Campaign>, ApiError> {
    let campaign_id = id_path(&caller, campaign_id, "campaign_id")?;
    let body = body.clean(&caller)?;
    respond(&state, move |client| {
        let target = crate::routes::target(&caller, &campaign_id, &campaign_id);
        store::campaigns::rename(client, target, body)
    })
    .await
}
