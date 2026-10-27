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

1. **Recordings.** Choose a folder, in which each sub-folder is one dataset (a site, a recorder…), or choose single files. You can also drop them on the page. WAV, FLAC and OGG work.
2. **Settings.** These are the notebook's:
   - threshold, window hop and species kept per window;
   - species lists and synonyms;
   - Raven tables;
   - CSV separator;
   - audio clips.

   They are remembered in this browser.
3. **Output.** In Chrome and Edge, choose a folder and the results are written there as the run goes. Otherwise they stay in the browser, and you download them as a ZIP file.

Then press **Run Perch**. A stopped run continues where it stopped.

The results are the notebook's files:
- `predictions.csv`, `detections.csv` and `removed_by_species_list.csv`;
- `species_summary.csv`, `dataset_summary.csv` and `summary.txt`;
- `run_settings.json`;
- `raven/`, and `clips/` with `clips.csv`;
- `failed_recordings.csv`, if a recording could not be read.

The page also shows the summaries and a chart of the most detected species.

## How it works

- **The model.** Perch 2.0 runs as an ONNX model with ONNX Runtime Web. It uses the graphics card (WebGPU) when the card passes a start-up check against Google's TensorFlow model, and the CPU otherwise. The model (409 MB) downloads once, is checked against its SHA-256 and stays in the browser.
- **The analysis** is the notebook's own Python (`app/apus/`), running in [Pyodide](https://pyodide.org). The preprocessing is perch-hoplite's: mono audio, polyphase resampling to 32 kHz, 5 s windows, and each window's peak scaled to 0.25.
- **Long recordings** are read in pieces, which gives exactly the same samples as reading them whole.

## Validation

- **Audio:** bit-identical to `librosa.load` at 8 sample rates (16–192 kHz), mono and stereo, in 16-, 24- and 32-bit, float and FLAC.
- **Output files:** given the notebook's predictions, Apus writes the notebook's output files byte for byte. The test project had 9 recordings in 5 datasets, with species lists, synonyms, Raven tables and 44 clips.
- **From the audio, in Edge:** the same 60 detections as the notebook. The probabilities were within 3.4e-5 of TensorFlow's on the integrated GPU, and within 4.6e-6 on the CPU.
- **A known difference:** species tied on their number of detections can be listed in another order in `species_summary.csv`. The notebook's own order for ties depends on the processor.
- **Feasibility:** see [docs/research/0001-browser-feasibility.md](docs/research/0001-browser-feasibility.md). The decisions are in [docs/decisions/](docs/decisions/).

## Developing

- **Tests:** `uv run pytest`, from an environment made with `uv sync`. In WSL, keep the environment off the Windows drive, for example with `UV_PROJECT_ENVIRONMENT=~/.venvs/apus`.
- **Parity with the notebook:** `tests/test_notebook_parity.py` also needs a reference made by `tests/tools/notebook_reference.py`. That tool reads which WABAD recordings to use from a local list, `tests/data/notebook_fixture.json`, which is not in the repository.
- **The real app:** `tests/tools/browser_e2e.py` drives it in Edge and compares the results with that reference.
- **The logo** ("Swift and call") is drawn as SVG shapes in `tools/make_icons.py`. Run `py tools/make_icons.py` after editing them to redraw `app/icons/`. It needs Edge or Chrome for the PNG copies.

## Credits

- Perch 2.0 © Google, Apache 2.0 licence. Cite: van Merriënboer et al. (2025), [arXiv:2508.04665](https://arxiv.org/abs/2508.04665).
- ONNX conversion by Justin Chu.
- Built on [ONNX Runtime Web](https://onnxruntime.ai) (MIT), [Pyodide](https://pyodide.org) (MPL 2.0) and [fflate](https://github.com/101arrowz/fflate) (MIT). [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) (MIT) is included in `app/`.
- Apus is not affiliated with Google.

## Licence

Apus is released under the MIT licence (see [LICENSE](LICENSE)). The Perch 2.0 model it downloads keeps its own Apache 2.0 licence (see [model/README.md](model/README.md)).
