#!/usr/bin/env python3
"""Gate de calidad reproducible de Desire: falla por piso y avisa bajo objetivo.

Mide el alcance km (rs/ts/js), los scripts Svelte extraídos, las herramientas
Python y las fuentes HTML/CSS/Svelte. No declara aprobación integral: la
revisión manual pendiente se imprime siempre. Uso: python3 tools/quality/gate.py
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
from quality.evaluate import Hallazgo  # noqa: E402

SALIDA_APROBADA = 0
SALIDA_PISO = 2


@dataclass
class Reporte:
    """Todo lo que necesita el informe final del gate."""

    hallazgos: list[Hallazgo] = field(default_factory=list)
    suprimidos: list[Hallazgo] = field(default_factory=list)
    falsos: list = field(default_factory=list)
    score: dict = field(default_factory=dict)
    notas: list[str] = field(default_factory=list)


def parsear(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".", help="raíz del proyecto a medir")
    parser.add_argument("--no-km", action="store_true", help="omitir métricas de km")
    parser.add_argument("--json", help="ruta para volcar hallazgos en JSON")
    return parser.parse_args(argv)


def _limites(max_lineas: int, max_params: int) -> list[str]:
    return ["--max-lines", str(max_lineas), "--max-params", str(max_params)]


def _correr(root: Path, scope: km.Scope, peticion: km.Peticion):
    resultado = km.ejecutar(root, scope.consulta(peticion.comando, *peticion.extra))
    if scope.alias:
        km.reescribir_paths(resultado, scope.alias)
    return resultado


def medir_smells(root: Path, scope: km.Scope) -> list[Hallazgo]:
    limites_piso = _limites(config.MAX_LINEAS_FUNCION_PISO, config.MAX_PARAMETROS_PISO)
    limites_objetivo = _limites(config.MAX_LINEAS_FUNCION_OBJETIVO, config.MAX_PARAMETROS_OBJETIVO)
    piso = _correr(root, scope, km.Peticion("smells", tuple(limites_piso)))
    objetivo = _correr(root, scope, km.Peticion("smells", tuple(limites_objetivo)))
    hallazgos = evaluate.evaluar_smells(piso, objetivo)
    if scope.informativos:
        hallazgos += evaluate.olores_informativos(piso)
    return hallazgos


def medir_complejidad(root: Path, scope: km.Scope) -> list[Hallazgo]:
    cycom = _correr(root, scope, km.Peticion("cycom", ("--per-function",)))
    cogcom = _correr(root, scope, km.Peticion("cogcom", ("--per-function",)))
    return evaluate.evaluar_complejidad(cycom, cogcom)


def medir_scope(root: Path, scope: km.Scope) -> list[Hallazgo]:
    return medir_smells(root, scope) + medir_complejidad(root, scope)


def medir_producto(root: Path, notas: list[str]) -> tuple[list[Hallazgo], dict]:
    scope = km.Scope(".", config.DIRS_EXCLUIDOS, config.EXTS_PRODUCTO)
    score = km.ejecutar(root, scope.consulta("score"))
    extra_dups = ("--min-lines", "6", "--report", "--show-all")
    dups = km.ejecutar(root, scope.consulta("dups", *extra_dups))
    hallazgos: list[Hallazgo] = []
    if score.get("files_analyzed", 0) == 0:
        notas.append("Alcance km sin archivos rs/ts/js: score no evaluado (evita falso piso).")
    else:
        hallazgos += evaluate.evaluar_score(score["score"], score["grade"])
    hallazgos += medir_scope(root, scope) + evaluate.evaluar_duplicacion(dups)
    return hallazgos, score


def medir_herramientas(root: Path) -> list[Hallazgo]:
    # Los umbrales de config.py son constantes nombradas, no números mágicos de
    # dominio; por eso el tooling no reporta informativos, sí bloqueos y avisos.
    scope = km.Scope("tools/quality", ("tests", "__pycache__"), ("py",), informativos=False)
    return medir_scope(root, scope)


def medir_svelte(root: Path, notas: list[str]) -> list[Hallazgo]:
    ruta = root / config.SVELTE
    if not ruta.exists():
        notas.append(f"{config.SVELTE} ausente: sin cobertura de script Svelte.")
        return []
    with tempfile.TemporaryDirectory() as temporal:
        destino = Path(temporal) / "App.script.ts"
        destino.write_text(sources.extraer_scripts(ruta.read_text(encoding="utf-8")))
        scope = km.Scope(".", (), ("ts",), alias={"App.script.ts": config.SVELTE})
        return medir_scope(Path(temporal), scope)


def medir_km(root: Path, notas: list[str]) -> tuple[list[Hallazgo], dict]:
    if not km.hay_km():
        detalle = "km ausente: no se midieron score, olores, complejidad ni duplicación"
        return [Hallazgo("Entorno", evaluate.BLOQUEA, "km", detalle, "tooling")], {}
    producto, score = medir_producto(root, notas)
    return producto + medir_herramientas(root) + medir_svelte(root, notas), score


def reunir(root: Path, sin_km: bool, notas: list[str]) -> tuple[list[Hallazgo], dict]:
    fuentes = sources.descubrir_fuentes(root)
    hallazgos = evaluate.evaluar_tamano(fuentes)
    hallazgos += evaluate.evaluar_f16(fuentes) + evaluate.evaluar_f11(fuentes)
    if sin_km:
        notas.append("Modo --no-km: sin métricas de score, olores ni complejidad.")
        return hallazgos, {}
    de_km, score = medir_km(root, notas)
    return hallazgos + de_km, score


def describir(hallazgo: Hallazgo) -> str:
    return f"  [{hallazgo.regla}] {hallazgo.ubicacion} · {hallazgo.detalle}"


def imprimir_seccion(titulo: str, hallazgos: list[Hallazgo]) -> None:
    print(f"\n{titulo} ({len(hallazgos)})")
    if not hallazgos:
        print("  — sin hallazgos")
        return
    for hallazgo in hallazgos:
        print(describir(hallazgo))


def imprimir_score(score: dict) -> None:
    if not score:
        print("Score km: no medido")
        return
    print(f"Score km (rs/ts/js): {score['score']:.2f} / {score['grade']}")
    print(f"  {score['files_analyzed']} archivos · {score['total_loc']} LOC")
    print(f"  piso {config.PISO_SCORE} · objetivo {config.OBJETIVO_SCORE}")


def imprimir_falsos_positivos(falsos: list, activos: int) -> None:
    print(f"\nFalsos positivos documentados ({len(falsos)}; {activos} activos ahora)")
    for falso in falsos:
        print(f"  - {falso.describe()}")


def imprimir_revision_manual() -> None:
    print("\nRevisión manual pendiente (no bloquea el gate; impide aprobación integral)")
    for regla, detalle in config.REVISION_MANUAL:
        print(f"  - {regla}: {detalle}")


def imprimir_cobertura() -> None:
    print("\nCobertura y límites del gate")
    for nombre, detalle in config.COBERTURA:
        print(f"  - {nombre}: {detalle}")


def imprimir_notas(notas: list[str]) -> None:
    if not notas:
        return
    print("\nNotas de medición")
    for nota in notas:
        print(f"  - {nota}")


def imprimir_informe(reporte: Reporte) -> int:
    bloqueos = evaluate.solo_bloqueos(reporte.hallazgos)
    avisos = [h for h in reporte.hallazgos if h.severidad == evaluate.AVISA]
    informativos = [h for h in reporte.hallazgos if h.severidad == evaluate.INFO]
    print("== Gate de calidad Desire ==")
    imprimir_score(reporte.score)
    imprimir_seccion("Bloqueos de piso", bloqueos)
    imprimir_seccion("Avisos bajo objetivo", avisos)
    imprimir_seccion("Informativos para revisión", informativos)
    imprimir_falsos_positivos(reporte.falsos, len(reporte.suprimidos))
    imprimir_revision_manual()
    imprimir_cobertura()
    imprimir_notas(reporte.notas)
    print("\nVeredicto del gate:", "FALLIDO" if bloqueos else "OK (parcial)")
    print("Aprobación integral: NO — revisión manual pendiente y cobertura no universal.")
    return len(bloqueos)


def volcar_json(destino: Path, admitidos: list[Hallazgo], suprimidos: list[Hallazgo]) -> None:
    datos = {
        "hallazgos": [vars(hallazgo) for hallazgo in admitidos],
        "falsos_positivos_suprimidos": [vars(hallazgo) for hallazgo in suprimidos],
    }
    destino.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    args = parsear(argv)
    root = Path(args.root).resolve()
    notas: list[str] = []
    falsos = config.cargar_falsos_positivos(Path(__file__).with_name("known-false-positives.json"))
    hallazgos, score = reunir(root, args.no_km, notas)
    admitidos, suprimidos = evaluate.aplicar_falsos_positivos(hallazgos, falsos)
    reporte = Reporte(admitidos, suprimidos, falsos, score, notas)
    bloqueos = imprimir_informe(reporte)
    if args.json:
        volcar_json(Path(args.json), admitidos, suprimidos)
    return SALIDA_PISO if bloqueos else SALIDA_APROBADA


if __name__ == "__main__":
    raise SystemExit(main())
