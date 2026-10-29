"""What the Download tab packs that is not already a file in the output, made when it is asked for: Raven
selection tables (the notebook's §6) and audio clips of detections (§7, with more choices). Everything is
written into a folder of its own, for the page to zip."""
import json
from pathlib import Path

import pandas as pd
import soundfile as sf

from .audio import SAMPLE_RATE, WINDOW_S, load_clip, open_audio
from .project import safe_name, sample_per_band, write_raven_tables

CLIP_COLUMNS = ["clip", "species", "dataset", "file", "start_s", "end_s", "confidence"]   # the notebook's clips.csv
VERDICTS = ("correct", "incorrect", "unsure")
BYTES = {"PCM_U8": 1, "PCM_S8": 1, "PCM_16": 2, "PCM_24": 3, "PCM_32": 4, "FLOAT": 4, "DOUBLE": 8}


def options_of(text):
    """The page's clip choices (JSON), with the notebook's defaults for anything left out."""
    o = {"which": "sample", "species": None, "per_band": 10, "bands": 10, "verdicts": list(VERDICTS),
         "extra_s": 1.0, "as_recorded": False, **json.loads(text or "{}")}
    o["per_band"], o["bands"], o["extra_s"] = int(o["per_band"]), int(o["bands"]), float(o["extra_s"])
    return o


def choose_clips(results, which="sample", species=None, per_band=10, bands=10, verdicts=VERDICTS, **_):
    """The detections to cut, with a verdict column ('' if not checked).
    which: 'sample' (up to per_band per species and confidence band, the notebook's §7 rule; `bands` bands of
    equal width), 'all', or 'checked' (those checked with one of `verdicts`). species: the names to keep, or
    None for every species."""
    d = results.detections
    if species is not None:
        d = d[d["species"].isin(set(species))]
    d = d.assign(verdict=results._verdicts(d))
    if which == "sample":
        return d.loc[sample_per_band(d, per_band, bands=bands)]
    if which == "checked":
        return d[d["verdict"].isin(set(verdicts))]
    if which == "all":
        return d
    raise ValueError(f"unknown choice of clips: {which}")


def wav_subtype(info):
    """A clip keeps its recording's sample format when WAV can hold it (MP3 and Vorbis become 16-bit)."""
    return info.subtype if sf.check_format("WAV", info.subtype) else "PCM_16"


def plan(results, input_dir, text):
    """Before cutting: how many clips of how many species, about how many bytes, and which recordings they
    need that are not here."""
    o, input_dir = options_of(text), Path(input_dir)
    rows = choose_clips(results, **o)
    seconds = WINDOW_S + 2 * o["extra_s"]
    rate, missing = {}, []
    for f in rows["file"].unique():
        path = input_dir / f
        if not path.exists():
            missing.append(f)
            continue
        if o["as_recorded"]:
            info = sf.info(str(path))
            rate[f] = info.samplerate * info.channels * BYTES[wav_subtype(info)]
        else:
            rate[f] = SAMPLE_RATE * 2                                  # mono, 16-bit
    size = float((rows["file"].map(rate).fillna(0) * seconds).sum()) + 44 * len(rows)
    return json.dumps({"clips": len(rows), "species": int(rows["species"].nunique()), "bytes": int(size),
                       "missing": sorted(missing)})


def clip_name(row):
    """The notebook's clip name: <recording>_<species>_<confidence>_<start>s.wav."""
    return f"{Path(row['file']).stem}_{safe_name(row['species'])}_{row['confidence']:.3f}_{row['start_s']:g}s.wav"


def read_segment(path, offset, duration):
    """A stretch of a recording as it was recorded: its own sample rate, channels and sample format."""
    with open_audio(str(path)) as f:
        sr, subtype = f.samplerate, wav_subtype(f)
        f.seek(int(offset * sr))
        return f.read(int(duration * sr), dtype="float32", always_2d=True), sr, subtype


def write_clips(results, input_dir, text, out_dir):
    """Cut the chosen clips into out_dir/clips/<species>/ (checked clips into a sub-folder named after their
    verdict, the layout the Thresholds tab and the notebook's §9 read). Yields each path written, relative to
    out_dir, then clips/clips.csv, and clips/clips_not_cut.csv if a clip could not be cut."""
    o, input_dir, out_dir = options_of(text), Path(input_dir), Path(out_dir)
    rows = choose_clips(results, **o)
    by_verdict = o["which"] == "checked"
    index, failed = [], []
    for _, d in rows.iterrows():
        folder = safe_name(d["species"]) + (f"/{d['verdict']}" if by_verdict and d["verdict"] else "")
        name, start = clip_name(d), max(0.0, d["start_s"] - o["extra_s"])
        duration = WINDOW_S + 2 * o["extra_s"]
        try:
            if o["as_recorded"]:
                audio, sr, subtype = read_segment(input_dir / d["file"], start, duration)
            else:                                                       # as the model heard it, as §7 cuts it
                audio, sr, subtype = load_clip(input_dir / d["file"], start, duration), SAMPLE_RATE, None
        except Exception as exc:                                        # noqa: BLE001 (listed, not dropped)
            failed.append({"clip": name, "file": d["file"], "start_s": d["start_s"], "species": d["species"],
                           "error": str(exc).strip().splitlines()[-1] if str(exc).strip() else type(exc).__name__})
            continue
        target = out_dir / "clips" / folder / name
        target.parent.mkdir(parents=True, exist_ok=True)
        sf.write(target, audio, sr, subtype=subtype)
        index.append({**{c: d[c] for c in CLIP_COLUMNS[1:]}, "clip": name, "folder": folder, "verdict": d["verdict"]})
        yield f"clips/{folder}/{name}"
    results.save_table(pd.DataFrame(index, columns=CLIP_COLUMNS + ["folder", "verdict"]), out_dir / "clips" / "clips.csv")
    yield "clips/clips.csv"
    if failed:
        results.save_table(pd.DataFrame(failed), out_dir / "clips" / "clips_not_cut.csv")
        yield "clips/clips_not_cut.csv"


def raven(results, out_dir):
    """The Raven selection tables, one per recording with detections. Returns the paths, relative to out_dir."""
    out_dir = Path(out_dir)
    return [p.relative_to(out_dir).as_posix() for p in write_raven_tables(results.detections, out_dir / "raven")]
