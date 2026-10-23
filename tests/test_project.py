"""A whole run on synthetic recordings, with a stand-in model: outputs, lists, resume, clips, failures."""
import json

import numpy as np
import pandas as pd
import pytest
import soundfile as sf

from apus.project import ApusError, Run
from drive import drive

CLASSES = ["Turdus merula", "Parus major", "Erithacus rubecula", "Fringilla coelebs", "Sylvia atricapilla"] + \
          [f"Species {i}" for i in range(15)]
CODES = ["eurbla", "gretit1", "eurrob1", "comcha", "blackc1"] + ["no_ebird_code"] * 15
MODEL = "test model"


def fake_model(frames):
    """Confident scores for one of the five named species, picked from each window's content (so batching
    cannot change them): about 0.8 for it and 0.11 for the next one."""
    k = (np.abs(frames).sum(axis=1) * 1000).astype(int) % 5
    logits = np.zeros((len(frames), len(CLASSES)), np.float32)
    logits[np.arange(len(frames)), k] = 5
    logits[np.arange(len(frames)), (k + 1) % 5] = 3
    return logits


def tone(path, sr, seconds, channels=1, hz=2000):
    n = int(sr * seconds)
    x = 0.2 * np.sin(2 * np.pi * hz * np.arange(n) / sr) * (1 + np.arange(n) / n)
    sf.write(path, np.repeat(x[:, None], channels, axis=1) if channels > 1 else x, sr)


@pytest.fixture
def project(tmp_path):
    rec = tmp_path / "recordings"
    (rec / "A").mkdir(parents=True)
    (rec / "B").mkdir()
    tone(rec / "A" / "rec1.wav", 48000, 12.0)
    tone(rec / "A" / "rec2.wav", 22050, 3.0, hz=900)
    tone(rec / "B" / "rec3.wav", 32000, 11.0, channels=2, hz=5000)
    (rec / "B" / "empty.wav").write_bytes(b"")
    lists = tmp_path / "lists"
    lists.mkdir()
    (lists / "A.txt").write_text("Turdus merula\nParus major\n")                  # every recording of dataset A
    (lists / "rec3_species_list.csv").write_text("Blackbird,x\nUnknown bird,y\n")  # one recording, via a synonym
    synonyms = tmp_path / "synonyms.csv"
    synonyms.write_text("your_name,perch_name\nBlackbird,Turdus merula\n")
    return tmp_path


def make_run(project, out="out", **settings):
    s = {"species_list": project / "lists", "synonyms_file": project / "synonyms.csv", **settings}
    return Run(project / "recordings", project / out, s, CLASSES, CODES, MODEL, {"backend": "test", "app": "test"})


def test_whole_run(project):
    run = make_run(project, raven_tables=True)
    assert run.todo == ["A/rec1.wav", "A/rec2.wav", "B/rec3.wav"]
    assert any("1 empty file(s) skipped" in m for m in run.messages)
    result = drive(run, fake_model, batch=2)
    out = project / "out"

    pred = pd.read_csv(out / "predictions.csv")
    windows = {"A/rec1.wav": 2, "A/rec2.wav": 1, "B/rec3.wav": 2}
    assert len(pred) == sum(windows.values()) * 10
    assert pred.groupby(["file", "start_s"]).size().eq(10).all()

    det = pd.read_csv(out / "detections.csv")
    removed = pd.read_csv(out / "removed_by_species_list.csv")
    assert len(det) and len(removed)
    assert (det["confidence"] >= 0.10).all()
    assert set(det[det["dataset"] == "A"]["species"]) <= {"Turdus merula", "Parus major"}
    assert set(det[det["file"] == "B/rec3.wav"]["species"]) <= {"Turdus merula"}
    assert len(pd.concat([det, removed])) == (pred["confidence"] >= 0.10).sum()      # nothing lost, nothing twice
    for name in ["species_summary.csv", "dataset_summary.csv", "summary.txt", "run_settings.json"]:
        assert (out / name).exists(), name
    assert len(list((out / "raven").rglob("*.Perch.selection.table.txt"))) == det["file"].nunique()
    assert result["lines"][0].startswith("Perch 2.0 — 3 recording(s) in 2 dataset(s): 5 windows")
    assert json.loads((out / "run_settings.json").read_text())["backends"] == ["test"]


def test_batching_does_not_change_results(project):
    drive(make_run(project, out="a"), fake_model, batch=1)
    drive(make_run(project, out="b"), fake_model, batch=16)
    assert (project / "a" / "predictions.csv").read_bytes() == (project / "b" / "predictions.csv").read_bytes()


def test_resume(project):
    drive(make_run(project), fake_model)
    again = make_run(project)
    assert again.todo == []                                    # nothing left to do
    with pytest.raises(ApusError, match="other settings"):
        make_run(project, hop_s=2.5)
    fresh = make_run(project, resume=False)
    assert len(fresh.todo) == 3 and not (project / "out" / "predictions.csv").exists()


def test_settings_are_checked(project):
    for bad in [{"threshold": 0}, {"threshold": 0.05}, {"hop_s": 0}, {"csv_separator": "|"}]:
        with pytest.raises(ApusError):
            make_run(project, **bad)


def test_unreadable_recording_is_listed(project):
    (project / "recordings" / "B" / "broken.wav").write_bytes(b"RIFF not really audio")
    result = drive(make_run(project), fake_model)
    assert [f["file"] for f in result["failed"]] == ["B/broken.wav"]
    assert (project / "out" / "failed_recordings.csv").exists()


def test_settings_from_javascript_keep_the_notebooks_types(project):
    """JavaScript sends 5.0 as 5: predictions must still read start_s 0.0, 5.0, as the notebook writes them."""
    drive(make_run(project, out="py"), fake_model)
    drive(make_run(project, out="js", hop_s=5, threshold=0.1, top_k=10.0), fake_model)
    assert (project / "py" / "predictions.csv").read_bytes() == (project / "js" / "predictions.csv").read_bytes()


def test_semicolon_csv(project):
    drive(make_run(project, csv_separator=";"), fake_model)
    det = pd.read_csv(project / "out" / "detections.csv", sep=";", decimal=",")
    assert det["confidence"].between(0.10, 1).all()


def test_clips(project):
    run = make_run(project, clips_per_band=1)
    drive(run, fake_model)
    written = list(run.clips())
    wavs = [w for w in written if w.endswith(".wav")]
    assert written[-1] == "clips/clips.csv" and wavs
    for w in wavs:
        audio, sr = sf.read(project / "out" / w)
        assert sr == 32000 and len(audio) <= 7 * 32000
    # a second pass skips clips that are already there, sorted or not
    (project / "out" / wavs[0]).rename(project / "out" / wavs[0].replace(".wav", ".tmp"))
    existing = {"/".join(w.split("/")[1:]) for w in wavs[1:]}
    assert [w for w in run.clips(existing) if w.endswith(".wav")] == wavs[:1]
