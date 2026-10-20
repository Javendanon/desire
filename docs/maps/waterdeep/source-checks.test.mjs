// Contract: the dataset parser and the source comparison catch drift between the reference
// package and the source. The dataset below is synthetic: it mimics dataW.js's layout with
// invented names, so no AideDD content is copied into the repository.

import assert from "node:assert/strict";
import test from "node:test";

import { checkAgainstDataset } from "./source-checks.mjs";
import { parseDataset } from "./source-dataset.mjs";

const DATASET = `var imageW = 100, imageH = 200;
var carte = "T", factorDist = 31;
var zones = [
  { name1: "Low Ward", path: "M 10,10 30,10 30,50 10,50 Z" },
];
var groupe = [
{ name1:"GROUP", color:"#000", x:0, y:0, txt1:"Buildings"},
{ name1:"Old Tower", color:"#000", x:20, y:30, txt1:"<p>x</p>", ref:"L1"},
{ name1:"Old Tower", color:"#000", x:22, y:31, txt1:"<p>x</p>"},
{ name1:"Gate", color:"#000", x:5, y:190, txt1:"<p>x</p>"},
];
/* { name1:"Hidden", color:"#000", x:0, y:0, txt1:"<p>x</p>"},
Q7 { name1:"Hidden too", color:"#000", x:0, y:0, txt1:"<p>x</p>"},
*/`;

function reference() {
  return {
    image: { width: 100, height: 200 },
    scale: { pixels_per_1000_feet: 31 },
    source_snapshot: {
      derived: {
        active_marker_entries: 3,
        group_legend_entries: 1,
        commented_out_rows: 2,
        raw_marker_rows_including_comments: 6,
        duplicate_names: 1,
        duplicate_coordinates: 0,
        zone_polygons: 1,
      },
    },
    wards: [
      {
        name: "Low Ward",
        bbox_pixel: { min_x: 10, min_y: 10, max_x: 30, max_y: 50 },
        centroid_pixel: { x: 20, y: 30 },
      },
    ],
    control_points: [
      {
        id: "tower",
        name: "Old Tower",
        pixel: { x: 20, y: 30 },
        source_ref: "L1",
        provenance: ["aidedd-dataW-marker"],
      },
      {
        id: "ward",
        name: "Low Ward",
        pixel: { x: 20, y: 30 },
        source_ref: null,
        provenance: ["aidedd-zone-centroid"],
      },
    ],
    initial_places: [],
    main_streets: [],
  };
}

function failuresOf(data) {
  const failures = [];
  const check = (label, ok) => {
    if (!ok) failures.push(label);
  };
  checkAgainstDataset(data, parseDataset(DATASET), check);
  return failures;
}

test("a package that matches its source passes", () => {
  assert.deepEqual(failuresOf(reference()), []);
});

test("commented rows count with any prefix, groups and duplicates are separate", () => {
  const dataset = parseDataset(DATASET);
  assert.equal(dataset.commented, 2);
  assert.equal(dataset.groups, 1);
  assert.deepEqual(dataset.duplicateNames, ["Old Tower"]);
  assert.deepEqual(dataset.zones[0].centroid, { x: 20, y: 30 });
});

test("a point moved off its marker is caught", () => {
  const data = reference();
  data.control_points[0].pixel = { x: 21, y: 30 };
  assert.deepEqual(failuresOf(data), ["dataset point tower marker at pixel"]);
});

test("a wrong ref or a renamed point is caught", () => {
  const data = reference();
  data.control_points[0].source_ref = "L2";
  data.control_points[0].name = "New Tower";
  assert.deepEqual(failuresOf(data), ["dataset point tower name", "dataset point tower ref"]);
});

test("a stale count or ward box is caught", () => {
  const data = reference();
  data.source_snapshot.derived.active_marker_entries = 4;
  data.wards[0].bbox_pixel.max_x = 31;
  assert.deepEqual(failuresOf(data), [
    "dataset active_marker_entries",
    "dataset ward Low Ward bbox",
  ]);
});

test("a missing section is an explicit error, not a silent pass", () => {
  assert.throws(() => parseDataset("var imageW = 1;"), /var groupe/);
});
