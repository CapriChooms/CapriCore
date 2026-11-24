"""Start the managed worker with only Capri's code and the pinned environment."""
from pathlib import Path
import runpy
import sys


if __name__ == '__main__':
    # The desktop launches with -I -S: sitecustomize and .pth hooks must not
    # import a different ONNX Runtime before the worker can select its DLL.
    root = Path(__file__).resolve().parents[2]
    venv_root = Path(sys.executable).parent.parent
    packages = venv_root / 'Lib' / 'site-packages'
    if not packages.exists():
        packages = venv_root / 'lib' / f'python{sys.version_info.major}.{sys.version_info.minor}' / 'site-packages'
    sys.path.extend((str(root), str(packages)))
    module = ('integrations.voice_training.review_recordings' if '--transcribe-recordings' in sys.argv
              else 'integrations.asr_runtime.worker')
    runpy.run_module(module, run_name='__main__')
