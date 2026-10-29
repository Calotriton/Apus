"""The Download tab's clips and Raven tables, made after a run from its output files."""
import json

import numpy as np
import pandas as pd
import soundfile as sf

from apus import export
from apus.project import sample_per_band
from apus.results import Results
from test_project import fake_model, make_run, project  # noqa: F401 (fixture)
from drive import drive


def finished(project, **settings):
    run = make_run(project, **settings)
    drive(run, fake_model)
    return run, Results(run.output_dir)


def opts(**o):
    return json.dumps(o)


def test_the_default_sample_is_the_notebooks_clips(project):
    run, res = finished(project, clips_per_band=1)
    notebook = {p.split("/")[-1] for p in run.clips() if p.endswith(".wav")}
    rows = export.choose_clips(res, **export.options_of(opts(per_band=1)))
    assert {export.clip_name(r) for _, r in rows.iterrows()} == notebook


def test_band_width():
    d = pd.DataFrame({"species": ["a"] * 6, "confidence": [0.11, 0.19, 0.21, 0.39, 0.41, 0.99]})
    assert sample_per_band(d, 1, bands=10) == sample_per_band(d, 1)                    # the notebook's 0.1 bands
    picked = d.loc[sample_per_band(d, 1, bands=5)]                                   # 0.2 wide: 0-0.2, 0.2-0.4, ...
    assert sorted((picked["confidence"] * 5).astype(int)) == [0, 1, 2, 4]
    assert len(sample_per_band(d, 10, bands=4)) == 6


def test_checked_clips_go_into_verdict_folders(project, tmp_path):
    run, res = finished(project)
    d = res.detections
    for (_, r), v in zip(d.iloc[:3].iterrows(), ["correct", "incorrect", "unsure"]):
        res.set_verdict(r["file"], r["start_s"], r["species"], v)
    choice = opts(which="checked", verdicts=["correct", "incorrect"])
    assert json.loads(export.plan(res, run.input_dir, choice))["clips"] == 2
    written = list(export.write_clips(res, run.input_dir, choice, tmp_path / "x"))
    wavs = [w for w in written if w.endswith(".wav")]
    assert len(wavs) == 2 and {w.split("/")[2] for w in wavs} == {"correct", "incorrect"}
    index = pd.read_csv(tmp_path / "x" / "clips" / "clips.csv")
    assert set(index["verdict"]) == {"correct", "incorrect"} and written[-1] == "clips/clips.csv"


def test_species_and_every_detection(project, tmp_path):
    run, res = finished(project)
    one = res.detections["species"].iloc[0]
    rows = export.choose_clips(res, **export.options_of(opts(which="all", species=[one])))
    assert len(rows) == (res.detections["species"] == one).sum() and set(rows["species"]) == {one}


def test_clips_as_recorded_keep_rate_and_channels(project, tmp_path):
    run, res = finished(project)
    rec3 = res.detections[res.detections["file"] == "B/rec3.wav"].iloc[:1]
    res.detections = rec3                                       # one detection, in the 32 kHz stereo file
    choice = opts(which="all", extra_s=0.5, as_recorded=True)
    plan = json.loads(export.plan(res, run.input_dir, choice))
    path = next(export.write_clips(res, run.input_dir, choice, tmp_path / "x"))
    audio, sr = sf.read(tmp_path / "x" / path, always_2d=True)
    assert sr == 32000 and audio.shape[1] == 2 and len(audio) <= 6 * 32000
    assert plan["bytes"] == 6 * 32000 * 2 * 2 + 44
    model = next(export.write_clips(res, run.input_dir, opts(which="all", extra_s=0.5), tmp_path / "y"))
    assert sf.read(tmp_path / "y" / model, always_2d=True)[0].shape[1] == 1      # as the model heard it: mono


def test_a_clip_that_cannot_be_cut_is_listed(project, tmp_path):
    run, res = finished(project)
    (run.input_dir / "A" / "rec2.wav").write_bytes(b"not audio")
    written = list(export.write_clips(res, run.input_dir, opts(which="all"), tmp_path / "x"))
    assert written[-1] == "clips/clips_not_cut.csv"
    failed = pd.read_csv(tmp_path / "x" / "clips" / "clips_not_cut.csv")
    assert set(failed["file"]) == {"A/rec2.wav"}
    assert len(failed) + len([w for w in written if w.endswith(".wav")]) == len(res.detections)


def test_raven_tables_equal_the_runs(project, tmp_path):
    run, res = finished(project, raven_tables=True)
    paths = export.raven(res, tmp_path / "x")
    assert paths and all(p.startswith("raven/") for p in paths)
    for p in paths:
        assert (tmp_path / "x" / p).read_bytes() == (run.output_dir / p).read_bytes(), p
    assert np.isclose(len(paths), res.detections["file"].nunique())
