//! Campaign membership endpoints.
use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;

use crate::{
    AppState, db,
    error::ApiError,
    extract::{ApiJson, Caller},
    payloads::NewMember,
    query::{Page, PageBody, PageQuery},
    routes::{id_path, respond},
    store,
};
use desire_core::contracts::campaign::Membership;

pub async fn list(
    State(state): State<AppState>,
    caller: Caller,
    Path(campaign_id): Path<String>,
    Query(query): Query<PageQuery>,
) -> Result<Json<PageBody<Membership>>, ApiError> {
    let campaign_id = id_path(&caller, campaign_id, "campaign_id")?;
    let page = Page::from_query(&query, &caller)?;
    respond(&state, move |client| {
        let scope = crate::routes::scope(&caller, &campaign_id);
        store::members::list(client, scope, page)
    })
    .await
}

pub async fn add(
    State(state): State<AppState>,
    caller: Caller,
    Path(campaign_id): Path<String>,
    ApiJson(body): ApiJson<NewMember>,
) -> Result<(StatusCode, Json<Membership>), ApiError> {
    let campaign_id = id_path(&caller, campaign_id, "campaign_id")?;
    let body = body.clean(&caller)?;
    let membership = db::blocking(&state.db, move |client| {
        let scope = crate::routes::scope(&caller, &campaign_id);
        store::members::add(client, scope, body)
    })
    .await?;
    Ok((StatusCode::CREATED, Json(membership)))
}

#[derive(serde::Deserialize)]
pub struct MemberPath {
    campaign_id: String,
    user_id: String,
}

pub async fn remove(
    State(state): State<AppState>,
    caller: Caller,
    Path(path): Path<MemberPath>,
) -> Result<StatusCode, ApiError> {
    let (campaign_id, user_id) =
        crate::routes::pair_path(&caller, path.campaign_id, path.user_id, "user_id")?;
    db::blocking(&state.db, move |client| {
        let target = crate::routes::target(&caller, &campaign_id, &user_id);
        store::members::remove(client, target)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
