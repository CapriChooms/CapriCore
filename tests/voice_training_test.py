"""Bounded preparation tests using synthetic tones, not purported Capri recordings."""

import copy
import csv
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import soundfile as sf
import torch
from torch import nn
from transformers.pytorch_utils import Conv1D

from integrations.voice_training.backend import (
    LoRAProjection,
    add_adapters,
    load_adapter,
    save_adapter,
    speech_loss,
    verify_dataset,
)
from integrations.voice_training.dataset import (
    FIELDS,
    ROOT,
    digest,
    init_dataset,
    prepare,
    read_config,
)


class DatasetTests(unittest.TestCase):
    def setUp(self):
        parent = ROOT / ".runtime/test-data"
        parent.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=parent, prefix="voice-")
        self.config = copy.deepcopy(read_config())
        self.config["datasetPath"] = Path(self.temporary.name)
        init_dataset(self.config)
        self.rows = []
        for index, (split, seconds, scene) in enumerate(
            [
                ("reference", 6, "one"),
                ("train", 2, "one"),
                ("train", 2, "one"),
                ("validation", 2, "two"),
                ("test", 2, "three"),
            ]
        ):
            file = self.config["datasetPath"] / "raw" / f"clip-{index}.wav"
            time = np.arange(int(seconds * 48000)) / 48000
            audio = 0.12 * np.sin(2 * np.pi * (210 + index * 39) * time)
            sf.write(file, audio, 48000, subtype="PCM_24")
            self.rows.append(
                dict(
                    id=f"clip-{index}",
                    file=f"raw/clip-{index}.wav",
                    text=f"A different synthetic fixture sentence number {index}.",
                    emotion="neutral",
                    scene=scene,
                    split=split,
                    approved="yes",
                )
            )

    def tearDown(self):
        self.temporary.cleanup()

    def metadata(self):
        with (self.config["datasetPath"] / "metadata.csv").open(
            "w", encoding="utf-8", newline=""
        ) as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(self.rows)

    def test_preparation_preserves_sources_and_keeps_references_out_of_targets(self):
        self.metadata()
        before = digest(self.config["datasetPath"] / self.rows[0]["file"])
        result = prepare(self.config)
        self.assertTrue(result["ready"])
        self.assertEqual(
            before, digest(self.config["datasetPath"] / self.rows[0]["file"])
        )
        for split in ["train", "validation", "test"]:
            text = (self.config["datasetPath"] / f"{split}.jsonl").read_text()
            self.assertNotIn('"id": "clip-0"', text)
        audio, rate = sf.read(self.config["datasetPath"] / "prepared/clip-1.wav")
        self.assertEqual(rate, 24000)
        self.assertEqual(audio.ndim, 1)
        verify_dataset(self.config)
        self.rows[1]["text"] = "Changed transcript after preparation."
        self.metadata()
        with self.assertRaisesRegex(ValueError, "changed"):
            verify_dataset(self.config)

    def test_cross_scene_leakage_and_duplicate_audio_are_blocked(self):
        self.rows[3]["scene"] = "one"
        self.metadata()
        with self.assertRaises(ValueError):
            prepare(self.config)
        self.rows[3]["scene"] = "two"
        self.rows[4]["file"] = self.rows[3]["file"]
        self.metadata()
        with self.assertRaises(ValueError):
            prepare(self.config)
        report = json.loads(
            (self.config["datasetPath"] / "quality-report.json").read_text()
        )
        self.assertFalse(report["ready"])
        self.assertTrue(
            any("Duplicate audio" in row["error"] for row in report["errors"])
        )

    def test_asr_transcripts_require_explicit_provisional_configuration(self):
        self.rows[1]["approved"] = "asr-consensus"
        self.metadata()
        with self.assertRaisesRegex(ValueError, "ASR-only transcripts"):
            prepare(self.config)
        self.config["allowProvisionalTranscripts"] = True
        report = prepare(self.config)
        self.assertTrue(report["provisionalTranscripts"])
        receipt, _ = verify_dataset(self.config)
        self.assertTrue(receipt["provisionalTranscripts"])
        self.config["allowProvisionalTranscripts"] = False
        with self.assertRaisesRegex(ValueError, "ASR-only transcripts"):
            verify_dataset(self.config)

    def test_automatic_splits_keep_training_reference_scene_out_of_holdouts(self):
        for row in self.rows:
            if row["split"] != "reference":
                row["split"] = ""
        self.metadata()
        report = prepare(self.config)
        self.assertEqual(
            {row["split"] for row in report["clips"] if row["scene"] == "one"},
            {"train", "reference"},
        )

    def test_unapproved_and_clipped_audio_do_not_enter_training(self):
        for row in self.rows:
            row["approved"] = "no"
        self.metadata()
        with self.assertRaisesRegex(ValueError, "No approved audio"):
            prepare(self.config)
        self.rows[1]["approved"] = "yes"
        sf.write(
            self.config["datasetPath"] / self.rows[1]["file"],
            np.ones(48000),
            48000,
            subtype="FLOAT",
        )
        self.metadata()
        with self.assertRaisesRegex(ValueError, "Clipped waveform"):
            prepare(self.config)


class AdapterTests(unittest.TestCase):
    def test_saved_adapter_reloads_on_an_unchanged_base(self):
        class Tiny(nn.Module):
            def __init__(self):
                super().__init__()
                self.tfmr = nn.Module()
                block = nn.Module()
                block.attn = nn.Module()
                block.attn.c_attn = Conv1D(7, 5)
                self.tfmr.h = nn.ModuleList([block])

            def forward(self, value):
                return self.tfmr.h[0].attn.c_attn(value)

        model = Tiny()
        fresh = copy.deepcopy(model)
        options = {"rank": 2, "alpha": 4, "dropout": 0}
        add_adapters(model, options)
        with torch.no_grad():
            model.tfmr.h[0].attn.c_attn.lora_B.normal_(std=0.01)
        metadata = {
            "upstream": json.loads((ROOT / "config/voice-upstream.json").read_text()),
            "language": "en",
            "adapter": options,
        }
        parent = ROOT / ".runtime/test-data"
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as temporary:
            folder = Path(temporary) / "epoch-001"
            save_adapter(model, folder, metadata)
            load_adapter(fresh, folder, read_config())
            value = torch.randn(2, 3, 5)
            torch.testing.assert_close(model(value), fresh(value))

    def test_lora_starts_as_identity_and_only_adapter_receives_gradients(self):
        base = Conv1D(7, 5)
        adapter = LoRAProjection(base, rank=2, alpha=4, dropout=0)
        value = torch.randn(2, 3, 5)
        self.assertTrue(torch.equal(adapter(value), base(value)))
        adapter(value).square().mean().backward()
        self.assertIsNone(base.weight.grad)
        self.assertIsNotNone(adapter.lora_B.grad)
        self.assertGreater(adapter.lora_B.grad.abs().sum().item(), 0)

    def test_turbo_loss_predicts_first_speech_at_bos_and_trains_eos_without_double_shift(
        self,
    ):
        class Toy(nn.Module):
            def __init__(self):
                super().__init__()
                self.hp = SimpleNamespace(start_speech_token=3, stop_speech_token=4)
                self.speech_emb = nn.Embedding(5, 5)
                self.speech_head = nn.Identity()
                self.tfmr = lambda **kwargs: SimpleNamespace(
                    last_hidden_state=kwargs["inputs_embeds"]
                )

            def prepare_input_embeds(self, *, t3_cond, text_tokens, speech_tokens):
                torch.testing.assert_close(text_tokens, torch.tensor([[10, 11]]))
                torch.testing.assert_close(speech_tokens, torch.tensor([[3, 1, 2]]))
                logits = torch.full((1, 5, 5), -20.0)
                logits[0, 2, 1] = 20
                logits[0, 3, 2] = 20
                logits[0, 4, 4] = 20
                return logits, 0

        arrays = {
            "text": np.array([10, 11]),
            "speech": np.array([1, 2]),
            "speaker": np.zeros((1, 256), dtype="float32"),
            "prompt": np.zeros((1, 4), dtype="int64"),
        }
        loss, count = speech_loss(Toy(), arrays, "cpu")
        self.assertLess(loss.item(), 1e-5)
        self.assertEqual(count, 3)


if __name__ == "__main__":
    unittest.main()
