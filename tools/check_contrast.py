"""Contrast of every colour pair that must contrast (WCAG 2.2: text 4.5:1, controls and chart marks 3:1), in each
palette, by day and by night, computed from the tokens in app/style.css.

    python tools/check_contrast.py        # prints the lowest ratio of each kind; exits 1 if a pair fails
"""
import re
import sys
from pathlib import Path

CSS = (Path(__file__).resolve().parents[1] / "app" / "style.css").read_text(encoding="utf-8")
TEXT = [("ink", s) for s in ["bg", "surface", "surface-2", "hover", "accent-soft"]] + \
       [("ink-2", s) for s in ["bg", "surface", "surface-2", "hover", "accent-soft"]] + \
       [("accent", s) for s in ["bg", "surface", "surface-2", "accent-soft"]] + \
       [("on-accent", "accent"), ("on-accent", "accent-hover"), ("accent-hover", "accent-soft")]
MARKS = [("field-line", s) for s in ["surface", "surface-2", "bg"]] + \
        [(m, s) for m in ["accent", "bar", "s1", "s2", "s3"] for s in ["surface", "surface-2"]]


def tokens(block):
    return dict(re.findall(r"--([\w-]+):\s*(#[0-9a-fA-F]{6})", block))


def palettes():
    base = tokens(re.search(r":root \{(.*?)\n\}", CSS, re.S).group(1))
    out = {"apus": base}
    for name, block in re.findall(r':root\[data-palette="(\w+)"\] \{(.*?)\}', CSS, re.S):
        out[name] = {**base, **tokens(block)}
    return out


def luminance(hex_):
    c = [int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def ratio(a, b):
    la, lb = sorted([luminance(a), luminance(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)


failed = False
for name, t in palettes().items():
    for theme in ["l", "d"]:
        get = lambda k: t[f"{k}-{theme}"]                                   # noqa: E731
        for kind, pairs, need in [("text", TEXT, 4.5), ("marks", MARKS, 3.0)]:
            ratios = [(ratio(get(a), get(b)), a, b) for a, b in pairs]
            low = min(ratios)
            bad = [r for r in ratios if r[0] < need]
            failed |= bool(bad)
            print(f"{name:8} {'day' if theme == 'l' else 'night':5} {kind:5} lowest {low[0]:5.2f} ({low[1]} on {low[2]})"
                  + "".join(f"\n    FAIL {r:.2f} {a} on {b}" for r, a, b in bad))
sys.exit(1 if failed else 0)
