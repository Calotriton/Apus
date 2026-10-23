# 0003. The analysis logic runs as Python in the browser (Pyodide)
Status: Accepted
Date: 2026-10-23

## Context

Apus must do what `perch_all_in_one.ipynb` does, and give the same results:
- read the audio and resample it;
- apply species lists and synonyms;
- produce detections, summaries, Raven tables and clips.

That logic is about 1,000 lines of tested Python. ADR 0001 puts Apus in the browser, so the logic must run there too.

## Options considered

1. **Python in the browser (Pyodide).** The notebook's Python runs in WebAssembly. JavaScript only draws the interface, runs the model (ONNX Runtime Web) and handles files.
   - Gains: parity with the notebook comes from the same code, and the tested logic is reused (later also §8 comparison and §9 calibration). One code base can serve Apus and ChirpID. The owner can read and check the logic.
   - Loses: 35 MB more on the first visit (cached afterwards), about 6 s to start, and more memory.
2. **A JavaScript rewrite.**
   - Gains: lighter, and quicker to start. The preprocessing already exists in `experiments/0001-browser-feasibility/web/audio.js`.
   - Loses: about 1,000 lines rewritten in a second language, to be kept in step with the notebook by hand.

## Decision

Option 1, chosen by the owner on 2026-10-23.
- **Pinned versions:** Pyodide 314.0.7, with Python 3.14, numpy 2.4.6, scipy 1.18.0, soundfile 0.12.1 and pandas 3.0.2.
- **Where the code lives:** the Python core is a package inside Apus, ported from the notebook with its arithmetic unchanged.
- **Long files** are read and resampled in pieces, so that memory stays bounded. Each piece must still reproduce the whole-file result exactly.

## Evidence

[Research 0001](../research/0001-browser-feasibility.md):
- Pyodide reproduced the notebook's windows exactly (max |Δ| = 0) on 11 files covering 16–192 kHz, stereo and 24-bit.
- Loading Pyodide with numpy, scipy, soundfile and pandas took 5.8 s, and the download is 35.0 MB.
- Preprocessing ran at 12 ms per window.

## Consequences

- **Easier:** parity with the notebook, reuse of its code, version 2 features (scikit-learn is available in Pyodide), and review by the owner.
- **Harder:**
  - Two runtimes share one Web Worker: Python, and ONNX Runtime Web.
  - Peak memory must be measured in the first build.
  - pandas 3 in Pyodide differs from the notebook's pandas 2.3, so output files must be compared byte for byte.
- **Reversal:** the JavaScript preprocessing in `experiments/0001-browser-feasibility/web/audio.js` can take over the per-window work if Pyodide proves too heavy.
