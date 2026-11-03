//! Journal endpoints. Players receive only `players` entries.
use desire_core::contracts::campaign::JournalEntry;

use crate::payloads::{NewJournal, PatchJournal};

list_handler!(journal, JournalEntry);
get_handler!(journal, JournalEntry, "entry_id");
create_handler!(journal, JournalEntry, NewJournal);
update_handler!(journal, JournalEntry, PatchJournal, "entry_id");
delete_handler!(journal, "entry_id");
