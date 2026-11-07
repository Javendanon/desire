//! Both HTTP consumers pin page metadata to one shared wire example.
use desire_api::{
    extract::Caller,
    query::{Page, PageQuery},
};

const WIRE: &str = include_str!("../../../contracts/api-page.json");

#[test]
fn page_serialization_matches_the_shared_typescript_envelope() {
    let query = PageQuery {
        limit: Some(2),
        offset: Some(1),
    };
    let caller = Caller {
        user_id: String::new(),
        request_id: String::new(),
        idempotency_key: None,
        session_hash: None,
    };
    let page = Page::from_query(&query, &caller).unwrap();
    let body = page.finish(vec!["second", "third", "look-ahead"]);
    let expected: serde_json::Value = serde_json::from_str(WIRE).unwrap();
    assert_eq!(serde_json::to_value(body).unwrap(), expected);
}
