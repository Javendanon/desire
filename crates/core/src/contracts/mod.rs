//! Generated v1 DTOs; validate JSON Schema constraints before accepting external data.

pub mod campaign;
pub mod catalog;
pub mod common;
pub mod transport;

/// A nullable field is still required: omitting it is not the same as sending null.
fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    serde::Deserialize::deserialize(deserializer)
}

#[cfg(test)]
mod tests;
