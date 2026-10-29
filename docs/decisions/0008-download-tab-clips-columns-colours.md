# 0008. A Download tab, clips chosen after the run, columns picked in Compare, colour themes and a swift's call
Status: Accepted. The look awaits the owner's review of screenshots of the real app.
Date: 2026-10-29

## Context

On 2026-10-29 the owner asked for six changes to version 0.2:

1. The switch for audio clips in Settings was easy to miss and unclear. Clips should be chosen after the run, before downloading, with these choices:
   - all clips, only checked ones, or only those checked as correct or incorrect;
   - all species, or some, from a searchable list of the species detected;
   - clips per confidence band, and the width of the bands;
   - seconds of context on each side, 1 s by default;
   - anything else needed.
2. The run-end notification should sound like a common swift (*Apus apus*), one call, instead of the Windows sound.
3. The Raven selection table switch was unclear.
4. A last tab, next to Methods, to choose what to download from every file the results can give, in a colour of its own, subtle but recognizable.
5. "Different colour styles" for the page.
6. Compare should take the user's own Excel or CSV table, with the columns of species, start, end and anything else picked by the user, instead of fixed formats such as BirdNET's.

## Options considered

- **Colour styles** (asked, because the request was ambiguous):
  - **Themes to choose:** five palettes, each with a day and a night version.
  - **More colour in one page:** a hue per tab or tool.
  - **One new palette.**
- **Another model in Compare** (asked):
  - **Keep it**, with the same column picker as the annotations.
  - **Remove it**, and compare Perch with the annotations only.
- **The swift's call** (asked):
  - **A real recording** under a licence that allows reuse (CC BY-SA 4.0), credited in the page.
  - **A synthesized call:** no licence to follow, but it sounds artificial.
- **Which recordings count as annotated** (decided here, stated in the proposal, not objected to). With one table for every recording, a recording that has no rows may be silent, or may not have been annotated.
  - **Default:** recordings with a file or a row in the annotations, which is the notebook's rule. A row with a recording but no species marks it as listened to, with nothing heard.
  - **Every recording analysed:** a choice the user makes in the page. Its consequence is stated next to it: every detection in a recording without annotations counts as false.

## Decision

Chosen by the owner on 2026-10-29: themes to choose, keep the other model with columns to pick, and a real recording.

- **Download tab.** The last tab, tinted in the accent's soft colour with a download icon. It lists:
  - every file in the output, with its size;
  - the methods paragraph as `methods.txt`;
  - Raven selection tables and audio clips, both made on demand.

  What does not exist yet is greyed out, with how to get it. `run_settings.json` is always included. One ZIP is built in the worker, with progress and Cancel. Raven tables and clips leave Settings.
- **Clips:**
  - which detections: a sample per confidence band (the notebook's §7 rule and seed), every detection, or the checked ones by verdict (correct, incorrect, unsure);
  - species: a menu with a search box and boxes to tick, listing only the species detected, each with its number of detections;
  - clips per band;
  - band width: 0.05, 0.1, 0.2 or 0.25. Bands are computed as `floor(confidence × n)` with n = 20, 10, 5 or 4. For n = 10 this is exactly the notebook's arithmetic;
  - seconds of context on each side, 1 s by default;
  - sound: as the model heard it (mono, 32 kHz, the notebook's clips), or as recorded (the file's own channels, sample rate and sample format).

  Checked clips go into `clips/<species>/<verdict>/`, the layout that §9 and the Thresholds tab read. `clips.csv` adds `folder` and `verdict` columns. A clip that cannot be cut is listed in `clips/clips_not_cut.csv`, never dropped silently. The count and an estimated size show before downloading.
- **Check detections** keeps its own sample size per 0.1 band, as a field in that tab.
- **Notification.**
  - The system notification is silent (`silent: true`; Chrome and Edge honour it, Firefox and Safari do not).
  - The page plays one call of a common swift when a run ends, whenever "Tell me when a run ends" is on. Turning the switch on plays it once.
  - The sound is made ready in the click on Analyse, because browsers play sound only after a click on the page.
- **Colours.** Five palettes: Apus teal (the default), Forest, Ocean, Heather and Slate. Each has a day and a night set of tokens. A menu in the header sets the palette, and `localStorage` remembers it as `apus.palette`. The logo stays in the brand's teal.
- **Compare.** One field per table takes CSV, text, TSV or Excel (`.xlsx`, `.xlsm`, `.xls`, `.ods`), as files or a folder.
  - **Columns.** The page shows the first rows and a select for each role: species, start and end (required), recording, and confidence (the other model only). Each select starts from a guess made from the column names, in English or Spanish. Audacity label files, which have no header, get the columns Start (s), End (s) and Label.
  - **Times.** Seconds, with a decimal point or comma, or minutes and seconds (`1:02.5`), or hours, minutes and seconds (`0:01:02.5`), as Excel shows them.
  - **Text files** are read as UTF-8 (with or without Excel's byte order mark), or as Windows-1252 when they are not UTF-8.
  - **Annotated recordings:** the user chooses which recordings count, as described under Options considered.
  - **The notebook's reading** of the old formats stays unchanged in the code. The tests still compare it with the notebook, byte for byte.
- **Version** 0.3.0.

## Evidence

- **The swift's call.**
  - The first candidate was XC664457, a 2.9 s recording by Uku Paal from Estonia, on Wikimedia Commons under CC BY-SA 4.0. It was dropped because its Commons page contradicts itself: the description says common swift, the category says pallid swift.
  - The call used comes from XC554033. Luis Alvarez Menendez recorded it in Oviedo, Spain, on 3 May 2020. It came to Commons through the xeno-canto import project, and is licensed CC BY-SA 4.0.
  - The licence was read on Commons. xeno-canto's own page could not be read, because its site blocks automated reads and API v2 is retired.
  - One call (0.55 s from 1.97 s) was band-passed to 3–11 kHz, denoised by spectral subtraction, and faded in and out. Its spectrogram was checked: one scream at about 6 kHz.
  - `tools/make_chirp.py` reproduces the file bit for bit, on Linux and on Windows.
  - The page credits the recordist in its footer. `app/sounds/LICENSE.md` states the licence and the changes. The share-alike term applies to the sound file only.
- **Excel.** Pyodide 314.0.7 ships python-calamine 0.6.2 (MIT, 489 kB). openpyxl is not in Pyodide's lock file. pandas 3.0 reads Excel through calamine.
- **Contrast.** `tools/check_contrast.py` computes every pair that WCAG 2.2 AA asks for, in every palette, by day and by night. The test suite runs it.
  - Text is at least 4.75:1 (Forest by day, accent on its soft tint, after darkening Forest's green from #15803d, which gave 4.40).
  - Controls and chart marks are at least 3.09:1.
- **Tests.** 82 of 82 passed in WSL before the last edits to wording and versions. After them, 45 of 45 passed on Windows: the export, results and contrast tests, including the notebook's own §8 and §9 cells.
  - The default sample picks the notebook's §7 clips.
  - Bands of other widths cut where expected.
  - Checked clips go into their verdict folders.
  - "As recorded" keeps the sample rate and channels.
  - A file that cannot be read is listed.
  - The Raven tables made on demand equal the run's, byte for byte.
  - Columns picked in the page give the notebook's comparison files, byte for byte.
  - A Spanish CSV is read correctly: semicolons, decimal commas, minutes and seconds, a byte order mark, Windows-1252, and a row with no species.
  - An Excel workbook with another model's detections is read correctly.
- **The real app in Edge** (`tests/tools/browser_e2e.py` and a longer script), on the notebook's test project (9 recordings in 5 datasets):
  - the same 60 detections, within 3.4e-5;
  - the notebook's 44 clips, each WAV file byte for byte the notebook's;
  - 8 Raven tables, identical but for the 4th decimal of Confidence (at most 1e-4, from the model difference above);
  - three checked detections downloaded into `correct/` and `incorrect/`, at 48 kHz when kept as recorded;
  - Compare on WABAD's human labels (Audacity files) and BirdNET's results: the columns guessed right, including from Spanish headers in an Excel table;
  - no sideways scroll at 390 px, and no console errors.
- **Not tested:** the sound and the silent notification on a real Windows desktop (the browser was headless), Firefox and Safari, a screen reader, a ZIP of several GB, and `.xls` or `.ods` files.

## Consequences

- **Easier:**
  - clips and Raven tables no longer need a decision before the run;
  - a run's results can be packed in several ways after it;
  - annotations no longer need to follow a format.
- **Harder:**
  - **The ZIP is built in memory.** A very large selection, such as every detection of a long deployment as WAV, or a large `predictions.csv`, needs that much memory. The page shows the size before downloading.
  - **Clips no longer go into an output folder.** They used to be written into a chosen folder. Now they come only in the ZIP. To sort clips by hand for §9 in the old way, unzip them into the output folder.
  - **Two more files to maintain:** a licensed sound file, and five palettes whose contrast must hold. The test checks the contrast.
- **Reversal:**
  - each part is separate;
  - the clips and Raven code of `Run` (§6, §7) is unchanged and still tested;
  - restoring `app/index.html`, `app/app.js`, `app/style.css`, `app/worker.js` and `app/i18n.js` from version 0.2 brings back the switches in Settings;
  - removing `app/sounds/` and the `chirp` code brings back the system sound.
