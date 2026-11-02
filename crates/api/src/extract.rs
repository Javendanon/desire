//! Caller identity and JSON extraction with one failure shape.
//!
//! `x-desire-user` is a development seam: D10 replaces it with authenticated identity.
//! It is accepted only because the server refuses non-loopback binds without an explicit
//! opt-in (see `main.rs`).
use crate::{
    error::{ApiError, INVALID, UNAUTHORIZED},
    ids,
};
use axum::{
    Json,
    extract::{FromRequest, FromRequestParts, Request},
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
}

impl<S: Send + Sync> FromRequestParts<S> for Caller {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let request_id = request_id_from(&parts.headers);
        Ok(Self {
            user_id: caller_id(&parts.headers, &request_id)?,
            idempotency_key: idempotency_key(&parts.headers, &request_id)?,
            request_id,
        })
    }
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
    headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            ids::validate(value, "idempotency-key")
                .map_err(|message| ApiError::new(INVALID, "invalid_request", message, request_id))
        })
        .transpose()
}

fn request_id_from(headers: &HeaderMap) -> String {
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
