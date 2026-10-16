//! DTOs v1 generados; validar restricciones JSON Schema antes de aceptar datos externos.

pub mod campaign;
pub mod catalog;
pub mod common;
pub mod transport;

/// Un campo nullable sigue siendo obligatorio: omitirlo no equivale a enviar null.
fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    serde::Deserialize::deserialize(deserializer)
}

#[cfg(test)]
mod tests;
