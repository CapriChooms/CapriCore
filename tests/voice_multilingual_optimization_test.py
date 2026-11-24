# SPDX-License-Identifier: GPL-3.0-only
"""Hardware capability guards, RNG isolation, OOM recovery, and fallback tests for Multilingual V3."""
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import torch

from integrations.voice_runtime.multilingual import MultilingualVoice, VoicePool
from integrations.voice_runtime.multilingual_graph import cuda_graphs_supported
from integrations.voice_runtime.s3gen_fast import (
    SAMPLES_PER_TOKEN,
    FastS3GenDecoder,
    cfm_cuda_graphs_supported,
    native_bf16_supported,
)


class MultilingualOptimizationFallbackTests(unittest.TestCase):
    def test_bf16_requires_ampere_or_newer_and_disables_emulation_on_turing_and_cpu(self):
        self.assertFalse(native_bf16_supported('cpu'))
        with patch('torch.cuda.is_available', return_value=False):
            self.assertFalse(native_bf16_supported('cuda:0'))
        with patch('torch.cuda.is_available', return_value=True), \
             patch('torch.version.hip', None), \
             patch('torch.cuda.get_device_capability', return_value=(7, 5)):
            self.assertFalse(native_bf16_supported('cuda:0'))
        with patch('torch.cuda.is_available', return_value=True), \
             patch('torch.version.hip', '6.2'), \
             patch('torch.cuda.get_device_capability', return_value=(9, 0)):
            self.assertFalse(native_bf16_supported('cuda:0'))
        with patch('torch.cuda.is_available', return_value=True), \
             patch('torch.version.hip', None), \
             patch('torch.cuda.get_device_capability', return_value=(8, 6)), \
             patch('torch.cuda.is_bf16_supported', return_value=True):
            self.assertTrue(native_bf16_supported('cuda:0'))

    def test_cuda_graphs_disabled_on_cpu_rocm_and_pre_volta_gpus(self):
        self.assertFalse(cuda_graphs_supported('cpu'))
        self.assertFalse(cfm_cuda_graphs_supported('cpu'))
        with patch('torch.cuda.is_available', return_value=True), \
             patch('torch.version.hip', None), \
             patch('torch.cuda.get_device_capability', return_value=(6, 1)):
            self.assertFalse(cuda_graphs_supported('cuda:0'))
            self.assertFalse(cfm_cuda_graphs_supported('cuda:0'))
        with patch('torch.cuda.is_available', return_value=True), \
             patch('torch.version.hip', '6.2'), \
             patch('torch.cuda.get_device_capability', return_value=(9, 0)):
            self.assertFalse(cuda_graphs_supported('cuda:0'))
            self.assertFalse(cfm_cuda_graphs_supported('cuda:0'))
        with patch('torch.cuda.is_available', return_value=True), \
             patch('torch.version.hip', None), \
             patch('torch.cuda.get_device_capability', return_value=(7, 5)):
            self.assertTrue(cuda_graphs_supported('cuda:0'))
            self.assertTrue(cfm_cuda_graphs_supported('cuda:0'))

    def test_supports_streaming_requires_cuda_decoder(self):
        voice = MultilingualVoice.__new__(MultilingualVoice)
        voice.graph = object()
        voice.fast_decoder = object()
        voice.decoder_device = 'cpu'
        self.assertFalse(voice.supports_streaming())
        voice.decoder_device = 'cuda:0'
        self.assertTrue(voice.supports_streaming())

    def test_multilingual_oom_calls_zero_arg_decoder_oom_and_retries(self):
        voice = MultilingualVoice.__new__(MultilingualVoice)
        voice.decoder_device = 'cuda:0'
        voice.config = {'seed': 417, 'maxSpeechTokens': 800}
        voice.graph = None
        voice._decoder_check_after = float('inf')
        oom_calls = []

        def fake_oom():
            oom_calls.append(True)
            voice.decoder_device = 'cpu'

        voice.decoder_oom = fake_oom
        attempts = []

        def fake_render(text, language, use_graph=True):
            attempts.append((voice.decoder_device, use_graph))
            if len(attempts) == 1:
                raise torch.cuda.OutOfMemoryError()
            return np.zeros((240,), dtype=np.float32)

        voice.render = fake_render
        audio = voice._render_with_oom_fallback('Teste.', 'pt', cancelled=None)
        self.assertEqual(len(oom_calls), 1)
        self.assertEqual(attempts, [('cuda:0', True), ('cpu', True)])
        self.assertEqual(audio.shape, (240,))

    def test_streaming_decoder_preserves_global_rng_and_crossfades_chunks(self):
        class DummyHiFT:
            def inference(self, speech_feat, cache_source):
                # Simulate SourceModuleHnNSF drawing from the global RNG.
                _ = torch.rand(16)
                n_samples = (speech_feat.shape[-1] // 2) * SAMPLES_PER_TOKEN
                wav = torch.full((1, n_samples), 0.25, dtype=torch.float32)
                return wav, None

        dummy_s3gen = SimpleNamespace(
            flow=SimpleNamespace(to=lambda **_: None),
            mel2wav=DummyHiFT(),
            trim_fade=torch.ones(16, dtype=torch.float32),
        )
        decoder = FastS3GenDecoder(dummy_s3gen, enable_cuda_graph=False)
        decoder.device = 'cpu'
        decoder.flow_dtype = torch.float32
        decoder._empty_cache_source = torch.zeros(1, 1, 0)
        decoder._flow_infer = lambda toks, ref, **kwargs: torch.zeros((1, 80, toks.shape[-1] * 2))

        ref = {
            'prompt_token': torch.zeros((1, 4), dtype=torch.long),
            'prompt_token_len': torch.tensor([4], dtype=torch.long),
            'prompt_feat': torch.zeros((1, 8, 80), dtype=torch.float32),
            'embedding': torch.zeros((1, 192), dtype=torch.float32),
        }

        state = decoder.create_stream_state(ctx_tokens=4, fade_samples=480, seed=417)
        torch.manual_seed(12345)
        expected_after = torch.get_rng_state().clone()

        c0 = state.decode_chunk(list(range(14)), 0, 8, True, False, ref)
        self.assertTrue(torch.equal(torch.get_rng_state(), expected_after))
        self.assertEqual(len(c0), 8 * SAMPLES_PER_TOKEN - 480)

        c1 = state.decode_chunk(list(range(16)), 8, 16, False, True, ref)
        self.assertTrue(torch.equal(torch.get_rng_state(), expected_after))
        # Final chunk trims the final noisy token (16 - 1 = 15 total tokens -> 15 * 960 samples).
        self.assertEqual(len(c0) + len(c1), 15 * SAMPLES_PER_TOKEN)
        self.assertTrue(np.isfinite(c1).all())

    def test_health_reports_multilingual_precision_and_cfm_graph_status(self):
        pool = VoicePool.__new__(VoicePool)
        pool.config = {'computeDevice': 'cuda:0'}
        pool.kind = 'tts'
        pool.language = 'pt-BR'
        pool.voice = SimpleNamespace(
            graph=SimpleNamespace(batch_steps=1, validation_max_error=0.0),
            fast_decoder=SimpleNamespace(
                cfm_cuda_graph=True,
                precision_label='bfloat16-flow/float32-hift',
            ),
            decoder_device='cuda:0',
            decoder_reason='available-vram',
            reference_memory={'referenceEncodersReleased': True, 'releasedEncoderBytes': 512 * 1024**2},
        )
        health = pool.health()
        self.assertTrue(health['cudaGraph'])
        self.assertTrue(health['cfmCudaGraph'])
        self.assertEqual(health['precision'], 'float16-t3/bfloat16-flow/float32-hift')
        self.assertEqual(health['graphMaxLogitError'], 0.0)


if __name__ == '__main__':
    unittest.main()
