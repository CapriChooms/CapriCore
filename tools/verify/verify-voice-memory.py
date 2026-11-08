"""Real pinned weights: compare CPU loader commit peaks or synthesize in memory.

Run each --loader in a fresh process. No voice file, microphone or owner chat.
"""
import argparse, ctypes, json, os, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np
import torch
from integrations.voice_training.dataset import read_config
from integrations.voice_training.backend import load_engine, local_environment
parser = argparse.ArgumentParser(); parser.add_argument('--loader', choices=['native', 'optimized', 'synthesis'], default='optimized'); args = parser.parse_args()
started = time.perf_counter()
if args.loader == 'synthesis':
    from integrations.voice_runtime.model import CapriVoice, settings
    engine = CapriVoice(settings()); raw, rate = engine.generate('Hey choom. I am right here.')
    pcm = np.frombuffer(raw, dtype='<f4'); assert len(pcm) > rate // 10 and np.isfinite(pcm).all() and np.max(np.abs(pcm)) > .001
    result = dict(mode=args.loader, passed=True, seconds=len(pcm)/rate, rate=rate, peakVramBytes=torch.cuda.max_memory_allocated())
else:
    if args.loader == 'native':
        local_environment()
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        engine = ChatterboxTurboTTS.from_local(read_config()['modelPath'], device='cpu')
    else:
        engine = load_engine(read_config())
    assert len(engine.tokenizer) == 50276 and not any(p.is_meta for p in engine.t3.parameters())
    assert all(p.dtype == torch.float32 for p in engine.t3.parameters())
    result = dict(mode=args.loader, passed=True, nativeTokenizer=True, fp32=True, parameters=sum(p.numel() for p in engine.t3.parameters()))
if os.name == 'nt':
    class Counters(ctypes.Structure):
        _fields_ = [('cb',ctypes.c_ulong),('faults',ctypes.c_ulong)] + [(n,ctypes.c_size_t) for n in ('peakWorkingSet','workingSet','peakPagedPool','pagedPool','peakNonPagedPool','nonPagedPool','pagefile','peakPagefile')]
    value = Counters(); value.cb = ctypes.sizeof(value)
    handle = ctypes.windll.kernel32.GetCurrentProcess
    handle.restype = ctypes.c_void_p
    fn = ctypes.windll.psapi.GetProcessMemoryInfo; fn.argtypes = [ctypes.c_void_p,ctypes.c_void_p,ctypes.c_ulong]
    if fn(handle(),ctypes.byref(value),value.cb): result.update(peakCommitBytes=value.peakPagefile,peakWorkingSetBytes=value.peakWorkingSet)
result['elapsedSeconds'] = round(time.perf_counter()-started,3)
print(json.dumps(result),flush=True)
