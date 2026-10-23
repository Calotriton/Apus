# 0002. Version 1 scope: the core of the notebook
Status: Accepted
Date: 2026-10-23

## Context

`perch_all_in_one.ipynb` has nine sections. The owner asked for an interface that analyses files or folders, lets the user set the threshold and the other settings, cuts audio clips, and gives basic statistics.

## Options considered

1. **Core first.** Version 1 covers notebook §3–§7. Version 2 adds §8 and §9.
   - Gains: it ships sooner with fewer screens.
   - Loses: comparison and calibration wait.
2. **Everything in version 1**, including the comparison with annotations or BirdNET (§8) and per-species thresholds from checked clips (§9).
   - Gains: no feature waits.
   - Loses: a longer first build and a bigger interface to get right.

## Decision

Option 1, chosen by the owner on 2026-10-23.

Version 1:
- files or a folder (each sub-folder is one dataset);
- hop, top-K and threshold;
- resume;
- species list and synonyms;
- detections;
- summary statistics and the top-species chart;
- CSV export (`,` or `;`) and Raven tables;
- audio clips.

Version 2: comparison with annotations or another model (§8), and per-species thresholds from checked clips (§9).

## Evidence

The owner's choice. The core is what the owner listed in the brief.

## Consequences

Version 1 ships sooner. If Apus writes `predictions.csv` and `run_settings.json` in the notebook's format, the notebook's §8 and §9 can run on Apus output until version 2 exists. That has to be checked when the export is built. To reverse this decision, move §8 or §9 into the version 1 plan.
