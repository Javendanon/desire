//! The two GeoJSON shapes the source map uses: street centrelines (`LineString`) and ward
//! outlines (`Polygon`, outer ring only). Other properties and geometry types are rejected by
//! name rather than ignored.

use std::{fs, path::Path};

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Properties {
    #[serde(rename = "Type")]
    pub kind: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "coordinates")]
pub enum Geometry {
    LineString(Vec<[f64; 2]>),
    Polygon(Vec<Vec<[f64; 2]>>),
}

#[derive(Debug, Deserialize)]
pub struct Feature {
    pub properties: Properties,
    pub geometry: Geometry,
}

#[derive(Deserialize)]
struct Collection {
    features: Vec<Feature>,
}

impl Feature {
    /// The line of a street, or the outer ring of a ward, in `[lng, lat]` degrees.
    pub fn points(&self) -> &[[f64; 2]] {
        match &self.geometry {
            Geometry::LineString(points) => points,
            Geometry::Polygon(rings) => rings.first().map_or(&[], Vec::as_slice),
        }
    }
}

/// The features of a GeoJSON file, with the file named in any error.
pub fn read_features(path: &Path) -> Result<Vec<Feature>, String> {
    let text = fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))?;
    serde_json::from_str::<Collection>(&text)
        .map(|collection| collection.features)
        .map_err(|error| format!("{}: {error}", path.display()))
}
