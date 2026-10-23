# 0001. Platform: a web app that runs Perch in the browser
Status: Accepted. The feasibility test met all three bars on 2026-10-23 ([research 0001](../research/0001-browser-feasibility.md)).
Date: 2026-10-23

## Context

Apus must let people run Perch 2.0 on their recordings through a simple interface that can be shared. They should not need Linux, notebooks or a server, and the owner has no server.

Two facts from Perch_notebooks shape the choice:
- TensorFlow on native Windows gives the same scores as Linux but runs about 5 times slower (1.5 vs 7.4 windows/s on the owner's laptop). The Windows wheel is built without AVX.
- Google's `perch_v2_cpu` file is a jax2tf export (the whole network sits in two `XlaCallModule` ops), so standard tools cannot convert it to ONNX or TF.js.

## Options considered

1. **Web app on GitHub Pages; Perch runs in the user's browser** with ONNX Runtime Web, and the model downloads from Hugging Face.
   - Gains: users only open a link, on any OS, with no install or admin rights. Audio stays on their computer. It is free, and an update is a push.
   - Loses: running a 409 MB model with about 2 GB of RAM in a browser is unproven, and the speed is unknown. Browsers limit storage and file writing.
2. **Desktop app** (.exe, .app) with native ONNX Runtime or TensorFlow.
   - Gains: the fastest option, with no browser limits.
   - Loses: large installers, one per OS. Without a paid certificate, Windows warns about an "unknown publisher", and managed PCs may block the app. Microsoft's Artifact Signing accepts individuals only from the USA and Canada. Apple charges $99 per year for notarisation. Every release must be rebuilt for each OS.
3. **Hugging Face Space** (a free server running Gradio).
   - Gains: reuses the notebook's Python almost as it is.
   - Loses: users must upload large recordings to a small, shared free CPU. Recordings, and any voices on them, leave the user's computer.
4. **Google Colab.** Rejected: it is still a notebook, needs a Google account, and needs the audio in Google Drive.

## Decision

Option 1, provided a feasibility test meets the whole bar below. If it does not, return to the owner with option 2. Approved by the owner on 2026-10-23.

Go/no-go bar, measured on the owner's laptop:
- **Parity:** on fixture recordings, the browser gives the same detections as the notebook at confidence ≥ 0.10, with max |Δ confidence| ≤ 1e-4.
- **Memory:** a 1-hour recording completes in Chrome or Edge, and in Firefox.
- **Speed:** at least 1.5 windows/s, the speed of the notebook on native Windows.

## Evidence

- An ONNX conversion of Perch 2.0 exists ([justinchuby/Perch-onnx](https://huggingface.co/justinchuby/Perch-onnx), Apache 2.0, 409,148,616 bytes). Its author compared it only with the TFLite version, on random inputs: max difference 1.5e-5 on the `label` output.
- The BirdNET team's [browser demo](https://birdnet.cornell.edu/demo/) runs BirdNET 3.0 (64 MB) with ONNX Runtime Web on several CPU cores, for files up to one hour.
- An [iNaturalist browser extension](https://github.com/biodiversica/inat-sound-classifier) (GPL-3.0) runs the same Perch ONNX file with ONNX Runtime WebAssembly in a Web Worker. Its author reports about 2 GB of RAM for Perch. One Windows user reported that the analysis hung ([forum](https://forum.inaturalist.org/t/inaturalist-sound-classifier-browser-extension-by-k4u3/78096)).
- Hugging Face's CDN allows downloads from other sites (`access-control-allow-origin: *`, range requests supported), checked on 2026-10-23.
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits): 1 GB per site and a soft limit of 100 GB per month, so the model cannot be served from Pages.
- Signing: [DevClass, 2026-01-14](https://devclass.com/2026/01/14/code-signing-windows-apps-may-be-easier-and-more-secure-with-new-azure-artifact-service/).
- The WebGPU backend of ONNX Runtime supports DFT, MatMul, Conv and Softmax ([operator list](https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md)).
- **The feasibility test** ([research 0001](../research/0001-browser-feasibility.md)) covered 1,069 windows in Edge and Firefox:
  - the same 808 detections as the notebook;
  - max |Δp| 2.5e-5 on the CPU and 5.8e-5 on the Intel GPU;
  - one hour of audio in 3.2–4.6 min on the CPU (peak memory 2.8–3.8 GB) and in 80 s on the integrated GPU (4.8 GB);
  - all measured on battery.

## Consequences

- **Easier:** distribution, updates and privacy. Users no longer need a Kaggle token.
- **Harder:**
  - Large jobs are slower than in the notebook under WSL, and the browser tab must stay open, so runs must be resumable.
  - Writing many files is harder. Chrome and Edge can write into a chosen folder; other browsers get a ZIP.
  - Apus must reproduce the notebook's preprocessing itself, because the browser's own resampler differs.
- **Reversal:** the interface is a web page, so a desktop shell (for example Tauri or Electron) can wrap it later with native ONNX Runtime.
