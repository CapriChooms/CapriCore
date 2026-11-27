// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';

// The interpreter inside a virtual environment: Scripts/python.exe on Windows,
// bin/python on Linux and macOS. Windows keeps its original path exactly.
export function venvPython(venv) {
  return path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}
