// SPDX-License-Identifier: GPL-3.0-only
// Actual PowerShell -> owned Node -> verified cached ZIP -> guarded extraction.
// The ZIP contains only an owned stub, never a downloaded executable or model.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { root } from '../packages/runtime/src/host/paths.mjs';
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
const manifest = JSON.parse(readFileSync(path.join(root, 'config/installer.json'), 'utf8'));
test(
  'a missing private uv is restored by bundled Node; no Node gives an actionable Setup repair error',
  // Cold Windows CI runners can spend over 45s in one guarded native repair.
  // Keep each phase bounded and the parent consistent with all three phases.
  { skip: process.platform !== 'win32', timeout: 285000 },
  () => {
    const parent = path.join(root, '.runtime/uv-bootstrap-tests');
    mkdirSync(parent, { recursive: true });
    const folder = mkdtempSync(path.join(parent, 'case-')),
      project = path.join(folder, 'новая Капри'),
      pathProject = path.join(folder, 'PATH Node');
    mkdirSync(project);
    mkdirSync(pathProject);
    const ps = (file, code) => {
      writeFileSync(file, '\uFEFF' + code, 'utf8');
      const started = performance.now();
      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
        { encoding: 'utf8', windowsHide: true, timeout: 90000 },
      );
      assert.equal(
        result.status,
        0,
        JSON.stringify({
          phase: path.basename(file),
          elapsedMs: Math.round(performance.now() - started),
          status: result.status,
          signal: result.signal,
          error: result.error?.code,
        }) +
          '\n' +
          result.stdout +
          result.stderr,
      );
    };
    const payload = path.join(folder, 'payload'),
      archive = path.join(folder, 'fixture.zip');
    mkdirSync(payload);
    ps(
      path.join(folder, 'build.ps1'),
      `$ErrorActionPreference='Stop'
Add-Type -OutputAssembly ${literal(path.join(payload, 'uv.exe'))} -OutputType ConsoleApplication -TypeDefinition @'
using System;using System.IO;using System.Linq;using System.Diagnostics;
public class OwnedUvBootstrapFixture {
  public static int Main(string[] args) {
    string self=Process.GetCurrentProcess().MainModule.FileName;
    if(Path.GetFileName(self).Equals("python.exe",StringComparison.OrdinalIgnoreCase)){Console.WriteLine("Python 3.11.17");return 0;}
    if(args.Length<2||args[0]!="python"||args[1]!="install")return 41;
    if(!args.Contains("--no-bin")||!args.Contains("--no-registry")||!args.Contains("--no-config"))return 42;
    if(Environment.GetEnvironmentVariable("UV_PYTHON_INSTALL_BIN")!="0"||Environment.GetEnvironmentVariable("UV_PYTHON_INSTALL_REGISTRY")!="0"||Environment.GetEnvironmentVariable("UV_PYTHON_NO_REGISTRY")!="1")return 43;
    string key="cpython-3.11.17-windows-x86_64-none";if(!args.Contains(key))return 44;
    string python=Path.Combine(Environment.GetEnvironmentVariable("UV_PYTHON_INSTALL_DIR"),key,"python.exe");Directory.CreateDirectory(Path.GetDirectoryName(python));File.Copy(self,python);
    File.AppendAllText(Environment.GetEnvironmentVariable("CAPRI_UV_FIXTURE_LOG"),"installed\\n");return 0;
  }
}
'@
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory(${literal(payload)},${literal(archive)})
`,
    );
    const bytes = readFileSync(archive),
      sha256 = createHash('sha256').update(bytes).digest('hex');
    const configured = {
      ...manifest,
      artifacts: {
        ...manifest.artifacts,
        uv: { ...manifest.artifacts.uv, sha256, bytes: bytes.length },
      },
    };
    for (const target of [project, pathProject]) {
      mkdirSync(path.join(target, 'config'));
      writeFileSync(path.join(target, 'config/installer.json'), JSON.stringify(configured));
      const cache = path.join(target, '.runtime/installer/downloads');
      mkdirSync(cache, { recursive: true });
      copyFileSync(archive, path.join(cache, sha256 + '.zip'));
      for (const name of [
        'tools/setup/owned-speech.ps1',
        'packages/installer/windows/archive.ps1',
        'packages/installer/windows/common.ps1',
        'packages/installer/windows/speech-owner.cs',
      ]) {
        const file = path.join(target, name);
        mkdirSync(path.dirname(file), { recursive: true });
        copyFileSync(path.join(root, name), file);
      }
    }
    const node = path.join(project, '.runtime', manifest.artifacts.node.directory, 'node.exe');
    mkdirSync(path.dirname(node), { recursive: true });
    copyFileSync(process.execPath, node);
    ps(
      path.join(folder, 'verify-bundled-node.ps1'),
      `$ErrorActionPreference='Stop'
. ${literal(path.join(root, 'tools/setup/python-runtime.ps1'))}
$project=${literal(project)}
$env:PATH=(Join-Path $env:SystemRoot 'System32')+';'+(Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0')
$env:CAPRI_UV_FIXTURE_LOG=${literal(path.join(folder, 'install.log'))}
if(Get-Command uv.exe -CommandType Application -ErrorAction SilentlyContinue){throw 'A foreign uv is visible in the isolated fixture.'}
if(Test-Path -LiteralPath (Join-Path $project '.runtime/uv/uv.exe')){throw 'uv must be missing before repair.'}
$value=Get-CapriPythonRuntime -ProjectRoot $project
if($value -isnot [hashtable]){throw 'Repair progress polluted the runtime return value.'}
if($value.Uv -ne (Join-Path $project '.runtime/uv/uv.exe')){throw 'The repaired uv is outside the installation.'}
if(-not(Test-Path -LiteralPath $value.Python)){throw 'The stub Python runtime was not prepared.'}
if(-not(Test-Path -LiteralPath (Join-Path $project '.runtime/installer/uv.json'))){throw 'No verified uv receipt.'}
$second=Get-CapriPythonRuntime -ProjectRoot $project
if($second.Python -ne $value.Python){throw 'Healthy runtime was replaced.'}
if([IO.File]::ReadAllLines($env:CAPRI_UV_FIXTURE_LOG).Count -ne 1){throw 'Runtime was installed twice.'}
[IO.File]::WriteAllText(${literal(path.join(folder, 'bundled-result.json'))},'{"restoredUv":true,"reusedPython":true,"noModels":true}')
`,
    );
    assert.deepEqual(JSON.parse(readFileSync(path.join(folder, 'bundled-result.json'), 'utf8')), {
      restoredUv: true,
      reusedPython: true,
      noModels: true,
    });
    // Do not make a cold runner fit both complete Node -> PowerShell ->
    // owner-guard compilation/extraction chains into one command's deadline.
    ps(
      path.join(folder, 'verify-path-node.ps1'),
      `$ErrorActionPreference='Stop'
. ${literal(path.join(root, 'tools/setup/python-runtime.ps1'))}
$env:PATH=(Join-Path $env:SystemRoot 'System32')+';'+(Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0')
$env:CAPRI_UV_FIXTURE_LOG=${literal(path.join(folder, 'install.log'))}
$capriFixtureMinimalPath=$env:PATH
$env:PATH+=';'+${literal(path.dirname(process.execPath))}
$pathValue=Get-CapriPythonRuntime -ProjectRoot ${literal(pathProject)}
if($pathValue -isnot [hashtable]){throw 'PATH repair progress polluted the runtime return value.'}
if($pathValue.Uv -ne ${literal(path.join(pathProject, '.runtime/uv/uv.exe'))}){throw 'PATH Node did not repair the owned uv.'}
$env:PATH=$capriFixtureMinimalPath
$missing=Join-Path ${literal(folder)} 'no-node'
[IO.Directory]::CreateDirectory($missing)|Out-Null
try{Get-CapriPythonRuntime -ProjectRoot $missing;throw 'Missing Node was accepted.'}catch{if($_.Exception.Message -notmatch 'Run Capri Setup to repair'){throw}}
[IO.File]::WriteAllText(${literal(path.join(folder, 'path-result.json'))},'{"pathNode":true,"noNodeRepairMessage":true}')
`,
    );
    assert.deepEqual(JSON.parse(readFileSync(path.join(folder, 'path-result.json'), 'utf8')), {
      pathNode: true,
      noNodeRepairMessage: true,
    });
    assert(!existsSync(path.join(project, 'data')));
    assert(!existsSync(path.join(project, '.runtime/installer/install.lock.json')));
    assert(!existsSync(path.join(pathProject, 'data')));
    assert(!existsSync(path.join(pathProject, '.runtime/installer/install.lock.json')));
  },
);
