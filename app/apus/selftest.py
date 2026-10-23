"""The start-up check of the model's backend (ADR 0004): one synthetic window whose probabilities from
Google's TensorFlow model are stored next to this file. A backend whose result differs by more than
TOLERANCE, or whose top class differs, is not used."""
from pathlib import Path

import numpy as np

from .audio import SAMPLE_RATE, WINDOW, peak_normalize

TOLERANCE = 1e-4
REFERENCE = Path(__file__).parent / "selftest_probs.f32"     # TF softmax, float32 little-endian [14795]


def signal():
    """5 s of eight falling whistles (5 to 3 kHz, 0.25 s each), like a simple song. No randomness."""
    t = np.arange(WINDOW) / SAMPLE_RATE
    y = np.zeros(WINDOW)
    for k in range(8):
        tau = t - (0.3 + 0.55 * k)
        on = (tau >= 0) & (tau < 0.25)
        phase = 2 * np.pi * (5000 * tau - 2000 / (2 * 0.25) * tau ** 2)
        y[on] += np.sin(phase[on]) * np.sin(np.pi * tau[on] / 0.25)
    return peak_normalize(y.astype(np.float32)[None, :])


def check(probs):
    """(passed, max |Δp|) for the probabilities a backend gave for signal()."""
    reference = np.fromfile(REFERENCE, dtype="<f4")
    probs = np.asarray(probs, dtype=np.float32).reshape(-1)
    worst = float(np.abs(probs - reference).max())
    return worst <= TOLERANCE and int(probs.argmax()) == int(reference.argmax()), worst
