"""Perch's input, made as the notebook makes it (perch-hoplite's recipe).

librosa does not run in the browser, so `librosa.load(path, sr=32000, mono=True, res_type="polyphase")`
is rebuilt here from soundfile and scipy, with the same arithmetic: soundfile's float32 samples, the float32
mean over channels, `scipy.signal.resample_poly`, librosa's `fix_length`, then float32.
Long files are read in pieces. A piece that starts at a multiple of `down` input samples, with enough
input around it, gives bit for bit the samples that resampling the whole file gives.
"""
import math
from contextlib import contextmanager

import numpy as np
import scipy.signal
import soundfile as sf

SAMPLE_RATE = 32_000
WINDOW_S = 5.0                                 # fixed by the model
WINDOW = int(WINDOW_S * SAMPLE_RATE)
RESAMPLER = "polyphase"                        # perch-hoplite's resampler
TARGET_PEAK = 0.25                             # perch-hoplite's peak normalisation
READ_BUFFER = 8 << 20                          # in the browser each read of a file is a slow round trip


@contextmanager
def open_audio(path):
    """soundfile on a buffered file: the decoding is the same, the reads are few and large."""
    with open(path, "rb", buffering=READ_BUFFER) as raw, sf.SoundFile(raw) as f:
        yield f


def to_mono(y):
    """librosa.to_mono: y is (channels, samples) or (samples,)."""
    return np.mean(y, axis=tuple(range(y.ndim - 1))) if y.ndim > 1 else y


def resample(y, sr):
    """librosa.resample(y, orig_sr=sr, target_sr=32000, res_type="polyphase") for a whole signal."""
    if sr == SAMPLE_RATE:
        return y
    g = math.gcd(sr, SAMPLE_RATE)
    y_hat = scipy.signal.resample_poly(y, SAMPLE_RATE // g, sr // g, axis=-1)
    n = int(np.ceil(y.shape[-1] * (float(SAMPLE_RATE) / sr)))
    y_hat = np.pad(y_hat, (0, max(0, n - len(y_hat))))[:n]          # librosa's fix_length
    return np.asarray(y_hat, dtype=y.dtype)


def resampled_length(frames, sr):
    """Length at 32 kHz after librosa's fix_length: ceil(frames * ratio), with the ratio as a float, as librosa does."""
    return frames if sr == SAMPLE_RATE else int(np.ceil(frames * (float(SAMPLE_RATE) / sr)))


def window_count(n, hop):
    """librosa.util.frame's count for n samples at 32 kHz (a file under 5 s gives one centred window)."""
    return 1 if n < WINDOW else 1 + (n - WINDOW) // hop


LOSSY = {"VORBIS", "OPUS", "MPEG_LAYER_I", "MPEG_LAYER_II", "MPEG_LAYER_III"}


def inspect(path, hop):
    """What a file holds, from its header alone (nothing is decoded)."""
    with sf.SoundFile(str(path)) as f:
        sr, frames, channels, fmt, subtype = f.samplerate, f.frames, f.channels, f.format, f.subtype
    return {"seconds": frames / sr if sr else 0.0, "sr": sr, "channels": channels, "format": fmt,
            "lossy": subtype in LOSSY, "windows": window_count(resampled_length(frames, sr), hop) if frames else 0}


class Recording:
    """One audio file, served as 32 kHz mono samples, any slice at a time."""

    def __init__(self, path):
        self.path = str(path)
        with sf.SoundFile(self.path) as f:
            self.sr, self.frames = f.samplerate, f.frames
        if self.frames == 0:
            raise RuntimeError("the file holds no audio")
        g = math.gcd(self.sr, SAMPLE_RATE)
        self.up, self.down = SAMPLE_RATE // g, self.sr // g
        self.n = resampled_length(self.frames, self.sr)

    def _read(self, k0, k1):
        """Mono float32 input samples [k0, k1), as librosa.load reads them."""
        with open_audio(self.path) as f:
            f.seek(k0)
            y = f.read(k1 - k0, dtype="float32", always_2d=False)
        return to_mono(y.T)

    def samples(self, n0, n1):
        """Samples [n0, n1) of the whole recording at 32 kHz (0 <= n0 <= n1 <= self.n)."""
        if self.sr == SAMPLE_RATE:
            return self._read(n0, n1)
        up, down = self.up, self.down
        half_len = 10 * max(up, down)                       # resample_poly's filter: 2 * half_len + 1 taps
        n_pre_pad = down - half_len % down
        n_pre_remove = (half_len + n_pre_pad) // down
        n_poly = -(-self.frames * up // down)               # resample_poly's own output length
        out = np.zeros(n1 - n0, dtype=np.float32)           # past n_poly, fix_length pads with zeros
        m1 = min(n1, n_poly)
        if m1 > n0:
            # The input samples that outputs [n0, m1) depend on, widened to start at a multiple of down
            k_lo = -(-((n0 + n_pre_remove) * down - n_pre_pad - 2 * half_len) // up)
            k_hi = ((m1 - 1 + n_pre_remove) * down - n_pre_pad) // up
            start = max(0, k_lo // down * down)
            stop = min(self.frames, k_hi + 1 + down)
            y = scipy.signal.resample_poly(self._read(start, stop), up, down)
            shift = start // down * up                      # output index of the piece's first sample
            out[:m1 - n0] = y[n0 - shift:m1 - shift]
        return out

    def window_count(self, hop):
        """librosa.util.frame's count (a file under 5 s gives one centred window)."""
        return window_count(self.n, hop)

    def windows(self, w0, w1, hop):
        """Windows [w0, w1) of 5 s every `hop` samples, as float32 [w1 - w0, WINDOW]."""
        if self.n < WINDOW:                                  # librosa.util.pad_center
            lpad = (WINDOW - self.n) // 2
            return np.pad(self.samples(0, self.n), (lpad, WINDOW - self.n - lpad))[None, :]
        y = self.samples(w0 * hop, (w1 - 1) * hop + WINDOW)
        return np.stack([y[(w - w0) * hop:(w - w0) * hop + WINDOW] for w in range(w0, w1)])


def peak_normalize(frames, target_peak=TARGET_PEAK):
    """Per window: remove the mean, then scale so the loudest sample is target_peak (silence stays 0)."""
    frames = frames.astype(np.float32).copy()
    frames -= frames.mean(axis=-1, keepdims=True)
    peak = np.max(np.abs(frames), axis=-1, keepdims=True)
    frames = np.divide(frames, peak, out=np.zeros_like(frames), where=peak > 0.0)
    return frames * target_peak


def spectrogram(y, db_range=80.0):
    """For the page: magnitude in dB over 0-16 kHz (Hann window of 512 samples, hop of 256), scaled to 0-255
    over the top db_range dB. Returns (uint8 bytes with the lowest frequency first, width, height)."""
    _, _, s = scipy.signal.spectrogram(np.asarray(y, dtype=np.float32), fs=SAMPLE_RATE, window="hann",
                                       nperseg=512, noverlap=256, mode="magnitude")
    db = 20 * np.log10(s[:256] + 1e-10)
    scaled = np.clip((db - (db.max() - db_range)) / db_range, 0, 1) * 255
    return scaled.astype(np.uint8).tobytes(), scaled.shape[1], scaled.shape[0]


def load_clip(path, offset, duration):
    """librosa.load(path, sr=32000, mono=True, offset=offset, duration=duration, res_type="polyphase")."""
    with open_audio(str(path)) as f:
        sr = f.samplerate
        if offset:
            f.seek(int(offset * sr))
        y = f.read(int(duration * sr), dtype="float32", always_2d=False).T
    return resample(to_mono(y), sr)
