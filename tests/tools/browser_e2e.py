"""Drives the real app in Edge (Playwright) on the notebook's test project, then compares the downloaded results
with the notebook's own outputs. Needs tools/serve.py running, and Playwright (no browser download: it uses the
installed Edge).

    python browser_e2e.py <fixture folder from notebook_reference.py> [--headed] [--cpu]
"""
import io
import json
import sys
import time
import zipfile
from pathlib import Path

import pandas as pd
from playwright.sync_api import sync_playwright

FX = Path(sys.argv[1])
NB_OUT = FX / "data" / "outputs" / "perch_run"
URL = "http://127.0.0.1:8000/app/"
HEADED, CPU = "--headed" in sys.argv, "--cpu" in sys.argv


def run_app():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=not HEADED)
        page = browser.new_context(accept_downloads=True).new_page()
        page.on("console", lambda m: print(f"  [console {m.type}] {m.text}") if m.type in ("error", "warning") else None)
        page.on("dialog", lambda d: d.accept())
        t0 = time.time()
        page.goto(URL)
        if CPU:                                                # the setting reloads the page
            page.click("details.advanced summary")
            with page.expect_navigation():
                page.select_option("#backend", "cpu")
        page.wait_for_selector("#model.ready, #alert:not([hidden])", timeout=900_000)
        print(f"ready after {time.time() - t0:.0f} s: {page.inner_text('#model-text')}")
        if not page.is_visible("#clear-stored"):              # it sits in Advanced
            page.click("details.advanced summary")
        page.click("#clear-stored")                            # start from an empty browser store
        page.click("#ask-yes")                                 # the page's own confirmation dialog
        page.select_option("#csv_separator", ";")
        page.check("#raven_tables")
        page.check("#extract_clips")
        page.fill("#clips_per_band", "2")
        page.set_input_files("#folder-input", str(FX / "data" / "recordings"))
        page.set_input_files("#list-folder-input", str(FX / "data" / "species_lists"))
        page.set_input_files("#syn-input", str(FX / "data" / "synonyms.csv"))
        print("recordings:", page.inner_text("#recordings-summary"))
        t1 = time.time()
        page.click("#run")
        page.wait_for_selector("#results:not([hidden]), #alert:not([hidden])", timeout=1_800_000)
        if page.is_visible("#alert"):
            sys.exit(f"APP ERROR: {page.inner_text('#alert')}")
        print(f"run took {time.time() - t1:.0f} s")
        print(page.inner_text("#summary"))
        print([t for t in page.locator("#log li").all_text_contents() if t.startswith("Timing")])
        with page.expect_download() as download:
            page.click("#downloads button")
        data = Path(download.value.path()).read_bytes()
        browser.close()
    return zipfile.ZipFile(io.BytesIO(data))


def compare(z):
    mine = {n.removeprefix("apus-results/"): n for n in z.namelist() if not n.endswith("/")}
    theirs = {p.relative_to(NB_OUT).as_posix() for p in NB_OUT.rglob("*") if p.is_file()}
    print(f"files: {len(mine)} from the app, {len(theirs)} from the notebook")
    print("  only in the notebook:", sorted(theirs - set(mine) - {"top_species.png"}))
    print("  only in the app:", sorted(set(mine) - theirs))
    read = lambda name, sep: (pd.read_csv(io.BytesIO(z.read(mine[name])), sep=sep, decimal="," if sep == ";" else "."),  # noqa: E731
                              pd.read_csv(NB_OUT / name, sep=sep, decimal="," if sep == ";" else "."))
    for name, sep in [("predictions.csv", ","), ("detections.csv", ";"), ("removed_by_species_list.csv", ";")]:
        a, b = read(name, sep)
        both = a.merge(b, on=["file", "start_s", "species"], how="outer", suffixes=("", "_nb"), indicator=True)
        matched = both[both["_merge"] == "both"]
        print(f"{name}: {len(a)} rows vs {len(b)}; unmatched {int((both['_merge'] != 'both').sum())}; "
              f"max |dconf| {(matched['confidence'] - matched['confidence_nb']).abs().max():.1e}")
    for name in ["species_summary.csv", "dataset_summary.csv"]:
        a, b = read(name, ";")
        counts = [c for c in a.columns if "confidence" not in c]
        same = a[counts].equals(b[counts])
        print(f"{name}: counts identical = {same}")
        if not same:
            key = counts[0]
            sorted_same = a[counts].sort_values(key).reset_index(drop=True).equals(
                b[counts].sort_values(key).reset_index(drop=True))
            print(f"  same rows in another order = {sorted_same}")
            print("  app:     ", list(zip(a[key], a[counts[1]])))
            print("  notebook:", list(zip(b[key], b[counts[1]])))
    a, b = read("clips/clips.csv", ";")
    same = set(zip(a["file"], a["start_s"], a["species"])) == set(zip(b["file"], b["start_s"], b["species"]))
    print(f"clips.csv: {len(a)} vs {len(b)} clips, same clips chosen = {same}")
    raven = sorted(n for n in mine if n.startswith("raven/"))
    print(f"raven tables: {len(raven)}, same names = {set(raven) == {t for t in theirs if t.startswith('raven/')}}")
    print("run_settings.json:", json.loads(z.read(mine["run_settings.json"])))


compare(run_app())
