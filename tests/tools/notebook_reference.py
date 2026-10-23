"""Reference outputs for tests/test_notebook_parity.py: builds a test project from WABAD recordings and runs
the notebook on it, unchanged except for its settings lines. Run it with Perch_notebooks' .venv:

    python notebook_reference.py <WABAD folder> <chirpid_perch.ipynb> <fixture folder>

then point the tests at the fixture: APUS_NB_FIXTURE=<fixture folder> pytest tests/test_notebook_parity.py

The recordings are named in tests/data/notebook_fixture.json, kept out of git (the repository is public):
  {"recordings": ["SITE_YYYYMMDD_HHMMSS", ...],   each with its own species list, except:
   "dataset_list": "SITE",                         this site's list is used for its whole dataset
   "no_list": "SITE",                              this site has no list (not filtered)
   "short_copy_of": "SITE_YYYYMMDD_HHMMSS"}        its first 3 s become a recording without a list
"""
import json
import os
import re
import shutil
import sys
from pathlib import Path

import kagglehub
import soundfile as sf

WABAD, NOTEBOOK, FX = (Path(a).resolve() for a in sys.argv[1:4])
MODEL = Path.home() / ".cache/kagglehub/models/google/bird-vocalization-classifier/tensorFlow2/perch_v2_cpu/1"
SPEC = json.loads((Path(__file__).parents[1] / "data" / "notebook_fixture.json").read_text())
# §1 lines to change (each must match exactly one line), and the same settings as Apus names them
NOTEBOOK_SETTINGS = {"SPECIES_LIST": 'PROJECT_DIR / "data" / "species_lists"',
                     "SYNONYMS_FILE": 'PROJECT_DIR / "data" / "synonyms.csv"',
                     "RAVEN_TABLES": "True", "CSV_SEPARATOR": '";"', "EXTRACT_CLIPS": "True", "CLIPS_PER_BAND": "2"}
APUS_SETTINGS = {"species_list": "data/species_lists", "synonyms_file": "data/synonyms.csv", "raven_tables": True,
                 "csv_separator": ";", "extract_clips": True, "clips_per_band": 2}

shutil.rmtree(FX, ignore_errors=True)
data = FX / "data"
for stem in SPEC["recordings"]:
    site = stem.split("_")[0]
    (data / "recordings" / site).mkdir(parents=True, exist_ok=True)
    shutil.copyfile(WABAD / "recordings" / site / f"{stem}.wav", data / "recordings" / site / f"{stem}.wav")
    species_list = next((WABAD / "spatio_temporal_filters" / "threshold_002" / site).glob(f"{stem}_*.csv"))
    if site == SPEC["no_list"]:
        continue                                                   # no list: not filtered
    whole_dataset = site == SPEC["dataset_list"]                   # a list named like the dataset
    dst = data / "species_lists" / (f"{site}.csv" if whole_dataset else f"{site}/{species_list.name}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(species_list, dst)
# under 5 s, in a dataset whose lists name other recordings, so it is not filtered
site = SPEC["short_copy_of"].split("_")[0]
y, sr = sf.read(str(WABAD / "recordings" / site / f"{SPEC['short_copy_of']}.wav"), dtype="int16")
sf.write(str(data / "recordings" / site / f"{site}_short3s.wav"), y[:3 * sr], sr, subtype="PCM_16")
(data / "synonyms.csv").write_text("your_name;perch_name\nTest Bird;Turdus merula\nNot A Species;Nonexistent species\n")

cells = [c for c in json.loads(NOTEBOOK.read_text())["cells"] if c["cell_type"] == "code"]
sources = ["".join(c["source"]) for c in cells]
for key, value in NOTEBOOK_SETTINGS.items():
    total = 0
    for i, src in enumerate(sources):
        sources[i], n = re.subn(rf"^{re.escape(key)}\s*=\s*[^#\n]*", f"{key} = {value}  ", src, flags=re.M)
        total += n
    assert total == 1, f"setting {key} matched {total} lines"

kagglehub.model_download = lambda slug: str(MODEL)                 # the cached model, no Kaggle login
os.environ["MPLBACKEND"] = "Agg"
(FX / "notebooks").mkdir()
os.chdir(FX / "notebooks")
ns = {"__name__": "__main__"}
for i, src in enumerate(sources):
    exec(compile(src, f"<code cell {i}>", "exec"), ns)
(FX / "fixture.json").write_text(json.dumps({"notebook": NOTEBOOK.name, "model": ns["MODEL_SLUG"],
                                             "settings": APUS_SETTINGS}, indent=1))
print(f"\nReference ready in {FX}")
