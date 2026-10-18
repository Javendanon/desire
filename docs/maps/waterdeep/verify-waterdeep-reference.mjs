#!/usr/bin/env node
// Contract: validates data/waterdeep-reference.json and, with --image, the source JPEG.
// Zero runtime dependencies. Exits non-zero when any assertion fails.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(HERE, "data", "waterdeep-reference.json");
const FEET_TO_METERS = 0.3048;
const NEAR = 0.01;
const EXPECTED = {
  width: 3560,
  height: 7256,
  pixelsPer1000Feet: 310,
  activeMarkers: 768,
  groupLegendEntries: 9,
  commentedRows: 25,
  rawMarkerRows: 802,
  duplicateNames: 2,
  duplicateCoordinates: 2,
  wards: 8,
  minControlPoints: 8,
  minPlaces: 5,
  maxPlaces: 20,
};

const failures = [];
const check = (label, ok, detail = "") => {
  if (!ok) failures.push(detail ? `${label}: ${detail}` : label);
};
const checkEqual = (label, actual, expected) => check(label, actual === expected, String(actual));
const nearly = (a, b) => Math.abs(a - b) <= NEAR;
const within = (point, width, height) =>
  point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height;
const insideBox = (point, box) =>
  point.x >= box.min_x && point.x <= box.max_x && point.y >= box.min_y && point.y <= box.max_y;

function checkWorld(label, pixel, world, metersPerPixel) {
  check(`${label} world_m.x`, nearly(world.x, pixel.x * metersPerPixel));
  check(`${label} world_m.y`, nearly(world.y, pixel.y * metersPerPixel));
}

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`Cannot read ${path}: ${error.message}`);
    process.exit(2);
  }
}

function verifyScale(data) {
  const scale = data.scale;
  checkEqual("scale.pixels_per_1000_feet", scale.pixels_per_1000_feet, EXPECTED.pixelsPer1000Feet);
  const metersPerPixel = (1000 * FEET_TO_METERS) / scale.pixels_per_1000_feet;
  check("scale.meters_per_pixel", nearly(scale.meters_per_pixel, metersPerPixel));
}

function verifyControlPoints(data) {
  const { width, height } = data.image;
  const metersPerPixel = data.scale.meters_per_pixel;
  const points = data.control_points ?? [];
  const enough = points.length >= EXPECTED.minControlPoints;
  check("control_points.minimum", enough, String(points.length));
  const ids = new Set();
  for (const point of points) {
    check(`control_point ${point.id} duplicate id`, !ids.has(point.id));
    ids.add(point.id);
    const text = JSON.stringify(point.pixel);
    check(`control_point ${point.id} in bounds`, within(point.pixel, width, height), text);
    checkWorld(`control_point ${point.id}`, point.pixel, point.world_m, metersPerPixel);
  }
}

function verifyWards(data) {
  const { width, height } = data.image;
  const wards = data.wards ?? [];
  checkEqual("wards.count", wards.length, EXPECTED.wards);
  for (const ward of wards) {
    const box = ward.bbox_pixel;
    check(`ward ${ward.name} centroid in bbox`, insideBox(ward.centroid_pixel, box));
    const fits = box.min_x >= 0 && box.max_x <= width && box.min_y >= 0 && box.max_y <= height;
    check(`ward ${ward.name} bbox in image`, fits);
  }
}

function verifyWardMembership(place, boxes) {
  if (place.ward === null) return;
  const box = boxes[place.ward];
  check(`place ${place.id} known ward`, Boolean(box), String(place.ward));
  const fits = Boolean(box && insideBox(place.pixel, box));
  check(`place ${place.id} inside ward box`, fits, String(place.ward));
}

function verifyPlaces(data) {
  const { width, height } = data.image;
  const metersPerPixel = data.scale.meters_per_pixel;
  const boxes = Object.fromEntries((data.wards ?? []).map((ward) => [ward.name, ward.bbox_pixel]));
  const places = data.initial_places ?? [];
  const sizeOk = places.length >= EXPECTED.minPlaces && places.length <= EXPECTED.maxPlaces;
  check("initial_places.range", sizeOk, String(places.length));
  for (const place of places) {
    const provenance = Array.isArray(place.provenance) && place.provenance.length > 0;
    check(`place ${place.id} provenance`, provenance);
    const text = JSON.stringify(place.pixel);
    check(`place ${place.id} in bounds`, within(place.pixel, width, height), text);
    checkWorld(`place ${place.id}`, place.pixel, place.world_m, metersPerPixel);
    verifyWardMembership(place, boxes);
  }
}

function verifyStreets(data) {
  const { width, height } = data.image;
  const metersPerPixel = data.scale.meters_per_pixel;
  for (const street of data.main_streets ?? []) {
    const text = JSON.stringify(street.pixel);
    check(`street ${street.name} in bounds`, within(street.pixel, width, height), text);
    checkWorld(`street ${street.name}`, street.pixel, street.world_m, metersPerPixel);
  }
}

function verifySnapshot(data) {
  const derived = data.source_snapshot?.derived ?? {};
  checkEqual(
    "snapshot.active_marker_entries",
    derived.active_marker_entries,
    EXPECTED.activeMarkers,
  );
  checkEqual("snapshot.duplicate_names", derived.duplicate_names, EXPECTED.duplicateNames);
  checkEqual(
    "snapshot.duplicate_coordinates",
    derived.duplicate_coordinates,
    EXPECTED.duplicateCoordinates,
  );
  checkEqual(
    "snapshot.group_legend_entries",
    derived.group_legend_entries,
    EXPECTED.groupLegendEntries,
  );
  checkEqual("snapshot.commented_out_rows", derived.commented_out_rows, EXPECTED.commentedRows);
  checkEqual(
    "snapshot.raw_marker_rows_including_comments",
    derived.raw_marker_rows_including_comments,
    EXPECTED.rawMarkerRows,
  );
  const artwork = String(data.attribution?.map_artwork ?? "");
  check("attribution.map_artwork", artwork.includes("Jason Engle"));
}

function verifyImageFile(path, data) {
  const buffer = readFileSync(path);
  const expected = data.source_snapshot.image;
  check("image.bytes", buffer.length === expected.bytes, `${buffer.length} != ${expected.bytes}`);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  check("image.sha256", sha256 === expected.sha256, sha256);
}

function verifyImageArgument(data) {
  const imageIndex = process.argv.indexOf("--image");
  if (imageIndex < 0) return;
  const imagePath = process.argv[imageIndex + 1];
  if (imagePath) {
    verifyImageFile(imagePath, data);
  } else {
    check("image argument", false, "--image needs a path");
  }
}

function main() {
  const data = loadJson(DATA_PATH);
  checkEqual("schema", data.schema, "desire.waterdeep.reference/1");
  checkEqual("image.width", data.image?.width, EXPECTED.width);
  checkEqual("image.height", data.image?.height, EXPECTED.height);
  verifyScale(data);
  verifyControlPoints(data);
  verifyWards(data);
  verifyPlaces(data);
  verifyStreets(data);
  verifySnapshot(data);
  verifyImageArgument(data);
  if (failures.length > 0) {
    console.error(`FAIL (${failures.length})`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  const places = data.initial_places.length;
  const points = data.control_points.length;
  console.log(`PASS: ${points} control points, ${data.wards.length} wards, ${places} places`);
}

main();
