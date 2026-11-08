"""Pinned, offline CPU Parakeet recognition and Silero speech detection."""
import hashlib
import json
import math
import os
from pathlib import Path

import sherpa_onnx
from integrations.multilingual import LANGUAGES, verified_model
from .alignment import word_boundaries
from .vocabulary import bpe_vocabulary, contextual_phrases

ROOT = Path(__file__).resolve().parents[2]


def settings():
    value = json.loads((ROOT / 'config/companion-asr.json').read_text(encoding='utf-8'))
    if (value.get('schemaVersion') != 1 or value.get('engine') != 'parakeet-tdt-0.6b-v2'
            or value.get('language') != 'en' or value.get('sampleRate') != 16000 or value.get('chunkMs') != 100
            or type(value.get('cpuThreads')) is not int or not 1 <= value['cpuThreads'] <= 8
            or value.get('decodingMethod') not in {'greedy_search', 'modified_beam_search'}
            or type(value.get('maxActivePaths')) is not int or not 1 <= value['maxActivePaths'] <= 8
            or not .5 <= value.get('trailingSilenceSeconds', 0) <= 5
            or not 10 <= value.get('maxUtteranceSeconds', 0) <= 60
            or type(value.get('autoSend')) is not bool or type(value.get('bargeIn')) is not bool):
        raise ValueError('Invalid speech recognition settings')
    value['cpuThreads'] = max(1, min(value['cpuThreads'], os.cpu_count() or 1, int(os.environ.get('CAPRI_CPU_THREADS', '8'))))
    vad = value.get('vad', {})
    if (not .2 <= vad.get('threshold', 0) <= .9 or not .06 <= vad.get('minSpeechSeconds', 0) <= .5
            or not .5 <= vad.get('wakeProbeSeconds', 0) <= 2):
        raise ValueError('Invalid speech detection settings')
    for item in (value, vad):
        item['folder'] = (ROOT / item['modelDir']).resolve()
        if not item['folder'].is_relative_to(ROOT / 'data/speech'):
            raise ValueError('Speech models must stay inside data/speech')
    language = os.environ.get('CAPRI_ASR_LANGUAGE', 'en')
    if language not in LANGUAGES and language not in {'auto', 'auto-europe'}:
        raise ValueError('Unsupported recognition language')
    value['language'] = language
    if language == 'auto-europe' or (language != 'en' and LANGUAGES.get(language, {}).get('recognizer') == 'parakeet-v3'):
        value['folder'] = ROOT / 'data/speech/candidates/parakeet-tdt-v3-int8'
        value['engine'] = 'parakeet-tdt-0.6b-v3'
        # The pinned NeMo TDT v3 beam decoder can return an empty transcript
        # for clear speech. Native greedy decoding handles the same recording.
        value['decodingMethod'] = 'greedy_search'
    elif language != 'en':
        value['engine'] = 'whisper-large-v3-turbo'
    if os.environ.get('CAPRI_ASR_SAFE_STARTUP') == '1':
        # Reduce native initialization work for the one-shot crash recovery;
        # keep the selected language and verified model files unchanged.
        value['cpuThreads'] = 1
        value['decodingMethod'] = 'greedy_search'
        value['maxActivePaths'] = 1
    return value


def validate_pause(value):
    if (type(value) not in (int, float) or not math.isfinite(value) or not .5 <= value <= 5
            or abs(value * 10 - round(value * 10)) > 1e-8):
        raise ValueError('Invalid end-of-speech pause')
    return round(value, 1)


def verified_files(config, manifest='asr-model-upstream.json'):
    upstream = json.loads((ROOT / 'config' / manifest).read_text(encoding='utf-8'))
    paths = {}
    for name, item in upstream['files'].items():
        path = (config['folder'] / item['file']).resolve()
        if path.parent != config['folder'] or not path.is_file() or path.stat().st_size != item['bytes']:
            raise ValueError('Recognition model is missing; run setup-streaming-asr.cmd')
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if digest != item['sha256']:
            raise ValueError('Recognition model checksum mismatch')
        paths[name] = str(path)
    return paths


class ParakeetRecognizer:
    def __init__(self, config):
        if config['engine']=='parakeet-tdt-0.6b-v3':
            import hashlib
            import json
            spec=json.loads((ROOT/'config/multilingual-candidates.json').read_text(encoding='utf-8'))['asr']
            folder=(ROOT/spec['directory']).resolve()
            if not folder.is_relative_to(ROOT/'data/speech/candidates'):
                raise ValueError('Candidate recognizer must stay in its model directory')
            paths={}
            for item in spec['files']:
                path=(folder/item['file']).resolve()
                if path.parent!=folder:
                    raise ValueError('Invalid candidate model filename')
                with path.open('rb') as source:
                    if path.stat().st_size!=item['bytes'] or hashlib.file_digest(source,'sha256').hexdigest()!=item['sha256']:
                        raise ValueError('Multilingual recognition checksum mismatch')
                paths[item['file'].split('.')[0]]=str(path)
        else:
            paths=verified_files(config,'asr-model-upstream.json')
        self.phrases = contextual_phrases(ROOT, config['language'])
        self.biased = config['decodingMethod'] == 'modified_beam_search'
        self.engine = sherpa_onnx.OfflineRecognizer.from_transducer(
            **paths, num_threads=config['cpuThreads'],
            provider='cpu', sample_rate=16000, decoding_method=config['decodingMethod'], model_type='nemo_transducer',
            max_active_paths=config['maxActivePaths'], modeling_unit='bpe', bpe_vocab=bpe_vocabulary(ROOT, paths['tokens']))

    def recognize(self, pcm, *, wake=False, addressed=False):
        phrases = self.phrases['wake'] if wake else self.phrases['commands'] if addressed else '/'.join(filter(None, self.phrases.values()))
        stream = self.engine.create_stream(phrases if self.biased and phrases else None)
        stream.accept_waveform(16000, pcm)
        self.engine.decode_stream(stream)
        text = ' '.join(stream.result.text.split())
        if len(text) > 4096:
            raise ValueError('Final transcript exceeds limit')
        result = stream.result
        return dict(text=text, boundaries=word_boundaries(text, result.tokens, result.timestamps, result.durations, len(pcm)))

    def transcribe(self, pcm):
        return self.recognize(pcm)['text']


class WhisperRecognizer:
    """Full utterances in RAM; fast English Parakeet is used only for the wake gate."""
    def __init__(self, config):
        from .shared_encoder import SharedEncoderWhisper
        self.language = None if config['language'] == 'auto' else config['language']
        self.engine = SharedEncoderWhisper(str(verified_model('whisper')), device='cpu', compute_type='int8',
                                   cpu_threads=config['cpuThreads'], num_workers=1, local_files_only=True)
        english = dict(config, language='en', engine='parakeet-tdt-0.6b-v2')
        english['folder'] = ROOT / json.loads((ROOT / 'config/companion-asr.json').read_text(encoding='utf-8'))['modelDir']
        self.wake_engine = ParakeetRecognizer(english)

    def recognize(self, pcm, *, wake=False, addressed=False):
        if wake:
            return self.wake_engine.recognize(pcm, wake=True)
        from contextlib import nullcontext
        # transcribe returns a lazy iterator: keep reuse alive through decoding,
        # and release it even if decoding or word alignment fails.
        reuse = getattr(self.engine, 'reuse_encoder', nullcontext)
        with reuse():
            return self._recognize_utterance(pcm)

    def _recognize_utterance(self, pcm):
        segments, info = self.engine.transcribe(
            pcm, language=self.language, task='transcribe', beam_size=5, best_of=1,
            temperature=0, condition_on_previous_text=False, word_timestamps=True,
            vad_filter=False, hotwords='Capri, Spotify', hallucination_silence_threshold=1.0,
            max_new_tokens=440)
        text, boundaries = '', []
        for segment in segments:
            if segment.no_speech_prob > .6 and segment.avg_logprob < -1:
                continue
            for word in segment.words or []:
                token = word.word.strip()
                if not token:
                    continue
                # Spaces keep exact text offsets stable for wake-prefix removal.
                if text and (word.word[:1].isspace() or info.language not in {'ja', 'zh', 'yue', 'th', 'lo', 'my'}):
                    text += ' '
                start = len(text)
                text += token
                boundaries.append(dict(start=start, end=len(text),
                    startSample=max(0, min(len(pcm), round(word.start * 16000))),
                    endSample=max(1, min(len(pcm), round(word.end * 16000)))))
            if not segment.words and segment.text.strip():
                text += (' ' if text else '') + segment.text.strip()
        if len(text) > 4096:
            raise ValueError('Final transcript exceeds limit')
        return dict(text=text, boundaries=boundaries, language=info.language)

    def transcribe(self, pcm):
        return self.recognize(pcm)['text']


def Recognizer(config):
    return WhisperRecognizer(config) if config['engine'] == 'whisper-large-v3-turbo' else ParakeetRecognizer(config)


class SpeechDetector:
    def __init__(self, config):
        model = verified_files(config['vad'], 'asr-vad-upstream.json')['model']
        self.config = sherpa_onnx.VadModelConfig()
        self.config.sample_rate = 16000
        self.config.num_threads = 1
        self.config.provider = 'cpu'
        self.config.silero_vad.model = model
        self.config.silero_vad.threshold = config['vad']['threshold']
        self.config.silero_vad.window_size = 512
        self.config.silero_vad.min_speech_duration = config['vad']['minSpeechSeconds']
        self.config.silero_vad.min_silence_duration = config['trailingSilenceSeconds']
        self.max_seconds = config['maxUtteranceSeconds']

    def session(self, pause=None):
        if pause is not None:
            self.config.silero_vad.min_silence_duration = validate_pause(pause)
        # Sherpa shortens silence and raises the VAD threshold at its hard limit.
        # Put that artificial endpoint beyond RecognitionSession's bounded turn
        # reset, or a still-continuing command could be emitted as a final chunk.
        self.config.silero_vad.max_speech_duration = (
            self.max_seconds + max(4, self.config.silero_vad.min_silence_duration + 2) + 1)
        return sherpa_onnx.VoiceActivityDetector(self.config, buffer_size_in_seconds=75)
