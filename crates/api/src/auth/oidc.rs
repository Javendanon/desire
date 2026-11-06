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
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);

pub struct Oidc {
    client: DiscoveredClient,
    http: reqwest::Client,
    pub settings: Settings,
    // ponytail: process-local login state. Use shared storage for non-sticky replicas.
    pending: Mutex<HashMap<String, Pending>>,
}

struct Pending {
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

    pub fn begin(&self, request_id: &str) -> Result<Authorization, ApiError> {
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

    /// Expired flows are discarded in O(n); the map has a fixed admission ceiling.
    fn remember(&self, key: String, pending: Pending, request_id: &str) -> Result<(), ApiError> {
        let mut flows = self
            .pending
            .lock()
            .map_err(|_| ApiError::internal_for(request_id, "OIDC flow lock failed"))?;
        flows.retain(|_, flow| flow.expires > Instant::now());
        if flows.len() >= MAX_PENDING {
            return Err(ApiError::new(
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "oidc_busy",
                "too many pending authentication requests",
                request_id,
            ));
        }
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

pub struct Callback {
    pub code: String,
    pub state: String,
    pub browser: String,
}

fn validate_endpoints(metadata: &CoreProviderMetadata) -> Result<(), String> {
    settings::validate_transport(metadata.authorization_endpoint().url())?;
    settings::validate_transport(metadata.jwks_uri().url())?;
    let token = metadata
        .token_endpoint()
        .ok_or("OIDC provider has no token endpoint")?;
    settings::validate_transport(token.url())
}
