//! Campaign session endpoints. Journal entries reference these rows.
use desire_core::contracts::campaign::Session;

use crate::payloads::NewSession;

list_handler!(sessions, Session);
create_handler!(sessions, Session, NewSession);
