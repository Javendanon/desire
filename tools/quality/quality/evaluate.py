"""Classify findings against the floor (blocks) and the target (warns)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from . import config
from .sources import SourceFile, is_compressed_line, long_lines, silent_errors

BLOCKS = "block"
WARNS = "warn"
INFO = "info"

Records = list[dict[str, Any]]
Record = dict[str, Any]

SMELL_RULES = {"long_function": "F1", "long_parameter_list": "F2"}
INFORMATIVE_SMELLS = {"magic_number", "todo_comment", "commented_code", "todo"}


@dataclass(frozen=True)
class Finding:
    rule: str
    severity: str
    location: str
    detail: str
    origin: str = ""


@dataclass(frozen=True)
class Threshold:
    """Floor and target of a per-function metric, with its readable label."""

    rule: str
    floor: int
    target: int
    label: str


def normalize(path: str) -> str:
    return path[2:] if path.startswith("./") else path


def evaluate_score(score: float, grade: str) -> list[Finding]:
    location = f"alcance km ({grade})"
    if score < config.SCORE_FLOOR:
        detail = f"{score:.2f} < piso {config.SCORE_FLOOR}"
        return [Finding("Score", BLOCKS, location, detail, "km-score")]
    if score < config.SCORE_TARGET:
        detail = f"{score:.2f} < objetivo {config.SCORE_TARGET}"
        return [Finding("Score", WARNS, location, detail, "km-score")]
    return []


def _smell_findings(result: Records, severity: str) -> list[Finding]:
    findings = []
    for entry in result:
        for smell in entry.get("smells", []):
            if smell["kind"] not in SMELL_RULES:
                continue
            location = f'{normalize(entry["path"])}:{smell["line"]}'
            rule = SMELL_RULES[smell["kind"]]
            findings.append(Finding(rule, severity, location, smell["detail"], "km-smells"))
    return findings


def evaluate_smells(floor_result: Records, target_result: Records) -> list[Finding]:
    blocks = _smell_findings(floor_result, BLOCKS)
    keys = {finding.location for finding in blocks}
    warnings = [f for f in _smell_findings(target_result, WARNS) if f.location not in keys]
    return blocks + warnings


def informative_smells(result: Records) -> list[Finding]:
    findings = []
    for entry in result:
        for smell in entry.get("smells", []):
            if smell["kind"] not in INFORMATIVE_SMELLS:
                continue
            location = f'{normalize(entry["path"])}:{smell["line"]}'
            findings.append(Finding("Revisión", INFO, location, smell["detail"], "km-smells"))
    return findings


def _classify(value: int, threshold: Threshold) -> str | None:
    if value > threshold.floor:
        return BLOCKS
    if value > threshold.target:
        return WARNS
    return None


def _function_location(entry: Record, function: Record) -> str:
    return f'{normalize(entry["path"])}:{function["start_line"]} {function["name"]}'


def _threshold_detail(value: int, threshold: Threshold) -> str:
    return f"{threshold.label} {value} (piso {threshold.floor}/objetivo {threshold.target})"


def evaluate_metric(result: Records, threshold: Threshold) -> list[Finding]:
    findings = []
    for entry in result:
        for function in entry.get("functions", []):
            severity = _classify(function["complexity"], threshold)
            if severity is None:
                continue
            rule = threshold.rule
            location = _function_location(entry, function)
            detail = _threshold_detail(function["complexity"], threshold)
            findings.append(Finding(rule, severity, location, detail, "km-complejidad"))
    return findings


def evaluate_complexity(cycom: Records, cogcom: Records) -> list[Finding]:
    cyclomatic = Threshold("F4", config.CYCOM_FLOOR, config.CYCOM_TARGET, "ciclomática")
    cognitive = Threshold("F5", config.COGCOM_FLOOR, config.COGCOM_TARGET, "cognitiva")
    return evaluate_metric(cycom, cyclomatic) + evaluate_metric(cogcom, cognitive)


def evaluate_duplication(dups: dict[str, Any]) -> list[Finding]:
    ratio = dups.get("metrics", {}).get("duplication_percentage", 0.0)
    findings = _duplication_ratio(ratio)
    return findings + _rule_of_three_groups(dups.get("groups", []))


def _duplication_ratio(ratio: float) -> list[Finding]:
    if ratio > config.DUP_RATIO_FLOOR:
        detail = f"{ratio:.2f}% > piso {config.DUP_RATIO_FLOOR}%"
        return [Finding("F9", BLOCKS, "alcance km", detail, "km-dups")]
    if ratio > config.DUP_RATIO_TARGET:
        detail = f"{ratio:.2f}% > objetivo {config.DUP_RATIO_TARGET}%"
        return [Finding("F9", WARNS, "alcance km", detail, "km-dups")]
    return []


def _rule_of_three_groups(groups: Records) -> list[Finding]:
    findings = []
    for group in groups:
        copies = len(group.get("locations", []))
        if copies >= config.DUP_COPIES_RULE_OF_THREE:
            location = normalize(group["locations"][0]["file_path"])
            detail = f"{copies} copias de {group['line_count']} líneas (regla de tres)"
            findings.append(Finding("F9", BLOCKS, location, detail, "km-dups"))
    return findings


def evaluate_size(sources: list[SourceFile]) -> list[Finding]:
    findings = []
    for source in sources:
        if source.code_lines > config.LOC_FILE_FLOOR:
            detail = f"{source.code_lines} LOC > piso {config.LOC_FILE_FLOOR}"
            findings.append(Finding("F6", BLOCKS, source.path, detail, "sources"))
        elif source.code_lines > config.LOC_FILE_TARGET:
            detail = f"{source.code_lines} LOC > objetivo {config.LOC_FILE_TARGET}"
            findings.append(Finding("F6", WARNS, source.path, detail, "sources"))
    return findings


def _source_finding(rule: str, location: str, detail: str) -> Finding:
    return Finding(rule, BLOCKS, location, detail, "sources")


def evaluate_f16(sources: list[SourceFile]) -> list[Finding]:
    findings = []
    for source in sources:
        findings += _f16_long_lines(source) + _f16_compressed(source)
    return findings


def _f16_long_lines(source: SourceFile) -> list[Finding]:
    findings = []
    for number, width in long_lines(source):
        detail = f"{width} columnas > {config.MAX_COLUMNS}"
        findings.append(_source_finding("F16", f"{source.path}:{number}", detail))
    return findings


def _f16_compressed(source: SourceFile) -> list[Finding]:
    findings = []
    for number, line in enumerate(source.lines, start=1):
        if is_compressed_line(line, source.path):
            detail = "varias sentencias en una línea"
            findings.append(_source_finding("F16", f"{source.path}:{number}", detail))
    return findings


def evaluate_f11(sources: list[SourceFile]) -> list[Finding]:
    return [
        _source_finding("F11", f"{source.path}:{number}", message)
        for source in sources
        for number, message in silent_errors(source)
    ]


def apply_false_positives(findings: list[Finding], false_positives: list[config.FalsePositive]):
    accepted: list[Finding] = []
    suppressed: list[Finding] = []
    for finding in findings:
        destination = suppressed if _is_false_positive(finding, false_positives) else accepted
        destination.append(finding)
    return accepted, suppressed


def _is_false_positive(finding: Finding, false_positives: list[config.FalsePositive]) -> bool:
    return any(_matches(finding, false_positive) for false_positive in false_positives)


def _matches(finding: Finding, false_positive: config.FalsePositive) -> bool:
    same_origin = false_positive.origin == finding.origin and false_positive.rule == finding.rule
    inside = finding.location.startswith(false_positive.path)
    line_ok = _line_matches(finding, false_positive)
    return same_origin and inside and line_ok and false_positive.contains in finding.detail


def _line_matches(finding: Finding, false_positive: config.FalsePositive) -> bool:
    return false_positive.line is None or finding.location.endswith(f":{false_positive.line}")


def only_blocks(findings: list[Finding]) -> list[Finding]:
    return [finding for finding in findings if finding.severity == BLOCKS]
