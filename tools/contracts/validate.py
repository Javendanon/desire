"""Valida el subconjunto explícito de JSON Schema usado por Desire, sin I/O de red."""

import json
import math
from pathlib import Path
import re
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
SUPPORTED = {'$schema', '$id', '$defs', '$ref', 'x-module', 'type', 'enum', 'const',
             'anyOf', 'properties', 'required', 'additionalProperties', 'items',
             'minimum', 'maximum', 'exclusiveMinimum', 'format'}


def fail(path: str, detail: str) -> None:
    raise ValueError(f'{path}: {detail}')


def check_shape(value: Any, node: dict, path: str) -> None:
    """Valida el tipo JSON antes de recorrer hijos o restricciones."""
    predicates = {
        'object': lambda item: isinstance(item, dict),
        'array': lambda item: isinstance(item, list),
        'string': lambda item: isinstance(item, str),
        'integer': lambda item: type(item) is int,
        'number': lambda item: type(item) in (int, float) and math.isfinite(item),
        'null': lambda item: item is None,
    }
    kind = node.get('type')
    if kind is not None and kind not in predicates:
        fail(path, f'unsupported schema type {kind}')
    if kind is not None and not predicates[kind](value):
        fail(path, f'expected {kind}')


def check_limits(value: Any, node: dict, path: str) -> None:
    checks = {
        'minimum': lambda bound: value >= bound,
        'maximum': lambda bound: value <= bound,
        'exclusiveMinimum': lambda bound: value > bound,
        'const': lambda expected: type(value) is type(expected) and value == expected,
        'enum': lambda choices: value in choices,
        'format': lambda form: form == 'uuid' and UUID.fullmatch(value) is not None,
    }
    for keyword, accepts in checks.items():
        if keyword in node and not accepts(node[keyword]):
            fail(path, f'failed {keyword}: {node[keyword]}')


def check_object(value: dict, context: tuple, path: str) -> None:
    """Recorre una vez los campos presentes; O(campos)."""
    node, definitions = context
    missing = set(node['required']) - value.keys()
    unknown = value.keys() - node['properties'].keys()
    if missing or unknown:
        fail(path, f'missing {sorted(missing)}, unknown {sorted(unknown)}')
    for field, item in value.items():
        visit(item, (node['properties'][field], definitions), f'{path}.{field}')


def check_union(value: Any, context: tuple, path: str) -> None:
    """Prueba las ramas del anyOf; O(ramas × tamaño del valor)."""
    node, definitions = context
    errors = []
    for branch in node['anyOf']:
        try:
            visit(value, (branch, definitions), path)
            return
        except ValueError as error:
            errors.append(str(error))
    fail(path, 'no matching alternative: ' + '; '.join(errors))


def visit(value: Any, context: tuple, path: str) -> None:
    """Recorre el árbol de valores; O(n) salvo alternativas anyOf."""
    node, definitions = context
    unsupported = node.keys() - SUPPORTED
    if unsupported:
        fail(path, f'unsupported schema keywords {sorted(unsupported)}')
    if '$ref' in node:
        visit(value, (definitions[node['$ref'].removeprefix('#/$defs/')], definitions), path)
        return
    if 'anyOf' in node:
        check_union(value, context, path)
        return
    check_shape(value, node, path)
    check_limits(value, node, path)
    if node.get('type') == 'object':
        check_object(value, context, path)
    if node.get('type') == 'array':
        for index, item in enumerate(value):
            visit(item, (node['items'], definitions), f'{path}[{index}]')


def validate(value: Any, schema: dict) -> None:
    """Valida datos ya cargados; no resuelve referencias remotas."""
    visit(value, (schema, schema['$defs']), '$')


if __name__ == '__main__':
    schema = json.loads((ROOT / 'contracts/schema.json').read_text())
    validate(json.loads((ROOT / 'contracts/examples.json').read_text()), schema)
    print('Examples match contract v1')
