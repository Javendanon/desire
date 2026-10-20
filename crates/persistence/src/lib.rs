//! PostgreSQL adapters for the D04 contracts, independent of domain services.
mod campaigns;
mod catalog;
mod error;
pub mod migrations;
mod notes;
mod records;
mod scenes;
mod secrets;

pub use campaigns::{CampaignRename, CampaignRepository};
pub use catalog::{CatalogRepository, CatalogSeed};
pub use error::{Error, ErrorKind};
pub use notes::NotesRepository;
pub use scenes::{SceneRepository, SceneWrite};
pub use secrets::{SecretRepository, SecretSubject};
