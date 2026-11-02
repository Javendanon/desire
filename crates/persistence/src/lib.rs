//! PostgreSQL adapters for the D04 contracts, independent of domain services.
mod actors;
mod campaigns;
mod catalog;
mod encounters;
mod error;
pub mod migrations;
mod notes;
mod presence;
mod records;
mod scenes;
mod secrets;
mod sheets;
mod travel;

pub use campaigns::{CampaignRename, CampaignRepository};
pub use catalog::{CatalogRepository, CatalogSeed};
pub use error::{Error, ErrorKind};
pub use notes::NotesRepository;
pub use scenes::{SceneRepository, SceneWrite};
pub use secrets::{SecretRepository, SecretSubject};

pub use actors::ActorRepository;
pub use presence::{PopulationActivation, PresenceRepository};

pub use encounters::EncounterRepository;
pub use sheets::{SheetRepository, SheetWrite};
pub use travel::{PartyRepository, TravelRepository};
