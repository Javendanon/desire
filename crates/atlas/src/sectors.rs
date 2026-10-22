//! Cuts the city's features into sector payloads, ported from `tools/assets/src/sectors.ts` and
//! `tools/assets/export-sectors.ts`: sectors of 1024 × 1024 source pixels, a feature in the
//! sector holding its point, houses keeping the stable id their layer gave them, and the
//! city-wide roof palette in `index.json`.

use std::collections::BTreeMap;

use desire_core::sector::{Berth, House, Sector, Tree, write_sector};
use serde::{Deserialize, Serialize};

use crate::features::{ShipSpec, TreeSpec, find_berths, plant_trees};
use crate::palette::roof_centres;
use crate::plan::Plan;
use crate::raster_ops::Size;

pub const SECTOR_PX: usize = 1024;
pub const FORMAT: &str = "desire.sector-render/1";

#[derive(Clone, Copy, Debug, Serialize)]
pub struct SectorGrid {
    pub columns: usize,
    pub rows: usize,
    pub size_px: usize,
    pub size_m: f64,
    pub metres_per_pixel: f64,
}

impl SectorGrid {
    pub fn new(size: Size, metres_per_pixel: f64) -> Self {
        SectorGrid {
            columns: size.width.div_ceil(SECTOR_PX),
            rows: size.height.div_ceil(SECTOR_PX),
            size_px: SECTOR_PX,
            size_m: SECTOR_PX as f64 * metres_per_pixel,
            metres_per_pixel,
        }
    }

    /// The sector holding a point; points off the grid go to the nearest edge sector.
    fn sector_of(&self, x_m: f64, z_m: f64) -> usize {
        let cell = |value: f64, count: usize| {
            (value / self.size_m)
                .floor()
                .max(0.0)
                .min(count as f64 - 1.0)
        };
        cell(z_m, self.rows) as usize * self.columns + cell(x_m, self.columns) as usize
    }

    fn empty(&self, index: usize) -> Sector {
        Sector {
            index: index as u32,
            origin_x_m: ((index % self.columns) as f64 * self.size_m) as f32,
            origin_z_m: ((index / self.columns) as f64 * self.size_m) as f32,
            size_m: self.size_m as f32,
            houses: Vec::new(),
            berths: Vec::new(),
            trees: Vec::new(),
        }
    }
}

/// A house as a houses layer stores it.
#[derive(Clone, Debug, Deserialize)]
pub struct LayerHouse {
    pub center: Plan,
    pub width_m: f64,
    pub depth_m: f64,
    pub rotation_radians: f64,
    pub frontage: bool,
    pub height_m: f64,
    pub roof_rgb: [u8; 3],
    pub id: u32,
}

#[derive(Deserialize)]
pub struct HousesLayer {
    pub metres_per_pixel: f64,
    pub houses: Vec<LayerHouse>,
}

fn sector_house(house: &LayerHouse) -> House {
    House {
        id: house.id,
        x_m: house.center.x_m as f32,
        z_m: house.center.z_m as f32,
        width_m: house.width_m as f32,
        depth_m: house.depth_m as f32,
        rotation_radians: house.rotation_radians as f32,
        height_m: house.height_m as f32,
        roof_rgb: house.roof_rgb,
        frontage: house.frontage,
    }
}

/// A point feature in map metres, still in double precision: the sector is chosen from these
/// values, and they become `f32` only in the payload, as in the TypeScript exporter.
#[derive(Clone, Copy, Debug)]
pub struct MetrePoint {
    pub x_m: f64,
    pub z_m: f64,
    /// Heading in radians for a berth, scale for a tree.
    pub value: f64,
}

/// Berths and trees found on the class raster, in map metres.
pub struct Features {
    pub berths: Vec<MetrePoint>,
    pub trees: Vec<MetrePoint>,
}

/// The surface classes a feature search reads, with their size.
pub struct ClassRaster<'a> {
    pub classes: &'a [u8],
    pub size: Size,
}

/// Berths for z18 caravels and garden trees, as both TypeScript exporters find them.
pub fn features_in_metres(raster: &ClassRaster, metres_per_pixel: f64, seed: u32) -> Features {
    let (classes, size) = (raster.classes, raster.size);
    let point = |x_px: f64, y_px: f64, value: f64| MetrePoint {
        x_m: x_px * metres_per_pixel,
        z_m: y_px * metres_per_pixel,
        value,
    };
    let berths = find_berths(classes, size, &ShipSpec::caravel_z18(seed));
    let trees = plant_trees(classes, size, &TreeSpec::orchard_z18(seed));
    Features {
        berths: berths
            .iter()
            .map(|b| point(b.x_px, b.y_px, b.heading_radians))
            .collect(),
        trees: trees
            .iter()
            .map(|t| point(t.x_px, t.y_px, t.scale))
            .collect(),
    }
}

/// Sectors being filled, created when their first feature lands.
struct Sectors<'a> {
    grid: &'a SectorGrid,
    by_index: BTreeMap<usize, Sector>,
}

impl Sectors<'_> {
    fn at(&mut self, x_m: f64, z_m: f64) -> &mut Sector {
        let grid = self.grid;
        let index = grid.sector_of(x_m, z_m);
        self.by_index
            .entry(index)
            .or_insert_with(|| grid.empty(index))
    }

    fn add_berth(&mut self, berth: &MetrePoint) {
        let (x_m, z_m, heading_radians) = (berth.x_m as f32, berth.z_m as f32, berth.value as f32);
        self.at(berth.x_m, berth.z_m).berths.push(Berth {
            x_m,
            z_m,
            heading_radians,
        });
    }

    fn add_tree(&mut self, tree: &MetrePoint) {
        let (x_m, z_m, scale) = (tree.x_m as f32, tree.z_m as f32, tree.value as f32);
        self.at(tree.x_m, tree.z_m)
            .trees
            .push(Tree { x_m, z_m, scale });
    }
}

/// Non-empty sectors in index order, features in input order within each. The sector comes
/// from the double-precision point. O(features · log sectors).
pub fn partition(grid: &SectorGrid, houses: &[LayerHouse], features: &Features) -> Vec<Sector> {
    let mut sectors = Sectors {
        grid,
        by_index: BTreeMap::new(),
    };
    for house in houses {
        sectors
            .at(house.center.x_m, house.center.z_m)
            .houses
            .push(sector_house(house));
    }
    features
        .berths
        .iter()
        .for_each(|berth| sectors.add_berth(berth));
    features
        .trees
        .iter()
        .for_each(|tree| sectors.add_tree(tree));
    sectors.by_index.into_values().collect()
}

/// One sector's line in `index.json`.
#[derive(Serialize)]
pub struct SectorEntry {
    pub index: u32,
    pub houses: usize,
    pub berths: usize,
    pub trees: usize,
    pub bytes: usize,
}

/// The seed both exporters give berths and trees.
pub const FEATURE_SEED: u32 = 0xd0c4;

/// `index.json`: the grid, the city-wide roof palette and each sector's counts.
#[derive(Serialize)]
pub struct SectorIndex {
    pub format: &'static str,
    pub grid: SectorGrid,
    pub roof_centres: Vec<[u8; 3]>,
    pub sectors: Vec<SectorEntry>,
}

impl SectorEntry {
    fn of(sector: &Sector, bytes: &[u8]) -> Self {
        SectorEntry {
            index: sector.index,
            houses: sector.houses.len(),
            berths: sector.berths.len(),
            trees: sector.trees.len(),
            bytes: bytes.len(),
        }
    }
}

/// A sector's payload with its index.
pub struct Payload {
    pub index: u32,
    pub bytes: Vec<u8>,
}

/// Every sector's payload, and the index describing them.
pub fn export(
    grid: SectorGrid,
    houses: &[LayerHouse],
    features: &Features,
) -> (Vec<Payload>, SectorIndex) {
    let mut entries = Vec::new();
    let payloads: Vec<Payload> = partition(&grid, houses, features)
        .iter()
        .map(|sector| {
            let bytes = write_sector(sector);
            entries.push(SectorEntry::of(sector, &bytes));
            Payload {
                index: sector.index,
                bytes,
            }
        })
        .collect();
    let roofs: Vec<[u8; 3]> = houses.iter().map(|house| house.roof_rgb).collect();
    let palette = roof_centres(&roofs);
    let index = SectorIndex {
        format: FORMAT,
        grid,
        roof_centres: palette,
        sectors: entries,
    };
    (payloads, index)
}

/// `index.json` as written: two-space indent and a final newline, as `JSON.stringify(index,
/// null, 2)` writes it.
pub fn index_json(index: &SectorIndex) -> String {
    let json = serde_json::to_string_pretty(index).expect("the index serialises");
    format!("{json}\n")
}
