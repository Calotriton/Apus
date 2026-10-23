"""Draws the Apus logo, "Swift and call", into app/icons/. The art is the text grids below: edit them and rerun.

    py tools/make_icons.py

logo-32.png           32 x 32, the logo itself (shown at 2x in the page header)
favicon-16.png        16 x 16, redrawn for browser tabs, where a halved 32 px drawing turns to mush
apple-touch-icon.png  180 x 180, the logo at 5x on a full square (phones round the corners themselves)
"""
import struct
import zlib
from pathlib import Path

PALETTE = {"a": "#0f766e",   # sky, the app's teal
           "b": "#154640",   # soft edge, half bird and half sky
           "c": "#1b1613",   # the swift
           "d": "#3b3029",   # its paler flight feathers
           "e": "#7fe3d0"}   # the call's waveform
# A common swift from below (anchor-shaped: sickle wings, short forked tail) above a waveform; "_" is transparent
LOGO_32 = """
___aaaaaaaaaaaaaaaaaaaaaaaaaa___
__aaaaaaaaaaaaaaaaaaaaaaaaaaaa__
_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
aaaaaaaaaaaaaabccbaaaaaaaaaaaaaa
aaaaaaaaaaaaaaccccaaaaaaaaaaaaaa
aaaaaaaaaabccccccccccbaaaaaaaaaa
aaaaaaaabccccccccccccccbaaaaaaaa
aaaaaabccccccccccccccccccbaaaaaa
aaaaabcccddddccccccddddcccbaaaaa
aaaabcdddaaaaaccccaaaaadddcbaaaa
aaabcdaaaaaaaaccccaaaaaaaadcbaaa
aabcdaaaaaaaaaccccaaaaaaaaadcbaa
aabdaaaaaaaaaacaacaaaaaaaaaadbaa
abcaaaaaaaaaaaaaaaaaaaaaaaaaacba
abcaaaaaaaaaaaaaaaaaaaaaaaaaacba
acaaaaaaaaaaaaaaaaaaaaaaaaaaaaca
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
aaaaaaaaaaaaaaaaaaaaaeaaaaaaaaaa
aaaaaaaaaeaaaaaaaaaeaeaeaaaaaaaa
aaaaaaaeaeaeaaaaaaaeaeaeaaaaaaaa
aaaaaeaeaeaeaeaaaeaeaeaeaeaaaaaa
aaaeaeaeaeaeaeaeaeaeaeaeaeaeaeaa
aaaeaeaeaeaeaeaeaeaeaeaeaeaeaeaa
aaaaaeaeaeaeaeaaaeaeaeaeaeaaaaaa
aaaaaaaeaeaeaaaaaaaeaeaeaaaaaaaa
aaaaaaaaaeaaaaaaaaaeaeaeaaaaaaaa
_aaaaaaaaaaaaaaaaaaaaeaaaaaaaaa_
__aaaaaaaaaaaaaaaaaaaaaaaaaaaa__
___aaaaaaaaaaaaaaaaaaaaaaaaaa___
"""
FAVICON_16 = """
__aaaaaaaaaaaa__
_aaaaaaaaaaaaaa_
aaaaaaaccaaaaaaa
aaaaaccccccaaaaa
aaaccccccccccaaa
aaccaaaccaaaccaa
acaaaaaccaaaaaca
acaaaaaaaaaaaaca
aaaaaaaaaaaaaaaa
aaaaaaaaaaaaaaaa
aaaaaaaaaeaaaaaa
aaaeaaaeaeaeaaaa
aeaeaeaeaeaeaeaa
aaaeaaaeaeaeaaaa
_aaaaaaaaeaaaaa_
__aaaaaaaaaaaa__
"""


def grid(art):
    rows = art.strip().splitlines()
    assert len({len(r) for r in rows}) == 1 and len(rows) == len(rows[0]), "the art must be a square"
    return rows


def write_png(rows, path, scale=1, pad=0, pad_colour=None):
    """RGBA PNG, each art pixel `scale` x `scale`; `pad` pixels of pad_colour around it."""
    def rgba(ch):
        if ch == "_":
            return bytes.fromhex(pad_colour[1:]) + b"\xff" if pad_colour else b"\x00\x00\x00\x00"
        return bytes.fromhex(PALETTE[ch][1:]) + b"\xff"
    edge = (bytes.fromhex(pad_colour[1:]) + b"\xff") if pad_colour else b"\x00\x00\x00\x00"
    size = len(rows) * scale + 2 * pad
    raw = b"".join(b"\x00" + edge * size for _ in range(pad))
    for row in rows:
        line = edge * pad + b"".join(rgba(ch) * scale for ch in row) + edge * pad
        raw += (b"\x00" + line) * scale
    raw += b"".join(b"\x00" + edge * size for _ in range(pad))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))  # noqa: E731
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    out = Path(__file__).resolve().parents[1] / "app" / "icons"
    out.mkdir(exist_ok=True)
    write_png(grid(LOGO_32), out / "logo-32.png")
    write_png(grid(FAVICON_16), out / "favicon-16.png")
    write_png(grid(LOGO_32), out / "apple-touch-icon.png", scale=5, pad=10, pad_colour=PALETTE["a"])
    print("wrote", ", ".join(sorted(p.name for p in out.glob("*.png"))))
