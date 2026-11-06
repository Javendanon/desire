//! A loopback-only OIDC authority with runtime-generated RSA keys and single-use PKCE codes.
use crate::support;
use axum::{
    Json, Router,
    extract::{Form, Query, State},
    http::{HeaderMap, StatusCode},
    response::Redirect,
    routing::{get, post},
};
use desire_api::auth::settings::Settings;
use openidconnect::{
    Audience, ClientSecret, EmptyAdditionalClaims, EndUserEmail, IssuerUrl, JsonWebKeyId,
    JsonWebKeySet, Nonce, PkceCodeChallenge, PkceCodeVerifier, PrivateSigningKey, StandardClaims,
    SubjectIdentifier,
    core::{CoreIdToken, CoreIdTokenClaims, CoreJwsSigningAlgorithm, CoreRsaPrivateSigningKey},
    url::Url,
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    process::Command,
    sync::{Arc, Mutex},
    thread::JoinHandle,
    time::{Duration, SystemTime},
};

pub const ORIGIN: &str = "https://table.example.test";

#[derive(Clone, Copy, Debug, Default)]
pub enum Fault {
    #[default]
    None,
    Nonce,
    Audience,
    Issuer,
    Signature,
    Expired,
    Unverified,
    MissingEmail,
}

#[derive(Clone)]
pub struct Profile {
    pub subject: String,
    pub email: String,
    pub fault: Fault,
}

struct Grant {
    nonce: String,
    challenge: String,
    redirect: String,
    profile: Profile,
}

struct Authority {
    issuer: String,
    key: CoreRsaPrivateSigningKey,
    foreign_key: CoreRsaPrivateSigningKey,
    profile: Mutex<Profile>,
    grants: Mutex<HashMap<String, Grant>>,
}

pub struct Provider {
    authority: Arc<Authority>,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl Provider {
    pub fn start() -> Self {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let issuer = format!("http://{}", listener.local_addr().unwrap());
        let authority = Arc::new(Authority {
            issuer,
            key: signing_key(),
            foreign_key: signing_key(),
            profile: Mutex::new(Profile {
                subject: "alice".into(),
                email: "alice@example.test".into(),
                fault: Fault::None,
            }),
            grants: Mutex::new(HashMap::new()),
        });
        let (stop, receiver) = tokio::sync::oneshot::channel();
        let state = authority.clone();
        let thread = std::thread::spawn(move || {
            support::run(async move {
                let app = Router::new()
                    .route("/.well-known/openid-configuration", get(discovery))
                    .route("/jwks", get(jwks))
                    .route("/authorize", get(authorize))
                    .route("/token", post(token))
                    .with_state(state);
                axum::serve(tokio::net::TcpListener::from_std(listener).unwrap(), app)
                    .with_graceful_shutdown(async {
                        let _ = receiver.await;
                    })
                    .await
                    .unwrap();
            })
        });
        Self {
            authority,
            stop: Some(stop),
            thread: Some(thread),
        }
    }

    pub fn settings(&self) -> Settings {
        Settings {
            issuer: IssuerUrl::new(self.authority.issuer.clone()).unwrap(),
            client_id: "fixture-client".into(),
            client_secret: ClientSecret::new("fixture-only-not-a-real-credential".into()),
            public_url: Url::parse(ORIGIN).unwrap(),
            allowed_emails: Default::default(),
        }
    }

    pub fn profile(&self, subject: &str, email: &str, fault: Fault) {
        *self.authority.profile.lock().unwrap() = Profile {
            subject: subject.into(),
            email: email.into(),
            fault,
        };
    }
}

impl Drop for Provider {
    fn drop(&mut self) {
        self.stop.take().unwrap().send(()).unwrap();
        self.thread.take().unwrap().join().unwrap();
    }
}

fn signing_key() -> CoreRsaPrivateSigningKey {
    let output = Command::new("openssl")
        .args(["genrsa", "-traditional", "2048"])
        .output()
        .expect("openssl is required for the local OIDC test provider");
    assert!(output.status.success());
    CoreRsaPrivateSigningKey::from_pem(
        &String::from_utf8(output.stdout).unwrap(),
        Some(JsonWebKeyId::new("fixture".into())),
    )
    .unwrap()
}

async fn discovery(State(state): State<Arc<Authority>>) -> Json<Value> {
    let issuer = &state.issuer;
    Json(json!({
        "issuer": issuer, "authorization_endpoint": format!("{issuer}/authorize"),
        "token_endpoint": format!("{issuer}/token"), "jwks_uri": format!("{issuer}/jwks"),
        "response_types_supported": ["code"], "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["client_secret_basic"]
    }))
}

async fn jwks(State(state): State<Arc<Authority>>) -> Json<Value> {
    Json(serde_json::to_value(JsonWebKeySet::new(vec![state.key.as_verification_key()])).unwrap())
}

async fn authorize(
    State(state): State<Arc<Authority>>,
    Query(query): Query<HashMap<String, String>>,
) -> Redirect {
    assert_eq!(query["response_type"], "code");
    assert_eq!(query["client_id"], "fixture-client");
    assert_eq!(query["code_challenge_method"], "S256");
    assert!(
        query["scope"]
            .split_whitespace()
            .any(|scope| scope == "openid")
    );
    let code = desire_api::auth::session::random_token().unwrap();
    state.grants.lock().unwrap().insert(
        code.clone(),
        Grant {
            nonce: query["nonce"].clone(),
            challenge: query["code_challenge"].clone(),
            redirect: query["redirect_uri"].clone(),
            profile: state.profile.lock().unwrap().clone(),
        },
    );
    let mut callback = Url::parse(&query["redirect_uri"]).unwrap();
    callback
        .query_pairs_mut()
        .append_pair("state", &query["state"])
        .append_pair("code", &code);
    Redirect::to(callback.as_str())
}

async fn token(
    State(state): State<Arc<Authority>>,
    headers: HeaderMap,
    Form(form): Form<HashMap<String, String>>,
) -> Result<Json<Value>, StatusCode> {
    assert!(
        headers["authorization"]
            .to_str()
            .unwrap()
            .starts_with("Basic ")
    );
    let grant = state
        .grants
        .lock()
        .unwrap()
        .remove(&form["code"])
        .ok_or(StatusCode::BAD_REQUEST)?;
    let challenge = PkceCodeChallenge::from_code_verifier_sha256(&PkceCodeVerifier::new(
        form["code_verifier"].clone(),
    ));
    if challenge.as_str() != grant.challenge
        || form["redirect_uri"] != grant.redirect
        || form["grant_type"] != "authorization_code"
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(Json(json!({
        "access_token": "fixture-access-token", "token_type": "Bearer", "expires_in": 3600,
        "id_token": signed_token(&state, grant)
    })))
}

fn signed_token(state: &Authority, grant: Grant) -> String {
    let key = if matches!(grant.profile.fault, Fault::Signature) {
        &state.foreign_key
    } else {
        &state.key
    };
    CoreIdToken::new(
        claims_for(state, grant),
        key,
        CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256,
        None,
        None,
    )
    .unwrap()
    .to_string()
}

fn claims_for(state: &Authority, grant: Grant) -> CoreIdTokenClaims {
    let profile = grant.profile;
    let now = SystemTime::now();
    let expiry = if matches!(profile.fault, Fault::Expired) {
        now - Duration::from_secs(60)
    } else {
        now + Duration::from_secs(3600)
    };
    let issuer = if matches!(profile.fault, Fault::Issuer) {
        ORIGIN
    } else {
        &state.issuer
    };
    let audience = if matches!(profile.fault, Fault::Audience) {
        "foreign-client"
    } else {
        "fixture-client"
    };
    let nonce = if matches!(profile.fault, Fault::Nonce) {
        "wrong-nonce".into()
    } else {
        grant.nonce
    };
    CoreIdTokenClaims::new(
        IssuerUrl::new(issuer.into()).unwrap(),
        vec![Audience::new(audience.into())],
        expiry.into(),
        now.into(),
        standard_claims(profile),
        EmptyAdditionalClaims {},
    )
    .set_nonce(Some(Nonce::new(nonce)))
}

fn standard_claims(profile: Profile) -> StandardClaims<openidconnect::core::CoreGenderClaim> {
    let standard = StandardClaims::new(SubjectIdentifier::new(profile.subject))
        .set_email_verified(Some(!matches!(profile.fault, Fault::Unverified)));
    if matches!(profile.fault, Fault::MissingEmail) {
        return standard;
    }
    standard.set_email(Some(EndUserEmail::new(profile.email)))
}
