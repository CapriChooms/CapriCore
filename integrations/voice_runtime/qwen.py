"""Local Qwen3-TTS, conditioned on the verified Capri reference.

This separate runtime does not load the architecture-specific Turbo LoRA.
No model source, audio URL, remote Python code or user transcript is accepted.
"""
import json
import hashlib
import time
import numpy as np
import soundfile as sf
import soxr
import torch
from integrations.voice_training.backend import local_environment
from integrations.voice_training.dataset import digest, inside
from integrations.model_download import _regular_path
from .inference import check_cancelled, SpeechGenerationLimit
from .qwen_provision import ROOT, RUSSIAN_QWEN_ID, verified_qwen
from .compatibility import qwen_compute

LANGUAGES = {'en': 'English', 'zh': 'Chinese', 'ja': 'Japanese', 'ko': 'Korean',
             'de': 'German', 'fr': 'French', 'ru': 'Russian', 'pt': 'Portuguese',
             'es': 'Spanish', 'it': 'Italian'}


def reference_audio(profile_folder):
    profile = json.loads((profile_folder / 'voice-profile.json').read_text(encoding='utf-8'))
    ref = profile['references']['neutral']
    reference = inside(profile_folder, ref['file'])
    _regular_path(reference)
    if digest(reference) != ref['sha256']:
        raise ValueError('Capri reference checksum mismatch')
    info = sf.info(reference)
    if not 0 < info.frames / info.samplerate <= 30 or info.channels > 2:
        raise ValueError('Capri reference must contain at most 30 seconds of speech')
    audio, rate = sf.read(reference, dtype='float32', always_2d=True)
    audio = audio.mean(axis=1)
    if not np.isfinite(audio).all():
        raise ValueError('Invalid Capri reference audio')
    return audio, rate


class QwenVoice:
    def __init__(self, config, model_id=None, root=ROOT):
        local_environment()
        torch.set_num_threads(config['cpuThreads'])
        self.russian = model_id == RUSSIAN_QWEN_ID
        if self.russian:
            from . import russian_qwen
            folder, accent_folder, pack, base_sha = russian_qwen.load_assets(root)
        else:
            folder = verified_qwen(root)
            reference = reference_audio(config['profilePath'])
        from qwen_tts import Qwen3TTSModel
        compute, reason = qwen_compute(torch, config.get('computeDevice', 'cpu'),
                                       config.get('qwenGpuAutomatic', False),
                                       minimum_gib=6 if self.russian else 3)
        accelerated = compute != 'cpu'
        self.engine = Qwen3TTSModel.from_pretrained(str(folder), device_map=compute,
            dtype=torch.bfloat16 if accelerated else torch.float32,
            attn_implementation='sdpa', local_files_only=True,
            trust_remote_code=False)
        self.engine.model.requires_grad_(False).eval()
        with torch.inference_mode():
            if accelerated:
                self.engine.model.speech_tokenizer.model.decoder.float()
            if self.russian:
                self.prompt = russian_qwen.load_prompt(self.engine, pack, base_sha)
                self.accentuator = russian_qwen.load_accentuator(accent_folder)
            else:
                self.prompt = self.engine.create_voice_clone_prompt(ref_audio=reference,
                                                                   x_vector_only_mode=True)
        self.config, self.cancelled, self.last_metrics = config, None, {}
        self.recent_speech = None
        self.decoder_device = compute
        self.decoder_reason = reason
        self.precision = 'bfloat16-talker/float32-decoder' if accelerated else 'float32'
        self.started, self.frames = 0, 0
        self.decode_started, self.decode_seconds = 0, 0
        # Every autoregressive talker step checks cancellation and both a time
        # and frame budget. Exceptions abort before incomplete audio is played.
        self.engine.model.talker.register_forward_pre_hook(self.check_step)
        tokenizer = self.engine.model.speech_tokenizer
        if hasattr(tokenizer, 'model'):
            tokenizer.model.decoder.register_forward_pre_hook(self.start_decode)
            tokenizer.model.decoder.register_forward_hook(self.finish_decode)

    def start_decode(self, *_):
        check_cancelled(self.cancelled)
        self.decode_started = time.monotonic()

    def finish_decode(self, *_):
        self.decode_seconds += time.monotonic() - self.decode_started

    def check_step(self, *_):
        check_cancelled(self.cancelled)
        if self.started:
            self.frames += 1
            if self.frames >= self.limit or time.monotonic() - self.started > 120:
                raise SpeechGenerationLimit()

    @torch.inference_mode()
    def generate(self, text, cancelled, language):
        if language not in LANGUAGES or (self.russian and language != 'ru'):
            raise ValueError('Qwen speech does not support this language')
        check_cancelled(cancelled)
        cache_key = hashlib.sha256(text.encode('utf-8')).digest() if self.russian else None
        if self.recent_speech and self.recent_speech[0] == cache_key:
            self.last_metrics = dict(totalMs=0, tokenMs=0, decoderMs=0)
            return self.recent_speech[1], 24000
        self.cancelled, self.frames = cancelled, 0
        self.decode_seconds = 0
        self.started = time.monotonic()
        # Qwen produces 12 frames/s; cap at 40 s to keep the existing PCM limit.
        self.limit = min(480, self.config['maxSpeechTokens'])
        try:
            check_cancelled(cancelled)
            # A separate, fixed preset prevents the short-phrase repetition
            # observed with Turbo's sampling seed in this multilingual model.
            options = {}
            if self.russian:
                from .russian_qwen import mark_stress
                text = mark_stress(self.accentuator, text)
                options['non_streaming_mode'] = True
            generation_started = time.monotonic()
            torch.manual_seed(417 if self.russian else 42)
            wavs, rate = self.engine.generate_voice_clone(text=text, language=LANGUAGES[language],
                voice_clone_prompt=self.prompt, max_new_tokens=self.limit, do_sample=True,
                temperature=.7, repetition_penalty=1.2, **options)
            generation_seconds = time.monotonic() - generation_started
            check_cancelled(cancelled)
            if len(wavs) != 1 or not isinstance(rate, (int, float)) or not 8000 <= rate <= 96000:
                raise RuntimeError('Invalid synthesized audio')
            audio = np.asarray(wavs[0], dtype=np.float32)
            if audio.ndim != 1 or not 0 < len(audio) <= rate * 45 or not np.isfinite(audio).all():
                raise RuntimeError('Invalid or excessive synthesized audio')
            if rate != 24000:
                audio = soxr.resample(audio, rate, 24000)
            self.last_metrics = dict(
                totalMs=round((time.monotonic() - self.started) * 1000, 2),
                tokenMs=round(max(0, generation_seconds - self.decode_seconds) * 1000, 2),
                decoderMs=round(self.decode_seconds * 1000, 2),
            )
            pcm = audio.astype('<f4').tobytes()
            # Identical short replies already have a fixed seed and reference.
            # Keep just one result in the loaded worker, with no source text.
            if cache_key and len(pcm) <= 512 * 1024:
                self.recent_speech = (cache_key, pcm)
            return pcm, 24000
        finally:
            self.cancelled, self.started = None, 0
