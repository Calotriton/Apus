"""Apus's audio path must give exactly what the notebook's librosa calls give (bit for bit)."""
import librosa
import numpy as np
import pytest
import soundfile as sf

from apus.audio import SAMPLE_RATE, WINDOW, Recording, load_clip, peak_normalize

RATES = [16000, 22050, 24000, 32000, 44100, 48000, 96000, 192000]


def make_audio(path, sr, seconds, channels=1, subtype="PCM_16", seed=0):
    """A tone plus noise, written to `path`."""
    rng = np.random.default_rng(seed)
    n = int(sr * seconds)
    x = 0.3 * np.sin(2 * np.pi * 3000 * np.arange(n) / sr)[:, None] + 0.05 * rng.standard_normal((n, channels))
    sf.write(path, x if channels > 1 else x[:, 0], sr, subtype=subtype)
    return path


def notebook_frames(path, hop_s):
    """The notebook's load_audio + frame_windows."""
    audio, _ = librosa.load(str(path), sr=SAMPLE_RATE, mono=True, res_type="polyphase")
    if len(audio) < WINDOW:
        audio = librosa.util.pad_center(audio, size=WINDOW, axis=-1)
    return librosa.util.frame(audio, frame_length=WINDOW, hop_length=int(hop_s * SAMPLE_RATE),
                              axis=-1).swapaxes(-1, -2)


@pytest.mark.parametrize("sr", RATES)
@pytest.mark.parametrize("channels", [1, 2])
def test_any_piece_equals_librosa_load(tmp_path, sr, channels):
    path = make_audio(tmp_path / "a.wav", sr, 13.7, channels)
    whole, _ = librosa.load(str(path), sr=SAMPLE_RATE, mono=True, res_type="polyphase")
    rec = Recording(path)
    assert rec.n == len(whole)
    for n0, n1 in [(0, 1000), (0, rec.n), (12345, 12345 + WINDOW), (rec.n - 7, rec.n), (31999, 64001)]:
        assert np.array_equal(rec.samples(n0, n1), whole[n0:n1]), (n0, n1)


@pytest.mark.parametrize("subtype,ext", [("PCM_24", "wav"), ("PCM_32", "wav"), ("FLOAT", "wav"), ("PCM_16", "flac")])
def test_encodings(tmp_path, subtype, ext):
    path = make_audio(tmp_path / f"e.{ext}", 44100, 7.1, 2, subtype)
    whole, _ = librosa.load(str(path), sr=SAMPLE_RATE, mono=True, res_type="polyphase")
    assert np.array_equal(Recording(path).samples(0, len(whole)), whole)


@pytest.mark.parametrize("seconds", [0.4, 3.0, 5.0, 23.3])
@pytest.mark.parametrize("hop_s", [5.0, 2.5])
def test_windows_equal_notebook(tmp_path, seconds, hop_s):
    path = make_audio(tmp_path / "w.wav", 48000, seconds, 2)
    expected = notebook_frames(path, hop_s)
    rec, hop = Recording(path), int(hop_s * SAMPLE_RATE)
    n = rec.window_count(hop)
    assert n == len(expected)
    got = np.concatenate([rec.windows(w0, min(n, w0 + 3), hop) for w0 in range(0, n, 3)])
    assert np.array_equal(got, expected)
    assert np.array_equal(peak_normalize(got), peak_normalize(expected))


def test_silence_stays_zero():
    assert not peak_normalize(np.zeros((2, WINDOW), np.float32)).any()


@pytest.mark.parametrize("offset", [0.0, 3.7, 18.5])
def test_clip_equals_librosa(tmp_path, offset):
    path = make_audio(tmp_path / "c.wav", 48000, 20.0, 2)
    expected, _ = librosa.load(str(path), sr=SAMPLE_RATE, mono=True, offset=offset, duration=7.0,
                               res_type="polyphase")
    assert np.array_equal(load_clip(path, offset, 7.0), expected)


def test_empty_file_is_refused(tmp_path):
    path = tmp_path / "empty.wav"
    sf.write(path, np.zeros(0), 32000)
    with pytest.raises(RuntimeError, match="no audio"):
        Recording(path)
