"""Explicit pinned download for the optional CPU classifier. Startup is offline."""

import sys as _capri_sys
from pathlib import Path as _CapriPath
_capri_sys.path.insert(0, str(_CapriPath(__file__).resolve().parents[2]))
import hashlib
import json
from pathlib import Path

from integrations.model_download import download_verified

ROOT = Path(__file__).resolve().parents[2]
config = json.loads((ROOT / 'config/request-router.json').read_text(encoding='utf-8'))
upstream = json.loads((ROOT / 'config/request-router-upstream.json').read_text(encoding='utf-8'))
folder = (ROOT / config['modelDir']).resolve()
if not folder.is_relative_to(ROOT / 'data/models/request-router'):
    raise ValueError('Router model must stay inside its own model directory')


def valid(file, item):
    if not file.is_file() or file.stat().st_size != item['bytes']:
        return False
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest() == item['sha256']


for item in upstream['files'].values():
    target = (folder / item['file']).resolve()
    if not target.is_relative_to(folder):
        raise ValueError('Invalid classifier filename')
    target.parent.mkdir(parents=True, exist_ok=True)
    if valid(target, item):
        continue
    url = f"https://huggingface.co/{upstream['model']}/resolve/{upstream['revision']}/{item['file']}"
    download_verified(url, target, item)
(folder / 'ATTRIBUTION.txt').write_text(
    'all-MiniLM-L6-v2 by Sentence Transformers. Apache-2.0.\n'
    'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2\n'
    'Pinned revision: ' + upstream['revision'] + '\n', encoding='utf-8')
print('Verified local CPU request encoder ready.')
