//! Ambient cookie authentication requires same-origin mutations, including logout.
use super::{service, session};
use crate::{AppState, error::ApiError, extract::request_id_from};
use axum::{
    extract::{Request, State},
    middleware::Next,
    response::{IntoResponse, Response},
};

pub async fn enforce(State(state): State<AppState>, request: Request, next: Next) -> Response {
    if let Err(error) = check(&state, &request) {
        return error.into_response();
    }
    next.run(request).await
}

fn check(state: &AppState, request: &Request) -> Result<(), ApiError> {
    if matches!(request.method().as_str(), "GET" | "HEAD" | "OPTIONS") {
        return Ok(());
    }
    let headers = request.headers();
    let origin = headers.get("origin");
    // A malformed cookie still counts as ambient credentials and requires Origin.
    let cookie_auth =
        session::cookie(headers, session::SESSION_COOKIE).map_or(true, |token| token.is_some());
    if origin.is_none() && !cookie_auth {
        return Ok(());
    }
    let expected = public_origin(state);
    let matches = origin
        .and_then(|value| value.to_str().ok())
        .zip(expected)
        .is_some_and(|(actual, expected)| actual == expected);
    if matches && headers.get_all("origin").iter().count() == 1 {
        return Ok(());
    }
    let mut error = service::unauthorized(&request_id_from(headers));
    error.status = axum::http::StatusCode::FORBIDDEN;
    error.code = "forbidden_origin";
    error.message = "mutations require the deployment's Origin".into();
    Err(error)
}

fn public_origin(state: &AppState) -> Option<String> {
    if let Some(oidc) = &state.oidc {
        return Some(oidc.settings.public_url.origin().ascii_serialization());
    }
    state
        .dev_identity
        .then(|| state.dev_origin.clone())
        .flatten()
}
