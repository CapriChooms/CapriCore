import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  lstatSync,
  symlinkSync,
  copyFileSync,
  linkSync,
  utimesSync,
} from 'node:fs';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { writeJsonAtomic } from '../packages/runtime/src/atomic-json.mjs';
import { estimateInstallStorage } from '../packages/installer/src/storage-estimate.mjs';
import { temporaryFolders } from './temporary-folders.mjs';
const windows = process.platform === 'win32';
const folder = temporaryFolders('capri-installer-windows-unit-');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const ps = (file, args = []) =>
  spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.isAbsolute(file) ? file : path.join(root, file),
      ...args,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 },
  );

test(
  'combined base and AMD downloads keep stage progress below completion while preserving actual transfer bytes',
  { skip: !windows },
  () => {
    const script = path.join(folder(), 'download-progress.ps1');
    writeFileSync(
      script,
      `param($Source)
. (Join-Path $Source 'packages/installer/windows/install-progress.ps1')
. (Join-Path $Source 'packages/installer/windows/install-progress-ui.ps1')
function Text-Capri($Key){return '{0}'}
$script:installProgress=New-CapriInstallProgress
$script:installProgress.step='ollama'
$base=1586229413.0;$addon=256578673.0
Update-CapriDownloadProgress ([PSCustomObject]@{step='ollama';received=$base;total=$base;stageFraction=($base/($base+$addon))})
$baseProgress=$script:installProgress.fractionalValue
$baseTransfer=$script:installProgress.transfer
Update-CapriDownloadProgress ([PSCustomObject]@{step='ollama';file='addon.zip';received=($addon/2);total=$addon;stageFraction=(($base+$addon/2)/($base+$addon))})
$halfProgress=$script:installProgress.fractionalValue
$halfTransfer=$script:installProgress.transfer
Update-CapriDownloadProgress ([PSCustomObject]@{step='ollama';received=$addon;total=$addon;stageFraction=1})
$readyProgress=$script:installProgress.fractionalValue
Update-CapriDownloadProgress ([PSCustomObject]@{step='ollama';received=$addon;total=$addon;stageFraction=2})
$invalidIgnored=$script:installProgress.fractionalValue -eq $readyProgress
Set-CapriProgressFraction $script:installProgress 'ollama' 1
[PSCustomObject]@{baseBelowHalf=($baseProgress -lt $halfProgress);halfBelowReady=($halfProgress -lt $readyProgress);readyBelowCompleted=($readyProgress -lt $script:installProgress.fractionalValue);invalidIgnored=$invalidIgnored;transferBytesCorrect=($baseTransfer -like '*1586*');perFileProgress=($halfTransfer -like 'addon.zip*50%*128*/*256*MB') }|ConvertTo-Json -Compress
`,
    );
    const result = ps(script, [root]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      baseBelowHalf: true,
      halfBelowReady: true,
      readyBelowCompleted: true,
      invalidIgnored: true,
      transferBytesCorrect: true,
      perFileProgress: true,
    });
  },
);

test(
  'the wizard and worker agree on disk estimates for local, API and speech selections',
  { skip: !windows },
  () => {
    const fixture = folder();
    const script = path.join(fixture, 'storage.ps1');
    const cases = path.join(fixture, 'cases.json');
    const base = {
      inferenceMode: 'local',
      profile: 'quality',
      downloadModels: true,
      conversationLanguage: 'en',
      recognition: false,
      router: false,
      voicePack: false,
      rocmVoice: false,
      hardware: null,
    };
    const selections = [
      base,
      { ...base, hardware: { gpus: [{ name: 'AMD Radeon RX 7900 XTX' }] } },
      { ...base, hardware: { gpus: [{ name: 'AMD Radeon(TM) RX 6400' }] } },
      { ...base, inferenceMode: 'api', hardware: { gpus: [{ name: 'AMD Radeon RX 7900 XTX' }] } },
      { ...base, downloadModels: false },
      { ...base, modelSource: 'huggingface' },
      {
        ...base,
        modelSource: 'huggingface',
        downloadModels: false,
        recognition: true,
        voicePack: true,
      },
      { ...base, inferenceMode: 'api', recognition: true },
      {
        ...base,
        inferenceMode: 'api',
        recognition: true,
        voicePack: true,
        conversationLanguage: 'pt-BR',
      },
      { ...base, inferenceMode: 'api', voiceMode: 'qwen', conversationLanguage: 'ru' },
      { ...base, inferenceMode: 'api', voiceMode: 'qwen-ru', conversationLanguage: 'ru' },
      {
        ...base,
        inferenceMode: 'api',
        recognition: true,
        router: true,
        voicePack: true,
        conversationLanguage: 'ru',
      },
      {
        ...base,
        profile: 'gemma4-e2b',
        voicePack: true,
        conversationLanguage: 'zh',
        rocmVoice: true,
      },
    ];
    writeJsonAtomic(cases, selections);
    writeFileSync(
      script,
      `param($Source,$Cases)
. (Join-Path $Source 'packages/installer/windows/common.ps1')
. (Join-Path $Source 'packages/installer/windows/storage-estimate.ps1')
$manifest=Read-CapriJson (Join-Path $Source 'config/installer.json')
$catalog=Read-CapriStorageCatalog $Source
$estimates=@(foreach($selection in (Read-CapriJson $Cases)){
    Get-CapriStorageEstimate $selection $manifest $catalog $selection.rocmVoice $selection.hardware
})
ConvertTo-Json -InputObject $estimates -Compress
`,
    );
    const result = ps(script, [root, cases]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(result.stdout),
      selections.map((selection) => estimateInstallStorage(selection, selection)),
    );
  },
);

test(
  'update download estimate counts only missing files and keeps the disk reserve',
  { skip: !windows },
  () => {
    const fixture = folder();
    const target = path.join(fixture, 'Capri');
    const script = path.join(fixture, 'update-storage.ps1');
    writeFileSync(
      script,
      `param($Source,$Target)
. (Join-Path $Source 'packages/installer/windows/common.ps1')
. (Join-Path $Source 'packages/installer/windows/storage-estimate.ps1')
$manifest=Read-CapriJson (Join-Path $Source 'config/installer.json')
$catalog=Read-CapriStorageCatalog $Source
function Write-FixtureFile($Relative,[long]$Bytes){
    $file=Join-Path $Target $Relative
    [IO.Directory]::CreateDirectory((Split-Path -Parent $file))|Out-Null
    $stream=[IO.File]::Create($file)
    try{$stream.SetLength($Bytes)}finally{$stream.Dispose()}
}
$selection=@{target=$Target;inferenceMode='api';profile='minimal';downloadModels=$true;conversationLanguage='en';recognition=$true;voicePack=$true}
$catalog.englishVoice=@(@{file='existing';bytes=200},@{file='partial';bytes=100},@{file='damaged';bytes=80})
$catalog.registry.'bge-m3:latest'.layers=@(@{mediaType='application/vnd.ollama.image.model';digest=('sha256:'+('a'*64));size=1000})
$manifest.storage.embeddingBytes=1000
$manifest.storage.englishVoiceBytes=380
Write-FixtureFile ($catalog.voiceTrainingDirectory+'/existing') 200
Write-FixtureFile ($catalog.voiceTrainingDirectory+'/partial.partial') 30
Write-FixtureFile ($catalog.voiceTrainingDirectory+'/damaged') 5
Write-FixtureFile ('data/models/blobs/sha256-'+('a'*64)) 1000
$electron=$manifest.artifacts.electron
$electron.bytes=500
Write-FixtureFile ('.runtime/installer/downloads/'+$electron.sha256+'.zip') 500
$clean=Get-CapriStorageEstimate $selection $manifest $catalog
Write-CapriJson (Join-Path $Target '.capri-install.json') @{schemaVersion=1;productId='capri.desktop';root=$Target;version='1.0.4';installId='00000000-0000-0000-0000-000000000001'}
$updated=Get-CapriStorageEstimate $selection $manifest $catalog
Write-FixtureFile ($catalog.voiceTrainingDirectory+'/partial') 100
Write-FixtureFile ($catalog.voiceTrainingDirectory+'/damaged') 80
$complete=Get-CapriStorageEstimate $selection $manifest $catalog
$selection.inferenceMode='local'
$changed=Get-CapriStorageEstimate $selection $manifest $catalog
@{reusedBytes=$clean.downloadBytes-$updated.downloadBytes;missingVoiceBytes=$updated.downloadBytes-$complete.downloadBytes;
    reserveUnchanged=$clean.requiredBytes -eq $updated.requiredBytes;otherModelBytes=$changed.downloadBytes-$complete.downloadBytes} | ConvertTo-Json -Compress
`,
    );
    const result = ps(script, [root, target]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      reusedBytes: 1730,
      missingVoiceBytes: 150,
      reserveUnchanged: true,
      otherModelBytes: 1019201167,
    });
  },
);

test(
  'Windows archive extraction validates every entry before writing and rejects traversal, duplicates and links',
  { skip: !windows },
  () => {
    const cases = JSON.parse(
      readFileSync(path.join(root, 'tests/fixtures/installer-archives.json'), 'utf8'),
    );
    for (const [name, encoded] of Object.entries(cases)) {
      const location = folder(),
        archive = path.join(location, 'fixture.zip'),
        destination = path.join(location, 'output');
      writeFileSync(archive, Buffer.from(encoded, 'base64'));
      const result = ps('packages/installer/windows/archive.ps1', [
        '-Archive',
        archive,
        '-Destination',
        destination,
      ]);
      if (name === 'safe') {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(readFileSync(path.join(destination, 'folder/safe.txt'), 'utf8'), 'safe');
      } else {
        assert.notEqual(result.status, 0);
        assert.equal(existsSync(destination), false);
        assert.equal(existsSync(path.join(location, 'escaped.txt')), false);
      }
    }
  },
);
test(
  'archive preflight rejects a hard-linked existing DLL before writing any entry or outside bytes',
  { skip: !windows },
  () => {
    const location = folder(),
      destination = path.join(location, 'output');
    const outside = path.join(location, 'outside-canary.dll');
    const target = path.join(destination, 'lib/ollama/rocm_v7_1/ggml-hip.dll');
    const archive = path.join(location, 'runtime.zip'),
      script = path.join(location, 'extract.ps1');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(outside, 'outside canary remains unchanged');
    linkSync(outside, target);
    writeFileSync(
      script,
      `param($Source,$Archive,$Destination)
. (Join-Path $Source 'packages/installer/windows/common.ps1')
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$zip=[IO.Compression.ZipFile]::Open($Archive,[IO.Compression.ZipArchiveMode]::Create)
try {
    foreach($name in @('first.txt','lib/ollama/rocm_v7_1/ggml-hip.dll')){
        $entry=$zip.CreateEntry($name);$stream=$entry.Open();$writer=New-Object IO.StreamWriter($stream)
        try{$writer.Write('reviewed new archive bytes')}finally{$writer.Dispose();$stream.Dispose()}
    }
}finally{$zip.Dispose()}
Expand-CapriArchive $Archive $Destination
`,
    );
    const result = ps(script, [root, archive, destination]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /hard-linked/);
    assert.equal(existsSync(path.join(destination, 'first.txt')), false);
    assert.equal(readFileSync(outside, 'utf8'), 'outside canary remains unchanged');
    assert.equal(readFileSync(target, 'utf8'), 'outside canary remains unchanged');
  },
);

function uninstallFixture() {
  const target = folder();
  writeJsonAtomic(path.join(target, '.capri-install.json'), {
    schemaVersion: 1,
    productId: 'capri.desktop',
    root: target,
    version: '0.3.0',
    installId: randomUUID(),
  });
  writeJsonAtomic(
    path.join(target, 'config/installer.json'),
    JSON.parse(readFileSync(path.join(root, 'config/installer.json'), 'utf8')),
  );
  const content = 'original code';
  mkdirSync(path.join(target, 'apps'), { recursive: true });
  writeFileSync(path.join(target, 'apps/example.mjs'), content);
  writeJsonAtomic(path.join(target, '.runtime/installer/source-files.json'), {
    files: [{ path: 'apps/example.mjs', sha256: hash(content) }],
  });
  mkdirSync(path.join(target, 'data'), { recursive: true });
  writeFileSync(path.join(target, 'data/history.txt'), 'private canary');
  return target;
}

test(
  'uninstall blocks a live setup and ignores a stale lock whose PID was reused',
  { skip: !windows },
  () => {
    const target = uninstallFixture();
    const lock = path.join(target, '.runtime/installer/install.lock.json');
    writeJsonAtomic(lock, { pid: process.pid, id: randomUUID() });
    const run = () =>
      ps('packages/installer/windows/uninstall.ps1', ['-InstallRoot', target, '-Quiet']);
    const blocked = run();
    assert.equal(blocked.status, 1, blocked.stderr);
    assert.match(blocked.stderr, /Finish or cancel the installation/);
    assert.equal(existsSync(path.join(target, 'apps/example.mjs')), true);
    const previousProcess = new Date('2020-01-01T00:00:00Z');
    utimesSync(lock, previousProcess, previousProcess);
    const removed = run();
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(existsSync(path.join(target, 'apps/example.mjs')), false);
    assert.equal(readFileSync(path.join(target, 'data/history.txt'), 'utf8'), 'private canary');
  },
);

test(
  'a terminated ONNX import exits as an unavailable optional classifier',
  { skip: !windows },
  () => {
    const target = folder();
    const setup = path.join(target, 'tools/setup');
    mkdirSync(setup, { recursive: true });
    const installer = path.join(setup, 'setup-request-router.ps1');
    copyFileSync(path.join(root, 'tools/setup/setup-request-router.ps1'), installer);
    writeFileSync(
      path.join(setup, 'python-runtime.ps1'),
      `function Get-CapriPythonRuntime($ProjectRoot) {
  @{ Uv='fixture'; Python=(Join-Path $ProjectRoot 'mock-python.cmd') }
}
function Ensure-CapriVirtualEnvironment($ProjectRoot,$Name,$Runtime) { $Runtime.Python }
`,
    );
    writeFileSync(
      path.join(target, 'mock-python.cmd'),
      '@echo off\r\nif "%~1"=="-c" exit /b 3\r\necho %~1\r\nexit /b 0\r\n',
    );
    const result = ps(installer);
    assert.equal(result.status, 22, result.stderr || result.stdout);
    assert.match(result.stdout, /CAPRI_ROUTER_NATIVE_LIBRARY_UNAVAILABLE exit=3/);
    assert.doesNotMatch(result.stdout, /provision-request-router/);
  },
);

test(
  'uninstall measures allocated bytes and excludes hard links retained elsewhere',
  { skip: !windows },
  () => {
    const target = uninstallFixture();
    const models = path.join(target, 'data/models');
    const settings = path.join(target, 'data/desktop');
    mkdirSync(models, { recursive: true });
    mkdirSync(settings, { recursive: true });
    const model = path.join(models, 'model.bin');
    writeFileSync(model, Buffer.alloc(3 * 1024 ** 2, 5));
    writeFileSync(path.join(settings, 'memory.bin'), Buffer.alloc(2 * 1024 ** 2, 9));
    const link = ps('packages/installer/windows/uninstall.ps1', [
      '-InstallRoot',
      target,
      '-Quiet',
      '-MeasureOnly',
    ]);
    assert.equal(link.status, 0, link.stderr);
    const { bytes } = JSON.parse(link.stdout);
    assert.equal(bytes[2], 3 * 1024 ** 2);
    assert.equal(bytes[4], 2 * 1024 ** 2);
    assert.equal(bytes[6], 5 * 1024 ** 2);
    linkSync(model, path.join(target, 'retained-model.bin'));
    const retained = ps('packages/installer/windows/uninstall.ps1', [
      '-InstallRoot',
      target,
      '-Quiet',
      '-MeasureOnly',
    ]);
    assert.equal(retained.status, 0, retained.stderr);
    assert.equal(JSON.parse(retained.stdout).bytes[2], 0);
    assert.equal(existsSync(model), true);
  },
);
test(
  'uninstall retains private data and backs up changed source by default',
  { skip: !windows },
  () => {
    const target = uninstallFixture();
    writeFileSync(path.join(target, 'apps/example.mjs'), 'user modified code');
    const result = ps('packages/installer/windows/uninstall.ps1', [
      '-InstallRoot',
      target,
      '-Quiet',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(path.join(target, 'data/history.txt'), 'utf8'), 'private canary');
    assert.equal(
      readFileSync(path.join(target, 'data/uninstall-backup/apps/example.mjs'), 'utf8'),
      'user modified code',
    );
    assert.equal(existsSync(path.join(target, 'apps/example.mjs')), false);
    assert.equal(existsSync(path.join(target, '.capri-install.json')), false);
  },
);

test(
  'uninstall uses the active camera host and falls back safely to the legacy host',
  { skip: !windows },
  () => {
    const fixture = folder();
    const script = path.join(fixture, 'compile-camera-cleanup-mock.ps1');
    const executable = path.join(fixture, 'capri-camera-host.exe');
    writeFileSync(
      script,
      `param([string]$OutputFile)
$ErrorActionPreference='Stop'
Add-Type -OutputType ConsoleApplication -OutputAssembly $OutputFile -TypeDefinition @'
using System.IO;
public static class CameraCleanupFixture {
    public static int Main(string[] args) {
        if (args.Length != 1 || args[0] != "--cleanup") return 2;
        var bundle = Path.GetDirectoryName(typeof(CameraCleanupFixture).Assembly.Location);
        for (var directory = new DirectoryInfo(bundle); directory != null; directory = directory.Parent) {
            var data = Path.Combine(directory.FullName, "data");
            if (Directory.Exists(data)) {
                File.AppendAllText(Path.Combine(data, "camera-cleanup.log"), Path.GetFileName(bundle));
                return 0;
            }
        }
        return 3;
    }
}
'@
`,
    );
    const compiled = ps(script, [executable]);
    assert.equal(compiled.status, 0, compiled.stderr);
    const bundleId = 'a'.repeat(32);
    for (const kind of ['current', 'legacy', 'invalid receipt', 'linked bundle']) {
      const target = uninstallFixture();
      const directory = path.join(target, '.runtime/capri-camera');
      const bundle = path.join(directory, 'bundles', bundleId);
      mkdirSync(path.dirname(bundle), { recursive: true });
      copyFileSync(executable, path.join(directory, path.basename(executable)));
      if (kind !== 'legacy') {
        if (kind === 'linked bundle') symlinkSync(fixture, bundle, 'junction');
        else {
          mkdirSync(bundle);
          copyFileSync(executable, path.join(bundle, path.basename(executable)));
        }
        writeJsonAtomic(path.join(directory, 'active.json'), {
          schemaVersion: 1,
          bundleId,
          ...(kind === 'invalid receipt' && { executable: 'arbitrary.exe' }),
        });
      }
      const removed = ps('packages/installer/windows/uninstall.ps1', [
        '-InstallRoot',
        target,
        '-Quiet',
      ]);
      assert.equal(removed.status, 0, `${kind}: ${removed.stderr}`);
      assert.equal(
        readFileSync(path.join(target, 'data/camera-cleanup.log'), 'utf8'),
        kind === 'current' ? bundleId : 'capri-camera',
        kind,
      );
      assert.equal(existsSync(directory), false);
      assert.equal(existsSync(executable), true);
    }
  },
);

test(
  'Hugging Face packages and credentials follow separate uninstall selections',
  { skip: !windows },
  () => {
    for (const selection of ['-DeleteModels', '-DeleteSettings']) {
      const target = uninstallFixture();
      const cache = path.join(target, 'data/huggingface/packages/model');
      const secrets = path.join(target, 'data/secrets');
      mkdirSync(cache, { recursive: true });
      mkdirSync(secrets, { recursive: true });
      const model = path.join(cache, 'model.gguf');
      const credential = path.join(secrets, 'huggingface.json');
      writeFileSync(model, 'model fixture');
      writeFileSync(credential, '{"ciphertext":"encrypted fixture"}');
      const result = ps('packages/installer/windows/uninstall.ps1', [
        '-InstallRoot',
        target,
        '-Quiet',
        selection,
      ]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(existsSync(model), selection !== '-DeleteModels');
      assert.equal(existsSync(credential), selection !== '-DeleteSettings');
    }
  },
);
test(
  'Qwen runtime, downloaded voices and private training data have independent uninstall groups',
  { skip: !windows },
  () => {
    const models = [
      'data/huggingface/blobs/model.gguf',
      'data/speech/qwen3-tts-0.6b-base/model.safetensors',
      'data/voices/capri/en/exports/capri-en-v1/adapter.safetensors',
    ];
    const personal = [
      'config/voice-training.local.json',
      'config/companion-voice.local.json',
      'data/speech/training-jobs/job/candidate.json',
      'data/speech/voice-training-status.json',
      'data/speech/voice-selections.json',
      'data/voices/capri/en/imports/import/raw/reviewed.wav',
      'data/voices/capri/en/imports/import/exports/capri-trained-job/adapter.safetensors',
      'data/voices/capri/en/exports/capri-trained-own/adapter.safetensors',
    ];
    for (const selection of ['-DeleteModels', '-DeleteSettings']) {
      const target = uninstallFixture();
      const runtime = '.runtime/qwen-tts-venv/Scripts/python.exe';
      for (const relative of [...models, ...personal, runtime]) {
        const file = path.join(target, relative);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, Buffer.alloc(1024 ** 2, 1));
      }
      const measured = ps('packages/installer/windows/uninstall.ps1', [
        '-InstallRoot',
        target,
        '-MeasureOnly',
      ]);
      assert.equal(measured.status, 0, measured.stderr);
      const { bytes } = JSON.parse(measured.stdout);
      assert.equal(bytes[2], models.length * 1024 ** 2);
      assert.equal(bytes[4], personal.length * 1024 ** 2);
      const wrapper = path.join(target, '.runtime/selective-uninstall.ps1');
      writeFileSync(
        wrapper,
        `param($Installer,$InstallRoot,$Selection)
$ErrorActionPreference='Stop'
& $Installer -InstallRoot $InstallRoot -Quiet -RemoveApplication:$false -DeleteModels:($Selection -eq 'models') -DeleteSettings:($Selection -eq 'settings')
if(-not $?){exit 1}
`,
      );
      const result = ps(wrapper, [
        path.join(root, 'packages/installer/windows/uninstall.ps1'),
        target,
        selection === '-DeleteModels' ? 'models' : 'settings',
      ]);
      assert.equal(result.status, 0, result.stderr);
      for (const relative of models)
        assert.equal(
          existsSync(path.join(target, relative)),
          selection !== '-DeleteModels',
          relative,
        );
      for (const relative of personal)
        assert.equal(
          existsSync(path.join(target, relative)),
          selection !== '-DeleteSettings',
          relative,
        );
      assert.equal(existsSync(path.join(target, runtime)), true);
      const removeApplication = ps('packages/installer/windows/uninstall.ps1', [
        '-InstallRoot',
        target,
        '-Quiet',
      ]);
      assert.equal(removeApplication.status, 0, removeApplication.stderr);
      assert.equal(existsSync(path.join(target, runtime)), false);
    }
  },
);
test(
  'explicit data deletion removes only the managed installation data',
  { skip: !windows },
  () => {
    const target = uninstallFixture(),
      outside = folder();
    writeFileSync(path.join(outside, 'keep.txt'), 'outside canary');
    const result = ps('packages/installer/windows/uninstall.ps1', [
      '-InstallRoot',
      target,
      '-Quiet',
      '-DeleteData',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(path.join(target, 'data')), false);
    assert.equal(readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'outside canary');
  },
);
test(
  'a linked source is omitted from estimates and only blocks application removal',
  { skip: !windows },
  () => {
    const target = uninstallFixture(),
      outside = folder();
    writeFileSync(path.join(outside, 'keep.txt'), 'outside canary');
    symlinkSync(outside, path.join(target, 'linked-source'), 'junction');
    writeJsonAtomic(path.join(target, '.runtime/installer/source-files.json'), {
      files: [
        { path: 'apps/example.mjs', sha256: hash('original code') },
        { path: 'linked-source/keep.txt', sha256: hash('outside canary') },
      ],
    });
    const model = path.join(target, 'data/models/model.bin');
    mkdirSync(path.dirname(model), { recursive: true });
    writeFileSync(model, 'local model canary');
    const uninstaller = 'packages/installer/windows/uninstall.ps1';
    const measured = ps(uninstaller, ['-InstallRoot', target, '-Quiet', '-MeasureOnly']);
    assert.equal(measured.status, 0, measured.stderr);
    assert.equal(JSON.parse(measured.stdout).bytes.length, 8);
    const removeModels = path.join(outside, 'remove-models.ps1');
    writeFileSync(
      removeModels,
      `param($Uninstaller,$Root)\n& $Uninstaller -InstallRoot $Root -Quiet -RemoveApplication:$false -DeleteModels\nif(-not $?){exit 1}\n`,
    );
    const removed = ps(removeModels, [path.join(root, uninstaller), target]);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(existsSync(model), false);
    assert.equal(existsSync(path.join(target, 'apps/example.mjs')), true);
    const result = ps('packages/installer/windows/uninstall.ps1', [
      '-InstallRoot',
      target,
      '-Quiet',
    ]);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(path.join(target, 'apps/example.mjs')), true);
    assert.equal(existsSync(path.join(target, '.capri-install.json')), true);
    assert.equal(readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'outside canary');
  },
);

test(
  'a linked model root is excluded from disk usage and unlinked only when selected',
  { skip: !windows },
  () => {
    const target = uninstallFixture();
    const outside = folder();
    const cache = path.join(target, 'data/models');
    const weights = path.join(outside, 'shared.bin');
    writeFileSync(weights, Buffer.alloc(1024 ** 2, 7));
    symlinkSync(outside, cache, 'junction');
    mkdirSync(path.join(target, 'data/speech'), { recursive: true });
    symlinkSync(
      path.join(outside, 'missing-cache'),
      path.join(target, 'data/speech', 'hf-model'),
      'junction',
    );
    const argumentsForUninstall = ['-InstallRoot', target, '-Quiet'];
    const uninstaller = 'packages/installer/windows/uninstall.ps1';
    const measured = ps(uninstaller, [...argumentsForUninstall, '-MeasureOnly']);
    assert.equal(measured.status, 0, measured.stderr);
    assert.equal(JSON.parse(measured.stdout).bytes[2], 0);
    const script = path.join(outside, 'remove-models.ps1');
    writeFileSync(
      script,
      `param($Uninstaller,$Root)\n& $Uninstaller -InstallRoot $Root -Quiet -RemoveApplication:$false -DeleteModels\nif(-not $?){exit 1}\n`,
    );
    const removed = ps(script, [path.join(root, uninstaller), target]);
    assert.equal(removed.status, 0, removed.stderr);
    assert.throws(() => lstatSync(cache), { code: 'ENOENT' });
    assert.throws(() => lstatSync(path.join(target, 'data/speech/hf-model')), { code: 'ENOENT' });
    assert.equal(readFileSync(path.join(target, 'apps/example.mjs'), 'utf8'), 'original code');
    assert.equal(readFileSync(path.join(target, 'data/history.txt'), 'utf8'), 'private canary');
    assert.deepEqual(readFileSync(weights), Buffer.alloc(1024 ** 2, 7));
  },
);

test(
  'linked voice data partitions allow uninstall without reading or deleting their targets',
  { skip: !windows },
  () => {
    const uninstaller = 'packages/installer/windows/uninstall.ps1';
    for (const relative of [
      'data/speech',
      'data/voices',
      'data/voices/capri',
      'data/voices/capri/en',
      'data/voices/capri/en/exports',
    ]) {
      const target = uninstallFixture();
      const outside = folder();
      const link = path.join(target, relative);
      const sentinel = path.join(outside, 'keep.txt');
      writeFileSync(sentinel, 'outside voice data');
      mkdirSync(path.dirname(link), { recursive: true });
      symlinkSync(outside, link, 'junction');
      const args = ['-InstallRoot', target, '-Quiet'];
      const measured = ps(uninstaller, [...args, '-MeasureOnly']);
      assert.equal(measured.status, 0, `${relative}: ${measured.stderr}`);
      const partial = ps(uninstaller, args);
      assert.equal(partial.status, 0, `${relative}: ${partial.stderr}`);
      assert.equal(lstatSync(link).isSymbolicLink(), true);
      assert.equal(readFileSync(sentinel, 'utf8'), 'outside voice data');
    }
    const target = uninstallFixture();
    const outside = folder();
    const sentinel = path.join(outside, 'keep.txt');
    writeFileSync(sentinel, 'outside voice data');
    symlinkSync(outside, path.join(target, 'data/speech'), 'junction');
    const complete = ps(uninstaller, ['-InstallRoot', target, '-Quiet', '-DeleteData']);
    assert.equal(complete.status, 0, complete.stderr);
    assert.equal(existsSync(path.join(target, 'data')), false);
    assert.equal(readFileSync(sentinel, 'utf8'), 'outside voice data');
  },
);

test(
  'owned npm workspace junctions are unlinked without deleting their target content',
  { skip: !windows },
  () => {
    const target = uninstallFixture(),
      workspace = path.join(target, 'packages/runtime');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(path.join(target, 'node_modules/@capri'), { recursive: true });
    writeJsonAtomic(path.join(target, 'package.json'), { workspaces: ['packages/runtime'] });
    writeJsonAtomic(path.join(workspace, 'package.json'), { name: '@capri/runtime' });
    writeFileSync(path.join(workspace, 'canary.txt'), 'workspace target must not be traversed');
    symlinkSync(workspace, path.join(target, 'node_modules/@capri/runtime'), 'junction');
    const result = ps('packages/installer/windows/uninstall.ps1', [
      '-InstallRoot',
      target,
      '-Quiet',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(path.join(target, 'node_modules')), false);
    assert.equal(
      readFileSync(path.join(workspace, 'canary.txt'), 'utf8'),
      'workspace target must not be traversed',
    );
  },
);

test(
  'uninstall unlinks descendant junctions and live or dangling symlinks without following targets',
  { skip: !windows },
  () => {
    const target = uninstallFixture(),
      outside = folder(),
      dependencies = path.join(target, 'node_modules/fixture-package/cache');
    mkdirSync(dependencies, { recursive: true });
    const outsideFile = path.join(outside, 'keep.bin');
    writeFileSync(outsideFile, Buffer.alloc(1024 ** 2, 7));
    const links = [
      ['directory-junction', outside, 'junction'],
      ['directory-symlink', outside, 'dir'],
      ['file-symlink', outsideFile, 'file'],
      ['dangling-file', path.join(outside, 'missing-file'), 'file'],
      ['dangling-directory', path.join(outside, 'missing-directory'), 'junction'],
    ];
    for (const [name, destination, type] of links) {
      const link = path.join(dependencies, name);
      symlinkSync(destination, link, type);
      assert.equal(lstatSync(link).isSymbolicLink(), true, name);
    }
    // The unselected model group must retain even its links, rather than resolve
    // and delete a shared cache while removing the application dependencies.
    const retainedModel = path.join(
      target,
      'data/huggingface/hub/models--fixture/snapshots/rev/model.bin',
    );
    mkdirSync(path.dirname(retainedModel), { recursive: true });
    symlinkSync(outsideFile, retainedModel, 'file');
    const result = ps('packages/installer/windows/uninstall.ps1', [
      '-InstallRoot',
      target,
      '-Quiet',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(path.join(target, 'apps/example.mjs')), false);
    assert.equal(existsSync(path.join(target, '.capri-install.json')), false);
    assert.equal(existsSync(path.join(target, 'node_modules')), false);
    for (const [name] of links)
      assert.throws(() => lstatSync(path.join(dependencies, name)), { code: 'ENOENT' });
    assert.equal(lstatSync(retainedModel).isSymbolicLink(), true);
    assert.equal(readFileSync(outsideFile).equals(Buffer.alloc(1024 ** 2, 7)), true);
    assert.equal(readFileSync(path.join(target, 'data/history.txt'), 'utf8'), 'private canary');
  },
);

test(
  'Hugging Face descendant links contribute no external bytes and selected model removal only unlinks them',
  { skip: !windows },
  () => {
    const target = uninstallFixture(),
      outside = folder(),
      cache = path.join(target, 'data/huggingface/hub/models--fixture'),
      snapshot = path.join(cache, 'snapshots/rev');
    mkdirSync(snapshot, { recursive: true });
    const model = path.join(cache, 'local-model.bin');
    writeFileSync(model, Buffer.alloc(1024 ** 2, 3));
    const before = ps('packages/installer/windows/uninstall.ps1', [
      '-InstallRoot',
      target,
      '-MeasureOnly',
    ]);
    assert.equal(before.status, 0, before.stderr);
    assert.equal(JSON.parse(before.stdout).bytes[2], 1024 ** 2);
    const outsideFile = path.join(outside, 'shared-weights.bin');
    writeFileSync(outsideFile, Buffer.alloc(7 * 1024 ** 2, 9));
    const links = [
      [path.join(snapshot, 'model.safetensors'), outsideFile, 'file'],
      [path.join(snapshot, 'shared-cache'), outside, 'junction'],
      [path.join(snapshot, 'missing-shard.safetensors'), path.join(outside, 'missing'), 'file'],
    ];
    for (const [link, destination, type] of links) symlinkSync(destination, link, type);
    const measured = ps('packages/installer/windows/uninstall.ps1', [
      '-InstallRoot',
      target,
      '-MeasureOnly',
    ]);
    assert.equal(measured.status, 0, measured.stderr);
    assert.deepEqual(JSON.parse(measured.stdout).bytes, JSON.parse(before.stdout).bytes);
    const wrapper = path.join(outside, 'models-only.ps1');
    writeFileSync(
      wrapper,
      `param($Installer,$InstallRoot)
$ErrorActionPreference='Stop'
& $Installer -InstallRoot $InstallRoot -Quiet -RemoveApplication:$false -DeleteModels
if(-not $?){exit 1}
`,
    );
    const removed = ps(wrapper, [
      path.join(root, 'packages/installer/windows/uninstall.ps1'),
      target,
    ]);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(existsSync(cache), false);
    for (const [link] of links) assert.throws(() => lstatSync(link), { code: 'ENOENT' });
    assert.equal(existsSync(path.join(target, 'apps/example.mjs')), true);
    assert.equal(existsSync(path.join(target, '.capri-install.json')), true);
    assert.equal(readFileSync(path.join(target, 'data/history.txt'), 'utf8'), 'private canary');
    assert.equal(readFileSync(outsideFile).equals(Buffer.alloc(7 * 1024 ** 2, 9)), true);
  },
);

test(
  'uninstall rejects a linked install root or ancestor before mutating owned source',
  { skip: !windows },
  () => {
    for (const ancestor of [false, true]) {
      const target = uninstallFixture(),
        aliases = folder();
      const link = path.join(aliases, 'linked-root');
      symlinkSync(ancestor ? path.dirname(target) : target, link, 'junction');
      const selected = ancestor ? path.join(link, path.basename(target)) : link;
      const result = ps('packages/installer/windows/uninstall.ps1', [
        '-InstallRoot',
        selected,
        '-Quiet',
      ]);
      assert.notEqual(result.status, 0);
      assert.equal(readFileSync(path.join(target, 'apps/example.mjs'), 'utf8'), 'original code');
      assert.equal(existsSync(path.join(target, '.capri-install.json')), true);
      assert.equal(readFileSync(path.join(target, 'data/history.txt'), 'utf8'), 'private canary');
      assert.equal(lstatSync(link).isSymbolicLink(), true);
    }
  },
);
test(
  'cached recovery uninstaller works after in-app metadata was removed',
  { skip: !windows },
  () => {
    const target = uninstallFixture(),
      recovery = folder();
    for (const file of ['common.ps1', 'uninstall.ps1', 'shell-link.cs'])
      copyFileSync(path.join(root, 'packages/installer/windows', file), path.join(recovery, file));
    copyFileSync(
      path.join(target, 'config/installer.json'),
      path.join(recovery, 'installer-config.json'),
    );
    copyFileSync(
      path.join(target, '.runtime/installer/source-files.json'),
      path.join(recovery, 'source-files.json'),
    );
    const ownedLink = path.join(recovery, 'Capri 東京.lnk'),
      foreignLink = path.join(recovery, 'Other приложение.lnk'),
      foreignTarget = path.join(recovery, 'other.exe'),
      prepare = path.join(recovery, 'prepare-shortcuts.ps1');
    writeFileSync(foreignTarget, 'foreign target canary');
    writeFileSync(
      prepare,
      `param([string]$Recovery,[string]$InstallRoot,[string]$OwnedLink,[string]$ForeignLink,[string]$ForeignTarget)
$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $Recovery 'shell-link.cs')
[Capri.Setup.Shortcuts]::Save($OwnedLink,(Join-Path $InstallRoot 'Capri.exe'),$InstallRoot,'Capri test')
[Capri.Setup.Shortcuts]::Save($ForeignLink,$ForeignTarget,$Recovery,'Other app test')
`,
    );
    const prepared = ps(prepare, [
      '-Recovery',
      recovery,
      '-InstallRoot',
      target,
      '-OwnedLink',
      ownedLink,
      '-ForeignLink',
      foreignLink,
      '-ForeignTarget',
      foreignTarget,
    ]);
    assert.equal(prepared.status, 0, prepared.stderr);
    const redirectedDirectory = folder();
    const redirectedShortcut = path.join(redirectedDirectory, 'Capri redirected.lnk');
    copyFileSync(ownedLink, redirectedShortcut);
    const redirect = path.join(recovery, 'linked-desktop');
    symlinkSync(redirectedDirectory, redirect, 'junction');
    const invalidShortcut = path.join(recovery, 'Invalid Capri shortcut.lnk');
    writeFileSync(invalidShortcut, 'invalid shortcut canary');
    const identity = JSON.parse(readFileSync(path.join(target, '.capri-install.json'), 'utf8'));
    writeJsonAtomic(path.join(recovery, 'registration.json'), {
      registry: 'HKCU:\\Software\\CapriInstallerTests\\' + identity.installId,
      shortcuts: [
        ownedLink,
        foreignLink,
        path.join(redirect, path.basename(redirectedShortcut)),
        invalidShortcut,
      ],
      installId: identity.installId,
    });
    // Remove metadata as if an earlier uninstall had already removed those source/cache files.
    const remove = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import {unlinkSync} from 'node:fs'; for(const file of process.argv.slice(1))unlinkSync(file)",
        path.join(target, 'config/installer.json'),
        path.join(target, '.runtime/installer/source-files.json'),
      ],
      { windowsHide: true },
    );
    assert.equal(remove.status, 0);
    const result = ps(path.join(recovery, 'uninstall.ps1'), ['-InstallRoot', target, '-Quiet']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(path.join(target, 'data/history.txt'), 'utf8'), 'private canary');
    assert.equal(existsSync(ownedLink), false);
    assert.equal(existsSync(foreignLink), true);
    assert.equal(existsSync(redirectedShortcut), true);
    assert.equal(readFileSync(invalidShortcut, 'utf8'), 'invalid shortcut canary');
    assert.equal(readFileSync(foreignTarget, 'utf8'), 'foreign target canary');
  },
);

test(
  'a bound recovery launcher remains usable for a second removal without an in-folder launcher',
  { skip: !windows },
  () => {
    const target = uninstallFixture();
    const recovery = path.join(target, 'verification', 'recovery');
    const launcher = path.join(recovery, 'uninstall.exe');
    const identityFile = path.join(target, '.capri-install.json');
    const sourceReceipt = path.join(target, '.runtime/installer/source-files.json');
    const registrationFile = path.join(target, '.runtime/installer/registration.json');
    const identity = JSON.parse(readFileSync(identityFile, 'utf8'));
    mkdirSync(recovery, { recursive: true });
    writeFileSync(launcher, 'recovery launcher canary');
    for (const file of ['common.ps1', 'uninstall.ps1'])
      copyFileSync(path.join(root, 'packages/installer/windows', file), path.join(recovery, file));
    copyFileSync(sourceReceipt, path.join(recovery, 'source-files.json'));
    const registration = {
      registry: 'HKCU:\\Software\\CapriInstallerTests\\' + identity.installId,
      root: target,
      recovery,
      installId: identity.installId,
      shortcuts: [],
    };
    writeJsonAtomic(registrationFile, registration);
    writeJsonAtomic(path.join(recovery, 'registration.json'), registration);

    const profile = folder();
    const wrapper = path.join(profile, 'remove.ps1');
    writeFileSync(
      wrapper,
      `param($Uninstaller,$Root,[switch]$Complete)
$env:LOCALAPPDATA=$PSScriptRoot
$env:APPDATA=$PSScriptRoot
& $Uninstaller -InstallRoot $Root -Quiet -DeleteData:$Complete
if(-not $?){exit 1}
`,
    );
    const run = (complete) =>
      ps(wrapper, [
        path.join(recovery, 'uninstall.ps1'),
        target,
        ...(complete ? ['-Complete'] : []),
      ]);
    const partial = run(false);
    assert.equal(partial.status, 0, partial.stderr);
    assert.equal(readFileSync(launcher, 'utf8'), 'recovery launcher canary');
    assert.equal(existsSync(identityFile), true);
    assert.equal(existsSync(registrationFile), false);
    assert.equal(readFileSync(path.join(target, 'data/history.txt'), 'utf8'), 'private canary');

    const complete = run(true);
    assert.equal(complete.status, 0, complete.stderr);
    assert.equal(existsSync(launcher), false);
    assert.equal(existsSync(identityFile), false);
    assert.equal(existsSync(path.join(target, 'data')), false);
  },
);

test(
  'native voice preflight rejects an empty source folder before Node bootstrap',
  { skip: !windows },
  () => {
    const session = folder(),
      source = path.join(session, 'пустой голос'),
      target = path.join(session, 'application');
    mkdirSync(source);
    const requestFile = path.join(session, 'request.json'),
      eventsFile = path.join(session, 'events.jsonl');
    writeFileSync(eventsFile, '');
    writeJsonAtomic(requestFile, {
      schemaVersion: 1,
      target,
      voicePack: source,
      acceptLicense: true,
      acceptDownloads: true,
    });
    const result = ps('packages/installer/windows/worker.ps1', [
      '-RequestFile',
      requestFile,
      '-EventsFile',
      eventsFile,
      '-CancelFile',
      path.join(session, 'cancel'),
    ]);
    assert.notEqual(result.status, 0);
    const events = readFileSync(eventsFile, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(events.at(-1).code, 'VOICE_PACK_PROFILE_MISSING');
    assert.equal(
      events.some((event) => event.type === 'download'),
      false,
    );
    assert.equal(existsSync(target), false);
  },
);
test(
  'native download retries transient EOF but preserves validation failures and cancellation',
  { skip: !windows },
  () => {
    const session = folder(),
      script = path.join(session, 'retry.ps1');
    const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
    writeFileSync(
      script,
      `. ${literal(path.join(root, 'packages/installer/windows/common.ps1'))}
$script:count=0
$spec=(Read-CapriJson ${literal(path.join(root, 'config/installer.json'))}).artifacts.node
$sources=@(Get-CapriNodeBootstrapSources $spec)
$result=Invoke-CapriDownloadRetry -DelayMilliseconds 0 -Operation {
    param($Attempt)
    $script:count++
    $source=$sources[($Attempt-1)%$sources.Count]
    if($Attempt -eq 1 -and ([Uri]$source).Host -eq 'nodejs.org'){throw (New-Object IO.EndOfStreamException('fixture EOF'))}
    if(([Uri]$source).Host -ne 'cdn.npmmirror.com'){throw 'Expected the approved Node mirror.'}
    'verified'
}
if($result -ne 'verified' -or $script:count -ne 2){throw 'Transient download did not retry correctly'}
$spec.mirrors=@('https://cdn.npmmirror.com/not-the-pinned-archive.zip')
$wrongMirrorAccepted=$false
try {$null=Get-CapriNodeBootstrapSources $spec;$wrongMirrorAccepted=$true}catch{}
if($wrongMirrorAccepted){throw 'A mismatched mirror must be rejected.'}
$script:count=0
try {Invoke-CapriDownloadRetry -DelayMilliseconds 0 -Operation {$script:count++;throw 'checksum mismatch'}}catch{}
if($script:count -ne 1){throw 'A validation failure must not be retried'}
$script:count=0;$script:cancelled=$false
try {Invoke-CapriDownloadRetry -DelayMilliseconds 0 -Cancelled {$script:cancelled} -Operation {$script:count++;$script:cancelled=$true;throw (New-Object IO.EndOfStreamException('fixture EOF'))}}catch{}
if($script:count -ne 1){throw 'A cancelled download must not retry'}
`,
      'utf8',
    );
    const result = ps(script);
    assert.equal(result.status, 0, result.stderr);
  },
);

test(
  'native download wait resumes promptly and still bounds stalled reads and cancellation',
  { skip: !windows },
  () => {
    const session = folder(),
      script = path.join(session, 'wait.ps1');
    const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
    writeFileSync(
      script,
      `. ${literal(path.join(root, 'packages/installer/windows/common.ps1'))}
$watch=[Diagnostics.Stopwatch]::StartNew()
for($index=0;$index -lt 25;$index++){
    Wait-CapriDownloadTask ([Threading.Tasks.Task]::Delay(2))
}
if($watch.ElapsedMilliseconds -ge 2000){throw 'Completed reads are waiting for a fixed polling interval.'}
$pending=New-Object 'Threading.Tasks.TaskCompletionSource[int]'
$watch.Restart()
try {Wait-CapriDownloadTask $pending.Task -TimeoutMilliseconds 150;throw 'Stalled read was accepted'}
catch {if($_.Exception.ToString() -notmatch 'stopped responding'){throw}}
if($watch.ElapsedMilliseconds -gt 2000){throw 'Stalled read timeout was not bounded.'}
$watch.Restart()
try {Wait-CapriDownloadTask $pending.Task -Cancelled {$watch.ElapsedMilliseconds -ge 50};throw 'Cancelled read was accepted'}
catch {if($_.Exception.ToString() -notmatch 'Installation cancelled'){throw}}
if($watch.ElapsedMilliseconds -gt 1500){throw 'Cancellation did not wake a stalled read.'}
$broken=New-Object 'Threading.Tasks.TaskCompletionSource[int]'
$broken.SetException((New-Object IO.EndOfStreamException('read failed fixture')))
try {Wait-CapriDownloadTask $broken.Task;throw 'Failed read was accepted'}
catch {if($_.Exception.Message -notmatch 'read failed fixture'){throw}}
`,
      'utf8',
    );
    const result = ps(script);
    assert.equal(result.status, 0, result.stderr);
  },
);

test(
  'location browsing chooses an automatic Capri subfolder and retains existing managed installs',
  { skip: !windows },
  () => {
    const parent = folder(),
      script = path.join(parent, 'location.ps1');
    const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
    writeFileSync(
      script,
      '\uFEFF' +
        `. ${literal(path.join(root, 'packages/installer/windows/common.ps1'))}
. ${literal(path.join(root, 'packages/installer/windows/install-discovery.ps1'))}
if((Get-CapriDefaultTarget) -ne (Join-Path $env:LOCALAPPDATA 'Programs/Capri')){throw 'New installations must default to a per-user folder.'}
if((Get-Content -LiteralPath ${literal(path.join(root, 'packages/installer/windows/launcher.manifest'))} -Raw) -notmatch 'requestedExecutionLevel level="asInvoker"'){throw 'Setup must run with the current user token.'}
$parent=${literal(parent)}
$source=${literal(root)}
[IO.File]::WriteAllText((Join-Path $parent 'unrelated.txt'),'preserve')
$expected=Join-Path $parent 'Capri'
$target=Resolve-CapriInstallFolder $parent $source '0.3.0'
if($target -ne $expected){throw 'A parent folder must select its Capri child.'}
if(Test-Path -LiteralPath $target){throw 'Browsing must not create folders before installation consent.'}
[IO.Directory]::CreateDirectory($target)|Out-Null
if((Resolve-CapriInstallFolder $target $source '0.3.0') -ne $target){throw 'Do not nest Capri folders.'}
Write-CapriJson (Join-Path $target '.capri-install.json') @{schemaVersion=1;productId='capri.desktop';root=$target;version='0.3.0';installId=[Guid]::NewGuid().ToString()}
if((Resolve-CapriInstallFolder $target $source '0.3.0') -ne $target){throw 'Existing managed installation was not retained.'}
$other=Join-Path $parent 'occupied'
[IO.Directory]::CreateDirectory((Join-Path $other 'Capri'))|Out-Null
[IO.File]::WriteAllText((Join-Path $other 'Capri/private.txt'),'private canary')
try{Resolve-CapriInstallFolder $other $source '0.3.0';throw 'Unrelated files were accepted'}catch{if($_.Exception.Message -notmatch 'unrelated'){throw}}
if([IO.File]::ReadAllText((Join-Path $other 'Capri/private.txt')) -ne 'private canary'){throw 'Browsing modified existing files.'}
`,
      'utf8',
    );
    const result = ps(script);
    assert.equal(result.status, 0, result.stderr);
  },
);
