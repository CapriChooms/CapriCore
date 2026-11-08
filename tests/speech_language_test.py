import unittest
from integrations.voice_runtime.text import validate_speech_language


class SpeechLanguageTest(unittest.TestCase):
    def test_english_only_guard_and_multilingual_route(self):
        for text in ['Привет, как дела?', '今日は元気ですか？', 'مرحبا كيف حالك']:
            with self.subTest(text=text):
                with self.assertRaisesRegex(ValueError, 'English reply text'):
                    validate_speech_language(text, 'en')
                validate_speech_language(text, 'ru')
        validate_speech_language('Hey choom, café at midnight?', 'en')
        validate_speech_language('Meet me by 東京 tonight, choom.', 'en')
