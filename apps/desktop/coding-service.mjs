// SPDX-License-Identifier: GPL-3.0-only
import {
  existsSync,
  lstatSync,
  realpathSync,
  opendirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { open as openFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { CodingEditorBridge } from './coding-editor-bridge.mjs';
import {
  CodingProjectMonitor,
  privateProjectPart,
  projectRelative,
  scanProjectFiles,
} from './coding-project-files.mjs';
import {
  assertPrivatePath,
  writePrivateBytesAtomic,
} from '../../packages/runtime/src/safe-file.mjs';

const run = promisify(execFile),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const maxFileBytes = 512 * 1024;
const maxReadLines = 400;
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const lineEnding = /\r\n|\n|\r/g;
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return (
    !relative ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
};
const fail = (text) => {
  throw Object.assign(new Error(text), { code: 'CAPRI_CODING_SCOPE' });
};
const cleanEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(?:PATH|SystemRoot|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|ProgramFiles|ProgramData|COMSPEC)$/i.test(
        key,
      ),
    ),
  );
const positive = (number, max) => Number.isInteger(number) && number > 0 && number <= max;

function rangedText(result, line, endLine) {
  if (line === undefined && endLine === undefined) return result;
  const fromLine = line ?? 1;
  if (!positive(fromLine, 10000000) || (endLine !== undefined && !positive(endLine, 10000000)))
    fail('Use positive line numbers for a project file range.');
  if (endLine !== undefined && endLine < fromLine)
    fail('The last line must be at or after the first line.');
  const starts = [0];
  for (const match of result.text.matchAll(lineEnding)) starts.push(match.index + match[0].length);
  if (fromLine > starts.length) fail('The requested line is outside the project file.');
  const toLine = Math.min(endLine ?? fromLine + 149, fromLine + maxReadLines - 1, starts.length);
  const text = result.text.slice(starts[fromLine - 1], starts[toLine] ?? result.text.length);
  return {
    ...result,
    text: toLine < starts.length ? text.replace(/(?:\r\n|\n|\r)$/, '') : text,
    fromLine,
    toLine,
    totalLines: starts.length,
    partial: fromLine !== 1 || toLine !== starts.length,
  };
}

export const IDE_KINDS = [
  'vscode',
  'jetbrains',
  'visual-studio',
  'sublime',
  'notepad++',
  'neovim',
  'emacs',
];
export function editorArguments(kind, file, line = 1, column = 1) {
  if (!IDE_KINDS.includes(kind) || !positive(line, 10000000) || !positive(column, 100000))
    fail('Invalid editor location.');
  if (kind === 'vscode') return ['--reuse-window', '--goto', `${file}:${line}:${column}`];
  if (kind === 'jetbrains') return ['--line', String(line), '--column', String(column), file];
  if (kind === 'visual-studio') return ['/Edit', file, '/Command', `Edit.Goto ${line}`];
  if (kind === 'sublime') return [`${file}:${line}:${column}`];
  if (kind === 'notepad++') return [`-n${line}`, `-c${column}`, file];
  if (kind === 'emacs') return ['--no-wait', `+${line}:${column}`, file];
  return [`+call cursor(${line},${column})`, file];
}

export function editorProjectArguments(kind, workspace) {
  if (!IDE_KINDS.includes(kind)) fail('Choose a supported editor executable.');
  if (kind === 'notepad++')
    return ['-multiInst', '-nosession', '-openFoldersAsWorkspace', workspace];
  if (kind === 'vscode') return ['--reuse-window', workspace];
  return [workspace];
}

/** A separate project grant, never an implicit extension of desktop/full access. */
export class CodingService {
  constructor({
    root,
    runImpl = run,
    spawnImpl = spawn,
    bridge = new CodingEditorBridge(),
    onProjectChange = () => {},
  }) {
    Object.assign(this, { root, runImpl, spawnImpl, bridge });
    this.buffers = new Map();
    this.monitorEnabled = false;
    this.monitor = new CodingProjectMonitor({
      resolve: (relative, options) => this.resolve(relative, options),
      onChange: onProjectChange,
    });
    this.file = path.join(root, 'data/desktop/coding.json');
    assertPrivatePath(this.file);
    this.config = { workspace: '', editor: null, tasks: [], bridge: false, reviewWrites: false };
    if (existsSync(this.file)) {
      const stat = lstatSync(this.file);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16384)
        fail('Coding settings are unavailable.');
      this.config = this.validate(JSON.parse(readFileSync(this.file, 'utf8')));
    }
  }
  validate(value) {
    if (
      !value ||
      Object.keys(value).some(
        (key) => !['workspace', 'editor', 'tasks', 'bridge', 'reviewWrites'].includes(key),
      )
    )
      fail('Invalid coding settings.');
    if (typeof value.workspace !== 'string' || value.workspace.length > 2048)
      fail('Choose a project folder.');
    let workspace = '';
    if (value.workspace) {
      if (!path.isAbsolute(value.workspace)) fail('Choose a project folder.');
      workspace = path.resolve(value.workspace);
      assertPrivatePath(workspace);
      if (!lstatSync(workspace).isDirectory() || path.parse(workspace).root === workspace)
        fail('Choose a specific project folder, not an entire disk.');
      workspace = realpathSync.native(workspace);
      // Capri credentials/runtime/history are never a coding workspace grant.
      const installation = existsSync(this.root) ? realpathSync.native(this.root) : this.root;
      if (inside(installation, workspace) || inside(workspace, installation))
        fail('Choose a project outside Capri’s installation and private data.');
    }
    if (
      value.editor &&
      (!IDE_KINDS.includes(value.editor.kind) ||
        !path.isAbsolute(value.editor.executable) ||
        !/\.exe$/i.test(value.editor.executable))
    )
      fail('Choose a supported editor executable.');
    if (value.editor) {
      assertPrivatePath(value.editor.executable);
      if (!lstatSync(value.editor.executable).isFile()) fail('Editor not found.');
    }
    if (!Array.isArray(value.tasks) || value.tasks.length > 12) fail('Too many project tasks.');
    const ids = new Set();
    for (const task of value.tasks) {
      if (
        !task ||
        Object.keys(task).some((key) => !['id', 'executable', 'args'].includes(key)) ||
        !/^[\w -]{1,60}$/.test(task.id) ||
        ids.has(task.id) ||
        !path.isAbsolute(task.executable) ||
        !/\.exe$/i.test(task.executable) ||
        !Array.isArray(task.args) ||
        task.args.length > 30 ||
        task.args.some(
          (arg) =>
            typeof arg !== 'string' ||
            arg.length > 2048 ||
            /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(arg),
        )
      )
        fail('Invalid approved project task.');
      assertPrivatePath(task.executable);
      if (!lstatSync(task.executable).isFile()) fail('Task executable not found.');
      if (
        /^(?:cmd|powershell|pwsh|wscript|cscript|mshta|rundll32|regsvr32)\.exe$/i.test(
          path.basename(task.executable),
        )
      )
        fail('Choose a build/test executable instead of a command shell.');
      ids.add(task.id);
    }
    if (value.bridge !== undefined && typeof value.bridge !== 'boolean')
      fail('Invalid editor bridge selection.');
    if (value.bridge && value.editor?.kind !== 'vscode')
      fail('The live editor bridge requires a VS Code-compatible editor.');
    if (value.reviewWrites !== undefined && typeof value.reviewWrites !== 'boolean')
      fail('Invalid coding review setting.');
    return {
      workspace,
      editor: value.editor ?? null,
      tasks: value.tasks,
      bridge: value.bridge === true && value.editor?.kind === 'vscode',
      reviewWrites: value.reviewWrites === true,
    };
  }
  save(value) {
    const config = this.validate(value);
    writePrivateBytesAtomic(this.file, Buffer.from(JSON.stringify(config, null, 2) + '\n'));
    this.buffers.clear();
    this.config = config;
    this.setMonitoring(this.monitorEnabled);
    return this.snapshot();
  }
  setMonitoring(enabled) {
    this.monitorEnabled = enabled === true && Boolean(this.config.workspace);
    let workspace = '';
    if (this.monitorEnabled) {
      try {
        workspace = this.resolve('');
      } catch {
        // Preserve the saved configuration so the user can reconnect to a moved project.
      }
    }
    this.monitor.start(workspace);
    return this.monitor.snapshot();
  }
  snapshot() {
    return {
      ...structuredClone(this.config),
      available: Boolean(this.config.workspace),
      monitor: this.monitor.snapshot(),
      capabilities: [
        'list',
        'read',
        'find',
        'search',
        'changes',
        'context',
        'edit',
        'create',
        'open',
        'run_task',
        'diagnostics',
      ],
    };
  }
  resolve(relative = '', { existing = true } = {}) {
    const base = this.config.workspace;
    if (!base) fail('Choose a project folder in Settings → Coding mode first.');
    assertPrivatePath(base);
    if (!lstatSync(base).isDirectory())
      fail('Choose a project folder in Settings → Coding mode first.');
    if (
      typeof relative !== 'string' ||
      relative.length > 2048 ||
      path.isAbsolute(relative) ||
      /[:\x00-\x1f]/.test(relative)
    )
      fail('Use a project-relative path.');
    const normal = projectRelative(relative);
    if (normal.split('/').some(privateProjectPart))
      fail('This project path is private or outside the coding scope.');
    const target = path.resolve(base, normal);
    if (!inside(base, target)) fail('This file is outside the project.');
    assertPrivatePath(target);
    if (!existsSync(target)) {
      if (existing) fail('Project file not found.');
    } else {
      const stat = lstatSync(target);
      if (stat.isFile() && stat.nlink !== 1) fail('Linked project files cannot be edited.');
      const canonical = realpathSync.native(target);
      if (
        !inside(base, canonical) ||
        projectRelative(path.relative(base, canonical)).split('/').some(privateProjectPart)
      )
        fail('This project path is private or outside the coding scope.');
    }
    return target;
  }
  read(relative) {
    if (typeof relative !== 'string' || !relative.trim())
      fail('Choose a project file, not the project root.');
    const file = this.resolve(relative),
      stat = lstatSync(file);
    if (!stat.isFile() || stat.size > maxFileBytes) fail('Choose a text file smaller than 512 KB.');
    const bytes = readFileSync(file);
    if (bytes.includes(0)) fail('Binary files cannot be read in coding mode.');
    let text;
    try {
      text = textDecoder.decode(bytes);
    } catch {
      fail(
        'Coding mode supports UTF-8 text files. Convert this file in your editor before editing.',
      );
    }
    return {
      path: relative,
      text,
      hash: hash(bytes),
      bom: bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
    };
  }
  list(relative = '', offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 50000)
      fail('Invalid project directory page.');
    const folder = this.resolve(relative);
    if (!lstatSync(folder).isDirectory()) fail('Choose a project directory.');
    const directory = opendirSync(folder);
    const entries = [];
    let remaining = offset;
    try {
      for (let row; (row = directory.readSync()); ) {
        if (privateProjectPart(row.name) || (!row.isFile() && !row.isDirectory())) continue;
        if (remaining > 0) {
          remaining--;
          continue;
        }
        if (entries.length === 200) return { path: relative, entries, nextOffset: offset + 200 };
        entries.push({ name: row.name, directory: row.isDirectory() });
      }
    } finally {
      directory.closeSync();
    }
    return { path: relative, entries };
  }

  async scan(relative, signal, maxFiles, visit) {
    const workspace = this.config.workspace;
    const resolve = (entry) => {
      if (workspace !== this.config.workspace)
        fail('The selected project changed. Retry the action.');
      return this.resolve(entry);
    };
    const result = await scanProjectFiles({
      workspace,
      root: resolve(relative),
      resolve,
      signal,
      maxFiles,
      visit: (entry) => visit(entry, resolve),
    });
    if (workspace !== this.config.workspace)
      fail('The selected project changed. Retry the action.');
    signal?.throwIfAborted();
    return result;
  }

  async find(query, relative = '', signal) {
    if (typeof query !== 'string' || !query.trim() || query.length > 160)
      fail('Enter part of a project file name or path.');
    const terms = projectRelative(query.trim()).toLowerCase().split(/\s+/);
    const matches = [];
    const scan = await this.scan(relative, signal, 12000, (entry, resolve) => {
      const name = entry.toLowerCase();
      if (terms.every((term) => name.includes(term))) {
        try {
          resolve(entry);
          matches.push({ path: entry });
        } catch {
          // A promising match may have been moved or replaced by a filesystem link.
        }
      }
      return matches.length >= 40;
    });
    return { matches, ...scan };
  }

  async search(query, relative = '', caseSensitive = true, signal) {
    if (typeof query !== 'string' || !query || query.length > 160)
      fail('Enter a short literal search string.');
    if (typeof caseSensitive !== 'boolean') fail('Invalid project search setting.');
    const matches = [];
    const needle = caseSensitive ? null : new RegExp(RegExp.escape(query), 'iu');
    const scan = await this.scan(relative, signal, 2400, async (entry, resolve) => {
      let handle;
      try {
        handle = await openFile(resolve(entry), 'r');
        const opened = await handle.stat();
        const current = lstatSync(resolve(entry));
        if (
          !opened.isFile() ||
          opened.nlink !== 1 ||
          opened.size > maxFileBytes ||
          opened.dev !== current.dev ||
          opened.ino !== current.ino
        )
          return false;
        const bytes = Buffer.allocUnsafe(opened.size + 1);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        const content = bytes.subarray(0, bytesRead);
        if (bytesRead > maxFileBytes || content.includes(0)) return false;
        textDecoder
          .decode(content)
          .split(lineEnding)
          .some((line, index) => {
            const match = needle ? line.search(needle) : line.indexOf(query);
            if (match !== -1) {
              const start = Math.max(0, match - 60);
              matches.push({
                path: entry,
                line: index + 1,
                column: match + 1,
                text: line.slice(start, start + 240),
              });
            }
            return matches.length >= 40;
          });
      } catch {
        // Skip binary, unreadable or replaced files without delaying other matches.
      } finally {
        await handle?.close().catch(() => {});
      }
      return matches.length >= 40;
    });
    return { matches, ...scan };
  }
  edit(relative, text, expectedHash, create = false) {
    if (typeof text !== 'string' || text.includes('\0') || Buffer.byteLength(text) > 512 * 1024)
      fail('Invalid project text.');
    const file = this.resolve(relative, { existing: !create });
    if (create) {
      try {
        writeFileSync(file, text, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (error.code === 'EEXIST')
          fail('This file already exists. Read it and use edit instead of create.');
        throw error;
      }
      return this.read(relative);
    }
    const before = this.read(relative);
    if (before.hash !== expectedHash)
      fail('The file changed. Read it again before editing; Capri will not overwrite newer work.');
    const temporary = file + '.capri-' + randomUUID() + '.tmp';
    try {
      writeFileSync(
        temporary,
        before.bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]) : text,
        { flag: 'wx', mode: lstatSync(file).mode },
      );
      if (this.read(relative).hash !== expectedHash)
        fail('The file changed during editing. Read it again.');
      renameSync(temporary, file);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    return this.read(relative);
  }
  async launchEditor(args) {
    const { editor, workspace } = this.config;
    if (!editor) fail('Choose an editor in Coding mode settings first.');
    assertPrivatePath(editor.executable);
    await new Promise((resolve, reject) => {
      const child = this.spawnImpl(editor.executable, args, {
        cwd: workspace,
        windowsHide: true,
        detached: false,
        stdio: 'ignore',
        env: cleanEnv(),
      });
      child.once('error', () => reject(Error('The selected editor could not be opened.')));
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
    return editor.kind;
  }

  async openProject() {
    const workspace = this.resolve('');
    const { editor } = this.config;
    if (!editor) fail('Choose an editor in Coding mode settings first.');
    await this.launchEditor(editorProjectArguments(editor.kind, workspace));
    return { opened: true, editor: editor.kind };
  }

  async open(relative, line = 1, column = 1) {
    const file = this.resolve(relative);
    const { editor } = this.config;
    if (!editor) fail('Choose an editor in Coding mode settings first.');
    await this.launchEditor(editorArguments(editor.kind, file, line, column));
    return {
      opened: true,
      path: relative,
      line,
      column,
      note: 'The CLI accepted the file. Unsaved editor buffers are not overwritten or inspected.',
    };
  }

  async activeContext(signal) {
    const { bridge, workspace } = this.config;
    if (!bridge || !workspace) return { active: null };
    try {
      const { active } =
        (await this.bridge.request(workspace, { action: 'context' }, signal)) ?? {};
      if (
        workspace === this.config.workspace &&
        this.config.bridge &&
        active &&
        typeof active.path === 'string' &&
        positive(active.line, 10000000) &&
        positive(active.column, 100000) &&
        typeof active.dirty === 'boolean' &&
        lstatSync(this.resolve(active.path)).isFile()
      )
        return {
          active: {
            path: projectRelative(active.path),
            line: active.line,
            column: active.column,
            dirty: active.dirty,
          },
        };
    } catch {
      // A missing, older, or temporarily disconnected editor can still use the saved project.
      signal?.throwIfAborted();
    }
    return { active: null };
  }

  async task(id, signal) {
    const task = this.config.tasks.find((row) => row.id === id);
    if (!task) fail('Only tasks explicitly approved in Coding mode settings may run.');
    this.resolve('');
    assertPrivatePath(task.executable);
    signal?.throwIfAborted();
    try {
      const result = await this.runImpl(task.executable, task.args, {
        cwd: this.config.workspace,
        env: cleanEnv(),
        windowsHide: true,
        shell: false,
        signal,
        timeout: 120000,
        maxBuffer: 256 * 1024,
        encoding: 'utf8',
      });
      return { id, exitCode: 0, output: (result.stdout + result.stderr).slice(-12000) };
    } catch (error) {
      signal?.throwIfAborted();
      return {
        id,
        exitCode: typeof error.code === 'number' ? error.code : null,
        failed: true,
        timedOut: Boolean(error.killed),
        output: String(error.stdout ?? '').slice(-10000) + String(error.stderr ?? '').slice(-2000),
      };
    }
  }
  async execute(args, signal) {
    if (
      !args ||
      Object.keys(args).some(
        (key) =>
          ![
            'action',
            'path',
            'text',
            'hash',
            'query',
            'task',
            'line',
            'column',
            'endLine',
            'caseSensitive',
            'offset',
          ].includes(key),
      )
    )
      fail('Invalid coding action.');
    signal?.throwIfAborted();
    if (this.config.bridge && ['read', 'edit', 'open', 'diagnostics'].includes(args.action)) {
      this.resolve(args.path);
      const previous = this.buffers.get(args.path);
      if (args.action === 'edit' && (!previous || previous.hash !== args.hash))
        fail('Read the current editor document before editing.');
      const request = args.action === 'read' ? { action: 'read', path: args.path } : args;
      const result = await this.bridge.request(
        this.config.workspace,
        { ...request, ...(args.action === 'edit' ? { version: previous.version } : {}) },
        signal,
      );
      if (result) {
        if (result.hash && Number.isInteger(result.version))
          this.buffers.set(args.path, { hash: result.hash, version: result.version });
        return args.action === 'read' ? rangedText(result, args.line, args.endLine) : result;
      }
      if (args.action !== 'open')
        fail(
          'The live editor bridge is not connected. Install it and open this project in the selected editor, or turn off the bridge to use saved files.',
        );
    }
    switch (args.action) {
      case 'status':
        return {
          workspace: Boolean(this.config.workspace),
          editor: this.config.editor?.kind ?? null,
          tasks: this.config.tasks.map((task) => task.id),
          monitor: { watching: Boolean(this.monitor.watcher), revision: this.monitor.revision },
        };
      case 'changes':
        return this.monitor.snapshot();
      case 'context':
        return this.activeContext(signal);
      case 'list':
        return this.list(args.path, args.offset);
      case 'read':
        return rangedText(this.read(args.path), args.line, args.endLine);
      case 'find':
        return this.find(args.query, args.path, signal);
      case 'search':
        return this.search(args.query, args.path, args.caseSensitive, signal);
      case 'edit':
        return this.edit(args.path, args.text, args.hash);
      case 'create':
        return this.edit(args.path, args.text, null, true);
      case 'open':
        return this.open(args.path, args.line, args.column);
      case 'run_task':
        return this.task(args.task, signal);
      case 'diagnostics':
        fail(
          'Live diagnostics require the editor bridge. You can also run an approved build/test task.',
        );
      default:
        fail('Unknown coding action.');
    }
  }
}
