//! Pure input validation. No handler stores unvalidated text or identifiers.
use crate::error::ApiError;
use crate::extract::Caller;
use desire_core::contracts::common::{Id, Provenance};

pub const MAX_NAME: usize = 120;
pub const MAX_TITLE: usize = 200;
pub const MAX_BODY: usize = 20_000;
pub const MAX_SOURCE: usize = 300;

pub fn text(value: &str, field: &str, max: usize) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} must not be blank"));
    }
    if trimmed.chars().count() > max {
        return Err(format!("{field} must be at most {max} characters"));
    }
    Ok(trimmed.to_string())
}

pub fn id(value: &str, field: &str) -> Result<Id, String> {
    crate::ids::validate(value, field)
}

pub fn revision(value: u32) -> Result<u32, String> {
    if value == 0 {
        Err("expected_revision must be positive".into())
    } else {
        Ok(value)
    }
}

pub fn provenance(value: &Provenance) -> Result<Provenance, String> {
    Ok(Provenance {
        source: text(&value.source, "provenance.source", MAX_SOURCE)?,
        attribution: text(&value.attribution, "provenance.attribution", MAX_SOURCE)?,
        evidence: value.evidence.clone(),
    })
}

pub fn or_invalid<T>(result: Result<T, String>, caller: &Caller) -> Result<T, ApiError> {
    result.map_err(|message| ApiError::invalid(caller, message))
}
