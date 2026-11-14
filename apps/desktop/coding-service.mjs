// SPDX-License-Identifier: GPL-3.0-only
import {
  existsSync,
  lstatSync,
  realpathSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
} from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { CodingEditorBridge } from './coding-editor-bridge.mjs';
import {
  assertPrivatePath,
  writePrivateBytesAtomic,
} from '../../packages/runtime/src/safe-file.mjs';

const run = promisify(execFile),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const denied =
  /^(?:\.git|\.svn|node_modules|\.venv|venv|\.ssh|\.aws|\.azure|\.capri|\.env(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|pfx|p12|key))$/i;
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

/** A separate project grant, never an implicit extension of desktop/full access. */
export class CodingService {
  constructor({ root, runImpl = run, spawnImpl = spawn, bridge = new CodingEditorBridge() }) {
    Object.assign(this, { root, runImpl, spawnImpl, bridge });
    this.buffers = new Map();
    this.file = path.join(root, 'data/desktop/coding.json');
    assertPrivatePath(this.file);
    this.config = { workspace: '', editor: null, tasks: [], bridge: false };
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
      Object.keys(value).some((key) => !['workspace', 'editor', 'tasks', 'bridge'].includes(key))
    )
      fail('Invalid coding settings.');
    if (typeof value.workspace !== 'string' || value.workspace.length > 2048)
      fail('Choose a project folder.');
    if (value.workspace) {
      assertPrivatePath(value.workspace);
      if (
        !path.isAbsolute(value.workspace) ||
        !lstatSync(value.workspace).isDirectory() ||
        path.parse(value.workspace).root === value.workspace
      )
        fail('Choose a specific project folder, not an entire disk.');
      // Capri credentials/runtime/history are never a coding workspace grant.
      if (inside(this.root, value.workspace) || inside(value.workspace, this.root))
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
    return {
      workspace: value.workspace ? realpathSync(value.workspace) : '',
      editor: value.editor ?? null,
      tasks: value.tasks,
      bridge: value.bridge === true && value.editor?.kind === 'vscode',
    };
  }
  save(value) {
    this.buffers.clear();
    this.config = this.validate(value);
    writePrivateBytesAtomic(this.file, Buffer.from(JSON.stringify(this.config, null, 2) + '\n'));
    return this.snapshot();
  }
  snapshot() {
    return {
      ...structuredClone(this.config),
      available: Boolean(this.config.workspace),
      capabilities: ['list', 'read', 'search', 'edit', 'create', 'open', 'run_task', 'diagnostics'],
    };
  }
  resolve(relative = '', { existing = true } = {}) {
    const base = this.config.workspace;
    if (!base) fail('Choose a project folder in Settings → Coding mode first.');
    assertPrivatePath(base);
    if (
      typeof relative !== 'string' ||
      relative.length > 2048 ||
      path.isAbsolute(relative) ||
      /[:\x00-\x1f]/.test(relative)
    )
      fail('Use a project-relative path.');
    const parts = relative.split(/[\\/]/);
    if (parts.some((part) => part === '..' || denied.test(part)))
      fail('This project path is private or outside the coding scope.');
    const target = path.resolve(base, relative);
    if (!inside(base, target)) fail('This file is outside the project.');
    assertPrivatePath(target);
    if (existing && (!existsSync(target) || !inside(base, realpathSync(target))))
      fail('Project file not found.');
    if (existsSync(target) && lstatSync(target).isFile() && lstatSync(target).nlink !== 1)
      fail('Linked project files cannot be edited.');
    return target;
  }
  read(relative) {
    if (typeof relative !== 'string' || !relative.trim())
      fail('Choose a project file, not the project root.');
    const file = this.resolve(relative),
      stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 512 * 1024) fail('Choose a text file smaller than 512 KB.');
    const bytes = readFileSync(file);
    if (bytes.includes(0)) fail('Binary files cannot be read in coding mode.');
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
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
  list(relative = '') {
    const folder = this.resolve(relative);
    if (!lstatSync(folder).isDirectory()) fail('Choose a project directory.');
    const rows = readdirSync(folder, { withFileTypes: true })
      .filter((row) => !denied.test(row.name) && !row.isSymbolicLink())
      .slice(0, 200);
    return {
      path: relative,
      entries: rows.map((row) => ({ name: row.name, directory: row.isDirectory() })),
    };
  }
  search(query, relative = '') {
    if (typeof query !== 'string' || !query || query.length > 160)
      fail('Enter a short literal search string.');
    const matches = [];
    let scanned = 0;
    const visit = (directory, depth) => {
      if (depth > 6 || scanned >= 300 || matches.length >= 40) return;
      for (const row of this.list(directory).entries) {
        const name = path.join(directory, row.name);
        if (row.directory) visit(name, depth + 1);
        else {
          scanned++;
          try {
            const value = this.read(name);
            value.text.split(/\r?\n/).some((line, index) => {
              if (line.includes(query))
                matches.push({ path: name, line: index + 1, text: line.slice(0, 240) });
              return matches.length >= 40;
            });
          } catch {
            /* Skip binary/large/linked files. */
          }
        }
        if (scanned >= 300 || matches.length >= 40) break;
      }
    };
    visit(relative, 0);
    return { matches, scanned, limited: scanned >= 300 || matches.length >= 40 };
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
  async open(relative, line = 1, column = 1) {
    const file = this.resolve(relative),
      editor = this.config.editor;
    if (!editor) fail('Choose an editor in Coding mode settings first.');
    assertPrivatePath(editor.executable);
    const args = editorArguments(editor.kind, file, line, column);
    await new Promise((resolve, reject) => {
      const child = this.spawnImpl(editor.executable, args, {
        cwd: this.config.workspace,
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
    return {
      opened: true,
      path: relative,
      line,
      column,
      note: 'The CLI accepted the file. Unsaved editor buffers are not overwritten or inspected.',
    };
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
          !['action', 'path', 'text', 'hash', 'query', 'task', 'line', 'column'].includes(key),
      )
    )
      fail('Invalid coding action.');
    signal?.throwIfAborted();
    if (this.config.bridge && ['read', 'edit', 'open', 'diagnostics'].includes(args.action)) {
      this.resolve(args.path);
      const previous = this.buffers.get(args.path);
      if (args.action === 'edit' && (!previous || previous.hash !== args.hash))
        fail('Read the current editor document before editing.');
      const result = await this.bridge.request(
        this.config.workspace,
        { ...args, ...(args.action === 'edit' ? { version: previous.version } : {}) },
        signal,
      );
      if (result) {
        if (result.hash && Number.isInteger(result.version))
          this.buffers.set(args.path, { hash: result.hash, version: result.version });
        return result;
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
        };
      case 'list':
        return this.list(args.path);
      case 'read':
        return this.read(args.path);
      case 'search':
        return this.search(args.query, args.path);
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
