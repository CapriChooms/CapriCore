"""Health reporting must work with both older and newer CUDA graph objects."""
import unittest
from types import SimpleNamespace
from integrations.voice_runtime.multilingual import VoicePool


class Health(unittest.TestCase):
    def test_graph_without_optional_batch_metric_is_ready_for_json_health(self):
        pool = VoicePool.__new__(VoicePool)
        pool.voice = SimpleNamespace(graph=SimpleNamespace(validation_max_error=0.01))
        pool.kind, pool.language = 'turbo', 'en'
        health = pool.health()
        self.assertTrue(health['cudaGraph'])
        self.assertIsNone(health['graphBatchSteps'])
        self.assertEqual(health['graphMaxLogitError'], 0.01)
        pool.voice = None
        self.assertFalse(pool.health()['cudaGraph'])

    def test_reference_release_receipt_is_reported_without_claiming_process_ram_savings(self):
        pool = VoicePool.__new__(VoicePool)
        pool.kind, pool.language = 'turbo', 'en'
        pool.voice = SimpleNamespace(reference_memory={
            'referenceEncodersReleased': True,
            'releasedEncoderBytes': 512 * 1024**2,
        })
        health = pool.health()
        self.assertTrue(health['referenceEncodersReleased'])
        self.assertEqual(health['releasedReferenceEncoderMiB'], 512)
        self.assertNotIn('ramSavedMiB', health)


if __name__ == '__main__':
    unittest.main()
