//! Scene writes, optimistic revisions, stream sequencing, and idempotency share one transaction.
use crate::{Error, ErrorKind, error::Context, records};
use desire_core::{
    PROTOCOL_VERSION,
    contracts::{campaign::Scene, transport::SceneChanged},
};
use postgres::{Client, GenericClient};
use serde_json::{Value, json};

pub struct SceneWrite {
    pub scene: Scene,
    pub expected_revision: Option<u32>,
    pub event_id: String,
    pub key: String,
}

pub struct SceneRepository;

impl SceneRepository {
    pub fn get(client: &mut Client, campaign: &str, id: &str) -> Result<Option<Scene>, Error> {
        client
            .query_opt(
                concat!(
                    "SELECT to_jsonb(s) FROM campaign.scenes s ",
                    "WHERE campaign_id = $1::text::uuid AND id = $2::text::uuid"
                ),
                &[&campaign, &id],
            )
            .context(format!("read scene {id} in campaign {campaign}"))?
            .map(records::decode)
            .transpose()
    }

    pub fn save_and_enqueue(
        client: &mut Client,
        write: &SceneWrite,
    ) -> Result<SceneChanged, Error> {
        let mut tx = client.transaction().context("begin scene write")?;
        lock_stream(&mut tx, &write.scene.campaign_id)?;
        let request = json!({"scene": write.scene, "expected_revision": write.expected_revision,
            "event_id": write.event_id});
        if let Some(event) = replay(&mut tx, write, &request)? {
            tx.commit().context("commit idempotent scene replay")?;
            return Ok(event);
        }
        save_scene(&mut tx, write)?;
        let event = enqueue(&mut tx, write)?;
        record_key(&mut tx, write, &request)?;
        tx.commit().context(format!(
            "commit scene {} and event {}",
            write.scene.id, write.event_id
        ))?;
        Ok(event)
    }
}

fn record_key(
    tx: &mut impl GenericClient,
    write: &SceneWrite,
    request: &Value,
) -> Result<(), Error> {
    let query = concat!(
        "INSERT INTO campaign.idempotency_keys (campaign_id, key, event_id, request) ",
        "VALUES ($1::text::uuid, $2::text::uuid, $3::text::uuid, $4)"
    );
    tx.execute(
        query,
        &[
            &write.scene.campaign_id,
            &write.key,
            &write.event_id,
            request,
        ],
    )
    .context("record scene idempotency key")?;
    Ok(())
}

fn lock_stream(tx: &mut impl GenericClient, campaign: &str) -> Result<(), Error> {
    tx.execute(
        concat!(
            "INSERT INTO campaign.streams (campaign_id) VALUES ($1::text::uuid) ",
            "ON CONFLICT DO NOTHING"
        ),
        &[&campaign],
    )
    .context("initialize campaign stream")?;
    tx.query_one(
        "SELECT revision FROM campaign.streams WHERE campaign_id = $1::text::uuid FOR UPDATE",
        &[&campaign],
    )
    .context(format!("lock stream for campaign {campaign}"))?;
    Ok(())
}

fn replay(
    tx: &mut impl GenericClient,
    write: &SceneWrite,
    request: &Value,
) -> Result<Option<SceneChanged>, Error> {
    let row = tx.query_opt(concat!(
        "SELECT k.request, o.stream_revision FROM campaign.idempotency_keys k ",
        "JOIN campaign.outbox o ON o.campaign_id = k.campaign_id AND o.event_id = k.event_id ",
        "WHERE k.campaign_id = $1::text::uuid AND k.key = $2::text::uuid"),
        &[&write.scene.campaign_id, &write.key]).context("read scene idempotency key")?;
    let Some(row) = row else { return Ok(None) };
    if row.get::<_, Value>(0) != *request {
        return Err(Error::new(
            ErrorKind::Conflict,
            "idempotency key reused for a different scene write",
        ));
    }
    Ok(Some(event(write, row.get::<_, i64>(1) as u32)))
}

fn save_scene(tx: &mut impl GenericClient, write: &SceneWrite) -> Result<(), Error> {
    let scene = &write.scene;
    let Some(expected) = write.expected_revision else {
        if scene.revision != 1 {
            return Err(Error::new(
                ErrorKind::Conflict,
                "new scene revision must be 1",
            ));
        }
        return records::insert(tx, "campaign.scenes", scene);
    };
    if expected.checked_add(1) != Some(scene.revision) {
        return Err(Error::new(
            ErrorKind::Conflict,
            "scene revision must increment without overflow",
        ));
    }
    update_scene(tx, scene, expected)
}

fn update_scene(tx: &mut impl GenericClient, scene: &Scene, expected: u32) -> Result<(), Error> {
    let query = concat!(
        "UPDATE campaign.scenes SET name = $3, map_version_id = $4::text::uuid, ",
        "revision = revision + 1 WHERE campaign_id = $1::text::uuid ",
        "AND id = $2::text::uuid AND revision = $5"
    );
    let affected = tx
        .execute(
            query,
            &[
                &scene.campaign_id,
                &scene.id,
                &scene.name,
                &scene.map_version_id,
                &i64::from(expected),
            ],
        )
        .context(format!(
            "update scene {} in campaign {}",
            scene.id, scene.campaign_id
        ))?;
    if affected == 0 {
        return Err(Error::new(
            ErrorKind::Conflict,
            "scene is absent or revision changed",
        ));
    }
    Ok(())
}

fn enqueue(tx: &mut impl GenericClient, write: &SceneWrite) -> Result<SceneChanged, Error> {
    let query = concat!(
        "UPDATE campaign.streams SET revision = revision + 1 ",
        "WHERE campaign_id = $1::text::uuid RETURNING revision"
    );
    let revision: i64 = tx
        .query_one(query, &[&write.scene.campaign_id])
        .context("advance campaign stream")?
        .get(0);
    tx.execute(
        concat!(
            "INSERT INTO campaign.outbox (event_id, campaign_id, stream_revision, kind, scene_id) ",
            "VALUES ($1::text::uuid, $2::text::uuid, $3::bigint, 'scene_changed', $4::text::uuid)"
        ),
        &[
            &write.event_id,
            &write.scene.campaign_id,
            &revision,
            &write.scene.id,
        ],
    )
    .context(format!("enqueue scene event {}", write.event_id))?;
    Ok(event(write, revision as u32))
}

fn event(write: &SceneWrite, revision: u32) -> SceneChanged {
    SceneChanged {
        protocol_version: PROTOCOL_VERSION,
        event_id: write.event_id.clone(),
        campaign_id: write.scene.campaign_id.clone(),
        revision,
        scene_id: write.scene.id.clone(),
        kind: "scene_changed".into(),
    }
}
