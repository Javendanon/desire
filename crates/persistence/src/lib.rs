//! PostgreSQL adapters for the D04 contracts, independent of domain services.
mod campaigns;
mod catalog;
mod error;
pub mod migrations;

pub use campaigns::{CampaignRename, CampaignRepository};
pub use catalog::{CatalogRepository, CatalogSeed};
pub use error::{Error, ErrorKind};
