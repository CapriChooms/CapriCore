"""Local CPU Qwen3-TTS Base, conditioned on the verified Capri reference.

This separate runtime does not load the architecture-specific Turbo LoRA.
No model source, audio URL, remote Python code or user transcript is accepted.
"""
import json
import time
import numpy as np
import soundfile as sf
import soxr
import torch
from integrations.voice_training.backend import local_environment
from integrations.voice_training.dataset import digest, inside
from integrations.model_download import _regular_path
from .inference import check_cancelled, SpeechGenerationLimit
from .qwen_provision import verified_qwen

LANGUAGES = {'en': 'English', 'zh': 'Chinese', 'ja': 'Japanese', 'ko': 'Korean',
             'de': 'German', 'fr': 'French', 'ru': 'Russian', 'pt': 'Portuguese',
             'es': 'Spanish', 'it': 'Italian'}


class QwenVoice:
    def __init__(self, config):
        local_environment()
        torch.set_num_threads(config['cpuThreads'])
        folder = verified_qwen()
        profile_folder = config['profilePath']
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
        from qwen_tts import Qwen3TTSModel
        compute = config.get('computeDevice', 'cpu')
        self.engine = Qwen3TTSModel.from_pretrained(str(folder), device_map=compute,
            dtype=torch.float32, attn_implementation='sdpa', local_files_only=True,
            trust_remote_code=False)
        self.engine.model.requires_grad_(False).eval()
        with torch.inference_mode():
            self.prompt = self.engine.create_voice_clone_prompt(ref_audio=(audio, rate),
                                                              x_vector_only_mode=True)
        self.config, self.cancelled, self.last_metrics = config, None, {}
        self.decoder_device, self.decoder_reason = compute, 'configured voice device'
        self.started, self.frames = 0, 0
        # Every autoregressive talker step checks cancellation and both a time
        # and frame budget. Exceptions abort before incomplete audio is played.
        self.engine.model.talker.register_forward_pre_hook(self.check_step)
        tokenizer = self.engine.model.speech_tokenizer
        if hasattr(tokenizer, 'model'):
            tokenizer.model.register_forward_pre_hook(lambda *_: check_cancelled(self.cancelled))

    def check_step(self, *_):
        check_cancelled(self.cancelled)
        if self.started:
            self.frames += 1
            if self.frames >= self.limit or time.monotonic() - self.started > 120:
                raise SpeechGenerationLimit()

    @torch.inference_mode()
    def generate(self, text, cancelled, language):
        if language not in LANGUAGES:
            raise ValueError('Qwen speech does not support this language')
        self.cancelled, self.frames = cancelled, 0
        self.started = time.monotonic()
        # Qwen produces 12 frames/s; cap at 40 s to keep the existing PCM limit.
        self.limit = min(480, self.config['maxSpeechTokens'])
        try:
            check_cancelled(cancelled)
            # A separate, fixed preset prevents the short-phrase repetition
            # observed with Turbo's sampling seed in this multilingual model.
            torch.manual_seed(42)
            wavs, rate = self.engine.generate_voice_clone(text=text, language=LANGUAGES[language],
                voice_clone_prompt=self.prompt, max_new_tokens=self.limit, do_sample=True,
                temperature=.7, repetition_penalty=1.2)
            check_cancelled(cancelled)
            if len(wavs) != 1 or not isinstance(rate, (int, float)) or not 8000 <= rate <= 96000:
                raise RuntimeError('Invalid synthesized audio')
            audio = np.asarray(wavs[0], dtype=np.float32)
            if audio.ndim != 1 or not 0 < len(audio) <= rate * 45 or not np.isfinite(audio).all():
                raise RuntimeError('Invalid or excessive synthesized audio')
            if rate != 24000:
                audio = soxr.resample(audio, rate, 24000)
            elapsed = round((time.monotonic() - self.started) * 1000, 2)
            self.last_metrics = dict(totalMs=elapsed, tokenMs=elapsed, decoderMs=0)
            return audio.astype('<f4').tobytes(), 24000
        finally:
            self.cancelled, self.started = None, 0
