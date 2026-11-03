//! Campaign knowledge endpoints. Only a DM writes lore.
use desire_core::contracts::campaign::CampaignKnowledge;

use crate::payloads::{NewKnowledge, PatchKnowledge};

list_handler!(knowledge, CampaignKnowledge);
get_handler!(knowledge, CampaignKnowledge, "entry_id");
create_handler!(knowledge, CampaignKnowledge, NewKnowledge);
update_handler!(knowledge, CampaignKnowledge, PatchKnowledge, "entry_id");
delete_handler!(knowledge, "entry_id");
