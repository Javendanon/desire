//! Invalid wire values must not silently disable idempotency.
use crate::support::{self, TestDb, id, map_version, uri};
use axum::{
    body::{Body, to_bytes},
    http::{HeaderValue, Request, StatusCode},
};
use serde_json::{Value, json};

#[test]
fn non_ascii_idempotency_header_is_rejected_without_creating_a_scene() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let campaign = support::run(support::campaign(&app, &owner));
    let request = Request::builder()
        .method("POST")
        .uri(uri(&campaign, "/scenes"))
        .header("x-desire-user", &owner)
        .header("x-request-id", id(501))
        .header("content-type", "application/json")
        .header("idempotency-key", HeaderValue::from_bytes(b"\xff").unwrap())
        .body(Body::from(
            json!({"name":"Dock", "map_version_id":map_version()}).to_string(),
        ))
        .unwrap();
    let response = support::run(tower::ServiceExt::oneshot(app.clone(), request)).unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let bytes = support::run(to_bytes(response.into_body(), usize::MAX)).unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["code"], "invalid_request");
    assert_eq!(body["request_id"], id(501));
    let count: i64 = db
        .connection()
        .query_one("SELECT count(*) FROM campaign.scenes", &[])
        .unwrap()
        .get(0);
    assert_eq!(count, 0);
}
