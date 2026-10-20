//! PostgreSQL adapters for the D04 contracts, independent of domain services.
mod campaigns;
mod error;
pub mod migrations;

pub use campaigns::{CampaignRename, CampaignRepository};
pub use error::{Error, ErrorKind};
