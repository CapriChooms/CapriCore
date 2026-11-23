import copy
import os
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import torch
from torch import nn
from transformers.pytorch_utils import Conv1D

from integrations.voice_runtime.inference import VoiceCancelled, check_cancelled, SpeechGenerationLimit
from integrations.voice_runtime.model import CapriVoice, DecoderMemoryBudget
from integrations.voice_runtime.multilingual import VoicePool
from integrations.voice_runtime.server import load_and_warm
from integrations.voice_runtime.optimize import merge_adapters
from integrations.voice_training.backend import LoRAProjection


class RuntimeOptimizationTests(unittest.TestCase):
    def test_gpu_budget_queries_only_the_selected_physical_cuda_card_once(self):
        uuid = 'GPU-12345678-1234-1234-1234-123456789abc'
        with patch.dict(os.environ, {'CUDA_VISIBLE_DEVICES': uuid, 'CAPRI_VOICE_GPU_UUID': uuid}), \
             patch('torch.cuda.mem_get_info', return_value=(1024**3, 2*1024**3)), \
             patch('torch.version.hip', None), \
             patch('integrations.voice_runtime.model.subprocess.run', return_value=SimpleNamespace(stdout='256\n')) as run:
            self.assertEqual(DecoderMemoryBudget.free_gpu_bytes(), 256*1024**2)
            self.assertEqual(run.call_count, 1)
            self.assertIn('--id='+uuid, run.call_args.args[0])

    def test_cpu_selection_never_promotes_the_decoder_or_queries_gpu_memory(self):
        voice = DecoderMemoryBudget()
        voice.config = {'computeDevice': 'cpu', 'decoderDevice': 'cuda:0'}
        voice.set_decoder_device = lambda device: setattr(voice, 'decoder_device', device)
        voice.free_gpu_bytes = lambda: self.fail('CPU selection queried GPU memory')
        voice.choose_decoder()
        voice.rebalance_decoder()
        self.assertEqual(voice.decoder_device, 'cpu')
        self.assertEqual(voice.decoder_reason, 'configured-cpu')

    def test_cpu_voice_warmup_skips_cuda_preflight_for_chatterbox(self):
        with patch('integrations.voice_runtime.server.VoicePool') as pool, \
             patch('integrations.voice_runtime.compatibility.require_cuda') as preflight, \
             patch('torch.cuda.empty_cache'):
            voice = load_and_warm({'computeDevice': 'cpu'}, 'en')
            preflight.assert_not_called()
            pool.assert_called_once_with({'computeDevice': 'cpu'})
            self.assertIs(voice, pool.return_value)

    def test_cpu_turbo_tokens_and_acoustic_decoder_never_touch_cuda(self):
        from integrations.voice_runtime.inference import render
        engine = SimpleNamespace(device='cpu', sr=24000,
            conds=SimpleNamespace(t3=SimpleNamespace(to=lambda **_: torch.zeros(1))),
            tokenizer=lambda *_args, **_kwargs: SimpleNamespace(input_ids=torch.tensor([[1, 2]])),
            t3=SimpleNamespace(inference_turbo=lambda **kwargs: torch.tensor([[3, 4]])),
            s3gen=SimpleNamespace(inference=lambda **kwargs: (torch.zeros(1, 1, 240), None)),
            watermarker=SimpleNamespace(apply_watermark=lambda audio, **kwargs: audio))
        with patch('torch.cuda.synchronize', side_effect=AssertionError('Unexpected CUDA')):
            audio, rate, metrics = render(engine, 'Ready.', device='cpu', reference={}, seed=0, max_tokens=100)
        self.assertEqual(len(audio), 240 * 4)
        self.assertEqual(rate, 24000)
        self.assertEqual(metrics['speechTokens'], 2)

    def test_turbo_decoder_keeps_one_canonical_reference_after_transfer(self):
        voice = CapriVoice.__new__(CapriVoice)
        reference = {'embedding': torch.tensor([0.25, 0.75])}
        voice.reference = reference
        fade = torch.zeros(1)
        voice.engine = SimpleNamespace(
            conds=SimpleNamespace(gen=reference),
            s3gen=SimpleNamespace(flow=nn.Linear(1, 1), mel2wav=nn.Linear(1, 1), trim_fade=fade),
        )
        voice.set_decoder_device('cpu')
        self.assertIs(voice.engine.conds.gen, voice.reference)
        self.assertIsNot(voice.reference, reference)
        self.assertIs(voice.reference['embedding'], reference['embedding'])

    def test_russian_start_warms_only_the_selected_backend(self):
        with patch('integrations.voice_runtime.server.VoicePool') as pool, \
             patch('integrations.voice_runtime.server.selected_voice', return_value={'backend': 'chatterbox-multilingual'}), \
             patch('integrations.voice_runtime.compatibility.require_cuda') as preflight, \
             patch('torch.cuda.empty_cache'):
            voice = load_and_warm({'fixture': True}, 'ru')
            preflight.assert_called_once_with(torch)
            pool.assert_called_once_with({'fixture': True})
            pool.return_value.generate.assert_called_once_with('Привет.', language='ru')
            self.assertIs(voice, pool.return_value)

    def test_chinese_extras_are_checked_before_ready_and_only_when_switching(self):
        pool = object.__new__(VoicePool)
        pool.config = {}
        pool.kind, pool.language, pool.voice = 'multilingual-v3', 'ru', object()
        with patch('integrations.voice_runtime.multilingual.verified_model', side_effect=ValueError('Chinese model missing')):
            with self.assertRaisesRegex(ValueError, 'Chinese model missing'):
                pool.prepare('zh')
        self.assertEqual(pool.language, 'ru')
        with patch('integrations.voice_runtime.multilingual.verified_model') as verify:
            pool.prepare('ru')
            verify.assert_not_called()
            pool.prepare('zh')
            pool.prepare('zh')
            verify.assert_called_once_with('chinese')

    def budget(self, requested='auto', free_mib=512):
        budget = DecoderMemoryBudget()
        budget.config = dict(decoderDevice=requested)
        budget.decoder_device = 'cpu'
        budget.free_gpu_bytes = lambda: free_mib * 1024**2
        budget.set_decoder_device = lambda device: setattr(budget, 'decoder_device', device)
        return budget

    def test_decoder_keeps_reserve_and_respects_explicit_devices(self):
        for requested, free, expected in [('auto', 2048, 'cpu'), ('auto', 4096, 'cuda:0'),
                                           ('cpu', 4096, 'cpu'), ('cuda:0', 512, 'cuda:0')]:
            budget = self.budget(requested, free)
            budget.choose_decoder()
            self.assertEqual(budget.decoder_device, expected)

    def test_decoder_moves_off_paged_gpu_then_recovers_with_headroom(self):
        budget = self.budget(free_mib=512)
        budget.decoder_device = 'cuda:0'
        with patch('torch.cuda.empty_cache'), patch('integrations.voice_runtime.model.time.monotonic', return_value=100):
            budget.rebalance_decoder()
        self.assertEqual(budget.decoder_device, 'cpu')
        self.assertEqual(budget.decoder_reason, 'vram-reserve')
        with patch.object(budget, 'free_gpu_bytes') as probe, patch('integrations.voice_runtime.model.time.monotonic', return_value=110):
            budget.rebalance_decoder()
            probe.assert_not_called()
        budget.free_gpu_bytes = lambda: 4 * 1024**3
        with patch('integrations.voice_runtime.model.time.monotonic', return_value=131):
            budget.rebalance_decoder()
        self.assertEqual(budget.decoder_device, 'cuda:0')

    def test_decoder_releases_inactive_buffers_before_moving_live_weights(self):
        budget = self.budget()
        budget.decoder_device = 'cuda:0'
        with patch.object(budget, 'free_gpu_bytes', side_effect=[512 * 1024**2, 2048 * 1024**2]), patch('torch.cuda.empty_cache') as clear:
            budget.rebalance_decoder()
            clear.assert_called_once()
        self.assertEqual(budget.decoder_device, 'cuda:0')

    def test_decoder_recovery_oom_and_insufficient_post_move_headroom(self):
        for oom in (False, True):
            budget = self.budget(free_mib=4096)
            moved = []
            def move(device):
                moved.append(device)
                if device == 'cuda:0' and oom:
                    raise torch.cuda.OutOfMemoryError()
                budget.decoder_device = device
            budget.set_decoder_device = move
            with patch.object(budget, 'free_gpu_bytes', side_effect=[4096 * 1024**2, 512 * 1024**2]), patch('torch.cuda.empty_cache'):
                budget.rebalance_decoder()
            self.assertEqual(moved, ['cuda:0', 'cpu'])
            self.assertEqual(budget.decoder_device, 'cpu')

    def test_fp32_folding_preserves_nonzero_adapter_and_is_idempotent(self):
        torch.manual_seed(417)
        model = nn.Module()
        model.block = LoRAProjection(Conv1D(19, 13), 4, 8, .05)
        with torch.no_grad():
            model.block.lora_B.normal_(std=.01)
        model.eval()
        before = copy.deepcopy(model)
        inputs = torch.randn(2, 7, 13)
        expected = before.block(inputs)
        self.assertEqual(merge_adapters(model), ['block'])
        torch.testing.assert_close(model.block(inputs), expected, atol=2e-6, rtol=2e-6)
        self.assertFalse(any(isinstance(module, LoRAProjection) for module in model.modules()))
        self.assertEqual(merge_adapters(model), [])
        self.assertIsInstance(before.block, LoRAProjection)

    def test_training_and_nonfinite_adapters_are_not_merged(self):
        model = nn.Module()
        model.block = LoRAProjection(Conv1D(3, 4), 2, 4, 0)
        with self.assertRaisesRegex(ValueError, 'inference-only'):
            merge_adapters(model)
        model.eval()
        with torch.no_grad():
            model.block.lora_B.fill_(float('nan'))
        with self.assertRaisesRegex(ValueError, 'Non-finite'):
            merge_adapters(model)

    @unittest.skipUnless(torch.cuda.is_available(), 'CUDA device required')
    def test_fp32_gpu_adapter_folding_matches_cpu_folding(self):
        torch.manual_seed(417)
        model = nn.Module()
        model.block = LoRAProjection(Conv1D(128, 256), 8, 16, 0)
        with torch.no_grad():
            model.block.lora_B.normal_(std=.01)
        model.eval()
        gpu = copy.deepcopy(model).to('cuda:0')
        previous_tf32 = torch.backends.cuda.matmul.allow_tf32
        try:
            torch.backends.cuda.matmul.allow_tf32 = False
            merge_adapters(model)
            merge_adapters(gpu)
            torch.testing.assert_close(gpu.block.weight.cpu(), model.block.weight, atol=2e-7, rtol=2e-6)
        finally:
            torch.backends.cuda.matmul.allow_tf32 = previous_tf32

    def test_cancellation_interrupts_before_next_transformer_forward(self):
        event = threading.Event()
        module = nn.Linear(3, 3)
        module.register_forward_pre_hook(lambda *_args: check_cancelled(event))
        module(torch.zeros(1, 3))
        event.set()
        with self.assertRaises(VoiceCancelled):
            module(torch.zeros(1, 3))

    def test_physical_memory_limits_wddm_budget_estimate(self):
        with patch('torch.cuda.mem_get_info', return_value=(8 * 1024**3, 12 * 1024**3)), patch(
            'integrations.voice_runtime.model.subprocess.run',
            return_value=SimpleNamespace(stdout='1024\n'),
        ):
            self.assertEqual(CapriVoice.free_gpu_bytes(), 1024**3)

    def test_cuda_decoder_oom_retries_on_cpu_without_changing_profile(self):
        voice = CapriVoice.__new__(CapriVoice)
        voice.engine = object()
        voice.decoder_device = 'cuda:0'
        voice.reference = {}
        voice.config = dict(seed=417, maxSpeechTokens=800)
        voice._decoder_check_after = float('inf')
        voice.set_decoder_device = lambda value: setattr(voice, 'decoder_device', value)
        with patch('integrations.voice_runtime.model.render', side_effect=[
            torch.cuda.OutOfMemoryError(), (b'pcm', 24000, {'totalMs': 1}),
        ]) as render, patch('torch.cuda.empty_cache'):
            self.assertEqual(voice.generate('Hello.'), (b'pcm', 24000))
        self.assertEqual(voice.decoder_device, 'cpu')
        self.assertEqual(render.call_count, 2)
        self.assertIsNone(voice.cancelled)

    def recovery_voice(self):
        voice=CapriVoice.__new__(CapriVoice)
        voice.decoder_device='cpu'
        voice.reference={}
        voice.config=dict(seed=417,maxSpeechTokens=800)
        voice._decoder_check_after=float('inf')
        native=lambda: None
        replay=lambda: None
        voice.engine=SimpleNamespace(t3=SimpleNamespace(inference_turbo=replay))
        voice.graph=SimpleNamespace(native=native)
        return voice,native,replay

    def test_reached_token_cap_retries_whole_sentence_once_on_native_then_restores_graph(self):
        voice,native,replay=self.recovery_voice()
        calls=[]
        def render(engine,text,**options):
            calls.append((text,dict(options),engine.t3.inference_turbo))
            if len(calls)==1: raise SpeechGenerationLimit()
            return b'complete sentence PCM',24000,dict(tokenMs=2,decoderMs=3,totalMs=5)
        with patch('integrations.voice_runtime.model.render',side_effect=render):
            self.assertEqual(voice.generate('A complete sentence.'),(b'complete sentence PCM',24000))
        self.assertEqual([c[0] for c in calls],['A complete sentence.']*2)
        self.assertEqual([c[1]['seed'] for c in calls],[417,418])
        self.assertEqual([c[1]['max_tokens'] for c in calls],[800,800])
        self.assertIs(calls[0][2],replay)
        self.assertIs(calls[1][2],native)
        self.assertIs(voice.engine.t3.inference_turbo,replay)
        self.assertEqual(voice.generation_recoveries,1)
        self.assertEqual(voice.last_metrics['recovery'],'native-retry')
        self.assertIsNone(voice.cancelled)

    def test_native_recovery_is_bounded_and_never_retries_cancellation_or_unrelated_errors(self):
        voice,native,replay=self.recovery_voice()
        with patch('integrations.voice_runtime.model.render',side_effect=SpeechGenerationLimit()) as render:
            with self.assertRaises(SpeechGenerationLimit): voice.generate('Sentence.')
            self.assertEqual(render.call_count,2)
        self.assertIs(voice.engine.t3.inference_turbo,replay)
        for error in [VoiceCancelled('cancelled'),RuntimeError('unrelated kernel failure')]:
            with patch('integrations.voice_runtime.model.render',side_effect=error) as render:
                with self.assertRaises(type(error)): voice.generate('Sentence.')
                self.assertEqual(render.call_count,1)
            self.assertIs(voice.engine.t3.inference_turbo,replay)
        event=threading.Event()
        def limit(*args,**kwargs): event.set();raise SpeechGenerationLimit()
        with patch('integrations.voice_runtime.model.render',side_effect=limit) as render:
            with self.assertRaises(VoiceCancelled):voice.generate('Sentence.',event)
            self.assertEqual(render.call_count,1)


if __name__ == '__main__':
    unittest.main()
