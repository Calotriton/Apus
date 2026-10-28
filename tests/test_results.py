"""After a run: reopening, checking detections, §9 thresholds, §8 comparison, times from file names and the
recordings check. §8 and §9 are compared with the notebook's own cells (APUS_NOTEBOOK: the path of
perch_all_in_one.ipynb or chirpid_perch.ipynb); those tests are skipped without it."""
import json
import os
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pandas as pd
import pytest
import soundfile as sf

from apus.audio import Recording, inspect, spectrogram
from apus.compare import compare
from apus.project import COLUMNS, safe_name, walk_files, AUDIO_EXTS
from apus.results import Results, file_time
from drive import drive
from test_project import CLASSES, fake_model, make_run, project, tone  # noqa: F401 (fixture)

NOTEBOOK = Path(os.environ.get("APUS_NOTEBOOK", "/nonexistent"))
needs_notebook = pytest.mark.skipif(not NOTEBOOK.exists(), reason="needs APUS_NOTEBOOK")


def notebook_cells(section):
    """The code cells of one notebook section ('## 8', '## 9')."""
    cells, inside = [], False
    for c in json.loads(NOTEBOOK.read_text(encoding="utf-8"))["cells"]:
        src = "".join(c["source"])
        if c["cell_type"] == "markdown" and src.startswith("## "):
            inside = src.startswith(section)
        elif inside and c["cell_type"] == "code":
            cells.append(src)
    return cells


class FakePlt:
    """Enough of matplotlib for the notebook's figure code to run without drawing."""
    def subplots(self, nrows=1, ncols=1, **kw):
        axes = np.empty((nrows, ncols), dtype=object)        # filled one by one: numpy would unpack mocks
        for i in range(nrows):
            for j in range(ncols):
                axes[i, j] = MagicMock()
        return MagicMock(), axes if kw.get("squeeze") is False else axes.squeeze()

    def show(self):
        pass


def finished_run(project, **settings):
    run = make_run(project, **settings)
    result = drive(run, fake_model)
    return run, result


# ── Reopening and checking ────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("sep", [",", ";"])
def test_reopened_summary_equals_the_run(project, sep):
    run, result = finished_run(project, csv_separator=sep)
    reopened = json.loads(Results(run.output_dir).summary())
    for key in ["lines", "species", "datasets", "failed"]:
        assert reopened[key] == result[key], key
    assert reopened["threshold"] == run.s["threshold"]


def test_verdicts_are_saved_and_counted(project):
    run, _ = finished_run(project, csv_separator=";")
    res = Results(run.output_dir)
    species = res.detections["species"].iloc[0]
    view = json.loads(res.species(species, per_band=10))
    assert sum(view["histogram"]) == (res.detections["species"] == species).sum()
    first, second = res.detections.iloc[0], res.detections.iloc[1]
    res.set_verdict(first["file"], first["start_s"], first["species"], "correct")
    res.set_verdict(second["file"], second["start_s"], second["species"], "incorrect")
    res.set_verdict(second["file"], second["start_s"], second["species"], "unsure")   # changed: one row, the last
    table = pd.read_csv(run.output_dir / "checked_detections.csv", sep=";", decimal=",")
    assert list(table["verdict"]) == ["correct", "unsure"]
    again = Results(run.output_dir)                                                # a later session
    verdicts = again._verdicts(again.detections)
    assert list(verdicts.iloc[:2]) == ["correct", "unsure"] and set(verdicts.iloc[2:]) <= {""}
    counts = {r["species"]: r for r in json.loads(again.checked_counts())}
    assert counts[first["species"]]["correct"] == 1
    again.set_verdict(first["file"], first["start_s"], first["species"], "")        # removed
    assert len(pd.read_csv(run.output_dir / "checked_detections.csv", sep=";")) == 1


def test_the_sample_to_check_is_the_clips(project):
    run, _ = finished_run(project, extract_clips=True, clips_per_band=1)
    list(run.clips())
    clips = pd.read_csv(run.output_dir / "clips" / "clips.csv")
    res = Results(run.output_dir)
    picked = res.detections.loc[sorted(res.sample(1))]
    assert set(zip(picked["file"], picked["start_s"], picked["species"])) == \
        set(zip(clips["file"], clips["start_s"], clips["species"]))


# ── §9 ────────────────────────────────────────────────────────────────────────────────────────────────────
def synthetic_output(tmp_path, sep=","):
    """An output folder whose detections have known confidences, with checked clips sorted as §9 asks."""
    rng = np.random.default_rng(1)
    out = tmp_path / "out"
    rows, clips = [], []
    for k, species in enumerate(["Turdus merula", "Parus major", "Erithacus rubecula"]):
        n = [40, 12, 5][k]                                      # the last has too few clips for a fit
        conf = np.round(rng.uniform(0.1, 0.99, n), 6)
        correct = rng.uniform(0, 1, n) < 1 / (1 + np.exp(-(conf - 0.45) * 12))
        for i, (c, ok) in enumerate(zip(conf, correct)):
            d = {"dataset": "A", "file": f"A/rec{i}.wav", "start_s": 5.0 * k, "end_s": 5.0 * k + 5,
                 "species": species, "confidence": float(c), "rank": 1}
            rows.append(d)
            name = f"rec{i}_{safe_name(species)}_{c:.3f}_{d['start_s']:g}s.wav"
            clips.append({**{k2: d[k2] for k2 in ["dataset", "file", "start_s", "end_s", "species", "confidence"]},
                          "clip": name, "ok": ok})
    det = pd.DataFrame(rows, columns=COLUMNS)
    out.mkdir()
    det.to_csv(out / "detections.csv", index=False, sep=sep, decimal="," if sep == ";" else ".")
    (out / "run_settings.json").write_text(json.dumps({"threshold": 0.1, "csv_separator": sep}))
    index = pd.DataFrame(clips)
    (out / "clips").mkdir()
    index[["clip", "species", "dataset", "file", "start_s", "end_s", "confidence"]].to_csv(
        out / "clips" / "clips.csv", index=False, sep=sep, decimal="," if sep == ";" else ".")
    for c in clips:
        folder = out / "clips" / safe_name(c["species"]) / ("correct" if c["ok"] else "incorrect")
        folder.mkdir(parents=True, exist_ok=True)
        sf.write(folder / c["clip"], np.zeros(320, np.float32), 32000)
    return out, det, index


@needs_notebook
@pytest.mark.parametrize("sep", [",", ";"])
def test_thresholds_equal_the_notebooks(tmp_path, sep):
    out, det, _ = synthetic_output(tmp_path, sep)
    nb_out = tmp_path / "nb"
    nb_out.mkdir()

    def save_table(df, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(path, index=False, sep=sep, decimal="," if sep == ";" else ".")

    ns = {"np": np, "pd": pd, "re": __import__("re"), "warnings": __import__("warnings"), "Path": Path,
          "LogisticRegression": __import__("sklearn.linear_model", fromlist=["x"]).LogisticRegression,
          "CALIBRATE": True, "CHECKED_CLIPS_DIR": out / "clips", "CLIPS_DIR": out / "clips", "OUTPUT_DIR": nb_out,
          "TARGET_PROBABILITY": 0.95, "MIN_CLIPS": 8, "THRESHOLD": 0.1, "COLUMNS": COLUMNS,
          "detections": det, "to_perch": lambda name: name.replace("_", " "), "walk_files": walk_files,
          "AUDIO_EXTS": AUDIO_EXTS, "save_table": save_table, "load_table": lambda p: pd.read_csv(p, sep=sep, decimal="," if sep == ";" else "."),
          "display": lambda *a: None,
          "plt": FakePlt(), "tidy": lambda ax: None, "INK": "k", "INK_2": "k", "BLUE": "b", "ORANGE": "o"}
    for cell in notebook_cells("## 9"):
        exec(cell, ns)                                                                    # noqa: S102
    sorted_clips = sorted(p.relative_to(out).as_posix() for p in (out / "clips").rglob("*.wav"))
    result = json.loads(Results(out).calibrate(0.95, 8, sorted_clips))
    assert len(result["thresholds"]) == 3
    for name in ["thresholds/thresholds.csv", "thresholds/precision_by_band.csv", "detections_species_thresholds.csv"]:
        assert (out / name).read_bytes() == (nb_out / name).read_bytes(), name


def test_page_verdicts_give_the_same_thresholds_as_sorted_clips(tmp_path):
    out, det, index = synthetic_output(tmp_path)
    by_folders = json.loads(Results(out).calibrate(0.95, 8, sorted(
        p.relative_to(out).as_posix() for p in (out / "clips").rglob("*.wav"))))
    res = Results(out)
    for c in index.itertuples():
        res.set_verdict(c.file, c.start_s, c.species, "correct" if c.ok else "incorrect")
    by_page = json.loads(res.calibrate(0.95, 8, []))
    a, b = pd.DataFrame(by_folders["thresholds"]), pd.DataFrame(by_page["thresholds"])
    assert list(a["species"]) == list(b["species"]) and list(a["clips"]) == list(b["clips"])
    assert np.allclose(a["threshold"].astype(float), b["threshold"].astype(float), equal_nan=True, rtol=1e-6)
    both = json.loads(res.calibrate(0.95, 8, sorted(                                  # checked both ways: counted once
        p.relative_to(out).as_posix() for p in (out / "clips").rglob("*.wav"))))
    assert [t["clips"] for t in both["thresholds"]] == list(b["clips"])


# ── §8 ────────────────────────────────────────────────────────────────────────────────────────────────────
def references(project):
    ref, other = project / "reference", project / "birdnet"
    (ref / "A").mkdir(parents=True)
    other.mkdir()
    (ref / "A" / "rec1_labels.txt").write_text("0.5\t3.0\tTurdus merula\n6.0\t9.0\tParus major\n7.0\t8.0\tNoise\n")
    (ref / "B_rec3.Table.1.selections.txt").write_text(
        "Selection\tView\tChannel\tBegin Time (s)\tEnd Time (s)\tSpecies\n"
        "1\tSpectrogram 1\t1\t1.0\t4.0\tErithacus rubecula\n1\tWaveform 1\t1\t1.0\t4.0\tErithacus rubecula\n")
    (ref / "rec3.txt").write_text("Selection\tBegin Time (s)\tEnd Time (s)\tSpecies\n"
                                  "1\t2.0\t5.0\tErithacus rubecula\n2\t5.5\t9.0\tBlackbird\n")
    (other / "rec1.BirdNET.results.csv").write_text(
        "Start (s),End (s),Scientific name,Common name,Confidence\n0.0,3.0,Turdus merula,Blackbird,0.81\n"
        "3.0,6.0,Human vocal,Human vocal,0.6\n")
    return ref, other


@needs_notebook
@pytest.mark.parametrize("count_unmatched", [True, False])
def test_comparison_equals_the_notebooks(project, count_unmatched):
    run, _ = finished_run(project, csv_separator=";")
    ref, other = references(project)
    compare(run, ref, other, "BirdNET", count_unmatched)
    nb_out = project / "nb"
    from apus.names import label_words
    from sklearn.metrics import auc
    ns = {"np": np, "pd": pd, "Path": Path, "COMPARE": True, "REFERENCE_DIR": ref, "OTHER_MODEL_DIR": other,
          "OTHER_MODEL_NAME": "BirdNET", "COUNT_UNMATCHED_AS_MISSED": count_unmatched, "OUTPUT_DIR": nb_out,
          "THRESHOLD": run.s["threshold"], "TOP_K": run.s["top_k"], "predictions": run.predictions,
          "listed": run.listed, "recordings": run.recordings, "match_recording": run.match_recording,
          "to_perch": run.names.to_perch, "label_words": label_words, "walk_files": walk_files,
          "save_table": run.save_table, "safe_name": safe_name, "auc": auc, "display": lambda *a: None,
          "plt": FakePlt(), "tidy": lambda ax: None, "INK": "k", "INK_2": "k", "BLUE": "b", "ORANGE": "o",
          "AQUA": "a", "print": lambda *a, **k: None}
    for cell in notebook_cells("## 8"):
        exec(cell, ns)                                                                    # noqa: S102
    mine = sorted(p.relative_to(run.output_dir / "comparison").as_posix() for p in (run.output_dir / "comparison").rglob("*.csv"))
    theirs = sorted(p.relative_to(nb_out / "comparison").as_posix() for p in (nb_out / "comparison").rglob("*.csv"))
    assert mine == theirs and len(mine) == 9
    for name in mine:
        assert (run.output_dir / "comparison" / name).read_bytes() == (nb_out / "comparison" / name).read_bytes(), name


def test_comparison_result_for_the_page(project):
    run, _ = finished_run(project)
    ref, _ = references(project)
    page = json.loads(compare(run, ref))
    assert {r["level"] for r in page["summary"]} == {"vocalization", "dataset"}
    assert set(page["curves"]) == {"Perch"} and page["curves"]["Perch"]
    with pytest.raises(Exception, match="No recording has both"):
        empty = project / "empty_ref"
        empty.mkdir()
        (empty / "nothing.txt").write_text("0\t1\tTurdus merula\n")
        compare(run, empty)


def test_one_table_for_all_recordings(project):
    """One results table for every recording, with a column naming each one's file (BirdNET's combined CSV),
    is matched row by row, also with Windows paths."""
    run, _ = finished_run(project)
    ref, _ = references(project)
    combined = project / "combined"
    combined.mkdir()
    (combined / "BirdNET_CombinedTable.csv").write_text(
        "Start (s),End (s),Scientific name,Common name,Confidence,File\n"
        "0.0,3.0,Turdus merula,Blackbird,0.81,C:\\data\\A\\rec1.wav\n"
        "0.0,3.0,Erithacus rubecula,Robin,0.7,/data/B/rec3.wav\n")
    page = json.loads(compare(run, ref, combined, "BirdNET"))
    assert "BirdNET: 2 event(s) in 2 recording(s) from combined" in page["messages"]


# ── Times from file names ─────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("name, expected", [
    ("20211027_072000.WAV", datetime(2021, 10, 27, 7, 20)),
    ("ARD/ARD_20211027_072000.wav", datetime(2021, 10, 27, 7, 20)),
    ("S4A1234_20230501_235959.flac", datetime(2023, 5, 1, 23, 59, 59)),
    ("site-2021-10-27_07-20-00.wav", datetime(2021, 10, 27, 7, 20)),
    ("20211027T072000.wav", datetime(2021, 10, 27, 7, 20)),
    ("rec_20211345_072000.wav", None),          # month 13: not a date
    ("rec1.wav", None),
    ("1234567890123456.wav", None),             # digits, but no date and time in them
])
def test_file_time(name, expected):
    assert file_time(name) == expected


def times_project(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    pred = pd.DataFrame({"file": ["A/S_20211027_233000.wav"] * 4 + ["A/S_20211028_010000.wav"] * 2 + ["A/x.wav"],
                         "start_s": [0.0, 5.0, 1795.0, 1800.0, 0.0, 5.0, 0.0], "species": "Turdus merula",
                         "confidence": 0.5, "rank": 1, "end_s": 0.0})
    pred.to_csv(out / "predictions.csv", index=False)
    det = pred.iloc[[0, 3, 4, 6]].assign(dataset="A")[COLUMNS]
    det.to_csv(out / "detections.csv", index=False)
    (out / "run_settings.json").write_text(json.dumps({"threshold": 0.1, "csv_separator": ","}))
    return out


def test_times_from_utc_names_with_an_offset(tmp_path):
    out = times_project(tmp_path)
    got = json.loads(Results(out).times(True, 90, 5.0))                 # names in UTC, local time UTC+01:30
    assert got["unparsed"] == ["A/x.wav"] and got["offset"] == "+01:30"
    t = pd.read_csv(out / "detection_times.csv")
    assert list(t["utc_time"]) == ["2021-10-27T23:30:00.000Z", "2021-10-28T00:00:00.000Z", "2021-10-28T01:00:00.000Z"]
    assert list(t["local_time"]) == ["2021-10-28T01:00:00.000+01:30", "2021-10-28T01:30:00.000+01:30",
                                     "2021-10-28T02:30:00.000+01:30"]
    # effort by local hour: 1 holds the first file's 4 windows (01:00:00 to 01:30:00), 2 the second file's 2
    assert got["hour"]["effort_hours"] == {"1": 4 * 5 / 3600, "2": 2 * 5 / 3600}
    assert {(d["key"], d["detections"]) for d in got["hour"]["detections"]} == {("1", 2), ("2", 1)}
    assert set(got["date"]["effort_hours"]) == {"2021-10-28"}


def test_times_from_local_names(tmp_path):
    out = times_project(tmp_path)
    json.loads(Results(out).times(False, -300, 5.0))                     # names in local time, UTC-05:00
    t = pd.read_csv(out / "detection_times.csv")
    assert t["utc_time"].iloc[0] == "2021-10-28T04:30:00.000Z"
    assert t["local_time"].iloc[0] == "2021-10-27T23:30:00.000-05:00"


# ── The recordings check ──────────────────────────────────────────────────────────────────────────────────
def test_inspect(tmp_path):
    tone(tmp_path / "a.wav", 48000, 12.0, channels=2)
    sf.write(tmp_path / "b.ogg", np.zeros(22050 * 3, np.float32), 22050, format="OGG", subtype="VORBIS")
    a = inspect(tmp_path / "a.wav", 160000)
    assert (a["sr"], a["channels"], a["lossy"], round(a["seconds"], 3)) == (48000, 2, False, 12.0)
    assert a["windows"] == Recording(tmp_path / "a.wav").window_count(160000)
    b = inspect(tmp_path / "b.ogg", 80000)
    assert b["lossy"] and b["windows"] == 1


def test_spectrogram():
    t = np.arange(32000 * 2) / 32000
    data, w, h = spectrogram(np.sin(2 * np.pi * 4000 * t).astype(np.float32))
    image = np.frombuffer(data, np.uint8).reshape(h, w)
    assert h == 256 and image.max() == 255
    assert abs(image.mean(axis=1).argmax() - 64) <= 1                    # 4 kHz: bin 64 of 256 over 0-16 kHz


def test_check_recordings(project):
    from apus.project import check_recordings
    got = json.loads(check_recordings(project / "recordings", 5.0))
    assert got["files"] == 4 and got["unreadable"] == [["B/empty.wav", "the file is empty"]]
    assert got["rates"] == {"48000": 1, "22050": 1, "32000": 1}
    assert got["low_rate"] == [["A/rec2.wav", 22050]] and got["short"] == [["A/rec2.wav", 3.0]]
    assert round(got["seconds"], 3) == 26.0 and got["windows"] == 2 + 1 + 2
