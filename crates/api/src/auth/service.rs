//! Account registration, login and session lookup over the identity repository.
use super::{
    credentials::{Credentials, unauthorized},
    password,
};
use crate::{
    db::{self, Db},
    error::ApiError,
};
use desire_core::contracts::{
    common::Id,
    transport::{AuthIdentity, AuthSession},
};
use desire_persistence::{Account, IdentityRepository, NewSession};
use postgres::Client;

const EXISTING_USERNAME: &str = "the username is already registered";
const BAD_LOGIN: &str = "username or password is incorrect";

pub async fn register(
    db: &Db,
    request_id: String,
    credentials: Credentials,
) -> Result<AuthSession, ApiError> {
    let password_hash = derive_password(credentials.password, &request_id).await?;
    let token = password::random_token()
        .map_err(|message| ApiError::internal_for(&request_id, &message))?;
    let session_hash = password::token_hash(&token);
    let registration = Registration {
        username: credentials.username,
        password_hash,
        token,
        session_hash,
    };
    let error_id = request_id.clone();
    db::blocking(db, request_id, move |client| {
        register_in(client, &error_id, registration)
    })
    .await
}

pub async fn login(
    db: &Db,
    request_id: String,
    credentials: Credentials,
) -> Result<AuthSession, ApiError> {
    let account = find_account(db, &request_id, &credentials.username).await?;
    let Some(account) = account else {
        verify_missing(&credentials.password, &request_id).await?;
        return Err(unauthorized(&request_id, BAD_LOGIN));
    };
    verify_password(&credentials.password, &account.password_hash, &request_id).await?;
    session_for_account(db, request_id, account).await
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
            username: account.username,
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

/// The raw token never reaches this layer: the extractor hashes it first.
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

async fn find_account(
    db: &Db,
    request_id: &str,
    username: &str,
) -> Result<Option<Account>, ApiError> {
    let username = username.to_string();
    let error_id = request_id.to_string();
    let blocking_id = request_id.to_string();
    db::blocking(db, blocking_id, move |client| {
        IdentityRepository::account_by_username(client, &username)
            .map_err(|error| ApiError::from_persistence_request(error, &error_id))
    })
    .await
}

async fn session_for_account(
    db: &Db,
    request_id: String,
    account: Account,
) -> Result<AuthSession, ApiError> {
    let token = password::random_token()
        .map_err(|message| ApiError::internal_for(&request_id, &message))?;
    let session_hash = password::token_hash(&token);
    let error_id = request_id.clone();
    db::blocking(db, request_id, move |client| {
        let session = NewSession {
            token_hash: &session_hash,
            account_id: &account.id,
        };
        let expires_at = IdentityRepository::create_session(client, &session)
            .map_err(|error| ApiError::from_persistence_request(error, &error_id))?;
        Ok(session_for(token, expires_at, &account))
    })
    .await
}

/// The account row and its first session share one registration input.
struct Registration {
    username: String,
    password_hash: String,
    token: String,
    session_hash: String,
}

fn register_in(
    client: &mut Client,
    request_id: &str,
    registration: Registration,
) -> Result<AuthSession, ApiError> {
    let account = Account {
        id: desire_persistence::next_id(client)
            .map_err(|error| ApiError::from_persistence_request(error, request_id))?,
        username: registration.username,
        password_hash: registration.password_hash,
    };
    let session = NewSession {
        token_hash: &registration.session_hash,
        account_id: &account.id,
    };
    let expires_at = IdentityRepository::register(client, &account, &session).map_err(|error| {
        if error.sqlstate.as_deref() == Some("23505") {
            return ApiError::new(
                crate::error::CONFLICT,
                "conflict",
                EXISTING_USERNAME,
                request_id,
            );
        }
        ApiError::from_persistence_request(error, request_id)
    })?;
    Ok(session_for(registration.token, expires_at, &account))
}

fn session_for(token: String, expires_at: String, account: &Account) -> AuthSession {
    AuthSession {
        token,
        token_type: "bearer".into(),
        expires_at,
        user_id: account.id.clone(),
        username: account.username.clone(),
    }
}

async fn derive_password(password: String, request_id: &str) -> Result<String, ApiError> {
    let error_id = request_id.to_string();
    tokio::task::spawn_blocking(move || password::hash_password(&password))
        .await
        .map_err(|_| ApiError::internal_for(&error_id, "password hashing task failed"))?
        .map_err(|message| ApiError::internal_for(request_id, &message))
}

async fn verify_password(password: &str, encoded: &str, request_id: &str) -> Result<(), ApiError> {
    let password = password.to_string();
    let encoded = encoded.to_string();
    let error_id = request_id.to_string();
    let valid = tokio::task::spawn_blocking(move || password::verify_password(&password, &encoded))
        .await
        .map_err(|_| ApiError::internal_for(&error_id, "password verification task failed"))?;
    if valid {
        return Ok(());
    }
    Err(unauthorized(request_id, BAD_LOGIN))
}

async fn verify_missing(password: &str, request_id: &str) -> Result<(), ApiError> {
    let password = password.to_string();
    let error_id = request_id.to_string();
    tokio::task::spawn_blocking(move || password::verify_missing_account(&password))
        .await
        .map_err(|_| ApiError::internal_for(&error_id, "password verification task failed"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_account_never_authenticates() {
        assert!(!password::verify_missing_account("anything"));
    }

    #[test]
    fn invalid_credentials_use_the_shared_error_shape() {
        let error = unauthorized("request", "bad login");
        assert_eq!(error.code, "unauthenticated");
    }
}
