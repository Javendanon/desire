//! Request payloads. Each `clean` returns the canonical values the store will persist.
use crate::{
    error::ApiError,
    extract::Caller,
    validation::{self, MAX_BODY, MAX_NAME, MAX_TITLE, or_invalid},
};
use desire_core::contracts::common::{Id, MemberRole, Provenance, RulesEdition, Visibility};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewCampaign {
    pub name: String,
    pub rules_edition: RulesEdition,
    pub city_id: Option<Id>,
}

impl NewCampaign {
    pub fn clean(self, caller: &Caller) -> Result<Self, ApiError> {
        Ok(Self {
            name: or_invalid(validation::text(&self.name, "name", MAX_NAME), caller)?,
            rules_edition: self.rules_edition,
            city_id: self
                .city_id
                .map(|value| or_invalid(validation::id(&value, "city_id"), caller))
                .transpose()?,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchCampaign {
    pub name: String,
    pub expected_revision: u32,
}

impl PatchCampaign {
    pub fn clean(self, caller: &Caller) -> Result<Self, ApiError> {
        Ok(Self {
            name: or_invalid(validation::text(&self.name, "name", MAX_NAME), caller)?,
            expected_revision: or_invalid(validation::revision(self.expected_revision), caller)?,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewMember {
    pub user_id: Id,
    pub role: MemberRole,
}

impl NewMember {
    pub fn clean(self, caller: &Caller) -> Result<Self, ApiError> {
        Ok(Self {
            user_id: or_invalid(validation::id(&self.user_id, "user_id"), caller)?,
            role: self.role,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewScene {
    pub name: String,
    pub map_version_id: Id,
}

impl NewScene {
    pub fn clean(self, caller: &Caller) -> Result<Self, ApiError> {
        Ok(Self {
            name: or_invalid(validation::text(&self.name, "name", MAX_NAME), caller)?,
            map_version_id: or_invalid(
                validation::id(&self.map_version_id, "map_version_id"),
                caller,
            )?,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchScene {
    pub name: String,
    pub map_version_id: Id,
    pub expected_revision: u32,
}

impl PatchScene {
    pub fn clean(self, caller: &Caller) -> Result<Self, ApiError> {
        Ok(Self {
            expected_revision: or_invalid(validation::revision(self.expected_revision), caller)?,
            name: or_invalid(validation::text(&self.name, "name", MAX_NAME), caller)?,
            map_version_id: or_invalid(
                validation::id(&self.map_version_id, "map_version_id"),
                caller,
            )?,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewCharacter {
    pub name: String,
    pub controller_id: Option<Id>,
    pub rules_edition: RulesEdition,
}

impl NewCharacter {
    pub fn clean(self, caller: &Caller) -> Result<Self, ApiError> {
        Ok(Self {
            name: or_invalid(validation::text(&self.name, "name", MAX_NAME), caller)?,
            controller_id: clean_controller(self.controller_id, caller)?,
            rules_edition: self.rules_edition,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchCharacter {
    pub name: String,
    /// Required, but an explicit `null` clears the controller. Omitting it is a 400.
    #[serde(deserialize_with = "Option::deserialize")]
    pub controller_id: Option<Id>,
    pub expected_revision: u32,
}

impl PatchCharacter {
    pub fn clean(self, caller: &Caller) -> Result<Self, ApiError> {
        Ok(Self {
            expected_revision: or_invalid(validation::revision(self.expected_revision), caller)?,
            name: or_invalid(validation::text(&self.name, "name", MAX_NAME), caller)?,
            controller_id: clean_controller(self.controller_id, caller)?,
        })
    }
}

fn clean_controller(value: Option<Id>, caller: &Caller) -> Result<Option<Id>, ApiError> {
    value
        .map(|value| or_invalid(validation::id(&value, "controller_id"), caller))
        .transpose()
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewSession {
    pub title: String,
}

impl NewSession {
    pub fn clean(self, caller: &Caller) -> Result<Self, ApiError> {
        Ok(Self {
            title: or_invalid(validation::text(&self.title, "title", MAX_TITLE), caller)?,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewJournal {
    pub session_id: Id,
    pub body: String,
    pub visibility: Visibility,
}

impl NewJournal {
    pub fn clean(self, caller: &Caller) -> Result<Self, ApiError> {
        Ok(Self {
            session_id: or_invalid(validation::id(&self.session_id, "session_id"), caller)?,
            body: or_invalid(validation::text(&self.body, "body", MAX_BODY), caller)?,
            visibility: self.visibility,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchJournal {
    pub body: String,
    pub visibility: Visibility,
    pub expected_revision: u32,
}

impl PatchJournal {
    pub fn clean(self, caller: &Caller) -> Result<Self, ApiError> {
        Ok(Self {
            expected_revision: or_invalid(validation::revision(self.expected_revision), caller)?,
            body: or_invalid(validation::text(&self.body, "body", MAX_BODY), caller)?,
            visibility: self.visibility,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewKnowledge {
    pub title: String,
    pub body: String,
    pub visibility: Visibility,
    pub provenance: Provenance,
}

impl NewKnowledge {
    pub fn clean(self, caller: &Caller) -> Result<Self, ApiError> {
        Ok(Self {
            title: or_invalid(validation::text(&self.title, "title", MAX_TITLE), caller)?,
            body: or_invalid(validation::text(&self.body, "body", MAX_BODY), caller)?,
            visibility: self.visibility,
            provenance: or_invalid(validation::provenance(&self.provenance), caller)?,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchKnowledge {
    pub title: String,
    pub body: String,
    pub visibility: Visibility,
    pub provenance: Provenance,
    pub expected_revision: u32,
}

impl PatchKnowledge {
    pub fn clean(self, caller: &Caller) -> Result<Self, ApiError> {
        Ok(Self {
            expected_revision: or_invalid(validation::revision(self.expected_revision), caller)?,
            title: or_invalid(validation::text(&self.title, "title", MAX_TITLE), caller)?,
            body: or_invalid(validation::text(&self.body, "body", MAX_BODY), caller)?,
            visibility: self.visibility,
            provenance: or_invalid(validation::provenance(&self.provenance), caller)?,
        })
    }
}
