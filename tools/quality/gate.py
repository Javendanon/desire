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

sys.path.insert(0, str(Path(__file__).resolve().parent))

from quality import config, evaluate, km, sources  # noqa: E402
from quality.evaluate import Finding  # noqa: E402

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
    parser.add_argument("--root", default=".", help="raíz del proyecto a medir")
    parser.add_argument("--no-km", action="store_true", help="omitir métricas de km")
    parser.add_argument("--json", help="ruta para volcar hallazgos en JSON")
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
        notes.append("Alcance km sin archivos rs/ts/js: score no evaluado (evita falso piso).")
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
        notes.append(f"{config.SVELTE} ausente: sin cobertura de script Svelte.")
        return []
    with tempfile.TemporaryDirectory() as tmp:
        dest = Path(tmp) / "App.script.ts"
        dest.write_text(sources.extract_scripts(path.read_text(encoding="utf-8")))
        scope = km.Scope(".", (), ("ts",), alias={"App.script.ts": config.SVELTE})
        return measure_scope(Path(tmp), scope)


def measure_km(root: Path, notes: list[str]) -> tuple[list[Finding], dict]:
    if not km.has_km():
        detail = "km ausente: no se midieron score, olores, complejidad ni duplicación"
        return [Finding("Entorno", evaluate.BLOCKS, "km", detail, "tooling")], {}
    product, score = measure_product(root, notes)
    return product + measure_tools(root) + measure_svelte(root, notes), score


def collect(root: Path, no_km: bool, notes: list[str]) -> tuple[list[Finding], dict]:
    sources_found = sources.discover_sources(root)
    findings = evaluate.evaluate_size(sources_found)
    findings += evaluate.evaluate_f16(sources_found) + evaluate.evaluate_f11(sources_found)
    if no_km:
        notes.append("Modo --no-km: sin métricas de score, olores ni complejidad.")
        return findings, {}
    from_km, score = measure_km(root, notes)
    return findings + from_km, score


def describe(finding: Finding) -> str:
    return f"  [{finding.rule}] {finding.location} · {finding.detail}"


def print_section(title: str, findings: list[Finding]) -> None:
    print(f"\n{title} ({len(findings)})")
    if not findings:
        print("  — sin hallazgos")
        return
    for finding in findings:
        print(describe(finding))


def print_score(score: dict) -> None:
    if not score:
        print("Score km: no medido")
        return
    print(f"Score km (rs/ts/js): {score['score']:.2f} / {score['grade']}")
    print(f"  {score['files_analyzed']} archivos · {score['total_loc']} LOC")
    print(f"  piso {config.SCORE_FLOOR} · objetivo {config.SCORE_TARGET}")


def print_false_positives(false_positives: list, active: int) -> None:
    print(f"\nFalsos positivos documentados ({len(false_positives)}; {active} activos ahora)")
    for false_positive in false_positives:
        print(f"  - {false_positive.describe()}")


def print_manual_review() -> None:
    print("\nRevisión manual pendiente (no bloquea el gate; impide aprobación integral)")
    for rule, detail in config.MANUAL_REVIEW:
        print(f"  - {rule}: {detail}")


def print_coverage() -> None:
    print("\nCobertura y límites del gate")
    for name, detail in config.COVERAGE:
        print(f"  - {name}: {detail}")


def print_notes(notes: list[str]) -> None:
    if not notes:
        return
    print("\nNotas de medición")
    for note in notes:
        print(f"  - {note}")


def print_report(report: Report) -> int:
    blocks = evaluate.only_blocks(report.findings)
    warnings = [f for f in report.findings if f.severity == evaluate.WARNS]
    informative = [f for f in report.findings if f.severity == evaluate.INFO]
    print("== Gate de calidad Desire ==")
    print_score(report.score)
    print_section("Bloqueos de piso", blocks)
    print_section("Avisos bajo objetivo", warnings)
    print_section("Informativos para revisión", informative)
    print_false_positives(report.false_positives, len(report.suppressed))
    print_manual_review()
    print_coverage()
    print_notes(report.notes)
    print("\nVeredicto del gate:", "FALLIDO" if blocks else "OK (parcial)")
    print("Aprobación integral: NO — revisión manual pendiente y cobertura no universal.")
    return len(blocks)


def dump_json(dest: Path, accepted: list[Finding], suppressed: list[Finding]) -> None:
    data = {
        "hallazgos": [vars(finding) for finding in accepted],
        "falsos_positivos_suprimidos": [vars(finding) for finding in suppressed],
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
