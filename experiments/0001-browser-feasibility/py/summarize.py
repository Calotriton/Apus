"""Markdown summary of every browser run in results/ (the tables in docs/research/0001).

    python summarize.py <experiment dir>
"""
import csv
import json
import sys
from pathlib import Path

RES = Path(sys.argv[1]) / "results"


def peak(tag, col):
    path = RES / f"{tag}.mem.csv"
    rows = list(csv.DictReader(path.open(encoding="utf-8-sig"))) if path.exists() else []
    return max((int(r[col]) for r in rows), default=None)


print("| run | backend | fixture windows/s | 1 h windows/s | max abs dp | detections differ | top-10 differ | peak working set MB |")
print("|---|---|---|---|---|---|---|---|")
for path in sorted(RES.glob("*.json")):
    tag = path.stem
    r = json.loads(path.read_text(encoding="utf-8"))
    if "cfg" not in r:
        continue
    fx, lg = r.get("fixtureSummary") or {}, r.get("long") or {}
    gpu = r.get("gpuAdapter")
    backend = f"{r['cfg']['ep']}, {r.get('ortWasmThreads')} threads" if r["cfg"]["ep"] == "wasm" else \
        f"webgpu, {gpu['vendor'] if isinstance(gpu, dict) else 'GPU not recorded'}"
    dps = [d for d in (fx.get("maxAbsDp"), lg.get("maxAbsDp")) if d is not None]
    print(f"| {tag} | {backend} | {fx.get('windowsPerS', '')} | {lg.get('windowsPerS', '')} | "
          f"{max(dps):.1e} | {fx.get('detectionsDiffer', 0) + lg.get('detectionsDiffer', 0)} of "
          f"{fx.get('detectionsNotebook', 0) + lg.get('detectionsNotebook', 0)} | "
          f"{fx.get('top10Differ', 0) + lg.get('top10Differ', 0)} | {peak(tag, 'working_set_mb')} |")
