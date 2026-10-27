"""Draws the Apus logo, "Swift and call", into app/icons/: a common swift seen from below (anchor-shaped: sickle
wings, short forked tail) above a short waveform of its call, white on the app's teal. Edit the shapes below and rerun.

    py tools/make_icons.py

logo.svg              the logo, shown in the page header
favicon.svg           the browser-tab icon: the swift alone and larger, since the waveform turns to mush at 16 px
favicon-32.png        the same, for browsers that do not take SVG icons
apple-touch-icon.png  180 x 180, the logo on a full square (phones round the corners themselves)

The PNGs are drawn from the SVGs by Edge or Chrome, run headless.
"""
import shutil
import subprocess
import tempfile
from pathlib import Path

TEAL, WHITE = "#0f766e", "#ffffff"
# The swift, in a 100 x 100 box: wingtips at x 2 and 98, head at y 30, tail tips at y 72
SWIFT = ("M50 30C46 30 44 32 43 36C32 33 13 38 2 63C15 52 31 50 44 55C45 60 45 64 43 72C46 70 48 67 50 65"
         "C52 67 54 70 57 72C55 64 55 60 56 55C69 50 85 52 98 63C87 38 68 33 57 36C56 32 54 30 50 30Z")
# Its call: the length of each bar, left to right, drawn as rounded strokes about one line
CALL = [1, 4, 8, 4, 12, 7, 10, 4, 1]


def tile(body, size, radius):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="{size}" height="{size}">'
            f'<rect width="64" height="64" rx="{radius}" fill="{TEAL}"/>{body}</svg>\n')


def logo(size=64, radius=15):
    swift = f'<path transform="translate(7 -4) scale(0.5)" fill="{WHITE}" d="{SWIFT}"/>'   # x 8-56, y 11-32
    bars = "".join(f"M{14 + 4.5 * i:g} {46 - h / 2:g}v{h:g}" for i, h in enumerate(CALL))  # x 14-50, about y 46
    call = f'<path d="{bars}" stroke="{WHITE}" stroke-opacity="0.72" stroke-width="2.6" stroke-linecap="round"/>'
    return tile(swift + call, size, radius)


def favicon(size=64):
    return tile(f'<path transform="translate(32 33) scale(0.54) translate(-50 -51)" fill="{WHITE}" d="{SWIFT}"/>', size, 14)


def browser():
    for name in ("msedge", "chrome", "google-chrome", "chromium"):
        if found := shutil.which(name):
            return found
    for path in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                 r"C:\Program Files\Google\Chrome\Application\chrome.exe"):
        if Path(path).exists():
            return path
    raise SystemExit("Edge or Chrome is needed to draw the PNGs")


def png(svg, path, size):
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "icon.svg"
        src.write_text(svg, encoding="utf-8")
        subprocess.run([browser(), "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                        "--default-background-color=00000000", f"--user-data-dir={Path(tmp) / 'profile'}",
                        f"--window-size={size},{size}", f"--screenshot={path}", src.as_uri()],
                       check=True, capture_output=True, timeout=60)


if __name__ == "__main__":
    out = Path(__file__).resolve().parents[1] / "app" / "icons"
    out.mkdir(exist_ok=True)
    (out / "logo.svg").write_text(logo(), encoding="utf-8")
    (out / "favicon.svg").write_text(favicon(), encoding="utf-8")
    png(favicon(32), out / "favicon-32.png", 32)
    png(logo(180, radius=0), out / "apple-touch-icon.png", 180)
    print("wrote", ", ".join(sorted(p.name for p in out.iterdir())))
