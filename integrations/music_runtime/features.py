"""NumPy-only YAMNet frontend matching its pinned TorchAudio export.

16 kHz mono; periodic 400-sample Hann window centered in a 512-point FFT;
160-sample hop; 64 HTK mel bands (125..7500 Hz); log(magnitude + .001).
The implementation is independent of Torch/TensorFlow and uses no device I/O.
"""

import numpy as np

SAMPLE_RATE = 16000
PATCH_SAMPLES = 16000
PATCH_FRAMES = 96


def _mel_bank():
    frequencies = np.linspace(0.0, 8000.0, 257, dtype=np.float64)
    mel_edges = np.linspace(
        2595.0 * np.log10(1.0 + 125.0 / 700.0),
        2595.0 * np.log10(1.0 + 7500.0 / 700.0),
        66,
    )
    edges = 700.0 * (10.0 ** (mel_edges / 2595.0) - 1.0)
    rising = (frequencies[:, None] - edges[:-2]) / (edges[1:-1] - edges[:-2])
    falling = (edges[2:] - frequencies[:, None]) / (edges[2:] - edges[1:-1])
    return np.maximum(0.0, np.minimum(rising, falling)).astype(np.float32)


MEL_BANK = _mel_bank()
HANN_WINDOW = np.pad(
    (0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(400) / 400)).astype(np.float32),
    (56, 56),
)


def log_mel_patch(samples):
    """Return the pinned classifier's finite float32 [1,1,96,64] tensor."""
    waveform = np.asarray(samples, dtype=np.float32)
    if waveform.ndim != 1 or waveform.size > SAMPLE_RATE * 3:
        raise ValueError("Invalid music sample shape")
    if not np.isfinite(waveform).all():
        raise ValueError("Invalid music samples")
    waveform = np.clip(waveform[-PATCH_SAMPLES:], -1.0, 1.0)
    if waveform.size < PATCH_SAMPLES:
        waveform = np.pad(waveform, (0, PATCH_SAMPLES - waveform.size))
    frames = np.lib.stride_tricks.sliding_window_view(
        np.pad(waveform, (256, 256), mode="reflect"), 512
    )[::160]
    magnitude = np.abs(np.fft.rfft(frames * HANN_WINDOW, axis=-1)).astype(np.float32)
    features = np.log(magnitude @ MEL_BANK + np.float32(0.001))
    return features[:PATCH_FRAMES].reshape(1, 1, PATCH_FRAMES, 64).astype(np.float32)


def probabilities(logits):
    """The Qualcomm export returns logits, unlike TF-Hub's probabilities."""
    return 1.0 / (1.0 + np.exp(-np.clip(np.asarray(logits), -60.0, 60.0)))
