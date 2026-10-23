"""Apus against the notebook itself, on real recordings with every version-1 option on.

Needs the reference made by tests/tools/notebook_reference.py (APUS_NB_FIXTURE) and the model files in
model/ (ADR 0005); skipped otherwise."""
import json
import os
import shutil
from pathlib import Path

import pandas as pd
import pytest

from apus.project import Run
from drive import drive

FX = Path(os.environ.get("APUS_NB_FIXTURE", "/nonexistent"))
MODEL_DIR = Path(__file__).parents[1] / "model"
pytestmark = pytest.mark.skipif(not (FX / "fixture.json").exists() or not (MODEL_DIR / "labels.csv").exists(),
                                reason="needs APUS_NB_FIXTURE and model/ (see tests/tools/notebook_reference.py)")
NB_OUT = FX / "data" / "outputs" / "perch_run"
NOT_COMPARED = {"run_settings.json", "top_species.png"}       # Apus records more provenance; draws its chart itself


def classes():
    lines = lambda name: (MODEL_DIR / name).read_text().splitlines()[1:]   # noqa: E731 (skip the header)
    return [n.strip() for n in lines("labels.csv") if n.strip()], [c.strip() for c in lines("perch_v2_ebird_classes.csv")]


def make_run(out, model):
    fixture = json.loads((FX / "fixture.json").read_text())
    settings = {**fixture["settings"], "species_list": FX / fixture["settings"]["species_list"],
                "synonyms_file": FX / fixture["settings"]["synonyms_file"]}
    return Run(FX / "data" / "recordings", out, settings, *classes(), model)


def files(root):
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()} - NOT_COMPARED


def test_same_predictions_give_the_notebooks_files_byte_for_byte(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    for name in ["predictions.csv", "run_settings.json"]:                  # resume from the notebook's scores
        shutil.copyfile(NB_OUT / name, out / name)
    run = make_run(out, json.loads((FX / "fixture.json").read_text())["model"])
    assert run.todo == []
    run.finish()
    list(run.clips())
    assert files(out) == files(NB_OUT)
    different = [f for f in sorted(files(NB_OUT)) if (out / f).read_bytes() != (NB_OUT / f).read_bytes()]
    assert not different, different


@pytest.mark.skipif(not (MODEL_DIR / "perch_v2.onnx").exists(), reason="needs model/perch_v2.onnx")
def test_onnx_from_the_audio_gives_the_notebooks_detections(tmp_path):
    import onnxruntime as ort
    session = ort.InferenceSession(str(MODEL_DIR / "perch_v2.onnx"), providers=["CPUExecutionProvider"])
    run = make_run(tmp_path / "out", "perch_v2.onnx")
    drive(run, lambda frames: session.run(["label"], {"inputs": frames})[0], batch=8)

    for name in ["predictions.csv", "detections.csv"]:
        sep = "," if name == "predictions.csv" else ";"
        mine = pd.read_csv(tmp_path / "out" / name, sep=sep, decimal="." if sep == "," else ",")
        theirs = pd.read_csv(NB_OUT / name, sep=sep, decimal="." if sep == "," else ",")
        key = ["file", "start_s", "species"]
        both = mine.merge(theirs, on=key, how="outer", suffixes=("", "_nb"), indicator=True)
        if name == "detections.csv":
            assert (both["_merge"] == "both").all(), both[both["_merge"] != "both"]
        matched = both[both["_merge"] == "both"]
        assert (matched["confidence"] - matched["confidence_nb"]).abs().max() <= 1e-4
    for name in ["species_summary.csv", "dataset_summary.csv"]:
        mine = pd.read_csv(tmp_path / "out" / name, sep=";", decimal=",")
        theirs = pd.read_csv(NB_OUT / name, sep=";", decimal=",")
        counts = [c for c in mine.columns if "confidence" not in c]
        pd.testing.assert_frame_equal(mine[counts], theirs[counts])
