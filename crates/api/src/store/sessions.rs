//! Campaign session reads and writes. Only a DM opens a session; any member reads them.
use super::{Scope, next_id};
use crate::{access, error::ApiError, payloads::NewSession};
use desire_core::contracts::campaign::Session;
use desire_persistence::NotesRepository;
use postgres::Client;

collection_list!(Session, NotesRepository, list_sessions);

pub fn create(
    client: &mut Client,
    scope: Scope<'_>,
    body: NewSession,
) -> Result<Session, ApiError> {
    access::require_dm(client, scope.caller, scope.campaign_id)?;
    let session = Session {
        id: next_id(client, scope.caller)?,
        campaign_id: scope.campaign_id.to_string(),
        title: body.title,
        revision: 1,
    };
    NotesRepository::create_session(client, &session)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?;
    Ok(session)
}
