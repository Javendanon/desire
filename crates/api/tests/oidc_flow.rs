//! Browser-shaped redirects exercise discovery, JWKS, signed claims and cookie issuance.
use crate::{
    oidc_provider::{Fault, ORIGIN, Provider},
    support::{self, ApiCall, Response, TestDb},
};
use axum::{
    Router,
    http::{Method, StatusCode},
};
use desire_api::auth::{oidc::Oidc, session::SESSION_COOKIE};
use openidconnect::{reqwest, url::Url};
use serde_json::Value;

pub struct Fixture {
    pub db: TestDb,
    pub app: Router,
    pub provider: Provider,
}

pub struct Flow {
    pub callback: Url,
    pub browser: String,
}

impl Fixture {
    pub fn new(allowed: &str) -> Self {
        let db = TestDb::new();
        let provider = Provider::start();
        let mut settings = provider.settings();
        settings.allowed_emails = desire_api::auth::settings::email_list(allowed);
        let oidc = support::run(Oidc::discover(settings)).unwrap();
        let app = desire_api::app(db.strict_state().with_oidc(oidc));
        Self { db, app, provider }
    }

    pub fn begin(&self) -> Flow {
        let start = support::run(support::call(
            &self.app,
            ApiCall::new(Method::GET, "/api/v1/auth/login"),
        ));
        assert_eq!(start.status, StatusCode::SEE_OTHER, "{}", start.body);
        assert_eq!(start.headers["cache-control"], "no-store");
        let name = start.headers["set-cookie"]
            .to_str()
            .unwrap()
            .split_once('=')
            .unwrap()
            .0;
        let browser = cookie_pair(&start, name);
        let callback = support::run(async {
            let client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .no_proxy()
                .build()
                .unwrap();
            let response = client
                .get(start.headers["location"].to_str().unwrap())
                .send()
                .await
                .unwrap();
            Url::parse(response.headers()["location"].to_str().unwrap()).unwrap()
        });
        assert_eq!(callback.origin().ascii_serialization(), ORIGIN);
        Flow { callback, browser }
    }

    pub fn finish(&self, flow: &Flow) -> Response {
        let path = format!(
            "{}?{}",
            flow.callback.path(),
            flow.callback.query().unwrap()
        );
        support::run(support::call(
            &self.app,
            ApiCall::new(Method::GET, &path).headers(&[("cookie", &flow.browser)]),
        ))
    }

    pub fn login(&self, subject: &str) -> Value {
        self.provider
            .profile(subject, &format!("{subject}@example.test"), Fault::None);
        let response = self.finish(&self.begin());
        assert_eq!(response.status, StatusCode::SEE_OTHER, "{}", response.body);
        assert_eq!(response.headers["location"], format!("{ORIGIN}/"));
        assert_eq!(response.body, Value::Null);
        let pair = cookie_pair(&response, SESSION_COOKIE);
        let token = pair.split_once('=').unwrap().1;
        let identity = support::run(support::call(
            &self.app,
            ApiCall::new(Method::GET, "/api/v1/auth/identity").session(token),
        ));
        assert_eq!(identity.status, StatusCode::OK, "{}", identity.body);
        serde_json::json!({"token": token, "user_id": identity.body["user_id"],
            "email": identity.body["email"]})
    }
}

pub fn cookie_pair(response: &Response, name: &str) -> String {
    let cookie = response
        .headers
        .get_all("set-cookie")
        .iter()
        .map(|value| value.to_str().unwrap())
        .find(|value| value.starts_with(&format!("{name}=")))
        .expect("the response must set the requested cookie");
    for attribute in ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"] {
        assert!(
            cookie.contains(attribute),
            "missing cookie attribute {attribute}"
        );
    }
    assert!(!cookie.contains("Domain="));
    cookie.split(';').next().unwrap().to_string()
}
