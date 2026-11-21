// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { readWindowsEditorMetadata } from './coding-editor-windows.mjs';

const editors = [
  ['VS Code', 'vscode', ['code.exe']],
  ['VS Code Insiders', 'vscode', ['code - insiders.exe']],
  ['Cursor', 'vscode', ['cursor.exe']],
  ['Windsurf', 'vscode', ['windsurf.exe']],
  ['VSCodium', 'vscode', ['vscodium.exe', 'codium.exe']],
  ['VSCodium Insiders', 'vscode', ['vscodium - insiders.exe', 'codium-insiders.exe']],
  ['IntelliJ IDEA', 'jetbrains', ['idea64.exe', 'idea.exe']],
  ['PyCharm', 'jetbrains', ['pycharm64.exe', 'pycharm.exe']],
  ['WebStorm', 'jetbrains', ['webstorm64.exe', 'webstorm.exe']],
  ['Rider', 'jetbrains', ['rider64.exe']],
  ['CLion', 'jetbrains', ['clion64.exe']],
  ['GoLand', 'jetbrains', ['goland64.exe']],
  ['PhpStorm', 'jetbrains', ['phpstorm64.exe', 'phpstorm.exe']],
  ['RubyMine', 'jetbrains', ['rubymine64.exe', 'rubymine.exe']],
  ['DataGrip', 'jetbrains', ['datagrip64.exe']],
  ['DataSpell', 'jetbrains', ['dataspell64.exe']],
  ['RustRover', 'jetbrains', ['rustrover64.exe']],
  ['Android Studio', 'jetbrains', ['studio64.exe', 'studio.exe']],
  ['Visual Studio', 'visual-studio', ['devenv.exe']],
  ['Sublime Text', 'sublime', ['sublime_text.exe']],
  ['Notepad++', 'notepad++', ['notepad++.exe']],
  ['Neovim GUI', 'neovim', ['nvim-qt.exe']],
  ['Emacs client', 'emacs', ['emacsclientw.exe']],
];
const editorByExecutable = new Map(
  editors.flatMap(([name, kind, files]) => files.map((file) => [file, { name, kind }])),
);
const editorDirectory =
  /^(?:microsoft vs code|vs code|vscodium|cursor|windsurf|intellij idea|idea(?:[-_]|$)|pycharm|webstorm|rider|clion|goland|phpstorm|rubymine|datagrip|dataspell|rustrover|android studio|sublime text|notepad\+\+|neovim|nvim-qt|(?:gnu )?emacs)/i;
const scoopApps = [
  'vscode',
  'vscode-insiders',
  'vscodium',
  'cursor',
  'windsurf',
  'sublime-text',
  'notepadplusplus',
  'neovim-qt',
  'emacs',
];
const naturalOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function localPath(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  const unquoted = value.trim().replace(/^"(.*)"$/, '$1');
  if (!path.isAbsolute(unquoted) || /[\x00-\x1f]/.test(unquoted)) return null;
  if (
    process.platform === 'win32' &&
    (!/^[a-z]:[\\/]/i.test(unquoted) || /[<>:"|?*]/.test(unquoted.slice(2)))
  )
    return null;
  return path.normalize(unquoted);
}

function localPaths(values) {
  const unique = new Map();
  for (const value of values) {
    const full = localPath(value);
    if (full && !unique.has(full.toLowerCase())) unique.set(full.toLowerCase(), full);
  }
  return [...unique.values()];
}

function readEntries(directory) {
  return readdir(directory, { withFileTypes: true }).catch(() => []);
}

async function children(directory, matches, limit = 64) {
  return (await readEntries(directory))
    .filter((entry) => entry.isDirectory() && matches.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => naturalOrder.compare(b, a))
    .slice(0, limit)
    .map((name) => path.join(directory, name));
}

function layout(directory) {
  return [directory, path.join(directory, 'bin'), path.join(directory, 'Common7', 'IDE')];
}

async function standardLocations(roots) {
  return (
    await Promise.all(
      roots.map(async (root) => {
        const [products, jetbrains, android, studios] = await Promise.all([
          children(root, editorDirectory),
          children(path.join(root, 'JetBrains'), editorDirectory),
          children(path.join(root, 'Android'), /^Android Studio/i),
          children(path.join(root, 'Microsoft Visual Studio'), /^(?:20\d{2}|\d+\.\d+)$/),
        ]);
        const studioEditions = await Promise.all(
          studios.map((studio) =>
            children(studio, /^(?:community|professional|enterprise|preview|insiders)$/i),
          ),
        );
        const emacsVersions = await Promise.all(
          products
            .filter((product) => /^(?:gnu )?emacs$/i.test(path.basename(product)))
            .map((product) => children(product, /^emacs[- ]\d/i, 8)),
        );
        return [
          root,
          ...products,
          ...jetbrains,
          ...android,
          ...studioEditions.flat(),
          ...emacsVersions.flat(),
        ].flatMap(layout);
      }),
    )
  ).flat();
}

async function toolboxLocations(local) {
  if (!local) return [];
  const products = await children(path.join(local, 'JetBrains', 'Toolbox', 'apps'), /^[a-z]/i, 30);
  return (
    await Promise.all(
      products.map(async (product) => {
        const [channels, versions] = await Promise.all([
          children(product, /^ch-\d+$/i, 6),
          children(product, /^\d/, 8),
        ]);
        const builds = await Promise.all(channels.map((channel) => children(channel, /^\d/, 8)));
        return [product, ...versions, ...builds.flat()].flatMap(layout);
      }),
    )
  ).flat();
}

function scoopLocations(env) {
  const user = localPath(env.USERPROFILE);
  const programData = localPath(env.ProgramData);
  const roots = localPaths([
    env.SCOOP,
    env.SCOOP_GLOBAL,
    user && path.join(user, 'scoop'),
    programData && path.join(programData, 'scoop'),
  ]);
  return roots.flatMap((root) =>
    scoopApps.flatMap((app) => layout(path.join(root, 'apps', app, 'current'))),
  );
}

async function foundExecutables(directories) {
  const result = [];
  // Read each directory once without traversing arbitrary folders or following links to more roots.
  for (let i = 0; i < directories.length; i += 24) {
    const matches = await Promise.all(
      directories
        .slice(i, i + 24)
        .map(async (directory) =>
          (await readEntries(directory))
            .filter((entry) => entry.isFile() && editorByExecutable.has(entry.name.toLowerCase()))
            .map((entry) => path.join(directory, entry.name)),
        ),
    );
    result.push(...matches.flat());
  }
  return result;
}

function editorLabel(editor, file) {
  if (editor.kind !== 'visual-studio') return editor.name;
  const [, , , edition, version] = file.split(path.sep).reverse();
  return /^20\d{2}$/.test(version) &&
    /^(?:Community|Professional|Enterprise|Preview|Insiders)$/i.test(edition)
    ? `${editor.name} ${version} ${edition}`
    : editor.name;
}

/** Metadata-only discovery. No editor process, login or plugin is started. */
export async function discoverCodingEditors(
  env = process.env,
  { readMetadata = readWindowsEditorMetadata } = {},
) {
  const local = localPath(env.LOCALAPPDATA);
  const roots = localPaths([
    local && path.join(local, 'Programs'),
    env.ProgramW6432,
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
  ]);
  const [metadata, standard, toolbox] = await Promise.all([
    Promise.resolve()
      .then(() => readMetadata([...editorByExecutable.keys()], env))
      .catch(() => null),
    standardLocations(roots),
    toolboxLocations(local),
  ]);
  const pathDirectories = (env.PATH ?? env.Path ?? '').split(path.delimiter).slice(0, 96);
  const registered = localPaths((metadata?.installLocations ?? []).slice(0, 80)).flatMap(layout);
  const directories = localPaths([
    ...standard,
    ...toolbox,
    ...registered,
    ...scoopLocations(env),
    ...pathDirectories,
  ]);
  const candidates = localPaths([
    ...(metadata?.executables ?? []).slice(0, 200),
    ...(await foundExecutables(directories)),
  ]);
  const result = new Map();
  for (const candidate of candidates) {
    const editor = editorByExecutable.get(path.basename(candidate).toLowerCase());
    if (!editor) continue;
    try {
      const executable = (await lstat(candidate)).isFile() && localPath(await realpath(candidate));
      if (!executable || result.has(executable.toLowerCase())) continue;
      result.set(executable.toLowerCase(), {
        name: editorLabel(editor, executable),
        kind: editor.kind,
        executable,
      });
      if (result.size >= 64) break;
    } catch {
      // An uninstalled, stale or inaccessible candidate does not hide other editors.
    }
  }
  return [...result.values()];
}
