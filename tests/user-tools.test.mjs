import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  copyFileSync,
  cpSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { UserTools } from '../apps/desktop/user-tools.mjs';
import { toolManifest, validateToolArguments } from '../apps/desktop/tool-manifest.mjs';
const parent = path.resolve('.runtime/0.6.2/tool-tests');
mkdirSync(parent, { recursive: true });
// Native helpers grant runtime access to the AppContainer. Use owned copies so
// fresh checkouts work and tests never change permissions on the host runtimes.
const root = mkdtempSync(path.join(parent, 'suite-'));
const node = path.join(root, '.runtime/node', path.basename(process.execPath));
mkdirSync(path.dirname(node), { recursive: true });
copyFileSync(process.execPath, node);
mkdirSync(path.join(root, 'apps/desktop/native'), { recursive: true });
copyFileSync(
  path.resolve('apps/desktop/native/tool-sandbox.cs'),
  path.join(root, 'apps/desktop/native/tool-sandbox.cs'),
);
after(() => {
  const resolved = realpathSync(root);
  assert.equal(path.dirname(resolved), realpathSync(parent));
  assert.match(path.basename(resolved), /^suite-/);
  rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
function preparePythonRuntime() {
  const installed = path.resolve('.runtime/python');
  const candidates = existsSync(installed)
    ? readdirSync(installed)
        .filter((name) => /^cpython-3\.11\.\d+-windows-x86_64-none$/.test(name))
        .map((name) => path.join(installed, name, 'python.exe'))
    : [];
  if (process.env.pythonLocation)
    candidates.push(path.join(process.env.pythonLocation, 'python.exe'));
  candidates.push('python');
  for (const candidate of candidates) {
    let runtime;
    try {
      runtime = JSON.parse(
        execFileSync(
          candidate,
          [
            '-I',
            '-c',
            'import json,sys; print(json.dumps({"version": list(sys.version_info[:3]), "directory": sys.base_prefix}))',
          ],
          { encoding: 'utf8', windowsHide: true, timeout: 10000 },
        ),
      );
    } catch {
      continue;
    }
    if (runtime.version[0] !== 3 || runtime.version[1] !== 11) continue;
    cpSync(
      runtime.directory,
      path.join(
        root,
        '.runtime/python',
        `cpython-${runtime.version.join('.')}-windows-x86_64-none`,
      ),
      { recursive: true, errorOnExist: true, force: false },
    );
    return;
  }
  throw new Error('Python 3.11 is required for the native user-tool isolation test.');
}
const manifest = {
  version: 1,
  name: 'owned_tool',
  description: 'A synthetic test tool.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: { text: { type: 'string', maxLength: 100 } },
  },
  runtime: 'node',
  entry: 'main.mjs',
  permissions: { network: false, files: 'none' },
  timeoutMs: 1000,
};
const storage = {
  available: async () => true,
  encrypt: async (text) => Buffer.from(text).map((byte) => byte ^ 0xa5),
  decrypt: async (bytes) =>
    Buffer.from(bytes)
      .map((byte) => byte ^ 0xa5)
      .toString(),
};
function fixture(runner) {
  const data = mkdtempSync(path.join(root, 'case-')),
    state = path.join(data, 'state');
  mkdirSync(state);
  return new UserTools({
    root,
    data,
    state,
    node,
    storage,
    runner,
  });
}
async function install(tools, value = manifest, code = 'console.log("{}")') {
  await tools.ready;
  const folder = path.join(tools.folder, 'example');
  mkdirSync(folder);
  writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(value));
  writeFileSync(path.join(folder, 'main.mjs'), code);
  await tools.refresh();
}
test('tools never run on discovery, validate arguments, bind approval to all code and keep settings away from model definitions', async () => {
  let calls = 0;
  const tools = fixture(async ({ parameters, settings }) => {
    calls++;
    return { text: parameters.text, echo: settings.apiKey };
  });
  try {
    await install(tools);
    assert.equal(calls, 0);
    await assert.rejects(tools.run('example', {}));
    await tools.enable('example', true);
    await tools.saveSettings('example', { apiKey: 'synthetic-private-api-value' });
    assert(!readFileSync(tools.publicFile, 'utf8').includes('synthetic-private'));
    assert(!readFileSync(tools.secretFile, 'utf8').includes('synthetic-private'));
    assert.deepEqual(await tools.run('example', { text: 'hello' }), {
      text: 'hello',
      echo: '[redacted]',
    });
    await assert.rejects(tools.run('example', { unknown: 'x' }));
    writeFileSync(path.join(tools.folder, 'example/main.mjs'), 'console.log("changed")');
    await assert.rejects(tools.run('example', {}), /code changed/);
    assert.equal(calls, 1);
  } finally {
    tools.close();
  }
});
test('context scripts only run on matching keywords, cache output and are disabled after code changes', async () => {
  let calls = 0;
  const tools = fixture(async () => {
    calls++;
    return { weather: 'sunny' };
  });
  try {
    await install(tools, {
      ...manifest,
      mode: 'context',
      keywords: ['forecast'],
      cacheSeconds: 30,
    });
    await tools.enable('example', true);
    assert.equal(await tools.context('hello'), '');
    assert.equal(calls, 0);
    assert.match(await tools.context('forecast please'), /sunny/);
    await tools.context('forecast again');
    assert.equal(calls, 1);
    writeFileSync(path.join(tools.folder, 'example/main.mjs'), 'changed');
    await tools.refresh();
    assert.equal(await tools.context('forecast'), '');
  } finally {
    tools.close();
  }
});
test('unsupported schemas, shell commands and prototype-like parameters are rejected', () => {
  assert.throws(() => toolManifest({ ...manifest, command: 'cmd /c echo x' }));
  assert.throws(() =>
    toolManifest({ ...manifest, parameters: { $ref: 'https://untrusted.invalid' } }),
  );
  assert.throws(() => validateToolArguments(JSON.parse('{"__proto__":"x"}'), manifest.parameters));
});
test(
  'real Windows AppContainer denies owner files, removes inherited secrets and redacts approved settings',
  { skip: process.platform !== 'win32' },
  async () => {
    const tools = fixture();
    const secretFile = path.join(tools.data, 'owner-secret.txt');
    writeFileSync(secretFile, 'synthetic-owned-document');
    try {
      const code = `import fs from 'node:fs';let text='';for await(const c of process.stdin)text+=c;const input=JSON.parse(text);let denied=false;try{fs.readFileSync(${JSON.stringify(secretFile)});}catch{denied=true;}console.log(JSON.stringify({denied,echo:input.settings.apiKey,leakedEnvironment:!!process.env.CAPRI_SYNTHETIC_TEST_SECRET}));`;
      await install(tools, { ...manifest, timeoutMs: 10000 }, code);
      await tools.enable('example', true);
      await tools.saveSettings('example', { apiKey: 'synthetic-isolated-api-value' });
      process.env.CAPRI_SYNTHETIC_TEST_SECRET = 'synthetic-env-value';
      const result = await tools.run('example', {});
      assert.deepEqual(result, { denied: true, echo: '[redacted]', leakedEnvironment: false });
      assert(
        !readdirSync(tools.runRoot).some(
          (name) =>
            name.startsWith('run-') && existsSync(path.join(tools.runRoot, name, 'code/main.mjs')),
        ),
      );
    } finally {
      delete process.env.CAPRI_SYNTHETIC_TEST_SECRET;
      tools.close();
    }
  },
);
test(
  'Python and native executable tools run inside the same guarded Windows path',
  { skip: process.platform !== 'win32' },
  async () => {
    preparePythonRuntime();
    const python = fixture(),
      native = fixture();
    try {
      await install(python, { ...manifest, runtime: 'python', entry: 'main.py', timeoutMs: 10000 });
      writeFileSync(
        path.join(python.folder, 'example/main.py'),
        'import json,sys\nvalue=json.load(sys.stdin)\nprint(json.dumps({"runtime":"python","echo":value["parameters"].get("text")}))\n',
      );
      await python.refresh();
      await python.enable('example', true);
      assert.deepEqual(await python.run('example', { text: 'Привет' }), {
        runtime: 'python',
        echo: 'Привет',
      });
      await install(native, {
        ...manifest,
        runtime: 'executable',
        entry: 'main.exe',
        timeoutMs: 10000,
      });
      const source = path.join(native.folder, 'example/main.cs'),
        exe = path.join(native.folder, 'example/main.exe');
      writeFileSync(
        source,
        'using System;class OwnedTool{static void Main(){Console.ReadLine();Console.WriteLine("{\\\"runtime\\\":\\\"executable\\\"}");}}',
      );
      execFileSync(
        path.join(
          process.env.SystemRoot ?? 'C:\\Windows',
          'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
        ),
        ['/nologo', '/target:exe', '/out:' + exe, source],
        { windowsHide: true, env: { ...process.env, TEMP: native.folder, TMP: native.folder } },
      );
      await native.refresh();
      await native.enable('example', true);
      assert.deepEqual(await native.run('example', {}), { runtime: 'executable' });
    } finally {
      python.close();
      native.close();
    }
  },
);
test(
  'isolated tools cannot use a denied network and terminate on timeout or cancellation',
  { skip: process.platform !== 'win32' },
  async () => {
    const tools = fixture();
    try {
      const code =
        "import net from 'node:net'; const socket=net.connect({host:'1.1.1.1',port:443}); socket.on('connect',()=>{console.log(JSON.stringify({denied:false}));socket.destroy();});socket.on('error',()=>console.log(JSON.stringify({denied:true})));socket.setTimeout(1500,()=>{socket.destroy();console.log(JSON.stringify({denied:true}));});";
      await install(tools, { ...manifest, timeoutMs: 5000 }, code);
      await tools.enable('example', true);
      assert.equal((await tools.run('example', {})).denied, true);
      writeFileSync(path.join(tools.folder, 'example/main.mjs'), 'setInterval(()=>{},1000);');
      writeFileSync(
        path.join(tools.folder, 'example/manifest.json'),
        JSON.stringify({ ...manifest, timeoutMs: 200 }),
      );
      await tools.refresh();
      await tools.enable('example', true);
      await assert.rejects(tools.run('example', {}), /failed|timed out/);
      writeFileSync(
        path.join(tools.folder, 'example/manifest.json'),
        JSON.stringify({ ...manifest, timeoutMs: 10000 }),
      );
      await tools.refresh();
      await tools.enable('example', true);
      const controller = new AbortController(),
        pending = tools.run('example', {}, controller.signal);
      setTimeout(() => controller.abort(), 700);
      await assert.rejects(
        pending,
        (error) =>
          (controller.signal.aborted && error.name === 'AbortError') ||
          /cancelled|timed out/.test(error.message),
      );
      assert.equal(controller.signal.aborted, true);
      assert.equal(tools.active.size, 0);
    } finally {
      tools.close();
    }
  },
);
