//! PostgreSQL adapters for the D04 contracts, independent of domain services.
mod actors;
mod campaigns;
mod catalog;
mod characters;
mod encounters;
mod error;
mod memberships;
pub mod migrations;
mod notes;
mod presence;
mod reads;
mod records;
mod scenes;
mod secrets;
mod sheets;
mod travel;

pub use campaigns::{CampaignRename, CampaignRepository};
pub use catalog::{CatalogRepository, CatalogSeed};
pub use error::{Error, ErrorKind};
pub use notes::{JournalUpdate, KnowledgeUpdate, NotesRepository};
pub use scenes::{SceneRepository, SceneWrite};
pub use secrets::{SecretRepository, SecretSubject};

pub use actors::ActorRepository;
pub use presence::{PopulationActivation, PresenceRepository};

pub use encounters::EncounterRepository;
pub use sheets::{SheetRepository, SheetWrite};
pub use travel::{PartyRepository, TravelRepository};

pub use characters::{CharacterRepository, CharacterUpdate};
pub use memberships::MembershipRepository;
pub use reads::{Audience, CampaignRead, FetchPage, RecordTarget, next_id};
