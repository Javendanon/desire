//! Caller identity and JSON extraction with one failure shape.
//!
//! An opaque cookie session is the production identity. `x-desire-user` remains an
//! explicit dev/test seam and is ignored when `AppState::dev_identity` is false.
use crate::{
    AppState,
    auth::{service, session},
    error::{ApiError, INVALID, UNAUTHORIZED},
    ids,
};
use axum::{
    Json,
    extract::{FromRequest, FromRequestParts, Query, Request},
    http::{HeaderMap, request::Parts},
};
use desire_core::contracts::common::Id;
use serde::de::DeserializeOwned;

const CALLER_HEADER: &str = "x-desire-user";
const REQUEST_ID_HEADER: &str = "x-request-id";

#[derive(Debug, Clone)]
pub struct Caller {
    pub user_id: Id,
    pub request_id: String,
    pub idempotency_key: Option<Id>,
    /// Only the digest of the presented token, so logout can revoke this session.
    pub session_hash: Option<String>,
}

impl FromRequestParts<AppState> for Caller {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let request_id = request_id_from(&parts.headers);
        let (user_id, session_hash) = identity(&parts.headers, state, &request_id).await?;
        Ok(Self {
            user_id,
            idempotency_key: idempotency_key(&parts.headers, &request_id)?,
            request_id,
            session_hash,
        })
    }
}

async fn identity(
    headers: &HeaderMap,
    state: &AppState,
    request_id: &str,
) -> Result<(Id, Option<String>), ApiError> {
    if headers.contains_key("cookie") {
        let token = session::cookie(headers, session::SESSION_COOKIE)
            .filter(|token| session::is_token(token))
            .ok_or_else(|| service::unauthorized(request_id))?;
        let hash = session::token_hash(token);
        let user_id = service::session_user(&state.db, hash.clone(), request_id.to_string())
            .await?
            .ok_or_else(|| {
                ApiError::new(
                    UNAUTHORIZED,
                    "unauthenticated",
                    "the session is invalid or expired",
                    request_id,
                )
            })?;
        return Ok((user_id, Some(hash)));
    }
    if state.dev_identity {
        return Ok((caller_id(headers, request_id)?, None));
    }
    Err(ApiError::new(
        UNAUTHORIZED,
        "unauthenticated",
        "a session cookie is required",
        request_id,
    ))
}

fn caller_id(headers: &HeaderMap, request_id: &str) -> Result<Id, ApiError> {
    let raw = headers
        .get(CALLER_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            ApiError::new(
                UNAUTHORIZED,
                "unauthenticated",
                "the x-desire-user header is required",
                request_id,
            )
        })?;
    ids::validate(raw, "x-desire-user")
        .map_err(|message| ApiError::new(UNAUTHORIZED, "unauthenticated", message, request_id))
}

fn idempotency_key(headers: &HeaderMap, request_id: &str) -> Result<Option<Id>, ApiError> {
    let Some(value) = headers.get("idempotency-key") else {
        return Ok(None);
    };
    let value = value.to_str().map_err(|_| {
        ApiError::new(
            INVALID,
            "invalid_request",
            "idempotency-key must be ASCII",
            request_id,
        )
    })?;
    ids::validate(value, "idempotency-key")
        .map(Some)
        .map_err(|message| ApiError::new(INVALID, "invalid_request", message, request_id))
}

pub(crate) fn request_id_from(headers: &HeaderMap) -> String {
    headers
        .get(REQUEST_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|value| ids::is_id(value))
        .map(str::to_owned)
        .unwrap_or_else(ids::request_id)
}

/// JSON extraction that maps syntax and type failures to the shared error shape.
pub struct ApiJson<T>(pub T);

impl<T, S> FromRequest<S> for ApiJson<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        let request_id = request_id_from(request.headers());
        let Json(value) = Json::<T>::from_request(request, state)
            .await
            .map_err(|rejection| {
                ApiError::new(
                    INVALID,
                    "invalid_request",
                    rejection.body_text(),
                    request_id,
                )
            })?;
        Ok(Self(value))
    }
}

/// Query extraction that maps unparsable values to the shared error shape, so a client
/// always receives a `code` and a `request_id` instead of a plain-text rejection.
pub struct ApiQuery<T>(pub T);

impl<T, S> FromRequestParts<S> for ApiQuery<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let request_id = request_id_from(&parts.headers);
        Query::<T>::from_request_parts(parts, state)
            .await
            .map(|Query(value)| Self(value))
            .map_err(|rejection| {
                ApiError::new(
                    INVALID,
                    "invalid_request",
                    rejection.body_text(),
                    request_id,
                )
            })
    }
}
