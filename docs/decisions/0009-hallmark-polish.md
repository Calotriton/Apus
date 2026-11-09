# 0009. Hallmark's rules for app screens as a checklist, a small polish, and the original look kept
Status: Accepted
Date: 2026-11-09

## Context

The owner found Hallmark (github.com/nutlope/hallmark, MIT), a design skill for coding assistants, and asked how it could improve the Apus site. Hallmark has fifty themes, page structures for marketing sites, and a set of rules it never relaxes (its "Floor"). For a tool screen it drops the marketing rules and keeps the Floor. It lends a theme's palette, typefaces and surfaces, never its layout.

The skill is installed for this project only, in `.claude/skills/hallmark/`, which git ignores. Its linter needs Node, which this machine does not have, so the Floor was checked by hand against `app/`.

## Options considered

1. **Polish only.** Fix where Apus breaks the Floor and keep the look approved in ADRs 0006 and 0008:
   - section labels in sentence case, not small spaced capitals;
   - facts set apart by thin vertical rules instead of runs of middle dots;
   - progress bars grown with `transform` instead of `width`;
   - the last raw colours as tokens;
   - `overflow-x: clip` on the page.
2. **Restyle with Furrow** (field records). Warm paper and ink rules. Red Hat Display, Text and Mono. Teal kept.
3. **Restyle with Almanac** (reference tables). Slate paper, square corners, Hanken Grotesk headings, Newsreader serif text and IBM Plex Mono figures. Teal one step darker by day.
4. **Nothing.**

The options were shown as screenshots of the real app run on the test recordings in Edge, in day, night, phone width and Spanish:
- polish: https://claude.ai/artifact/NokHqMVbKiWWURhZH8ASXW
- restyles: https://claude.ai/artifact/CJfE27xQPeGdh1Ee3aY5ND

Both restyles passed the contrast check. They would have needed web fonts bundled with the site and the four other palettes reworked.

## Decision

The owner chose to keep the original Apus look and to apply the full polish (option 1).

Not taken:
- **The open results tab in the URL.** The tab is already remembered, results live in each browser, and the tab names collide with element ids.
- **The single dot in "Model ready · GPU".** It stays, because Hallmark allows one dot in a live status.

## Evidence

- All three versions found the same 60 detections of 15 species on the 9 test recordings, with no page errors and no sideways scroll at 390 px.
- `tools/check_contrast.py` passes for every palette and theme.
- The full test suite passes (83 tests, 2026-11-09).
- Hallmark's own rules are grey literature (developer material), not evidence about users. They were used as a checklist, not as a reason to change the look.

## Consequences

- Multi-part status lines go through `facts()` in `app.js` and the `.facts` class. Each part is a translated text of its own, and `i18n.js` has six new Spanish entries.
- `esc` moved to the top of `app.js`, because `facts()` uses it early.
- Twelve hard-coded 12 px radii remain in `style.css`. They could become a radius token if the look changes again.
- To reverse, revert the change to `app/style.css`, `app/app.js`, `app/index.html` and `app/i18n.js`.
