// Contract: reads AideDD's dataW.js as text (never evaluates it) and recomputes what the
// reference package claims about it: frame, scale, marker counts, duplicates, ward boxes and
// the markers behind each named point. One row per line is the source's own layout, and
// commented-out rows keep it with a prefix such as `/* ` or a ref code.

const MARKER_LINE = /\{\s*name1:"/;

function field(line, pattern) {
  const match = line.match(pattern);
  return match ? match[1] : null;
}

function parseMarker(line) {
  return {
    name: field(line, /name1:"([^"]*)"/),
    x: Number(field(line, /\bx:\s*(-?\d+)/)),
    y: Number(field(line, /\by:\s*(-?\d+)/)),
    ref: field(line, /\bref:"([^"]*)"/),
  };
}

function markerLines(text) {
  return text
    .split("\n")
    .filter((line) => MARKER_LINE.test(line))
    .map(parseMarker);
}

function section(text, startToken, endToken) {
  const start = text.indexOf(startToken);
  if (start < 0) throw new Error(`dataset: "${startToken}" not found`);
  const end = text.indexOf(endToken, start);
  if (end < 0) throw new Error(`dataset: no "${endToken}" after "${startToken}"`);
  return { body: text.slice(start, end), rest: text.slice(end) };
}

/** Bounding box and vertex mean of every pair of numbers in an SVG path. */
function zoneGeometry(path) {
  const points = [...path.matchAll(/(-?\d+),(-?\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const mean = (values) => Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return {
    bbox: {
      min_x: Math.min(...xs),
      min_y: Math.min(...ys),
      max_x: Math.max(...xs),
      max_y: Math.max(...ys),
    },
    centroid: { x: mean(xs), y: mean(ys) },
  };
}

function parseZones(text) {
  const { body } = section(text, "var zones", "var groupe");
  const zones = [...body.matchAll(/name1:\s*"([^"]+)"[\s\S]*?path:\s*"([^"]+)"/g)];
  return zones.map(([, name, path]) => ({ name, ...zoneGeometry(path) }));
}

function duplicates(values) {
  const seen = new Map();
  for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1);
  return [...seen].filter(([, count]) => count > 1).map(([value]) => value);
}

function number(text, pattern, label) {
  const value = field(text, pattern);
  if (value === null) throw new Error(`dataset: ${label} not found`);
  return Number(value);
}

export function parseDataset(text) {
  const { body, rest } = section(text, "var groupe", "];");
  const rows = markerLines(body);
  const commentStart = rest.indexOf("/*");
  const commented = commentStart < 0 ? [] : markerLines(rest.slice(commentStart));
  const active = rows.filter((row) => row.name !== "GROUP" && (row.x !== 0 || row.y !== 0));
  return {
    width: number(text, /imageW\s*=\s*(\d+)/, "imageW"),
    height: number(text, /imageH\s*=\s*(\d+)/, "imageH"),
    pixelsPer1000Feet: number(text, /factorDist\s*=\s*(\d+)/, "factorDist"),
    groups: rows.filter((row) => row.name === "GROUP").length,
    active,
    rows: rows.length,
    commented: commented.length,
    duplicateNames: duplicates(active.map((row) => row.name)),
    duplicateCoordinates: duplicates(active.map((row) => `${row.x},${row.y}`)),
    zones: parseZones(text),
  };
}
