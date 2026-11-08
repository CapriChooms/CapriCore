"""Pinned CPU Parakeet v3 probe; synthetic round-trip results are diagnostic only."""

import sys as _capri_sys
from pathlib import Path as _CapriPath
_capri_sys.path.insert(0, str(_CapriPath(__file__).resolve().parents[2]))
import hashlib
import json
import re
import sys
import time
import wave
from pathlib import Path

import numpy as np
import sherpa_onnx

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from integrations.asr_runtime.model import settings
from integrations.asr_runtime.model import Recognizer


def error_rate(reference,hypothesis):
    words=lambda s:re.findall(r'[^\W_]+',s.casefold(),flags=re.UNICODE)
    a,b=words(reference),words(hypothesis)
    previous=list(range(len(b)+1))
    for i,word in enumerate(a,1):
        current=[i]
        for j,other in enumerate(b,1):
            current.append(min(previous[j]+1,current[j-1]+1,previous[j-1]+(word!=other)))
        previous=current
    return previous[-1]/max(1,len(a))


def pcm(file):
    with wave.open(str(file),'rb') as source:
        if (source.getnchannels(),source.getsampwidth(),source.getframerate())!=(1,2,16000):
            raise ValueError('Expected mono 16kHz PCM16 evaluation audio')
        if source.getnframes()>16000*60:
            raise ValueError('Evaluation sample too long')
        return np.frombuffer(source.readframes(source.getnframes()),dtype='<i2').astype(np.float32)/32768


spec=json.loads((ROOT/'config/multilingual-candidates.json').read_text(encoding='utf-8'))['asr']
folder=ROOT/spec['directory']
paths={}
for item in spec['files']:
    file=folder/item['file']
    with file.open('rb') as source:
        if file.stat().st_size!=item['bytes'] or hashlib.file_digest(source,'sha256').hexdigest()!=item['sha256']:
            raise ValueError('ASR candidate integrity check failed')
    paths[item['file']]=str(file)
started=time.perf_counter()
engine=sherpa_onnx.OfflineRecognizer.from_transducer(encoder=paths['encoder.int8.onnx'],decoder=paths['decoder.int8.onnx'],
    joiner=paths['joiner.int8.onnx'],tokens=paths['tokens.txt'],num_threads=8,provider='cpu',sample_rate=16000,model_type='nemo_transducer')
report=dict(status='pending-quality-review',provider='cpu',loadSeconds=round(time.perf_counter()-started,3),
    model=spec['model'],revision=spec['revision'],activeEnglishRecognizerChanged=False,results=[])


def recognize(audio):
    stream=engine.create_stream();stream.accept_waveform(16000,audio);engine.decode_stream(stream)
    return stream.result.text


reference='After early nightfall the yellow lamps would light up here and there the squalid quarter of the brothels.'
audio=pcm(ROOT/'.runtime/asr-verification/english-reference.wav')
for name,transcribe in [('parakeet-v2-baseline',Recognizer(settings()).transcribe),('parakeet-v3-candidate',recognize)]:
    started=time.perf_counter();text=transcribe(audio)
    report['results'].append(dict(engine=name,language='en',source='public reference fixture',reference=reference,text=text,
        wer=round(error_rate(reference,text),4),elapsedMs=round((time.perf_counter()-started)*1000,2)))
voice_report=ROOT/'logs/multilingual-voice-evaluation.json'
if voice_report.is_file():
    voice=json.loads(voice_report.read_text(encoding='utf-8'));source_folder=Path(voice['output'])
    if not source_folder.resolve().is_relative_to(ROOT/'data/voices/capri/multilingual/evaluations'):
        raise ValueError('Unexpected evaluation folder')
    for sample in voice['samples']:
        file=(source_folder/sample['asrFile']).resolve()
        if file.parent!=source_folder:
            raise ValueError('Unexpected sample filename')
        audio=pcm(file);started=time.perf_counter();text=recognize(audio)
        report['results'].append(dict(engine='parakeet-v3-candidate',language=sample['language'],source='synthetic TTS round-trip; not spontaneous speech',
            reference=sample['text'],text=text,wer=round(error_rate(sample['text'],text),4),elapsedMs=round((time.perf_counter()-started)*1000,2)))
(ROOT/'logs/multilingual-asr-evaluation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=True),flush=True)
