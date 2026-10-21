#!/usr/bin/env python3
"""Reproducible Desire quality gate: fails on the floor and warns below target.

Measures the km scope (rs/ts/js), the extracted Svelte scripts, the Python
tools and the HTML/CSS/Svelte sources. It does not declare full approval: the
pending manual review is always printed. Usage: python3 tools/quality/gate.py
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

# Run as a script (`python3 tools/quality/gate.py`): Python puts this directory on sys.path,
# so the `quality` package imports without any path manipulation.
from quality import config, evaluate, km, sources
from quality.evaluate import Finding

EXIT_OK = 0
EXIT_FLOOR = 2


@dataclass
class Report:
    """Everything the final gate report needs."""

    findings: list[Finding] = field(default_factory=list)
    suppressed: list[Finding] = field(default_factory=list)
    false_positives: list = field(default_factory=list)
    score: dict = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".", help="project root to measure")
    parser.add_argument("--no-km", action="store_true", help="skip km metrics")
    parser.add_argument("--json", help="path to dump findings as JSON")
    return parser.parse_args(argv)


def _limits(max_lines: int, max_params: int) -> list[str]:
    return ["--max-lines", str(max_lines), "--max-params", str(max_params)]


def _run(root: Path, scope: km.Scope, request: km.Request):
    result = km.run(root, scope.query(request.command, *request.extra))
    if scope.alias:
        km.rewrite_paths(result, scope.alias)
    return result


def measure_smells(root: Path, scope: km.Scope) -> list[Finding]:
    floor_limits = _limits(config.MAX_FUNCTION_LINES_FLOOR, config.MAX_PARAMS_FLOOR)
    target_limits = _limits(config.MAX_FUNCTION_LINES_TARGET, config.MAX_PARAMS_TARGET)
    floor = _run(root, scope, km.Request("smells", tuple(floor_limits)))
    target = _run(root, scope, km.Request("smells", tuple(target_limits)))
    findings = evaluate.evaluate_smells(floor, target)
    if scope.informative:
        findings += evaluate.informative_smells(floor)
    return findings


def measure_complexity(root: Path, scope: km.Scope) -> list[Finding]:
    cycom = _run(root, scope, km.Request("cycom", ("--per-function",)))
    cogcom = _run(root, scope, km.Request("cogcom", ("--per-function",)))
    return evaluate.evaluate_complexity(cycom, cogcom)


def measure_scope(root: Path, scope: km.Scope) -> list[Finding]:
    return measure_smells(root, scope) + measure_complexity(root, scope)


def measure_product(root: Path, notes: list[str]) -> tuple[list[Finding], dict]:
    scope = km.Scope(".", config.EXCLUDED_DIRS, config.PRODUCT_EXTS)
    score = km.run(root, scope.query("score"))
    extra_dups = ("--min-lines", "6", "--report", "--show-all")
    dups = km.run(root, scope.query("dups", *extra_dups))
    findings: list[Finding] = []
    if score.get("files_analyzed", 0) == 0:
        notes.append("km scope has no rs/ts/js files: score not evaluated (avoids a false floor).")
    else:
        findings += evaluate.evaluate_score(score["score"], score["grade"])
    findings += measure_scope(root, scope) + evaluate.evaluate_duplication(dups)
    return findings, score


def measure_tools(root: Path) -> list[Finding]:
    # The thresholds in config.py are named constants, not domain magic numbers;
    # that is why the tooling reports no informatives, only blocks and warnings.
    scope = km.Scope("tools/quality", ("tests", "__pycache__"), ("py",), informative=False)
    return measure_scope(root, scope)


def measure_svelte(root: Path, notes: list[str]) -> list[Finding]:
    path = root / config.SVELTE
    if not path.exists():
        notes.append(f"{config.SVELTE} missing: no Svelte script coverage.")
        return []
    with tempfile.TemporaryDirectory() as tmp:
        dest = Path(tmp) / "App.script.ts"
        dest.write_text(sources.extract_scripts(path.read_text(encoding="utf-8")))
        scope = km.Scope(".", (), ("ts",), alias={"App.script.ts": config.SVELTE})
        return measure_scope(Path(tmp), scope)


def measure_km(root: Path, notes: list[str]) -> tuple[list[Finding], dict]:
    if not km.has_km():
        detail = "km missing: score, smells, complexity and duplication were not measured"
        return [Finding("Environment", evaluate.BLOCKS, "km", detail, "tooling")], {}
    product, score = measure_product(root, notes)
    return product + measure_tools(root) + measure_svelte(root, notes), score


def collect(root: Path, no_km: bool, notes: list[str]) -> tuple[list[Finding], dict]:
    sources_found = sources.discover_sources(root)
    findings = evaluate.evaluate_size(sources_found)
    findings += evaluate.evaluate_f16(sources_found) + evaluate.evaluate_f11(sources_found)
    if no_km:
        notes.append("--no-km mode: no score, smells or complexity metrics.")
        return findings, {}
    from_km, score = measure_km(root, notes)
    return findings + from_km, score


def describe(finding: Finding) -> str:
    return f"  [{finding.rule}] {finding.location} · {finding.detail}"


def print_section(title: str, findings: list[Finding]) -> None:
    print(f"\n{title} ({len(findings)})")
    if not findings:
        print("  — no findings")
        return
    for finding in findings:
        print(describe(finding))


def print_score(score: dict) -> None:
    if not score:
        print("km score: not measured")
        return
    print(f"km score (rs/ts/js): {score['score']:.2f} / {score['grade']}")
    print(f"  {score['files_analyzed']} files · {score['total_loc']} LOC")
    print(f"  floor {config.SCORE_FLOOR} · target {config.SCORE_TARGET}")


def print_false_positives(false_positives: list, active: int) -> None:
    print(f"\nDocumented false positives ({len(false_positives)}; {active} active now)")
    for false_positive in false_positives:
        print(f"  - {false_positive.describe()}")


def print_manual_review() -> None:
    print("\nPending manual review (does not block the gate; blocks integral approval)")
    for rule, detail in config.MANUAL_REVIEW:
        print(f"  - {rule}: {detail}")


def print_coverage() -> None:
    print("\nGate coverage and limits")
    for name, detail in config.COVERAGE:
        print(f"  - {name}: {detail}")


def print_notes(notes: list[str]) -> None:
    if not notes:
        return
    print("\nMeasurement notes")
    for note in notes:
        print(f"  - {note}")


def print_report(report: Report) -> int:
    blocks = evaluate.only_blocks(report.findings)
    warnings = [f for f in report.findings if f.severity == evaluate.WARNS]
    informative = [f for f in report.findings if f.severity == evaluate.INFO]
    print("== Desire quality gate ==")
    print_score(report.score)
    print_section("Floor blocks", blocks)
    print_section("Below-target warnings", warnings)
    print_section("Informational for review", informative)
    print_false_positives(report.false_positives, len(report.suppressed))
    print_manual_review()
    print_coverage()
    print_notes(report.notes)
    print("\nGate verdict:", "FAILED" if blocks else "OK (partial)")
    print("Integral approval: NO — manual review pending and coverage is not universal.")
    return len(blocks)


def dump_json(dest: Path, accepted: list[Finding], suppressed: list[Finding]) -> None:
    data = {
        "findings": [vars(finding) for finding in accepted],
        "suppressed_false_positives": [vars(finding) for finding in suppressed],
    }
    dest.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    root = Path(args.root).resolve()
    notes: list[str] = []
    false_positives = config.load_false_positives(
        Path(__file__).with_name("known-false-positives.json")
    )
    findings, score = collect(root, args.no_km, notes)
    accepted, suppressed = evaluate.apply_false_positives(findings, false_positives)
    report = Report(accepted, suppressed, false_positives, score, notes)
    blocks = print_report(report)
    if args.json:
        dump_json(Path(args.json), accepted, suppressed)
    return EXIT_FLOOR if blocks else EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
