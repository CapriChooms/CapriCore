"""Install pinned multilingual speech models; no runtime network access is needed."""

import sys as _capri_sys
from pathlib import Path as _CapriPath
_capri_sys.path.insert(0, str(_CapriPath(__file__).resolve().parents[2]))
import argparse
import hashlib
import json
import os
import shutil
import zipfile
from pathlib import Path

from integrations.model_download import download_verified
from integrations.multilingual import LANGUAGES

ROOT = Path(__file__).resolve().parents[2]


def valid(path, item):
    if not path.is_file() or path.stat().st_size != item['bytes']:
        return False
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest() == item['sha256']


def provision(component):
    spec = json.loads((ROOT / 'config/multilingual-runtime.json').read_text(encoding='utf-8'))[component]
    folder = (ROOT / spec['directory']).resolve()
    if not folder.is_relative_to(ROOT / 'data/speech'):
        raise ValueError('Model directory must stay inside data/speech')
    folder.mkdir(parents=True, exist_ok=True)
    for item in spec['files']:
        target = (folder / item['file']).resolve()
        if target.parent != folder:
            raise ValueError('Invalid model filename')
        if valid(target, item):
            continue
        cached = ROOT / 'data/speech/candidates/chatterbox-multilingual-v2' / item['file']
        if component == 'tts' and valid(cached, item):
            if target.exists():
                target.unlink()
            os.link(cached, target)
            continue
        if shutil.disk_usage(folder).free < item['bytes'] + 1024**3:
            raise RuntimeError('Not enough disk space for speech models')
        url = f"https://huggingface.co/{spec['model']}/resolve/{spec['revision']}/{item['file']}"
        download_verified(url, target, item)
    (folder / 'ATTRIBUTION.txt').write_text(
        f"{spec['model']}\n{spec['source']}\nRevision: {spec['revision']}\nLicense: {spec['license']}\n",
        encoding='utf-8')
    print(component + ' models verified.', flush=True)


def provision_chinese():
    spec = json.loads((ROOT / 'config/multilingual-runtime.json').read_text(encoding='utf-8'))['chinese']
    folder = (ROOT / spec['directory']).resolve()
    if not folder.is_relative_to(ROOT / 'data/speech'):
        raise ValueError('Invalid segmenter directory')
    if all(valid(folder / item['file'], item) for item in spec['files']):
        return
    archive = folder.parent / 'spacy_ontonotes.zip'
    folder.mkdir(parents=True, exist_ok=True)
    item = dict(bytes=spec['archiveBytes'], sha256=spec['archiveSha256'])
    if not valid(archive, item):
        download_verified(spec['url'], archive, item, fallback_urls=spec.get('fallbackUrls', ()))
    with zipfile.ZipFile(archive) as source:
        for item in spec['files']:
            target = (folder / item['file']).resolve()
            if target.parent != folder:
                raise ValueError('Invalid segmenter filename')
            target.write_bytes(source.read(item['file']))
            if not valid(target, item):
                raise ValueError('Segmenter checksum mismatch')
    print('Chinese segmenter verified.', flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--component', choices=['tts', 'whisper', 'chinese', 'all'], default='all')
    parser.add_argument('--language', choices=['all', *LANGUAGES], default='all',
                        help='Install Chinese-only segmentation when Chinese or all languages are selected.')
    args = parser.parse_args(argv)
    for part in ('tts', 'whisper'):
        if args.component in (part, 'all'):
            provision(part)
    if args.component == 'chinese' or (args.component in ('tts', 'all') and args.language in ('all', 'zh')):
        provision_chinese()


if __name__ == '__main__':
    main()
