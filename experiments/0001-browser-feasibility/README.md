# Experiment 0001: Perch 2.0 in the browser

Can the browser reproduce the notebook's Perch output, fast enough and within memory? The report is [docs/research/0001-browser-feasibility.md](../../docs/research/0001-browser-feasibility.md).

## Layout

- `py/make_ref.py`: the notebook's §2 cell on the fixture, in TensorFlow. Writes `web/fixture/`, `web/ref/`, `web/manifest.json`, `web/long/` and `py_cache/`.
- `py/onnx_check.py`: ONNX against TensorFlow on the same windows.
- `py/server.py`: serves `web/` with cross-origin isolation headers, and saves results the pages post.
- `py/run_browser.ps1`: one headless run with a throwaway profile, with memory sampling.
- `py/summarize.py`: the summary table of `results/`.
- `web/audio.js`: the preprocessing in JavaScript.
- `web/spike.js` and `web/index.html`: the ONNX Runtime Web test.
- `web/pyodide.html`: the preprocessing in Pyodide.
- `results/`: the raw results of 2026-10-23, and `manifest.json` with the reference's versions and timings. They stay out of git because they name WABAD recordings and give per-file detection counts. The report gives the totals.
- `recordings.json`: which WABAD recordings to use (format in `py/make_ref.py`). It also stays out of git.

The data, the model and the ONNX Runtime files are generated or downloaded and stay out of git (see `.gitignore`).

## Reproduce

1. **Reference.** Run this in WSL, with Perch_notebooks' `.venv` and the cached `perch_v2_cpu` model:
   `.venv/bin/python py/make_ref.py <this folder> <chirpid_perch.ipynb> <WABAD recordings folder>`
2. **Model.** Download it into `web/model/` and check that the SHA-256 is `bf0c8467a924cb074663970ca4a0ab1e143602121930209657d0dff5d5cefa1f`:
   `https://huggingface.co/justinchuby/Perch-onnx/resolve/da88bf8c37c0b3068fc706fe509f633b9fbd28c1/perch_v2.onnx`
3. **ONNX Runtime Web.** Download these files from `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/` into `web/ort/`:
   - `ort.webgpu.min.mjs`;
   - `ort-wasm-simd-threaded.{mjs,wasm}`;
   - `ort-wasm-simd-threaded.jsep.{mjs,wasm}`;
   - `ort-wasm-simd-threaded.asyncify.{mjs,wasm}`.
4. **ONNX against TensorFlow.**
   `uv run --no-project --python 3.12 --with onnxruntime --with numpy python py/onnx_check.py <this folder>`
5. **Server.** `py -I py/server.py <this folder> 8765`
6. **Browser runs.** For example:
   - `py/run_browser.ps1 -Browser edge -Query "ep=wasm&threads=4" -Tag edge-wasm`
   - `-Query "ep=webgpu&gpu=high"`
   - `-Extra "--force-high-performance-gpu"`
   - `-Page pyodide.html`
   - `-Browser firefox`
7. **Summary.** `py -I py/summarize.py <this folder>`

## Notes

- **Firefox GPU run.** `results/firefox-webgpu-fixture` has only a memory trace. That run timed out because the WebGPU adapter request sat outside the page's error handler. `web/spike.js` was fixed afterwards.
- **One-hour WAV.** It is not kept; step 1 rebuilds it.
