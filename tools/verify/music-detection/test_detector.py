"""Local detector regression tests; synthetic PCM only, no capture or network.

Run with router-venv after the pinned model has been provisioned. The optional
--torchaudio-parity check uses an existing TorchAudio environment for reference;
TorchAudio is not a Capri music-detector dependency.
"""
# ruff: noqa: E402 -- Bootstrap the checkout import path for direct execution.

import base64
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

import numpy as np

from integrations.music_runtime.features import log_mel_patch, probabilities

MODEL = ROOT / ".runtime/music-detection-research/yamnet-onnx-float"
MAX_LINE_BYTES = 128 * 1024
MODEL_AVAILABLE = (MODEL / "yamnet.onnx").is_file() and importlib.util.find_spec(
    "onnxruntime"
) is not None
PARITY = "--torchaudio-parity" in sys.argv
if PARITY:
    sys.argv.remove("--torchaudio-parity")


def packet(sequence, samples=None, session="synthetic_test"):
    if samples is None:
        samples = np.zeros(8000, dtype="<f4")
    return {
        "type": "audio",
        "sessionId": session,
        "sequence": sequence,
        "pcm": base64.b64encode(np.asarray(samples, dtype="<f4").tobytes()).decode(
            "ascii"
        ),
    }


class FrontendTests(unittest.TestCase):
    def test_silence_is_finite_and_correct_shape(self):
        value = log_mel_patch(np.zeros(16000, np.float32))
        self.assertEqual(value.shape, (1, 1, 96, 64))
        self.assertEqual(value.dtype, np.float32)
        np.testing.assert_allclose(value, np.log(0.001), atol=1e-6)

    def test_latest_second_is_used_without_past_session_audio(self):
        current = np.sin(np.arange(16000, dtype=np.float32) * 0.1) * 0.05
        prefix = np.ones(32000, np.float32)
        np.testing.assert_array_equal(
            log_mel_patch(current), log_mel_patch(np.r_[prefix, current])
        )

    def test_short_input_is_zero_padded(self):
        np.testing.assert_array_equal(
            log_mel_patch(np.ones(10, np.float32)),
            log_mel_patch(np.r_[np.ones(10), np.zeros(15990)]),
        )

    def test_bad_audio_is_rejected(self):
        for samples in [
            np.zeros((2, 10)),
            np.zeros(48001),
            [float("nan")],
            [float("inf")],
        ]:
            with self.assertRaises(ValueError):
                log_mel_patch(samples)

    def test_export_logits_are_converted_to_probabilities(self):
        actual = probabilities(np.array([-100, 0, 100], np.float32))
        self.assertTrue(np.isfinite(actual).all())
        self.assertLess(actual[0], 0.00001)
        self.assertEqual(actual[1], 0.5)
        self.assertGreater(actual[2], 0.99999)

    @unittest.skipUnless(PARITY, "optional reference-library comparison")
    def test_matches_pinned_torchaudio_frontend(self):
        import torch
        import torchaudio

        torch.set_num_threads(1)
        spectrum = torchaudio.transforms.Spectrogram(
            n_fft=512,
            win_length=400,
            hop_length=160,
            power=1.0,
            center=True,
            pad_mode="reflect",
        )
        mel = torchaudio.transforms.MelScale(
            n_mels=64,
            sample_rate=16000,
            f_min=125.0,
            f_max=7500.0,
            n_stft=257,
        )
        rng = np.random.default_rng(77138)
        samples = [
            np.zeros(16000, np.float32),
            rng.normal(0, 0.1, 16000).astype(np.float32),
            (0.1 * np.sin(2 * np.pi * 440 * np.arange(16000) / 16000)).astype(
                np.float32
            ),
        ]
        errors = []
        for waveform in samples:
            reference = (mel(spectrum(torch.from_numpy(waveform))) + 0.001).log()
            reference = reference.T[:96].numpy().reshape(1, 1, 96, 64)
            actual = log_mel_patch(waveform)
            errors.append(float(np.max(np.abs(reference - actual))))
            np.testing.assert_allclose(actual, reference, atol=3e-4, rtol=2e-5)
        print(json.dumps({"torchaudioParityMaximumAbsoluteError": max(errors)}))


@unittest.skipUnless(MODEL_AVAILABLE, "pinned public model and ONNX Runtime required")
class WorkerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from integrations.music_runtime.worker import MusicClassifier

        cls.classifier = MusicClassifier(MODEL)

    def setUp(self):
        self.classifier.reset()

    def test_classifies_each_second_and_retains_bounded_ephemeral_audio(self):
        count = 0
        for sequence in range(100):
            result = self.classifier.process(packet(sequence))
            count += result is not None
            self.assertLessEqual(len(self.classifier.samples), 48000)
        self.assertEqual(count, 50)
        self.assertEqual(result["music"], 0)
        self.assertEqual(result["speech"], 0)
        self.assertEqual(result["tempo"], 0)
        self.assertEqual(result["tempoConfidence"], 0)
        self.assertEqual(result["beatPhase"], 0)
        self.assertEqual(len(self.classifier.scores), 3)
        self.classifier.reset()
        self.assertEqual(len(self.classifier.samples), 0)
        self.assertEqual(len(self.classifier.scores), 0)
        self.assertEqual(len(self.classifier.tempo.onsets), 0)

    def test_tempo_is_gated_and_cannot_bridge_session_or_sequence_gaps(self):
        logits = np.full((1, 521), -100, dtype=np.float32)
        logits[0, 132] = 100
        original = self.classifier.session
        self.classifier.session = SimpleNamespace(run=lambda *_: [logits])
        time = np.arange(8000) / 16000
        pulse = (
            np.sin(2 * np.pi * 220 * time) * np.exp(-35 * time) * 0.4
        ).astype(np.float32)
        try:
            for sequence in range(32):
                result = self.classifier.process(packet(sequence, pulse))
            self.assertAlmostEqual(result["tempo"], 120, delta=1)
            self.assertGreater(result["tempoConfidence"], 0.6)
            self.assertGreaterEqual(result["beatPhase"], 0)
            self.assertLess(result["beatPhase"], 1)
            self.assertIsNone(self.classifier.process(packet(34, pulse)))
            self.assertEqual(self.classifier.tempo.sample_count, 8000)
            result = self.classifier.process(packet(35, pulse))
            self.assertEqual(result["tempo"], 0)
            for sequence in range(36, 68):
                result = self.classifier.process(packet(sequence, pulse))
            self.assertAlmostEqual(result["tempo"], 120, delta=1)
            # The next completed classifier window is already unable to publish
            # an earlier beat when its current audio is silence.
            self.classifier.process(packet(68))
            result = self.classifier.process(packet(69))
            self.assertEqual(result["tempo"], 0)
            for sequence in range(70, 80):
                self.classifier.process(packet(sequence))
            self.assertEqual(len(self.classifier.tempo.onsets), 0)
        finally:
            self.classifier.session = original

    def test_session_and_sequence_gaps_drop_previous_audio(self):
        self.classifier.process(packet(0))
        self.assertIsNone(self.classifier.process(packet(2)))
        self.assertEqual(len(self.classifier.samples), 8000)
        self.assertIsNotNone(self.classifier.process(packet(3)))
        self.assertIsNone(self.classifier.process(packet(4, session="new_session")))
        self.assertEqual(len(self.classifier.samples), 8000)

    def test_invalid_packet_does_not_enter_buffer(self):
        invalid = [
            {**packet(0), "unexpected": "field"},
            packet(True),
            packet(-1),
            packet(0, session="private/path/not/an/id"),
            {**packet(0), "pcm": "invalid-base64"},
            packet(0, np.full(8000, np.nan)),
            packet(0, np.zeros(7999)),
        ]
        for value in invalid:
            with self.assertRaises(ValueError):
                self.classifier.process(value)
            self.assertEqual(len(self.classifier.samples), 0)

    def run_worker(self, lines, directory=MODEL):
        body = (
            "\n".join(
                line if isinstance(line, str) else json.dumps(line) for line in lines
            )
            + "\n"
        )
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "integrations/music_runtime/worker.py"),
                "--model-dir",
                str(directory),
            ],
            input=body,
            text=True,
            capture_output=True,
            timeout=20,
        )
        self.assertEqual(result.stderr, "")
        self.assertNotIn(str(ROOT), result.stdout)
        return result.returncode, [
            json.loads(line) for line in result.stdout.splitlines()
        ]

    def test_stdio_protocol_drops_invalid_and_oversized_inputs(self):
        code, output = self.run_worker(
            [
                packet(0),
                "x" * (MAX_LINE_BYTES + 1),
                packet(1),
                packet(2),
                {"type": "reset"},
                packet(3),
                packet(4),
                {"type": "audio", "pcm": "do_not_echo_test"},
                {"type": "stop"},
            ]
        )
        self.assertEqual(code, 0)
        self.assertEqual(
            [entry["type"] for entry in output],
            [
                "ready",
                "error",
                "classification",
                "classification",
                "error",
            ],
        )
        self.assertEqual(
            [
                entry["sequence"]
                for entry in output
                if entry["type"] == "classification"
            ],
            [2, 4],
        )
        self.assertNotIn("do_not_echo_test", json.dumps(output))

    def test_missing_or_corrupt_model_fails_without_owner_paths(self):
        with tempfile.TemporaryDirectory(prefix="capri-music-integrity-") as directory:
            Path(directory, "yamnet.onnx").write_bytes(bytes(166437))
            code, output = self.run_worker([], directory)
        self.assertEqual(code, 1)
        self.assertEqual(output, [{"type": "error", "code": "MUSIC_MODEL_UNAVAILABLE"}])


if __name__ == "__main__":
    unittest.main()
