//! Read-only Nivel20 snapshots: one external campaign maps to one local campaign.
use crate::{Error, ErrorKind, error::Context, records};
use postgres::{Client, GenericClient, IsolationLevel};
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
    pub expected_imported_at: Option<&'a str>,
}

/// The snapshot observed under the lock and the final stored row.
pub struct Nivel20Saved {
    pub previous: Option<Nivel20Mapping>,
    pub stored: Nivel20Mapping,
}

pub struct Nivel20Repository;

impl Nivel20Repository {
    pub fn get(
        client: &mut impl GenericClient,
        campaign_id: &str,
    ) -> Result<Option<Nivel20Mapping>, Error> {
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

    /// The local campaign that already owns an external id, if any. O(1) via the unique index.
    pub fn external_owner(client: &mut Client, external_id: i64) -> Result<Option<String>, Error> {
        let row = client
            .query_opt(
                "SELECT campaign_id::text FROM campaign.nivel20_campaigns WHERE external_id = $1",
                &[&external_id],
            )
            .context(format!("read Nivel20 owner of {external_id}"))?;
        Ok(row.map(|row| row.get(0)))
    }

    /// READ COMMITTED refreshes the mapping read after a parent lock wait, even on first import.
    pub fn save(client: &mut Client, save: &Nivel20Save<'_>) -> Result<Nivel20Saved, Error> {
        let mut transaction = client
            .build_transaction()
            .isolation_level(IsolationLevel::ReadCommitted)
            .start()
            .context("begin Nivel20 import")?;
        transaction
            .query_one(
                "SELECT id FROM campaign.campaigns WHERE id = $1::text::uuid FOR UPDATE",
                &[&save.campaign_id],
            )
            .context("lock Nivel20 import campaign")?;
        let previous = Self::get(&mut transaction, save.campaign_id)?;
        let stored = match previous.as_ref() {
            Some(row) if row.external_id == save.external_id && row.snapshot == *save.snapshot => {
                Self::record_path(&mut transaction, row, save)?
            }
            _ => {
                let revision = previous.as_ref().map(|row| row.imported_at.as_str());
                if revision != save.expected_imported_at {
                    return Err(Error::new(ErrorKind::Conflict, "stale Nivel20 import"));
                }
                Self::write(&mut transaction, save)?
            }
        };
        transaction.commit().context("commit Nivel20 import")?;
        Ok(Nivel20Saved { previous, stored })
    }

    /// An unchanged snapshot is not a new import, but the source may now serve it under another
    /// slug for the same numeric ID. Keep that path without touching `imported_at`.
    fn record_path(
        client: &mut impl GenericClient,
        row: &Nivel20Mapping,
        save: &Nivel20Save<'_>,
    ) -> Result<Nivel20Mapping, Error> {
        if row.source_path == save.source_path {
            return Ok(row.clone());
        }
        let updated = client
            .query_one(
                concat!(
                    "UPDATE campaign.nivel20_campaigns n SET source_path = $2 ",
                    "WHERE campaign_id = $1::text::uuid RETURNING to_jsonb(n)"
                ),
                &[&save.campaign_id, &save.source_path],
            )
            .context(format!("record Nivel20 path for {}", save.campaign_id))?;
        records::decode(updated)
    }

    fn write(
        client: &mut impl GenericClient,
        save: &Nivel20Save<'_>,
    ) -> Result<Nivel20Mapping, Error> {
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
                    "snapshot = EXCLUDED.snapshot, ",
                    "imported_at = GREATEST(clock_timestamp(), ",
                    "nivel20_campaigns.imported_at + interval '1 microsecond') ",
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
