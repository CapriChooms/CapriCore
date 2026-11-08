import unittest
from integrations.speech_quality import word_error_rate,quality_status

class SpeechQualityTests(unittest.TestCase):
    def test_unicode_words_and_punctuation(self):
        self.assertEqual(word_error_rate('Привет, Капри!','привет капри'),0)
        self.assertEqual(word_error_rate('quiet evening together','quiet morning together'),1/3)
        self.assertEqual(word_error_rate('hello','hello extra words'),2)
        self.assertEqual(word_error_rate('hello',''),1)
        with self.assertRaises(ValueError):word_error_rate('','hello')
        with self.assertRaises(ValueError):word_error_rate('hello '*513,'hello')
    def test_synthetic_success_cannot_promote_a_voice(self):
        self.assertEqual(quality_status({'wer':0,'realTimeFactor':.1}),'pending-quality-review')
        report={'humanReview':{key:'passed' for key in ('naturalness','speakerSimilarity','pronunciation','emotion','intelligibility')},'samples':[{'peak':.8}]}
        self.assertEqual(quality_status(report),'pending-quality-review')
        report.update(spontaneousSpeechValidated=True,hardwareProfileValidated=True)
        self.assertEqual(quality_status(report),'review-complete')
        report['samples'][0]['reachedTokenCap']=True
        self.assertEqual(quality_status(report),'failed')

if __name__=='__main__':unittest.main()
