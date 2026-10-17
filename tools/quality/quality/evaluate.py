"""Clasifica hallazgos contra el piso (bloquea) y el objetivo (avisa)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from . import config
from .sources import SourceFile, errores_silenciosos, linea_comprimida, lineas_largas

BLOQUEA = "block"
AVISA = "warn"
INFO = "info"

Registros = list[dict[str, Any]]
Registro = dict[str, Any]

REGLAS_SMELLS = {"long_function": "F1", "long_parameter_list": "F2"}
SMELLS_INFORMATIVOS = {"magic_number", "todo_comment", "commented_code", "todo"}


@dataclass(frozen=True)
class Hallazgo:
    regla: str
    severidad: str
    ubicacion: str
    detalle: str
    origen: str = ""


@dataclass(frozen=True)
class Umbral:
    """Piso y objetivo de una métrica por función, con su etiqueta legible."""

    regla: str
    piso: int
    objetivo: int
    etiqueta: str


def normalizar(path: str) -> str:
    return path[2:] if path.startswith("./") else path


def evaluar_score(score: float, grade: str) -> list[Hallazgo]:
    ubicacion = f"alcance km ({grade})"
    if score < config.PISO_SCORE:
        detalle = f"{score:.2f} < piso {config.PISO_SCORE}"
        return [Hallazgo("Score", BLOQUEA, ubicacion, detalle, "km-score")]
    if score < config.OBJETIVO_SCORE:
        detalle = f"{score:.2f} < objetivo {config.OBJETIVO_SCORE}"
        return [Hallazgo("Score", AVISA, ubicacion, detalle, "km-score")]
    return []


def _hallazgos_smells(resultado: Registros, severidad: str) -> list[Hallazgo]:
    hallazgos = []
    for archivo in resultado:
        for olor in archivo.get("smells", []):
            if olor["kind"] not in REGLAS_SMELLS:
                continue
            ubicacion = f'{normalizar(archivo["path"])}:{olor["line"]}'
            regla = REGLAS_SMELLS[olor["kind"]]
            hallazgos.append(Hallazgo(regla, severidad, ubicacion, olor["detail"], "km-smells"))
    return hallazgos


def evaluar_smells(resultado_piso: Registros, resultado_objetivo: Registros) -> list[Hallazgo]:
    bloqueos = _hallazgos_smells(resultado_piso, BLOQUEA)
    claves = {hallazgo.ubicacion for hallazgo in bloqueos}
    avisos = [h for h in _hallazgos_smells(resultado_objetivo, AVISA) if h.ubicacion not in claves]
    return bloqueos + avisos


def olores_informativos(resultado: Registros) -> list[Hallazgo]:
    hallazgos = []
    for archivo in resultado:
        for olor in archivo.get("smells", []):
            if olor["kind"] not in SMELLS_INFORMATIVOS:
                continue
            ubicacion = f'{normalizar(archivo["path"])}:{olor["line"]}'
            hallazgos.append(Hallazgo("Revisión", INFO, ubicacion, olor["detail"], "km-smells"))
    return hallazgos


def _clasificar(valor: int, umbral: Umbral) -> str | None:
    if valor > umbral.piso:
        return BLOQUEA
    if valor > umbral.objetivo:
        return AVISA
    return None


def _ubicacion_funcion(archivo: Registro, funcion: Registro) -> str:
    return f'{normalizar(archivo["path"])}:{funcion["start_line"]} {funcion["name"]}'


def _detalle_umbral(valor: int, umbral: Umbral) -> str:
    return f"{umbral.etiqueta} {valor} (piso {umbral.piso}/objetivo {umbral.objetivo})"


def evaluar_metrica(resultado: Registros, umbral: Umbral) -> list[Hallazgo]:
    hallazgos = []
    for archivo in resultado:
        for funcion in archivo.get("functions", []):
            severidad = _clasificar(funcion["complexity"], umbral)
            if severidad is None:
                continue
            regla = umbral.regla
            ubicacion = _ubicacion_funcion(archivo, funcion)
            detalle = _detalle_umbral(funcion["complexity"], umbral)
            hallazgos.append(Hallazgo(regla, severidad, ubicacion, detalle, "km-complejidad"))
    return hallazgos

def evaluar_complejidad(cycom: Registros, cogcom: Registros) -> list[Hallazgo]:
    ciclomatica = Umbral("F4", config.CYCOM_PISO, config.CYCOM_OBJETIVO, "ciclomática")
    cognitiva = Umbral("F5", config.COGCOM_PISO, config.COGCOM_OBJETIVO, "cognitiva")
    return evaluar_metrica(cycom, ciclomatica) + evaluar_metrica(cogcom, cognitiva)


def evaluar_duplicacion(dups: dict[str, Any]) -> list[Hallazgo]:
    ratio = dups.get("metrics", {}).get("duplication_percentage", 0.0)
    hallazgos = _ratio_duplicacion(ratio)
    return hallazgos + _grupos_regla_de_tres(dups.get("groups", []))


def _ratio_duplicacion(ratio: float) -> list[Hallazgo]:
    if ratio > config.DUP_RATIO_PISO:
        detalle = f"{ratio:.2f}% > piso {config.DUP_RATIO_PISO}%"
        return [Hallazgo("F9", BLOQUEA, "alcance km", detalle, "km-dups")]
    if ratio > config.DUP_RATIO_OBJETIVO:
        detalle = f"{ratio:.2f}% > objetivo {config.DUP_RATIO_OBJETIVO}%"
        return [Hallazgo("F9", AVISA, "alcance km", detalle, "km-dups")]
    return []


def _grupos_regla_de_tres(grupos: Registros) -> list[Hallazgo]:
    hallazgos = []
    for grupo in grupos:
        copias = len(grupo.get("locations", []))
        if copias >= config.DUP_COPIAS_REGLA_TRES:
            ubicacion = normalizar(grupo["locations"][0]["file_path"])
            detalle = f"{copias} copias de {grupo['line_count']} líneas (regla de tres)"
            hallazgos.append(Hallazgo("F9", BLOQUEA, ubicacion, detalle, "km-dups"))
    return hallazgos


def evaluar_tamano(fuentes: list[SourceFile]) -> list[Hallazgo]:
    hallazgos = []
    for fuente in fuentes:
        if fuente.code_lines > config.LOC_ARCHIVO_PISO:
            detalle = f"{fuente.code_lines} LOC > piso {config.LOC_ARCHIVO_PISO}"
            hallazgos.append(Hallazgo("F6", BLOQUEA, fuente.path, detalle, "sources"))
        elif fuente.code_lines > config.LOC_ARCHIVO_OBJETIVO:
            detalle = f"{fuente.code_lines} LOC > objetivo {config.LOC_ARCHIVO_OBJETIVO}"
            hallazgos.append(Hallazgo("F6", AVISA, fuente.path, detalle, "sources"))
    return hallazgos


def _hallazgo_fuente(regla: str, ubicacion: str, detalle: str) -> Hallazgo:
    return Hallazgo(regla, BLOQUEA, ubicacion, detalle, "sources")


def evaluar_f16(fuentes: list[SourceFile]) -> list[Hallazgo]:
    hallazgos = []
    for fuente in fuentes:
        hallazgos += _f16_largas(fuente) + _f16_comprimidas(fuente)
    return hallazgos


def _f16_largas(fuente: SourceFile) -> list[Hallazgo]:
    hallazgos = []
    for numero, ancho in lineas_largas(fuente):
        detalle = f"{ancho} columnas > {config.MAX_COLUMNAS}"
        hallazgos.append(_hallazgo_fuente("F16", f"{fuente.path}:{numero}", detalle))
    return hallazgos


def _f16_comprimidas(fuente: SourceFile) -> list[Hallazgo]:
    hallazgos = []
    for numero, linea in enumerate(fuente.lineas, start=1):
        if linea_comprimida(linea, fuente.path):
            detalle = "varias sentencias en una línea"
            hallazgos.append(_hallazgo_fuente("F16", f"{fuente.path}:{numero}", detalle))
    return hallazgos


def evaluar_f11(fuentes: list[SourceFile]) -> list[Hallazgo]:
    return [
        _hallazgo_fuente("F11", f"{fuente.path}:{numero}", mensaje)
        for fuente in fuentes
        for numero, mensaje in errores_silenciosos(fuente)
    ]


def aplicar_falsos_positivos(hallazgos: list[Hallazgo], falsos: list[config.FalsoPositivo]):
    admitidos: list[Hallazgo] = []
    suprimidos: list[Hallazgo] = []
    for hallazgo in hallazgos:
        destino = suprimidos if _es_falso_positivo(hallazgo, falsos) else admitidos
        destino.append(hallazgo)
    return admitidos, suprimidos


def _es_falso_positivo(hallazgo: Hallazgo, falsos: list[config.FalsoPositivo]) -> bool:
    return any(_coincide(hallazgo, falso) for falso in falsos)


def _coincide(hallazgo: Hallazgo, falso: config.FalsoPositivo) -> bool:
    mismo_origen = falso.origen == hallazgo.origen and falso.regla == hallazgo.regla
    zona = hallazgo.ubicacion.startswith(falso.path) and _coincide_linea(hallazgo, falso)
    return mismo_origen and zona and falso.contiene in hallazgo.detalle


def _coincide_linea(hallazgo: Hallazgo, falso: config.FalsoPositivo) -> bool:
    return falso.linea is None or hallazgo.ubicacion.endswith(f":{falso.linea}")


def solo_bloqueos(hallazgos: list[Hallazgo]) -> list[Hallazgo]:
    return [hallazgo for hallazgo in hallazgos if hallazgo.severidad == BLOQUEA]
