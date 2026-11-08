"""Private, bounded streaming rhythm estimation using NumPy only.

Positive spectral flux and onset correlation are standard beat-tracking
building blocks (https://librosa.org/doc/0.11.0/generated/librosa.beat.beat_track.html).
This independent implementation retains scalar novelty, not an audio recording.
Tempo is an estimate, not musical metre: genuinely ambiguous rhythms stay unknown.
"""

from collections import deque

import numpy as np


UNKNOWN = {"tempo": 0.0, "tempoConfidence": 0.0, "beatPhase": 0.0}


class TempoTracker:
    SAMPLE_RATE = 16000
    FFT_SIZE = 512
    HOP = 160
    HISTORY_FRAMES = 1200

    def __init__(self):
        self.window = np.hanning(self.FFT_SIZE).astype(np.float32)
        self.reset()

    def reset(self):
        self.samples = np.empty(0, dtype=np.float32)
        self.onsets = deque(maxlen=self.HISTORY_FRAMES)
        self.times = deque(maxlen=self.HISTORY_FRAMES)
        self.previous = None
        self.sample_count = 0
        self.nonmusic = 0
        self.locked = None
        self.candidate = None
        self.candidate_count = 0

    def accept(self, samples):
        """Consume one contiguous PCM block; the caller resets on sequence gaps."""
        value = np.asarray(samples, dtype=np.float32)
        if value.ndim != 1 or not 0 < value.size <= self.SAMPLE_RATE:
            raise ValueError("Invalid tempo samples")
        if not np.isfinite(value).all():
            raise ValueError("Invalid tempo samples")
        start = self.sample_count - self.samples.size
        self.sample_count += value.size
        audio = np.concatenate((self.samples, np.clip(value, -1.0, 1.0)))
        if audio.size < self.FFT_SIZE:
            self.samples = audio
            return
        frames = np.lib.stride_tricks.sliding_window_view(audio, self.FFT_SIZE)[
            :: self.HOP
        ]
        # Preserve attack amplitude: heavy logarithmic compression makes quiet
        # offbeats indistinguishable from the beat and creates octave ambiguity.
        spectra = np.abs(np.fft.rfft(frames * self.window, axis=-1))[:, 1:241]
        previous = np.vstack(
            (spectra[0] if self.previous is None else self.previous, spectra[:-1])
        )
        difference = np.maximum(spectra - previous, 0.0)
        # Average frequency bands separately: otherwise a broadband backbeat
        # snare overwhelms a narrow bass kick and every second beat wins.
        novelty = (
            0.45 * difference[:, :8].mean(axis=1)
            + 0.35 * difference[:, 8:64].mean(axis=1)
            + 0.20 * difference[:, 64:].mean(axis=1)
        )
        self.previous = spectra[-1].copy()
        for index, flux in enumerate(novelty):
            self.onsets.append(float(flux))
            # FFT centres locate attacks; phase below is advanced to packet END.
            self.times.append((start + index * self.HOP + 256) / self.SAMPLE_RATE)
        self.samples = audio[len(frames) * self.HOP :].copy()

    @staticmethod
    def _correlation(envelope, lag):
        shift = int(round(lag))
        if shift < 1 or shift * 3 >= envelope.size:
            return 0.0
        left, right = envelope[:-shift], envelope[shift:]
        denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
        return float(np.dot(left, right) / denominator) if denominator > 1e-12 else 0.0

    @staticmethod
    def _phase(times, weights, period):
        # A first-harmonic vector cancels valid beats against equally strong
        # offbeats. Locate a supported pulse grid instead; no synthetic beat is
        # inserted into a gap in the observed onset envelope.
        phases = (times / period) % 1.0
        grid = np.arange(64, dtype=np.float64) / 64
        distance = (phases[None, :] - grid[:, None] + 0.5) % 1.0 - 0.5
        kernels = np.exp(-0.5 * (distance / 0.075) ** 2)
        support = kernels @ weights / np.sum(weights)
        best = int(np.argmax(support))
        local_weights = kernels[best] * weights
        vector = np.sum(np.exp(2j * np.pi * phases) * local_weights)
        offset = float(np.angle(vector) / (2 * np.pi))
        return offset, float(support[best])

    def estimate(self, music=True):
        """Return bounded BPM/confidence and beat phase at the latest packet end.

        The classifier owns music-vs-speech gating. Three rejected classification
        windows clear prewarming so earlier tracks cannot animate later speech.
        """
        if not music:
            self.nonmusic += 1
            if self.nonmusic >= 3:
                self.reset()
                self.nonmusic = 3
            return dict(UNKNOWN)
        self.nonmusic = 0
        if len(self.onsets) < 550:
            return dict(UNKNOWN)
        # Eight seconds responds to track changes; retained twelve-second history
        # bounds memory and leaves room for future low-tempo confidence policies.
        raw = np.asarray(self.onsets, dtype=np.float64)[-800:]
        times = np.asarray(self.times, dtype=np.float64)[-800:]
        baseline = np.convolve(
            np.pad(raw, (10, 10), mode="edge"), np.ones(21) / 21, "valid"
        )
        envelope = np.maximum(raw - baseline, 0.0)
        envelope = np.convolve(envelope, [0.25, 0.5, 0.25], "same")
        peak = float(np.max(envelope))
        if peak < 0.005:
            return dict(UNKNOWN)
        peaks = np.flatnonzero(
            (envelope[1:-1] >= envelope[:-2])
            & (envelope[1:-1] > envelope[2:])
            & (envelope[1:-1] >= peak * 0.18)
        ) + 1
        if peaks.size < 5:
            return dict(UNKNOWN)
        centred = envelope - float(np.mean(envelope))
        correlations = np.array(
            [self._correlation(centred, lag) for lag in range(25, 151)]
        )
        candidates = []
        for index, direct in enumerate(correlations):
            if direct < 0.35:
                continue
            if index and direct < correlations[index - 1]:
                continue
            if index + 1 < len(correlations) and direct < correlations[index + 1]:
                continue
            lag = float(index + 25)
            if 0 < index < len(correlations) - 1:
                a, b, c = correlations[index - 1 : index + 2]
                denominator = a - 2 * b + c
                if denominator < -1e-9:
                    lag += float(np.clip(0.5 * (a - c) / denominator, -0.5, 0.5))
            support = 0.0
            weight = 0.0
            for multiplier, strength in [(1, 0.6), (2, 0.25), (3, 0.15)]:
                if lag * multiplier * 3 < centred.size:
                    support += (
                        max(0, self._correlation(centred, lag * multiplier)) * strength
                    )
                    weight += strength
            _, phase_support = self._phase(
                times[peaks], envelope[peaks], lag / 100.0
            )
            # Long-lag correlations can win by chance under small timing jitter.
            # A real beat also places attacks on one grid; a spurious third-time
            # candidate spreads the same attacks over three phase positions.
            score = (
                support / max(weight, 1e-9)
                - 0.065 * lag / 150
                + 0.4 * phase_support
            )
            candidates.append((score, lag, float(direct)))
        if not candidates:
            return dict(UNKNOWN)
        candidates.sort(reverse=True)
        score, lag, direct = candidates[0]
        # A period with the same evidence but twice the length is not an extra
        # beat. Prefer the primitive period, while preserving alternating accents.
        for option in candidates[1:]:
            ratio = lag / option[1]
            if abs(ratio - round(ratio)) < 0.045 and 1.8 < ratio < 4.2:
                if option[0] >= score - 0.08 and option[2] >= direct * 0.86:
                    score, lag, direct = option
        bpm = float(np.clip(6000.0 / lag, 40.0, 240.0))
        if self.locked is not None:
            ratio = bpm / self.locked
            if abs(ratio - 2) < 0.06 or abs(ratio - 0.5) < 0.025:
                old_lag = 6000 / self.locked
                old = self._correlation(centred, old_lag)
                _, old_phase = self._phase(
                    times[peaks], envelope[peaks], old_lag / 100.0
                )
                _, new_phase = self._phase(
                    times[peaks], envelope[peaks], lag / 100.0
                )
                if old >= direct * 0.88 and old_phase >= max(0.35, new_phase * 0.85):
                    bpm, lag, direct = self.locked, old_lag, old
        period = lag / 100.0
        weights = envelope[peaks]
        _, coherence = self._phase(times[peaks], weights, period)
        confidence = float(np.clip(0.65 * direct + 0.35 * coherence, 0.0, 1.0))
        if coherence < 0.35 or confidence < 0.53:
            return dict(UNKNOWN)
        if self.sample_count / self.SAMPLE_RATE - times[peaks[-1]] > period * 2.2:
            return dict(UNKNOWN)
        if self.candidate is not None and abs(bpm / self.candidate - 1) < 0.035:
            self.candidate_count += 1
        else:
            self.candidate_count = 1
        self.candidate = bpm
        if self.candidate_count < 2:
            return dict(UNKNOWN)
        if self.locked is not None and abs(bpm / self.locked - 1) < 0.025:
            bpm = self.locked * 0.6 + bpm * 0.4
        self.locked = bpm
        # Recompute phase after any small tempo smoothing, avoiding a phase jump
        # caused solely by expressing the old period with the smoothed BPM.
        period = 60.0 / bpm
        beat_offset, _ = self._phase(times[peaks], weights, period)
        phase = (self.sample_count / self.SAMPLE_RATE / period - beat_offset) % 1.0
        return {
            "tempo": round(bpm, 3),
            "tempoConfidence": round(confidence, 6),
            "beatPhase": min(0.999999, round(phase, 6)),
        }
