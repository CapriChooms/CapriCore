"""Compatibility command for the relocated developer tool."""
import runpy
import sys
from pathlib import Path
_target = (Path(__file__).resolve().parent / '../tools/setup/provision-streaming-asr.py').resolve()
sys.path.insert(0, str(_target.parents[2]))
sys.argv[0] = str(_target)
runpy.run_path(str(_target), run_name="__main__")
