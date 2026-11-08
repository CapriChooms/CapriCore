"""Reviewed, pinned Qwen speech files. Model repository code is never executed."""
import hashlib
import json
import re
from pathlib import Path
from integrations.model_download import download_verified, _regular_path

ROOT = Path(__file__).resolve().parents[2]


def specification(root=ROOT):
    spec = json.loads((root / 'config/qwen-tts-upstream.json').read_text(encoding='utf-8-sig'))
    if (spec.get('schemaVersion') != 1 or spec.get('model') != 'Qwen/Qwen3-TTS-12Hz-0.6B-Base'
            or not re.fullmatch(r'[a-f0-9]{40}', spec.get('revision', ''))
            or spec.get('directory') != 'data/speech/qwen3-tts-0.6b-base'):
        raise ValueError('Invalid pinned Qwen speech specification')
    for item in spec['files']:
        if (not re.fullmatch(r'(?:speech_tokenizer/)?[a-zA-Z0-9_.-]+\.(?:json|txt|safetensors)', item['file'])
                or not re.fullmatch(r'[a-f0-9]{64}', item['sha256'])
                or type(item['bytes']) is not int or item['bytes'] <= 0):
            raise ValueError('Invalid pinned Qwen speech file')
    return spec


def verified_qwen(root=ROOT):
    spec = specification(root)
    folder = root / spec['directory']
    for item in spec['files']:
        file = folder / item['file']
        _regular_path(file)
        if not file.is_file() or file.stat().st_size != item['bytes']:
            raise ValueError('Install the selected Qwen speech model first')
        with file.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != item['sha256']:
                raise ValueError('Qwen speech checksum mismatch. Reinstall the voice model.')
    return folder


def provision(root=ROOT, download=download_verified, emit=print):
    spec = specification(root)
    total = sum(item['bytes'] for item in spec['files'])
    done = 0
    for item in spec['files']:
        # Relay only numeric progress. Download errors never include signed URLs.
        def progress(message, **_):
            target = root / spec['directory'] / item['file']
            partial = target.with_suffix(target.suffix + '.partial')
            received = min(partial.stat().st_size, item['bytes']) if partial.is_file() else 0
            emit(json.dumps(dict(stage='models', progress=round((done + received) * 100 / total, 1))), flush=True)
        url = f"https://huggingface.co/{spec['model']}/resolve/{spec['revision']}/{item['file']}"
        download(url, root / spec['directory'] / item['file'], item, emit=progress)
        done += item['bytes']
        emit(json.dumps(dict(stage='models', progress=round(done * 100 / total, 1))), flush=True)
    verified_qwen(root)
    emit(json.dumps(dict(stage='ready', progress=100)), flush=True)


if __name__ == '__main__':
    provision()
