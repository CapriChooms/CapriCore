"""Native vocabulary paths must work in Unicode Windows installation folders."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from integrations.asr_runtime.vocabulary import bpe_vocabulary, _native_vocabulary_path


class VocabularyPathTests(unittest.TestCase):
    def test_unicode_install_uses_an_ascii_relative_path_without_moving_data(self):
        with tempfile.TemporaryDirectory(prefix='capri-') as parent:
            root = Path(parent) / 'капри тест'
            root.mkdir()
            tokens = root / 'tokens.txt'
            tokens.write_text('▁Capri 0\n▁привет 1\n', encoding='utf-8')
            with patch('sys.platform', 'win32'), patch('integrations.asr_runtime.vocabulary.Path.cwd', return_value=root):
                result = bpe_vocabulary(root, tokens)
                self.assertTrue(result.isascii())
                self.assertFalse(Path(result).is_absolute())
                file = root / result
                self.assertEqual(file.read_text(encoding='utf-8'), '▁Capri\t-1.0\n▁привет\t-1.0\n')
                self.assertEqual(bpe_vocabulary(root, tokens), result)
                self.assertEqual(len(list(file.parent.iterdir())), 1)

    def test_ascii_native_path_and_other_platforms_keep_absolute_paths(self):
        with patch('sys.platform', 'win32'):
            self.assertEqual(_native_vocabulary_path(Path('C:/Capri/cache.vocab')), str(Path('C:/Capri/cache.vocab')))
        with patch('sys.platform', 'linux'):
            path = Path('/tmp/Капри/cache.vocab')
            self.assertEqual(_native_vocabulary_path(path), str(path))

    def test_incorrect_working_directory_fails_before_calling_native_library(self):
        with tempfile.TemporaryDirectory() as parent:
            root = Path(parent)
            with patch('sys.platform', 'win32'), patch('integrations.asr_runtime.vocabulary.Path.cwd', return_value=root):
                with self.assertRaisesRegex(ValueError, 'installation directory'):
                    _native_vocabulary_path(root / 'Капри' / 'cache.vocab')


if __name__ == '__main__':
    unittest.main()
