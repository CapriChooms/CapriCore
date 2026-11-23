"""Cold-start optimizations must preserve native weights and fail closed."""
import json
import sys
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

import torch
from torch import nn

from integrations.voice_runtime.initialization import initialization_threads
from integrations.voice_runtime.model import settings
from integrations.voice_training.backend import load_engine
from integrations.voice_training.low_memory import load_decoder_cpu


class TinyDecoder(nn.Module):
    def __init__(self, *, meanflow):
        super().__init__()
        self.projection = nn.Linear(3, 4)
        self.register_buffer('scale', torch.ones(4))
        self.register_buffer('fade', torch.ones(2), persistent=False)
        self.position = torch.ones(2, 3)


def restore_caches(decoder):
    decoder.fade = torch.ones(2, device='cpu')
    decoder.position = torch.ones(2, 3, device='cpu')


class VoiceStartupTests(unittest.TestCase):
    def test_meta_decoder_preserves_state_caches_and_inference_without_copying_weights(self):
        original = TinyDecoder(meanflow=True).eval()
        state = original.state_dict()
        native = SimpleNamespace(S3Gen=TinyDecoder, load_file=lambda _: state)
        with patch('integrations.voice_training.low_memory._restore_decoder_caches', restore_caches):
            fast = load_decoder_cpu(native, Path('.'))
        for key, tensor in fast.state_dict().items():
            self.assertTrue(torch.equal(tensor, state[key]), key)
            self.assertEqual(tensor.data_ptr(), state[key].data_ptr(), key)
        self.assertTrue(torch.equal(fast.fade, original.fade))
        self.assertTrue(torch.equal(fast.position, original.position))
        self.assertFalse(fast.training)
        value = torch.randn(2, 3)
        self.assertTrue(torch.equal(fast.projection(value), original.projection(value)))

    def test_unknown_native_layout_falls_back_without_uninitialized_buffers(self):
        original = TinyDecoder(meanflow=True)
        native = SimpleNamespace(S3Gen=TinyDecoder, load_file=lambda _: original.state_dict())
        # A new nonpersistent/plain tensor must never reach inference on meta.
        with patch('integrations.voice_training.low_memory._restore_decoder_caches', lambda _: None):
            fast = load_decoder_cpu(native, Path('.'))
        self.assertFalse(fast.fade.is_meta)
        self.assertFalse(fast.position.is_meta)
        self.assertTrue(torch.equal(fast.projection.weight, original.projection.weight))

    def test_bad_checkpoint_is_not_silently_accepted_by_native_fallback(self):
        native = SimpleNamespace(S3Gen=TinyDecoder, load_file=lambda _: {})
        with patch('integrations.voice_training.low_memory._restore_decoder_caches', restore_caches):
            with self.assertRaises(RuntimeError):
                load_decoder_cpu(native, Path('.'))

    def test_startup_threads_restore_inference_budget_on_success_and_error(self):
        for fail in (False, True):
            calls = []

            @initialization_threads
            def initialize(_self, _config):
                calls.append('initializing')
                if fail:
                    raise ValueError('fixture failure')
                return 'ready'

            with patch('torch.set_num_threads', side_effect=calls.append):
                if fail:
                    with self.assertRaises(ValueError):
                        initialize(None, {'cpuThreads': 2, 'startupCpuThreads': 8})
                else:
                    self.assertEqual(initialize(None, {'cpuThreads': 2, 'startupCpuThreads': 8}), 'ready')
            self.assertEqual(calls, [8, 'initializing', 2])

    def test_weak_cpu_and_explicit_cpu_voice_keep_the_existing_thread_limit(self):
        config = dict(schemaVersion=1, engine='chatterbox-turbo', enabled=False,
                      port=8101, precision='float32', cpuThreads=8,
                      maxSpeechTokens=400, seed=0, profileDir='data/profile')
        with TemporaryDirectory() as folder:
            root = Path(folder)
            (root/'config').mkdir()
            (root/'config/companion-voice.json').write_text(json.dumps(config))
            for cores, device, expected in [(8, 'auto', 2), (32, 'cpu', 2), (32, 'auto', 8)]:
                with self.subTest(cores=cores, device=device), \
                     patch('integrations.voice_runtime.model.ROOT', root), \
                     patch('integrations.voice_training.dataset.ROOT', root), \
                     patch('integrations.voice_runtime.model.os.cpu_count', return_value=cores), \
                     patch('integrations.voice_runtime.model.merge_local_settings', side_effect=lambda _root, _name, value: value), \
                     patch.dict('os.environ', {'CAPRI_CPU_THREADS': '2', 'CAPRI_VOICE_COMPUTE_DEVICE': device}):
                    selected = settings()
                self.assertEqual(selected['cpuThreads'], 2)
                self.assertEqual(selected['startupCpuThreads'], expected)

    def load_with_verification(self, *, damaged=False, unpinned=False):
        verified = threading.Event()
        native = SimpleNamespace()
        engine = SimpleNamespace(tokenizer=list(range(50276)))

        def verify(_config):
            if damaged:
                raise ValueError('Model file changed')
            verified.set()

        def load(*_args, **kwargs):
            self.assertTrue(verified.is_set(), 'Checkpoint loaded before hash verification')
            self.assertIs(kwargs['native'], native)
            return engine

        with patch('integrations.voice_training.provision.verify_model_metadata',
                   side_effect=ValueError('Unpinned source') if unpinned else None) as metadata, \
             patch('integrations.voice_training.provision.verify_model', side_effect=verify), \
             patch('integrations.voice_training.backend.local_environment'), \
             patch.dict(sys.modules, {'chatterbox': SimpleNamespace(tts_turbo=native)}), \
             patch('integrations.voice_training.low_memory.load_turbo_cpu', side_effect=load) as loader:
            if damaged or unpinned:
                with self.assertRaises(ValueError):
                    load_engine({'modelPath': Path('.')})
                loader.assert_not_called()
            else:
                self.assertIs(load_engine({'modelPath': Path('.')}), engine)
            metadata.assert_called_once()

    def test_parallel_import_waits_for_strict_verification_before_checkpoint_load(self):
        self.load_with_verification()

    def test_corrupt_weights_do_not_reach_checkpoint_loader(self):
        self.load_with_verification(damaged=True)

    def test_unpinned_source_is_rejected_before_native_loading(self):
        self.load_with_verification(unpinned=True)


if __name__ == '__main__':
    unittest.main()
