"""Content-free failure metadata: never serialize exception text or speech."""
# SPDX-License-Identifier: GPL-3.0-only
import os
import time


def inference_failure(error):
    name = type(error).__name__
    code = getattr(error, 'code', None)
    if code != 'CAPRI_VOICE_SPEECH_LIMIT':
        code = ('CAPRI_VOICE_CUDA_OOM' if name == 'OutOfMemoryError' else
                'CAPRI_VOICE_MODEL_MISSING' if name == 'MissingSpeechModel' else
                'CAPRI_VOICE_INFERENCE_FAILED')
    return dict(schemaVersion=1, pid=os.getpid(), at=round(time.time()*1000),
                code=code, errorType=name[:80])
