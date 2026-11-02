//! Character endpoints.
use desire_core::contracts::campaign::Character;

use crate::payloads::{NewCharacter, PatchCharacter};

list_handler!(characters, Character);
get_handler!(characters, Character, "character_id");
create_handler!(characters, Character, NewCharacter);
update_handler!(characters, Character, PatchCharacter, "character_id");
delete_handler!(characters, "character_id");
