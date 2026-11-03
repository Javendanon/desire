//! Credential payloads stay closed and bounded before any password work starts.
use crate::error::{ApiError, INVALID, UNAUTHORIZED};
use serde::Deserialize;

pub const MIN_USERNAME: usize = 3;
pub const MAX_USERNAME: usize = 64;
pub const MIN_PASSWORD: usize = 12;
pub const MAX_PASSWORD: usize = 200;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

impl Credentials {
    pub fn clean(self, request_id: &str) -> Result<Self, ApiError> {
        Ok(Self {
            username: username(&self.username, request_id)?,
            password: password(&self.password, request_id)?,
        })
    }
}

pub fn unauthorized(request_id: &str, message: &str) -> ApiError {
    ApiError::new(UNAUTHORIZED, "unauthenticated", message, request_id)
}

pub fn invalid(request_id: &str, message: impl Into<String>) -> ApiError {
    ApiError::new(INVALID, "invalid_request", message, request_id)
}

fn username(value: &str, request_id: &str) -> Result<String, ApiError> {
    let normalized = value.trim().to_ascii_lowercase();
    let length = normalized.chars().count();
    let allowed = normalized
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'));
    if !(MIN_USERNAME..=MAX_USERNAME).contains(&length) || !allowed {
        return Err(invalid(
            request_id,
            "username must be 3-64 characters using letters, digits, '.', '_' or '-'",
        ));
    }
    Ok(normalized)
}

fn password(value: &str, request_id: &str) -> Result<String, ApiError> {
    let length = value.chars().count();
    if !(MIN_PASSWORD..=MAX_PASSWORD).contains(&length) {
        return Err(invalid(
            request_id,
            "password must be 12-200 characters and must not contain NUL",
        ));
    }
    if value.contains('\0') {
        return Err(invalid(
            request_id,
            "password must not contain NUL characters",
        ));
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn credentials(username: &str, password: &str) -> Credentials {
        Credentials {
            username: username.into(),
            password: password.into(),
        }
    }

    #[test]
    fn usernames_are_normalized_and_bounded() {
        let cleaned = credentials("  Alice  ", "correct horse battery")
            .clean("request")
            .unwrap();
        assert_eq!(cleaned.username, "alice");
        for value in ["ab", "alice!", "", "a b"] {
            assert!(
                credentials(value, "correct horse battery")
                    .clean("request")
                    .is_err(),
                "{value} must be rejected"
            );
        }
    }

    #[test]
    fn passwords_keep_their_own_spaces_and_reject_nul() {
        let cleaned = credentials("alice", " correct horse ")
            .clean("request")
            .unwrap();
        assert_eq!(cleaned.password, " correct horse ");
        assert!(credentials("alice", "short").clean("request").is_err());
        assert!(
            credentials("alice", "long-enough\0password")
                .clean("request")
                .is_err()
        );
    }
}
