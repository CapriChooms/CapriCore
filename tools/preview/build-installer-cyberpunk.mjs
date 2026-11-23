// SPDX-License-Identifier: GPL-3.0-only
// Build a complete installer from a disposable, appearance-only source variant.
// The ordinary wizard, release builder, launcher and previous EXE are never rewritten.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { root, writeJsonAtomic } from '../../packages/runtime/src/index.mjs';
import { noLinks } from '../../packages/installer/src/policy.mjs';
import { validateVoicePack } from '../../packages/installer/src/voice-pack.mjs';
import { exportSource, hasSourceCredential } from '../release/source-export.mjs';
import { exportVoicePack } from '../release/voice-pack-export.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const hash = (file) => digest(readFileSync(file));
const json = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const visualTypes = [
  'Button',
  'CheckBox',
  'RadioButton',
  'ComboBox',
  'ProgressBar',
  'Panel',
  'Label',
  'TextBox',
];
const themeFiles = [
  'cyberpunk-theme.cs',
  'cyberpunk-theme.ps1',
  'cyberpunk-preview.cs',
  'cyberpunk-preview.ps1',
];
const windowsFolder = 'packages/installer/windows/';
const wizardPath = windowsFolder + 'wizard-ui.ps1';
const budgetPath = windowsFolder + 'memory-budget-ui.ps1';

function inside(parent, file) {
  const relative = path.relative(parent, file);
  assert.ok(
    relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    'Preview paths must stay in release.',
  );
  noLinks(file);
  return file;
}

/** Exact reversible substitutions; no installation expression or handler is edited. */
export function transformPreviewSource(original, { wizard = false, budget = false } = {}) {
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  let text = original;
  const production = original.includes('New-Object Capri.Setup.Cyberpunk.');
  const originalNamespace = production ? 'Capri.Setup.Cyberpunk' : 'Windows.Forms';
  const patches = [];
  const replaceOnce = (before, after, name) => {
    assert.equal(text.split(before).length - 1, 1, `Expected one ${name} anchor.`);
    text = text.replace(before, after);
    patches.push({ before, after, name, count: 1 });
  };
  for (const type of visualTypes) {
    const before = `New-Object ${originalNamespace}.${type}`;
    const after = `New-Object Capri.Setup.Preview.${type}`;
    const pattern = new RegExp(
      `\\bNew-Object ${originalNamespace.replaceAll('.', '\\.')}\\.${type}\\b`,
      'g',
    );
    const count = [...text.matchAll(pattern)].length;
    if (!count) continue;
    text = text.replace(pattern, after);
    patches.push({ before, after, name: `constructor:${type}`, count });
  }
  assert.ok(patches.length, 'No reviewed visual constructors were found.');
  if (budget && !production) {
    for (const [before, after] of [
      ['203,218,222', '23,49,61'],
      ['122,140,149', '73,98,113'],
      ['188,80,38', '255,196,94'],
      ['0,124,137', '109,247,242'],
    ])
      replaceOnce(
        `[Drawing.Color]::FromArgb(${before})`,
        `[Drawing.Color]::FromArgb(${after})`,
        `palette:${before}`,
      );
  }
  if (wizard) {
    if (production) {
      replaceOnce(
        ". (Join-Path $PSScriptRoot 'cyberpunk-theme.ps1')",
        ". (Join-Path $PSScriptRoot 'cyberpunk-preview.ps1')",
        'theme import',
      );
      replaceOnce(
        'Initialize-CapriCyberpunkTheme $form $sidebar $body $footer $brand $releaseLabel $steps $back $next $cancel $pause',
        'Initialize-CapriCyberpunkPreview $form $sidebar $body $footer $brand $releaseLabel $steps $back $next $cancel $pause',
        'theme initialization',
      );
      replaceOnce(
        'Update-CapriCyberpunkTheme $form',
        'Update-CapriCyberpunkPreview $form',
        'theme refresh',
      );
    } else {
      replaceOnce(
        '[Windows.Forms.Application]::EnableVisualStyles()',
        '[Windows.Forms.Application]::EnableVisualStyles()' +
          newline +
          ". (Join-Path $PSScriptRoot 'cyberpunk-preview.ps1')",
        'theme import',
      );
      replaceOnce(
        '$existingSession=Get-CapriCurrentSession',
        'Initialize-CapriCyberpunkPreview $form $sidebar $body $footer $brand $releaseLabel $steps $back $next $cancel $pause' +
          newline +
          '$existingSession=Get-CapriCurrentSession',
        'theme initialization',
      );
      replaceOnce(
        '    if($script:uiLease -and $script:uiLease.IsOwner()){$script:uiLease.Window($form.Handle.ToInt64())}',
        '    Update-CapriCyberpunkPreview $form' +
          newline +
          '    if($script:uiLease -and $script:uiLease.IsOwner()){$script:uiLease.Window($form.Handle.ToInt64())}',
        'theme refresh',
      );
    }
  }
  let normalized = text;
  for (const patch of [...patches].reverse()) {
    assert.equal(
      normalized.split(patch.after).length - 1,
      patch.count,
      `Unexpected ${patch.name} substitutions.`,
    );
    normalized = normalized.split(patch.after).join(patch.before);
  }
  assert.equal(normalized, original, 'Appearance normalization changed original wizard logic.');
  assert.equal(hasSourceCredential(text), false, 'The staged UI contains credential-like content.');
  return { text, normalized, patches: patches.map(({ name, count }) => ({ name, count })) };
}

function runPowerShell(args, name, timeout = 180000) {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout,
      maxBuffer: 1024 * 1024,
      // A PowerShell 7 caller can export incompatible module search paths to
      // Windows PowerShell 5.1. The build needs only its system modules.
      env: {
        ...process.env,
        PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules'),
      },
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(`${name} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function checkPowerShell(original, staged, normalized, report, folder) {
  const script = path.join(folder, 'check-appearance-equivalence.ps1');
  writeFileSync(
    script,
    `param([string]$Original,[string]$Staged,[string]$Normalized,[string]$Report)
$ErrorActionPreference='Stop'
$parsed=@{}
foreach($pair in @(@('original',$Original),@('preview',$Staged),@('normalized',$Normalized))){
    $tokens=$null;$errors=$null
    $ast=[Management.Automation.Language.Parser]::ParseFile($pair[1],[ref]$tokens,[ref]$errors)
    if($errors.Count){throw ('PowerShell parsing failed for '+$pair[0]+': '+$errors[0].Message)}
    $parsed[$pair[0]]=@{tokens=@($tokens|ForEach-Object{[string]$_.Kind+'|'+$_.Text});nodes=@($ast.FindAll({param($node)$true},$true)).Count}
}
if(-not [string]::Equals([IO.File]::ReadAllText($Original),[IO.File]::ReadAllText($Normalized),[StringComparison]::Ordinal)){throw 'Reversed visual edits differ from the original script.'}
if(($parsed.original.tokens -join "\n") -cne ($parsed.normalized.tokens -join "\n")){throw 'Normalized PowerShell tokens differ.'}
@{passed=$true;normalizedTokensEqual=$true;originalTokens=$parsed.original.tokens.Count;previewTokens=$parsed.preview.tokens.Count;originalAstNodes=$parsed.original.nodes;previewAstNodes=$parsed.preview.nodes}|ConvertTo-Json|Set-Content -LiteralPath $Report -Encoding UTF8
`,
    'utf8',
  );
  runPowerShell(
    [
      '-File',
      script,
      '-Original',
      original,
      '-Staged',
      staged,
      '-Normalized',
      normalized,
      '-Report',
      report,
    ],
    'PowerShell appearance equivalence',
    30000,
  );
  return json(report);
}

function walk(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), 'Preview payload cannot contain links.');
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...walk(path.join(directory, entry.name), relative + '/'));
    else if (entry.isFile()) files.push(relative);
    else throw new Error('Unexpected preview payload entry.');
  }
  return files.sort();
}

export function buildCyberpunkPreview({ voicePack, baseline, baselineSha256, stageOnly = false }) {
  assert.equal(process.platform, 'win32', 'The native preview is built on Windows.');
  assert.match(baselineSha256 ?? '', /^[a-f0-9]{64}$/);
  const releaseRoot = path.join(root, 'release');
  baseline = inside(releaseRoot, path.resolve(baseline));
  assert.ok(lstatSync(baseline).isFile(), 'Choose an existing installer baseline.');
  assert.equal(hash(baseline), baselineSha256, 'The baseline installer hash does not match.');
  voicePack = inside(releaseRoot, path.resolve(voicePack));
  const { version } = json(path.join(root, 'package.json'));
  const themeHashes = Object.fromEntries(
    themeFiles.map((name) => {
      const file = path.join(root, windowsFolder, name);
      assert.ok(lstatSync(file).isFile(), 'The preview theme must be ready before building.');
      return [windowsFolder + name, hash(file)];
    }),
  );
  const exported = exportSource(); // Same source privacy, ownership and voice gates as normal releases.
  const parent = path.join(releaseRoot, 'previews');
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(path.join(parent, `installer-cyberpunk-${version}-`));
  const source = path.join(folder, 'source');
  inside(releaseRoot, exported.destination);
  inside(releaseRoot, source);
  renameSync(exported.destination, source);
  const originalManifest = json(path.join(source, 'SOURCE_MANIFEST.json'));
  const equivalence = [];
  for (const name of [wizardPath, budgetPath]) {
    const file = path.join(source, name);
    const before = readFileSync(file, 'utf8');
    const transformed = transformPreviewSource(before, {
      wizard: name === wizardPath,
      budget: name === budgetPath,
    });
    const original = path.join(folder, path.basename(name) + '.original');
    const normalized = path.join(folder, path.basename(name) + '.normalized');
    const parserReport = path.join(folder, path.basename(name) + '.parser.json');
    writeFileSync(original, before, 'utf8');
    writeFileSync(normalized, transformed.normalized, 'utf8');
    writeFileSync(file, transformed.text, 'utf8');
    equivalence.push({
      path: name,
      beforeSha256: digest(before),
      afterSha256: hash(file),
      patches: transformed.patches,
      parser: checkPowerShell(original, file, normalized, parserReport, folder),
    });
  }
  const files = originalManifest.files.map((entry) => {
    const file = path.join(source, entry.path);
    const bytes = statSync(file).size;
    const sha256 = hash(file);
    if (![wizardPath, budgetPath].includes(entry.path)) {
      assert.equal(bytes, entry.bytes, entry.path);
      assert.equal(sha256, entry.sha256, entry.path);
    }
    return { path: entry.path, bytes, sha256 };
  });
  assert.deepEqual(
    walk(source).filter((name) => name !== 'SOURCE_MANIFEST.json'),
    files.map(({ path }) => path).sort(),
  );
  for (const [name, sha256] of Object.entries(themeHashes))
    assert.equal(hash(path.join(source, name)), sha256);
  writeJsonAtomic(path.join(source, 'SOURCE_MANIFEST.json'), { ...originalManifest, files });
  if (stageOnly) {
    assert.equal(hash(baseline), baselineSha256);
    writeJsonAtomic(path.join(folder, 'APPEARANCE_EQUIVALENCE.json'), {
      passed: true,
      sourceFiles: files.length,
      changedFiles: equivalence,
      themeHashes,
      baselineUnchanged: true,
    });
    return {
      passed: true,
      stageOnly: true,
      folder,
      source,
      sourceFiles: files.length,
      baselineUnchanged: true,
    };
  }
  const voice = exportVoicePack({
    source: voicePack,
    destination: path.join(folder, 'voice-pack'),
  });
  const output = path.join(folder, 'build');
  mkdirSync(output);
  runPowerShell(
    [
      '-File',
      path.join(root, 'tools/release/build-installer.ps1'),
      '-Source',
      source,
      '-Destination',
      output,
      '-Version',
      version,
      '-VoicePack',
      voice.directory,
    ],
    'Preview installer compilation',
  );
  const built = path.join(output, `CapriSetup-${version}.exe`);
  const executable = path.join(output, `CapriSetup-${version}-DesignPreview.exe`);
  renameSync(built, executable);
  const sourceZip = path.join(output, `Capri-${version}-DesignPreview-source.zip`);
  copyFileSync(path.join(output, 'source.zip'), sourceZip);
  const voiceZip = path.join(output, voice.manifest.id + '.zip');
  copyFileSync(path.join(output, 'voice.zip'), voiceZip);
  const extracted = path.join(folder, 'extracted');
  mkdirSync(extracted);
  const extractRunner = path.join(folder, 'extract-preview.ps1');
  writeFileSync(
    extractRunner,
    `param([string]$Exe,[string]$Destination)
$ErrorActionPreference='Stop'
$process=Start-Process -FilePath $Exe -ArgumentList @('--extract-only',('"'+$Destination+'"')) -WindowStyle Hidden -Wait -PassThru
if($process.ExitCode -ne 0){throw ('Preview extraction failed: '+$process.ExitCode)}
@{exitCode=$process.ExitCode;version=(Get-Item -LiteralPath $Exe).VersionInfo.FileVersion;signature=(Get-AuthenticodeSignature -LiteralPath $Exe).Status.ToString()}|ConvertTo-Json -Compress
`,
    'utf8',
  );
  const extraction = JSON.parse(
    runPowerShell(
      ['-File', extractRunner, '-Exe', executable, '-Destination', extracted],
      'Preview extraction',
    ),
  );
  assert.equal(extraction.version, version + '.0');
  assert.deepEqual(json(path.join(extracted, 'SOURCE_MANIFEST.json')), {
    ...originalManifest,
    files,
  });
  for (const entry of files) {
    assert.equal(statSync(path.join(extracted, entry.path)).size, entry.bytes, entry.path);
    assert.equal(hash(path.join(extracted, entry.path)), entry.sha256, entry.path);
  }
  const upstream = json(path.join(root, 'config/voice-upstream.json'));
  validateVoicePack(path.join(extracted, '.bundled-voice'), upstream.model);
  for (const entry of voice.manifest.files)
    assert.equal(
      hash(path.join(extracted, '.bundled-voice', entry.path)),
      entry.sha256,
      entry.path,
    );
  const expected = [
    ...files.map(({ path }) => path),
    'SOURCE_MANIFEST.json',
    ...walk(voice.directory).map((name) => '.bundled-voice/' + name),
  ].sort();
  assert.deepEqual(walk(extracted), expected, 'Unexpected data in the extracted preview.');
  assert.equal(
    hash(baseline),
    baselineSha256,
    'The existing installer changed during preview build.',
  );
  const manifest = {
    schemaVersion: 1,
    kind: 'appearance-only-installer-preview',
    version,
    releaseTag: json(path.join(source, 'config/release.json')).tag,
    executable: path.basename(executable),
    sha256: hash(executable),
    sourceFiles: files.length,
    sourcePayloadSha256: hash(sourceZip),
    sourcePrivacyChecks: true,
    extractedSourceHashes: true,
    noInstallationPerformed: true,
    noPublicationPerformed: true,
    extraction,
    baseline: { file: path.basename(baseline), sha256: baselineSha256, unchanged: true },
    untouchedSourceFiles: files.length - equivalence.length,
    changedFiles: equivalence,
    themeHashes,
    bundledVoice: {
      ...voice.manifest,
      file: path.basename(voiceZip),
      bytes: statSync(voiceZip).size,
      sha256: hash(voiceZip),
    },
  };
  writeJsonAtomic(path.join(output, 'PREVIEW_BUILD_MANIFEST.json'), manifest);
  const artifacts = [
    executable,
    sourceZip,
    voiceZip,
    path.join(output, 'PREVIEW_BUILD_MANIFEST.json'),
  ];
  writeFileSync(
    path.join(output, 'SHA256SUMS.txt'),
    artifacts.map((file) => hash(file) + '  ' + path.basename(file)).join('\n') + '\n',
  );
  return {
    passed: true,
    folder,
    executable,
    extracted,
    manifest: path.join(output, 'PREVIEW_BUILD_MANIFEST.json'),
    sha256: manifest.sha256,
    sourceFiles: files.length,
    baselineUnchanged: true,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  let stageOnly = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === '--stage-only' && !stageOnly) {
      stageOnly = true;
      continue;
    }
    const match = /^--(voice-pack|baseline|baseline-sha256)=(.+)$/.exec(arg);
    if (!match || options[match[1]])
      throw new Error('Use --voice-pack, --baseline and --baseline-sha256 once each.');
    options[match[1]] = match[2];
  }
  assert.equal(
    Object.keys(options).length,
    3,
    'Provide the approved voice pack and previous installer with its SHA256.',
  );
  console.log(
    JSON.stringify(
      buildCyberpunkPreview({
        voicePack: options['voice-pack'],
        baseline: options.baseline,
        baselineSha256: options['baseline-sha256'],
        stageOnly,
      }),
    ),
  );
}
