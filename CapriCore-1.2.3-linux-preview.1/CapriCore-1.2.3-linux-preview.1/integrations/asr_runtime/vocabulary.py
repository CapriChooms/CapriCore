"""Bounded contextual vocabulary and a deterministic cache from verified tokens."""
import hashlib
import json
import math
import os
import sys
from pathlib import Path


def _native_vocabulary_path(target):
    value = str(target)
    if sys.platform != 'win32' or value.isascii():
        return value
    # SentencePiece opens this file with a narrow Windows file API. A relative
    # ASCII path works from the worker's Unicode cwd without short-name support,
    # copying models, changing the system code page or moving private data.
    relative = os.path.relpath(target, Path.cwd())
    if relative.isascii():
        return relative
    raise ValueError('Start speech recognition from the Capri installation directory')


def contextual_phrases(root, language):
    raw = (root / 'config/asr-vocabulary.json').read_bytes()
    if len(raw) > 16384:
        raise ValueError('Recognition vocabulary exceeds limit')
    value = json.loads(raw)
    if value.get('schemaVersion') != 1:
        raise ValueError('Unknown recognition vocabulary version')
    result = {}
    for key in ('wake', 'commands'):
        score = value.get('wakeScore' if key == 'wake' else 'commandScore')
        phrases = value.get(key, {}).get(language, value.get(key, {}).get('en', []) if key == 'wake' else [])
        if (type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 3
                or not isinstance(phrases, list) or len(phrases) > 16):
            raise ValueError('Invalid recognition vocabulary')
        if any(not isinstance(phrase, str) or not 1 <= len(phrase) <= 80
               or not all(c.isalpha() or c in " '-" for c in phrase) for phrase in phrases):
            raise ValueError('Invalid recognition phrase')
        result[key] = '/'.join(f'{phrase} :{score}' for phrase in phrases)
    return result


def bpe_vocabulary(root, tokens):
    # sherpa-onnx's Parakeet hotword example derives an equivalent longest-match
    # BPE vocabulary from tokens.txt. No tokenizer download or model replacement.
    raw = Path(tokens).read_bytes()
    content = ''.join(line.split(' ')[0] + '\t-1.0\n'
                      for line in raw.decode('utf-8').splitlines() if line.strip()).encode('utf-8')
    folder = root / '.runtime/asr-vocab'
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / (hashlib.sha256(raw).hexdigest() + '.vocab')
    if not target.is_file() or target.read_bytes() != content:
        partial = target.with_name(target.name + f'.{os.getpid()}.tmp')
        partial.write_bytes(content)
        os.replace(partial, target)
    return _native_vocabulary_path(target)
