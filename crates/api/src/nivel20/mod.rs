//! Read-only Nivel20 adapter. It fetches only the campaign metadata path verified in D06.
//!
//! The adapter never sends credentials, cookies, CSRF tokens or write requests. A 401, 403 or
//! redirect ends the operation without retrying and without touching the perimeter response.

mod metadata;
mod path;

pub use metadata::CampaignMetadata;
pub use path::{CampaignPath, parse_path};

use serde::Serialize;
use std::time::Duration;
use ureq::{Agent, Error as HttpError};

const DEFAULT_BASE_URL: &str = "https://nivel20.com";
const ACCEPT_JSON: &str = "application/json";
const MAX_BODY_BYTES: u64 = 200_000;
const HTTP_OK: u16 = 200;
const HTTP_REDIRECT_START: u16 = 300;
const HTTP_REDIRECT_END: u16 = 399;
const HTTP_UNAUTHORIZED: u16 = 401;
const HTTP_FORBIDDEN: u16 = 403;
const HTTP_NOT_FOUND: u16 = 404;
const HTTP_RATE_LIMITED: u16 = 429;
const HTTP_SERVER_ERROR_START: u16 = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Nivel20Error {
    SessionExpired,
    AccessDenied,
    Redirected,
    RateLimited,
    NotFound,
    Timeout,
    Unavailable,
    InvalidPayload,
    UnexpectedStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeStatus {
    New,
    Unchanged,
    Changed,
}

#[derive(Debug, Clone, Serialize)]
pub struct StoredImport {
    pub campaign_id: String,
    pub external_id: i64,
    pub source_path: String,
    pub imported_at: String,
    pub campaign: CampaignMetadata,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportReport {
    pub source: &'static str,
    pub campaign_id: String,
    pub external_id: i64,
    pub source_path: String,
    pub status: ChangeStatus,
    pub campaign: CampaignMetadata,
    pub previous: Option<StoredImport>,
    pub stored: Option<StoredImport>,
    pub imported: bool,
    pub changed_fields: Vec<&'static str>,
}

#[derive(Clone)]
pub struct Nivel20Client {
    base_url: String,
    agent: Agent,
}

impl Nivel20Client {
    pub fn new(base_url: impl Into<String>) -> Result<Self, String> {
        Ok(Self {
            base_url: validate_base_url(base_url.into())?,
            agent: agent(),
        })
    }

    pub fn from_env() -> Result<Self, String> {
        let base_url =
            std::env::var("NIVEL20_BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.into());
        Self::new(base_url)
    }

    /// One explicit read. The caller decides when to call it; there is no background polling.
    pub fn fetch_campaign(&self, source: &CampaignPath) -> Result<CampaignMetadata, Nivel20Error> {
        let url = format!("{}{}", self.base_url, source.path);
        let mut response = self
            .agent
            .get(&url)
            .header("Accept", ACCEPT_JSON)
            .call()
            .map_err(http_error)?;
        let status = response.status().as_u16();
        check_status(status)?;
        let body = response
            .body_mut()
            .with_config()
            .limit(MAX_BODY_BYTES)
            .read_to_string()
            .map_err(http_error)?;
        let metadata: CampaignMetadata =
            serde_json::from_str(&body).map_err(|_| Nivel20Error::InvalidPayload)?;
        metadata
            .validate(source.external_id)
            .map_err(|_| Nivel20Error::InvalidPayload)?;
        Ok(metadata)
    }
}

impl Default for Nivel20Client {
    fn default() -> Self {
        Self {
            base_url: DEFAULT_BASE_URL.into(),
            agent: agent(),
        }
    }
}

fn agent() -> Agent {
    Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(8)))
        .max_redirects(0)
        .http_status_as_error(false)
        .user_agent("DesireNivel20ReadOnly/0.1")
        .build()
        .into()
}

fn validate_base_url(base_url: String) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let invalid = "NIVEL20_BASE_URL must be an absolute HTTP(S) base URL without credentials";
    let uri = trimmed.parse::<ureq::http::Uri>().map_err(|_| invalid)?;
    let authority = uri.authority().ok_or(invalid)?;
    if !matches!(uri.scheme_str(), Some("http" | "https"))
        || authority.host().is_empty()
        || authority.as_str().contains('@')
        || trimmed.contains(char::is_whitespace)
        || trimmed.contains(['?', '#'])
    {
        return Err(invalid.into());
    }
    Ok(trimmed.to_string())
}

fn check_status(status: u16) -> Result<(), Nivel20Error> {
    match status {
        HTTP_OK => Ok(()),
        HTTP_UNAUTHORIZED => Err(Nivel20Error::SessionExpired),
        HTTP_FORBIDDEN => Err(Nivel20Error::AccessDenied),
        HTTP_NOT_FOUND => Err(Nivel20Error::NotFound),
        HTTP_RATE_LIMITED => Err(Nivel20Error::RateLimited),
        HTTP_REDIRECT_START..=HTTP_REDIRECT_END => Err(Nivel20Error::Redirected),
        HTTP_SERVER_ERROR_START..=u16::MAX => Err(Nivel20Error::Unavailable),
        _ => Err(Nivel20Error::UnexpectedStatus),
    }
}

fn http_error(error: HttpError) -> Nivel20Error {
    match error {
        HttpError::Timeout(_) => Nivel20Error::Timeout,
        HttpError::Protocol(_) => Nivel20Error::InvalidPayload,
        // A response over `MAX_BODY_BYTES` is a payload fault, not an outage.
        HttpError::BodyExceedsLimit(_) => Nivel20Error::InvalidPayload,
        _ => Nivel20Error::Unavailable,
    }
}

/// Compare the stored snapshot with a fresh read. O(number of compared fields).
pub fn compare(
    previous: Option<&StoredImport>,
    external_id: i64,
    current: &CampaignMetadata,
) -> (ChangeStatus, Vec<&'static str>) {
    let Some(previous) = previous else {
        return (ChangeStatus::New, Vec::new());
    };
    let mut fields = current.changed_fields(&previous.campaign);
    if previous.external_id != external_id {
        fields.insert(0, "external_id");
    }
    if fields.is_empty() && previous.external_id == external_id {
        (ChangeStatus::Unchanged, fields)
    } else {
        (ChangeStatus::Changed, fields)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata(name: &str, updated_at: &str) -> CampaignMetadata {
        CampaignMetadata {
            id: 10,
            game_id: Some(3),
            name: name.into(),
            description: Some("Synthetic".into()),
            created_at: Some("2025-03-05T13:05:22.000-03:00".into()),
            updated_at: Some(updated_at.into()),
            url: None,
        }
    }

    fn stored(campaign: CampaignMetadata) -> StoredImport {
        StoredImport {
            campaign_id: "00000000-0000-4000-8000-000000000001".into(),
            external_id: 10,
            source_path: "/games/dnd-5/campaigns/10-synthetic".into(),
            imported_at: "2026-11-03T00:00:00Z".into(),
            campaign,
        }
    }

    #[test]
    fn comparison_reports_new_unchanged_and_changed() {
        let current = metadata("Synthetic", "2026-10-03T22:38:30.000-03:00");
        let (status, fields) = compare(None, 10, &current);
        assert_eq!(status, ChangeStatus::New);
        assert!(fields.is_empty());

        let previous = stored(current.clone());
        let (status, fields) = compare(Some(&previous), 10, &current);
        assert_eq!(status, ChangeStatus::Unchanged);
        assert!(fields.is_empty());

        let renamed = metadata("Renamed", "2026-11-01T10:00:00.000-03:00");
        let (status, fields) = compare(Some(&previous), 10, &renamed);
        assert_eq!(status, ChangeStatus::Changed);
        assert!(fields.contains(&"name"));
        assert!(fields.contains(&"updated_at"));

        let (status, fields) = compare(Some(&previous), 11, &current);
        assert_eq!(status, ChangeStatus::Changed);
        assert_eq!(fields, vec!["external_id"]);
    }

    #[test]
    fn credential_bearing_base_urls_fail_construction_without_a_request() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        for userinfo in ["user:pass", "user", ":pass", "", "us%65r:p%40ss"] {
            let base_url = format!("http://{userinfo}@{address}");
            assert!(Nivel20Client::new(base_url).is_err());
        }
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }

    #[test]
    fn invalid_base_urls_are_rejected() {
        for value in [
            "",
            "nivel20.com",
            "ftp://nivel20.com",
            "https://nivel20.com/a b",
        ] {
            assert!(Nivel20Client::new(value).is_err(), "{value}");
        }
        assert!(Nivel20Client::new("https://nivel20.com/").is_ok());
    }
}
