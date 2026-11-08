// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test(
  'native control type names tolerate absent UIA identifiers and retain known classifications',
  {
    skip: process.platform !== 'win32',
    timeout: 60000,
  },
  () => {
    const parent = path.resolve('.runtime/test-data/native-control-type');
    mkdirSync(parent, { recursive: true });
    const folder = mkdtempSync(path.join(parent, 'fixture-'));
    const framework = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'Microsoft.NET/Framework64/v4.0.30319',
    );
    const references = [
      'System.Web.Extensions.dll',
      'Microsoft.CSharp.dll',
      ...['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map((name) =>
        path.join(framework, 'WPF', name + '.dll'),
      ),
    ];
    const compile = (source, target, library = false) => {
      const result = spawnSync(
        path.join(framework, 'csc.exe'),
        [
          '/nologo',
          '/target:' + (library ? 'library' : 'exe'),
          '/platform:x64',
          '/optimize+',
          '/out:' + target,
          ...references.map((value) => '/r:' + value),
          source,
        ],
        { windowsHide: true, encoding: 'utf8', timeout: 20000 },
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    const library = path.join(folder, 'DesktopActions.dll');
    compile(path.resolve('integrations/desktop-actions/native/DesktopActions.cs'), library, true);
    const source = path.join(folder, 'ControlTypeHarness.cs');
    writeFileSync(
      source,
      `using System;
using System.Reflection;
using System.Windows.Automation;
class ControlTypeHarness {
    static int Main(string[] args) {
        try {
            var type = Assembly.LoadFrom(args[0]).GetType("DesktopActions", true);
            var method = type.GetMethod("ControlTypeName", BindingFlags.Static | BindingFlags.NonPublic);
            if (method == null) throw new MissingMethodException("ControlTypeName");
            if ((string)method.Invoke(null, new object[] { null }) != "") throw new Exception("Absent type must remain unclassified");
            var unknown = ControlType.LookupById(Int32.MaxValue);
            if (unknown != null || (string)method.Invoke(null, new object[] { unknown }) != "") throw new Exception("Unknown identifier must remain unclassified");
            foreach (var known in new[] { ControlType.Button, ControlType.Edit, ControlType.Document, ControlType.Window, ControlType.Custom })
                if ((string)method.Invoke(null, new object[] { known }) != known.ProgrammaticName) throw new Exception("Known type changed");
            Console.WriteLine("verified"); return 0;
        } catch (Exception error) { Console.Error.WriteLine(error.GetType().Name); return 1; }
    }
}`,
    );
    const executable = path.join(folder, 'ControlTypeHarness.exe');
    compile(source, executable);
    const result = spawnSync(executable, [library], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'verified');
  },
);
