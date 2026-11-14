// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
/** Metadata-only discovery. No editor process, login or plugin is started. */
export function discoverCodingEditors(env = process.env) {
  const result = [],
    local = env.LOCALAPPDATA,
    program = env.ProgramFiles;
  const add = (name, kind, file) => {
    if (file && existsSync(file) && !result.some((row) => row.executable === file))
      result.push({ name, kind, executable: file });
  };
  for (const [name, folder, exe] of [
    ['VS Code', 'Microsoft VS Code', 'Code.exe'],
    ['Cursor', 'cursor', 'Cursor.exe'],
    ['Windsurf', 'Windsurf', 'Windsurf.exe'],
    ['VSCodium', 'VSCodium', 'VSCodium.exe'],
  ]) {
    if (local) add(name, 'vscode', path.join(local, 'Programs', folder, exe));
    if (program) add(name, 'vscode', path.join(program, folder, exe));
  }
  if (program) {
    for (const [name, kind, file] of [
      ['Notepad++', 'notepad++', 'Notepad++/notepad++.exe'],
      ['Sublime Text', 'sublime', 'Sublime Text/sublime_text.exe'],
      ['Neovim GUI', 'neovim', 'Neovim/bin/nvim-qt.exe'],
    ])
      add(name, kind, path.join(program, file));
    const jetbrains = path.join(program, 'JetBrains');
    if (existsSync(jetbrains))
      for (const folder of readdirSync(jetbrains, { withFileTypes: true })
        .filter((row) => row.isDirectory() && !row.isSymbolicLink())
        .slice(0, 30))
        for (const exe of [
          'idea64.exe',
          'pycharm64.exe',
          'webstorm64.exe',
          'rider64.exe',
          'clion64.exe',
          'goland64.exe',
          'phpstorm64.exe',
          'rubymine64.exe',
        ])
          add(folder.name, 'jetbrains', path.join(jetbrains, folder.name, 'bin', exe));
    for (const year of ['2026', '2022', '2019'])
      for (const edition of ['Community', 'Professional', 'Enterprise'])
        add(
          `Visual Studio ${year} ${edition}`,
          'visual-studio',
          path.join(program, 'Microsoft Visual Studio', year, edition, 'Common7/IDE/devenv.exe'),
        );
  }
  return result;
}
