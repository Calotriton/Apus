# 0007. Version 2: checking detections, thresholds per species, comparison, times, and reopening results
Status: Accepted
Date: 2026-10-27

## Context

ADR 0002 left the notebook's §8 (comparison with annotations or another model) and §9 (thresholds per species from checked clips) for version 2. On 2026-10-27 the owner asked for these, plus a set of improvements: checking detections in the page, a confidence histogram per species, reopening the last results, progress in the tab title and a notification, a check of the recordings with an estimated run time, times from file names, a species-list builder, a methods paragraph and a citation file, a Spanish interface, and help in context.

## Options considered

1. **Which detections to offer for checking.**
   - **A sample per confidence band:** per species, up to `clips_per_band` detections in each 0.1-wide band, drawn at random with the notebook's §7 rule and seed. Spreading the checks over the whole score range gives an unbiased fit and precision estimates.
   - **Highest confidence first:** simpler, but people check only the top, and the thresholds and precision then come out too optimistic.
2. **How to fit the thresholds (§9).**
   - **scikit-learn in Pyodide:** the notebook's own code. It costs a 4.6 MB download, the first time thresholds are fitted.
   - **Own implementation:** no download, but the result can differ from the notebook's when correct and incorrect clips do not overlap.
3. **Times in file names.**
   - **UTC or a fixed UTC offset,** stated by the user.
   - **Also named time zones with daylight saving:** more work, with the ambiguous changeover hours to flag.
4. **The citation file's author.**
   - **The pseudonym Calotriton:** keeps the repository anonymous.
   - **The owner's real name:** gives academic credit, but ends the anonymity.
   - **No file.**

## Decision

Chosen by the owner on 2026-10-27:
1. **A sample per confidence band.** Verdicts (correct, incorrect, unsure) are saved in `checked_detections.csv` in the output. Any other detection can still be opened and checked.
2. **scikit-learn**, loaded only when thresholds are fitted. The notebook's clip folders (`clips/<species>/correct/` and `incorrect/`) are read too.
3. **UTC or a fixed offset.** Results go to a new file, `detection_times.csv`, with times in UTC and in local time. Activity is shown as detections per hour of recording, by hour of day and by date.
4. **The owner's real name in `CITATION.cff`,** and in the citation the app shows. This is an exception to the rule that the public repository is anonymous, decided by the owner.

Defaults, stated in the plan and not objected to:
- **Output files.** Every file the notebook writes keeps its English name, columns and content, byte for byte. Only the interface is translated.
- **Figures.** The notebook's §8 and §9 figures are drawn in the page instead of as PNG files, because matplotlib would add a large download.
- **Provenance.** `run_settings.json` also records the threshold and the CSV separator. A reopened result needs them, and they are provenance.

## Evidence

- **The methods** are the notebook's (`chirpid_perch.ipynb` §8 and §9), ported unchanged:
  - comparison at the vocalization and dataset levels (Funosas et al. 2026, *Ecological Indicators* 182:114550);
  - a logistic regression of the verdict on logit(confidence), solved for a target probability (Wood & Kahl 2024, *J. Ornithol.*, doi:10.1007/s10336-024-02144-5).
- **Not verified here:** the paper's exact advice on choosing which detections to check could not be read (paywalled). Sampling across confidence bands is the notebook's own §7 design.
- **Software:** Pyodide 314.0.7 provides scikit-learn 1.8.0 (BSD-3-Clause), with joblib and threadpoolctl. The download is 4.6 MB.
- **Time zones:** AudioMoth's configuration app offers time-zone settings, so a file name's time may be UTC or a set offset. The user states which.

## Consequences

- **Checking** produces the data §9 needs, without leaving the page.
- **New output files** appear only when those tools are used:
  - `checked_detections.csv`;
  - `thresholds/`;
  - `detections_species_thresholds.csv`;
  - `comparison/`;
  - `detection_times.csv`.
- **Reversal:** each tool is separate and can be removed on its own. The version 1 outputs are unchanged.
