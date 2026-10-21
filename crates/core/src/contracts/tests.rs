//! Verify shape, wire names and absence of DM fields in player DTOs.

use super::common::RulesEdition;
use super::transport::{Examples, PlayerSnapshot};

const EXAMPLES: &str = include_str!("../../../../contracts/examples.json");

#[test]
fn fixtures_round_trip_without_losing_wire_fields() {
    let examples: Examples = serde_json::from_str(EXAMPLES).expect("valid fixtures");
    let original: serde_json::Value = serde_json::from_str(EXAMPLES).expect("valid JSON");
    let encoded = serde_json::to_value(examples).expect("serializable DTOs");
    assert_eq!(encoded, original);
}

#[test]
fn rule_editions_have_explicit_wire_names() {
    assert_eq!(
        serde_json::to_string(&RulesEdition::Dnd2014).expect("serializable edition"),
        "\"dnd_2014\""
    );
    assert!(serde_json::from_str::<RulesEdition>("\"dnd_2025\"").is_err());
}

#[test]
fn player_snapshot_rejects_dm_fields() {
    let mut examples: serde_json::Value = serde_json::from_str(EXAMPLES).expect("valid JSON");
    let snapshot = &mut examples["snapshots"][0];
    snapshot["secrets"] = serde_json::json!([]);
    assert!(serde_json::from_value::<PlayerSnapshot>(snapshot.clone()).is_err());
}

#[test]
fn nullable_fields_must_still_be_present() {
    let mut examples: serde_json::Value = serde_json::from_str(EXAMPLES).expect("valid JSON");
    examples["places"][0]
        .as_object_mut()
        .expect("place object")
        .remove("district_id");
    assert!(serde_json::from_value::<Examples>(examples).is_err());
}

#[test]
fn example_protocol_versions_match_core() {
    let examples: Examples = serde_json::from_str(EXAMPLES).expect("valid fixtures");
    for snapshot in examples.snapshots {
        assert_eq!(snapshot.protocol_version, crate::PROTOCOL_VERSION);
    }
    for event in examples.scene_events {
        assert_eq!(event.protocol_version, crate::PROTOCOL_VERSION);
    }
    for event in examples.travel_events {
        assert_eq!(event.protocol_version, crate::PROTOCOL_VERSION);
    }
}
