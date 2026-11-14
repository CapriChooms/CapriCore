"""Deterministic synthetic rhythm tests: no devices, downloads or recordings."""
# ruff: noqa: E402 -- Allow direct checkout execution.

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

import numpy as np

from integrations.music_runtime.tempo import TempoTracker

RATE = 16000


def rhythm(bpm, seconds=16, offset=0.173, offbeats=False, gain=0.4, jitter=0):
    """A pitched/percussive pulse with quieter optional offbeat chords."""
    audio = np.zeros(int(seconds * RATE), np.float32)
    rng = np.random.default_rng(61791)
    time = np.arange(2400) / RATE
    attack = (
        np.sin(2 * np.pi * (85 * time - 170 * time**2)) * np.exp(-28 * time)
        + 0.35
        * sum(np.sin(2 * np.pi * frequency * time) for frequency in [220, 277, 330])
        * np.exp(-20 * time)
        + rng.normal(0, 0.3, time.size) * np.exp(-90 * time)
    )
    period = 60 / bpm
    for index, onset in enumerate(np.arange(offset, seconds, period)):
        onset += rng.normal(0, period * jitter) if jitter else 0
        strength = 1 if index % 2 == 0 else 0.8
        additions = [(onset + period / 2, 0.3)] if offbeats else []
        for at, volume in [(onset, strength)] + additions:
            start = int(at * RATE)
            size = min(attack.size, audio.size - start)
            if size > 0:
                audio[start : start + size] += attack[:size] * gain * volume
    return audio


def feed(tracker, audio, size=8000):
    result = None
    for index in range(0, len(audio), size):
        tracker.accept(audio[index : index + size])
        if (index + size) % RATE == 0:
            result = tracker.estimate()
    return result


class TempoTests(unittest.TestCase):
    def test_soft_slow_notes_survive_louder_irregular_accents(self):
        bpm, seconds = 52, 14
        rng = np.random.default_rng(0)
        audio = 0.025 * np.sin(2 * np.pi * 87.13 * np.arange(seconds * RATE) / RATE)

        def add_note(onset, gain, frequency):
            start = int(onset * RATE)
            time = np.arange(min(22500, audio.size - start)) / RATE
            attack = np.minimum(1, time / 0.10) ** 2 * np.exp(-2 * time)
            angle = 2 * np.pi * frequency * time
            audio[start : start + time.size] += gain * attack * (
                np.sin(angle) + 0.33 * np.sin(2 * angle) + 0.08 * np.sin(3 * angle)
            )

        for index, onset in enumerate(np.arange(0.3, seconds, 60 / bpm)):
            pitch = [196, 261.63, 220, 293.67, 246.94][index % 5]
            add_note(onset + rng.uniform(-0.035, 0.035), 0.024, pitch)
            if index % 3 != 1 and onset + 0.67 < seconds:
                accent = [392, 369.99, 349.23, 329.63][index % 4]
                add_note(onset + rng.uniform(0.27, 0.77), rng.uniform(0.045, 0.08), accent)

        result = feed(TempoTracker(), audio[: 9 * RATE])
        self.assertAlmostEqual(result["tempo"], bpm, delta=1.0)
        self.assertGreaterEqual(result["tempoConfidence"], 0.45)

    def test_uncertain_intro_retains_rhythm_but_does_not_publish_it(self):
        tracker = TempoTracker()
        audio = rhythm(120, seconds=6)
        for index in range(0, len(audio), RATE):
            tracker.accept(audio[index : index + RATE])
            if index < 4 * RATE:
                self.assertEqual(tracker.estimate(music=False, retain_history=True)["tempo"], 0)
        self.assertEqual(tracker.sample_count, 6 * RATE)
        tracker.estimate(music=False)
        tracker.estimate(music=False)
        tracker.estimate(music=False)
        self.assertFalse(tracker.soft_onsets)

    def test_clear_beats_lock_without_a_fixed_seven_second_wait(self):
        for bpm in [90, 120, 150, 180, 240]:
            with self.subTest(bpm=bpm):
                tracker = TempoTracker()
                audio = rhythm(bpm, seconds=8)
                first = None
                for index in range(0, len(audio), 8000):
                    tracker.accept(audio[index:index + 8000])
                    if (index + 8000) % RATE == 0:
                        result = tracker.estimate()
                        if result['tempo']:
                            self.assertAlmostEqual(result['tempo'], bpm, delta=bpm * 0.025)
                            first = (index + 8000) / RATE
                            break
                self.assertIsNotNone(first)
                self.assertLessEqual(first, 5)

    def test_known_tempos_and_endpoint_phase(self):
        for bpm in [60, 75, 90, 120, 150, 180, 210, 240]:
            with self.subTest(bpm=bpm):
                result = feed(TempoTracker(), rhythm(bpm))
                self.assertAlmostEqual(result["tempo"], bpm, delta=bpm * 0.012)
                self.assertGreater(result["tempoConfidence"], 0.6)
                expected = ((16 - 0.173) * bpm / 60) % 1
                difference = abs((result["beatPhase"] - expected + 0.5) % 1 - 0.5)
                self.assertLess(difference, 0.09)

    def test_quiet_and_loud_offbeats_do_not_double_or_halve_tempo(self):
        for bpm in [60, 90, 120, 150, 180, 210, 240]:
            with self.subTest(bpm=bpm):
                tracker = TempoTracker()
                result = feed(tracker, rhythm(bpm, offbeats=True, gain=0.12))
                self.assertAlmostEqual(result["tempo"], bpm, delta=bpm * 0.015)
                result = feed(tracker, rhythm(bpm, seconds=8, offbeats=True, gain=0.5))
                self.assertAlmostEqual(result["tempo"], bpm, delta=bpm * 0.02)

    def test_broadband_backbeat_does_not_hide_bass_beats(self):
        for bpm in [60, 75, 90, 120, 150, 180, 210, 240]:
            with self.subTest(bpm=bpm):
                audio = np.zeros(RATE * 16, np.float32)
                time = np.arange(1760) / RATE
                kick = np.sin(2 * np.pi * 60 * time) * np.exp(-45 * time) * 0.7
                rng = np.random.default_rng(18357)
                snare = rng.normal(0, 0.25, time.size) * np.exp(-80 * time)
                for index, onset in enumerate(np.arange(0.173, 16, 60 / bpm)):
                    start = int(onset * RATE)
                    size = min(kick.size, audio.size - start)
                    audio[start : start + size] += kick[:size]
                    if index % 2:
                        audio[start : start + size] += snare[:size]
                result = feed(TempoTracker(), audio)
                self.assertAlmostEqual(result["tempo"], bpm, delta=bpm * 0.015)

    def test_offbeat_onsets_do_not_cancel_observed_beat_phase(self):
        beats = np.arange(8, dtype=np.float64)
        times = np.column_stack((beats, beats + 0.5)).ravel()
        weights = np.tile([1.0, 0.6], 8)
        offset, confidence = TempoTracker._phase(times, weights, period=1.0)
        self.assertLess(abs((offset + 0.5) % 1 - 0.5), 0.02)
        self.assertGreater(confidence, 0.6)

    def test_small_timing_jitter_does_not_lock_to_a_third_of_the_beat(self):
        for bpm in [90, 120, 150]:
            tracker = TempoTracker()
            audio = rhythm(bpm, seconds=20, jitter=0.012)
            observed = []
            for index in range(0, audio.size, 8000):
                tracker.accept(audio[index : index + 8000])
                if (index + 8000) % RATE == 0:
                    result = tracker.estimate()
                    if result["tempo"]:
                        observed.append(result["tempo"])
            self.assertGreater(len(observed), 8)
            for tempo in observed:
                self.assertAlmostEqual(tempo, bpm, delta=bpm * 0.025)

    def test_unknown_for_silence_stationary_tone_noise_and_unlocked_audio(self):
        rng = np.random.default_rng(18765)
        for audio in [
            np.zeros(RATE * 16, np.float32),
            np.sin(2 * np.pi * 440 * np.arange(RATE * 16) / RATE).astype(np.float32) * 0.2,
            rng.normal(0, 0.07, RATE * 16).astype(np.float32),
            rhythm(120, seconds=3),
        ]:
            self.assertEqual(
                feed(TempoTracker(), audio),
                {"tempo": 0.0, "tempoConfidence": 0.0, "beatPhase": 0.0},
            )

    def test_reacquires_new_track_without_old_tempo_lock(self):
        tracker = TempoTracker()
        self.assertAlmostEqual(feed(tracker, rhythm(120))["tempo"], 120, delta=1)
        self.assertAlmostEqual(feed(tracker, rhythm(90))["tempo"], 90, delta=1)
        tracker.reset()
        self.assertAlmostEqual(feed(tracker, rhythm(60))["tempo"], 60, delta=1)
        self.assertAlmostEqual(feed(tracker, rhythm(120))["tempo"], 120, delta=1)

    def test_irregular_rubato_does_not_claim_a_stable_beat(self):
        rng = np.random.default_rng(2026)
        audio = np.zeros(RATE * 16, np.float32)
        attack = rhythm(120, seconds=1, offset=0)[:2400]
        onset = 0.1
        while onset < 16:
            start = int(onset * RATE)
            size = min(attack.size, audio.size - start)
            audio[start : start + size] += attack[:size]
            onset += rng.uniform(0.28, 0.75)
        self.assertEqual(feed(TempoTracker(), audio)["tempo"], 0)

    def test_reset_and_nonmusic_gate_clear_old_phase_and_bound_memory(self):
        tracker = TempoTracker()
        feed(tracker, rhythm(120, seconds=32))
        self.assertLessEqual(len(tracker.onsets), 1200)
        self.assertLessEqual(len(tracker.soft_onsets), 1200)
        self.assertLessEqual(len(tracker.times), 1200)
        self.assertLess(len(tracker.samples), 512)
        for _ in range(3):
            self.assertEqual(tracker.estimate(music=False)["tempo"], 0)
        self.assertEqual(len(tracker.onsets), 0)
        self.assertEqual(tracker.sample_count, 0)
        self.assertEqual(tracker.estimate()["tempo"], 0)
        feed(tracker, rhythm(120))
        tracker.reset()  # The worker performs this for every sequence/session gap.
        self.assertIsNone(tracker.previous)
        self.assertEqual(feed(tracker, rhythm(120, seconds=2))["tempo"], 0)

    def test_chunk_size_does_not_change_flux_or_phase(self):
        audio = rhythm(120)
        first, second = TempoTracker(), TempoTracker()
        feed(first, audio)
        feed(second, audio, size=1600)
        np.testing.assert_allclose(first.onsets, second.onsets, rtol=1e-7, atol=1e-8)
        np.testing.assert_allclose(first.times, second.times, rtol=0, atol=1e-9)
        self.assertEqual(first.estimate(), second.estimate())

    def test_invalid_inputs_do_not_enter_history(self):
        tracker = TempoTracker()
        for value in [
            [], [float("nan")], [float("inf")], np.zeros((2, 4)), np.zeros(16001)
        ]:
            with self.assertRaises(ValueError):
                tracker.accept(value)
            self.assertEqual(tracker.sample_count, 0)


if __name__ == "__main__":
    unittest.main()
