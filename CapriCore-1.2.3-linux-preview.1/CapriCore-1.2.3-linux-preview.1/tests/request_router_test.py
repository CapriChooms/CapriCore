import unittest

from integrations.request_router.model import guard, Router


class RoutingGuardTests(unittest.TestCase):
    def test_mixed_requests_and_contextual_followups_never_reach_the_fast_encoder(self):
        router = Router.__new__(Router)
        class NoEncoder:
            def encode(self, texts):
                raise AssertionError('Protected request must abstain before encoding')
        router.encoder = NoEncoder()
        for text in ('Tell me something cheerful and save it in my notes.',
                     'GOOD NIGHT AND PAUSE THE MUSIC', 'Which one is playing?',
                     'The other one, please.', 'Привет Капри', 'x' * 401,
                     'Hey, open https://example.com', 'Compute 17 / 40.'):
            self.assertEqual(router.classify(text)['mode'], 'normal')
        self.assertEqual(router.classify('Yes, please.', ['Turn the music down.'])['mode'], 'normal')

    def test_plain_social_speech_can_reach_the_classifier(self):
        for text in ('Hey Capri, how are you?', 'I missed you.', "I'm feeling tired.", 'HELLO, HOW ARE YOU?'):
            self.assertIsNone(guard(text))


if __name__ == '__main__':
    unittest.main()
