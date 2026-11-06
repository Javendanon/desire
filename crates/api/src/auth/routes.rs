//! Public registration and login plus authenticated identity and logout.
use super::{credentials::Credentials, service};
use crate::{
    AppState,
    error::ApiError,
    extract::{ApiJson, Caller, request_id_from},
};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use desire_core::contracts::transport::{AuthIdentity, AuthSession};

pub async fn start() -> Result<StatusCode, ApiError> {
    Err(ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "oidc_unavailable",
        "OpenID Connect is not configured",
        crate::ids::request_id(),
    ))
}

pub async fn register(
    State(state): State<AppState>,
    headers: HeaderMap,
    ApiJson(body): ApiJson<Credentials>,
) -> Result<(StatusCode, Json<AuthSession>), ApiError> {
    let request_id = request_id_from(&headers);
    let credentials = body.clean(&request_id)?;
    let session = service::register(&state.db, request_id, credentials).await?;
    Ok((StatusCode::CREATED, Json(session)))
}

pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    ApiJson(body): ApiJson<Credentials>,
) -> Result<Json<AuthSession>, ApiError> {
    let request_id = request_id_from(&headers);
    let credentials = body.clean(&request_id)?;
    Ok(Json(
        service::login(&state.db, request_id, credentials).await?,
    ))
}

pub async fn identity(
    State(state): State<AppState>,
    caller: Caller,
) -> Result<Json<AuthIdentity>, ApiError> {
    Ok(Json(service::identity(&state.db, &caller).await?))
}

pub async fn logout(State(state): State<AppState>, caller: Caller) -> Result<StatusCode, ApiError> {
    service::logout(&state.db, &caller).await?;
    Ok(StatusCode::NO_CONTENT)
}
