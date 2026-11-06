//! OIDC deployment settings are validated before any listener is opened.
use openidconnect::{ClientSecret, IssuerUrl, RedirectUrl, url::Url};
use std::collections::HashSet;

pub struct Settings {
    pub issuer: IssuerUrl,
    pub client_id: String,
    pub client_secret: ClientSecret,
    pub public_url: Url,
    pub allowed_emails: HashSet<String>,
}

impl Settings {
    pub fn from_env() -> Result<Option<Self>, String> {
        let id = std::env::var("DESIRE_OIDC_CLIENT_ID").ok();
        let secret = std::env::var("DESIRE_OIDC_CLIENT_SECRET").ok();
        let public = std::env::var("DESIRE_PUBLIC_URL").ok();
        if id.is_none() && secret.is_none() && public.is_none() {
            return Ok(None);
        }
        let issuer = std::env::var("DESIRE_OIDC_ISSUER")
            .unwrap_or_else(|_| "https://accounts.google.com".into());
        let settings = Self {
            issuer: IssuerUrl::new(issuer).map_err(|_| "invalid OIDC issuer URL")?,
            client_id: required(id, "DESIRE_OIDC_CLIENT_ID")?,
            client_secret: ClientSecret::new(required(secret, "DESIRE_OIDC_CLIENT_SECRET")?),
            public_url: Url::parse(&required(public, "DESIRE_PUBLIC_URL")?)
                .map_err(|_| "invalid public URL")?,
            allowed_emails: email_list(&std::env::var("DESIRE_ALLOWED_EMAILS").unwrap_or_default()),
        };
        settings.validate()?;
        Ok(Some(settings))
    }

    pub fn validate(&self) -> Result<(), String> {
        validate_transport(self.issuer.url())?;
        validate_transport(&self.public_url)?;
        let public = &self.public_url;
        if public.path() != "/" || public.as_str().contains('?') || public.fragment().is_some() {
            return Err("DESIRE_PUBLIC_URL must contain only the deployment origin".into());
        }
        if self.client_id.trim().is_empty() || self.client_secret.secret().trim().is_empty() {
            return Err("OIDC client settings must not be empty".into());
        }
        Ok(())
    }

    pub fn redirect_uri(&self) -> Result<RedirectUrl, String> {
        RedirectUrl::new(format!("{}api/v1/auth/callback", self.public_url))
            .map_err(|_| "invalid OIDC callback URL".into())
    }
}

fn required(value: Option<String>, name: &str) -> Result<String, String> {
    value
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{name} is required"))
}

/// O(n) over a comma-separated, case-insensitive allowlist. Empty means unrestricted.
pub fn email_list(value: &str) -> HashSet<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|email| !email.is_empty())
        .map(str::to_ascii_lowercase)
        .collect()
}

pub fn validate_transport(url: &Url) -> Result<(), String> {
    let local = match url.host_str() {
        Some("localhost") => true,
        Some(host) => host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback()),
        None => false,
    };
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("OIDC URLs must not contain credentials or fragments".into());
    }
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("OIDC URLs require HTTPS except on loopback".into());
    }
    Ok(())
}

/// A shared bind must never run as an anonymous or header-authenticated deployment.
pub fn require_oidc(host: std::net::IpAddr, configured: bool) -> Result<(), String> {
    if !host.is_loopback() && !configured {
        return Err("OpenID Connect is required for a non-loopback bind".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_shared_bind_cannot_start_without_oidc() {
        for host in ["0.0.0.0", "::", "192.0.2.10"] {
            let host = host.parse().unwrap();
            assert!(require_oidc(host, false).is_err());
            assert!(require_oidc(host, true).is_ok());
        }
        assert!(require_oidc("127.0.0.1".parse().unwrap(), false).is_ok());
        assert!(require_oidc("::1".parse().unwrap(), false).is_ok());
    }

    #[test]
    fn only_https_or_loopback_http_are_accepted() {
        for value in [
            "http://localhost:5173",
            "http://127.0.0.1",
            "http://[::1]",
            "https://table.example.test",
        ] {
            assert!(
                validate_transport(&Url::parse(value).unwrap()).is_ok(),
                "{value}"
            );
        }
        for value in [
            "http://table.example.test",
            "https://user:pass@table.example.test",
            "https://table.example.test/#fragment",
            "ftp://localhost",
        ] {
            assert!(
                validate_transport(&Url::parse(value).unwrap()).is_err(),
                "{value}"
            );
        }
    }
}
