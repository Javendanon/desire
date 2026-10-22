//! Lot placement against `fixtures/lots-golden.json`, written by `tools/assets/parity.ts` from
//! the TypeScript `placeHouses` on three synthetic blocks.

use desire_atlas::lots::{BlockShape, House, LotRules, Plan, place_houses};
use serde::Deserialize;

#[derive(Deserialize)]
struct Open {
    x_m: f64,
    z_m: f64,
    radius_m: f64,
}

#[derive(Deserialize)]
struct Rules {
    frontage: [f64; 2],
    depth: [f64; 2],
}

#[derive(Deserialize)]
struct Case {
    seed: u32,
    outer: Vec<Plan>,
    holes: Vec<Vec<Plan>>,
    houses: Vec<House>,
}

#[derive(Deserialize)]
struct Golden {
    rules: Rules,
    open: Open,
    blocks: Vec<Case>,
}

#[test]
fn lots_are_placed_as_in_typescript() {
    let golden: Golden =
        serde_json::from_str(include_str!("fixtures/lots-golden.json")).expect("golden");
    let open = golden.open;
    let is_built = move |point: Plan| {
        desire_atlas::js::hypot(&[point.x_m - open.x_m, point.z_m - open.z_m]) >= open.radius_m
    };
    for case in golden.blocks {
        let rules = LotRules {
            frontage: golden.rules.frontage,
            depth: golden.rules.depth,
            seed: case.seed,
            is_built: &is_built,
        };
        let block = BlockShape {
            outer: case.outer,
            holes: case.holes,
        };
        let lots = place_houses(&block, &rules);
        let houses: Vec<House> = lots.into_iter().map(|lot| lot.house).collect();
        assert_eq!(houses, case.houses, "seed {}", case.seed);
    }
}
