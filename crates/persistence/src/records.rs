//! Private SQL helpers; table identifiers are static adapter constants, never input.
use crate::{Error, error::Context};
use postgres::{GenericClient, Row};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Map, Value};

const ABILITY: [&str; 6] = [
    "strength",
    "dexterity",
    "constitution",
    "intelligence",
    "wisdom",
    "charisma",
];

/// The wire object stays nested. Storage is six columns.
pub(crate) fn expand_abilities(value: &mut Value) {
    let Some(scores) = value.get("abilities").cloned().filter(Value::is_object) else {
        return;
    };
    let Some(object) = value.as_object_mut() else {
        return;
    };
    object.remove("abilities");
    if let Some(scores) = scores.as_object() {
        for (key, score) in scores {
            object.insert(key.clone(), score.clone());
        }
    }
}

/// Fold the six columns back into the wire object before decoding a DTO.
pub(crate) fn nest_abilities(value: &mut Value) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    if !ABILITY.iter().all(|key| object.contains_key(*key)) {
        return;
    }
    let mut scores = Map::new();
    for key in ABILITY {
        scores.insert((*key).to_string(), object.remove(key).unwrap());
    }
    object.insert("abilities".to_string(), Value::Object(scores));
}

pub(crate) fn insert<T: Serialize>(
    client: &mut impl GenericClient,
    table: &str,
    record: &T,
) -> Result<(), Error> {
    let mut data = serde_json::to_value(record).context(format!("encode {table}"))?;
    expand_abilities(&mut data);
    let columns = quoted_keys(&data);
    let query = format!(
        "INSERT INTO {table} ({columns}) SELECT {columns} FROM \
         jsonb_populate_record(NULL::{table}, $1)"
    );
    client.execute(&query, &[&data]).context(format!(
        "insert {table} {}",
        data["id"]
            .as_str()
            .or(data["actor_id"].as_str())
            .unwrap_or("?")
    ))?;
    Ok(())
}

/// Present keys only, so an omitted column keeps its database default.
fn quoted_keys(data: &Value) -> String {
    data.as_object()
        .map(|object| {
            object
                .keys()
                .map(|name| format!("\"{}\"", name.replace('"', "\"\"")))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default()
}

pub(crate) fn decode<T: DeserializeOwned>(row: Row) -> Result<T, Error> {
    let mut value: Value = row.get(0);
    nest_abilities(&mut value);
    serde_json::from_value(value).context("decode repository record")
}

/// Decode each returned record once, O(rows).
pub(crate) fn decode_all<T: DeserializeOwned>(rows: Vec<Row>) -> Result<Vec<T>, Error> {
    rows.into_iter().map(decode).collect()
}
