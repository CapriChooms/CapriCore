"""Tiny CPU-only conditioning fixtures; never load speech models or microphones."""
from contextlib import contextmanager
import gc
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
import weakref

try:
    import torch
except ImportError:
    torch = None


@contextmanager
def pinned_decoder():
    class Decoder(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.tokenizer = torch.nn.Linear(2, 2)
            self.speaker_encoder = torch.nn.Linear(2, 2)
            self.flow = torch.nn.Linear(2, 2)
            self.mel2wav = torch.nn.Linear(2, 2)
            self.register_buffer('trim_fade', torch.ones(2), persistent=False)
            self.meanflow = False
            self.mel_extractor = None
            self.resamplers = {}
            self.estimator_dtype = 'fp32'

        def inference(self, speech_tokens, ref_dict):
            return self.flow(speech_tokens) + ref_dict['embedding']

    module = ModuleType('chatterbox.models.s3gen')
    module.S3Gen = Decoder
    with patch.dict('sys.modules', {'chatterbox.models.s3gen': module}):
        yield Decoder


@unittest.skipIf(torch is None, 'Requires the local Torch runtime; no speech weights are needed')
class ReferenceMemoryTests(unittest.TestCase):
    def fixture(self, decoder):
        engine = SimpleNamespace(t3=torch.nn.Linear(2, 2), s3gen=decoder(), ve=torch.nn.Linear(2, 2))

        def prepare(_path, **_kwargs):
            self.assertTrue(torch.is_inference_mode_enabled())
            self.assertFalse(any(parameter.requires_grad for module in (engine.t3, engine.s3gen, engine.ve)
                                 for parameter in module.parameters()))
            embedding = engine.s3gen.speaker_encoder(torch.ones(1, 2))
            engine.conds = SimpleNamespace(
                gen={'embedding': embedding, 'prompt_token': torch.ones(1, dtype=torch.long),
                     'prompt_token_len': torch.ones(1, dtype=torch.long), 'prompt_feat': torch.ones(1, 2),
                     'prompt_feat_len': None},
                t3=SimpleNamespace(speaker_emb=engine.ve(torch.ones(1, 2))),
            )
        engine.prepare_conditionals = prepare
        return engine

    def test_conditioning_keeps_values_and_native_decoder_without_reference_weights(self):
        from integrations.voice_runtime.reference_memory import prepare_reference
        with pinned_decoder() as decoder:
            engine = self.fixture(decoder)
            flow, mel2wav, fade = engine.s3gen.flow, engine.s3gen.mel2wav, engine.s3gen.trim_fade
            weights = flow.weight.detach().clone()
            expected_bytes = sum(tensor.untyped_storage().nbytes()
                                 for module in (engine.ve, engine.s3gen.tokenizer, engine.s3gen.speaker_encoder)
                                 for tensor in module.parameters())
            result = prepare_reference(engine, 'verified-reference.wav')
            self.assertEqual(result, {'releasedEncoderBytes': expected_bytes, 'referenceEncodersReleased': True})
            self.assertIs(engine.s3gen.flow, flow)
            self.assertIs(engine.s3gen.mel2wav, mel2wav)
            self.assertIs(engine.s3gen.trim_fade, fade)
            self.assertTrue(torch.equal(flow.weight, weights))
            self.assertIsNone(engine.ve)
            self.assertFalse(hasattr(engine.s3gen, 'tokenizer'))
            self.assertFalse(hasattr(engine.s3gen, 'speaker_encoder'))
            self.assertIsNone(engine.conds.gen['embedding'].grad_fn)
            self.assertFalse(engine.conds.gen['embedding'].requires_grad)
            expected = flow(torch.ones(1, 2)) + engine.conds.gen['embedding']
            self.assertTrue(torch.equal(engine.s3gen.inference(torch.ones(1, 2), engine.conds.gen), expected))
            engine.s3gen.to(dtype=torch.float64)
            self.assertEqual(engine.s3gen.dtype, torch.float64)
            self.assertEqual(engine.s3gen.device, flow.weight.device)
            with self.assertRaisesRegex(RuntimeError, 'reload the voice'):
                engine.s3gen.embed_ref(None)

    def test_unknown_buffers_or_modules_keep_encoders_but_still_disable_autograd(self):
        from integrations.voice_runtime.reference_memory import prepare_reference
        for change in ('buffer', 'module', 'hook'):
            with self.subTest(change=change), pinned_decoder() as decoder:
                engine = self.fixture(decoder)
                if change == 'buffer':
                    engine.s3gen.register_buffer('future_buffer', torch.ones(1))
                elif change == 'module':
                    engine.s3gen.future_module = torch.nn.Linear(2, 2)
                else:
                    engine.s3gen.register_forward_pre_hook(lambda *_args: None)
                original, encoder = engine.s3gen, engine.ve
                self.assertEqual(prepare_reference(engine, 'verified.wav'),
                                 {'releasedEncoderBytes': 0, 'referenceEncodersReleased': False})
                self.assertIs(engine.s3gen, original)
                self.assertIs(engine.ve, encoder)
                self.assertIsNone(engine.conds.gen['embedding'].grad_fn)

    def test_replacement_does_not_keep_the_original_or_discarded_encoders_alive(self):
        from integrations.voice_runtime.reference_memory import prepare_reference
        with pinned_decoder() as decoder:
            engine = self.fixture(decoder)
            previous = [weakref.ref(module) for module in
                        (engine.s3gen, engine.ve, engine.s3gen.tokenizer, engine.s3gen.speaker_encoder)]
            self.assertTrue(prepare_reference(engine, 'verified.wav')['referenceEncodersReleased'])
            gc.collect()
            self.assertTrue(all(reference() is None for reference in previous))

    def test_retained_shared_tensor_storage_is_not_reported_as_released(self):
        from integrations.voice_runtime.reference_memory import prepare_reference
        with pinned_decoder() as decoder:
            engine = self.fixture(decoder)
            engine.ve = engine.s3gen.flow
            expected = sum(tensor.untyped_storage().nbytes()
                           for module in (engine.s3gen.tokenizer, engine.s3gen.speaker_encoder)
                           for tensor in module.parameters())
            self.assertEqual(prepare_reference(engine, 'verified.wav')['releasedEncoderBytes'], expected)

    def test_conditioning_failure_does_not_remove_models(self):
        from integrations.voice_runtime.reference_memory import prepare_reference
        with pinned_decoder() as decoder:
            engine = self.fixture(decoder)
            original, encoder = engine.s3gen, engine.ve
            def fail(*_args, **_kwargs):
                raise ValueError('invalid reference')
            engine.prepare_conditionals = fail
            with self.assertRaisesRegex(ValueError, 'invalid reference'):
                prepare_reference(engine, 'verified.wav')
            self.assertIs(engine.s3gen, original)
            self.assertIs(engine.ve, encoder)


if __name__ == '__main__':
    unittest.main()
