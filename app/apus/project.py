"""A run of Perch over a folder of recordings: the notebook's §2–§7, as one object that the browser app
(or a test) drives one recording at a time. The output files are the notebook's, in the same formats."""
import json
import os
import random
import re
from pathlib import Path

import numpy as np
import pandas as pd
import soundfile as sf

from .audio import RESAMPLER, SAMPLE_RATE, TARGET_PEAK, WINDOW_S, Recording, load_clip, peak_normalize
from .names import Names, read_species_list

AUDIO_EXTS = {".wav", ".flac", ".ogg", ".mp3", ".m4a", ".aif", ".aiff"}
DEFAULTS = {"hop_s": 5.0, "top_k": 10, "threshold": 0.10, "resume": True, "species_list": None,
            "synonyms_file": None, "raven_tables": False, "csv_separator": ",", "extract_clips": False,
            "clip_species": None, "clip_extra_s": 1.0, "clips_per_band": 10}
COLUMNS = ["dataset", "file", "start_s", "end_s", "species", "confidence", "rank"]


class ApusError(Exception):
    """A problem the user has to fix, with a message that says how."""


def walk_files(root, extensions):
    """Every file under root with one of these extensions (linked folders included)."""
    found = []
    for folder, _, names in os.walk(root, followlinks=True):
        found += [Path(folder) / n for n in names if Path(n).suffix.lower() in extensions]
    return sorted(found)


def safe_name(text):
    """A name that is safe as a file or folder name: 'Turdus merula' -> 'Turdus_merula'."""
    return re.sub(r"[^\w.-]+", "_", str(text)).strip("_") or "unknown"


def softmax(logits):
    """Probabilities from Perch's scores, in float32 like tf.nn.softmax."""
    z = np.asarray(logits, dtype=np.float32)
    e = np.exp(z - z.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)


class Run:
    """Settings use the notebook's §1 names in lower case (hop_s, top_k, threshold, ...; see DEFAULTS).
    `model` identifies the model file; it must match for a run to resume. `provenance` (app version,
    backend) is recorded in run_settings.json but does not block resuming."""

    def __init__(self, input_dir, output_dir, settings, class_names, class_codes, model, provenance=None):
        s = {**DEFAULTS, **(settings or {})}
        # the notebook's types: from JavaScript, 5.0 arrives as int 5 and would print start_s as "5", not "5.0"
        for key, kind in [("hop_s", float), ("threshold", float), ("clip_extra_s", float), ("top_k", int),
                          ("clips_per_band", int)]:
            s[key] = kind(s[key])
        self.s, self.messages = s, []
        self.input_dir, self.output_dir = Path(input_dir), Path(output_dir)
        self.class_names = list(class_names)
        self.hop = int(s["hop_s"] * SAMPLE_RATE)
        self.decimal = "," if s["csv_separator"] == ";" else "."

        # §2: the settings
        if not 0 < s["threshold"] < 1:
            raise ApusError("The threshold must be between 0 and 1.")
        if s["hop_s"] <= 0:
            raise ApusError("The hop must be above 0 s.")
        if s["top_k"] < int(1 / s["threshold"] + 1e-9):   # at most 1/threshold species can reach it in one window
            raise ApusError(f"A threshold of {s['threshold']} needs at least {int(1 / s['threshold'] + 1e-9)} "
                            "species kept per window.")
        if s["csv_separator"] not in {",", ";"}:
            raise ApusError('The CSV separator must be "," or ";".')

        # §3: the recordings
        if not self.input_dir.is_dir():
            raise ApusError(f"Folder not found: {self.input_dir.name}")
        found = walk_files(self.input_dir, AUDIO_EXTS)
        missing = [p for p in found if not p.exists()]
        empty = [p for p in found if p.exists() and p.stat().st_size == 0]
        audio_files = [p for p in found if p.exists() and p.stat().st_size > 0]
        if not audio_files:
            raise ApusError(f"No audio files in {self.input_dir.name}")
        rec = pd.DataFrame({"file": [p.relative_to(self.input_dir).as_posix() for p in audio_files]})
        rec["dataset"] = [f.split("/")[0] if "/" in f else self.input_dir.name for f in rec["file"]]
        rec["stem"] = [Path(f).stem for f in rec["file"]]
        self.recordings, self.datasets = rec, set(rec["dataset"])
        self.files_by_stem = rec.groupby("stem")["file"].apply(list).to_dict()
        self._matches = {}
        self.messages.append(f"{len(rec)} recording(s) in {len(self.datasets)} dataset(s)")
        if missing:
            self.messages.append(f"⚠ {len(missing)} file(s) point to audio that is not there and are skipped, "
                                 f"e.g. {missing[0].name}")
        if empty:
            self.messages.append(f"⚠ {len(empty)} empty file(s) skipped, e.g. {empty[0].name}")

        # §4: names, lists and synonyms
        self.names = Names(class_names, class_codes, s["synonyms_file"], self.messages)
        self.allowed = self._species_lists(s["species_list"])

        # §5: what is left to analyse
        self.predictions_csv = self.output_dir / "predictions.csv"
        settings_json = self.output_dir / "run_settings.json"
        run_settings = {"model": model, "sample_rate": SAMPLE_RATE, "window_s": WINDOW_S, "hop_s": s["hop_s"],
                        "top_k": s["top_k"], "resampler": RESAMPLER, "target_peak": TARGET_PEAK}
        self.output_dir.mkdir(parents=True, exist_ok=True)
        done, backends = set(), []
        if self.predictions_csv.exists():
            previous = json.loads(settings_json.read_text()) if settings_json.exists() else {}
            if not s["resume"]:
                self.predictions_csv.unlink()
            elif any(previous.get(k) != v for k, v in run_settings.items()):
                raise ApusError("This output folder holds results made with other settings. Turn off "
                                "'Continue a stopped run' to start again, or choose another output folder.")
            else:
                done = set(pd.read_csv(self.predictions_csv, usecols=["file"])["file"])
                backends = previous.get("backends", [])
        provenance = dict(provenance or {})
        backend = provenance.pop("backend", None)
        if backend and backend not in backends:
            backends = backends + [backend]
        settings_json.write_text(json.dumps({**run_settings, **provenance, "backends": backends}, indent=2))
        self.todo = [f for f in rec["file"] if f not in done]
        self.messages.append(f"{len(done & set(rec['file']))} recording(s) already analysed, {len(self.todo)} to go.")
        self.failed, self.n_windows, self._rows = [], 0, []

    def match_recording(self, name, folder="."):
        """The recording a file name refers to (a recording in the same sub-folder wins), or None."""
        key = (Path(str(name)).name, folder)
        if key not in self._matches:
            name = key[0]
            cuts = sorted({len(name)} | {i for i, ch in enumerate(name) if ch in "._- "}, reverse=True)
            self._matches[key] = None
            for cut in cuts:
                files = self.files_by_stem.get(name[:cut])
                if files:
                    same_folder = [f for f in files if Path(f).parent.as_posix() == folder]
                    self._matches[key] = (same_folder or files)[0]
                    break
        return self._matches[key]

    def _species_lists(self, species_list):
        """recording -> the Perch names allowed there. Recordings without a list are not filtered."""
        allowed = {}
        if species_list is None:
            self.messages.append("No species list: all of Perch's classes are kept.")
            return allowed
        source = Path(species_list)
        if not source.exists():
            raise ApusError(f"Species list not found: {source.name}")
        list_files = [source] if source.is_file() else walk_files(source, {".txt", ".csv"})
        by_recording, by_dataset, unused, unknown = {}, {}, [], set()
        to_perch = self.names.to_perch
        for path in list_files:
            names = read_species_list(path)
            ok = {to_perch(n) for n in names} - {None}
            unknown |= {n for n in names if to_perch(n) is None}
            if source.is_file():
                by_dataset = {d: ok for d in self.datasets}
                continue
            rec = self.match_recording(path.name, path.parent.relative_to(source).as_posix())
            if rec is not None:
                by_recording[rec] = by_recording.get(rec, set()) | ok
            elif path.stem in self.datasets:
                by_dataset[path.stem] = by_dataset.get(path.stem, set()) | ok
            else:
                unused.append(path.name)
        for f, d in zip(self.recordings["file"], self.recordings["dataset"]):
            if f in by_recording or d in by_dataset:
                allowed[f] = by_recording.get(f, by_dataset.get(d))
        n = len(self.recordings)
        self.messages.append(f"Species lists: {len(list_files)} file(s); {len(allowed)} of {n} recording(s) "
                             "will be filtered.")
        if len(allowed) < n:
            self.messages.append(f"  {n - len(allowed)} recording(s) have no list and will NOT be filtered.")
        if unused:
            self.messages.append(f"  ⚠ {len(unused)} list file(s) match no recording or dataset, e.g. {unused[0]}")
        if unknown:
            self.messages.append(f"  {len(unknown)} listed name(s) match no Perch class (add them to the synonyms "
                                 "file if they are birds): " + ", ".join(sorted(unknown)[:5])
                                 + (" ..." if len(unknown) > 5 else ""))
        return allowed

    # §5, one recording at a time: open() -> frames() for each batch -> add() -> end_file()
    def open(self, file):
        """The recording, ready to be cut into windows. Raises if it cannot be read."""
        recording = Recording(self.input_dir / file)
        recording.n_windows = recording.window_count(self.hop)
        return recording

    def frames(self, recording, w0, w1):
        """Perch's input for windows [w0, w1): float32 [w1 - w0, 160000]."""
        return peak_normalize(recording.windows(w0, w1, self.hop))

    def add(self, file, w0, logits):
        """Keep the top_k species of each window, from the model's scores for windows w0, w0 + 1, ..."""
        probs = softmax(np.asarray(logits, dtype=np.float32).reshape(-1, len(self.class_names)))
        for w, prob in enumerate(probs, start=w0):
            start = round(w * self.s["hop_s"], 3)
            for rank, idx in enumerate(np.argsort(prob)[::-1][:self.s["top_k"]], start=1):
                self._rows.append((file, start, round(start + WINDOW_S, 3), rank, self.class_names[idx],
                                   float(prob[idx])))

    def end_file(self, file):
        """Append the recording's predictions to predictions.csv; returns the text appended."""
        table = pd.DataFrame(self._rows, columns=["file", "start_s", "end_s", "rank", "species", "confidence"])
        self._rows = []
        text = table.to_csv(index=False, header=not self.predictions_csv.exists())
        with open(self.predictions_csv, "a", encoding="utf-8", newline="") as out:
            out.write(text)
        self.n_windows += table["start_s"].nunique()
        return text

    def fail(self, file, error):
        """A recording that could not be read is listed and skipped, as in the notebook."""
        self._rows = []
        self.failed.append({"file": file, "error": str(error)})

    def save_table(self, df, path):
        """Write a table with the CSV format chosen in the settings."""
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(path, index=False, sep=self.s["csv_separator"], decimal=self.decimal)
        return path

    # §6
    def finish(self):
        """Detections, summaries, Raven tables and summary.txt. Returns what the app shows, as JSON."""
        s, out = self.s, self.output_dir
        if self.failed:
            self.save_table(pd.DataFrame(self.failed), out / "failed_recordings.csv")
        if not self.predictions_csv.exists():
            raise ApusError("No recording could be analysed.")
        predictions = pd.read_csv(self.predictions_csv)
        predictions = predictions.merge(self.recordings[["file", "dataset"]], on="file")   # only recordings still here

        on_list = np.array([self.allowed.get(f) is None or sp in self.allowed[f]
                            for f, sp in zip(predictions["file"], predictions["species"])], dtype=bool)
        listed = predictions[on_list]
        detections = (listed[listed["confidence"] >= s["threshold"]]
                      .sort_values(["file", "start_s", "confidence"], ascending=[True, True, False]))
        removed = predictions[~on_list & (predictions["confidence"] >= s["threshold"])]
        self.detections = detections
        self.save_table(detections[COLUMNS], out / "detections.csv")
        if s["species_list"] is not None:
            self.save_table(removed[COLUMNS], out / "removed_by_species_list.csv")

        species_summary = (detections.groupby("species")
                           .agg(detections=("confidence", "size"), recordings=("file", "nunique"),
                                datasets=("dataset", "nunique"), mean_confidence=("confidence", "mean"),
                                max_confidence=("confidence", "max"))
                           .sort_values("detections", ascending=False).reset_index())
        dataset_summary = (pd.concat([predictions.groupby("dataset")["file"].nunique().rename("recordings_analysed"),
                                      detections.groupby("dataset").agg(recordings_with_detections=("file", "nunique"),
                                                                        detections=("species", "size"),
                                                                        species=("species", "nunique"))], axis=1)
                           .fillna(0).astype(int).rename_axis("dataset").reset_index())
        self.save_table(species_summary, out / "species_summary.csv")
        self.save_table(dataset_summary, out / "dataset_summary.csv")

        if s["raven_tables"]:
            for f, group in detections.groupby("file"):
                raven = pd.DataFrame({"Selection": range(1, len(group) + 1), "View": "Spectrogram 1", "Channel": 1,
                                      "Begin Time (s)": group["start_s"].to_numpy(),
                                      "End Time (s)": group["end_s"].to_numpy(),
                                      "Low Freq (Hz)": 0, "High Freq (Hz)": SAMPLE_RATE // 2,
                                      "Species": group["species"].to_numpy(),
                                      "Confidence": group["confidence"].round(4).to_numpy()})
                path = out / "raven" / f"{Path(f).with_suffix('')}.Perch.selection.table.txt"
                path.parent.mkdir(parents=True, exist_ok=True)
                raven.to_csv(path, sep="\t", index=False)

        n_recordings = predictions["file"].nunique()
        lines = [f"Perch 2.0 — {n_recordings} recording(s) in {predictions['dataset'].nunique()} dataset(s): "
                 f"{predictions.groupby('file')['start_s'].nunique().sum()} windows of {WINDOW_S:g} s every "
                 f"{s['hop_s']:g} s.",
                 f"Threshold {s['threshold']:g}: {len(detections)} detection(s) of "
                 f"{detections['species'].nunique()} species in {detections['file'].nunique()} recording(s)."]
        if s["species_list"] is not None:
            lines.append(f"Species list: removed {len(removed)} detection(s) of {removed['species'].nunique()} "
                         f"species; {sum(f not in self.allowed for f in predictions['file'].unique())} "
                         "recording(s) had no list.")
        (out / "summary.txt").write_text("\n".join(lines) + "\n\nDetections per species\n"
                                         + species_summary.to_string(index=False), encoding="utf-8")
        return json.dumps({"lines": lines, "messages": self.messages, "failed": self.failed,
                           "species": json.loads(species_summary.to_json(orient="records")),
                           "datasets": json.loads(dataset_summary.to_json(orient="records"))})

    # §7
    def clips(self, existing=None):
        """Cut clips of the detections, up to clips_per_band per species and 0.1-wide confidence band, drawn
        at random (always the same ones). Yields each file written (relative to the output folder), then
        clips/clips.csv. `existing` holds 'species_folder/clip.wav' names already in the output folder
        (sorted or not); None looks in the output folder itself."""
        s, clips_dir = self.s, self.output_dir / "clips"
        pool = self.detections.copy()
        if s["clip_species"]:
            asked = [s["clip_species"]] if isinstance(s["clip_species"], str) else list(s["clip_species"])
            for name in asked:
                if self.names.to_perch(name) is None:
                    self.messages.append(f"⚠ Clip species: '{name}' is not a Perch class")
            pool = pool[pool["species"].isin({self.names.to_perch(name) for name in asked})]
        pool["band"] = np.minimum((pool["confidence"] * 10).astype(int), 9)   # 0.0-0.1 -> 0, ..., 0.9-1.0 -> 9
        rng = random.Random(0)
        chosen = []
        for _, group in pool.groupby(["species", "band"]):
            rows = list(group.index)
            chosen += rng.sample(rows, s["clips_per_band"]) if len(rows) > s["clips_per_band"] else rows

        index = []
        for i in chosen:
            d = pool.loc[i]
            folder = clips_dir / safe_name(d["species"])
            name = f"{Path(d['file']).stem}_{safe_name(d['species'])}_{d['confidence']:.3f}_{d['start_s']:g}s.wav"
            index.append({"clip": name, "species": d["species"], "dataset": d["dataset"], "file": d["file"],
                          "start_s": d["start_s"], "end_s": d["end_s"], "confidence": d["confidence"]})
            there = (f"{folder.name}/{name}" in existing) if existing is not None else \
                (folder.is_dir() and any(p.name == name for p in folder.rglob("*.wav")))
            if there:                                              # already there, maybe sorted by the user
                continue
            start = max(0.0, d["start_s"] - s["clip_extra_s"])
            audio = load_clip(self.input_dir / d["file"], start, WINDOW_S + 2 * s["clip_extra_s"])
            folder.mkdir(parents=True, exist_ok=True)
            sf.write(folder / name, audio, SAMPLE_RATE)
            yield f"clips/{folder.name}/{name}"
        clips = pd.DataFrame(index, columns=["clip", "species", "dataset", "file", "start_s", "end_s", "confidence"])
        self.save_table(clips, clips_dir / "clips.csv")
        self.messages.append(f"{len(clips)} clip(s) of {clips['species'].nunique()} species")
        yield "clips/clips.csv"
