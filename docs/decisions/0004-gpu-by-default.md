# 0004. Default backend: the GPU when available, otherwise the CPU
Status: Accepted
Date: 2026-10-23

## Context

ONNX Runtime Web can run Perch on the CPU (WebAssembly) or on the GPU (WebGPU). Both gave the notebook's detections in research 0001. They differ in speed and in how close they come to TensorFlow.

## Options considered

1. **GPU when available.**
   - Gains: 2.5–5 times faster on the owner's laptop (an hour of audio in 1.3 min instead of 3.2–4.6 min).
   - Loses: on the Intel GPU, results came less close to TensorFlow (max |Δp| 5.8e-5 against 2.5e-5 on the CPU), and GPUs and drivers vary between machines.
2. **Always the CPU.**
   - Gains: the closest to the notebook, and the same on every machine.
   - Loses: slower.

## Decision

Option 1, chosen by the owner on 2026-10-23.
- **When the GPU is used:** WebGPU runs when the browser offers an adapter and a start-up self-test passes. The self-test scores a stored reference input and compares the result with TensorFlow's probabilities for it, allowing max |Δp| ≤ 1e-4. Otherwise the run falls back to the CPU, with ONNX Runtime's default thread count.
- **User control:** the user can choose the CPU.
- **Provenance:** every run records the backend and the GPU adapter in `run_settings.json`.

## Evidence

[Research 0001](../research/0001-browser-feasibility.md), with 0 of 808 detections different on every backend:
- Intel integrated GPU: 9.6–10.2 windows/s;
- NVIDIA (forced by a flag): 20.9 windows/s;
- CPU: 2.2–4.3 windows/s.

All were measured on battery.

## Consequences

- **Speed:** most runs are much faster.
- **Records:** a result made on a GPU can differ from a CPU run in the fifth decimal, and the outputs record which backend made it.
- **Self-test:** it guards against GPUs or drivers that compute wrongly.
- **Reversal:** make the CPU the default, a one-line change.
