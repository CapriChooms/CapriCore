// SPDX-License-Identifier: GPL-3.0-only
const vscode = require('vscode');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
let server, token, rendezvous;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return (
    !relative ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
};
const privateName =
  /^(?:\.git|\.svn|node_modules|\.venv|venv|\.ssh|\.aws|\.azure|\.capri|\.env(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|pfx|p12|key))$/i;
function localPath(value) {
  if (
    !value ||
    typeof value.workspace !== 'string' ||
    typeof value.path !== 'string' ||
    path.isAbsolute(value.path) ||
    /[:\x00-\x1f]/.test(value.path) ||
    value.path.split(/[\\/]/).some((part) => part === '..' || privateName.test(part))
  )
    throw Error('invalid_scope');
  const root = fs.realpathSync(value.workspace);
  if (
    !(vscode.workspace.workspaceFolders ?? []).some(
      (folder) =>
        folder.uri.scheme === 'file' &&
        fs.realpathSync(folder.uri.fsPath).toLowerCase() === root.toLowerCase(),
    )
  )
    throw Error('workspace_not_open');
  const file = path.resolve(root, value.path);
  if (!inside(root, file)) throw Error('invalid_scope');
  let cursor = file;
  while (cursor) {
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw Error('linked_path');
    if (stat.isFile() && stat.nlink !== 1) throw Error('linked_file');
    if (cursor === root) break;
    cursor = path.dirname(cursor);
  }
  return file;
}
async function action(value) {
  if (!vscode.workspace.isTrusted) throw Error('workspace_not_trusted');
  const file = localPath(value),
    uri = vscode.Uri.file(file);
  if (value.action === 'diagnostics')
    return {
      diagnostics: vscode.languages
        .getDiagnostics(uri)
        .slice(0, 100)
        .map((item) => ({
          line: item.range.start.line + 1,
          column: item.range.start.character + 1,
          severity: item.severity,
          message: item.message.slice(0, 1000),
        })),
    };
  const document = await vscode.workspace.openTextDocument(uri);
  if (document.getText().length > 512 * 1024) throw Error('document_too_large');
  if (value.action === 'read')
    return {
      path: value.path,
      text: document.getText(),
      hash: hash(document.getText()),
      version: document.version,
      dirty: document.isDirty,
      editorBuffer: true,
    };
  if (value.action === 'open') {
    const line = Math.max(0, Math.min(document.lineCount - 1, Number(value.line ?? 1) - 1));
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });
    const position = new vscode.Position(
      line,
      Math.max(0, Math.min(document.lineAt(line).text.length, Number(value.column ?? 1) - 1)),
    );
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
    return { opened: true, path: value.path };
  }
  if (value.action === 'edit') {
    if (document.isDirty) throw Error('save_unsaved_buffer_first');
    if (document.version !== value.version || hash(document.getText()) !== value.hash)
      throw Error('document_changed');
    if (
      typeof value.text !== 'string' ||
      value.text.length > 512 * 1024 ||
      value.text.includes('\0')
    )
      throw Error('invalid_text');
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      uri,
      new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
      value.text,
    );
    if (!(await vscode.workspace.applyEdit(edit)) || !(await document.save()))
      throw Error('edit_not_saved');
    return {
      path: value.path,
      text: document.getText(),
      hash: hash(document.getText()),
      version: document.version,
      dirty: document.isDirty,
      editorBuffer: true,
    };
  }
  throw Error('unsupported_action');
}
function activate(context) {
  if (!vscode.workspace.isTrusted || !process.env.LOCALAPPDATA) return;
  const directory = path.join(process.env.LOCALAPPDATA, 'Capri', 'CodingBridge');
  fs.mkdirSync(directory, { recursive: true });
  if (fs.lstatSync(directory).isSymbolicLink()) return;
  token = randomBytes(32).toString('hex');
  rendezvous = path.join(directory, `${process.pid}-${randomBytes(6).toString('hex')}.json`);
  server = http.createServer(async (request, response) => {
    const deny = () => {
      response.writeHead(403);
      response.end();
    };
    const actual = Buffer.from(request.headers.authorization ?? ''),
      expected = Buffer.from('Bearer ' + token);
    if (
      request.method !== 'POST' ||
      request.url !== '/project' ||
      request.headers.origin ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      return deny();
    let bytes = 0,
      chunks = [];
    try {
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) throw Error('input_limit');
        chunks.push(chunk);
      }
      const result = await action(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify(result));
    } catch (error) {
      const code = /^[a-z_]{1,60}$/.test(error.message) ? error.message : 'editor_operation_failed';
      response.writeHead(409, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: code }));
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxConnections = 4;
  server.listen(0, '127.0.0.1', () => {
    fs.writeFileSync(
      rendezvous,
      JSON.stringify({
        protocol: 1,
        pid: process.pid,
        port: server.address().port,
        token,
        workspaces: (vscode.workspace.workspaceFolders ?? [])
          .filter((folder) => folder.uri.scheme === 'file')
          .map((folder) => folder.uri.fsPath),
      }),
      { flag: 'wx', mode: 0o600 },
    );
  });
  context.subscriptions.push({ dispose: deactivate });
}
function deactivate() {
  server?.close();
  server = null;
  if (rendezvous) {
    try {
      if (JSON.parse(fs.readFileSync(rendezvous, 'utf8')).token === token)
        fs.unlinkSync(rendezvous);
    } catch {}
  }
  rendezvous = token = null;
}
module.exports = { activate, deactivate };
