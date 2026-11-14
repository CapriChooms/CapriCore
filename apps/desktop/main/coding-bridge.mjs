// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from 'node:child_process';
import path from 'node:path';

export async function installCodingBridge(root, editor, signal) {
  const run = (file, args) =>
    new Promise((resolve, reject) =>
      execFile(
        file,
        args,
        { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024, signal },
        (error) =>
          error
            ? reject(
                signal?.aborted
                  ? signal.reason
                  : new Error(
                      'The editor bridge could not be installed. Check the selected editor and retry.',
                    ),
              )
            : resolve(),
      ),
    );
  await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(root, 'tools/build/build-coding-bridge.ps1'),
    '-Root',
    root,
  ]);
  signal?.throwIfAborted();
  await run(editor.executable, [
    '--install-extension',
    path.join(root, '.runtime/coding-vscode/capri-project-bridge.vsix'),
    '--force',
  ]);
}
