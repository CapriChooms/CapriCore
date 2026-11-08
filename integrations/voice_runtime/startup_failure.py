"""Bounded startup status for native exits that precede the authenticated server."""
import os
import time
import ctypes
import re


def memory_status():
    if os.name != 'nt':
        return None
    class MemoryStatus(ctypes.Structure):
        _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [(name, ctypes.c_ulonglong) for name in ('totalPhysical', 'availablePhysical', 'commitLimit', 'availableCommit', 'totalVirtual', 'availableVirtual', 'extendedVirtual')]
    value = MemoryStatus(); value.length = ctypes.sizeof(value)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(value)):
        return None
    return {name: getattr(value, name) for name in ('totalPhysical', 'availablePhysical', 'commitLimit', 'availableCommit')}


def startup_failure(error):
    commit = getattr(error, 'winerror', None) == 1455 or bool(re.search(r'(?:os error|winerror)\s*1455\b', str(error), re.I))
    return dict(schemaVersion=1, pid=os.getpid(), at=int(time.time()*1000), code='CAPRI_VOICE_COMMIT_LIMIT' if commit else 'CAPRI_VOICE_STARTUP_FAILED', errorClass=type(error).__name__, memory=memory_status())
