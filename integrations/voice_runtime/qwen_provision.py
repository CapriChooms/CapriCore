"""Reviewed, pinned Qwen speech files. Model repository code is never executed."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
from integrations.model_download import download_verified, _regular_path, emit_installer_transfer

ROOT = Path(__file__).resolve().parents[2]
RUSSIAN_QWEN_ID = 'qwen3-tts-1.7b-capri-ru'


def specification(root=ROOT, russian=False):
    name = 'qwen-ru-voice.json' if russian else 'qwen-tts-upstream.json'
    spec = json.loads((root / 'config' / name).read_text(encoding='utf-8-sig'))
    if spec.get('schemaVersion') != 1:
        raise ValueError('Invalid pinned Qwen speech specification')
    model = 'siriusfreak/qwen3-tts-12hz-1.7b-ru-stress-cf' if russian else 'Qwen/Qwen3-TTS-12Hz-0.6B-Base'
    directory = RUSSIAN_QWEN_ID if russian else 'qwen3-tts-0.6b-base'
    validate_spec(spec, f'data/speech/{directory}', model)
    if russian:
        validate_spec(spec['accent'], 'data/speech/ruaccent-turbo31', 'ruaccent/accentuator')
        validate_spec(spec['pack'], 'data/speech/bundled-voice/russian')
    return spec


def validate_spec(spec, directory, model=None):
    if spec.get('directory') != directory or (
        model is not None and (spec.get('model') != model
                               or not re.fullmatch(r'[a-f0-9]{40}', spec.get('revision', '')))
    ):
        raise ValueError('Invalid pinned Qwen speech specification')
    files = spec['files']
    if not files or len({item['file'] for item in files}) != len(files):
        raise ValueError('Invalid pinned Qwen speech file list')
    for item in files:
        if (not re.fullmatch(r'(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(?:json|txt|safetensors|onnx|json\.gz)', item['file'])
                or not re.fullmatch(r'[a-f0-9]{64}', item['sha256'])
                or type(item['bytes']) is not int or item['bytes'] <= 0):
            raise ValueError('Invalid pinned Qwen speech file')


def verify_files(root, spec):
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


def verified_qwen(root=ROOT, russian=False):
    return verify_files(root, specification(root, russian))


def provision(root=ROOT, download=download_verified, emit=print, russian=False):
    spec = specification(root, russian)
    groups = (spec, spec['accent']) if russian else (spec,)
    if russian:
        verify_files(root, spec['pack'])
    files = [(group, item) for group in groups for item in group['files']]
    total = sum(item['bytes'] for _, item in files)
    done = 0
    for group, item in files:
        target = root / group['directory'] / item['file']
        # Relay only numeric progress. Download errors never include signed URLs.
        def progress(message, **_):
            partial = target.with_suffix(target.suffix + '.partial')
            received = min(partial.stat().st_size, item['bytes']) if partial.is_file() else 0
            # A completed file can be atomically moved before its last log line.
            if message.startswith('Verified '):
                received = item['bytes']
            fraction = (done + received) / total
            emit(json.dumps(dict(stage='models', progress=round(fraction * 100, 1))), flush=True)
        url = f"https://huggingface.co/{group['model']}/resolve/{group['revision']}/{item['file']}"
        def report(stage, received):
            if stage == 'download':
                emit_installer_transfer(target.name, received, item['bytes'], (done + received) / total, emit=emit)

        transfer_options = {'progress': report} if os.environ.get('CAPRI_INSTALL_FILE_PROGRESS') else {}
        download(url, target, item, emit=progress, **transfer_options)
        report('download', item['bytes'])
        done += item['bytes']
        emit(json.dumps(dict(stage='models', progress=round(done * 100 / total, 1))), flush=True)
    emit(json.dumps(dict(stage='ready', progress=100)), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--russian', action='store_true')
    provision(russian=parser.parse_args().russian)
