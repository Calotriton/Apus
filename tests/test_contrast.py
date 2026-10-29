"""The colours: every pair that must contrast does (WCAG 2.2 AA), in each palette, by day and by night."""
import subprocess
import sys
from pathlib import Path


def test_every_palette_has_enough_contrast():
    tool = Path(__file__).resolve().parents[1] / "tools" / "check_contrast.py"
    result = subprocess.run([sys.executable, str(tool)], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout
