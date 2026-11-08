import csv
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
import soundfile as sf
from integrations.voice_training import dataset
from integrations.voice_training import import_dataset as importer


class VoiceImportTests(unittest.TestCase):
    def setUp(self):
        parent = Path('.runtime/voice-library-tests').resolve()
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.root = Path(self.temp.name)
        self.source = self.root / 'input'
        (self.source / 'raw').mkdir(parents=True)
        (self.root / 'config').mkdir()
        config = json.loads((dataset.ROOT / 'config/voice-training.json').read_text(encoding='utf-8'))
        (self.root / 'config/voice-training.json').write_text(json.dumps(config), encoding='utf-8')
        self.rows = []
        for index, split in enumerate(['train', 'validation', 'test', 'reference']):
            seconds = 6 if split == 'reference' else 2
            wave = .1*np.sin(2*np.pi*(220+index*70)*np.arange(seconds*24000)/24000)
            sf.write(self.source / 'raw' / f'clip{index}.wav', wave, 24000)
            self.rows.append(dict(id=f'clip{index}',file=f'raw/clip{index}.wav',
                text=f'Reviewed synthetic sample number {index}.',emotion='neutral',scene=f'scene{index}',
                split=split,approved='yes'))
        self.metadata()

    def tearDown(self):
        self.temp.cleanup()

    def metadata(self):
        with (self.source / 'metadata.csv').open('w',encoding='utf-8',newline='') as stream:
            writer=csv.DictWriter(stream,fieldnames=dataset.FIELDS)
            writer.writeheader()
            writer.writerows(self.rows)

    def run_import(self):
        with patch.object(importer,'ROOT',self.root),patch.object(dataset,'ROOT',self.root):
            importer.import_dataset(str(self.source),'00000000-0000-0000-0000-000000000001')

    def test_import_copies_only_reviewed_audio_and_receipt_without_source_path(self):
        (self.source / 'irrelevant.txt').write_text('Do not import unrelated content')
        self.run_import()
        folder=self.root/'data/voices/capri/en/imports/00000000-0000-0000-0000-000000000001'
        receipt=(folder/'import-receipt.json').read_text(encoding='utf-8')
        self.assertEqual(json.loads(receipt)['clips'],4)
        self.assertNotIn(str(self.source),receipt)
        self.assertFalse((folder/'irrelevant.txt').exists())
        self.assertTrue(json.loads((folder/'quality-report.json').read_text())['ready'])
        self.assertTrue((self.source/'raw/clip0.wav').exists())

    def test_unreviewed_and_path_escape_are_rejected_before_output(self):
        for edit in [dict(approved='asr-consensus'),dict(file='raw/../../private.wav')]:
            previous=self.rows[0].copy()
            self.rows[0].update(edit)
            self.metadata()
            with self.assertRaises(ValueError):
                self.run_import()
            self.assertFalse((self.root/'data').exists())
            self.rows[0]=previous


if __name__=='__main__':
    unittest.main()
