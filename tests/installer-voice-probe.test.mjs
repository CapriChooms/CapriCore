// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';

test(
  'voice setup isolates a failing HIP device before downloading weights',
  {
    skip: process.platform !== 'win32' || Number(os.release().split('.')[2]) < 22000,
  },
  () => {
    const parent = path.join(root, '.runtime/installer-python-tests');
    mkdirSync(parent, { recursive: true });
    const session = mkdtempSync(path.join(parent, 'voice-probe-'));
    const scripts = path.join(session, 'tools/setup');
    mkdirSync(scripts, { recursive: true });
    mkdirSync(path.join(session, '.runtime'));
    const script = path.join(scripts, 'setup-voice-training.ps1');
    copyFileSync(path.join(root, 'tools/setup/setup-voice-training.ps1'), script);
    writeFileSync(
      path.join(scripts, 'python-runtime.ps1'),
      `
function Get-CapriPythonRuntime($ProjectRoot, $Version) {
  return @{ Python=(Join-Path $ProjectRoot 'python-fixture.exe'); Uv='uv-fixture.exe' }
}
function Ensure-CapriVirtualEnvironment($ProjectRoot, $Name, $Runtime) { return $Runtime.Python }
`,
    );
    const compiler = path.join(session, 'compile.ps1');
    writeFileSync(
      compiler,
      String.raw`
$ErrorActionPreference='Stop'
Add-Type -OutputAssembly (Join-Path $PSScriptRoot 'python-fixture.exe') -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.IO;
public class ProbeFixture {
  public static int Main(string[] args) {
    if (args[0].EndsWith("select-voice-runtime.py")) {
      Console.WriteLine("{\"profile\":\"amd\",\"torch\":\"fixture\",\"backend\":\"rocm7.2.1\",\"requirements\":\"requirements.txt\",\"overrides\":\"overrides.txt\",\"amdAdapterCount\":2}");
      return 0;
    }
    if (args[0].EndsWith("uv-retry.py")) return 0;
    if (args.Length < 3 || args[1] != "integrations.voice_training") return 93;
    string command = args[2];
    string mask = Environment.GetEnvironmentVariable("HIP_VISIBLE_DEVICES") ?? "all";
    string scenario = Environment.GetEnvironmentVariable("CAPRI_PROBE_FIXTURE_SCENARIO");
    File.AppendAllText(Environment.GetEnvironmentVariable("CAPRI_PROBE_FIXTURE_LOG"), command+"|"+mask+Environment.NewLine);
    if (command == "doctor") {
      if (args.Length < 4 || args[3] != "--runtime-only") return 94;
      if ((scenario != "healthy" && mask == "all") || scenario == "failed") return unchecked((int)0xc0000005);
      string ready = scenario == "healthy" || mask == "1" ? "true" : "false";
      Console.WriteLine("Voice runtime check: verifying GPU compute.");
      Console.WriteLine("{\"cuda\":"+ready+",\"cudaCompute\":{\"kernelReady\":"+ready+"}}");
    }
    // A verified download publishes the model receipt itself in production.
    return 0;
  }
}
'@
`,
    );
    const run = (file, args, env) =>
      spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
        { encoding: 'utf8', windowsHide: true, timeout: 15000, env },
      );
    const compiled = run(compiler, []);
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);

    const env = { ...process.env };
    delete env.HIP_VISIBLE_DEVICES;
    delete env.CUDA_VISIBLE_DEVICES;
    const receipt = path.join(session, '.runtime/voice-runtime.json');
    for (const { name, scenario, mask, args = [], commands, device, succeeds = true } of [
      {
        name: 'mixed',
        scenario: 'mixed',
        commands: ['doctor|all', 'doctor|0', 'doctor|1', 'init|all', 'download|all'],
        device: 1,
      },
      {
        name: 'healthy',
        scenario: 'healthy',
        commands: ['doctor|all', 'init|all', 'download|all'],
      },
      {
        name: 'dependencies',
        scenario: 'mixed',
        args: ['-DependenciesOnly'],
        commands: ['doctor|all', 'doctor|0', 'doctor|1'],
        device: 1,
      },
      { name: 'explicit', scenario: 'mixed', mask: '0', succeeds: false, commands: ['doctor|0'] },
      {
        name: 'failed',
        scenario: 'failed',
        succeeds: false,
        commands: ['doctor|all', 'doctor|0', 'doctor|1'],
      },
    ]) {
      const log = path.join(session, `${name}.log`);
      const previousReceipt = existsSync(receipt) ? readFileSync(receipt, 'utf8') : undefined;
      const result = run(script, args, {
        ...env,
        ...(mask !== undefined ? { HIP_VISIBLE_DEVICES: mask } : {}),
        CAPRI_PROBE_FIXTURE_SCENARIO: scenario,
        CAPRI_PROBE_FIXTURE_LOG: log,
      });
      assert.equal(result.status === 0, succeeds, `${name}: ${result.stderr || result.stdout}`);
      assert.deepEqual(readFileSync(log, 'utf8').trim().split(/\r?\n/), commands, name);
      const currentReceipt = readFileSync(receipt, 'utf8');
      if (succeeds) assert.equal(JSON.parse(currentReceipt).hipVisibleDevice, device, name);
      else assert.equal(currentReceipt, previousReceipt, name);
      if (name === 'failed') assert.match(result.stderr, /rocm7\.2\.1, exit -1073741819/);
    }
  },
);
