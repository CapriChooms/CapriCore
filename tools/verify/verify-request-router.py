"""Evaluate the exported real CPU classifier without Qwen, tools or owner data."""

import sys as _capri_sys
from pathlib import Path as _CapriPath
_capri_sys.path.insert(0, str(_CapriPath(__file__).resolve().parents[2]))
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from integrations.request_router.model import Router

router = Router()
corpus = json.loads((ROOT / 'config/request-router-corpus.json').read_text(encoding='utf-8'))
rows = []
for label, texts in corpus['test'].items():
    for text in texts:
        started = time.perf_counter()
        result = router.classify(text)
        rows.append(dict(text=text, expected=label, **result, elapsedMs=round((time.perf_counter()-started)*1000,3)))
# Previous research cases remain regression tests, separate from head fitting.
old = json.loads((ROOT / 'tests/fixtures/request-routing.json').read_text(encoding='utf-8'))
regressions = [dict(**item, **router.classify(item['text'])) for item in old['evaluation']]
unsafe = [r for r in rows if r['expected'] == 'normal' and r['mode'] == 'fast']
unsafe_old = [r for r in regressions if r['label'] != 'dialogue' and r['mode'] == 'fast']
assert not unsafe and not unsafe_old, 'Protected or mixed requests must retain normal processing'
positive = [r for r in rows if r['expected'] == 'fast']
accepted = sum(r['mode']=='fast' for r in positive)
assert accepted >= len(positive)//2, 'The router must accelerate useful ordinary dialogue'
assert router.classify('Yes, please.', ['Pause the track.'])['mode'] == 'normal'
assert router.classify('Hey Capri, how are you?')['mode'] == 'fast'
report = dict(passed=True, provider='cpu', testCount=len(rows), fastDialogue=accepted,
              dialogueCount=len(positive), protectedFast=len(unsafe), regressionProtectedFast=len(unsafe_old),
              medianMs=round(float(np.median([r['elapsedMs'] for r in rows])),3),
              rows=rows, regressions=regressions)
(ROOT/'logs').mkdir(exist_ok=True)
(ROOT/'logs/request-router-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({key:value for key,value in report.items() if key not in ('rows','regressions')}))
