"""Reference outputs for the Apus browser feasibility test (run in WSL with Perch_notebooks' .venv).

    python make_ref.py <experiment dir> <perch_all_in_one or chirpid_perch .ipynb> <WABAD recordings dir>

The recordings are named in <experiment dir>/recordings.json, kept out of git (the repository is public):
  {"fixture": ["SITE/SITE_YYYYMMDD_HHMMSS", ...], "short_copy_of": "SITE/...", "one_hour_folder": "SITE"}

Executes the notebook's own §2 cell verbatim (load_audio, frame_windows, peak_normalize,
window_probabilities) on fixture recordings, and writes what the browser test compares against:
  web/fixture/<name>.wav       the recordings, copied unchanged
  web/ref/<name>.probs.f32     TF softmax for every window, little-endian float32 [windows, 14795]
  web/ref/<name>.win.f32       the first normalized windows, float32 [n, 160000]
  web/manifest.json            what is where, plus TF timings
  py_cache/<name>.frames.npy   every normalized window, for the ONNX check
"""
import json
import platform
import shutil
import sys
import time
from pathlib import Path

import kagglehub
import numpy as np
import soundfile as sf

SPIKE = Path(sys.argv[1])
WEB = SPIKE / "web"
NB = Path(sys.argv[2])
MODEL = Path.home() / ".cache/kagglehub/models/google/bird-vocalization-classifier/tensorFlow2/perch_v2_cpu/1"
W = Path(sys.argv[3])
SPEC = json.loads((SPIKE / "recordings.json").read_text())
FIXTURE = SPEC["fixture"]
N_WIN_SAVED = 3

# The notebook's §2 cell, verbatim, with §1's defaults and the cached model instead of a download.
kagglehub.model_download = lambda slug: str(MODEL)
cell = "".join(json.loads(NB.read_text())["cells"][5]["source"])
assert "def load_audio" in cell and "def peak_normalize" in cell, "cell 5 is no longer the §2 cell"
ns = {"Path": Path, "THRESHOLD": 0.10, "HOP_S": 5.0, "TOP_K": 10, "CSV_SEPARATOR": ","}
exec(cell, ns)

manifest = {"python": platform.python_version(), "tensorflow": ns["tf"].__version__,
            "librosa": ns["librosa"].__version__, "numpy": np.__version__, "files": []}


def run(name, wav, save_frames=True):
    info = sf.info(str(wav))
    t = time.perf_counter()
    frames = ns["peak_normalize"](ns["frame_windows"](ns["load_audio"](wav), 5.0))
    t_pre = time.perf_counter() - t
    probs = ns["window_probabilities"](frames)
    t_all = time.perf_counter() - t
    probs.astype("<f4").tofile(WEB / "ref" / f"{name}.probs.f32")
    frames[:N_WIN_SAVED].astype("<f4").tofile(WEB / "ref" / f"{name}.win.f32")
    if save_frames:
        np.save(SPIKE / "py_cache" / f"{name}.frames.npy", frames)
    manifest["files"].append({
        "name": name, "wav": f"{wav.parent.name}/{wav.name}", "sr": info.samplerate,
        "channels": info.channels, "subtype": info.subtype, "seconds": info.duration,
        "n_windows": len(frames), "n_win_saved": min(N_WIN_SAVED, len(frames)),
        "tf_pre_s": round(t_pre, 3), "tf_total_s": round(t_all, 3)})
    print(f"{name}: {info.samplerate} Hz x{info.channels} {info.subtype}, {len(frames)} windows, {t_all:.1f} s")


for rel in FIXTURE:
    src = W / f"{rel}.wav"
    dst = WEB / "fixture" / src.name
    shutil.copyfile(src, dst)
    run(src.stem, dst)

# Under 5 s: exercises the pad_center path. Written from the original int16 samples, so no rounding.
short_name = f"{Path(SPEC['short_copy_of']).parent.name}_short3s"
short = WEB / "fixture" / f"{short_name}.wav"
data, sr = sf.read(str(W / f"{SPEC['short_copy_of']}.wav"), dtype="int16")
sf.write(str(short), data[: 3 * sr], sr, subtype="PCM_16")
run(short_name, short)

# One hour of real 48 kHz audio: 60 consecutive one-minute recordings from one site, joined unchanged.
parts = sorted((W / SPEC["one_hour_folder"]).glob("*.wav"))[:60]
assert len(parts) == 60 and all(sf.info(str(p)).samplerate == 48000 for p in parts)
hour = np.concatenate([sf.read(str(p), dtype="int16")[0] for p in parts])
long_wav = WEB / "long" / "one_hour_48k.wav"
sf.write(str(long_wav), hour, 48000, subtype="PCM_16")
manifest["one_hour_parts"] = [p.name for p in parts]
run("one_hour_48k", long_wav, save_frames=False)
n = manifest["files"][-1]["n_windows"]
manifest["tf_windows_per_s_one_hour"] = round(n / manifest["files"][-1]["tf_total_s"], 2)
print(f"TF in WSL, one hour: {manifest['tf_windows_per_s_one_hour']} windows/s")

(WEB / "manifest.json").write_text(json.dumps(manifest, indent=1))
