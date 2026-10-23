# 0005. The model is hosted as the owner's own copy on Hugging Face
Status: Accepted
Date: 2026-10-23

## Context

Users' browsers download the 409 MB ONNX model once and keep it cached. GitHub Pages cannot serve the file (ADR 0001). Hugging Face can, and it allows downloads from other sites (checked on 2026-10-23). The only browser-ready version is a third-party conversion ([justinchuby/Perch-onnx](https://huggingface.co/justinchuby/Perch-onnx)).

## Options considered

1. **The owner's own copy on Hugging Face**, under the Calotriton account.
   - Gains: it cannot disappear or change under the app.
   - Loses: it needs a free account and an upload by the owner.
2. **The third-party repository**, pinned to a commit.
   - Gains: no account is needed.
   - Loses: its owner could delete it, and Apus would stop working until it is pointed elsewhere.

## Decision

Option 1, chosen by the owner on 2026-10-23.
- **What is uploaded:** `perch_v2.onnx`, unchanged (SHA-256 `bf0c8467a924cb074663970ca4a0ab1e143602121930209657d0dff5d5cefa1f`), with the Apache 2.0 licence and attribution to Google (the model) and Justin Chu (the conversion). Apus does the preparation; the owner does the upload.
- **How Apus loads it:** Apus downloads the file from a pinned commit, checks its SHA-256 before using it, and caches it in the browser.

## Evidence

- Licence: Apache 2.0 for the Kaggle model (Kaggle API, checked in Perch_notebooks on 2026-09-29) and for the conversion. Both allow redistribution with the licence and a notice of changes; there are none.
- Hugging Face CDN: `access-control-allow-origin: *` and range requests (checked on 2026-10-23).

**Done on 2026-10-23.** The owner uploaded the files to [Calotriton/perch-v2-onnx](https://huggingface.co/Calotriton/perch-v2-onnx), commit `bb0f724ee99fa4e0dc3637d8bbdc6a0e26660480`. All five files match the local checksums: the model by its LFS SHA-256, and the others downloaded from that commit and hashed. The CDN allows downloads from `calotriton.github.io`. `app/worker.js` downloads from that commit.

## Consequences

- **Gains:** the owner controls availability, and Hugging Face's bandwidth is free.
- **Duty:** the model card must keep the licence and attribution.
- **Changing the model** means a new upload and a new pinned hash in Apus.
- **Reversal:** point Apus at the third-party repository, and change one URL and one hash.
