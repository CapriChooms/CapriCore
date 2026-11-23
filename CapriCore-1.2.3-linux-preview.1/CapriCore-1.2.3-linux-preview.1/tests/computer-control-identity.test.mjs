// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

test(
  'computer control identifies Capri from executable identity without using page titles',
  { skip: process.platform !== 'win32', timeout: 90000 },
  async (t) => {
    const parent = path.resolve('.runtime/computer-control-identity-unit');
    mkdirSync(parent, { recursive: true });
    const fixture = mkdtempSync(path.join(parent, 'fixture-'));
    const framework = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'Microsoft.NET/Framework64/v4.0.30319',
    );
    const compile = (source, output, references = []) => {
      const result = spawnSync(
        path.join(framework, 'csc.exe'),
        [
          '/nologo',
          '/target:' + (output.endsWith('.dll') ? 'library' : 'exe'),
          '/platform:x64',
          '/optimize+',
          '/out:' + output,
          ...references.map((reference) => '/r:' + reference),
          source,
        ],
        { windowsHide: true, encoding: 'utf8', timeout: 20000 },
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    const library = path.join(fixture, 'DesktopActions.dll');
    compile(path.resolve('integrations/desktop-actions/native/DesktopActions.cs'), library, [
      'System.Web.Extensions.dll',
      'Microsoft.CSharp.dll',
      ...['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map((name) =>
        path.join(framework, 'WPF', name + '.dll'),
      ),
    ]);
    const harnessSource = path.join(fixture, 'IdentityHarness.cs');
    writeFileSync(
      harnessSource,
      `using System;
using System.Reflection;
class IdentityHarness {
  static int Main(string[] args) {
    try {
      var type = Assembly.LoadFrom(args[0]).GetType("DesktopActions", true);
      var method = type.GetMethod(args[1], BindingFlags.Static | BindingFlags.NonPublic);
      if (method == null) throw new MissingMethodException(args[1]);
      object[] values = args[1] == "CapriExecutable"
        ? new object[] { args[2] }
        : new object[] { UInt32.Parse(args[2]), UInt32.Parse(args[3]) };
      Console.WriteLine((bool)method.Invoke(null, values) ? "true" : "false");
      return 0;
    } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
  }
}
`,
    );
    const harness = path.join(fixture, 'IdentityHarness.exe');
    compile(harnessSource, harness);
    const invoke = (method, ...args) => {
      const result = spawnSync(harness, [library, method, ...args.map(String)], {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout.trim(), /^(true|false)$/);
      return result.stdout.trim() === 'true';
    };
    const makeExecutable = (name, product, description) => {
      const source = path.join(fixture, name + '.cs');
      const executable = path.join(fixture, name + '.exe');
      writeFileSync(
        source,
        `using System;
using System.Reflection;
[assembly: AssemblyProduct(${JSON.stringify(product)})]
[assembly: AssemblyTitle(${JSON.stringify(description)})]
class SyntheticProcess {
  static void Main(string[] args) {
    // The test never creates a window. A browser-like Capri page caption must
    // not turn this otherwise unrelated executable into the protected app.
    try { Console.Title = args.Length > 0 ? args[0] : "Synthetic fixture"; } catch {}
    Console.WriteLine("ready");
    Console.Out.Flush();
    Console.ReadLine();
  }
}
`,
      );
      compile(source, executable);
      return executable;
    };
    const capri = makeExecutable('capri-product', 'Capri', 'Capri');
    const capriProductOnly = makeExecutable('product-only-capri', 'Capri', 'Synthetic controller');
    const capriDescriptionOnly = makeExecutable(
      'description-only-capri',
      'Synthetic controller',
      'Capri',
    );
    const browser = makeExecutable('browser', 'Synthetic browser', 'Capri page');
    const electron = makeExecutable('generic-electron', 'Electron', 'Electron');
    const children = new Set();
    const start = async (executable, title = 'Synthetic fixture') => {
      const child = spawn(executable, [title], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      children.add(child);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Synthetic process did not start')),
          5000,
        );
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error('Synthetic process exited before readiness: ' + code));
        });
        child.stdout.once('data', (data) => {
          clearTimeout(timeout);
          assert.equal(String(data).trim(), 'ready');
          resolve();
        });
      });
      return child;
    };
    const stop = async (child) => {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.stdin.end('\n');
        const timeout = setTimeout(() => child.kill(), 2000);
        try {
          await exited;
        } finally {
          clearTimeout(timeout);
        }
      }
      children.delete(child);
    };
    const layout = (
      name,
      manifest,
      { entry = true, exactPath = true, filename = 'electron.exe' } = {},
    ) => {
      const directory = path.join(fixture, name);
      const executable = path.join(
        directory,
        exactPath ? 'node_modules/electron/dist' : 'other/electron/dist',
        filename,
      );
      mkdirSync(path.dirname(executable), { recursive: true });
      copyFileSync(electron, executable);
      if (manifest !== null) writeFileSync(path.join(directory, 'package.json'), manifest);
      if (entry) {
        mkdirSync(path.join(directory, 'apps/desktop'), { recursive: true });
        writeFileSync(path.join(directory, 'apps/desktop/main.mjs'), '// isolated marker\n');
      }
      return executable;
    };
    try {
      await t.test('exact Capri PE identity protects a second installation', async () => {
        const otherInstall = path.join(fixture, 'second-install', 'Capri.exe');
        for (const [name, source, expected] of [
          ['first-install', capri, true],
          ['second-install', capri, true],
          ['product-only', capriProductOnly, false],
          ['description-only', capriDescriptionOnly, false],
        ]) {
          const executable = path.join(fixture, name, 'Capri.exe');
          mkdirSync(path.dirname(executable), { recursive: true });
          copyFileSync(source, executable);
          assert.equal(invoke('CapriExecutable', executable), expected, executable);
        }
        const child = await start(otherInstall);
        assert.equal(invoke('ComputerProcessAllowed', child.pid, 0), false);
        await stop(child);
      });
      await t.test('an unrelated browser with a Capri page caption remains eligible', async () => {
        assert.equal(invoke('CapriExecutable', browser), false);
        const child = await start(browser, 'Capri page');
        assert.equal(invoke('ComputerProcessAllowed', child.pid, 0), true);
        assert.equal(invoke('ComputerProcessAllowed', child.pid, child.pid), false);
        const pid = child.pid;
        await stop(child);
        assert.equal(invoke('ComputerProcessAllowed', pid, 0), false);
      });
      await t.test(
        'an unrelated unbranded Capri.exe remains eligible outside Capri layout',
        async () => {
          const executable = path.join(fixture, 'unrelated-install', 'Capri.exe');
          mkdirSync(path.dirname(executable), { recursive: true });
          copyFileSync(electron, executable);
          assert.equal(invoke('CapriExecutable', executable), false);
          const child = await start(executable, 'Capri page');
          assert.equal(invoke('ComputerProcessAllowed', child.pid, 0), true);
          await stop(child);
        },
      );
      await t.test(
        'Electron requires the exact Capri layout, manifest identity and entry marker',
        async () => {
          const good = layout('capri-source', '{"name":"capri"}');
          assert.equal(invoke('CapriExecutable', good), true);
          const genericNamedCapri = layout('capri-source-named', '{"name":"capri"}', {
            filename: 'Capri.exe',
          });
          assert.equal(invoke('CapriExecutable', genericNamedCapri), true);
          const capriChild = await start(good);
          assert.equal(invoke('ComputerProcessAllowed', capriChild.pid, 0), false);
          await stop(capriChild);
          const invalid = [
            layout('other-product', '{"name":"other-product"}'),
            layout('name-substring', '{"name":"capri-browser"}'),
            layout('no-manifest', null),
            layout('missing-entry', '{"name":"capri"}', { entry: false }),
            layout('wrong-location', '{"name":"capri"}', { exactPath: false }),
          ];
          for (const executable of invalid)
            assert.equal(invoke('CapriExecutable', executable), false, executable);
          const otherElectron = await start(invalid[0], 'Capri page');
          assert.equal(invoke('ComputerProcessAllowed', otherElectron.pid, 0), true);
          await stop(otherElectron);
          for (const executable of [
            layout('malformed-manifest', '{"name":"capri"'),
            layout(
              'oversized-manifest',
              JSON.stringify({ name: 'capri', padding: 'x'.repeat(1024 ** 2) }),
            ),
          ]) {
            const child = await start(executable);
            assert.equal(invoke('ComputerProcessAllowed', child.pid, 0), false, executable);
            await stop(child);
          }
        },
      );
      await t.test('missing executable and invalid process identities fail closed', () => {
        assert.equal(invoke('CapriExecutable', path.join(fixture, 'missing.exe')), false);
        assert.equal(invoke('ComputerProcessAllowed', 0, 0), false);
        assert.equal(invoke('ComputerProcessAllowed', 0xffffffff, 0), false);
      });
    } finally {
      await Promise.all([...children].map(stop));
    }
  },
);
