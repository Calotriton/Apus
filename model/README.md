---
license: apache-2.0
library_name: onnx
pipeline_tag: audio-classification
tags:
  - bioacoustics
  - birds
  - onnx
---

# Perch 2.0 in ONNX format, for Apus

This repository holds an unchanged copy of `perch_v2.onnx`. It is an ONNX conversion of Google's **Perch 2.0** bird-vocalisation classifier ([Kaggle: google/bird-vocalization-classifier](https://www.kaggle.com/models/google/bird-vocalization-classifier)), made by Justin Chu ([justinchuby/Perch-onnx](https://huggingface.co/justinchuby/Perch-onnx), commit `da88bf8c37c0b3068fc706fe509f633b9fbd28c1`). The two class lists come from the Kaggle model's `assets/`.

The copy exists so that Apus, a browser interface for Perch 2.0, always downloads the same bytes. Apus checks them against the checksums below.

## Files

| File | SHA-256 | What it is |
|---|---|---|
| `perch_v2.onnx` | `bf0c8467a924cb074663970ca4a0ab1e143602121930209657d0dff5d5cefa1f` | The model (float32, 409,148,616 bytes) |
| `labels.csv` | `e4d5c0397d8fb08bf90c6b13a34810af53504faad927e472fcc567793c9de057` | The 14,795 class names, in output order, after a header line |
| `perch_v2_ebird_classes.csv` | `861aef71b679d8dcf07c0c71375188c46b680bd808c61a539f254dc21319bcc9` | The eBird 2021 code of each class, in the same order (`no_ebird_code` where there is none) |

## Input and output

- **Input** `inputs`: float32 `[batch, 160000]`. Each row is 5 s of mono audio at 32 kHz. To reproduce perch-hoplite, Google's Perch library:
  - resample with a polyphase filter;
  - then, in each window, remove the mean and scale the peak to 0.25.
- **Outputs:**
  - `label` `[batch, 14795]`: logits, to be turned into probabilities with a softmax;
  - `embedding` `[batch, 1536]`;
  - `spatial_embedding` `[batch, 16, 4, 1536]`;
  - `spectrogram` `[batch, 500, 128]`.

## Verification

We compared this file (ONNX Runtime 1.31, CPU) with Google's TensorFlow model (`perch_v2_cpu`, TensorFlow 2.21), on the same inputs. The test used 349 windows from 11 real recordings at 16–192 kHz, mono and stereo.
- Probabilities: max |Δ| 7.1e-6.
- Detections at probability ≥ 0.10: identical (176 of 176).
- Top-10 classes: identical in every window.

## Licence and attribution

- Perch 2.0 © Google, released under the Apache License 2.0. Cite: van Merriënboer et al. (2025), *Perch 2.0: The Bittern Lesson for Bioacoustics*, [arXiv:2508.04665](https://arxiv.org/abs/2508.04665).
- ONNX conversion by Justin Chu, under the Apache License 2.0.
- These files are redistributed unchanged under the same licence (see `LICENSE`).

This repository is not affiliated with Google. "Perch" is Google's name for the model.
