"""ONNX (justinchuby/Perch-onnx) vs the notebook's TensorFlow model, on the same normalized windows.

    uv run --no-project --with onnxruntime --with numpy python onnx_check.py <spike dir>
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort

SPIKE = Path(sys.argv[1])
WEB = SPIKE / "web"
N_CLASSES, THRESHOLD, TOP_K = 14795, 0.10, 10

man = json.loads((WEB / "manifest.json").read_text())
sess = ort.InferenceSession(str(WEB / "model" / "perch_v2.onnx"), providers=["CPUExecutionProvider"])
print("onnxruntime", ort.__version__, "| inputs", [(i.name, i.shape) for i in sess.get_inputs()],
      "| outputs", [o.name for o in sess.get_outputs()])


def softmax(z):
    z = z.astype(np.float64)
    e = np.exp(z - z.max(axis=-1, keepdims=True))
    return (e / e.sum(axis=-1, keepdims=True)).astype(np.float32)


report, worst, n_win, t_inf = [], 0.0, 0, 0.0
for f in man["files"]:
    path = SPIKE / "py_cache" / f"{f['name']}.frames.npy"
    if not path.exists():
        continue
    frames = np.load(path)
    tf_p = np.fromfile(WEB / "ref" / f"{f['name']}.probs.f32", dtype="<f4").reshape(-1, N_CLASSES)
    t = time.perf_counter()
    logits = np.concatenate([sess.run(["label"], {"inputs": frames[i:i + 16]})[0]
                             for i in range(0, len(frames), 16)])
    t_inf += time.perf_counter() - t
    p = softmax(logits)
    d = np.abs(p - tf_p)
    det_tf, det_ox = set(zip(*np.nonzero(tf_p >= THRESHOLD))), set(zip(*np.nonzero(p >= THRESHOLD)))
    top_tf, top_ox = np.argsort(-tf_p, axis=1)[:, :TOP_K], np.argsort(-p, axis=1)[:, :TOP_K]
    row = {"file": f["name"], "windows": len(frames), "max_abs_dp": float(d.max()),
           "mean_abs_dp": float(d.mean()), "detections_tf": len(det_tf),
           "detections_differ": len(det_tf ^ det_ox),
           "windows_top10_differ": int((top_tf != top_ox).any(axis=1).sum())}
    report.append(row)
    worst, n_win = max(worst, row["max_abs_dp"]), n_win + len(frames)
    print(row)

summary = {"onnxruntime": ort.__version__, "windows": n_win, "max_abs_dp": worst,
           "detections_differ": sum(r["detections_differ"] for r in report),
           "windows_top10_differ": sum(r["windows_top10_differ"] for r in report),
           "onnx_cpu_windows_per_s": round(n_win / t_inf, 2), "files": report}
(SPIKE / "results" / "onnx_vs_tf.json").write_text(json.dumps(summary, indent=1))
print({k: v for k, v in summary.items() if k != "files"})
