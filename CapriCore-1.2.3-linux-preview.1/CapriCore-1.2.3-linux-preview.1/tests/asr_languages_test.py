"""Language routing and timestamp-preserving Whisper formatting, without model loading."""
import os
import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch
import numpy as np
from integrations.asr_runtime.model import settings, WhisperRecognizer
from integrations.asr_runtime.alignment import remove_wake_prefix
from integrations.asr_runtime.shared_encoder import SharedEncoderWhisper

class LanguagesTest(unittest.TestCase):
    def test_encoder_reuse_requires_identical_features_and_is_scoped_to_request(self):
        engine = object.__new__(SharedEncoderWhisper)
        features = np.ones((128, 3000), dtype=np.float32)
        encoded = object()
        with patch('faster_whisper.WhisperModel.encode', return_value=encoded) as native:
            with engine.reuse_encoder():
                self.assertIs(engine.encode(features), encoded)
                self.assertIs(engine.encode(features.copy()), encoded)
                self.assertEqual(native.call_count, 1)
                changed = features.copy(); changed[0, -1] = 2
                engine.encode(changed)
                self.assertEqual(native.call_count, 2)
            self.assertIsNone(engine._shared_encoder_entry)
            engine.encode(features)
            self.assertEqual(native.call_count, 3)
            with self.assertRaisesRegex(RuntimeError, 'failed'):
                with engine.reuse_encoder():
                    engine.encode(features)
                    raise RuntimeError('failed')
            self.assertIsNone(engine._shared_encoder_entry)
            self.assertFalse(engine._shared_encoder_active)

    def test_language_window_matches_native_transcription_without_truncating_long_audio(self):
        engine = object.__new__(SharedEncoderWhisper)
        engine.feature_extractor = NS(nb_max_frames=3000)
        with patch('faster_whisper.WhisperModel.detect_language', return_value=('en', 1, [])) as native:
            for length, expected in [(1, 1), (900, 899), (3000, 2999), (3500, 3500)]:
                features = np.zeros((128, length), dtype=np.float32)
                with engine.reuse_encoder():
                    engine.detect_language(features=features)
                self.assertEqual(native.call_args.kwargs['features'].shape[-1], expected)

    def test_backend_selection(self):
        for language,engine in [('en','parakeet-tdt-0.6b-v2'),('ru','parakeet-tdt-0.6b-v3'),('de','parakeet-tdt-0.6b-v3'),('ja','whisper-large-v3-turbo'),('ar','whisper-large-v3-turbo'),('auto','whisper-large-v3-turbo')]:
            with patch.dict(os.environ,{'CAPRI_ASR_LANGUAGE':language}):
                value=settings();self.assertEqual(value['language'],language);self.assertEqual(value['engine'],engine)
                if engine == 'parakeet-tdt-0.6b-v3':
                    self.assertEqual(value['decodingMethod'], 'greedy_search')
        with patch.dict(os.environ,{'CAPRI_ASR_LANGUAGE':'../../private'}):
            with self.assertRaises(ValueError):settings()

    def test_native_recovery_keeps_the_language_and_model_with_a_conservative_decoder(self):
        for language in ['en', 'ru', 'ja', 'auto', 'auto-europe']:
            with patch.dict(os.environ, {'CAPRI_ASR_LANGUAGE': language, 'CAPRI_ASR_SAFE_STARTUP': '0'}):
                original = settings()
            with patch.dict(os.environ, {'CAPRI_ASR_LANGUAGE': language, 'CAPRI_ASR_SAFE_STARTUP': '1',
                                         'CAPRI_CPU_THREADS': '8'}):
                recovered = settings()
            self.assertEqual(recovered['language'], original['language'])
            self.assertEqual(recovered['engine'], original['engine'])
            self.assertEqual(recovered['folder'], original['folder'])
            self.assertEqual(recovered['vad'], original['vad'])
            self.assertEqual(recovered['cpuThreads'], 1)
            self.assertEqual(recovered['decodingMethod'], 'greedy_search')
            self.assertEqual(recovered['maxActivePaths'], 1)
            with patch.dict(os.environ, {'CAPRI_ASR_LANGUAGE': language, 'CAPRI_ASR_SAFE_STARTUP': '0'}):
                self.assertEqual(settings(), original)

    def test_whisper_keeps_cjk_words_and_exact_wake_offsets(self):
        recognizer=object.__new__(WhisperRecognizer);recognizer.language='ja'
        words=[NS(word='カプリ',start=0.,end=.6),NS(word='こんにちは',start=.7,end=1.5),NS(word='。',start=1.5,end=1.6)]
        seen=[]
        def transcribe(pcm,**kwargs):
            seen.append(kwargs);return iter([NS(no_speech_prob=0,avg_logprob=0,words=words)]),NS(language='ja')
        recognizer.engine=NS(transcribe=transcribe)
        result=recognizer.recognize(np.zeros(32000,dtype=np.float32),addressed=True)
        self.assertEqual(result['text'],'カプリこんにちは。')
        stripped=remove_wake_prefix(result,9600);self.assertEqual(stripped['text'],'こんにちは。');self.assertTrue(stripped['prefixRemoved'])
        self.assertEqual(seen[0]['task'],'transcribe');self.assertFalse(seen[0]['condition_on_previous_text']);self.assertTrue(seen[0]['word_timestamps'])
        recognizer.wake_engine=NS(recognize=lambda pcm,**kwargs:{'text':'HEY CAPRI','boundaries':[]})
        self.assertEqual(recognizer.recognize(np.zeros(32000),wake=True)['text'],'HEY CAPRI');self.assertEqual(len(seen),1)

if __name__=='__main__':unittest.main()
