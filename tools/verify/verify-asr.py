"""Real Parakeet + Silero on public audio; never opens a physical microphone."""

import sys as _capri_sys
from pathlib import Path as _CapriPath
_capri_sys.path.insert(0, str(_CapriPath(__file__).resolve().parents[2]))
import json
import os
import re
import sys
import threading
import time
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
if '--ru' in sys.argv:
    os.environ['CAPRI_ASR_LANGUAGE'] = 'ru'
from integrations.asr_runtime.model import Recognizer, SpeechDetector, settings
from integrations.asr_runtime.recognition import RecognitionSession, RecognitionQueue

config = settings()
config['wakeWord']['enabled'] = False
language = config['language']
reference = ROOT / '.runtime/asr-verification' / ('russian-reference.wav' if language == 'ru' else 'english-reference.wav')
with wave.open(str(reference), 'rb') as source:
    assert source.getnchannels() == 1 and source.getsampwidth() == 2
    rate = source.getframerate()
    raw = np.frombuffer(source.readframes(source.getnframes()), dtype='<i2').astype(np.float32) / 32768
pcm = np.interp(np.arange(int(len(raw) * 16000 / rate)) * rate / 16000, np.arange(len(raw)), raw).astype(np.float32)
split = min(44800, len(pcm) // 2)
audio = np.concatenate((np.zeros(8000, dtype=np.float32), pcm[:split], np.zeros(16000, dtype=np.float32),
                        pcm[split:], np.zeros(64000, dtype=np.float32)))
started = time.perf_counter()
recognizer, detector = Recognizer(config), SpeechDetector(config)
startup = time.perf_counter() - started
done, events, timings = threading.Event(), [], []


def emit(event):
    events.append(event)
    if event['type'] in {'transcript', 'recognition-error'}:
        done.set()


queue = RecognitionQueue(recognizer, emit)
session = RecognitionSession(detector.session(), 'public-fixture', config, queue, emit)
try:
    for offset in range(0, len(audio), 1600):
        tick = time.perf_counter()
        session.accept(audio[offset:offset + 1600])
        timings.append((time.perf_counter() - tick) * 1000)
    assert done.wait(20), 'Accurate recognition timed out'
    finals = [e for e in events if e['type'] == 'transcript']
    assert len(finals) == 1, 'The one-second pause must not split the phrase'
    assert finals[0]['final'] is True
    assert not any(e['type'] == 'recognition-error' or e.get('final') is False for e in events)
    if language == 'en':
        assert 'yellow lamps' in finals[0]['text'].lower()
    else:
        assert len(re.findall('[\u0410-\u044f\u0401\u0451]', finals[0]['text'])) > 10
    report = dict(passed=True, language=language, physicalMicrophone=False, provider='cpu',
                  model=config['engine'], draft=False, sourceAudioSeconds=len(pcm) / 16000,
                  insertedPauseSeconds=1, startupSeconds=round(startup, 3),
                  p95PacketMs=round(float(np.percentile(timings, 95)), 2),
                  recognitionMs=finals[0]['recognitionMs'], finalText=finals[0]['text'])
    (ROOT / 'logs').mkdir(exist_ok=True)
    (ROOT / f'logs/asr-{language}-verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))
finally:
    queue.stop(session)
    queue.close()
