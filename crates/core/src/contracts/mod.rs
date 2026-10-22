//! v1 compatibility and tabletop resource DTOs; validate schemas before accepting external data.

pub mod actors;
pub mod adventure;
pub mod campaign;
pub mod catalog;
pub mod common;
pub mod sheets;
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
