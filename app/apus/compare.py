"""The notebook's §8: Perch (and optionally another model) scored against a reference, at the vocalization and
dataset levels of Funosas et al. (2026, Ecological Indicators 182:114550). The functions are the notebook's;
what it prints or displays is returned to the page instead."""
import io
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

from .names import label_words
from .project import ApusError, safe_name, walk_files

COLUMN_NAMES = {   # possible column names (lower case) for each role, most specific first
    "start": ["begin time (s)", "start (s)", "start_s", "start", "begin"],
    "end": ["end time (s)", "end (s)", "end_s", "end"],
    "species": ["scientific name", "species", "label", "annotation", "class", "species code", "common name"],
    "confidence": ["confidence", "score"],
    "file": ["file", "begin file", "begin path", "filename", "recording", "path"],
}
# The page's first guess of each column, when the user picks the columns: the notebook's names and more
GUESS = {
    "start": COLUMN_NAMES["start"] + ["start time (s)", "start time", "begin time", "onset", "inicio (s)", "inicio",
                                      "comienzo", "tiempo inicial"],
    "end": COLUMN_NAMES["end"] + ["end time", "offset", "fin (s)", "fin", "final", "tiempo final"],
    "species": COLUMN_NAMES["species"] + ["scientific_name", "taxon", "especie", "especies", "nombre científico",
                                          "etiqueta"],
    "confidence": COLUMN_NAMES["confidence"] + ["probability", "confianza", "probabilidad"],
    "file": COLUMN_NAMES["file"] + ["file name", "audio file", "sound file", "archivo", "fichero", "grabación",
                                    "grabacion"],
}
EXCEL = {".xlsx", ".xlsm", ".xls", ".ods"}
TABLES = {".txt", ".csv", ".tsv"} | EXCEL                   # what the page takes when the user picks the columns
AUDACITY = ["Start (s)", "End (s)", "Label"]                 # the columns of a label file, which has no header
CLOCK = re.compile(r"(?:(\d+) days? )?(\d+):(\d+(?:\.\d*)?)(?::(\d+(?:\.\d*)?))?")   # m:ss, h:mm:ss, Excel times


def is_number(text):
    try:
        float(text)
        return True
    except ValueError:
        return False


def read_events(path):
    """One annotation or results file -> table of start_s, end_s, label, confidence, file_hint (None if not one)."""
    lines = [ln for ln in Path(path).read_text(encoding="utf-8", errors="replace").splitlines() if ln.strip()]
    if not lines:
        return pd.DataFrame(columns=["start_s", "end_s", "label", "confidence", "file_hint"])
    first = lines[0].split("\t")
    if len(first) >= 3 and all(is_number(x) or x.strip().upper() == "NA" for x in first[:2]):   # Audacity labels
        # (times written as NA mean "annotated, nothing to mark": the file counts, with no events)
        rows = [r for r in (ln.split("\t") for ln in lines if not ln.startswith("\\"))
                if len(r) >= 3 and is_number(r[0]) and is_number(r[1])]
        return pd.DataFrame({"start_s": [float(r[0]) for r in rows], "end_s": [float(r[1]) for r in rows],
                             "label": [r[2].strip() for r in rows], "confidence": np.nan, "file_hint": None})
    sep = "\t" if "\t" in lines[0] else (";" if lines[0].count(";") > lines[0].count(",") else ",")
    table = pd.read_csv(path, sep=sep, dtype=str, encoding_errors="replace")
    columns = {c.strip().lower(): c for c in table.columns}
    col = {role: next((columns[n] for n in names if n in columns), None) for role, names in COLUMN_NAMES.items()}
    if not (col["start"] and col["end"] and col["species"]):
        return None
    if "view" in columns and table[columns["view"]].str.startswith("Spectrogram", na=False).any():
        table = table[table[columns["view"]].str.startswith("Spectrogram", na=False)]   # Raven: one row per view

    def number(column):
        values = table[column].str.replace(",", ".") if sep == ";" else table[column]
        return pd.to_numeric(values, errors="coerce")

    events = pd.DataFrame({"start_s": number(col["start"]), "end_s": number(col["end"]),
                           "label": table[col["species"]].str.strip(),
                           "confidence": number(col["confidence"]) if col["confidence"] else np.nan,
                           "file_hint": table[col["file"]] if col["file"] else None})
    return events.dropna(subset=["start_s", "end_s"])


# ── Tables whose columns the user picks in the page (any CSV, text or Excel file) ──────────────────────────
def read_any(path, sheet=None):
    """Any annotation or results table, as text cells -> (table, sheet names). A label file (Audacity), which
    has no header, gets the columns Start (s), End (s) and Label. Excel files need python-calamine."""
    path = Path(path)
    if path.suffix.lower() in EXCEL:
        with pd.ExcelFile(path, engine="calamine") as book:
            sheets = [str(s) for s in book.sheet_names]
            table = pd.read_excel(book, sheet_name=sheet if sheet in sheets else 0, dtype=str)
    else:
        raw = path.read_bytes()
        try:
            text = raw.decode("utf-8-sig")                          # Excel's UTF-8 CSV starts with a BOM
        except UnicodeDecodeError:
            text = raw.decode("cp1252", errors="replace")           # Excel's CSV in Western European languages
        lines = [ln for ln in text.splitlines() if ln.strip()]
        sheets = []
        first = lines[0].split("\t") if lines else []
        if not lines or (len(first) >= 3 and all(is_number(x) or x.strip().upper() == "NA" for x in first[:2])):
            rows = [(r + ["", "", ""])[:3] for r in (ln.split("\t") for ln in lines if not ln.startswith("\\"))]
            table = pd.DataFrame(rows, columns=AUDACITY, dtype=str)
        else:
            sep = "\t" if "\t" in lines[0] else (";" if lines[0].count(";") > lines[0].count(",") else ",")
            table = pd.read_csv(io.StringIO(text), sep=sep, dtype=str)
    table.columns = [str(c).strip() for c in table.columns]
    return table, sheets


def preview(path, sheet=None):
    """What the page shows to pick the columns: the names, the first rows, the sheets and a first guess."""
    table, sheets = read_any(path, sheet)
    lower = {c.lower(): c for c in reversed(table.columns)}              # the first of two equal names wins
    guess = {role: next((lower[n] for n in names if n in lower), None) for role, names in GUESS.items()}
    return json.dumps({"columns": list(table.columns), "rows": table.head(5).fillna("").to_numpy().tolist(),
                       "n_rows": len(table), "sheets": sheets, "sheet": sheet if sheet in sheets else
                       (sheets[0] if sheets else None), "guess": guess})


def seconds(values):
    """Times in seconds from text: 12.5, 12,5, 1:02.5 (minutes) or 0:01:02.5 (hours), as Excel shows them."""
    text = values.astype("string").str.strip()
    plain = pd.to_numeric(text.str.replace(",", ".", regex=False), errors="coerce")

    def clock(t):
        m = CLOCK.fullmatch(t) if isinstance(t, str) else None
        if not m:
            return np.nan
        days, a, b, c = m.groups()
        whole = float(days or 0) * 86400
        return whole + (float(a) * 60 + float(b) if c is None else float(a) * 3600 + float(b) * 60 + float(c))
    return plain.astype(float).fillna(pd.Series([clock(t) for t in text.astype(object)], index=text.index))


def mapped_events(path, columns):
    """One file's events from the columns the user picked (`columns`: start, end, species, and optionally
    confidence, file and sheet) -> table of start_s, end_s, label, confidence, file_hint; None if the file
    lacks one of those columns. Rows without a time or a species are kept: they still say that a recording
    was annotated, and load_events drops them after counting it."""
    table, _ = read_any(path, columns.get("sheet"))
    chosen = {role: columns.get(role) for role in ["start", "end", "species", "confidence", "file"]}
    if any(c and c not in table.columns for c in chosen.values()) or not all(chosen[r] for r in ["start", "end", "species"]):
        return None
    if "View" in table.columns and table["View"].str.startswith("Spectrogram", na=False).any():
        table = table[table["View"].str.startswith("Spectrogram", na=False)]   # Raven: one row per view
    label = table[chosen["species"]].str.strip()
    return pd.DataFrame({"start_s": seconds(table[chosen["start"]]), "end_s": seconds(table[chosen["end"]]),
                         "label": label.where(label != ""),
                         "confidence": (pd.to_numeric(table[chosen["confidence"]].str.replace(",", ".", regex=False),
                                                      errors="coerce") if chosen["confidence"] else np.nan),
                         "file_hint": table[chosen["file"]] if chosen["file"] else None})


def load_events(run, root, what, say, columns=None):
    """Every events file under root, matched to the recordings -> (events, recordings that have a file or a
    row). `columns`: the columns the user picked in the page; None reads the formats the notebook reads."""
    root = Path(root)
    if not root.exists():
        raise ApusError(f"{what}: not found: {root.name}")
    frames, covered, not_tables, no_recording = [], set(), [], []
    for path in (walk_files(root, {".txt", ".csv"} if columns is None else TABLES) if root.is_dir() else [root]):
        events = read_events(path) if columns is None else mapped_events(path, columns)
        if events is None:
            not_tables.append(path.name)
            continue
        folder = path.parent.relative_to(root).as_posix() if root.is_dir() else "."
        own = run.match_recording(path.name, folder)
        events["file"] = [run.match_recording(h, folder) or own if isinstance(h, str) else own
                          for h in events["file_hint"]]
        if own is not None:
            covered.add(own)
        elif events["file"].isna().all():
            no_recording.append(path.name)
        covered |= set(events["file"].dropna())
        if columns is not None:                     # a row that only names its recording: annotated, nothing heard
            events = events.dropna(subset=["start_s", "end_s", "label"])
        frames.append(events.dropna(subset=["file"]))
    events = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=["start_s", "end_s", "label", "confidence", "file"])
    events["species"] = events["label"].map(run.names.to_perch)
    events["dataset"] = events["file"].map(dict(zip(run.recordings["file"], run.recordings["dataset"])))
    say(f"{what}: {len(events)} event(s) in {len(covered)} recording(s) from {root.name}")
    if not_tables:
        say(f"  skipped {len(not_tables)} file(s) without " +
            ("the chosen columns" if columns is not None else "start/end/species columns") + f", e.g. {not_tables[0]}")
    if no_recording:
        say(f"  ⚠ {len(no_recording)} file(s) match no recording, e.g. {no_recording[0]}")
    return events.drop(columns="file_hint", errors="ignore"), covered


def mark_hits(dets, refs):
    """Per detection: does it overlap a reference event of the same species?
    Per reference event: the highest confidence among the detections overlapping it (NaN if none)."""
    hit = np.zeros(len(dets), dtype=bool)
    best = np.full(len(refs), np.nan)
    ref_groups = {key: g for key, g in refs.groupby(["file", "species"])}
    for key, d in dets.groupby(["file", "species"]):
        r = ref_groups.get(key)
        if r is None:
            continue
        overlap = ((d["start_s"].to_numpy()[:, None] < r["end_s"].to_numpy()[None, :])
                   & (d["end_s"].to_numpy()[:, None] > r["start_s"].to_numpy()[None, :]))
        hit[dets.index.get_indexer(d.index)] = overlap.any(axis=1)
        top = np.where(overlap, d["confidence"].to_numpy()[:, None], -np.inf).max(axis=0)
        pos = refs.index.get_indexer(r.index)
        best[pos] = np.fmax(best[pos], np.where(np.isfinite(top), top, np.nan))
    return hit, best


def ratio(a, b):
    return a / b if b else np.nan


def f1_of(precision, recall):
    if np.isnan(precision) or np.isnan(recall):
        return np.nan
    return 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)


def auc(x, y):
    """sklearn.metrics.auc for x that never decreases (the notebook sorts recall first)."""
    return float(np.trapezoid(y, x))


def sweep(dets, refs, thresholds):
    """Precision, recall and F1 at both levels, for every threshold.
    dets needs a 'hit' column and refs a 'best' column (from mark_hits)."""
    conf, hit, best = dets["confidence"].to_numpy(), dets["hit"].to_numpy(bool), refs["best"].to_numpy(float)
    pairs = pd.concat([dets.groupby(["dataset", "species"])["confidence"].max().rename("any"),
                       dets[dets["hit"]].groupby(["dataset", "species"])["confidence"].max().rename("correct"),
                       refs.groupby(["dataset", "species"]).size().rename("events")], axis=1)
    p_any, p_ok = pairs["any"].fillna(-1).to_numpy(), pairs["correct"].fillna(-1).to_numpy()
    p_ref = pairs["events"].notna().to_numpy()
    rows = []
    for t in thresholds:
        keep = conf >= t
        tp, fp, found = int((keep & hit).sum()), int((keep & ~hit).sum()), int((best >= t).sum())
        p, r = ratio(tp, tp + fp), ratio(found, len(best))
        rows.append({"level": "vocalization", "threshold": t, "detections": tp + fp, "TP": tp, "FP": fp,
                     "found": found, "FN": len(best) - found, "precision": p, "recall": r, "f1": f1_of(p, r)})
        detected, correct = p_any >= t, p_ok >= t
        tp, fp, fn = int(correct.sum()), int((detected & ~correct).sum()), int((~detected & p_ref).sum())
        p, r = ratio(tp, tp + fp), ratio(tp, tp + fn)
        rows.append({"level": "dataset", "threshold": t, "detections": int(detected.sum()), "TP": tp, "FP": fp,
                     "found": tp, "FN": fn, "precision": p, "recall": r, "f1": f1_of(p, r)})
    return pd.DataFrame(rows)


def compare(run, reference_dir, other_dir=None, other_name="BirdNET", count_unmatched_as_missed=True,
            reference_columns=None, other_columns=None, annotated="table"):
    """The notebook's §8 cell on a finished Run. Writes OUTPUT_DIR/comparison/ and returns what the page shows.
    The page adds: the columns the user picked in each table (None: the formats the notebook reads), and which
    recordings were annotated: those with an annotation file or row ('table', the notebook's rule) or every
    recording analysed ('all')."""
    said = []
    say = said.append
    threshold, top_k = run.s["threshold"], run.s["top_k"]
    sweep_floor = max(0.01, round(1 / top_k, 2))                 # below 1/TOP_K the top-K cut would hide scores
    thresholds = sorted(set(np.round(np.arange(sweep_floor, 1.0, 0.01), 2)) | {threshold})
    comparison_dir = run.output_dir / "comparison"
    recordings, listed = run.recordings, run.listed

    reference, ref_files = load_events(run, reference_dir, "Reference", say, reference_columns)
    analysed = set(run.predictions["file"])         # every analysed recording, even if the list removed all its predictions
    if annotated == "all":
        say(f"  Every analysed recording counts as annotated: {len(analysed - ref_files)} without annotations count as silent.")
        ref_files = ref_files | analysed
    scored = ref_files & analysed
    if ref_files - analysed:
        say(f"  {len(ref_files - analysed)} reference recording(s) were not analysed by Perch and are left out.")
    if not scored:
        raise ApusError("No recording has both a reference file and Perch results. Check the reference folder "
                        "and the file names: each name must start with its recording's name.")
    reference = reference[reference["file"].isin(scored)]
    unmatched = [reference[reference["species"].isna()].assign(source="reference")]
    if count_unmatched_as_missed:      # keep them under their own name: no detection can match them, so they are misses
        reference["species"] = reference["species"].fillna(reference["label"].map(lambda x: " ".join(label_words(x))))
    reference = reference.dropna(subset=["species"]).reset_index(drop=True)

    models = {"Perch": listed[listed["file"].isin(scored)].reset_index(drop=True)}
    if other_dir is not None:
        other, other_files = load_events(run, other_dir, other_name, say, other_columns)
        other = other[other["file"].isin(scored)]
        if scored - other_files:
            say(f"  {len(scored - other_files)} scored recording(s) have no {other_name} file (counted as no detections).")
        unmatched.append(other[other["species"].isna()].assign(source=other_name))
        # A detection with a label Perch does not have (e.g. "Human vocal") is kept under its own name,
        # so it counts as a false positive — as Perch's own non-bird classes do.
        other["species"] = other["species"].fillna(other["label"].map(lambda x: " ".join(label_words(x))))
        other = other.reset_index(drop=True)
        if other["confidence"].isna().all():
            other["confidence"] = 1.0                        # results without confidences
        say(f"  {other_name} confidences start at {other['confidence'].min():.2f} (its own export threshold).")
        models[other_name] = other

    unmatched = pd.concat(unmatched)
    unmatched = unmatched.groupby(["source", "label"]).size().rename("events").reset_index().sort_values("events", ascending=False)
    run.save_table(unmatched, comparison_dir / "unmatched_labels.csv")
    say(f"Scored: {len(scored)} recording(s) in {recordings[recordings['file'].isin(scored)]['dataset'].nunique()} dataset(s), "
        f"{len(reference)} reference event(s) of {reference['species'].nunique()} species.")
    n_ref_unmatched = unmatched.loc[unmatched["source"] == "reference", "events"].sum()
    if n_ref_unmatched:
        say(f"{n_ref_unmatched} reference event(s) have a label that matches no Perch class (see unmatched_labels.csv): "
            + ("counted as missed (COUNT_UNMATCHED_AS_MISSED = True)." if count_unmatched_as_missed else "left out."))

    results, summary, by_dataset, by_species = {}, [], [], []
    for name, dets in models.items():
        dets = dets.copy()
        dets["hit"], best = mark_hits(dets, reference)
        refs = reference.assign(best=best)
        table = sweep(dets, refs, thresholds)
        results[name] = table
        for level, g in table.groupby("level", sort=False):
            at = g[g["threshold"] == threshold].iloc[0]
            row = {"model": name, "level": level, "threshold": threshold,
                   "precision": at["precision"], "recall": at["recall"], "f1": at["f1"]}
            if g["f1"].notna().any():
                top = g.loc[g["f1"].idxmax()]
                curve = g[["recall", "precision"]].dropna().sort_values("recall")
                row.update(best_threshold=("≤ " if top["threshold"] == min(thresholds) else "") + f"{top['threshold']:.2f}",
                           best_f1=top["f1"], pr_auc=auc(curve["recall"], curve["precision"]) if len(curve) > 1 else np.nan)
            summary.append(row)
        for key, group, out in [("dataset", "dataset", by_dataset), ("species", "species", by_species)]:
            for value in sorted(set(dets[group]) | set(refs[group])):
                part = sweep(dets[dets[group] == value], refs[refs[group] == value], [threshold])
                wide = {"model": name, key: value, "reference_events": int((refs[group] == value).sum())}
                for level, r in part.set_index("level").iterrows():
                    short = "voc" if level == "vocalization" else "ds"
                    wide.update({f"{short}_{m}": r[m] for m in ["TP", "FP", "FN", "precision", "recall", "f1"]})
                out.append(wide)
        keep = dets["confidence"] >= threshold
        run.save_table(dets[keep & ~dets["hit"]][["dataset", "file", "start_s", "end_s", "species", "confidence"]],
                       comparison_dir / f"false_positives_{safe_name(name)}.csv")
        run.save_table(refs[~(refs["best"] >= threshold)][["dataset", "file", "start_s", "end_s", "label", "species", "best"]]
                       .rename(columns={"best": "best_confidence_below_threshold"}),
                       comparison_dir / f"missed_{safe_name(name)}.csv")

    summary = pd.DataFrame(summary)
    by_dataset = pd.DataFrame(by_dataset)
    by_species = pd.DataFrame(by_species)
    by_species["model"] = pd.Categorical(by_species["model"], list(models))          # Perch first
    by_species = by_species.sort_values(["model", "reference_events"], ascending=[True, False])
    run.save_table(summary, comparison_dir / "summary.csv")
    run.save_table(pd.concat([t.assign(model=n) for n, t in results.items()]), comparison_dir / "metrics_by_threshold.csv")
    run.save_table(by_dataset, comparison_dir / "by_dataset.csv")
    run.save_table(by_species, comparison_dir / "by_species.csv")
    say(f"At threshold {threshold:g} (best threshold and PR AUC over {min(thresholds):.2f}–0.99).")
    rec = lambda df: json.loads(df.to_json(orient="records"))                       # noqa: E731
    return json.dumps({"messages": said, "summary": rec(summary), "by_dataset": rec(by_dataset),
                       "by_species": rec(by_species.astype({"model": str})), "threshold": threshold,
                       "curves": {n: rec(t[["level", "threshold", "precision", "recall", "f1"]]) for n, t in results.items()}})
