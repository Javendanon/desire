//! Atomic, append-only imports of typed editorial content.
use crate::{Error, ErrorKind, error::Context};
use desire_core::contracts::catalog::*;
use postgres::{Client, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CatalogSeed {
    pub worlds: Vec<World>,
    pub eras: Vec<Era>,
    pub cities: Vec<City>,
    pub districts: Vec<District>,
    pub places: Vec<Place>,
    pub map_versions: Vec<MapVersion>,
    pub chunks: Vec<Chunk>,
    pub knowledge_entries: Vec<KnowledgeEntry>,
}

pub struct CatalogRepository;

impl CatalogRepository {
    pub fn seed(client: &mut Client, seed: &CatalogSeed) -> Result<(), Error> {
        let mut tx = client.transaction().context("begin catalog seed")?;
        seed_rows(&mut tx, "worlds", &seed.worlds)?;
        seed_rows(&mut tx, "eras", &seed.eras)?;
        seed_rows(&mut tx, "cities", &seed.cities)?;
        seed_rows(&mut tx, "districts", &seed.districts)?;
        seed_maps(&mut tx, &seed.map_versions)?;
        seed_places(&mut tx, &seed.places)?;
        seed_chunks(&mut tx, &seed.chunks)?;
        seed_rows(&mut tx, "knowledge_entries", &seed.knowledge_entries)?;
        tx.commit().context("commit catalog seed")
    }
}

/// Import each input once, O(n) SQL statements with indexed identity comparisons.
fn seed_rows<T: Serialize>(tx: &mut Transaction<'_>, table: &str, rows: &[T]) -> Result<(), Error> {
    for row in rows {
        seed_row(
            tx,
            table,
            serde_json::to_value(row).context("encode catalog row")?,
        )?;
    }
    Ok(())
}

// Table names are private constants supplied only by this module, never user input.
fn seed_row(tx: &mut Transaction<'_>, table: &str, data: Value) -> Result<(), Error> {
    let insert = format!(
        "INSERT INTO catalog.{table} SELECT * FROM \
        jsonb_populate_record(NULL::catalog.{table}, $1) ON CONFLICT DO NOTHING"
    );
    tx.execute(&insert, &[&data])
        .context(format!("seed {table} {}", data["id"]))?;
    let query = format!(
        "SELECT to_jsonb(t) = $1 FROM catalog.{table} t \
        WHERE id = ($1->>'id')::uuid"
    );
    let row = tx
        .query_one(&query, &[&data])
        .context(format!("compare {table} seed"))?;
    if !row.get::<_, bool>(0) {
        return Err(Error::new(
            ErrorKind::SeedMismatch,
            format!(
                "catalog {table} {} differs from installed content",
                data["id"]
            ),
        ));
    }
    Ok(())
}

/// Seed logical map IDs before their immutable versions, O(n).
fn seed_maps(tx: &mut Transaction<'_>, versions: &[MapVersion]) -> Result<(), Error> {
    for version in versions {
        seed_row(tx, "maps", json!({"id": version.map_id}))?;
        seed_row(
            tx,
            "map_versions",
            serde_json::to_value(version).context("encode map version")?,
        )?;
    }
    Ok(())
}

/// Seed places and their normalized anchors in O(places + anchors).
fn seed_places(tx: &mut Transaction<'_>, places: &[Place]) -> Result<(), Error> {
    for place in places {
        let mut data = serde_json::to_value(place).context("encode place")?;
        data.as_object_mut()
            .expect("Place serializes as an object")
            .remove("anchors");
        seed_row(tx, "places", data)?;
        seed_anchors(tx, place)?;
    }
    Ok(())
}

/// Each anchor is inserted or compared once, O(anchors).
fn seed_anchors(tx: &mut Transaction<'_>, place: &Place) -> Result<(), Error> {
    for anchor in &place.anchors {
        let data = json!({"place_id": place.id, "city_id": place.city_id,
            "map_version_id": anchor.map_version_id, "x_m": anchor.position.x_m,
            "y_m": anchor.position.y_m, "z_m": anchor.position.z_m,
            "provenance": anchor.provenance});
        tx.execute(
            concat!(
                "INSERT INTO catalog.place_anchors SELECT * FROM ",
                "jsonb_populate_record(NULL::catalog.place_anchors, $1) ON CONFLICT DO NOTHING"
            ),
            &[&data],
        )
        .context(format!("seed anchors for place {}", place.id))?;
        let matches: bool = tx
            .query_one(
                concat!(
                    "SELECT to_jsonb(a) = $1 FROM catalog.place_anchors a ",
                    "WHERE place_id = ($1->>'place_id')::uuid ",
                    "AND map_version_id = ($1->>'map_version_id')::uuid"
                ),
                &[&data],
            )
            .context("compare place anchor")?
            .get(0);
        if !matches {
            return Err(Error::new(
                ErrorKind::SeedMismatch,
                format!(
                    "anchor for place {} differs from installed content",
                    place.id
                ),
            ));
        }
    }
    Ok(())
}

/// Flatten each chunk's position for normalized storage, O(chunks).
fn seed_chunks(tx: &mut Transaction<'_>, chunks: &[Chunk]) -> Result<(), Error> {
    for chunk in chunks {
        seed_row(
            tx,
            "chunks",
            json!({"id": chunk.id, "map_version_id": chunk.map_version_id,
            "x_m": chunk.origin.x_m, "y_m": chunk.origin.y_m, "z_m": chunk.origin.z_m,
            "size_m": chunk.size_m, "asset_uri": chunk.asset_uri}),
        )?;
    }
    Ok(())
}
