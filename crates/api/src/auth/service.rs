//! Verified OIDC identities become opaque sessions; callers never receive provider tokens.
use super::{oidc::VerifiedIdentity, session};
use crate::{
    db::{self, Db},
    error::ApiError,
};
use desire_core::contracts::{common::Id, transport::AuthIdentity};
use desire_persistence::{Account, IdentityRepository};

pub fn unauthorized(request_id: &str) -> ApiError {
    ApiError::new(
        axum::http::StatusCode::UNAUTHORIZED,
        "unauthenticated",
        "the authentication request is invalid or expired",
        request_id,
    )
}

pub async fn sign_in(
    db: &Db,
    request_id: String,
    identity: VerifiedIdentity,
) -> Result<String, ApiError> {
    let token =
        session::random_token().map_err(|message| ApiError::internal_for(&request_id, &message))?;
    let hash = session::token_hash(&token);
    let error_id = request_id.clone();
    db::blocking(db, request_id, move |client| {
        let account = Account {
            id: desire_persistence::next_id(client)
                .map_err(|error| ApiError::from_persistence_request(error, &error_id))?,
            issuer: identity.issuer,
            subject: identity.subject,
            email: identity.email,
        };
        IdentityRepository::sign_in(client, &account, &hash)
            .map_err(|error| ApiError::from_persistence_request(error, &error_id))?;
        Ok(token)
    })
    .await
}

pub async fn identity(db: &Db, caller: &crate::extract::Caller) -> Result<AuthIdentity, ApiError> {
    let user_id = caller.user_id.clone();
    let request_id = caller.request_id.clone();
    let error_id = request_id.clone();
    db::blocking(db, request_id, move |client| {
        let account = IdentityRepository::account_by_id(client, &user_id)
            .map_err(|error| ApiError::from_persistence_request(error, &error_id))?
            .ok_or_else(|| ApiError::not_found_for(&error_id, "account not found"))?;
        Ok(AuthIdentity {
            user_id: account.id,
            email: account.email,
        })
    })
    .await
}

pub async fn logout(db: &Db, caller: &crate::extract::Caller) -> Result<(), ApiError> {
    let Some(token_hash) = caller.session_hash.clone() else {
        return Ok(());
    };
    let request_id = caller.request_id.clone();
    let error_id = request_id.clone();
    db::blocking(db, request_id, move |client| {
        IdentityRepository::revoke_session(client, &token_hash)
            .map_err(|error| ApiError::from_persistence_request(error, &error_id))?;
        Ok(())
    })
    .await
}

/// The extractor passes only a digest, never the session cookie itself.
pub async fn session_user(
    db: &Db,
    token_hash: String,
    request_id: String,
) -> Result<Option<Id>, ApiError> {
    let error_id = request_id.clone();
    db::blocking(db, request_id, move |client| {
        IdentityRepository::session_account(client, &token_hash)
            .map(|account| account.map(|(user_id, _)| user_id))
            .map_err(|error| ApiError::from_persistence_request(error, &error_id))
    })
    .await
}
