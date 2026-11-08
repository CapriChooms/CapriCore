"""Import only explicitly reviewed voice recordings; never execute imported code."""
import argparse
import contextlib
import csv
import io
import json
import re
import shutil
import sys
from pathlib import Path, PurePosixPath
import soundfile as sf
from .dataset import ROOT, FIELDS, read_config, prepare, write_json
from .job import no_links


def import_dataset(source, import_id):
    if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', import_id):
        raise ValueError('Invalid import identifier')
    source = Path(source)
    if not source.is_absolute() or not source.is_dir():
        raise ValueError('Choose a local dataset directory')
    no_links(source)
    metadata = source / 'metadata.csv'
    no_links(metadata)
    if not metadata.is_file() or not 1 <= metadata.stat().st_size <= 1024 * 1024:
        raise ValueError('Expected a bounded metadata.csv file')
    with metadata.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames != FIELDS:
            raise ValueError('Unexpected metadata columns')
        rows = list(reader)
    if not 4 <= len(rows) <= 200:
        raise ValueError('Use 4 to 200 reviewed clips from distinct scenes')
    copied, seconds, bytes_total = [], 0, 0
    for row in rows:
        relative = PurePosixPath(row['file'].replace('\\', '/'))
        if (relative.is_absolute() or len(relative.parts) < 2 or relative.parts[0] != 'raw'
                or '..' in relative.parts or ':' in str(relative)
                or relative.suffix.lower() not in {'.wav', '.flac'}
                or row['approved'].strip().lower() not in {'yes', 'true', '1'}
                or not row['scene'].strip() or not 1 <= len(row['text'].strip()) <= 2000
                or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', row['id'])):
            raise ValueError('Each clip needs reviewed speech, transcript and scene, with audio in raw/')
        file = source.joinpath(*relative.parts)
        no_links(file)
        if not file.is_file() or not 0 < file.stat().st_size <= 64 * 1024 * 1024:
            raise ValueError('Invalid or oversized audio recording')
        bytes_total += file.stat().st_size
        if bytes_total > 512 * 1024 * 1024:
            raise ValueError('The voice dataset exceeds its size budget')
        info = sf.info(file)
        if info.samplerate < 16000 or not 1 <= info.channels <= 2 or not 0 < info.duration <= 20:
            raise ValueError('Use clean lossless speech clips at 16 kHz or higher')
        seconds += info.duration
        if seconds > 300:
            raise ValueError('The voice dataset exceeds five minutes')
        copied.append((file, relative))
    destination = ROOT / 'data/voices/capri/en/imports' / import_id
    no_links(destination)
    destination.mkdir(parents=True, exist_ok=False)
    for file, relative in copied:
        target = destination.joinpath(*relative.parts)
        no_links(file)
        no_links(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, target)
    with (destination / 'metadata.csv').open('w', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    config = read_config()
    config.update(datasetDir=destination.relative_to(ROOT).as_posix(), datasetPath=destination,
                  allowProvisionalTranscripts=False)
    with contextlib.redirect_stdout(io.StringIO()):
        report = prepare(config)
    if not report.get('ready') or report.get('provisionalTranscripts'):
        raise ValueError('The imported dataset did not pass quality and split checks')
    write_json(destination / 'import-receipt.json', dict(schemaVersion=1, importId=import_id,
        clips=len(rows), seconds=round(seconds, 2), bytes=bytes_total, reviewed=True))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--id', required=True)
    args = parser.parse_args()
    try:
        request = json.loads(sys.stdin.read(32768))
        import_dataset(request['source'], args.id)
        print('{"ready":true}', flush=True)
    except Exception:
        # Transcripts, audio names and the imported directory stay on this PC.
        print('{"ready":false}', flush=True)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
