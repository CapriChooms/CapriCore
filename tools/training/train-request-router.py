"""Fit a small supervised head on the fixed CPU encoder; calibrate separately."""

import sys as _capri_sys
from pathlib import Path as _CapriPath
_capri_sys.path.insert(0, str(_CapriPath(__file__).resolve().parents[2]))
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from integrations.request_router.model import Encoder, guard, settings

source = ROOT / 'config/request-router-corpus.json'
corpus = json.loads(source.read_text(encoding='utf-8'))
groups = {name: [(text, int(label == 'fast')) for label, texts in corpus[name].items() for text in texts]
          for name in ('train', 'calibration', 'test')}
normalized = {name: {text.strip().lower() for text, _ in rows} for name, rows in groups.items()}
assert all(not normalized[a] & normalized[b] for a, b in [('train','calibration'),('train','test'),('calibration','test')])
encoder = Encoder(settings())


def encode(texts):
    return np.concatenate([encoder.encode(texts[i:i+16]) for i in range(0, len(texts), 16)])


vectors = encode([text for text, _ in groups['train']])
labels = np.array([label for _, label in groups['train']])
model = LogisticRegression(C=16, random_state=417, max_iter=2000, class_weight='balanced')
model.fit(vectors, labels)
positive = vectors[labels == 1]
# Store a small diverse anchor set, rather than the entire training corpus.
chosen = [0]
for _ in range(min(31, len(positive)-1)):
    similarity = (positive @ positive[chosen].T).max(axis=1)
    similarity[chosen] = 2
    chosen.append(int(np.argmin(similarity)))
anchors = positive[chosen]
calibration = encode([text for text, _ in groups['calibration']])
scores = model.predict_proba(calibration)[:, 1]
similarities = (calibration @ anchors.T).max(axis=1)
minimum_similarity = .5
threshold = None
for candidate in (.85, .875, .90, .925, .95, .975, .99):
    selected = [i for i, (text, _) in enumerate(groups['calibration'])
                if not guard(text) and scores[i] >= candidate and similarities[i] >= minimum_similarity]
    if len(selected) >= 4 and all(groups['calibration'][i][1] == 1 for i in selected):
        threshold = candidate
        break
if threshold is None:
    raise SystemExit('No useful conservative threshold on the calibration set; not exporting.')
head = dict(schemaVersion=1, architecture='frozen-minilm-l6-v2-int8 + logistic-regression',
            trainingCorpusSha256=hashlib.sha256(source.read_bytes()).hexdigest(), seed=417,
            threshold=threshold, minimumSimilarity=minimum_similarity,
            weights=np.round(model.coef_[0], 7).tolist(), bias=float(model.intercept_[0]),
            anchors=np.round(anchors, 7).tolist(),
            counts={key:len(value) for key,value in groups.items()})
(ROOT / 'config/request-router-head.json').write_text(json.dumps(head, separators=(',', ':'))+'\n', encoding='utf-8')
print(json.dumps(dict(exported=True, threshold=threshold, calibrationFast=len(selected), counts=head['counts'])))
