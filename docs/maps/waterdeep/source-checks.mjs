// Contract: compares the reference package with a parsed AideDD dataset (source-dataset.mjs).
// Every count, ward box and named point the package records must be recomputable from it.

const sameBox = (a, b) =>
  a.min_x === b.min_x && a.min_y === b.min_y && a.max_x === b.max_x && a.max_y === b.max_y;

function checkFrame(data, dataset, check) {
  check("dataset.imageW", dataset.width === data.image.width, String(dataset.width));
  check("dataset.imageH", dataset.height === data.image.height, String(dataset.height));
  const scale = data.scale.pixels_per_1000_feet;
  const factor = dataset.pixelsPer1000Feet;
  check("dataset.factorDist", factor === scale, String(factor));
}

function checkCounts(data, dataset, check) {
  const derived = data.source_snapshot.derived;
  const pairs = [
    ["active_marker_entries", dataset.active.length],
    ["group_legend_entries", dataset.groups],
    ["commented_out_rows", dataset.commented],
    ["raw_marker_rows_including_comments", dataset.rows + dataset.commented],
    ["duplicate_names", dataset.duplicateNames.length],
    ["duplicate_coordinates", dataset.duplicateCoordinates.length],
    ["zone_polygons", dataset.zones.length],
  ];
  for (const [key, actual] of pairs) {
    const detail = `${derived[key]} recorded, ${actual} in source`;
    check(`dataset ${key}`, derived[key] === actual, detail);
  }
}

function checkWards(data, dataset, check) {
  for (const ward of data.wards) {
    const zone = dataset.zones.find((candidate) => candidate.name === ward.name);
    check(`dataset ward ${ward.name} exists`, Boolean(zone));
    if (!zone) continue;
    check(`dataset ward ${ward.name} bbox`, sameBox(zone.bbox, ward.bbox_pixel));
    const { x, y } = ward.centroid_pixel;
    const centroidOk = zone.centroid.x === x && zone.centroid.y === y;
    check(`dataset ward ${ward.name} centroid`, centroidOk, JSON.stringify(zone.centroid));
  }
}

/** A named point must sit on a marker with its name (or recorded source_name) and ref. */
function checkMarker(point, dataset, check) {
  const label = `dataset point ${point.id}`;
  const { x, y } = point.pixel;
  const marker = dataset.active.find((row) => row.x === x && row.y === y);
  check(`${label} marker at pixel`, Boolean(marker), `${x},${y}`);
  if (!marker) return;
  const expectedName = point.source_name ?? point.name;
  check(`${label} name`, marker.name === expectedName, marker.name);
  if (point.source_ref !== null) {
    check(`${label} ref`, marker.ref === point.source_ref, String(marker.ref));
  }
}

function checkCentroidPoint(point, data, check) {
  const ward = data.wards.find(
    (candidate) =>
      candidate.centroid_pixel.x === point.pixel.x && candidate.centroid_pixel.y === point.pixel.y,
  );
  check(`dataset point ${point.id} is a ward centroid`, Boolean(ward));
}

export function checkAgainstDataset(data, dataset, check) {
  checkFrame(data, dataset, check);
  checkCounts(data, dataset, check);
  checkWards(data, dataset, check);
  const points = [...data.control_points, ...data.initial_places, ...data.main_streets];
  for (const point of points) {
    if (point.provenance.includes("aidedd-zone-centroid")) checkCentroidPoint(point, data, check);
    else checkMarker(point, dataset, check);
  }
}
