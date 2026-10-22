//! Actor instances copy template statistics once; later visits never heal or replace them.
use crate::{Error, ErrorKind, error::Context, records};
use desire_core::contracts::{actors::*, common::ActorStatus};
use postgres::{Client, GenericClient};

pub struct ActorRepository;

impl ActorRepository {
    pub fn create_from_template(client: &mut Client, actor: &Actor) -> Result<(), Error> {
        let mut tx = client.transaction().context("begin actor creation")?;
        spawn(&mut tx, actor)?;
        tx.commit().context("commit actor creation")
    }

    pub fn state_for_dm(
        client: &mut Client,
        campaign: &str,
        actor: &str,
    ) -> Result<Option<ActorState>, Error> {
        client
            .query_opt(
                concat!(
                    "SELECT to_jsonb(s) FROM campaign.actor_state s ",
                    "WHERE campaign_id = $1::text::uuid AND actor_id = $2::text::uuid"
                ),
                &[&campaign, &actor],
            )
            .context("read actor state")?
            .map(records::decode)
            .transpose()
    }

    pub fn update_state(
        client: &mut Client,
        state: &ActorState,
        expected: u32,
    ) -> Result<(), Error> {
        if expected.checked_add(1) != Some(state.revision) {
            return Err(Error::new(
                ErrorKind::Conflict,
                "actor state revision must increment",
            ));
        }
        let data = serde_json::to_value(state).context("encode actor state")?;
        let changed = client
            .execute(
                include_str!("queries/update_actor_state.sql"),
                &[&data, &i64::from(expected)],
            )
            .context("update actor state")?;
        if changed != 1 {
            return Err(Error::new(
                ErrorKind::Conflict,
                "actor state absent or revision changed",
            ));
        }
        Ok(())
    }

    pub fn add_condition(client: &mut Client, condition: &ActorCondition) -> Result<(), Error> {
        records::insert(client, "campaign.conditions", condition)
    }
}

pub(crate) fn template(
    client: &mut impl GenericClient,
    id: &str,
) -> Result<CreatureTemplate, Error> {
    let row = client
        .query_opt(
            "SELECT to_jsonb(t) FROM catalog.creature_templates t WHERE id = $1::text::uuid",
            &[&id],
        )
        .context("read creature template")?
        .ok_or_else(|| Error::new(ErrorKind::Conflict, "creature template does not exist"))?;
    records::decode(row)
}

pub(crate) fn spawn(tx: &mut impl GenericClient, actor: &Actor) -> Result<(), Error> {
    let id = actor.template_id.as_deref().ok_or_else(|| {
        Error::new(
            ErrorKind::Conflict,
            "template-backed actor requires a template",
        )
    })?;
    let template = template(tx, id)?;
    spawn_with_template(tx, actor, &template)
}

pub(crate) fn spawn_with_template(
    tx: &mut impl GenericClient,
    actor: &Actor,
    template: &CreatureTemplate,
) -> Result<(), Error> {
    records::insert(tx, "campaign.actors", actor)?;
    records::insert(tx, "campaign.actor_stats", &initial_stats(actor, template))?;
    records::insert(tx, "campaign.actor_state", &initial_state(actor, template))
}

fn initial_stats(actor: &Actor, template: &CreatureTemplate) -> ActorStats {
    ActorStats {
        campaign_id: actor.campaign_id.clone(),
        actor_id: actor.id.clone(),
        abilities: template.abilities.clone(),
        armor_class: template.armor_class,
        speed_m: template.speed_m,
        revision: 1,
    }
}

fn initial_state(actor: &Actor, template: &CreatureTemplate) -> ActorState {
    ActorState {
        campaign_id: actor.campaign_id.clone(),
        actor_id: actor.id.clone(),
        max_hp: template.max_hp,
        current_hp: template.max_hp,
        temporary_hp: 0,
        status: ActorStatus::Active,
        revision: 1,
    }
}
