//! DTO for the only Nivel20 read verified in D06: campaign metadata with Accept JSON.
use serde::{Deserialize, Serialize};

const MAX_NAME: usize = 300;
const MAX_DESCRIPTION: usize = 100_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CampaignMetadata {
    pub id: i64,
    #[serde(default)]
    pub game_id: Option<i64>,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
}

impl CampaignMetadata {
    /// A response for another campaign is rejected instead of being mapped to this one.
    pub fn validate(&self, expected_id: i64) -> Result<(), String> {
        if self.id != expected_id || self.id <= 0 {
            return Err("the source returned a different campaign id".into());
        }
        let name = self.name.trim();
        if name.is_empty() || name.chars().count() > MAX_NAME {
            return Err("the source campaign name is blank or too long".into());
        }
        if self
            .description
            .as_ref()
            .is_some_and(|body| body.chars().count() > MAX_DESCRIPTION)
        {
            return Err("the source campaign description is too long".into());
        }
        Ok(())
    }

    /// Fields a reimport would change, for the preview. O(number of fields).
    pub fn changed_fields(&self, previous: &Self) -> Vec<&'static str> {
        let mut fields = Vec::new();
        if self.game_id != previous.game_id {
            fields.push("game_id");
        }
        if self.name != previous.name {
            fields.push("name");
        }
        if self.description != previous.description {
            fields.push("description");
        }
        if self.created_at != previous.created_at {
            fields.push("created_at");
        }
        if self.updated_at != previous.updated_at {
            fields.push("updated_at");
        }
        if self.url != previous.url {
            fields.push("url");
        }
        fields
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata() -> CampaignMetadata {
        CampaignMetadata {
            id: 109_662,
            game_id: Some(3),
            name: "Synthetic campaign".into(),
            description: Some("Synthetic body".into()),
            created_at: None,
            updated_at: Some("2026-10-03T22:38:30.000-03:00".into()),
            url: None,
        }
    }

    #[test]
    fn unknown_fields_are_ignored_and_known_fields_are_required() {
        let parsed: CampaignMetadata = serde_json::from_str(
            r#"{"id":109662,"name":"Synthetic","extra":"ignored","description":null}"#,
        )
        .unwrap();
        assert_eq!(parsed.name, "Synthetic");
        assert!(parsed.description.is_none());

        let missing = serde_json::from_str::<CampaignMetadata>(r#"{"id":109662}"#);
        assert!(missing.is_err());
    }

    #[test]
    fn validation_rejects_mismatched_ids_and_blank_names() {
        let valid = metadata();
        assert!(valid.validate(109_662).is_ok());
        assert!(valid.validate(7).is_err());

        let mut blank = metadata();
        blank.name = "  ".into();
        assert!(blank.validate(109_662).is_err());
    }
}
