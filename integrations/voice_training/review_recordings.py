"""Draft an English voice dataset from separate local recordings."""

import hashlib
import json
import sys
from collections import Counter
from itertools import islice
from pathlib import Path

from .job import no_links

MAX_BYTES = 64 * 1024 * 1024
MAX_SAMPLES = 18 * 16000


def files_in(folder):
    no_links(folder)
    for entry in folder.iterdir():
        if entry.suffix.lower() in {'.wav', '.flac'}:
            no_links(entry)
            if entry.is_file():
                yield entry
        elif entry.is_dir():
            no_links(entry)
            for clip in entry.iterdir():
                if clip.suffix.lower() in {'.wav', '.flac'}:
                    no_links(clip)
                    if clip.is_file():
                        yield clip


def read_clip(file, recognizer=None):
    if recognizer is None:
        import soundfile as sf

        info = sf.info(file)
        return info.duration, info.samplerate, info.channels, ''

    import av
    import numpy as np

    with av.open(str(file), format=file.suffix.lower()[1:]) as audio:
        stream = audio.streams.audio[0]
        rate, channels = stream.codec_context.sample_rate, stream.codec_context.channels
        resampler = av.AudioResampler(format='fltp', layout='mono', rate=16000)
        samples, chunks = 0, []
        for frame in audio.decode(stream):
            for chunk in resampler.resample(frame):
                samples += chunk.samples
                if samples > MAX_SAMPLES:
                    raise ValueError('Recording too long')
                chunks.append(chunk.to_ndarray().reshape(-1))
        for chunk in resampler.resample(None):
            samples += chunk.samples
            if samples > MAX_SAMPLES:
                raise ValueError('Recording too long')
            chunks.append(chunk.to_ndarray().reshape(-1))
    duration = samples / 16000
    text = recognizer.transcribe(np.concatenate(chunks)) if .8 <= duration <= 18 else ''
    return duration, rate, channels, text[:2000]


def draft(source, read=read_clip):
    source = Path(source)
    if not source.is_absolute() or not source.is_dir():
        raise ValueError('Choose a recordings folder')
    no_links(source)
    raw = source / 'raw'
    no_links(raw)
    folder = raw if raw.is_dir() else source
    rows, seconds, bytes_total = [], 0, 0
    for file in sorted(islice(files_in(folder), 201), key=lambda item: str(item).casefold()):
        if len(rows) == 200:
            raise ValueError('Too many clips')
        size = file.stat().st_size
        bytes_total += size
        if not 0 < size <= MAX_BYTES or bytes_total > 8 * MAX_BYTES:
            raise ValueError('Recordings exceed size limit')
        with file.open('rb') as stream:
            fingerprint = hashlib.file_digest(stream, 'sha256').hexdigest()
        duration, rate, channels, text = read(file)
        seconds += duration
        if not .8 <= duration <= 18 or rate < 16000 or channels not in (1, 2) or seconds > 300:
            raise ValueError('Recordings exceed clip limits')
        relative = file.relative_to(folder)
        clip_id = f'clip-{len(rows) + 1:03d}'
        scene = f'group:{relative.parts[0]}' if len(relative.parts) > 1 else clip_id
        rows.append(dict(id=clip_id, file=f'raw/{relative.as_posix()}', text=text,
                         emotion='neutral', scene=scene, split='', seconds=duration,
                         sha256=fingerprint))
    if len(rows) < 4:
        raise ValueError('Use at least four recordings')
    scene_counts = Counter(row['scene'] for row in rows)
    references = [row for row in rows if 6 <= row['seconds'] <= 15 and
                  len(scene_counts) - (scene_counts[row['scene']] == 1) >= 3]
    if not references:
        raise ValueError('Use three distinct scenes and a neutral reference')
    min(references, key=lambda row: abs(row['seconds'] - 9))['split'] = 'reference'
    for row in references:
        row['referenceEligible'] = True
    return dict(rawAtRoot=folder == source, rows=rows)


def main():
    try:
        source = json.loads(sys.stdin.read(32768))['source']
        if '--transcribe-recordings' in sys.argv:
            import contextlib
            from integrations.asr_runtime.native_runtime import load_sherpa_runtime

            _runtime = load_sherpa_runtime()
            from integrations.asr_runtime.model import ParakeetRecognizer, settings

            with contextlib.redirect_stdout(sys.stderr):
                recognizer = ParakeetRecognizer(settings())
                value = draft(source, lambda file: read_clip(file, recognizer))
        else:
            value = draft(source)
        print(json.dumps(value))
    except Exception:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
