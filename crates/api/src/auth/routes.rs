//! Browser OIDC redirects, current identity and server-side session revocation.
use super::{
    oidc::{Callback, Oidc},
    service, session,
};
use crate::{
    AppState,
    error::ApiError,
    extract::{ApiQuery, Caller, request_id_from},
};
use axum::{
    Json,
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Redirect, Response},
};
use desire_core::contracts::transport::AuthIdentity;
use serde::Deserialize;
use std::net::SocketAddr;

fn configured<'a>(state: &'a AppState, request_id: &str) -> Result<&'a Oidc, ApiError> {
    state.oidc.as_deref().ok_or_else(|| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "oidc_unavailable",
            "OpenID Connect is not configured",
            request_id,
        )
    })
}

pub async fn start(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let request_id = request_id_from(&headers);
    let oidc = configured(&state, &request_id)?;
    let client_ip = oidc.settings.client_ip(&headers, peer).map_err(|message| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_client_ip",
            message,
            &request_id,
        )
    })?;
    let authorization = oidc.begin(client_ip, &request_id)?;
    let mut response = Redirect::to(&authorization.url).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        session::set_cookie(
            &authorization.cookie_name,
            &authorization.browser,
            session::LOGIN_SECONDS,
        ),
    );
    Ok(response)
}

#[derive(Deserialize)]
pub struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
}

impl CallbackQuery {
    fn bind(self, headers: &HeaderMap, request_id: &str) -> Result<Callback, ApiError> {
        let state = self
            .state
            .ok_or_else(|| service::unauthorized(request_id))?;
        let cookie_name = session::login_cookie(&state);
        let browser = session::cookie(headers, &cookie_name)
            .map_err(|_| service::unauthorized(request_id))?
            .ok_or_else(|| service::unauthorized(request_id))?;
        Ok(Callback {
            code: self.code.unwrap_or_default(),
            state,
            browser: browser.into(),
        })
    }
}

pub async fn callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    ApiQuery(query): ApiQuery<CallbackQuery>,
) -> Response {
    let request_id = request_id_from(&headers);
    let cookie_name = query.state.as_deref().map(session::login_cookie);
    let mut response = finish(&state, &headers, (query, request_id))
        .await
        .unwrap_or_else(IntoResponse::into_response);
    if let Some(name) = cookie_name {
        response
            .headers_mut()
            .append(header::SET_COOKIE, session::set_cookie(&name, "", 0));
    }
    response
}

async fn finish(
    state: &AppState,
    headers: &HeaderMap,
    input: (CallbackQuery, String),
) -> Result<Response, ApiError> {
    let (query, request_id) = input;
    let oidc = configured(state, &request_id)?;
    let callback = query.bind(headers, &request_id)?;
    let identity = oidc.complete(callback, &request_id).await?;
    let token = service::sign_in(&state.db, request_id, identity).await?;
    let mut response = Redirect::to(oidc.settings.public_url.as_str()).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        session::set_cookie(session::SESSION_COOKIE, &token, session::SESSION_SECONDS),
    );
    Ok(response)
}

pub async fn identity(
    State(state): State<AppState>,
    caller: Caller,
) -> Result<Json<AuthIdentity>, ApiError> {
    Ok(Json(service::identity(&state.db, &caller).await?))
}

pub async fn logout(State(state): State<AppState>, caller: Caller) -> Result<Response, ApiError> {
    service::logout(&state.db, &caller).await?;
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        session::set_cookie(session::SESSION_COOKIE, "", 0),
    );
    Ok(response)
}

pub async fn no_store(request: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
        .headers_mut()
        .insert("referrer-policy", "no-referrer".parse().unwrap());
    response
}
