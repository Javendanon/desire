//! DM population activation is atomic and once-only; player projections omit hidden actors.
use crate::{Error, ErrorKind, actors, error::Context, records};
use desire_core::contracts::{actors::Actor, adventure::*, common::*};
use postgres::{Client, GenericClient, IsolationLevel};

pub struct PopulationActivation<'a> {
    pub campaign_id: &'a str,
    pub rule_id: &'a str,
    pub actor_ids: &'a [String],
}

pub struct PresenceRepository;

impl PresenceRepository {
    pub fn create_rule(client: &mut Client, rule: &PopulationRule) -> Result<(), Error> {
        records::insert(client, "campaign.place_population_rules", rule)
    }

    pub fn activate_for_dm(
        client: &mut Client,
        activation: &PopulationActivation<'_>,
    ) -> Result<Vec<Actor>, Error> {
        let mut tx = client
            .build_transaction()
            .isolation_level(IsolationLevel::ReadCommitted)
            .start()
            .context("begin population activation")?;
        let rule = lock_rule(&mut tx, activation)?;
        if !has_run(&mut tx, activation)? {
            populate(&mut tx, &rule, activation.actor_ids)?;
        }
        let actors = generated_actors(&mut tx, activation)?;
        tx.commit().context("commit population activation")?;
        Ok(actors)
    }

    pub fn player_residents(
        client: &mut Client,
        campaign: &str,
        place: &str,
    ) -> Result<Vec<PlayerResident>, Error> {
        let rows = client.query(concat!(
            "SELECT jsonb_build_object('actor_id', a.id, 'name', a.name, ",
            "'kind', a.kind, 'disposition', a.disposition) FROM campaign.place_occupants p ",
            "JOIN campaign.actors a ON a.campaign_id = p.campaign_id AND a.id = p.actor_id ",
            "WHERE p.campaign_id = $1::text::uuid AND p.place_id = $2::text::uuid ",
            "AND p.presence = 'present' AND p.visibility = 'players' ",
            "AND a.visibility = 'players' ORDER BY a.id"
        ), &[&campaign, &place]).context("read player-visible residents")?;
        records::decode_all(rows)
    }
}

fn lock_rule(
    tx: &mut impl GenericClient,
    activation: &PopulationActivation<'_>,
) -> Result<PopulationRule, Error> {
    let row = tx
        .query_opt(
            concat!(
                "SELECT to_jsonb(r) FROM campaign.place_population_rules r ",
                "WHERE campaign_id = $1::text::uuid AND id = $2::text::uuid FOR UPDATE"
            ),
            &[&activation.campaign_id, &activation.rule_id],
        )
        .context("lock population rule")?
        .ok_or_else(|| Error::new(ErrorKind::Conflict, "population rule absent in campaign"))?;
    records::decode(row)
}

fn has_run(
    tx: &mut impl GenericClient,
    activation: &PopulationActivation<'_>,
) -> Result<bool, Error> {
    Ok(tx
        .query_opt(
            concat!(
                "SELECT 1 FROM campaign.population_runs WHERE campaign_id = $1::text::uuid ",
                "AND rule_id = $2::text::uuid"
            ),
            &[&activation.campaign_id, &activation.rule_id],
        )
        .context("read population activation")?
        .is_some())
}

/// Materialize the chosen count once; O(actors), with one template read for the batch.
fn populate(
    tx: &mut impl GenericClient,
    rule: &PopulationRule,
    ids: &[String],
) -> Result<(), Error> {
    record_run(tx, rule, ids.len())?;
    let template = actors::template(tx, &rule.template_id)?;
    for id in ids {
        let actor = resident_actor(rule, id, &template.name);
        actors::spawn_with_template(tx, &actor, &template)?;
        record_resident(tx, rule, id)?;
    }
    Ok(())
}

fn record_run(
    tx: &mut impl GenericClient,
    rule: &PopulationRule,
    count: usize,
) -> Result<(), Error> {
    if count < rule.quantity_min as usize || count > rule.quantity_max as usize {
        return Err(Error::new(
            ErrorKind::Conflict,
            "population count outside configured bounds",
        ));
    }
    tx.execute(
        "INSERT INTO campaign.population_runs VALUES ($1::text::uuid, $2::text::uuid)",
        &[&rule.campaign_id, &rule.id],
    )
    .context("record population activation")?;
    Ok(())
}

fn resident_actor(rule: &PopulationRule, id: &str, name: &str) -> Actor {
    Actor {
        id: id.into(),
        campaign_id: rule.campaign_id.clone(),
        rules_edition: rule.rules_edition.clone(),
        character_id: None,
        template_id: Some(rule.template_id.clone()),
        kind: ActorKind::Monster,
        name: name.into(),
        visibility: rule.visibility.clone(),
        disposition: rule.disposition.clone(),
        revision: 1,
    }
}

fn record_resident(
    tx: &mut impl GenericClient,
    rule: &PopulationRule,
    id: &str,
) -> Result<(), Error> {
    let resident = PlaceOccupant {
        campaign_id: rule.campaign_id.clone(),
        actor_id: id.into(),
        place_id: rule.place_id.clone(),
        presence: Presence::Present,
        visibility: rule.visibility.clone(),
        revision: 1,
    };
    records::insert(tx, "campaign.place_occupants", &resident)?;
    tx.execute(
        concat!(
            "INSERT INTO campaign.population_spawned_actors ",
            "VALUES ($1::text::uuid, $2::text::uuid, $3::text::uuid)"
        ),
        &[&rule.campaign_id, &rule.id, &id],
    )
    .context("link generated resident")?;
    Ok(())
}

fn generated_actors(
    tx: &mut impl GenericClient,
    activation: &PopulationActivation<'_>,
) -> Result<Vec<Actor>, Error> {
    let rows = tx
        .query(
            concat!(
                "SELECT to_jsonb(a) FROM campaign.population_spawned_actors p ",
                "JOIN campaign.actors a ON a.campaign_id = p.campaign_id AND a.id = p.actor_id ",
                "WHERE p.campaign_id = $1::text::uuid AND p.rule_id = $2::text::uuid ORDER BY a.id"
            ),
            &[&activation.campaign_id, &activation.rule_id],
        )
        .context("read generated residents")?;
    records::decode_all(rows)
}
