# 0006. Two-pane layout and a vector logo
Status: Accepted
Date: 2026-10-27

## Context

The owner asked for a more modern and elegant design, for the line under the header about nothing being installed or uploaded to be removed, and for the logo to be redone if the new design needed it. Version 1 was one column of numbered cards with a pixel-art logo. The design guidance the project now follows is in the agent's section 5, "Interface design": WCAG 2.2 level AA, Nielsen's heuristics, GOV.UK's guidance on error messages, and Baseline for browser features.

## Options considered

1. **Layout: two panes.** The work (recordings, Run, progress, results) on the left, the settings in a sticky panel on the right, and one column in task order below 960 px.
   - Gains: the results get the most space, as the owner prefers for interfaces. The settings stay in view while recordings are chosen and results are read.
   - Loses: on a short screen the settings panel scrolls on its own.
2. **Layout: one column, restyled.** The version 1 order with the new visual style.
   - Gains: closest to version 1 and to the notebook's order.
   - Loses: the settings push the results far down the page.
3. **Logo: vector "Swift and call".** The minimal vector swift the owner liked on the design canvas, above a short waveform of its call, white on the app's teal. The tab icon is the swift alone.
   - Gains: sharp at every size and in keeping with a refined interface.
   - Loses: the pixel-art character the owner chose on 2026-10-23.
4. **Logo: keep the pixel art.**
   - Gains: no change.
   - Loses: a retro look against a modern interface.

The owner chose from screenshots of the real app in every state, in both themes, at desktop and phone widths.

## Decision

Options 1 and 3, chosen by the owner on 2026-10-27.
- **Layout:**
  - a drop zone for recordings that also takes dropped folders;
  - the key settings repeated next to Run;
  - stat tiles, a bar list of the most detected species, and sortable tables;
  - a `<dialog>` in place of the browser's `confirm()`;
  - the files that failed shown in the results.
- **Logo:** `tools/make_icons.py` draws `app/icons/`: the logo (`logo.svg`), the tab icon (`favicon.svg`, and `favicon-32.png` for browsers without SVG icons), and the home-screen icon (`apple-touch-icon.png`). Headless Edge or Chrome draws the PNGs.
- **Look:**
  - colours, radii and fonts are tokens in `app/style.css`;
  - fonts are the system's own (Segoe UI Variable on Windows 11), so nothing is downloaded.

## Evidence

- **Same results.** The end-to-end test (`tests/tools/browser_e2e.py`) drove the new page in Edge on the notebook's test project:
  - the notebook's 60 detections, probabilities within 3.4e-5;
  - the same 44 clips and 8 Raven tables;
  - the known difference in the order of tied species, and nothing else.
- **Contrast** computed from the tokens, in both themes:
  - text at least 6.1:1;
  - borders of fields and buttons at least 3.18:1.
- **Accessible names.** Every visible control has one.
- **Folder drop.** A drop simulated through Edge's DevTools read the same 9 recordings in 5 datasets as "Choose a folder".
- **Not tested:** Firefox, Safari, a screen reader's speech, a real phone, and a folder dropped by hand.

## Consequences

- **Selectors.** The page's element ids stay the same, except that "Delete the results stored in this browser" moved into Advanced and confirms in the page's own dialog. The end-to-end test was updated for that.
- **Logo.** Changing it now means editing the SVG shapes in `tools/make_icons.py` and rerunning it.
- **Reversal.** Restore `app/index.html`, `app/style.css`, `app/app.js`, `app/icons/` and `tools/make_icons.py` from the commit before this change. The pixel-art grids are in that version of `tools/make_icons.py`.
