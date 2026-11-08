"""One reviewed local training job with a bounded, non-sensitive progress protocol."""
import argparse
import contextlib
import io
import json
import os
import re
import shutil
import sys
import stat
from pathlib import Path

from .dataset import ROOT, read_config, write_json


def no_links(folder, *, recursive=False):
    for entry in [folder, *folder.parents]:
        if not entry.exists() and not entry.is_symlink():
            continue
        info = entry.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('Voice training paths cannot follow filesystem links')
    if recursive and folder.is_dir():
        for base, directories, files in os.walk(folder, followlinks=False):
            for name in directories + files:
                no_links(Path(base) / name)


def emit(stage, **values):
    print(json.dumps({'stage': stage, **values}), file=sys.__stdout__, flush=True)


class TrainingProgress(io.TextIOBase):
    def __init__(self):
        self.pending = ''

    def write(self, text):
        self.pending = (self.pending + text)[-8192:]
        while '\n' in self.pending:
            line, self.pending = self.pending.split('\n', 1)
            try:
                value = json.loads(line)
                epoch = value.get('epoch')
                if type(epoch) is int and 0 <= epoch <= 50:
                    emit('training', epoch=epoch)
            except (ValueError, AttributeError):
                pass
        return len(text)

    def flush(self):
        pass


def run(job_id):
    if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', job_id):
        raise ValueError('Invalid job identifier')
    config = read_config()
    if config.get('allowProvisionalTranscripts'):
        raise ValueError('One-click training requires reviewed transcripts')
    for folder in [ROOT / config['datasetDir'], ROOT / config['modelDir']]:
        no_links(folder, recursive=True)
    output = ROOT / 'data/speech/training-jobs' / job_id
    no_links(output)
    output.mkdir(parents=True, exist_ok=False)
    from .dataset import prepare
    from .backend import build_cache
    from .provision import verify_model
    from .trainer import train
    from .audition import export_voice, make_preview
    with contextlib.redirect_stdout(TrainingProgress()):
        emit('checking')
        verify_model(config)
        emit('preparing')
        report = prepare(config)
        if not report.get('ready') or report.get('provisionalTranscripts'):
            raise ValueError('Reviewed recordings and separate validation/test scenes are required')
        emit('caching')
        build_cache(config)
        emit('training', epochs=config['training']['epochs'])
        trained = train(config)
        best = json.loads((trained / 'best.json').read_text(encoding='utf-8'))
        checkpoint = best.get('checkpoint')
        if not isinstance(checkpoint, str) or not re.fullmatch(r'epoch-\d{3}', checkpoint):
            emit('no-improvement')
            return
        adapter = trained / checkpoint
        emit('previewing')
        preview = make_preview(config, 'Hey choom. I am here with you. Let us make something good today.', adapter=adapter)
        shutil.copy2(preview, output / 'preview.wav')
        exported = export_voice(config, adapter, 'capri-trained-' + job_id)
        write_json(output / 'candidate.json', {
            'schemaVersion': 1, 'jobId': job_id, 'modelId': 'chatterbox-turbo',
            'language': 'en', 'profileDir': exported.relative_to(ROOT).as_posix(),
            'preview': 'preview.wav', 'quality': 'requires-listening',
        })
        emit('review')


def main():
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    parser = argparse.ArgumentParser()
    parser.add_argument('--job', required=True)
    args = parser.parse_args()
    try:
        run(args.job)
    except Exception:
        # Full traces may contain transcripts, paths or recordings. The desktop
        # receives the stage and a fixed message instead.
        emit('failed')
        raise SystemExit(1)


if __name__ == '__main__':
    main()
