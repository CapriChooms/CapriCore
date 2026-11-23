"""Pin the Windows ONNX Runtime used by the native Sherpa extension."""
from importlib.util import find_spec
from pathlib import Path
import sys

LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR = 0x00000100
LOAD_LIBRARY_SEARCH_SYSTEM32 = 0x00000800


def load_sherpa_runtime():
    if sys.platform != 'win32':
        return None

    import ctypes
    from ctypes import wintypes

    spec = find_spec('sherpa_onnx')
    if spec is None or not spec.origin:
        raise ImportError('Sherpa-ONNX is missing')
    library = Path(spec.origin).parent / 'lib' / 'onnxruntime.dll'
    library = library.resolve(strict=True)

    # Windows can reuse an already-loaded DLL by basename for native imports.
    # Refuse an incompatible module before it can crash the worker.
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
    kernel.GetModuleHandleW.restype = wintypes.HMODULE
    kernel.GetModuleFileNameW.argtypes = [wintypes.HMODULE, wintypes.LPWSTR, wintypes.DWORD]
    kernel.GetModuleFileNameW.restype = wintypes.DWORD
    existing = kernel.GetModuleHandleW(library.name)
    if existing:
        filename = ctypes.create_unicode_buffer(32768)
        size = kernel.GetModuleFileNameW(existing, filename, len(filename))
        if not 0 < size < len(filename) or not library.samefile(filename.value):
            raise ImportError('Another ONNX Runtime is already loaded')

    # Search dependencies only beside the pinned DLL and in Windows System32.
    return ctypes.WinDLL(
        str(library),
        winmode=LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32,
    )
