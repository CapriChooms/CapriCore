"""Chatterbox Multilingual v3, conditioned on the verified Capri reference.

The Turbo LoRA is architecture-specific and is deliberately never loaded here.
All tokenization and inference stay offline; only one voice backend is resident.
"""
import gc
import json
import time

import numpy as np
import torch

from integrations.multilingual import LANGUAGES, ROOT, verified_model
from integrations.voice_training.backend import local_environment
from integrations.voice_training.dataset import digest, inside
from .inference import check_cancelled, SpeechGenerationLimit
from .model import CapriVoice, DecoderMemoryBudget
from .text import validate_speech_language
from .catalog import selected_voice
from .qwen_provision import RUSSIAN_QWEN_ID
from .reference_memory import prepare_reference


def offline_converter(folder):
    from chatterbox.models.tokenizers import tokenizer

    class LocalCangjie(tokenizer.ChineseCangjieConverter):
        def _load_cangjie_mapping(self, model_dir=None):
            entries = json.loads((folder / 'Cangjie5_TC.json').read_text(encoding='utf-8'))
            for entry in entries:
                word, code = entry.split('\t')[:2]
                self.word2cj[word] = code
                self.cj2word.setdefault(code, []).append(word)

        def _init_segmenter(self):
            # Other languages need no Chinese segmentation model or startup cost.
            self.segmenter = None

        def __call__(self, text):
            if self.segmenter is None:
                from spacy_pkuseg import pkuseg
                path = verified_model('chinese')
                self.segmenter = pkuseg(model_name=str(path))
            return super().__call__(text)

    return LocalCangjie


class MultilingualVoice(DecoderMemoryBudget):
    def __init__(self, config):
        torch.set_num_threads(config['cpuThreads'])
        local_environment()
        folder = verified_model('tts')
        from chatterbox.models.tokenizers import tokenizer
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        converter = offline_converter(folder)
        original = tokenizer.ChineseCangjieConverter
        tokenizer.ChineseCangjieConverter = converter
        try:
            self.engine = ChatterboxMultilingualTTS.from_local(folder, device='cpu', t3_model='v3')
        finally:
            tokenizer.ChineseCangjieConverter = original
        profile_folder = config['profilePath']
        profile = json.loads((profile_folder / 'voice-profile.json').read_text(encoding='utf-8'))
        reference = profile['references']['neutral']
        reference_file = inside(profile_folder, reference['file'])
        if digest(reference_file) != reference['sha256']:
            raise ValueError('Capri reference checksum mismatch')
        self.reference_memory = prepare_reference(self.engine, str(reference_file), exaggeration=.5)
        # Half precision applies only to the multilingual Llama backbone. The
        # trained English Turbo and both acoustic decoders retain FP32.
        compute = config.get('computeDevice', 'cuda:0')
        precision = torch.float32 if compute == 'cpu' else torch.float16
        self.engine.t3.to(device=compute, dtype=precision).eval()
        self.engine.device = compute
        self.engine.conds.t3.to(device=compute, dtype=precision)
        self.config, self.cancelled, self.last_metrics = config, None, {}
        self.decoder_device = 'cpu'
        self.engine.t3.tfmr.register_forward_pre_hook(lambda *_: check_cancelled(self.cancelled))
        self.engine.s3gen.flow.decoder.estimator.register_forward_pre_hook(lambda *_: check_cancelled(self.cancelled))
        self._native_inference = self.engine.t3.inference
        self.engine.t3.inference = self.bounded_tokens
        torch.cuda.empty_cache()
        self.choose_decoder()

    def bounded_tokens(self, **kwargs):
        check_cancelled(self.cancelled)
        limit = self.config['maxSpeechTokens']
        kwargs['max_new_tokens'] = limit
        started = time.perf_counter()
        tokens = self._native_inference(**kwargs)
        if self.engine.device != 'cpu':
            torch.cuda.synchronize()
        self.token_ms = (time.perf_counter() - started) * 1000
        if tokens.shape[-1] >= limit:
            raise SpeechGenerationLimit()
        return tokens

    def set_decoder_device(self, device):
        self.engine.s3gen.to(device)
        self.engine.conds.gen = {key: value.to(device) if torch.is_tensor(value) else value
                                 for key, value in self.engine.conds.gen.items()}
        self.decoder_device = device

    def render(self, text, language):
        # Native Multilingual.generate puts decoder tokens on engine.device. The
        # wrapper moves inputs to the decoder without changing T3's CUDA device.
        engine = self.engine
        native = engine.s3gen.inference
        def decode(*, speech_tokens, ref_dict, **kwargs):
            check_cancelled(self.cancelled)
            return native(speech_tokens=speech_tokens.to(self.decoder_device), ref_dict=ref_dict, **kwargs)
        engine.s3gen.inference = decode
        try:
            return engine.generate(text, language_id=language, exaggeration=.5, cfg_weight=.5,
                                   temperature=.8, repetition_penalty=1.2).squeeze().numpy()
        finally:
            engine.s3gen.inference = native

    def generate(self, text, cancelled, language):
        self.cancelled = cancelled
        started = time.perf_counter()
        try:
            check_cancelled(cancelled)
            self.rebalance_decoder()
            torch.manual_seed(self.config['seed'])
            try:
                audio = self.render(text, language)
            except torch.cuda.OutOfMemoryError:
                if self.decoder_device == 'cpu':
                    raise
                self.decoder_oom()
                check_cancelled(cancelled)
                audio = self.render(text, language)
            check_cancelled(cancelled)
            if audio.ndim != 1 or not 0 < len(audio) <= 24000 * 45 or not np.isfinite(audio).all():
                raise RuntimeError('Invalid or excessive synthesized audio')
            elapsed = (time.perf_counter() - started) * 1000
            self.last_metrics = dict(tokenMs=round(self.token_ms,2), decoderMs=round(elapsed-self.token_ms,2), totalMs=round(elapsed,2))
            return audio.astype('<f4').tobytes(), self.engine.sr
        finally:
            self.cancelled = None


class VoicePool:
    """Sequential worker ownership prevents two TTS models occupying VRAM."""
    def __init__(self, config):
        self.config, self.voice, self.kind, self.language = config, None, None, 'en'
        self.profile = json.loads((config['profilePath'] / 'voice-profile.json').read_text(encoding='utf-8'))
        self.last_metrics = {}

    def prepare(self, language, cancelled=None):
        if not LANGUAGES.get(language, {}).get('speech'):
            raise ValueError('Unsupported spoken language')
        check_cancelled(cancelled)
        selected = selected_voice(language)
        if self.config.get('validateTurbo'):
            selected = dict(backend='chatterbox-turbo')
        if language == 'zh' and self.language != 'zh' and selected['backend'] != 'qwen3-tts':
            # Selected-language installations may omit Chinese-only data.
            verified_model('chinese')
        qwen = selected['backend'] == 'qwen3-tts'
        kind = ('turbo' if selected['backend'] == 'chatterbox-turbo' else
                'qwen3-tts-ru-lora' if selected.get('id') == RUSSIAN_QWEN_ID else
                'qwen3-tts' if qwen else 'multilingual-v3')
        if kind != self.kind:
            # Verify optional weights before releasing a working English backend.
            if kind == 'multilingual-v3':
                verified_model('tts')
            if qwen:
                from .qwen import QwenVoice
            self.voice = None
            self.kind = None
            gc.collect()
            torch.cuda.empty_cache()
            self.voice = (CapriVoice(self.config) if kind == 'turbo' else
                          QwenVoice(self.config, model_id=selected.get('id')) if qwen else MultilingualVoice(self.config))
            self.kind = kind
        self.language = language
        check_cancelled(cancelled)

    def generate(self, text, cancelled=None, language='en'):
        validate_speech_language(text, language)
        self.prepare(language, cancelled)
        result = (self.voice.generate(text, cancelled) if self.kind == 'turbo'
                  else self.voice.generate(text, cancelled, language))
        self.last_metrics = self.voice.last_metrics
        return result

    def health(self):
        voice = self.voice
        graph = getattr(voice, 'graph', None)
        reference_memory = getattr(voice, 'reference_memory', {})
        compute = self.config.get('computeDevice', 'cuda:0')
        precision = 'float16-t3/float32-decoder' if self.kind == 'multilingual-v3' and compute != 'cpu' else 'float32'
        if self.kind in {'qwen3-tts', 'qwen3-tts-ru-lora'} and voice is not None:
            compute = voice.decoder_device
            precision = voice.precision
        return dict(activeEngine=self.kind, language=self.language, decoderDevice=getattr(voice, 'decoder_device', None),
                    computeDevice=compute,
                    decoderReason=getattr(voice, 'decoder_reason', None),
                    precision=precision,
                    mergedProjections=getattr(voice, 'merged_projections', 0), cudaGraph=graph is not None,
                    cpuThreads=torch.get_num_threads(),
                    graphBatchSteps=getattr(graph, 'batch_steps', None),
                    graphMaxLogitError=getattr(graph, 'validation_max_error', None),
                    generationRecoveries=getattr(voice, 'generation_recoveries', 0),
                    referenceEncodersReleased=reference_memory.get('referenceEncodersReleased') is True,
                    releasedReferenceEncoderMiB=round(reference_memory.get('releasedEncoderBytes', 0) / 1024**2, 1))
