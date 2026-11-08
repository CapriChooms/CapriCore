// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { nodePath } from '../packages/runtime/src/host/executables.mjs';
import {
  inspectOllamaBundle,
  requireOllamaBundle,
  OLLAMA_BACKEND_FILES,
} from '../packages/runtime/src/host/ollama-bundle.mjs';
const parent = path.join(root, '.runtime/runtime-integrity-unit');
mkdirSync(parent, { recursive: true });
const folder = () => mkdtempSync(path.join(parent, 'fixture-'));
test(
  'a surviving Ollama frontend cannot hide missing runtime dependencies',
  { skip: process.platform !== 'win32' },
  () => {
    const base = folder(),
      exe = path.join(base, 'ollama.exe');
    writeFileSync(exe, 'fixture');
    assert.equal(inspectOllamaBundle(exe, { bundled: true }).ready, false);
    assert.throws(
      () => requireOllamaBundle(exe),
      (error) =>
        error.code === 'CAPRI_OLLAMA_BUNDLE_INCOMPLETE' && /Capri Setup/.test(error.message),
    );
    for (const name of OLLAMA_BACKEND_FILES) {
      const file = path.join(base, 'lib/ollama', name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, 'fixture backend');
    }
    assert.equal(inspectOllamaBundle(exe, { bundled: true }).ready, true);
    writeFileSync(path.join(base, 'lib/ollama/libllama-server-impl.dll'), '');
    assert.deepEqual(inspectOllamaBundle(exe, { bundled: true }).missing, [
      'libllama-server-impl.dll',
    ]);
  },
);
const bundled = [
  process.execPath,
  nodePath,
  path.join(root, '.runtime/node-v24.22.1-win-x64/node.exe'),
].find(
  (exe) =>
    exe &&
    existsSync(
      path.join(path.dirname(exe), 'node_modules/npm/node_modules/@sigstore/tuf/dist/appdata.js'),
    ),
);
test(
  'native bootstrap detects and repairs the reported missing npm appdata module from its verified cache',
  { skip: process.platform !== 'win32' || !bundled, timeout: 120000 },
  () => {
    const base = folder(),
      source = path.join(base, 'source'),
      target = path.join(base, 'target'),
      runtime = 'node-v24.22.1-win-x64',
      node = path.join(target, '.runtime', runtime, 'node.exe');
    mkdirSync(path.dirname(node), { recursive: true });
    copyFileSync(bundled, node);
    cpSync(
      path.join(path.dirname(bundled), 'node_modules/npm'),
      path.join(path.dirname(node), 'node_modules/npm'),
      { recursive: true },
    );
    // BootstrapOnly still loads the worker's shared error/localization helpers.
    for (const name of ['worker.ps1', 'common.ps1', 'localization.ps1']) {
      const file = path.join(source, 'packages/installer/windows', name);
      mkdirSync(path.dirname(file), { recursive: true });
      copyFileSync(path.join(root, 'packages/installer/windows', name), file);
    }
    writeFileSync(path.join(source, 'package.json'), '{"version":"0.3.4"}');
    const canary = path.join(target, 'data/workspace/memory.md');
    mkdirSync(path.dirname(canary), { recursive: true });
    writeFileSync(canary, 'private canary');
    const script = path.join(base, 'fixture.ps1');
    writeFileSync(
      script,
      `param($Source,$Target,$Node,$Request,$Events,$Cancel)
. (Join-Path $Source 'packages/installer/windows/common.ps1')
$cache=Join-Path $Target '.runtime/installer';[IO.Directory]::CreateDirectory($cache)|Out-Null
$zip=Join-Path $cache 'healthy.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $Target '.runtime'),$zip)
`,
      'utf8',
    );
    // The archive must be outside the directory being compressed.
    writeFileSync(
      script,
      readFileSync(script, 'utf8').replace(
        "$zip=Join-Path $cache 'healthy.zip'",
        "$zip=Join-Path (Split-Path -Parent $Target) 'healthy.zip'",
      ) +
        `
$hash=Get-CapriHash $zip;$cached=Join-Path $cache ($hash+'.zip');Move-Item -LiteralPath $zip -Destination $cached
Write-CapriJson (Join-Path $Source 'config/installer.json') @{minimumWindowsBuild=19045;artifacts=@{node=@{directory='${runtime}';url='https://nodejs.org/dist/v24.22.1/node-v24.22.1-win-x64.zip';sha256=$hash;version='24.22.1';bytes=(Get-Item -LiteralPath $cached).Length}}}
Write-CapriJson (Join-Path $Target '.capri-install.json') @{schemaVersion=1;productId='capri.desktop';version='0.3.4';root=$Target;installId=[Guid]::NewGuid().ToString()}
Write-CapriJson (Join-Path $cache 'node.json') @{sha256=$hash;executableSha256=(Get-CapriHash $Node)}
Write-CapriJson $Request @{target=$Target;acceptLicense=$true;acceptDownloads=$true}
$broken=Join-Path (Split-Path -Parent $Node) 'node_modules/npm/node_modules/@sigstore/tuf/dist/appdata.js'
if(-not(Test-CapriNodeRuntime $Node)){throw 'Healthy native npm failed preflight'}
Remove-Item -LiteralPath $broken
if(Test-CapriNodeRuntime $Node){throw 'Missing npm dependency was accepted'}
& (Join-Path $Source 'packages/installer/windows/worker.ps1') -RequestFile $Request -EventsFile $Events -CancelFile $Cancel -BootstrapOnly
exit $LASTEXITCODE
`,
      'utf8',
    );
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        source,
        target,
        node,
        path.join(base, 'request.json'),
        path.join(base, 'events.jsonl'),
        path.join(base, 'cancel'),
      ],
      { windowsHide: true, encoding: 'utf8', timeout: 110000 },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(
      existsSync(
        path.join(
          path.dirname(node),
          'node_modules/npm/node_modules/@sigstore/tuf/dist/appdata.js',
        ),
      ),
      true,
    );
    assert.equal(readFileSync(canary, 'utf8'), 'private canary');
    assert.match(readFileSync(path.join(base, 'events.jsonl'), 'utf8'), /stage-complete/);
  },
);
