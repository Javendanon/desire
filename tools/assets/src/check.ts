/** Acceptance report: scale, fidelity, the written package and navigation over its cost grid. */
import { evaluateScaleChecks } from './calibration.ts';
import { walkCostGrid } from './nav.ts';
import { finding, packageFindings, type WrittenPackage } from './package-check.ts';
import type { Scene } from './scene.ts';
import type { Finding, Manifest } from './types.ts';

export type PackageArtifact = {
  path: string;
  bytes: number;
  files: number;
  written: boolean;
  stale_path?: string;
};
type ReportSpec = {
  manifest: Manifest;
  scene: Scene;
  written: WrittenPackage;
  artifact: Omit<PackageArtifact, 'written'>;
};
export type BuildReport = ReturnType<typeof buildReport>;

function fidelityFinding(scene: Scene, placeCount: number): Finding {
  const counted = Object.values(scene.fidelity).reduce((sum, value) => sum + value, 0);
  const tally = scene.fidelity;
  return finding('fidelity.tally', counted === placeCount,
    `verified ${tally.verified}, interpretation ${tally.interpretation}, `
    + `synthetic ${tally.synthetic}, unknown ${tally.unknown}`);
}

function navigationOf(spec: ReportSpec) {
  return walkCostGrid({
    dims: spec.written.map.nav,
    costs: spec.written.costs,
    spawn: spec.scene.spawn,
    waypoints: spec.scene.waypoints,
  });
}

function packageSummary(written: WrittenPackage) {
  return {
    sectors: written.sectors.length,
    chunks: written.map.chunks.length,
    buildings: written.sectors.reduce((sum, sector) => sum + sector.buildings.length, 0),
    grid: written.map.grid,
  };
}

/** Builds the acceptance report. `pass` is true only when every check passes. */
export function buildReport(spec: ReportSpec) {
  const { manifest, scene, written } = spec;
  const scaleChecks = evaluateScaleChecks(manifest.calibration, manifest.scale_checks);
  const navigation = navigationOf(spec);
  const checks = [
    finding('scale.checks', scaleChecks.length > 0 && scaleChecks.every((entry) => entry.pass),
      `${scaleChecks.length} reference distances`),
    fidelityFinding(scene, manifest.places.length),
    ...packageFindings(written, scene),
    finding('navigation.waypoints', navigation.pass,
      `${navigation.reachable_cells}/${navigation.total_cells} reached`),
  ];
  return {
    id: scene.id,
    label: scene.label,
    pass: checks.every((entry) => entry.pass),
    checks,
    scale: {
      meters_per_pixel: manifest.calibration.meters_per_pixel,
      evidence: manifest.calibration.provenance.evidence,
      checks: scaleChecks,
    },
    fidelity: scene.fidelity,
    unknown_places: scene.unknown.map((place) => place.id),
    package: packageSummary(written),
    navigation,
    artifact: { ...spec.artifact, written: false } as PackageArtifact,
    provenance: manifest.illustration.provenance,
    network_allowed: false,
  };
}
