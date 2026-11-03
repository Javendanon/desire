//! Typed read scopes and private SQL decoding shared by campaign repositories.
use crate::{Error, error::Context, records};
use postgres::Client;
use serde::de::DeserializeOwned;

/// Authorization remains with the caller; this selects the SQL projection it may read.
#[derive(Clone, Copy)]
pub enum Audience {
    All,
    Players,
}

#[derive(Clone, Copy)]
pub struct CampaignRead<'a> {
    pub campaign_id: &'a str,
    pub audience: Audience,
}

#[derive(Clone, Copy)]
pub struct RecordTarget<'a> {
    pub campaign_id: &'a str,
    pub id: &'a str,
}

/// A bounded window supplied by the application, including any look-ahead row.
#[derive(Clone, Copy)]
pub struct FetchPage {
    pub limit: i64,
    pub offset: i64,
}

pub(crate) struct ListRead<'a> {
    pub sql: &'a str,
    pub campaign_id: &'a str,
    pub page: FetchPage,
}

pub(crate) fn list<T: DeserializeOwned>(
    client: &mut Client,
    read: ListRead<'_>,
) -> Result<Vec<T>, Error> {
    let rows = client
        .query(
            read.sql,
            &[&read.campaign_id, &read.page.limit, &read.page.offset],
        )
        .context(format!("list campaign records for {}", read.campaign_id))?;
    records::decode_all(rows)
}

pub(crate) fn get<T: DeserializeOwned>(
    client: &mut Client,
    target: RecordTarget<'_>,
    sql: &str,
) -> Result<Option<T>, Error> {
    client
        .query_opt(sql, &[&target.campaign_id, &target.id])
        .context(format!(
            "read record {} in {}",
            target.id, target.campaign_id
        ))?
        .map(records::decode)
        .transpose()
}

pub(crate) fn selected<'a>(audience: Audience, dm: &'a str, player: &'a str) -> &'a str {
    match audience {
        Audience::All => dm,
        Audience::Players => player,
    }
}

/// Database-generated stable IDs, independent of HTTP request identity.
pub fn next_id(client: &mut Client) -> Result<String, Error> {
    client
        .query_one("SELECT gen_random_uuid()::text", &[])
        .context("generate record id")
        .map(|row| row.get(0))
}
