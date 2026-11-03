//! Account and opaque-session storage. Password policy and HTTP belong to the API.
use crate::{Error, error::Context};
use postgres::{Client, GenericClient};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Account {
    pub id: String,
    pub username: String,
    pub password_hash: String,
}

#[derive(Clone, Debug)]
pub struct NewSession<'a> {
    pub token_hash: &'a str,
    pub account_id: &'a str,
}

pub struct IdentityRepository;

impl IdentityRepository {
    pub fn create_account(client: &mut Client, account: &Account) -> Result<(), Error> {
        crate::records::insert(client, "identity.accounts", account)
    }

    /// An account and its first session exist together, so registration has one outcome.
    pub fn register(
        client: &mut Client,
        account: &Account,
        session: &NewSession<'_>,
    ) -> Result<String, Error> {
        let mut tx = client
            .transaction()
            .context("begin identity registration")?;
        crate::records::insert(&mut tx, "identity.accounts", account)?;
        let expires = session_in(&mut tx, session)?;
        tx.commit().context("commit identity registration")?;
        Ok(expires)
    }

    pub fn account_by_username(
        client: &mut Client,
        username: &str,
    ) -> Result<Option<Account>, Error> {
        client
            .query_opt(
                concat!(
                    "SELECT jsonb_build_object('id', id::text, 'username', username, ",
                    "'password_hash', password_hash) FROM identity.accounts ",
                    "WHERE username = $1"
                ),
                &[&username],
            )
            .context("read account by username")?
            .map(crate::records::decode)
            .transpose()
    }

    pub fn account_by_id(client: &mut Client, id: &str) -> Result<Option<Account>, Error> {
        client
            .query_opt(
                concat!(
                    "SELECT jsonb_build_object('id', id::text, 'username', username, ",
                    "'password_hash', password_hash) FROM identity.accounts ",
                    "WHERE id = $1::text::uuid"
                ),
                &[&id],
            )
            .context("read account by id")?
            .map(crate::records::decode)
            .transpose()
    }

    pub fn create_session(client: &mut Client, session: &NewSession<'_>) -> Result<String, Error> {
        session_in(client, session)
    }

    pub fn session_account(
        client: &mut Client,
        token_hash: &str,
    ) -> Result<Option<(String, String)>, Error> {
        client
            .query_opt(
                concat!(
                    "SELECT a.id::text, a.username FROM identity.sessions s ",
                    "JOIN identity.accounts a ON a.id = s.account_id ",
                    "WHERE s.token_hash = $1 AND s.expires_at > now()"
                ),
                &[&token_hash],
            )
            .context("read identity session")
            .map(|row| row.map(|row| (row.get(0), row.get(1))))
    }

    pub fn revoke_session(client: &mut Client, token_hash: &str) -> Result<bool, Error> {
        client
            .execute(
                "DELETE FROM identity.sessions WHERE token_hash = $1",
                &[&token_hash],
            )
            .context("revoke identity session")
            .map(|affected| affected != 0)
    }
}

fn session_in(client: &mut impl GenericClient, session: &NewSession<'_>) -> Result<String, Error> {
    client
        .query_one(
            concat!(
                "INSERT INTO identity.sessions (token_hash, account_id, expires_at) ",
                "VALUES ($1, $2::text::uuid, now() + interval '12 hours') ",
                "RETURNING expires_at::text"
            ),
            &[&session.token_hash, &session.account_id],
        )
        .context("create identity session")
        .map(|row| row.get(0))
}
