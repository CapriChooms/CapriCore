import unittest
from unittest.mock import patch
from integrations.voice_runtime.startup_failure import startup_failure, memory_status
from integrations.asr_runtime.protocol import rejection_code
from integrations.voice_runtime.failure import inference_failure

class StartupFailureTests(unittest.TestCase):
    def test_runtime_diagnostics_contain_only_bounded_codes_not_exception_or_speech_text(self):
        class Limit(RuntimeError): code='CAPRI_VOICE_SPEECH_LIMIT'
        for error,code in [(Limit('private speech and token'), 'CAPRI_VOICE_SPEECH_LIMIT'),(RuntimeError('private speech and token'),'CAPRI_VOICE_INFERENCE_FAILED')]:
            result=inference_failure(error)
            self.assertEqual(result['code'],code)
            self.assertNotIn('private',str(result))
            self.assertNotIn('token',str(result))
            self.assertGreater(result['at'],0)
    def test_commit_limit_classification_does_not_export_exception_text(self):
        with patch('integrations.voice_runtime.startup_failure.memory_status', return_value={'availableCommit': 32}):
            result = startup_failure(OSError('private path: os error 1455'))
        self.assertEqual(result['code'], 'CAPRI_VOICE_COMMIT_LIMIT')
        self.assertEqual(result['memory']['availableCommit'], 32)
        self.assertNotIn('private', str(result))
        self.assertEqual(startup_failure(ValueError('other'))['code'], 'CAPRI_VOICE_STARTUP_FAILED')
        self.assertEqual(startup_failure(FileNotFoundError('C:/1455/missing.wav'))['code'], 'CAPRI_VOICE_STARTUP_FAILED')
    def test_asr_rejections_are_bounded_codes_and_never_echo_private_content(self):
        self.assertEqual(rejection_code(ValueError('Recognition queue is full')), 'ASR_QUEUE_FULL')
        self.assertEqual(rejection_code(ValueError('private spoken words')), 'ASR_PACKET_REJECTED')
    def test_native_memory_status_has_consistent_commit_values(self):
        value = memory_status()
        if value is not None:
            self.assertGreater(value['commitLimit'], 0)
            self.assertLessEqual(value['availableCommit'], value['commitLimit'])
