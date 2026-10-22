//! Full sheet creation is atomic; mutable combat state remains a separate record.
use crate::{Error, ErrorKind, error::Context, records};
use desire_core::contracts::{
    actors::{ActorState, ActorStats},
    sheets::*,
};
use postgres::{Client, Transaction};
use serde::Serialize;

pub struct SheetWrite {
    pub sheet: CharacterSheet,
    pub stats: ActorStats,
    pub state: ActorState,
    pub classes: Vec<CharacterClass>,
    pub proficiencies: Vec<CharacterProficiency>,
    pub equipment: Vec<CharacterEquipment>,
    pub spells: Vec<CharacterSpell>,
    pub resources: Vec<ActorResource>,
    pub concentration: Option<ActorConcentration>,
}

pub struct SheetRepository;
impl SheetRepository {
    pub fn create(client: &mut Client, write: &SheetWrite) -> Result<(), Error> {
        let mut tx = client.transaction().context("begin character sheet")?;
        let mut writer = SheetWriter {
            tx: &mut tx,
            campaign: &write.sheet.campaign_id,
            actor: &write.sheet.actor_id,
        };
        writer.row("campaign.character_sheets", &write.sheet)?;
        writer.row("campaign.actor_stats", &write.stats)?;
        writer.row("campaign.actor_state", &write.state)?;
        writer.rows("campaign.character_classes", &write.classes)?;
        writer.rows("campaign.character_proficiencies", &write.proficiencies)?;
        writer.rows("campaign.character_equipment", &write.equipment)?;
        writer.rows("campaign.character_spells", &write.spells)?;
        writer.rows("campaign.actor_resources", &write.resources)?;
        if let Some(concentration) = &write.concentration {
            writer.row("campaign.actor_concentration", concentration)?;
        }
        tx.commit().context("commit character sheet")
    }
}

struct SheetWriter<'a, 'b> {
    tx: &'a mut Transaction<'b>,
    campaign: &'a str,
    actor: &'a str,
}
impl SheetWriter<'_, '_> {
    fn row<T: Serialize>(&mut self, table: &str, record: &T) -> Result<(), Error> {
        let data = serde_json::to_value(record).context("encode sheet component")?;
        if data["campaign_id"].as_str() != Some(self.campaign)
            || data["actor_id"].as_str() != Some(self.actor)
        {
            return Err(Error::new(
                ErrorKind::Conflict,
                "sheet component outside actor scope",
            ));
        }
        records::insert(self.tx, table, &data)
    }

    /// Each component is visited once; O(rows) inserts in the parent's transaction.
    fn rows<T: Serialize>(&mut self, table: &str, rows: &[T]) -> Result<(), Error> {
        for row in rows {
            self.row(table, row)?;
        }
        Ok(())
    }
}
