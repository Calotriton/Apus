# Apus

Identify the species in your sound recordings with Google's **Perch 2.0**, in your web browser. There is nothing to install and nothing is uploaded: Perch runs on your own computer, inside the browser tab.

Apus does what the notebook `perch_all_in_one` does, and gives the same results (see *Validation*).

## Using it

Open **<https://calotriton.github.io/Apus/>** in Chrome, Edge or Firefox. The first visit downloads Perch (409 MB) once; after that, it starts from the browser's copy.

To run it from your own computer instead (for development):

1. Put the model files in `model/`, as described in [model/README.md](model/README.md).
2. Start the local server: `py tools/serve.py` on Windows, or `python3 tools/serve.py` elsewhere.
3. Open <http://127.0.0.1:8000/app/>.

In the app:

1. **Recordings.** Choose a folder, in which each sub-folder is one dataset (a site, a recorder…), or choose single files. You can also drop them on the page. WAV, FLAC and OGG work. Apus first checks the files from their headers: length, sample rate and format. It also estimates how long the run will take.
2. **Settings.** These are the notebook's:
   - threshold, window hop and species kept per window;
   - species lists and synonyms (a list can also be built in the page, from Perch's classes);
   - Raven tables;
   - CSV separator;
   - audio clips.

   They are remembered in this browser. The **?** next to a setting explains it.
3. **Output.** In Chrome and Edge, choose a folder and the results are written there as the run goes. Otherwise they stay in the browser, and you download them as a ZIP file.

Then press **Run Perch**. A stopped run continues where it stopped. The tab's title shows the progress, and Apus can tell you when a run ends. The page is in English or Spanish: the button next to the night mode switches it.

The results open in tabs:
- **Summary:** the counts, the most detected species, and tables you can sort.
- **Check detections:** listen to detections over their spectrogram, and mark each one correct, incorrect or unsure. For each species, Apus offers a random sample in each confidence band, the same detections it cuts as clips.
- **Thresholds:** a threshold per species from your checks, as in the notebook's §9 (Wood and Kahl 2024).
- **Compare:** precision and recall of Perch, and optionally of another model such as BirdNET, against your own annotations, as in the notebook's §8 (Funosas et al. 2026).
- **Activity:** detections per hour of recording, by hour of the day and by date, from the times in the file names.
- **Methods:** a paragraph for a report or paper, and what to cite.

The last results open again when you come back to the page.

The results are the notebook's files:
- `predictions.csv`, `detections.csv` and `removed_by_species_list.csv`;
- `species_summary.csv`, `dataset_summary.csv` and `summary.txt`;
- `run_settings.json`;
- `raven/`, and `clips/` with `clips.csv`;
- `failed_recordings.csv`, if a recording could not be read.

The tools in the tabs add their own files:
- `checked_detections.csv`, your verdicts;
- `thresholds/` and `detections_species_thresholds.csv`, from §9;
- `comparison/`, from §8;
- `detection_times.csv`, the time of each detection in UTC and in local time.

## How it works

- **The model.** Perch 2.0 runs as an ONNX model with ONNX Runtime Web. It uses the graphics card (WebGPU) when the card passes a start-up check against Google's TensorFlow model, and the CPU otherwise. The model (409 MB) downloads once, is checked against its SHA-256 and stays in the browser.
- **The analysis** is the notebook's own Python (`app/apus/`), running in [Pyodide](https://pyodide.org). The preprocessing is perch-hoplite's: mono audio, polyphase resampling to 32 kHz, 5 s windows, and each window's peak scaled to 0.25.
- **Long recordings** are read in pieces, which gives exactly the same samples as reading them whole.
- **The tools in the tabs** work from the files in the output, so they also work in a later session. Listening needs the recordings chosen again, or the clips in the output. scikit-learn (4.6 MB) downloads only when thresholds are fitted.

## Validation

- **Audio:** bit-identical to `librosa.load` at 8 sample rates (16–192 kHz), mono and stereo, in 16-, 24- and 32-bit, float and FLAC.
- **Output files:** given the notebook's predictions, Apus writes the notebook's output files byte for byte. The test project had 9 recordings in 5 datasets, with species lists, synonyms, Raven tables and 44 clips.
- **From the audio, in Edge:** the same 60 detections as the notebook. The probabilities were within 3.4e-5 of TensorFlow's on the integrated GPU, and within 4.6e-6 on the CPU.
- **A known difference:** species tied on their number of detections can be listed in another order in `species_summary.csv`. The notebook's own order for ties depends on the processor.
- **Comparison and thresholds:** on the same inputs, Apus writes the notebook's §8 and §9 files byte for byte. The tests run the notebook's own cells to check it.
- **Feasibility:** see [docs/research/0001-browser-feasibility.md](docs/research/0001-browser-feasibility.md). The decisions are in [docs/decisions/](docs/decisions/).

## Developing

- **Tests:** `uv run pytest`, from an environment made with `uv sync`. In WSL, keep the environment off the Windows drive, for example with `UV_PROJECT_ENVIRONMENT=~/.venvs/apus`.
- **Parity with the notebook:** `tests/test_notebook_parity.py` also needs a reference made by `tests/tools/notebook_reference.py`. That tool reads which WABAD recordings to use from a local list, `tests/data/notebook_fixture.json`, which is not in the repository. The §8 and §9 tests in `tests/test_results.py` need the notebook itself, given as `APUS_NOTEBOOK`.
- **The real app:** `tests/tools/browser_e2e.py` drives it in Edge and compares the results with that reference.
- **The logo** ("Swift and call") is drawn as SVG shapes in `tools/make_icons.py`. Run `py tools/make_icons.py` after editing them to redraw `app/icons/`. It needs Edge or Chrome for the PNG copies.

## Credits

- Perch 2.0 © Google, Apache 2.0 licence. Cite: van Merriënboer et al. (2025), [arXiv:2508.04665](https://arxiv.org/abs/2508.04665).
- ONNX conversion by Justin Chu.
- Built on [ONNX Runtime Web](https://onnxruntime.ai) (MIT), [Pyodide](https://pyodide.org) (MPL 2.0), [scikit-learn](https://scikit-learn.org) (BSD-3-Clause) and [fflate](https://github.com/101arrowz/fflate) (MIT). [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) (MIT) is included in `app/`.
- Methods: thresholds per species after Wood & Kahl (2024), *Journal of Ornithology* 165: 777–782, [doi:10.1007/s10336-024-02144-5](https://doi.org/10.1007/s10336-024-02144-5). Comparison levels after Funosas et al. (2026), *Ecological Indicators* 182: 114550.

## Citing

If you use Apus, please cite it as in [CITATION.cff](CITATION.cff) (GitHub shows it as "Cite this repository"), and cite Perch 2.0: van Merriënboer et al. (2025), [arXiv:2508.04665](https://arxiv.org/abs/2508.04665). The Methods tab writes both for you.
- Apus is not affiliated with Google.

## Licence

Apus is released under the MIT licence (see [LICENSE](LICENSE)). The Perch 2.0 model it downloads keeps its own Apache 2.0 licence (see [model/README.md](model/README.md)).
