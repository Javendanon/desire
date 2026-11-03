//! PBKDF2-HMAC-SHA256 passwords and opaque bearer tokens; only hashes reach storage.
use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};

const ALGORITHM: &str = "pbkdf2_sha256";
const ITERATIONS: u32 = 600_000;
const SALT_BYTES: usize = 16;
const KEY_BYTES: usize = 32;
const TOKEN_BYTES: usize = 32;

type HmacSha256 = Hmac<Sha256>;

fn prf(keyed: &HmacSha256, data: &[u8]) -> [u8; 32] {
    let mut mac = keyed.clone();
    mac.update(data);
    mac.finalize().into_bytes().into()
}

/// RFC 8018 PBKDF2 with HMAC-SHA256, checked against the published vectors below.
pub fn derive(password: &[u8], salt: &[u8], iterations: u32, length: usize) -> Vec<u8> {
    let keyed = HmacSha256::new_from_slice(password).expect("HMAC accepts keys of any length");
    let mut output = Vec::with_capacity(length);
    let mut block = 1_u32;
    while output.len() < length {
        let mut input = salt.to_vec();
        input.extend_from_slice(&block.to_be_bytes());
        let mut current = prf(&keyed, &input);
        let mut folded = current;
        for _ in 1..iterations {
            current = prf(&keyed, &current);
            for (left, right) in folded.iter_mut().zip(current) {
                *left ^= right;
            }
        }
        output.extend_from_slice(&folded);
        block += 1;
    }
    output.truncate(length);
    output
}

pub fn hash_password(password: &str) -> Result<String, String> {
    let mut salt = [0_u8; SALT_BYTES];
    getrandom::fill(&mut salt).map_err(|_| "no operating-system randomness is available")?;
    let key = derive(password.as_bytes(), &salt, ITERATIONS, KEY_BYTES);
    Ok(format!(
        "{ALGORITHM}${ITERATIONS}${}${}",
        hex(&salt),
        hex(&key)
    ))
}

/// A malformed or foreign hash never authenticates, and a missing account still pays the work.
pub fn verify_password(password: &str, encoded: &str) -> bool {
    let Some((iterations, salt, expected)) = parse_hash(encoded) else {
        burn_derivation(password);
        return false;
    };
    let actual = derive(password.as_bytes(), &salt, iterations, expected.len());
    constant_time_eq(&actual, &expected)
}

/// Missing usernames still pay the same derivation cost instead of answering quickly.
pub fn verify_missing_account(password: &str) -> bool {
    burn_derivation(password);
    false
}

/// Consume the derived key so the compiler cannot elide the timing-equalization work.
fn burn_derivation(password: &str) {
    std::hint::black_box(derive(
        password.as_bytes(),
        &[0_u8; SALT_BYTES],
        ITERATIONS,
        KEY_BYTES,
    ));
}

pub fn random_token() -> Result<String, String> {
    let mut bytes = [0_u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes).map_err(|_| "no operating-system randomness is available")?;
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

fn parse_hash(encoded: &str) -> Option<(u32, Vec<u8>, Vec<u8>)> {
    let mut parts = encoded.split('$');
    if parts.next()? != ALGORITHM {
        return None;
    }
    let iterations: u32 = parts.next()?.parse().ok()?;
    if !(1..=2_000_000).contains(&iterations) {
        return None;
    }
    let salt = unhex(parts.next()?)?;
    let expected = unhex(parts.next()?)?;
    if parts.next().is_some() || salt.len() != SALT_BYTES || expected.len() != KEY_BYTES {
        return None;
    }
    Some((iterations, salt, expected))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

pub fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::new(), |mut output, byte| {
        write!(&mut output, "{byte:02x}").expect("writing to a string cannot fail");
        output
    })
}

fn unhex(value: &str) -> Option<Vec<u8>> {
    if !value.len().is_multiple_of(2) {
        return None;
    }
    value
        .as_bytes()
        .chunks(2)
        .map(|pair| {
            let high = (pair[0] as char).to_digit(16)?;
            let low = (pair[1] as char).to_digit(16)?;
            Some(((high << 4) | low) as u8)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pbkdf2_matches_published_sha256_vectors() {
        let vectors = [
            (
                1,
                "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b",
            ),
            (
                2,
                "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43",
            ),
            (
                4096,
                "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a",
            ),
        ];
        for (iterations, expected) in vectors {
            assert_eq!(hex(&derive(b"password", b"salt", iterations, 32)), expected);
        }
    }

    #[test]
    fn a_stored_hash_verifies_only_its_own_password() {
        let encoded = hash_password("correct horse battery staple").unwrap();
        assert!(verify_password("correct horse battery staple", &encoded));
        assert!(!verify_password("wrong password", &encoded));
        assert!(!verify_password("anything", "not-a-hash"));
        assert!(!verify_missing_account("anything"));
    }

    #[test]
    fn tokens_are_random_lowercase_hex_and_hashed_for_storage() {
        let first = random_token().unwrap();
        let second = random_token().unwrap();
        assert!(is_token(&first) && is_token(&second));
        assert_ne!(first, second);
        assert_eq!(token_hash(&first).len(), 64);
        assert_ne!(token_hash(&first), first);
        assert!(!is_token("ABC"));
    }
}
