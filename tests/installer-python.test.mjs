// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from '../packages/runtime/src/host/paths.mjs';

test(
  'Python bootstrap uses the owned runtime and lets uv detect CPU capabilities',
  { skip: process.platform !== 'win32' },
  () => {
    const parent = path.join(root, '.runtime/installer-python-tests');
    mkdirSync(parent, { recursive: true });
    const session = mkdtempSync(path.join(parent, 'case-'));
    const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
    const script = path.join(session, 'verify.ps1');
    writeFileSync(
      script,
      '\uFEFF' +
        `$ErrorActionPreference='Stop'
. ${literal(path.join(root, 'tools/setup/python-runtime.ps1'))}
$hidden=Join-Path ${literal(session)} 'user profile/AppData'
$project=Join-Path $hidden 'Local/Programs/новая Капри'
$uv=Join-Path $project '.runtime/uv/uv.exe'
[IO.Directory]::CreateDirectory((Split-Path -Parent $uv))|Out-Null
[IO.File]::SetAttributes($hidden,([IO.File]::GetAttributes($hidden) -bor [IO.FileAttributes]::Hidden))
if(-not (Test-Path -LiteralPath $hidden)){throw 'Hidden AppData fixture is unavailable.'}
$outside=Join-Path ${literal(session)} 'unrelated-bin'
[IO.Directory]::CreateDirectory($outside)|Out-Null
$existing=Join-Path $outside 'python3.11.exe'
[IO.File]::WriteAllText($existing,'unmanaged executable canary')
$env:UV_PYTHON_BIN_DIR=$outside
$env:UV_PYTHON_INSTALL_DIR=Join-Path ${literal(session)} 'inherited-outside-python'
$env:OPENSSL_ia32cap='0x200000:0x0'
$env:CAPRI_PYTHON_FIXTURE_LOG=Join-Path ${literal(session)} 'install.log'
Add-Type -OutputAssembly $uv -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.IO;
using System.Linq;
using System.Diagnostics;
public class PythonBootstrapFixture {
  public static int Main(string[] args) {
    if(Environment.GetEnvironmentVariable("OPENSSL_ia32cap")!=null) {
      Console.Error.WriteLine("Fatal Error: HW capability found: 0x178BFBFF 0xBED8320B, but HW capability requested: 0x200000 0x00.");
      return 46;
    }
    string self=Process.GetCurrentProcess().MainModule.FileName;
    if(Path.GetFileName(self).Equals("python.exe",StringComparison.OrdinalIgnoreCase)) {
      Console.WriteLine(Environment.GetEnvironmentVariable("CAPRI_PYTHON_FIXTURE_VERSION")??"Python 3.11.17");return 0;
    }
    if(args.Length<2 || args[0]!="python" || args[1]!="install") return 41;
    if(!args.Contains("--no-bin") || !args.Contains("--no-registry") || !args.Contains("--no-config")) return 42;
    if(Environment.GetEnvironmentVariable("UV_PYTHON_INSTALL_BIN")!="0" || Environment.GetEnvironmentVariable("UV_PYTHON_INSTALL_REGISTRY")!="0" || Environment.GetEnvironmentVariable("UV_PYTHON_NO_REGISTRY")!="1") return 43;
    string install=Environment.GetEnvironmentVariable("UV_PYTHON_INSTALL_DIR");
    string expected=Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(self)),"python");
    if(install!=expected) return 44;
    if(Environment.GetEnvironmentVariable("CAPRI_PYTHON_FIXTURE_FAIL")=="1") return 17;
    string key="cpython-3.11.17-windows-x86_64-none";
    if(!args.Contains(key)) return 45;
    string python=Path.Combine(install,key,"python.exe");
    Directory.CreateDirectory(Path.GetDirectoryName(python));File.Copy(self,python);
    File.AppendAllText(Environment.GetEnvironmentVariable("CAPRI_PYTHON_FIXTURE_LOG"),"installed\\n");return 0;
  }
}
'@
$first=Get-CapriPythonRuntime -ProjectRoot $project
if($first.Uv -ne $uv -or -not $first.Python.StartsWith($project+'\\')){throw 'A foreign runtime was selected.'}
$again=Get-CapriPythonRuntime -ProjectRoot $project
if($again.Python -ne $first.Python){throw 'The installed interpreter was not reused.'}
if([IO.File]::ReadAllLines($env:CAPRI_PYTHON_FIXTURE_LOG).Count -ne 1){throw 'Python was installed more than once.'}
if([IO.File]::ReadAllText($existing) -ne 'unmanaged executable canary'){throw 'An unrelated Python shortcut was modified.'}
if(-not ([IO.File]::GetAttributes($hidden) -band [IO.FileAttributes]::Hidden)){throw 'Hidden AppData attributes were changed.'}
if(Test-Path -LiteralPath (Join-Path ${literal(session)} 'inherited-outside-python')){throw 'An inherited global installation directory was used.'}
$env:CAPRI_PYTHON_FIXTURE_VERSION='Python 3.12.0'
try{Get-CapriPythonRuntime -ProjectRoot $project;throw 'Wrong Python version was accepted'}catch{if($_.Exception.Message -notmatch 'does not match pinned'){throw}}
Remove-Item Env:CAPRI_PYTHON_FIXTURE_VERSION
$linked=Join-Path ${literal(session)} 'linked-project'
[IO.Directory]::CreateDirectory((Join-Path $linked '.runtime'))|Out-Null
New-Item -ItemType Junction -Path (Join-Path $linked '.runtime/uv') -Target (Split-Path -Parent $uv)|Out-Null
try{Get-CapriPythonRuntime -ProjectRoot $linked;throw 'Filesystem junction was accepted'}catch{if($_.Exception.Message -notmatch 'cannot contain filesystem links'){throw}}
$failed=Join-Path ${literal(session)} 'failed'
[IO.Directory]::CreateDirectory((Join-Path $failed '.runtime/uv'))|Out-Null
[IO.File]::Copy($uv,(Join-Path $failed '.runtime/uv/uv.exe'))
$env:CAPRI_PYTHON_FIXTURE_FAIL='1'
try{Get-CapriPythonRuntime -ProjectRoot $failed;throw 'Failed download was accepted'}catch{if($_.Exception.Message -notmatch 'Could not install the pinned'){throw}}
`,
      'utf8',
    );
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  },
);
