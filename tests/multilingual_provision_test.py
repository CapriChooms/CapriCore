"""Only Chinese speech needs the optional Chinese segmentation download."""
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('provision_multilingual', ROOT / 'tools/setup/provision-multilingual.py')
provisioner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provisioner)


class LanguageProvisionTests(unittest.TestCase):
    def test_selected_language_does_not_depend_on_unrelated_chinese_download(self):
        for language in ('ru', 'de', 'ja', 'en'):
            with patch.object(provisioner, 'provision') as models, patch.object(provisioner, 'provision_chinese') as chinese:
                provisioner.main(['--component', 'tts', '--language', language])
                models.assert_called_once_with('tts')
                chinese.assert_not_called()

    def test_chinese_and_full_install_keep_optional_segmentation(self):
        for args in (['--component', 'tts', '--language', 'zh'], ['--component', 'tts'], ['--component', 'chinese']):
            with patch.object(provisioner, 'provision'), patch.object(provisioner, 'provision_chinese') as chinese:
                provisioner.main(args)
                chinese.assert_called_once_with()

    def test_recognition_only_does_not_install_voice_extras(self):
        with patch.object(provisioner, 'provision') as models, patch.object(provisioner, 'provision_chinese') as chinese:
            provisioner.main(['--component', 'whisper'])
            models.assert_called_once_with('whisper')
            chinese.assert_not_called()


if __name__ == '__main__':
    unittest.main()
