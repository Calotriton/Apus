"""Writes app/apus/selftest_probs.f32: Google's TensorFlow model on apus.selftest.signal(). Run it with
Perch_notebooks' .venv, from the repository root:

    python tests/tools/selftest_reference.py
"""
import sys
from pathlib import Path

import numpy as np
import tensorflow as tf

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "app"))
from apus.selftest import REFERENCE, signal  # noqa: E402

MODEL = Path.home() / ".cache/kagglehub/models/google/bird-vocalization-classifier/tensorFlow2/perch_v2_cpu/1"
infer = tf.saved_model.load(str(MODEL)).signatures["serving_default"]
probs = tf.nn.softmax(infer(inputs=tf.constant(signal()))["label"], axis=-1).numpy()[0]
probs.astype("<f4").tofile(REFERENCE)
names = [n.strip() for n in (MODEL / "assets" / "labels.csv").read_text().splitlines()[1:]]
for i in np.argsort(probs)[::-1][:5]:
    print(f"{probs[i]:.4f}  {names[i]}")
