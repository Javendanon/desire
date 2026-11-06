//! OIDC protocol and token verification are delegated to the openidconnect crate.
use super::{
    service::unauthorized,
    session,
    settings::{self, Settings},
};
use crate::error::ApiError;
use openidconnect::{
    AuthenticationFlow, AuthorizationCode, ClientId, CsrfToken, EndpointMaybeSet, EndpointNotSet,
    EndpointSet, Nonce, PkceCodeChallenge, PkceCodeVerifier, Scope,
    core::{
        CoreClient, CoreIdTokenClaims, CoreProviderMetadata, CoreResponseType, CoreTokenResponse,
    },
    reqwest,
};
use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    sync::Mutex,
    time::{Duration, Instant},
};

type DiscoveredClient = CoreClient<
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
>;
const MAX_PENDING: usize = 1024;
/// Nested network budgets, narrowest first. One IPv6 holder controls a whole /64 (often a
/// /48) and one IPv4 holder rarely spans beyond a /24, so no single holder can fill the pool.
const BUDGETS: [Budget; 2] = [
    Budget {
        v4_prefix: 32,
        v6_prefix: 64,
        flows: 8,
    },
    Budget {
        v4_prefix: 24,
        v6_prefix: 48,
        flows: 64,
    },
];
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);

pub struct Oidc {
    client: DiscoveredClient,
    http: reqwest::Client,
    pub settings: Settings,
    // ponytail: process-local login state. Use shared storage for non-sticky replicas.
    pending: Mutex<HashMap<String, Pending>>,
}

struct Pending {
    client_ip: IpAddr,
    verifier: PkceCodeVerifier,
    nonce: Nonce,
    browser_hash: String,
    expires: Instant,
}

/// Only construct this after signature and all required claims have been verified.
pub struct VerifiedIdentity {
    pub issuer: String,
    pub subject: String,
    pub email: String,
}

pub struct Authorization {
    pub url: String,
    pub browser: String,
    pub cookie_name: String,
}

impl Oidc {
    pub async fn discover(settings: Settings) -> Result<Self, String> {
        settings.validate()?;
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(HTTP_TIMEOUT)
            .build()
            .map_err(|_| "could not initialize OIDC HTTP client")?;
        let metadata = CoreProviderMetadata::discover_async(settings.issuer.clone(), &http)
            .await
            .map_err(|_| "OIDC discovery or JWKS retrieval failed")?;
        validate_endpoints(&metadata)?;
        let client = CoreClient::from_provider_metadata(
            metadata,
            ClientId::new(settings.client_id.clone()),
            Some(settings.client_secret.clone()),
        )
        .set_redirect_uri(settings.redirect_uri()?);
        Ok(Self {
            client,
            http,
            settings,
            pending: Mutex::new(HashMap::new()),
        })
    }

    pub fn begin(&self, client_ip: IpAddr, request_id: &str) -> Result<Authorization, ApiError> {
        let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
        let (url, state, nonce) = self
            .client
            .authorize_url(
                AuthenticationFlow::<CoreResponseType>::AuthorizationCode,
                CsrfToken::new_random,
                Nonce::new_random,
            )
            .add_scope(Scope::new("email".into()))
            .set_pkce_challenge(challenge)
            .url();
        let browser = session::random_token()
            .map_err(|message| ApiError::internal_for(request_id, &message))?;
        let pending = Pending {
            client_ip,
            verifier,
            nonce,
            browser_hash: session::token_hash(&browser),
            expires: Instant::now() + Duration::from_secs(session::LOGIN_SECONDS),
        };
        self.remember(session::token_hash(state.secret()), pending, request_id)?;
        Ok(Authorization {
            url: url.to_string(),
            browser,
            cookie_name: session::login_cookie(state.secret()),
        })
    }

    fn remember(&self, key: String, pending: Pending, request_id: &str) -> Result<(), ApiError> {
        let mut flows = self
            .pending
            .lock()
            .map_err(|_| ApiError::internal_for(request_id, "OIDC flow lock failed"))?;
        admit(&mut flows, pending.client_ip, request_id)?;
        flows.insert(key, pending);
        Ok(())
    }

    fn consume(&self, callback: &Callback, request_id: &str) -> Result<Pending, ApiError> {
        let pending = self
            .pending
            .lock()
            .map_err(|_| ApiError::internal_for(request_id, "OIDC flow lock failed"))?
            .remove(&session::token_hash(&callback.state))
            .ok_or_else(|| unauthorized(request_id))?;
        if pending.expires <= Instant::now()
            || pending.browser_hash != session::token_hash(&callback.browser)
        {
            return Err(unauthorized(request_id));
        }
        Ok(pending)
    }

    pub async fn complete(
        &self,
        callback: Callback,
        request_id: &str,
    ) -> Result<VerifiedIdentity, ApiError> {
        let pending = self.consume(&callback, request_id)?;
        if callback.code.is_empty() {
            return Err(unauthorized(request_id));
        }
        let response = self
            .client
            .exchange_code(AuthorizationCode::new(callback.code))
            .map_err(|_| unauthorized(request_id))?
            .set_pkce_verifier(pending.verifier)
            .request_async(&self.http)
            .await
            .map_err(|_| unauthorized(request_id))?;
        self.verify(response, pending.nonce)
            .map_err(|_| unauthorized(request_id))
    }

    fn verify(&self, response: CoreTokenResponse, nonce: Nonce) -> Result<VerifiedIdentity, ()> {
        let token = response.extra_fields().id_token().ok_or(())?;
        let verifier = self.client.id_token_verifier();
        let claims = token.claims(&verifier, &nonce).map_err(|_| ())?;
        Ok(VerifiedIdentity {
            issuer: claims.issuer().as_str().into(),
            subject: claims.subject().as_str().into(),
            email: self.verified_email(claims)?,
        })
    }

    fn verified_email(&self, claims: &CoreIdTokenClaims) -> Result<String, ()> {
        let email = claims
            .email()
            .filter(|_| claims.email_verified() == Some(true))
            .ok_or(())?
            .as_str();
        let allowed = &self.settings.allowed_emails;
        if !allowed.is_empty() && !allowed.contains(&email.to_ascii_lowercase()) {
            return Err(());
        }
        Ok(email.into())
    }
}

struct Budget {
    v4_prefix: u32,
    v6_prefix: u32,
    flows: usize,
}

impl Budget {
    fn network(&self, ip: IpAddr) -> IpAddr {
        match ip {
            IpAddr::V4(ip) => {
                let mask = u32::MAX.checked_shl(32 - self.v4_prefix).unwrap_or(0);
                Ipv4Addr::from_bits(ip.to_bits() & mask).into()
            }
            IpAddr::V6(ip) => {
                let mask = u128::MAX.checked_shl(128 - self.v6_prefix).unwrap_or(0);
                Ipv6Addr::from_bits(ip.to_bits() & mask).into()
            }
        }
    }

    fn exhausted(&self, flows: &HashMap<String, Pending>, client_ip: IpAddr) -> bool {
        let network = self.network(client_ip);
        flows
            .values()
            .filter(|flow| self.network(flow.client_ip) == network)
            .nth(self.flows - 1)
            .is_some()
    }
}

pub struct Callback {
    pub code: String,
    pub state: String,
    pub browser: String,
}

/// O(n) expiry and O(n * budgets) counting, bounded by MAX_PENDING. Hold the lock through
/// insertion.
fn admit(
    flows: &mut HashMap<String, Pending>,
    client_ip: IpAddr,
    request_id: &str,
) -> Result<(), ApiError> {
    let now = Instant::now();
    flows.retain(|_, flow| flow.expires > now);
    if BUDGETS
        .iter()
        .any(|budget| budget.exhausted(flows, client_ip))
    {
        return Err(ApiError::new(
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            "oidc_rate_limited",
            "too many pending authentication requests from this client",
            request_id,
        ));
    }
    if flows.len() >= MAX_PENDING {
        return Err(ApiError::new(
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "oidc_busy",
            "too many pending authentication requests",
            request_id,
        ));
    }
    Ok(())
}

fn validate_endpoints(metadata: &CoreProviderMetadata) -> Result<(), String> {
    settings::validate_transport(metadata.authorization_endpoint().url())?;
    settings::validate_transport(metadata.jwks_uri().url())?;
    let token = metadata
        .token_endpoint()
        .ok_or("OIDC provider has no token endpoint")?;
    settings::validate_transport(token.url())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLIENT_QUOTA: usize = BUDGETS[0].flows;

    #[test]
    fn expired_flows_release_quota_and_rejections_do_not_extend_their_lifetime() {
        let client_ip = "192.0.2.1".parse().unwrap();
        let expires = Instant::now() + Duration::from_secs(session::LOGIN_SECONDS);
        let mut flows: HashMap<_, _> = (0..CLIENT_QUOTA)
            .map(|index| (index.to_string(), flow(client_ip, expires)))
            .collect();
        for _ in 0..2 {
            assert!(admit(&mut flows, client_ip, "fixture-request").is_err());
            assert_eq!(flows.len(), CLIENT_QUOTA);
            assert!(flows.values().all(|flow| flow.expires == expires));
        }
        let expired = Instant::now() - Duration::from_secs(1);
        for pending in flows.values_mut() {
            pending.expires = expired;
        }
        assert!(admit(&mut flows, client_ip, "fixture-request").is_ok());
        assert!(flows.is_empty());
    }

    /// Fills the pool the way one holder can: every address it controls, one flow at a time.
    fn flood(addresses: impl Iterator<Item = IpAddr>) -> HashMap<String, Pending> {
        let expires = Instant::now() + Duration::from_secs(session::LOGIN_SECONDS);
        let mut flows = HashMap::new();
        for (index, address) in addresses.take(MAX_PENDING).enumerate() {
            if admit(&mut flows, address, "fixture-request").is_ok() {
                flows.insert(index.to_string(), flow(address, expires));
            }
        }
        flows
    }

    fn v6(prefix: u128, index: u128) -> IpAddr {
        Ipv6Addr::from_bits(prefix | index).into()
    }

    #[test]
    fn one_ipv6_slash_64_is_one_client() {
        let holder = 0x2001_0db8_0000_0001_u128 << 64;
        let mut flows = flood((0..).map(|index| v6(holder, index)));
        assert_eq!(flows.len(), CLIENT_QUOTA);
        assert!(admit(&mut flows, v6(holder, 0xffff), "fixture-request").is_err());
    }

    #[test]
    fn one_ipv6_network_holder_cannot_lock_out_unrelated_clients() {
        let holder = 0x2001_0db8_0001_u128 << 80;
        assert_contained(flood((0..).map(|subnet| v6(holder, subnet << 64))));
    }

    #[test]
    fn one_ipv4_network_holder_cannot_lock_out_unrelated_clients() {
        let holder = u32::from(Ipv4Addr::new(198, 51, 100, 0));
        assert_contained(flood(
            (0..256).map(|host| Ipv4Addr::from_bits(holder | host).into()),
        ));
    }

    fn assert_contained(mut flows: HashMap<String, Pending>) {
        assert_eq!(flows.len(), BUDGETS[1].flows);
        for unrelated in ["192.0.2.1", "2001:db8:ffff::1"] {
            assert!(admit(&mut flows, unrelated.parse().unwrap(), "fixture-request").is_ok());
        }
    }

    #[test]
    fn budgets_mask_addresses_to_their_networks() {
        let cases = [
            (&BUDGETS[0], "192.0.2.77", "192.0.2.77"),
            (&BUDGETS[1], "192.0.2.77", "192.0.2.0"),
            (&BUDGETS[0], "2001:db8:1:2:3:4:5:6", "2001:db8:1:2::"),
            (&BUDGETS[1], "2001:db8:1:2:3:4:5:6", "2001:db8:1::"),
        ];
        for (budget, address, network) in cases {
            let network: IpAddr = network.parse().unwrap();
            assert_eq!(budget.network(address.parse().unwrap()), network);
        }
    }

    fn flow(client_ip: IpAddr, expires: Instant) -> Pending {
        Pending {
            client_ip,
            verifier: PkceCodeVerifier::new("fixture-verifier".into()),
            nonce: Nonce::new("fixture-nonce".into()),
            browser_hash: "fixture-browser-hash".into(),
            expires,
        }
    }
}
