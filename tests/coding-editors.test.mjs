// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempDisposableSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverCodingEditors } from '../apps/desktop/coding-editors.mjs';

const emptyMetadata = async () => ({ executables: [], installLocations: [] });

function editorFile(root, relative) {
  const executable = path.join(root, relative);
  mkdirSync(path.dirname(executable), { recursive: true });
  writeFileSync(executable, 'Metadata-only editor fixture');
  return executable;
}

function assertEditor(editors, executable, kind) {
  const expected = realpathSync.native(executable).toLowerCase();
  const found = editors.filter(
    (editor) => realpathSync.native(editor.executable).toLowerCase() === expected,
  );
  assert.equal(found.length, 1, `Expected one result for ${executable}`);
  assert.equal(found[0].kind, kind);
  assert.ok(found[0].name.trim());
}

test('Find editors covers per-user installs, both Program Files roots, Toolbox builds and PATH', async () => {
  using fixture = mkdtempDisposableSync(path.join(tmpdir(), 'capri-editor-paths-'));
  const local = path.join(fixture.path, 'Local AppData');
  const program = path.join(fixture.path, 'Program Files');
  const x86 = path.join(fixture.path, 'Program Files (x86)');
  const portable = path.join(fixture.path, 'Portable Editors');

  const cases = [
    [editorFile(local, 'Programs/Microsoft VS Code/Code.exe'), 'vscode'],
    [editorFile(local, 'Programs/IntelliJ IDEA/bin/idea64.exe'), 'jetbrains'],
    [
      editorFile(local, 'JetBrains/Toolbox/apps/PyCharm-P/ch-0/242.21829.153/bin/pycharm64.exe'),
      'jetbrains',
    ],
    [editorFile(program, 'JetBrains/DataGrip 2025.1/bin/datagrip64.exe'), 'jetbrains'],
    [editorFile(program, 'Sublime Text/sublime_text.exe'), 'sublime'],
    [editorFile(x86, 'Notepad++/notepad++.exe'), 'notepad++'],
    [editorFile(portable, 'nvim-qt.exe'), 'neovim'],
  ];
  editorFile(portable, 'update.exe');

  const editors = await discoverCodingEditors(
    {
      LOCALAPPDATA: local,
      ProgramW6432: program,
      ProgramFiles: x86,
      'ProgramFiles(x86)': x86,
      PATH: portable,
    },
    { readMetadata: emptyMetadata },
  );
  for (const [executable, kind] of cases) assertEditor(editors, executable, kind);
  assert.equal(editors.length, cases.length);
});

test('Find editors accepts custom Windows install metadata and filters or deduplicates paths', async () => {
  using fixture = mkdtempDisposableSync(path.join(tmpdir(), 'capri-editor-metadata-'));
  const webStorm = editorFile(fixture.path, 'Custom IDEs/WebStorm/bin/webstorm64.exe');
  const vsRoot = path.join(fixture.path, 'Custom IDEs/VS 2022');
  const visualStudio = editorFile(vsRoot, 'Common7/IDE/devenv.exe');
  const code = editorFile(fixture.path, 'Portable Code/Code.exe');
  const ignored = editorFile(fixture.path, 'Other Software/update.exe');
  const notAFile = path.join(fixture.path, 'Invalid directory/idea64.exe');
  mkdirSync(notAFile, { recursive: true });

  const editors = await discoverCodingEditors(
    { PATH: path.dirname(code) },
    {
      readMetadata: async () => ({
        executables: [
          webStorm,
          path.join(path.dirname(webStorm), 'WEBSTORM64.EXE'),
          code,
          ignored,
          notAFile,
          path.join(fixture.path, 'Removed/idea64.exe'),
          'idea64.exe',
        ],
        installLocations: [vsRoot],
      }),
    },
  );

  assertEditor(editors, webStorm, 'jetbrains');
  assertEditor(editors, visualStudio, 'visual-studio');
  assertEditor(editors, code, 'vscode');
  assert.equal(editors.length, 3);
});

test('Find editors keeps filesystem results when Windows metadata is unavailable', async () => {
  using fixture = mkdtempDisposableSync(path.join(tmpdir(), 'capri-editor-no-metadata-'));
  const executable = editorFile(fixture.path, 'Microsoft VS Code/Code.exe');
  const editors = await discoverCodingEditors(
    { ProgramFiles: fixture.path },
    {
      readMetadata: async () => {
        throw new Error('Windows editor metadata temporarily unavailable');
      },
    },
  );
  assertEditor(editors, executable, 'vscode');
  assert.equal(editors.length, 1);
});
