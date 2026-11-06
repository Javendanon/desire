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
    if origin.is_none() && session::cookie(headers, session::SESSION_COOKIE).is_none() {
        return Ok(());
    }
    let expected = state
        .oidc
        .as_ref()
        .map(|oidc| oidc.settings.public_url.origin());
    let matches = origin
        .and_then(|value| value.to_str().ok())
        .zip(expected)
        .is_some_and(|(actual, expected)| actual == expected.ascii_serialization());
    if matches && headers.get_all("origin").iter().count() == 1 {
        return Ok(());
    }
    let mut error = service::unauthorized(&request_id_from(headers));
    error.status = axum::http::StatusCode::FORBIDDEN;
    error.code = "forbidden_origin";
    error.message = "mutations require the deployment's Origin".into();
    Err(error)
}
