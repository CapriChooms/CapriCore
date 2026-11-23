import json
import tempfile
import unittest
from pathlib import Path
from integrations.voice_runtime.catalog import selected_voice


class VoiceCatalogTests(unittest.TestCase):
    def test_defaults_and_explicit_english_multilingual_selection(self):
        parent = Path('.runtime/voice-library-tests')
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as temporary:
            root = Path(temporary)
            (root / 'config').mkdir()
            catalog = {'models': [
                {'id': 'chatterbox-turbo', 'languages': ['en']},
                {'id': 'chatterbox-multilingual-v3', 'languages': ['en', 'ru']},
            ]}
            (root / 'config/tts-catalog.json').write_text(json.dumps(catalog))
            self.assertEqual(selected_voice('en', root)['id'], 'chatterbox-turbo')
            self.assertEqual(selected_voice('ru', root)['id'], 'chatterbox-multilingual-v3')
            folder = root / 'data/speech'
            folder.mkdir(parents=True)
            (folder / 'voice-selections.json').write_text(json.dumps({'schemaVersion': 1, 'languages': {'en': 'chatterbox-multilingual-v3'}}))
            self.assertEqual(selected_voice('en', root)['id'], 'chatterbox-multilingual-v3')
            (folder / 'voice-selections.json').write_text(json.dumps({'schemaVersion': 1, 'languages': {'ru': 'chatterbox-turbo'}}))
            with self.assertRaisesRegex(ValueError, 'does not support'):
                selected_voice('ru', root)


if __name__ == '__main__':
    unittest.main()
