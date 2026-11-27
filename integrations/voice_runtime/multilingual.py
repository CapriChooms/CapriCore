"""Chatterbox Multilingual v3, conditioned on the verified Capri reference.

The Turbo LoRA is architecture-specific and is deliberately never loaded here.
All tokenization and inference stay offline; only one voice backend is resident.
"""
import gc
import json
import time

import numpy as np
import torch
import torch.nn.functional as F

from integrations.multilingual import LANGUAGES, verified_model
from integrations.voice_training.backend import local_environment
from integrations.voice_training.dataset import digest, inside
from integrations.voice_training.low_memory import load_multilingual_cpu

from .catalog import selected_voice
from .inference import SpeechGenerationLimit, check_cancelled
from .model import CapriVoice, DecoderMemoryBudget
from .multilingual_graph import cuda_graphs_supported
from .qwen_provision import RUSSIAN_QWEN_ID
from .reference_memory import prepare_reference
from .s3gen_fast import FastS3GenDecoder
from .text import validate_speech_language


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
    def __init__(self, config, component='tts'):
        startup_threads = config.get('startupCpuThreads', config['cpuThreads'])
        torch.set_num_threads(startup_threads)
        local_environment()
        folder = verified_model(component)
        from chatterbox.models.tokenizers import tokenizer
        converter = offline_converter(folder)
        original = tokenizer.ChineseCangjieConverter
        tokenizer.ChineseCangjieConverter = converter
        compute = config.get('computeDevice', 'cuda:0')
        try:
            self.engine = load_multilingual_cpu(folder, cpu_inference=compute == 'cpu')
            profile_folder = config['profilePath']
            profile = json.loads((profile_folder / 'voice-profile.json').read_text(encoding='utf-8'))
            reference = profile['references']['neutral']
            reference_file = inside(profile_folder, reference['file'])
            if digest(reference_file) != reference['sha256']:
                raise ValueError('Capri reference checksum mismatch')
            self.reference_memory = prepare_reference(self.engine, str(reference_file), exaggeration=.5)
        finally:
            tokenizer.ChineseCangjieConverter = original
            torch.set_num_threads(config['cpuThreads'])

        # Half precision applies to the multilingual Llama backbone on CUDA.
        # CPU inference keeps FP32; S3Gen chooses native BF16 flow (Ampere+) or FP32.
        precision = torch.float32 if compute == 'cpu' else torch.float16
        self.engine.t3.to(device=compute, dtype=precision).eval()
        self.engine.device = compute
        self.engine.conds.t3.to(device=compute, dtype=precision)
        self.config, self.cancelled, self.last_metrics = config, None, {}
        self.decoder_device = 'cpu'
        self.generation_recoveries = 0
        self.token_ms = 0.0
        self.engine.t3.tfmr.register_forward_pre_hook(lambda *_: check_cancelled(self.cancelled))
        self.engine.s3gen.flow.decoder.estimator.register_forward_pre_hook(lambda *_: check_cancelled(self.cancelled))
        self._native_inference = self.engine.t3.inference
        self.engine.t3.inference = self.bounded_tokens
        self.fast_decoder = FastS3GenDecoder(
            self.engine.s3gen,
            enable_cuda_graph=config.get('cudaGraph', True),
        )
        self.graph = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        self.choose_decoder()
        if (
            cuda_graphs_supported(compute)
            and config.get('cudaGraph', True)
            and self.free_gpu_bytes() >= 768 * 1024**2
        ):
            try:
                from .multilingual_graph import MultilingualT3Graph
                self.graph = MultilingualT3Graph(
                    self.engine.t3,
                    cancelled=lambda: self.cancelled,
                    capacity=max(1088, config['maxSpeechTokens'] + 288),
                    max_tokens=config['maxSpeechTokens'],
                )
            except (RuntimeError, ValueError, AssertionError, torch.cuda.OutOfMemoryError) as error:
                self.graph = None
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                print(
                    f'Multilingual T3 CUDA Graph unavailable; using native inference ({type(error).__name__})',
                    flush=True,
                )
        if self.decoder_device != 'cpu':
            self.fast_decoder.prepare_graphs(
                self.engine.conds.gen,
                cancelled=self.cancelled,
                free_gpu_bytes=self.free_gpu_bytes(),
            )
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def close(self):
        fast_decoder = getattr(self, 'fast_decoder', None)
        if fast_decoder is not None:
            fast_decoder.release_graphs()
        self.graph = None

    def supports_streaming(self):
        return bool(
            self.graph is not None
            and getattr(self, 'fast_decoder', None) is not None
            and self.decoder_device != 'cpu'
        )

    def bounded_tokens(self, **kwargs):
        check_cancelled(self.cancelled)
        limit = self.config['maxSpeechTokens']
        kwargs['max_new_tokens'] = limit
        started = time.perf_counter()
        if self.graph is not None:
            tokens = self.graph.generate(cancelled=self.cancelled, **kwargs)
        else:
            tokens = self._native_inference(**kwargs)
            if tokens.shape[-1] >= limit:
                raise SpeechGenerationLimit()
        if self.engine.device != 'cpu' and torch.cuda.is_available():
            torch.cuda.synchronize()
        self.token_ms = (time.perf_counter() - started) * 1000
        return tokens

    def set_decoder_device(self, device):
        if getattr(self, 'fast_decoder', None) is not None:
            self.engine.conds.gen = self.fast_decoder.configure_device(device, self.engine.conds.gen)
            self.decoder_device = device
            return
        self.engine.s3gen.to(device)
        self.engine.conds.gen = {
            key: value.to(device) if torch.is_tensor(value) else value
            for key, value in self.engine.conds.gen.items()
        }
        self.decoder_device = device

    def _tokenize_text(self, text, language):
        from chatterbox.mtl_tts import SUPPORTED_LANGUAGES, punc_norm
        lang = language.lower() if language else None
        if lang and lang not in SUPPORTED_LANGUAGES:
            raise ValueError(f"Unsupported language_id '{language}'")
        normed = punc_norm(text)
        text_tokens = self.engine.tokenizer.text_to_tokens(normed, language_id=lang).to(self.engine.device)
        text_tokens = torch.cat([text_tokens, text_tokens], dim=0)
        text_tokens = F.pad(text_tokens, (1, 0), value=self.engine.t3.hp.start_text_token)
        text_tokens = F.pad(text_tokens, (0, 1), value=self.engine.t3.hp.stop_text_token)
        return text_tokens

    def _ensure_decoder_graphs(self):
        if (
            self.decoder_device != 'cpu'
            and getattr(self, 'fast_decoder', None) is not None
            and self.fast_decoder.enable_cuda_graph
            and not self.fast_decoder.cfm_cuda_graph
        ):
            self.fast_decoder.prepare_graphs(
                self.engine.conds.gen,
                cancelled=self.cancelled,
                free_gpu_bytes=self.free_gpu_bytes(),
            )

    def render(self, text, language, use_graph=True):
        if getattr(self, 'fast_decoder', None) is not None:
            from chatterbox.models.s3tokenizer import drop_invalid_tokens
            self._ensure_decoder_graphs()
            text_tokens = self._tokenize_text(text, language)
            saved_graph = self.graph
            if not use_graph:
                self.graph = None
            try:
                with torch.inference_mode():
                    speech_tokens = self.bounded_tokens(
                        t3_cond=self.engine.conds.t3,
                        text_tokens=text_tokens,
                        cfg_weight=0.5,
                        temperature=0.8,
                        repetition_penalty=1.2,
                        min_p=0.05,
                        top_p=1.0,
                    )
                    valid = drop_invalid_tokens(speech_tokens[0])
                    return self.fast_decoder.decode_full(
                        valid,
                        self.engine.conds.gen,
                        watermarker=self.engine.watermarker,
                        cancelled=self.cancelled,
                    )
            finally:
                self.graph = saved_graph

        # Native fallback if fast_decoder is not attached.
        engine = self.engine
        native = engine.s3gen.inference

        def decode(*, speech_tokens, ref_dict, **kwargs):
            check_cancelled(self.cancelled)
            return native(speech_tokens=speech_tokens.to(self.decoder_device), ref_dict=ref_dict, **kwargs)

        engine.s3gen.inference = decode
        try:
            return engine.generate(
                text,
                language_id=language,
                exaggeration=.5,
                cfg_weight=.5,
                temperature=.8,
                repetition_penalty=1.2,
            ).squeeze().numpy()
        finally:
            engine.s3gen.inference = native

    def _render_with_oom_fallback(self, text, language, cancelled, use_graph=True):
        try:
            return self.render(text, language, use_graph=use_graph)
        except torch.cuda.OutOfMemoryError:
            if self.decoder_device == 'cpu':
                raise
            self.decoder_oom()
            check_cancelled(cancelled)
            return self.render(text, language, use_graph=use_graph)

    def generate(self, text, cancelled, language):
        self.cancelled = cancelled
        started = time.perf_counter()
        try:
            check_cancelled(cancelled)
            self.rebalance_decoder()
            seed = self.config['seed']
            torch.manual_seed(seed)
            try:
                audio = self._render_with_oom_fallback(text, language, cancelled, use_graph=True)
            except SpeechGenerationLimit:
                if self.graph is None:
                    raise
                check_cancelled(cancelled)
                failed_ms = (time.perf_counter() - started) * 1000
                print('Multilingual speech-token limit: retrying sentence once natively.', flush=True)
                torch.manual_seed((seed + 1) % (2**63))
                audio = self._render_with_oom_fallback(text, language, cancelled, use_graph=False)
                self.token_ms += failed_ms
                self.generation_recoveries += 1
            check_cancelled(cancelled)
            if audio.ndim != 1 or not 0 < len(audio) <= 24000 * 45 or not np.isfinite(audio).all():
                raise RuntimeError('Invalid or excessive synthesized audio')
            elapsed = (time.perf_counter() - started) * 1000
            self.last_metrics = dict(
                tokenMs=round(self.token_ms, 2),
                decoderMs=round(max(0.0, elapsed - self.token_ms), 2),
                totalMs=round(elapsed, 2),
            )
            return audio.astype('<f4').tobytes(), self.engine.sr
        finally:
            self.cancelled = None

    def generate_stream(self, text, cancelled, language):
        """True token-level streaming synthesis yielding (pcm_bytes, sample_rate, chunk_metrics)."""
        check_cancelled(cancelled)
        self.rebalance_decoder()
        if not self.supports_streaming():
            audio, rate = self.generate(text, cancelled, language)
            yield audio, rate, dict(self.last_metrics, chunkIndex=0, isFinal=True)
            return

        self.cancelled = cancelled
        started = time.perf_counter()
        total_t3_ms = 0.0
        total_dec_ms = 0.0
        total_samples = 0
        chunk_index = 0
        try:
            check_cancelled(cancelled)
            self._ensure_decoder_graphs()
            seed = self.config['seed']
            torch.manual_seed(seed)
            text_tokens = self._tokenize_text(text, language)
            stream_state = self.fast_decoder.create_stream_state(ctx_tokens=16, fade_samples=480, seed=seed)

            token_gen = self.graph.generate_stream(
                t3_cond=self.engine.conds.t3,
                text_tokens=text_tokens,
                first_chunk_tokens=28,
                second_chunk_tokens=56,
                stride_tokens=80,
                lookahead_tokens=6,
                max_new_tokens=self.config['maxSpeechTokens'],
                cfg_weight=0.5,
                temperature=0.8,
                repetition_penalty=1.2,
                min_p=0.05,
                top_p=1.0,
                cancelled=cancelled,
            )

            for valid_tokens, emit_start, emit_end, is_first, is_last, chunk_t3_ms in token_gen:
                check_cancelled(cancelled)
                total_t3_ms += chunk_t3_ms
                t_dec0 = time.perf_counter()
                try:
                    wav_chunk = stream_state.decode_chunk(
                        valid_tokens,
                        emit_start,
                        emit_end,
                        is_first,
                        is_last,
                        self.engine.conds.gen,
                        watermarker=self.engine.watermarker,
                        cancelled=cancelled,
                    )
                except torch.cuda.OutOfMemoryError:
                    if self.decoder_device == 'cpu':
                        raise
                    self.decoder_oom()
                    check_cancelled(cancelled)
                    if is_first:
                        stream_state = self.fast_decoder.create_stream_state(
                            ctx_tokens=16,
                            fade_samples=480,
                            seed=seed,
                        )
                    wav_chunk = stream_state.decode_chunk(
                        valid_tokens,
                        emit_start,
                        emit_end,
                        is_first,
                        is_last,
                        self.engine.conds.gen,
                        watermarker=self.engine.watermarker,
                        cancelled=cancelled,
                    )
                chunk_dec_ms = (time.perf_counter() - t_dec0) * 1000
                total_dec_ms += chunk_dec_ms
                check_cancelled(cancelled)

                if wav_chunk.ndim != 1 or len(wav_chunk) == 0 or not np.isfinite(wav_chunk).all():
                    raise RuntimeError('Invalid synthesized audio chunk')
                total_samples += len(wav_chunk)
                if total_samples > 24000 * 45:
                    raise RuntimeError('Invalid or excessive synthesized audio')

                elapsed = (time.perf_counter() - started) * 1000
                chunk_metrics = dict(
                    tokenMs=round(chunk_t3_ms, 2),
                    decoderMs=round(chunk_dec_ms, 2),
                    totalMs=round(elapsed, 2),
                    chunkIndex=chunk_index,
                    isFinal=is_last,
                )
                self.last_metrics = dict(
                    tokenMs=round(total_t3_ms, 2),
                    decoderMs=round(total_dec_ms, 2),
                    totalMs=round(elapsed, 2),
                )
                chunk_index += 1
                yield wav_chunk.astype('<f4').tobytes(), self.engine.sr, chunk_metrics

            if chunk_index == 0:
                raise RuntimeError('Invalid or excessive synthesized audio')
        except SpeechGenerationLimit:
            if chunk_index > 0:
                raise
            # No audio has left yet; fall back cleanly to single-pass native retry.
            check_cancelled(cancelled)
            failed_ms = (time.perf_counter() - started) * 1000
            print('Multilingual stream token limit: retrying sentence once natively.', flush=True)
            torch.manual_seed((self.config['seed'] + 1) % (2**63))
            audio = self._render_with_oom_fallback(text, language, cancelled, use_graph=False)
            check_cancelled(cancelled)
            if audio.ndim != 1 or not 0 < len(audio) <= 24000 * 45 or not np.isfinite(audio).all():
                raise RuntimeError('Invalid or excessive synthesized audio')
            self.generation_recoveries += 1
            elapsed = (time.perf_counter() - started) * 1000
            self.last_metrics = dict(
                tokenMs=round(self.token_ms + failed_ms, 2),
                decoderMs=round(max(0.0, elapsed - (self.token_ms + failed_ms)), 2),
                totalMs=round(elapsed, 2),
            )
            yield audio.astype('<f4').tobytes(), self.engine.sr, dict(self.last_metrics, chunkIndex=0, isFinal=True)
        finally:
            self.cancelled = None


class VoicePool:
    """Sequential worker ownership prevents two TTS models occupying VRAM."""

    def __init__(self, config):
        self.config, self.voice, self.kind, self.language = config, None, None, 'en'
        self.profile = json.loads((config['profilePath'] / 'voice-profile.json').read_text(encoding='utf-8'))
        self.last_metrics = {}

    def supports_streaming(self):
        voice = self.voice
        if voice is None:
            return False
        fn = getattr(voice, 'supports_streaming', None)
        return bool(fn()) if callable(fn) else False

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
        component = selected.get('component', 'tts')
        kind = (
            'turbo'
            if selected['backend'] == 'chatterbox-turbo'
            else 'qwen3-tts-ru-lora'
            if selected.get('id') == RUSSIAN_QWEN_ID
            else 'qwen3-tts'
            if qwen
            else selected.get('component', 'multilingual-v3')
        )
        if kind != self.kind:
            # Verify optional weights before releasing a working English backend.
            if selected['backend'] == 'chatterbox-multilingual-v3':
                verified_model(component)
            if qwen:
                from .qwen import QwenVoice
            close_fn = getattr(self.voice, 'close', None)
            if callable(close_fn):
                close_fn()
            self.voice = None
            self.kind = None
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            self.voice = (
                CapriVoice(self.config)
                if kind == 'turbo'
                else QwenVoice(self.config, model_id=selected.get('id'))
                if qwen
                else MultilingualVoice(self.config, component)
            )
            self.kind = kind
        self.language = language
        check_cancelled(cancelled)

    def generate(self, text, cancelled=None, language='en'):
        validate_speech_language(text, language)
        self.prepare(language, cancelled)
        model_language = LANGUAGES[language].get('modelLanguage', language)
        result = (
            self.voice.generate(text, cancelled)
            if self.kind == 'turbo'
            else self.voice.generate(text, cancelled, model_language)
        )
        self.last_metrics = self.voice.last_metrics
        return result

    def generate_stream(self, text, cancelled=None, language='en'):
        validate_speech_language(text, language)
        self.prepare(language, cancelled)
        model_language = LANGUAGES[language].get('modelLanguage', language)
        stream_fn = getattr(self.voice, 'generate_stream', None)
        if callable(stream_fn) and self.kind != 'turbo':
            for chunk in stream_fn(text, cancelled, model_language):
                self.last_metrics = self.voice.last_metrics
                yield chunk
            self.last_metrics = self.voice.last_metrics
            return
        audio, rate = (
            self.voice.generate(text, cancelled)
            if self.kind == 'turbo'
            else self.voice.generate(text, cancelled, model_language)
        )
        self.last_metrics = self.voice.last_metrics
        yield audio, rate, dict(self.last_metrics, chunkIndex=0, isFinal=True)

    def health(self):
        voice = self.voice
        graph = getattr(voice, 'graph', None)
        fast_decoder = getattr(voice, 'fast_decoder', None)
        reference_memory = getattr(voice, 'reference_memory', {})
        compute = self.config.get('computeDevice', 'cuda:0')
        is_multilingual = (
            self.kind in {'multilingual-v3', 'tts-pt-br', 'tts'}
            or fast_decoder is not None
        )
        if is_multilingual and compute != 'cpu':
            dec_prec = getattr(fast_decoder, 'precision_label', 'float32-decoder')
            precision = f'float16-t3/{dec_prec}'
        else:
            precision = 'float32'
        if self.kind in {'qwen3-tts', 'qwen3-tts-ru-lora'} and voice is not None:
            compute = voice.decoder_device
            precision = voice.precision
        return dict(
            activeEngine=self.kind,
            language=self.language,
            decoderDevice=getattr(voice, 'decoder_device', None),
            computeDevice=compute,
            decoderReason=getattr(voice, 'decoder_reason', None),
            precision=precision,
            mergedProjections=getattr(voice, 'merged_projections', 0),
            cudaGraph=graph is not None,
            cfmCudaGraph=bool(getattr(fast_decoder, 'cfm_cuda_graph', False)),
            cpuThreads=torch.get_num_threads(),
            graphBatchSteps=getattr(graph, 'batch_steps', None),
            graphMaxLogitError=getattr(graph, 'validation_max_error', None),
            generationRecoveries=getattr(voice, 'generation_recoveries', 0),
            referenceEncodersReleased=reference_memory.get('referenceEncodersReleased') is True,
            releasedReferenceEncoderMiB=round(reference_memory.get('releasedEncoderBytes', 0) / 1024**2, 1),
        )
