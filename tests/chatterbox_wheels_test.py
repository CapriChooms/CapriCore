import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from integrations.voice_runtime import chatterbox_wheels


class ChatterboxWheelsTests(unittest.TestCase):
    def test_cuda_profiles_preserve_verified_pins_and_emit_individual_progress(self):
        for name in ('legacy', 'blackwell'):
            with self.subTest(profile=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                shutil.copytree(chatterbox_wheels.ROOT / 'config', root / 'config')
                venv = root / '.runtime/voice-training-venv'
                venv.mkdir(parents=True)
                requirements = venv / ('chatterbox-requirements-' + 'a' * 32 + '.txt')
                overrides = venv / ('chatterbox-overrides-' + 'a' * 32 + '.txt') if name == 'blackwell' else None
                requests = []
                output = io.StringIO()

                def download(url, file, spec, *, fallback_urls, progress, **_):
                    requests.append(url)
                    self.assertEqual(fallback_urls[0], url.replace('download-r2.', 'download.'))
                    self.assertEqual(len(spec['sha256']), 64)
                    progress('download', spec['bytes'] // 2)
                    return file

                with patch.object(chatterbox_wheels, 'installed', return_value=False), patch.dict(
                    os.environ, {'CAPRI_INSTALL_FILE_PROGRESS': '1'}
                ):
                    chatterbox_wheels.prepare(root, name, requirements, overrides, download=download,
                                             emit=lambda value, **_: print(value, file=output))
                self.assertEqual(len(requests), 2)
                events = [json.loads(line) for line in output.getvalue().splitlines() if line.startswith('{')]
                self.assertEqual([line['total'] for line in events],
                                 [size for size in chatterbox_wheels.SIZES[name] for _ in range(2)])
                self.assertEqual(events[-1]['stageFraction'], 1)
                self.assertAlmostEqual(events[0]['received'] / events[0]['total'], 0.5, places=6)
                self.assertTrue(all(line['capriFileTransfer'].endswith('.whl') for line in events))
                for file in [requirements, *([overrides] if overrides else [])]:
                    lock = file.read_text(encoding='utf-8')
                    self.assertIn('torch @ file:', lock)
                    self.assertIn('torchaudio @ file:', lock)
                    self.assertEqual(lock.count('#sha256='), 2)

    def test_matching_installed_pytorch_does_not_need_more_downloads(self):
        with patch.object(chatterbox_wheels, 'installed', return_value=True):
            chatterbox_wheels.prepare(chatterbox_wheels.ROOT, 'blackwell', None,
                                     download=lambda *_a, **_k: self.fail('Requested cached packages'))
