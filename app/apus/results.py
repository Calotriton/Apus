"""What Apus does with a finished run's files, without Perch: reopen them, check detections, fit a threshold
per species (the notebook's §9) and read times from file names. Everything reads and writes the output
folder, so it also works in a later session."""
import json
import re
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from .project import COLUMNS, safe_name, sample_per_band

KEY = ["file", "start_s", "species"]
CHECK_COLUMNS = ["dataset", "file", "start_s", "end_s", "species", "confidence", "verdict", "checked_at"]
VERDICTS = {"correct", "incorrect", "unsure"}
CORRECT = {"correct", "yes", "true", "tp", "present", "1"}            # §9's names for sorted clip folders
INCORRECT = {"incorrect", "no", "false", "fp", "absent", "0"}


def records(df):
    """A table as JSON-safe rows (NaN becomes null)."""
    return json.loads(df.to_json(orient="records"))


def read_table(path):
    """One of the run's tables, whichever CSV format it was written in: ',' or ';' with a decimal comma."""
    with open(path, encoding="utf-8") as f:
        head = f.readline()
    sep = ";" if head.count(";") > head.count(",") else ","
    return pd.read_csv(path, sep=sep, decimal="," if sep == ";" else "."), sep


def logit(conf):
    conf = np.clip(np.asarray(conf, dtype=float), 1e-6, 1 - 1e-6)
    return np.log(conf / (1 - conf))


def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -700, 700)))


def fit_threshold(conf, correct, target, min_clips):
    """The notebook's §9: P(correct) = sigmoid(b0 + b1 * logit(confidence)), solved for the target probability
    (Wood & Kahl 2024). Unchanged but for the target and minimum, which are arguments here."""
    from sklearn.linear_model import LogisticRegression          # loaded only when thresholds are fitted
    conf, correct = np.asarray(conf, dtype=float), np.asarray(correct, dtype=bool)
    out = {"clips": len(conf), "correct": int(correct.sum()), "incorrect": int((~correct).sum()),
           "threshold": np.nan, "correct_clips_kept": "", "b0": np.nan, "b1": np.nan, "note": ""}
    if len(conf) < min_clips:
        return {**out, "note": f"only {len(conf)} clip(s) (MIN_CLIPS = {min_clips})"}
    if correct.all() or not correct.any():
        return {**out, "note": "all clips are " + ("correct" if correct.all() else "incorrect") + ": no fit"}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fit = LogisticRegression(C=np.inf, max_iter=1000).fit(logit(conf).reshape(-1, 1), correct.astype(int))
    b0, b1 = float(fit.intercept_[0]), float(fit.coef_[0][0])
    if b1 <= 0:
        return {**out, "b0": b0, "b1": b1, "note": "higher confidence is not more often correct (slope ≤ 0)"}
    threshold = float(sigmoid((np.log(target / (1 - target)) - b0) / b1))
    notes = []
    if conf[correct].min() >= conf[~correct].max():
        notes.append("correct and incorrect clips do not overlap: the threshold only marks the gap between them")
    if not conf.min() <= threshold <= conf.max():
        notes.append("threshold outside the confidences you checked (extrapolated)")
    return {**out, "threshold": threshold, "b0": b0, "b1": b1, "note": "; ".join(notes),
            "correct_clips_kept": f"{int((conf[correct] >= threshold).sum())}/{int(correct.sum())}"}


# ── Times from file names ─────────────────────────────────────────────────────────────────────────────────
# 20211027_072000 (AudioMoth), SITE_20211027_072000 (Song Meter), 2021-10-27_07-20-00, 20211027T072000
STAMP = re.compile(r"(?<!\d)(\d{4})-?(\d{2})-?(\d{2})[_T\- ]?(\d{2})[-:]?(\d{2})[-:]?(\d{2})(?!\d)")


def file_time(name):
    """The date and time written in a recording's file name, or None."""
    for m in STAMP.finditer(Path(str(name)).stem):
        try:
            return datetime(*map(int, m.groups()))
        except ValueError:                                             # not a real date, e.g. 20211345
            continue
    return None


def offset_text(minutes):
    sign = "+" if minutes >= 0 else "-"
    return f"{sign}{abs(minutes) // 60:02d}:{abs(minutes) % 60:02d}"


class Results:
    """A finished run, from the files in its output folder."""

    def __init__(self, out_dir):
        self.out = Path(out_dir)
        settings_json = self.out / "run_settings.json"
        self.settings = json.loads(settings_json.read_text()) if settings_json.exists() else {}
        self.detections, sep = read_table(self.out / "detections.csv")
        self.sep = self.settings.get("csv_separator", sep)
        self.threshold = self.settings.get("threshold")
        if self.threshold is None:                                     # a run from before Apus recorded it
            m = re.search(r"^Threshold ([\d.]+):", self._summary_text(), re.M)
            self.threshold = float(m.group(1)) if m else float(self.detections["confidence"].min())
        checks = self.out / "checked_detections.csv"
        self.checks = read_table(checks)[0] if checks.exists() else pd.DataFrame(columns=CHECK_COLUMNS)
        self._samples = {}

    def _summary_text(self):
        path = self.out / "summary.txt"
        return path.read_text(encoding="utf-8") if path.exists() else ""

    def save_table(self, df, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(path, index=False, sep=self.sep, decimal="," if self.sep == ";" else ".")
        return path

    # ── Reopening ─────────────────────────────────────────────────────────────────────────────────────────
    def summary(self):
        """What finish() returns, read back from the files."""
        lines = self._summary_text().split("\n\n")[0].splitlines()
        failed = self.out / "failed_recordings.csv"
        return json.dumps({"lines": lines, "messages": [], "threshold": self.threshold, "settings": self.settings,
                           "failed": records(read_table(failed)[0]) if failed.exists() else [],
                           "species": records(read_table(self.out / "species_summary.csv")[0]),
                           "datasets": records(read_table(self.out / "dataset_summary.csv")[0])})

    # ── Checking detections ───────────────────────────────────────────────────────────────────────────────
    def _verdicts(self, rows):
        """The verdict of each row ('' if not checked)."""
        if self.checks.empty:
            return pd.Series("", index=rows.index)
        checked = self.checks.drop_duplicates(KEY, keep="last").set_index(KEY)["verdict"]
        keys = pd.MultiIndex.from_frame(rows[KEY])
        return pd.Series(checked.reindex(keys).fillna("").to_numpy(), index=rows.index)

    def sample(self, per_band):
        """The detections offered for checking: the §7 sample per species and confidence band."""
        if per_band not in self._samples:
            self._samples[per_band] = set(sample_per_band(self.detections, per_band))
        return self._samples[per_band]

    def checked_counts(self):
        """Per species: detections, and how many are checked as correct, incorrect or unsure."""
        counts = self.detections.groupby("species").size().rename("detections").to_frame()
        if not self.checks.empty:
            latest = self.checks.drop_duplicates(KEY, keep="last")
            counts = counts.join(pd.crosstab(latest["species"], latest["verdict"]), how="left")
        for v in sorted(VERDICTS):
            counts[v] = counts[v].fillna(0).astype(int) if v in counts else 0
        return json.dumps(records(counts.sort_values("detections", ascending=False).reset_index()))

    def species(self, name, per_band):
        """One species: a histogram of its detections' confidences, the share correct per 0.1 band, and the
        detections to check (the sample first, highest confidence first within it)."""
        d = self.detections[self.detections["species"] == name].copy()
        d["band"] = np.minimum((d["confidence"] * 10).astype(int), 9)
        d["verdict"] = self._verdicts(d)
        d["in_sample"] = d.index.isin(self.sample(per_band))
        histogram = np.histogram(d["confidence"], bins=20, range=(0, 1))[0]
        bands = []
        for b, g in d.groupby("band"):
            correct, incorrect = int((g["verdict"] == "correct").sum()), int((g["verdict"] == "incorrect").sum())
            bands.append({"band": f"{b / 10:.1f}–{(b + 1) / 10:.1f}", "detections": len(g), "correct": correct,
                          "incorrect": incorrect, "unsure": int((g["verdict"] == "unsure").sum()),
                          "share_correct": correct / (correct + incorrect) if correct + incorrect else None})
        d = d.sort_values(["in_sample", "confidence"], ascending=[False, False])
        rows = d[["dataset", "file", "start_s", "end_s", "species", "confidence", "verdict", "in_sample"]]
        return json.dumps({"species": name, "threshold": self.threshold, "histogram": histogram.tolist(),
                           "bands": bands, "rows": records(rows)})

    def set_verdict(self, file, start_s, species, verdict):
        """Record (or with verdict '' remove) a verdict, and rewrite checked_detections.csv."""
        if verdict and verdict not in VERDICTS:
            raise ValueError(f"unknown verdict {verdict}")
        start_s = float(start_s)
        mine = (self.checks["file"] == file) & (self.checks["start_s"].astype(float) == start_s) & \
               (self.checks["species"] == species)
        self.checks = self.checks[~mine]
        if verdict:
            d = self.detections
            row = d[(d["file"] == file) & (d["start_s"] == start_s) & (d["species"] == species)].iloc[0]
            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            new = pd.DataFrame([{**{c: row[c] for c in CHECK_COLUMNS[:6]}, "verdict": verdict, "checked_at": now}])
            self.checks = new if self.checks.empty else pd.concat([self.checks, new], ignore_index=True)
        self.save_table(self.checks[CHECK_COLUMNS], self.out / "checked_detections.csv")
        return "checked_detections.csv"

    # ── §9: a threshold per species ───────────────────────────────────────────────────────────────────────
    def calibrate(self, target, min_clips, sorted_clips=()):
        """The notebook's §9 on the verdicts given in the page, plus any clips sorted into
        clips/<species>/correct/ and incorrect/ folders as the notebook asks (`sorted_clips`: their paths,
        relative to the output folder). A detection checked both ways counts once, with the page's verdict.
        Returns what the page shows; writes the notebook's three files."""
        rows = []
        verdicts = self.checks.drop_duplicates(KEY, keep="last")
        verdicts = verdicts[verdicts["verdict"].isin(["correct", "incorrect"])]
        for r in verdicts.itertuples(index=False):
            rows.append({"species": r.species, "clip": "", "correct": r.verdict == "correct",
                         "confidence": float(r.confidence), "key": (r.file, float(r.start_s), r.species)})
        done = {row["key"] for row in rows}
        index_csv = self.out / "clips" / "clips.csv"
        index = read_table(index_csv)[0] if index_csv.exists() else pd.DataFrame(columns=["clip"])
        known = {c: r for c, r in zip(index["clip"], index.to_dict("records"))}
        folders = {safe_name(s): s for s in self.detections["species"].unique()}
        for path in sorted_clips:
            parts = Path(path).parts                                    # clips/<species>/<verdict>/.../x.wav
            if len(parts) < 4 or parts[0] != "clips" or parts[2].strip().lower() not in CORRECT | INCORRECT:
                continue
            species = folders.get(parts[1], parts[1].replace("_", " "))
            name = parts[-1]
            if name in known:
                info = known[name]
                key = (info["file"], float(info["start_s"]), info["species"])
                if key in done:
                    continue
                conf = float(info["confidence"])
            else:                                                      # not in clips.csv: read it from the name
                m = re.search(r"_(\d\.\d+)_[\d.]+s$", Path(name).stem)
                conf, key = (float(m.group(1)) if m else np.nan), None
            rows.append({"species": species, "clip": name, "correct": parts[2].strip().lower() in CORRECT,
                         "confidence": conf, "key": key})
        checked = pd.DataFrame(rows, columns=["species", "clip", "correct", "confidence", "key"])
        dropped = int(checked["confidence"].isna().sum())
        checked = checked.dropna(subset=["confidence"])
        if checked.empty:
            return json.dumps({"thresholds": [], "points": [], "dropped": dropped})
        thresholds = pd.DataFrame([{"species": s, **fit_threshold(g["confidence"], g["correct"], target, min_clips)}
                                   for s, g in checked.groupby("species")])
        checked["band"] = np.minimum((checked["confidence"] * 10).astype(int), 9)
        bands = checked.groupby(["species", "band"])["correct"].agg(clips="size", correct="sum").reset_index()
        bands["confidence_band"] = [f"{b / 10:.1f}–{(b + 1) / 10:.1f}" for b in bands["band"]]
        bands["precision"] = bands["correct"] / bands["clips"]
        self.save_table(thresholds, self.out / "thresholds" / "thresholds.csv")
        self.save_table(bands[["species", "confidence_band", "clips", "correct", "precision"]],
                        self.out / "thresholds" / "precision_by_band.csv")
        per_species = dict(zip(thresholds["species"], thresholds["threshold"]))
        used = self.detections["species"].map(per_species).fillna(self.threshold).clip(lower=self.threshold)
        calibrated = self.detections[self.detections["confidence"] >= used].assign(threshold_used=used)
        self.save_table(calibrated[COLUMNS + ["threshold_used"]], self.out / "detections_species_thresholds.csv")
        return json.dumps({"thresholds": records(thresholds), "dropped": dropped, "target": target,
                           "passing": len(calibrated), "detections": len(self.detections),
                           "points": records(checked[["species", "confidence", "correct"]])})

    # ── Times from file names ─────────────────────────────────────────────────────────────────────────────
    def clip_name(self, file, start_s, species):
        """'clips/<species folder>/<clip name>' of a detection's clip from clips/clips.csv, or '' if it has none.
        The clip may since have been sorted into a sub-folder of the species folder."""
        index_csv = self.out / "clips" / "clips.csv"
        if not index_csv.exists():
            return ""
        index = read_table(index_csv)[0]
        hit = index[(index["file"] == file) & (index["start_s"] == float(start_s)) & (index["species"] == species)]
        return f"clips/{safe_name(species)}/{hit['clip'].iloc[0]}" if len(hit) else ""

    def times(self, names_in_utc, offset_minutes, hop_s=None):
        """Each detection's time in UTC and in local time (UTC + offset_minutes), from its recording's file
        name; and activity by local hour and date, per hour of recording (each analysed window adds hop_s
        seconds of effort, the run's hop by default). Writes detection_times.csv."""
        hop_s = float(hop_s or self.settings.get("hop_s", 5.0))
        offset_minutes = int(offset_minutes)
        offset = timedelta(minutes=offset_minutes)
        tz = timezone(offset)
        predictions = pd.read_csv(self.out / "predictions.csv", usecols=["file", "start_s"]).drop_duplicates()
        starts = {f: file_time(f) for f in predictions["file"].unique()}
        unparsed = sorted(f for f, t in starts.items() if t is None)

        def local(files, seconds):
            base = pd.to_datetime(pd.Series([starts.get(f) for f in files], dtype="object"))
            delta = pd.Series(pd.to_timedelta(np.asarray(seconds, dtype=float), unit="s"), index=base.index)
            return base + delta + (offset if names_in_utc else timedelta(0))

        windows = predictions[predictions["file"].map(starts).notna()]
        win_local = local(windows["file"].to_numpy(), windows["start_s"].to_numpy())
        d = self.detections[self.detections["file"].map(starts).notna()].copy()
        d_local = local(d["file"].to_numpy(), d["start_s"].to_numpy())
        d["local_time"] = [t.tz_localize(tz).isoformat(timespec="milliseconds") for t in d_local]
        d["utc_time"] = [(t - offset).isoformat(timespec="milliseconds") + "Z" for t in d_local]
        d["utc_offset"] = offset_text(offset_minutes)
        self.save_table(d[["dataset", "file", "start_s", "end_s", "species", "confidence", "utc_time", "local_time",
                           "utc_offset"]], self.out / "detection_times.csv")
        effort_h = lambda keys: pd.Series(keys).value_counts() * hop_s / 3600           # noqa: E731
        hours, dates = d_local.dt.hour.to_numpy(), d_local.dt.strftime("%Y-%m-%d").to_numpy()
        by = lambda key, effort: {                                                      # noqa: E731
            "effort_hours": {str(k): float(v) for k, v in effort.sort_index().items()},
            "detections": records(pd.DataFrame({"species": d["species"].to_numpy(), "key": key})
                                  .groupby(["species", "key"]).size().rename("detections").reset_index()
                                  .astype({"key": str}))}
        return json.dumps({"hour": by(hours, effort_h(win_local.dt.hour.to_numpy())),
                           "date": by(dates, effort_h(win_local.dt.strftime("%Y-%m-%d").to_numpy())),
                           "unparsed": unparsed, "files": len(starts), "offset": offset_text(offset_minutes),
                           "first": str(win_local.min()) if len(win_local) else None,
                           "last": str(win_local.max()) if len(win_local) else None})
