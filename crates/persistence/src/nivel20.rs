//! Read-only Nivel20 snapshots: one external campaign maps to one local campaign.
use crate::{Error, error::Context, records};
use postgres::Client;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
pub struct Nivel20Mapping {
    pub campaign_id: String,
    pub external_id: i64,
    pub source_path: String,
    pub external_updated_at: Option<String>,
    pub snapshot: Value,
    pub imported_at: String,
}

pub struct Nivel20Save<'a> {
    pub campaign_id: &'a str,
    pub external_id: i64,
    pub source_path: &'a str,
    pub external_updated_at: Option<&'a str>,
    pub snapshot: &'a Value,
}

pub struct Nivel20Repository;

impl Nivel20Repository {
    pub fn get(client: &mut Client, campaign_id: &str) -> Result<Option<Nivel20Mapping>, Error> {
        let row = client
            .query_opt(
                concat!(
                    "SELECT to_jsonb(n) FROM campaign.nivel20_campaigns n ",
                    "WHERE campaign_id = $1::text::uuid"
                ),
                &[&campaign_id],
            )
            .context(format!("read Nivel20 mapping for {campaign_id}"))?;
        row.map(records::decode).transpose()
    }

    /// Replacing the snapshot keeps the row id stable and bumps `imported_at`.
    pub fn save(client: &mut Client, save: &Nivel20Save<'_>) -> Result<Nivel20Mapping, Error> {
        let row = client
            .query_one(
                concat!(
                    "INSERT INTO campaign.nivel20_campaigns ",
                    "(campaign_id, external_id, source_path, external_updated_at, snapshot) ",
                    "VALUES ($1::text::uuid, $2, $3, $4, $5) ",
                    "ON CONFLICT (campaign_id) DO UPDATE SET ",
                    "external_id = EXCLUDED.external_id, ",
                    "source_path = EXCLUDED.source_path, ",
                    "external_updated_at = EXCLUDED.external_updated_at, ",
                    "snapshot = EXCLUDED.snapshot, imported_at = now() ",
                    "RETURNING to_jsonb(nivel20_campaigns)"
                ),
                &[
                    &save.campaign_id,
                    &save.external_id,
                    &save.source_path,
                    &save.external_updated_at,
                    &save.snapshot,
                ],
            )
            .context(format!("save Nivel20 mapping for {}", save.campaign_id))?;
        records::decode(row)
    }
}
