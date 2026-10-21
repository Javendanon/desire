//! Explicit, transactional upgrades; never invoked by opening a repository.
use crate::{Error, ErrorKind, error::Context};
use postgres::{Client, Transaction};

const MIGRATIONS: &[&str] = &[
    include_str!("../../../migrations/0001_catalog.sql"),
    include_str!("../../../migrations/0002_campaign.sql"),
    include_str!("../../../migrations/0003_notes.sql"),
    include_str!("../../../migrations/0004_realtime.sql"),
    include_str!("../../../migrations/0005_calibrated_anchors.sql"),
];
const MIGRATION_LOCK: i64 = 0x444553495245;

pub fn apply(client: &mut Client) -> Result<(), Error> {
    apply_through(client, MIGRATIONS.len())
}

/// Apply a forward prefix, preserving and verifying the exact installed SQL text.
pub fn apply_through(client: &mut Client, target: usize) -> Result<(), Error> {
    if target > MIGRATIONS.len() {
        return Err(Error::new(
            ErrorKind::InvalidMigration,
            "unknown migration target",
        ));
    }
    let mut tx = client
        .transaction()
        .context("begin migration transaction")?;
    tx.query_one("SELECT pg_advisory_xact_lock($1)", &[&MIGRATION_LOCK])
        .context("lock migration history")?;
    tx.batch_execute(concat!(
        "CREATE TABLE IF NOT EXISTS public.persistence_migrations (",
        "version bigint PRIMARY KEY, sql text NOT NULL, ",
        "installed_at timestamptz NOT NULL DEFAULT now())"
    ))
    .context("initialize migration history")?;
    let installed = verify_history(&mut tx, target)?;
    install_pending(&mut tx, installed, target)?;
    tx.commit().context("commit migration transaction")
}

/// Install an ordered pending prefix in O(number of pending migrations).
fn install_pending(tx: &mut Transaction<'_>, installed: usize, target: usize) -> Result<(), Error> {
    for (index, sql) in MIGRATIONS.iter().enumerate().take(target).skip(installed) {
        let version = (index + 1) as i64;
        tx.batch_execute(sql)
            .context(format!("apply migration {version:04}"))?;
        tx.execute(
            "INSERT INTO public.persistence_migrations (version, sql) VALUES ($1, $2)",
            &[&version, sql],
        )
        .context(format!("record migration {version:04}"))?;
    }
    Ok(())
}

/// Verify an ordered prefix in O(number of installed migrations).
fn verify_history(tx: &mut Transaction<'_>, target: usize) -> Result<usize, Error> {
    let rows = tx
        .query(
            "SELECT version, sql FROM public.persistence_migrations ORDER BY version",
            &[],
        )
        .context("read migration history")?;
    for (index, row) in rows.iter().enumerate() {
        let version: i64 = row.get(0);
        let sql: &str = row.get(1);
        if version != (index + 1) as i64 || MIGRATIONS.get(index).copied() != Some(sql) {
            return Err(Error::new(
                ErrorKind::InvalidMigration,
                format!("migration {version} is unknown, edited, or out of sequence"),
            ));
        }
    }
    if rows.len() > target {
        return Err(Error::new(
            ErrorKind::InvalidMigration,
            "migration downgrade is forbidden",
        ));
    }
    Ok(rows.len())
}
