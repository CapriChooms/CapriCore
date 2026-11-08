"""Small pinned public recording for verification, never live microphone data."""

import sys as _capri_sys
from pathlib import Path as _CapriPath
_capri_sys.path.insert(0, str(_CapriPath(__file__).resolve().parents[2]))
import hashlib
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
target=ROOT/'.runtime/asr-verification/russian-reference.wav'
expected='980b4327e684725859e437f05d15dfa4ec8afb994ef2e8fb356365af76547c41'
if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest()!=expected:
    cached=ROOT/'data/speech/sherpa-onnx-streaming-t-one-russian-2025-09-08/0.wav'
    if cached.is_file() and hashlib.sha256(cached.read_bytes()).hexdigest()==expected:
        data=cached.read_bytes()
    else:
        url='https://huggingface.co/csukuangfj/sherpa-onnx-streaming-t-one-russian-2025-09-08/resolve/9d63341e0f2d8a8b2edaa825aa1fcfe3c5283b47/0.wav'
        with urllib.request.urlopen(url,timeout=30) as source:data=source.read(101805)
    if len(data)!=101804 or hashlib.sha256(data).hexdigest()!=expected:raise ValueError('Russian public fixture failed verification')
    target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
print(str(target))
