"""Provision pinned Parakeet and Silero weights; normal startup is offline."""

import sys as _capri_sys
from pathlib import Path as _CapriPath
_capri_sys.path.insert(0, str(_CapriPath(__file__).resolve().parents[2]))
import json
import argparse
from pathlib import Path

from integrations.model_download import download_verified

ROOT = Path(__file__).resolve().parents[2]
config = json.loads((ROOT / 'config/companion-asr.json').read_text(encoding='utf-8'))
upstream = json.loads((ROOT / 'config/asr-model-upstream.json').read_text(encoding='utf-8'))
vad = json.loads((ROOT / 'config/asr-vad-upstream.json').read_text(encoding='utf-8'))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--vad-only', action='store_true', help='Provision only the pinned Silero detector for native VAD verification.')
args = parser.parse_args()
if not args.vad_only:
    folder = (ROOT / config['modelDir']).resolve()
    if not folder.is_relative_to(ROOT / 'data/speech'):
        raise ValueError('Model path outside project data')
    folder.mkdir(parents=True, exist_ok=True)
    for item in upstream['files'].values():
        target = folder / item['file']
        if target.parent != folder:
            raise ValueError('Invalid model filename')
        url = f"https://huggingface.co/{upstream['model']}/resolve/{upstream['revision']}/{item['file']}"
        download_verified(url, target, item)
    (folder / 'ATTRIBUTION.txt').write_text(
        'Parakeet TDT 0.6B v2 by NVIDIA. Model: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2\n'
        'Model license: CC BY 4.0, https://creativecommons.org/licenses/by/4.0/\n'
        'ONNX INT8 conversion: ' + upstream['model'] + ' @ ' + upstream['revision'] + '\n', encoding='utf-8')
folder = (ROOT / config['vad']['modelDir']).resolve()
if not folder.is_relative_to(ROOT / 'data/speech'):
    raise ValueError('VAD model path outside project data')
folder.mkdir(parents=True, exist_ok=True)
for item in vad['files'].values():
    target = folder / item['file']
    if target.parent != folder:
        raise ValueError('Invalid VAD model filename')
    download_verified(item['url'], target, item)
(folder / 'ATTRIBUTION.txt').write_text('Silero VAD v5.1.2, Silero Team, MIT license.\n' + vad['source'] + '\n', encoding='utf-8')
(folder / 'LICENSE.txt').write_text('''MIT License

Copyright (c) 2020-present Silero Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
''', encoding='utf-8')
print('Silero VAD ready.' if args.vad_only else 'CPU Parakeet and Silero ready. No draft recognizer is used.', flush=True)
