"""Start the managed worker with only Capri's code and the pinned environment."""
from pathlib import Path
import runpy
import sys


if __name__ == '__main__':
    # The desktop launches with -I -S: sitecustomize and .pth hooks must not
    # import a different ONNX Runtime before the worker can select its DLL.
    root = Path(__file__).resolve().parents[2]
    packages = Path(sys.executable).parent.parent / 'Lib' / 'site-packages'
    sys.path.extend((str(root), str(packages)))
    module = ('integrations.voice_training.review_recordings' if '--transcribe-recordings' in sys.argv
              else 'integrations.asr_runtime.worker')
    runpy.run_module(module, run_name='__main__')
