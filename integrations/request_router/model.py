"""Frozen MiniLM encoder and a trained binary head, with conservative abstention."""
import hashlib
import json
import os
import re
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

ROOT = Path(__file__).resolve().parents[2]
# These guards retain the full task path. They never interpret action arguments,
# execute actions or rewrite the owner's input. Confirmed social turns can use
# the desktop's separate one-turn memory-only tool intersection.
PROTECTED = re.compile(r"\b(?:remember|forget|save|store|record|recall|notes?|files?|documents?|workspace|"
                       r"read|write|edit|create|delete|remove|open|copy|move|search|find|check|lookup|"
                       r"calculate|solve|explain|compare|research|debug|analy[sz]e|plan|prove|translate|"
                       r"summari[sz]e|count|probability|equation|code|program|algorithm|database|"
                       r"spotify|songs?|tracks?|playlists?|music|volume|pause|resume|play|skip|repeat|"
                       r"shuffle|louder|quieter|turn|stop|settings?|screen|microphone|remind|schedule|"
                       r"timers?|stopwatch|alarms?|elapsed|glitch|enable|disable|appointment|address|birthday|name|weather|news|time|date|price|plus|minus|times|"
                       r"launch|browser|chrome|firefox|keys?|keyboard|press|click|hold|pointer|cursor|mouse|scroll|discord)\b", re.I)
REFERENCE = re.compile(r"\b(?:it|that|those|these|them|again|same|other|instead|earlier|yesterday|"
                       r"continue|previous|before|next|last|there|which|why|how much|how many)\b", re.I)


def guard(text, context=()):
    if not isinstance(text, str) or not text.strip() or len(text) > 400:
        return 'input-scope'
    if any(c.isalpha() and not c.isascii() for c in text):
        return 'language'
    if PROTECTED.search(text) or re.search(r'[0-9`{}=<>/\\]|https?:|\blook\s+up\b', text, re.I):
        return 'task-cue'
    if REFERENCE.search(text):
        return 'context-required'
    # Short replies following a task can refer to its arguments without naming
    # them ("a little less", "yes please"). Preserve reasoning in that case.
    if len(text.split()) <= 4 and any(PROTECTED.search(value) for value in context):
        return 'task-follow-up'
    return None


def settings():
    config = json.loads((ROOT / 'config/request-router.json').read_text(encoding='utf-8'))
    if (config.get('schemaVersion') != 1 or type(config.get('enabled')) is not bool
            or type(config.get('cpuThreads')) is not int or not 1 <= config['cpuThreads'] <= 8):
        raise ValueError('Invalid request router configuration')
    config['cpuThreads'] = max(1, min(config['cpuThreads'], os.cpu_count() or 1, int(os.environ.get('CAPRI_CPU_THREADS', '8'))))
    config['folder'] = (ROOT / config['modelDir']).resolve()
    if not config['folder'].is_relative_to(ROOT / 'data/models/request-router'):
        raise ValueError('Router model must stay inside data/models/request-router')
    return config


class Encoder:
    def __init__(self, config):
        upstream = json.loads((ROOT / 'config/request-router-upstream.json').read_text(encoding='utf-8'))
        paths = {}
        for key, item in upstream['files'].items():
            target = (config['folder'] / item['file']).resolve()
            if not target.is_relative_to(config['folder']) or target.stat().st_size != item['bytes']:
                raise ValueError('Request router model is missing')
            with target.open('rb') as source:
                if hashlib.file_digest(source, 'sha256').hexdigest() != item['sha256']:
                    raise ValueError('Request router model checksum mismatch')
            paths[key] = str(target)
        self.tokenizer = Tokenizer.from_file(paths['tokenizer'])
        self.tokenizer.enable_truncation(max_length=256)
        self.tokenizer.enable_padding(pad_id=0, pad_token='[PAD]')
        options = ort.SessionOptions()
        options.intra_op_num_threads = config['cpuThreads']
        options.inter_op_num_threads = 1
        self.engine = ort.InferenceSession(paths['encoder'], options, providers=['CPUExecutionProvider'])

    def encode(self, texts):
        tokens = self.tokenizer.encode_batch(texts)
        inputs = dict(input_ids=np.array([t.ids for t in tokens], dtype=np.int64),
                      attention_mask=np.array([t.attention_mask for t in tokens], dtype=np.int64),
                      token_type_ids=np.array([t.type_ids for t in tokens], dtype=np.int64))
        hidden = self.engine.run(None, {i.name: inputs[i.name] for i in self.engine.get_inputs()})[0]
        mask = inputs['attention_mask'][..., None]
        pooled = (hidden * mask).sum(axis=1) / np.maximum(mask.sum(axis=1), 1)
        return (pooled / np.maximum(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-9)).astype(np.float32)


class Router:
    def __init__(self, config=None):
        config = config or settings()
        self.encoder = Encoder(config)
        target = (ROOT / config['headFile']).resolve()
        if target != ROOT / 'config/request-router-head.json':
            raise ValueError('Unknown request classifier head')
        self.head = json.loads(target.read_text(encoding='utf-8'))
        self.weights = np.array(self.head['weights'], dtype=np.float32)
        self.anchors = np.array(self.head['anchors'], dtype=np.float32)
        if (self.head['schemaVersion'] != 1 or self.weights.shape != (384,)
                or self.anchors.ndim != 2 or self.anchors.shape[1] != 384 or not 1 <= len(self.anchors) <= 64
                or not np.isfinite(self.weights).all() or not np.isfinite(self.anchors).all()
                or not np.isfinite(self.head['bias'])
                or not .5 <= self.head['threshold'] <= 1 or not .4 <= self.head['minimumSimilarity'] <= 1):
            raise ValueError('Invalid request classifier head')
        self.encoder.encode(['Hello, how are you?'])

    def classify(self, text, context=()):
        reason = guard(text, context)
        if reason:
            return dict(mode='normal', reason=reason)
        vector = self.encoder.encode([text])[0]
        logit = float(vector @ self.weights) + self.head['bias']
        score = float(1 / (1 + np.exp(-np.clip(logit, -60, 60))))
        similarity = float(np.max(self.anchors @ vector))
        fast = score >= self.head['threshold'] and similarity >= self.head['minimumSimilarity']
        return dict(mode='fast' if fast else 'normal', reason='simple-dialogue' if fast else 'uncertain',
                    score=round(score, 4), similarity=round(similarity, 4))
