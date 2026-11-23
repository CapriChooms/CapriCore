"""Reuse Whisper's first encoder window for language detection and transcription.

The pinned faster-whisper drops one terminal feature frame when transcribing,
but not when detecting language. Align those windows, then reuse an encoder
result only for byte-identical features. All text decoding/alignment stays native.
The cache lives for one utterance, including its lazy segment iterator.
"""
from contextlib import contextmanager

import numpy as np
from faster_whisper import WhisperModel


class SharedEncoderWhisper(WhisperModel):
    @contextmanager
    def reuse_encoder(self):
        self._shared_encoder_active = True
        self._shared_encoder_entry = None
        try:
            yield
        finally:
            # Never retain speech features across requests or cache failures.
            self._shared_encoder_entry = None
            self._shared_encoder_active = False

    def detect_language(self, audio=None, features=None, **kwargs):
        if (getattr(self, '_shared_encoder_active', False) and features is not None
                and 1 < features.shape[-1] <= self.feature_extractor.nb_max_frames):
            # Match generate_segments' content_frames = features.shape[-1] - 1.
            # Longer windows already have an identical, full first chunk.
            features = features[..., :-1]
        return super().detect_language(audio=audio, features=features, **kwargs)

    def encode(self, features):
        if not getattr(self, '_shared_encoder_active', False):
            return super().encode(features)
        entry = self._shared_encoder_entry
        if entry is not None and entry[0].dtype == features.dtype and np.array_equal(entry[0], features):
            return entry[1]
        result = super().encode(features)
        self._shared_encoder_entry = (features.copy(), result)
        return result
