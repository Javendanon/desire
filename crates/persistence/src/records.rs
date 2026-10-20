//! Private SQL helpers; table identifiers are static adapter constants, never input.
use crate::{Error, error::Context};
use postgres::{GenericClient, Row};
use serde::{Serialize, de::DeserializeOwned};

pub(crate) fn insert<T: Serialize>(
    client: &mut impl GenericClient,
    table: &str,
    record: &T,
) -> Result<(), Error> {
    let data = serde_json::to_value(record).context(format!("encode {table}"))?;
    let query =
        format!("INSERT INTO {table} SELECT * FROM jsonb_populate_record(NULL::{table}, $1)");
    client
        .execute(&query, &[&data])
        .context(format!("insert {table} {}", data["id"]))?;
    Ok(())
}

pub(crate) fn decode<T: DeserializeOwned>(row: Row) -> Result<T, Error> {
    serde_json::from_value(row.get(0)).context("decode repository record")
}

/// Decode each returned record once, O(rows).
pub(crate) fn decode_all<T: DeserializeOwned>(rows: Vec<Row>) -> Result<Vec<T>, Error> {
    rows.into_iter().map(decode).collect()
}
