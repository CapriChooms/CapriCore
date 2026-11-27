"""Read-only voice environment probe. Never loads weights or records audio."""
import importlib.metadata
import importlib.util
import json
import platform
import sys
from pathlib import Path

result = {'python': platform.python_version(), 'architecture': platform.machine(), 'packages': {}, 'cuda': {}, 'errors': []}
check_chatterbox = '--no-chatterbox' not in sys.argv
packages = ['torch', 'torchaudio', 'transformers', 'safetensors', 'numpy', 'soundfile', 'onnxruntime', 'faster-whisper', 'sherpa-onnx']
if check_chatterbox:
    packages += ['resemble-perth', 'chatterbox-tts']
for name in packages:
    try:
        result['packages'][name] = importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        result['packages'][name] = None
if check_chatterbox:
    try:
        spec = importlib.util.find_spec('chatterbox')
        result['chatterbox'] = {'turboModulePresent': bool(spec and spec.origin and (Path(spec.origin).parent / 'tts_turbo.py').is_file())}
        source = json.loads(importlib.metadata.distribution('chatterbox-tts').read_text('direct_url.json') or '{}')
        result['chatterbox']['sourceCommit'] = source.get('vcs_info', {}).get('commit_id')
    except Exception as exc:
        result['errors'].append({'component': 'chatterbox package', 'type': type(exc).__name__, 'message': str(exc)[:1000]})
try:
    import torch
    result['cuda'] = {'torch': torch.__version__, 'runtime': torch.version.cuda, 'available': torch.cuda.is_available(), 'compiledArchitectures': torch.cuda.get_arch_list(), 'devices': []}
    if result['cuda']['available']:
        for index in range(min(4, torch.cuda.device_count())):
            device = torch.cuda.get_device_properties(index)
            result['cuda']['devices'].append({'name': device.name, 'vramBytes': device.total_memory, 'capability': list(torch.cuda.get_device_capability(index))})
except Exception as exc:
    result['errors'].append({'component': 'torch/CUDA', 'type': type(exc).__name__, 'message': str(exc)[:4000]})
print(json.dumps(result, ensure_ascii=True), flush=True)
