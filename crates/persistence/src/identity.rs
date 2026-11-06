//! Stable OIDC identities and hashed, expiring sessions; email never selects an account.
use crate::{Error, error::Context};
use postgres::{Client, GenericClient};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Account {
    pub id: String,
    pub issuer: String,
    pub subject: String,
    pub email: String,
}

#[derive(Clone, Debug)]
pub struct NewSession<'a> {
    pub token_hash: &'a str,
    pub account_id: &'a str,
}

pub struct IdentityRepository;

impl IdentityRepository {
    /// Concurrent callbacks converge on (issuer, subject), never on display email.
    pub fn sign_in(client: &mut Client, account: &Account, hash: &str) -> Result<(), Error> {
        let mut tx = client.transaction().context("begin OIDC sign-in")?;
        let row = tx
            .query_one(
                concat!(
                    "INSERT INTO identity.accounts (id, issuer, subject, email) ",
                    "VALUES ($1::text::uuid, $2, $3, $4) ",
                    "ON CONFLICT (issuer, subject) DO UPDATE SET email = EXCLUDED.email ",
                    "RETURNING id::text"
                ),
                &[
                    &account.id,
                    &account.issuer,
                    &account.subject,
                    &account.email,
                ],
            )
            .context("upsert OIDC identity")?;
        let id: String = row.get(0);
        session_in(
            &mut tx,
            &NewSession {
                token_hash: hash,
                account_id: &id,
            },
        )?;
        tx.commit().context("commit OIDC sign-in")
    }

    pub fn account_by_id(client: &mut Client, id: &str) -> Result<Option<Account>, Error> {
        client
            .query_opt(
                "SELECT to_jsonb(a) FROM identity.accounts a WHERE id = $1::text::uuid",
                &[&id],
            )
            .context("read OIDC identity")?
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
                    "SELECT a.id::text, a.email FROM identity.sessions s ",
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
