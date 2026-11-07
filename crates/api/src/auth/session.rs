//! Opaque session tokens and host-only cookies; raw tokens never reach storage.
use axum::http::{HeaderMap, HeaderValue};
use sha2::{Digest, Sha256};

pub const SESSION_COOKIE: &str = "__Host-desire-session";
pub const LOGIN_COOKIE: &str = "__Host-desire-oidc";
pub const SESSION_SECONDS: u64 = 12 * 60 * 60;
// ponytail: no browser admission cap. Add one if abandoned flows cause cookie pressure.
pub const LOGIN_SECONDS: u64 = 10 * 60;
const TOKEN_BYTES: usize = 32;

pub fn random_token() -> Result<String, String> {
    let mut bytes = [0_u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes).map_err(|_| "operating-system randomness is unavailable")?;
    Ok(hex(&bytes))
}

pub fn is_token(value: &str) -> bool {
    value.len() == TOKEN_BYTES * 2
        && value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

pub fn token_hash(token: &str) -> String {
    hex(&Sha256::digest(token.as_bytes()))
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::new(), |mut output, byte| {
        write!(&mut output, "{byte:02x}").expect("writing to a string cannot fail");
        output
    })
}

/// O(n) over Cookie headers. Absent, empty and ambiguous credentials stay distinct.
pub fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Result<Option<&'a str>, &'static str> {
    let mut found = None;
    for header in headers.get_all("cookie") {
        for pair in header
            .to_str()
            .map_err(|_| "Cookie header must be ASCII")?
            .split(';')
        {
            let pair = pair.trim();
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            if key.trim() != name {
                continue;
            }
            if found.replace(value).is_some() {
                return Err("duplicate authentication cookie");
            }
        }
    }
    Ok(found)
}

pub fn login_cookie(state: &str) -> String {
    format!("{LOGIN_COOKIE}-{}", token_hash(state))
}

pub fn set_cookie(name: &str, value: &str, seconds: u64) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "{name}={value}; Path=/; Max-Age={seconds}; HttpOnly; Secure; SameSite=Lax"
    ))
    .expect("cookie names and values are internal ASCII tokens")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_random_and_only_their_hashes_are_stored() {
        let first = random_token().unwrap();
        assert!(is_token(&first));
        assert_ne!(first, random_token().unwrap());
        assert!(is_token(&token_hash(&first)));
        assert_ne!(first, token_hash(&first));
        assert!(!is_token("malformed"));
    }
}
