"""The swift's call Apus plays when a run ends (app/sounds/apus-apus.wav): one scream of a common swift,
cut from xeno-canto XC554033 by Luis Alvarez Menendez (Oviedo, Spain, 2020; CC BY-SA 4.0), band-passed to
3-11 kHz, cleaned of background noise by spectral subtraction, faded in and out, peak at -3 dBFS, 32 kHz mono.

    1. Download the recording: https://commons.wikimedia.org/wiki/File:Apus_apus_-_Common_Swift_XC554033.mp3
       (SHA-1 f402a1a2bfe1dc2bbf7f4b69ef37d770543d1590)
    2. python tools/make_chirp.py <the mp3> app/sounds/apus-apus.wav

The result is an adaptation of a CC BY-SA 4.0 work, so it carries the same licence (app/sounds/LICENSE.md).
"""
import sys

import numpy as np
import soundfile as sf
from scipy import signal

START_S, END_S = 1.97, 2.52                      # the first scream, before the others overlap it
NOISE_S = (0.1, 1.8)                             # no scream here: the noise profile


def main(src, out):
    y, sr = sf.read(src, dtype="float64", always_2d=True)
    y = signal.resample_poly(y.mean(axis=1), 32000, sr)
    sr = 32000
    y = signal.sosfiltfilt(signal.butter(6, [3000, 11000], btype="band", fs=sr, output="sos"), y)
    _, _, noise = signal.stft(y[int(NOISE_S[0] * sr):int(NOISE_S[1] * sr)], sr, nperseg=512)
    profile = np.mean(np.abs(noise) ** 2, axis=1, keepdims=True)
    seg = y[int(START_S * sr):int(END_S * sr)]
    _, _, z = signal.stft(seg, sr, nperseg=512)
    gain = np.clip(1 - 4.0 * profile / np.maximum(np.abs(z) ** 2, 1e-20), 0.02, 1)   # floor at -34 dB
    clean = signal.istft(z * gain, sr, nperseg=512)[1][:len(seg)]
    fade_in, fade_out = int(0.012 * sr), int(0.08 * sr)
    clean[:fade_in] *= np.linspace(0, 1, fade_in)
    clean[-fade_out:] *= np.linspace(1, 0, fade_out) ** 2
    sf.write(out, (clean * 0.7 / np.abs(clean).max()).astype(np.float32), sr, subtype="PCM_16")


if __name__ == "__main__":
    main(*sys.argv[1:3])
