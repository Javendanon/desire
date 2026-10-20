#!/usr/bin/env node
// Contract: renders data/waterdeep-reference.json as an SVG overlay on the source map.
// The raster is referenced by URL and is not redistributed with this repository.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(HERE, "data", "waterdeep-reference.json");
const DEFAULT_OUT = join(HERE, "overlay.svg");

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function marker(point, index) {
  const { x, y } = point.pixel;
  const labelY = y - 18;
  return [
    `<g class="control" data-id="${escapeXml(point.id)}">`,
    `<circle cx="${x}" cy="${y}" r="22" />`,
    `<line x1="${x - 36}" y1="${y}" x2="${x + 36}" y2="${y}" />`,
    `<line x1="${x}" y1="${y - 36}" x2="${x}" y2="${y + 36}" />`,
    `<text x="${x + 30}" y="${labelY}">${index + 1}. ${escapeXml(point.name)}</text>`,
    `</g>`,
  ].join("");
}

function wardBox(ward) {
  const box = ward.bbox_pixel;
  const width = box.max_x - box.min_x;
  const height = box.max_y - box.min_y;
  return [
    `<rect class="ward" x="${box.min_x}" y="${box.min_y}"`,
    ` width="${width}" height="${height}" />`,
  ].join("");
}

function styles() {
  return [
    ".ward { fill: none; stroke: #1d4ed8; stroke-width: 6;",
    " stroke-dasharray: 24 18; opacity: .75; }",
    ".control circle { fill: none; stroke: #dc2626; stroke-width: 6; }",
    ".control line { stroke: #dc2626; stroke-width: 4; }",
    ".control text { font: 700 42px sans-serif; fill: #fff;",
    " stroke: #7f1d1d; stroke-width: 10; paint-order: stroke; }",
    ".credit { font: 700 44px sans-serif; fill: #fff;",
    " stroke: #111827; stroke-width: 12; paint-order: stroke; }",
  ].join("\n    ");
}

function render(data) {
  const { width, height } = data.image;
  const controls = data.control_points.map(marker).join("\n");
  const wards = data.wards.map(wardBox).join("\n");
  const source = escapeXml(data.source_snapshot.image.url);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <title>Waterdeep calibration control points</title>
  <desc>Generated from data/waterdeep-reference.json.
    Map artwork by Jason Engle; hosted by AideDD.</desc>
  <style>
    ${styles()}
  </style>
  <image x="0" y="0" width="${width}" height="${height}"
    href="${source}" xlink:href="${source}" />
  ${wards}
  ${controls}
  <text class="credit" x="40" y="${height - 90}">
    Map artwork: Jason Engle via AideDD.</text>
  <text class="credit" x="40" y="${height - 40}">
    Overlay: Desire D05 calibration; not for redistribution.</text>
</svg>
`;
}

function outputPath() {
  const index = process.argv.indexOf("--out");
  if (index < 0) return DEFAULT_OUT;
  const path = process.argv[index + 1];
  if (!path || path.startsWith("--")) {
    console.error("--out needs a path");
    process.exit(2);
  }
  return resolve(path);
}

const outPath = outputPath();
const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));
writeFileSync(outPath, render(data));
console.log(`Wrote ${outPath}`);
