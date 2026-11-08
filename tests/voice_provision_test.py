import hashlib
import io
import json
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from urllib.error import HTTPError

from integrations.model_download import ModelDownloadError
from integrations.voice_training.provision import download_model


class VoiceProvisionTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.folder = self.root / 'model'
        self.folder.mkdir()
        revision = 'a' * 40
        payloads = {'weights.safetensors': b'w' * 300, 'tokenizer.json': b't' * 100}
        self.upstream = {'model': {'revision': revision, 'repository': 'ResembleAI/chatterbox-turbo',
                                  'files': list(payloads)}}
        self.metadata = {'revision': revision, 'files': {
            name: {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
            for name, data in payloads.items()
        }}
        config = self.root / 'config'
        config.mkdir()
        (config / 'voice-upstream.json').write_text(json.dumps(self.upstream), encoding='utf-8')
        (config / 'voice-model-download.json').write_text(json.dumps(self.metadata), encoding='utf-8')

    def test_verified_files_get_cumulative_progress_and_compatible_receipt(self):
        calls = []

        def transfer(url, target, spec, *, timeout, attempts, emit):
            calls.append(target.name)
            self.assertEqual(target.parent, self.folder)
            self.assertEqual(spec, self.metadata['files'][target.name])
            self.assertEqual(url, f'https://huggingface.co/ResembleAI/chatterbox-turbo/resolve/{"a" * 40}/{target.name}')
            self.assertEqual((timeout, attempts), (25, 5))
            for percent in (0, 50, 100):
                emit(f'{target.name}: {percent}% | file progress', flush=True)

        output = io.StringIO()
        with redirect_stdout(output):
            files = download_model({'modelPath': self.folder}, root=self.root, download=transfer)
        self.assertEqual(calls, self.upstream['model']['files'])
        lines = output.getvalue().splitlines()
        overall = [int(line.split('%', 1)[0]) for line in lines if '% overall' in line]
        self.assertEqual(overall, [0, 37, 75, 75, 75, 87, 99, 99, 100])
        receipt = json.loads((self.folder / 'model-receipt.json').read_text(encoding='utf-8'))
        self.assertEqual(receipt, {'upstream': self.upstream, 'files': files})

    def test_failed_file_keeps_receipt_and_omits_signed_redirect(self):
        receipt = self.folder / 'model-receipt.json'
        receipt.write_text('previous receipt', encoding='utf-8')

        def transfer(_url, target, *_args, **_options):
            if target.name == 'tokenizer.json':
                raise HTTPError('https://example.invalid/redirect?credential=test-only', 403, 'Forbidden', {}, None)

        with redirect_stdout(io.StringIO()), self.assertRaises(ModelDownloadError) as failed:
            download_model({'modelPath': self.folder}, root=self.root, download=transfer)
        self.assertIn('tokenizer.json: HTTP 403', str(failed.exception))
        self.assertNotIn('test-only', str(failed.exception))
        self.assertEqual(receipt.read_text(encoding='utf-8'), 'previous receipt')
