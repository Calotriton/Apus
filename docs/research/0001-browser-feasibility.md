# 0001. Can Perch 2.0 run in the browser? Feasibility test for Apus

Date: 2026-10-23 · Informs: [ADR 0001](../decisions/0001-browser-app-platform.md) · Scripts and raw results: [`experiments/0001-browser-feasibility/`](../../experiments/0001-browser-feasibility/)

## Summary

Yes. On the owner's laptop, Perch 2.0 ran inside Edge and Firefox with ONNX Runtime Web, and it met all three go/no-go bars of ADR 0001.

- **Parity.** The browser reproduced every one of the notebook's 808 detections at confidence ≥ 0.10: 176 in 11 fixture recordings and 632 in one hour of audio. The top 10 species were identical in all 1,069 windows. The largest probability difference was 5.8e-5 on the integrated GPU and 2.5e-5 on the CPU (bar: 1e-4).
- **Memory.** One hour of 48 kHz audio completed in Edge, with a peak of 2.8 GB on the CPU and 4.8 GB on the GPU, and in Firefox, with a peak of 3.8 GB.
- **Speed.** The CPU ran 2.2–4.3 windows/s and a GPU 9.6–20.9 windows/s; the bar was 1.5. One hour of audio took 3.2–4.6 minutes on the CPU and 80 seconds on the integrated GPU.

All speeds were measured on battery power while the laptop throttled, so they are lower bounds. **Verdict: go.**

## Background

ADR 0001 chose a web app that runs Perch inside the user's browser, provided that a test met three bars on this laptop:
- the same detections as the notebook at ≥ 0.10, with max |Δ confidence| ≤ 1e-4;
- a one-hour recording completing in Chrome or Edge, and in Firefox;
- at least 1.5 windows per second.

Google's own Perch file cannot run in a browser. The candidate is a third-party ONNX conversion ([justinchuby/Perch-onnx](https://huggingface.co/justinchuby/Perch-onnx)); ONNX is a standard file format for neural networks. Its author checked it only against the TFLite version, on random inputs.

## Methods

**Reference.** The notebook's own §2 cell (`load_audio`, `frame_windows`, `peak_normalize`, `window_probabilities`) was executed verbatim with §1's defaults (hop 5 s). It ran in Perch_notebooks' environment under WSL (Python 3.11.15, TensorFlow 2.21.0, librosa 0.11.0, numpy 2.4.6) with Google's `perch_v2_cpu` model. It saved the softmax probabilities of every window, and the first three normalised windows of every file.

**Recordings.**
- *Fixture:* 11 files, 349 five-second windows, chosen to exercise every decoding and resampling path:
  - ten real WABAD recordings at 16, 22.05, 24, 32, 44.1, 48 and 192 kHz, two of them stereo and one 24-bit: nine of 60 s and one of 20 min;
  - the first 3 s of a 48 kHz file, which takes the padding path.
- *One hour:* 60 consecutive one-minute 48 kHz WABAD recordings from one site, joined unchanged into a 3,600 s file (720 windows).

The recordings are not redistributed. `make_ref.py` rebuilds both sets.

**Model.** `perch_v2.onnx` from justinchuby/Perch-onnx at commit `da88bf8c37c0b3068fc706fe509f633b9fbd28c1`: 409,148,616 bytes, SHA-256 `bf0c8467a924cb074663970ca4a0ab1e143602121930209657d0dff5d5cefa1f`.

**Comparisons.**
1. *ONNX against TensorFlow on identical input.* onnxruntime 1.31.0 (CPU, Python) ran on the notebook's own normalised windows.
2. *Browser against notebook, end to end.* The browser read each WAV file and did all the preprocessing in JavaScript (`web/audio.js`), repeating the arithmetic of each step:
   - soundfile's integer-to-float scaling and librosa's float32 channel mean;
   - scipy's `resample_poly`, in scipy's summation order;
   - librosa's `fix_length`, `pad_center` and `frame`;
   - numpy's pairwise float32 mean in the normalisation.

   ONNX Runtime Web 1.30.0 then ran the model on the CPU (WebAssembly, 4–16 threads) or on the GPU (WebGPU). Pages came from a local server with cross-origin isolation headers. The browsers were headless Edge 152 and Firefox 145, each with a throwaway profile.
3. *Python in the browser.* Pyodide 314.0.7 (Python 3.14, numpy 2.4.6, scipy 1.18.0, soundfile 0.12.1) ran the notebook's preprocessing on the same fixture. This is `librosa.load` rebuilt from soundfile and scipy's `resample_poly`. It informs the next decision.

**Measures.**
- Window counts.
- Max |Δ| of the normalised windows.
- Max |Δp| over all 14,795 classes and all windows.
- Detections that differ: a window–species pair at ≥ 0.10 in one output and below it in the other.
- Windows whose top 10 species differ in identity or order.
- Speed in windows per second, preprocessing plus inference, excluding model loading.
- Peak working set (physical memory in use) of all processes of the browser instance, sampled every 2 s.

**Machine.** Intel Core i7-12700H (14 cores, 20 threads), 15.7 GB RAM, Intel UHD integrated GPU and NVIDIA RTX A1000 Laptop GPU, Windows 11. It ran on battery throughout (79% → 52%) with the Balanced power plan.

## Results

### Parity

Table 1. Each output compared with the notebook (TensorFlow).

| Comparison | Windows | Max \|Δ\| windows | Max \|Δp\| | Detections ≥ 0.10 that differ | Windows whose top 10 differ |
|---|---|---|---|---|---|
| ONNX in Python, CPU | 349 | same input | 7.1e-6 | 0 of 176 | 0 |
| Browser, CPU (Edge and Firefox) | 1,069 | 2.8e-7 | 2.5e-5 | 0 of 808 | 0 |
| Browser, Intel integrated GPU (Edge)¹ | 1,069 | 2.8e-7 | 5.8e-5 | 0 of 808 | 0 |
| Browser, NVIDIA GPU (Edge) | 349 | 2.8e-7 | 7.2e-6 | 0 of 176 | 0 |
| Pyodide preprocessing | 349 | 0 | – | – | – |

¹ The fixture run did not record its GPU. The one-hour run, with the same settings, used the Intel GPU.

For the 32 kHz file, which needs no resampling, the JavaScript windows were bit-identical to the notebook's. With resampling they differed by at most 2.8e-7, about 10 float32 steps at the windows' peak of 0.25. The cause is last-digit differences in the resampling filter's coefficients: a power series for the Bessel function where scipy uses the Cephes routine, and JavaScript's sine. That is two orders of magnitude below the differences from the model's own arithmetic, and it changed no detection.

### Speed and memory

Table 2. Speed is preprocessing plus inference. Peak memory covers the whole browser instance.

| Run | Fixture, windows/s | One hour, windows/s | One hour of audio took | Peak memory |
|---|---|---|---|---|
| Edge, CPU, 4 threads | 4.31, then 2.21 eleven minutes later | 2.73 | 4.6 min | 2.8 GB |
| Edge, CPU, 8 / 12 / 16 threads | 2.47 / 2.70 / 2.55 | – | – | 3.0 GB |
| Firefox, CPU, 4 threads | 4.04 | 3.89 | 3.2 min | 3.8 GB |
| Edge, GPU, Intel integrated | 9.56 | 10.24 | 1.3 min | 4.8 GB |
| Edge, GPU, NVIDIA (forced by a browser flag) | 20.88 | – | about 0.6 min (estimate) | 3.5 GB |
| *Reference:* notebook, TensorFlow under WSL | – | 4.89 | 2.5 min | – |
| *Reference:* TensorFlow under WSL, inference only | 6.78 | 7.11 | – | – |
| *Reference:* ONNX Runtime, native, under WSL, inference only | 12.36 | – | – | – |
| *Reference:* notebook, TensorFlow on native Windows (inferred) | – | about 1.0 | about 12 min | – |

The native Windows row is inferred: the WSL speed divided by the 4.9× gap that Perch_notebooks measured on 2026-09-29.

Model loading took 2.4–3.5 s from the local server; this excludes the 409 MB download. The first inference took 0.3–0.8 s on the CPU and 8.3–8.5 s on the Intel GPU, where shaders are compiled. On the NVIDIA GPU it took 1.6 s.

**Threads.** More threads looked slower, but the same 4-thread run also fell from 4.31 to 2.21 windows/s within 11 minutes as the battery drained, so the laptop was throttling. The thread sweep ran in between and cannot separate the two effects. ONNX Runtime's default of 4 threads is a sound starting point.

**Which GPU.** Edge chose the Intel integrated GPU even when asked for "high-performance". The NVIDIA GPU needed a browser flag (`--force-high-performance-gpu`), which ordinary users will not set. Windows' per-app graphics setting would do the same.

**Firefox's GPU path was not measured.** Headless Firefox exposed no WebGPU adapter to the test page. A harness bug turned that into a 10-minute timeout instead of a reported error: the adapter request sat outside the error handler. The copy in `experiments/` is fixed.

### Python in the browser

Pyodide reproduced the notebook's normalised windows exactly (max |Δ| = 0) for all 11 files, including every resampled rate, stereo and 24-bit. From jsDelivr with an empty cache, it took:
- 2.5 s to load Pyodide;
- 2.5 s to load numpy, scipy and soundfile;
- 0.8 s to load pandas.

The download is 35.0 MB: 12.2 MB for Pyodide; 3.0 MB numpy, 14.0 MB scipy, 4.2 MB pandas and 0.7 MB soundfile; and 0.9 MB of small dependencies. Preprocessing ran about as fast as in JavaScript: 12 ms per window on the 20-minute file. The browser instance peaked at 1.7 GB without the model.

## Discussion

**The browser path works on this laptop, with the notebook's detections.** All three bars were met with room to spare:
- parity: at least 1.7 times under the bar in the worst run, and 4 times on the CPU;
- speed: 1.5 to 14 times the bar;
- memory: no run failed.

**Why it is fast enough.** ONNX Runtime runs this model about 1.8 times faster than TensorFlow. For inference alone it managed 12.4 windows/s against 6.8–7.1, natively under WSL in the same session. In addition, the notebook spends 31% of its time on preprocessing (46 of 147 s for the hour). The browser preprocessed the same hour in 13–20 s, in pieces. Together, these offset the cost of WebAssembly. As a result, the browser on the CPU is 2–4 times faster than the notebook on native Windows, and on a GPU it beats the notebook under WSL.

**Memory is the main constraint.** A run takes 2.8–3.8 GB on the CPU and up to 4.8 GB with the integrated GPU, for the whole browser instance. That fits machines with 8 GB, but probably not 4 GB. It agrees with the iNaturalist extension's report of about 2 GB for the model alone.

**GPU numbers differ most, but not enough to matter here.** The Intel GPU was furthest from TensorFlow (5.8e-5), yet every detection still matched. Outputs should record which backend ran (provenance). The app could also check itself at start-up against a stored reference window, and fall back to the CPU if a GPU drifts.

## Limitations

- **One laptop, on battery and throttling.** Speeds plugged in would be higher. The ordering of the options (GPU above CPU; browser CPU above native Windows TensorFlow) is what should generalise, and only cautiously.
- **Headless browsers on localhost.** The 409 MB download from Hugging Face and the interface's own overhead were not timed. Long runs in a background tab, which browsers may slow down, were not tested.
- **WAV only.** FLAC, MP3 and OGG were not tested in JavaScript. Pyodide's soundfile reads FLAC and OGG.
- **Not tested:**
  - Chrome (same engine as Edge);
  - Safari and macOS;
  - Firefox's GPU path;
  - machines with 8 GB or less.
- **The one-hour file is 60 joined recordings.** It tests length and memory, not a native one-hour recorder file.
- **The 1.5 windows/s bar** came from a September measurement under unrecorded power conditions. In this session's conditions, the notebook on native Windows would manage about 1.0 window/s (inferred, not measured).

## Next steps

1. Mark ADR 0001 accepted without condition (done with this report).
2. Decisions for the owner:
   - where the analysis logic runs: the notebook's Python in the browser (Pyodide), or a JavaScript rewrite;
   - the default backend: GPU when available, CPU otherwise;
   - where the model is hosted: a pinned copy under the owner's Hugging Face account, or the third-party repository.
3. Build version 1 ([ADR 0002](../decisions/0002-version-1-scope.md)).
