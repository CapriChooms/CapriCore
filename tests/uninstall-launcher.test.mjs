// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  unlinkSync,
  existsSync,
  linkSync,
  symlinkSync,
} from 'node:fs';
import { root } from '../packages/runtime/src/host/paths.mjs';

const windows = process.platform === 'win32';
const parent = path.join(root, '.runtime/uninstall-launcher-tests');
mkdirSync(parent, { recursive: true });
const folder = () => mkdtempSync(path.join(parent, 'case-'));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const names = [
  'uninstall.ps1',
  'uninstall-window.cs',
  'cyberpunk-theme.cs',
  'common.ps1',
  'shell-link.cs',
  'localization.ps1',
  'uninstaller-text.json',
  'installer-config.json',
  'source-files.json',
  'registration.json',
  'app.ico',
];
const put = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, value);
};
const json = (file, value) => put(file, JSON.stringify(value));
const csharp = (value) => '@"' + value.replaceAll('"', '""') + '"';

function fixture({ legacy = false } = {}) {
  const base = folder(),
    install = path.join(base, 'Capri 東京 Пример'),
    id = randomUUID();
  const currentParent = path.join(base, 'current-profile/Capri/Uninstall');
  const legacyRecovery = path.join(base, 'old-profile/Capri/Uninstall', id);
  const recovery = legacy ? legacyRecovery : path.join(currentParent, id);
  const scripts = path.join(install, 'packages/installer/windows');
  const metadata = path.join(install, '.runtime/installer');
  const installedFile = (name) =>
    name === 'installer-config.json'
      ? path.join(install, 'config/installer.json')
      : name === 'uninstaller-text.json'
        ? path.join(install, 'config', name)
        : ['source-files.json', 'registration.json'].includes(name)
          ? path.join(metadata, name)
          : name === 'app.ico'
            ? path.join(install, 'assets/default', name)
            : path.join(scripts, name);
  const entries = [];
  for (const name of names.filter(
    (name) => !['source-files.json', 'registration.json'].includes(name),
  )) {
    const file = installedFile(name),
      bytes = Buffer.from(
        name.endsWith('.json') ? '{"fixture":true}' : 'synthetic resolver-only fixture: ' + name,
      );
    put(file, bytes);
    entries.push({
      path: path.relative(install, file).split(path.sep).join('/'),
      sha256: digest(bytes),
    });
  }
  json(path.join(install, '.capri-install.json'), {
    productId: 'capri.desktop',
    root: install,
    installId: id,
    version: '1.0.0',
  });
  json(installedFile('source-files.json'), { files: entries });
  const registration = {
    installId: id,
    root: install,
    recovery,
    shortcuts: [],
    registry: 'HKCU:\\Software\\CapriInstallerTests\\' + id,
  };
  json(installedFile('registration.json'), registration);
  mkdirSync(recovery, { recursive: true });
  for (const name of names) copyFileSync(installedFile(name), path.join(recovery, name));
  return {
    base,
    install,
    id,
    currentParent,
    legacyRecovery,
    recovery,
    scripts,
    installedFile,
    registration,
  };
}

let legacyHarness;
function compileHarness(bundleHashes) {
  if (!bundleHashes && legacyHarness) return legacyHarness;
  const base = folder(),
    generated = path.join(base, 'Generated.cs'),
    harness = path.join(base, 'Harness.cs');
  writeFileSync(
    generated,
    'internal static class CapriUninstallInfo { internal const string Recovery = "";' +
      (bundleHashes
        ? ' internal const string BundleHashes=' + csharp(JSON.stringify(bundleHashes)) + ';'
        : '') +
      '}',
  );
  writeFileSync(
    harness,
    `using System; using System.IO; using System.Reflection;
internal static class ResolverHarness {
  public static int Main(string[] args) {
    try {
      Console.OutputEncoding = new System.Text.UTF8Encoding(false);
      if(args.Length == 4 && args[0] == "--assembly") {
        Assembly assembly = Assembly.LoadFrom(args[1]);
        Type type = assembly.GetType("CapriUninstallLauncher", true);
        MethodInfo resolver = type.GetMethod("ResolveScript", BindingFlags.Static | BindingFlags.NonPublic);
        Console.WriteLine((string)resolver.Invoke(null, new object[]{args[2], Path.Combine(args[2], "missing-profile"), args[3]}) ?? "MISSING");
      } else if(args.Length == 3 && args[0] == "--launch-root") {
        Assembly assembly = Assembly.LoadFrom(args[1]);
        Type type = assembly.GetType("CapriUninstallLauncher", true);
        MethodInfo resolver = type.GetMethod("LauncherRoot", BindingFlags.Static | BindingFlags.NonPublic);
        Console.WriteLine((string)resolver.Invoke(null, new object[]{args[2]}) ?? "MISSING");
      } else Console.WriteLine(CapriUninstallLauncher.ResolveScript(args[0],args[1],args[2]) ?? "MISSING");
      return 0;
    } catch(Exception error) { Console.Error.WriteLine(error.GetType().Name); return 1; }
  }
}`,
  );
  const exe = path.join(base, 'resolver-only.exe');
  const csc = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const result = spawnSync(
    csc,
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/main:ResolverHarness',
      '/out:' + exe,
      '/reference:System.Windows.Forms.dll',
      '/reference:System.Drawing.dll',
      '/reference:System.Web.Extensions.dll',
      '/reference:Microsoft.CSharp.dll',
      path.join(root, 'packages/installer/windows/uninstall-launcher.cs'),
      path.join(root, 'packages/installer/windows/setup-localization.cs'),
      path.join(root, 'packages/installer/windows/uninstall-window.cs'),
      path.join(root, 'packages/installer/windows/cyberpunk-theme.cs'),
      generated,
      harness,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  if (!bundleHashes) legacyHarness = exe;
  return exe;
}
function resolve(
  f,
  exe = compileHarness(),
  legacyRecovery = f.legacyRecovery,
  currentParent = f.currentParent,
) {
  const result = spawnSync(exe, [f.install, currentParent, legacyRecovery], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test(
  'native uninstall resolver prefers the complete current-profile bundle and never executes a script',
  { skip: !windows },
  () => {
    const f = fixture();
    assert.equal(resolve(f), path.join(f.recovery, 'uninstall.ps1'));
    assert.equal(
      readFileSync(f.installedFile('uninstall.ps1'), 'utf8'),
      'synthetic resolver-only fixture: uninstall.ps1',
    );
  },
);

test(
  'native uninstall resolver supports a bound legacy recovery path and missing-profile installed fallback',
  { skip: !windows },
  () => {
    const legacy = fixture({ legacy: true });
    assert.equal(resolve(legacy), path.join(legacy.recovery, 'uninstall.ps1'));
    const missing = fixture();
    unlinkSync(path.join(missing.recovery, 'uninstall.ps1'));
    assert.equal(resolve(missing), missing.installedFile('uninstall.ps1'));
  },
);

test(
  'partial, modified, or foreign-root recovery bundles cannot be executed',
  { skip: !windows },
  () => {
    for (const cause of ['incomplete', 'modified', 'foreign-root', 'foreign-id']) {
      const f = fixture();
      if (cause === 'incomplete') unlinkSync(path.join(f.recovery, 'common.ps1'));
      if (cause === 'modified')
        writeFileSync(path.join(f.recovery, 'uninstall.ps1'), '# changed outside the install');
      if (cause.startsWith('foreign-'))
        json(path.join(f.recovery, 'registration.json'), {
          ...f.registration,
          ...(cause === 'foreign-root' ? { root: f.base } : { installId: randomUUID() }),
        });
      assert.equal(resolve(f), f.installedFile('uninstall.ps1'), cause);
      unlinkSync(f.installedFile('common.ps1'));
      assert.equal(resolve(f), 'MISSING', cause + ' cannot bypass incomplete installed files');
    }
  },
);

test(
  'native uninstall resolver rejects linked recovery files and linked ancestors without touching their targets',
  { skip: !windows },
  () => {
    const hard = fixture(),
      outside = path.join(hard.base, 'outside-canary');
    copyFileSync(path.join(hard.recovery, 'uninstall.ps1'), outside);
    unlinkSync(path.join(hard.recovery, 'uninstall.ps1'));
    linkSync(outside, path.join(hard.recovery, 'uninstall.ps1'));
    assert.equal(resolve(hard), hard.installedFile('uninstall.ps1'));
    assert.equal(readFileSync(outside, 'utf8'), 'synthetic resolver-only fixture: uninstall.ps1');
    const linked = fixture(),
      alias = path.join(linked.base, 'linked-profile');
    symlinkSync(linked.currentParent, alias, 'junction');
    const changed = { ...linked.registration, recovery: path.join(alias, linked.id) };
    json(linked.installedFile('registration.json'), changed);
    json(path.join(linked.recovery, 'registration.json'), changed);
    assert.equal(
      resolve(linked, compileHarness(), '', alias),
      linked.installedFile('uninstall.ps1'),
    );
  },
);

test(
  'native uninstall resolver rejects identity root, GUID, and relative-path mismatches',
  { skip: !windows },
  () => {
    for (const changed of [{ root: folder() }, { root: '.' }, { installId: 'not-a-guid' }]) {
      const f = fixture();
      json(path.join(f.install, '.capri-install.json'), {
        productId: 'capri.desktop',
        root: f.install,
        installId: f.id,
        ...changed,
      });
      assert.equal(resolve(f), 'MISSING');
    }
  },
);

test(
  'a native embedded hash anchor validates cached recovery after application metadata removal',
  { skip: !windows },
  () => {
    const f = fixture(),
      hashes = Object.fromEntries(
        names.map((name) => [name, digest(readFileSync(path.join(f.recovery, name)))]),
      );
    const exe = compileHarness(hashes);
    unlinkSync(f.installedFile('source-files.json'));
    unlinkSync(f.installedFile('registration.json'));
    assert.equal(resolve(f, exe), path.join(f.recovery, 'uninstall.ps1'));
    json(path.join(f.recovery, 'source-files.json'), { files: [] });
    assert.equal(resolve(f, exe), 'MISSING', 'recovery cannot replace its own integrity anchor');
  },
);

test(
  'real registration binds recovery to the installation and routes quiet removal through the native resolver',
  { skip: !windows },
  () => {
    const base = folder(),
      install = path.join(base, 'Registration 東京'),
      verification = path.join(install, 'verification'),
      id = randomUUID();
    const copied = [
      'register.ps1',
      'common.ps1',
      'uninstall.ps1',
      'uninstall-window.cs',
      'cyberpunk-theme.cs',
      'uninstall-launcher.cs',
      'setup-localization.cs',
      'localization.ps1',
      'app-launcher.cs',
      'shell-link.cs',
    ];
    for (const name of copied)
      put(
        path.join(install, 'packages/installer/windows', name),
        readFileSync(path.join(root, 'packages/installer/windows', name)),
      );
    const resources = [
      'config/installer.json',
      'config/installer-shell-text.json',
      'config/uninstaller-text.json',
      'assets/default/app.ico',
    ];
    for (const name of resources)
      put(path.join(install, name), readFileSync(path.join(root, name)));
    json(path.join(install, '.capri-install.json'), {
      schemaVersion: 1,
      productId: 'capri.desktop',
      root: install,
      version: '1.0.0',
      installId: id,
    });
    put(path.join(install, 'README.md'), '# Resolver fixture\n[Help](docs/help.md)\n');
    json(path.join(install, '.runtime/installer/source-files.json'), {
      files: [
        ...copied.map((name) => 'packages/installer/windows/' + name),
        ...resources,
        'README.md',
      ].map((name) => ({
        path: name,
        sha256: digest(readFileSync(path.join(install, name))),
      })),
    });
    const script = path.join(base, 'register-only.ps1');
    writeFileSync(
      script,
      `param($InstallRoot,$VerificationRoot,$Source,$Id)
$ErrorActionPreference='Stop'
try {
 & (Join-Path $Source 'packages/installer/windows/register.ps1') -InstallRoot $InstallRoot -VerificationRoot $VerificationRoot
 $key='HKCU:\\Software\\CapriInstallerTests\\'+$Id
 $registration=Get-ItemProperty -LiteralPath $key
 $command='"'+(Join-Path $VerificationRoot ('Uninstall/'+$Id+'/uninstall.exe'))+'"'
 if($registration.UninstallString -ne $command -or $registration.QuietUninstallString -ne ($command+' --quiet')){throw 'Windows Apps must use the independent recovery executable'}
} finally {
 $key='HKCU:\\Software\\CapriInstallerTests\\'+$Id
 if((Test-Path -LiteralPath $key) -and (Get-ItemProperty -LiteralPath $key).InstallLocation -eq $InstallRoot){Remove-Item -LiteralPath $key -Force}
}
`,
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
        install,
        verification,
        root,
        id,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const registration = JSON.parse(
      readFileSync(path.join(install, '.runtime/installer/registration.json'), 'utf8'),
    );
    assert.equal(registration.root, install);
    const directLauncher = path.join(install, 'uninstall.exe');
    const recoveryLauncher = path.join(registration.recovery, 'uninstall.exe');
    assert.deepEqual(readFileSync(recoveryLauncher), readFileSync(directLauncher));
    for (const [executable, expected] of [
      [directLauncher, install],
      [recoveryLauncher, install],
      [path.join(base, 'uninstall.exe'), 'MISSING'],
    ]) {
      const binding = spawnSync(compileHarness(), ['--launch-root', recoveryLauncher, executable], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000,
      });
      assert.equal(binding.status, 0, binding.stderr);
      assert.equal(binding.stdout.trim(), expected);
    }
    const resolved = spawnSync(
      compileHarness(),
      ['--assembly', recoveryLauncher, install, registration.recovery],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 },
    );
    assert.equal(resolved.status, 0, resolved.stderr);
    assert.equal(resolved.stdout.trim(), path.join(registration.recovery, 'uninstall.ps1'));
    const receipt = JSON.parse(
      readFileSync(path.join(install, '.runtime/installer/source-files.json'), 'utf8'),
    );
    assert.equal(
      receipt.files.some((entry) => entry.path === 'README.md'),
      false,
    );
    const tidy = receipt.files.find((entry) => entry.path === 'Support/README.md');
    assert.equal(tidy.sha256, digest(readFileSync(path.join(install, 'Support/README.md'))));
    const cachedScript = path.join(registration.recovery, 'uninstall.ps1');
    const originalScript = readFileSync(cachedScript);
    unlinkSync(cachedScript);
    const fallback = spawnSync(
      compileHarness(),
      ['--assembly', path.join(install, 'uninstall.exe'), install, registration.recovery],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 },
    );
    assert.equal(fallback.status, 0, fallback.stderr);
    assert.equal(
      fallback.stdout.trim(),
      path.join(install, 'packages/installer/windows/uninstall.ps1'),
    );
    assert.equal(
      existsSync(path.join(install, '.capri-install.json')),
      true,
      'no uninstall operation was executed',
    );
    writeFileSync(cachedScript, originalScript);
    unlinkSync(directLauncher);
    const model = path.join(install, 'data/models/keep.bin');
    const personalSettings = path.join(install, 'data/desktop/keep.json');
    put(model, 'model');
    put(personalSettings, 'personal settings');
    const lock = path.join(install, '.runtime/installer/install.lock.json');
    json(lock, { pid: process.pid });
    const remove = () =>
      spawnSync(recoveryLauncher, ['--quiet'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
      });
    assert.equal(remove().status, 1, 'Windows must receive a failed result if removal is busy');
    assert.ok(existsSync(path.join(install, 'Capri.exe')));
    unlinkSync(lock);
    const removed = remove();
    assert.equal(removed.status, 0, removed.stdout + removed.stderr);
    assert.equal(existsSync(path.join(install, 'Capri.exe')), false);
    assert.ok(existsSync(recoveryLauncher));
    assert.equal(readFileSync(model, 'utf8'), 'model');
    assert.equal(readFileSync(personalSettings, 'utf8'), 'personal settings');
  },
);
