// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ComputerControl } from '../apps/desktop/computer-control.mjs';

const leftPane = 'a'.repeat(64);
const rightPane = 'b'.repeat(64);
test('native-bound text uses the complete targeted inventory and its scan never reads content properties', () => {
  const source = readFileSync(
    path.resolve('integrations/desktop-actions/native/DesktopActions.cs'),
    'utf8',
  );
  const typing = source.slice(
    source.indexOf('if(action=="computer_type")'),
    source.indexOf('if(action=="computer_keys")'),
  );
  assert.match(
    typing,
    /expectedDiscordPaneId[\s\S]*ScanDiscordComposers[\s\S]*if\(!scan\.Complete\)[\s\S]*scan\.Fields\.SingleOrDefault/u,
  );
  assert.match(
    typing,
    /else field=BoundedControls\(tree,800,2000\)/u,
    'ordinary applications keep their existing lookup',
  );
  const scan = source.slice(
    source.indexOf('static DiscordComposerInventory ScanDiscordComposers'),
    source.indexOf('static bool DraftMatchesExpected'),
  );
  assert.doesNotMatch(scan, /\.Name\b|\.Value\b|GetText\s*\(/u);
  assert.match(scan, /messageListItem_/u);
});
async function observation(controls, applicationKind = 'discord', inspect, scan) {
  const mutations = [];
  const control = new ComputerControl({
    allowed: () => true,
    canStart: () => true,
    currentTurn: () => 'synthetic-pane-qa',
    registerEscape: () => true,
    unregisterEscape: () => {},
    showBorder: async () => {},
    hideBorder: () => {},
    bridge: async (command) => {
      const { action } = command;
      if (action !== 'computer_state') {
        mutations.push(command);
        return { ok: true };
      }
      return {
        ok: true,
        windowId: '100',
        processId: '200',
        startedAtTicks: '300',
        applicationKind,
        discordComposerScan: scan,
        untrustedTitle: 'Synthetic pane observation',
        x: 0,
        y: 0,
        width: 1000,
        height: 600,
        untrustedControls: controls.map((item, index) => ({
          id: String(index),
          untrustedName: 'Synthetic control',
          x: 100 + index * 100,
          y: 500,
          ...item,
        })),
      };
    },
  });
  await control.begin('Verify metadata only');
  try {
    const view = await control.execute({ action: 'observe', vision: false });
    return inspect ? await inspect(control, view, mutations) : view;
  } finally {
    await control.stop();
  }
}

test('native pane metadata survives host observation with distinct left/right context and strict composer/message flags', async () => {
  const view = await observation([
    {
      type: 'ControlType.Edit',
      editable: true,
      discordPaneId: leftPane,
      discordMessageComposer: true,
    },
    {
      type: 'ControlType.Edit',
      editable: true,
      discordPaneId: rightPane,
      discordMessageComposer: true,
    },
    { type: 'ControlType.Text', editable: false, discordPaneId: rightPane, discordMessage: true },
  ]);
  assert.equal(view.targets[0].discordPaneId, leftPane);
  assert.equal(view.targets[1].discordPaneId, rightPane);
  assert.equal(view.targets[1].discordMessageComposer, true);
  assert.equal(view.targets[2].discordPaneId, rightPane);
  assert.equal(view.targets[2].discordMessage, true);
  assert.equal(view.targets[2].discordMessageComposer, undefined);
  assert.ok(view.targets[1].position.x > view.targets[0].position.x);
});

test('composer inventory is host-only, bounded and strictly typed', async () => {
  for (const scan of [
    { complete: true, count: 2 },
    { complete: false, count: 8 },
  ]) {
    const view = await observation([], 'discord', undefined, scan);
    assert.deepEqual(view.window.discordComposerScan, scan);
  }
  for (const scan of [
    { complete: 'true', count: 1 },
    { complete: true, count: 9 },
    { complete: true, count: -1 },
    { complete: true, count: 1.5 },
  ]) {
    assert.equal(
      (await observation([], 'discord', undefined, scan)).window.discordComposerScan,
      undefined,
    );
  }
  assert.equal(
    (await observation([], 'other', undefined, { complete: true, count: 1 })).window
      .discordComposerScan,
    undefined,
  );
});

test('only trusted third-argument Discord preconditions enter the native mutation request', async () => {
  const expectedValueSha256 = createHash('sha256').update('').digest('hex');
  await observation(
    [
      {
        type: 'ControlType.Edit',
        editable: true,
        focused: true,
        discordPaneId: rightPane,
        discordMessageComposer: true,
      },
    ],
    'discord',
    async (control, view, calls) => {
      let command = { action: 'enter_text', targetId: view.targets[0].targetId, text: 'hi' };
      await control.execute({ ...command, expectedValueSha256, expectedDiscordPaneId: rightPane });
      assert.equal(
        calls.find((call) => call.action === 'computer_type').expectedValueSha256,
        undefined,
        'public command properties are not trusted',
      );
      const discordMutation = { expectedValueSha256, expectedDiscordPaneId: rightPane };
      let fresh = await control.execute({ action: 'observe', vision: false });
      command = { ...command, targetId: fresh.targets[0].targetId };
      await control.execute(command, undefined, { discordMutation });
      const typed = calls.filter((call) => call.action === 'computer_type');
      assert.equal(typed[1].expectedValueSha256, expectedValueSha256);
      assert.equal(typed[1].expectedDiscordPaneId, rightPane);
      fresh = await control.execute({ action: 'observe', vision: false });
      const enter = { action: 'press_keys', keys: ['ENTER'], observationId: fresh.observationId };
      await control.execute(enter, undefined, { discordMutation });
      const submitted = calls.find((call) => call.action === 'computer_keys');
      assert.equal(submitted.focusedControlId, '0');
      assert.equal(submitted.expectedDiscordPaneId, rightPane);
      const before = calls.length;
      for (const invalid of [
        { ...discordMutation, expectedDiscordPaneId: leftPane },
        { ...discordMutation, expectedValueSha256: 'invalid' },
        { ...discordMutation, extra: true },
      ]) {
        fresh = await control.execute({ action: 'observe', vision: false });
        command = { ...command, targetId: fresh.targets[0].targetId };
        await assert.rejects(
          control.execute(command, undefined, { discordMutation: invalid }),
          /composer changed/,
        );
      }
      fresh = await control.execute({ action: 'observe', vision: false });
      await assert.rejects(
        control.execute(
          { ...enter, observationId: fresh.observationId, keys: ['CTRL', 'ENTER'] },
          undefined,
          { discordMutation },
        ),
        /composer changed/,
      );
      assert.equal(calls.length, before);
    },
  );
});

test('malformed pane IDs, headers, editable message text and another application cannot acquire trusted metadata', async () => {
  const view = await observation([
    {
      type: 'ControlType.Edit',
      editable: true,
      discordPaneId: [rightPane],
      discordMessageComposer: true,
    },
    {
      type: 'ControlType.Edit',
      editable: true,
      discordPaneId: rightPane.toUpperCase(),
      discordMessageComposer: true,
    },
    {
      type: 'ControlType.Button',
      discordPaneId: rightPane,
      discordMessage: true,
      discordMessageComposer: true,
    },
    { type: 'ControlType.Text', editable: true, discordPaneId: rightPane, discordMessage: true },
    { type: 'ControlType.Text', editable: false, discordPaneId: rightPane, discordMessage: 'true' },
  ]);
  for (const target of view.targets) assert.equal(target.discordMessage, undefined);
  assert.equal(view.targets[0].discordPaneId, undefined);
  assert.equal(view.targets[1].discordPaneId, undefined);
  assert.equal(view.targets[2].discordMessageComposer, undefined);
  assert.equal(view.targets[3].discordMessageComposer, undefined);
  const foreign = await observation(
    [
      {
        type: 'ControlType.Edit',
        editable: true,
        discordPaneId: rightPane,
        discordMessage: true,
        discordMessageComposer: true,
      },
    ],
    'other',
  );
  assert.equal(foreign.targets[0].discordPaneId, undefined);
  assert.equal(foreign.targets[0].discordMessage, undefined);
  assert.equal(foreign.targets[0].discordMessageComposer, undefined);
});

test(
  'production native pane fingerprints are content-free and bind HWND, process lifetime and container runtime ID',
  { skip: process.platform !== 'win32' },
  () => {
    const parent = path.resolve('.runtime/discord-pane-tests');
    mkdirSync(parent, { recursive: true });
    const folder = mkdtempSync(path.join(parent, 'case-'));
    const framework = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319');
    const references = [
      'System.Web.Extensions.dll',
      'Microsoft.CSharp.dll',
      ...['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map((name) =>
        path.join(framework, 'WPF', name + '.dll'),
      ),
    ];
    const compile = (sources, output, library = false) => {
      const result = spawnSync(
        path.join(framework, 'csc.exe'),
        [
          '/nologo',
          '/target:' + (library ? 'library' : 'exe'),
          '/out:' + output,
          ...references.map((file) => '/r:' + file),
          ...sources,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, encoding: 'utf8', timeout: 20000 },
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    const library = path.join(folder, 'DesktopActions.dll');
    compile([path.resolve('integrations/desktop-actions/native/DesktopActions.cs')], library, true);
    const source = path.join(folder, 'PaneHashProbe.cs');
    writeFileSync(
      source,
      String.raw`using System;
using System.Reflection;
using System.Collections.Generic;
using System.Web.Script.Serialization;
class PaneHashProbe {
  static int Main(string[] args) {
    try {
      var method=Assembly.LoadFrom(args[0]).GetType("DesktopActions",true).GetMethod("DiscordPaneFingerprint",BindingFlags.Static|BindingFlags.NonPublic);
      var output=new string[6];
      string[] binding={"100\0"+"200\0"+"300","101\0"+"200\0"+"300","100\0"+"201\0"+"300","100\0"+"200\0"+"301","100\0"+"200\0"+"300", ""};
      for(int i=0;i<output.Length;i++)output[i]=(string)method.Invoke(null,new object[]{binding[i],i==4?"right-container":"left-container"});
      var type=method.DeclaringType;
      var draft=type.GetMethod("DraftMatchesExpected",BindingFlags.Static|BindingFlags.NonPublic);
      string empty="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      bool[] draftChecks={
        (bool)draft.Invoke(null,new object[]{empty,""}),
        (bool)draft.Invoke(null,new object[]{empty,"preserved QA draft"}),
        (bool)draft.Invoke(null,new object[]{"invalid",""}),
        (bool)draft.Invoke(null,new object[]{empty,new string('x',8001)}),
        (bool)draft.Invoke(null,new object[]{empty,null})
      };
      var verify=type.GetMethod("VerifyObservedDraft",BindingFlags.Static|BindingFlags.NonPublic);
      var codes=new List<string>();
      foreach(var request in new[]{new Dictionary<string,object>(),
        new Dictionary<string,object>{{"expectedValueSha256","invalid"}},
        new Dictionary<string,object>{{"expectedValueSha256",empty}},
        new Dictionary<string,object>{{"expectedDiscordPaneId",output[0]}}}) {
        try{verify.Invoke(null,new object[]{request,new IntPtr(100),null});codes.Add("unchanged");}
        catch(TargetInvocationException e){codes.Add((string)e.InnerException.GetType().GetField("Code").GetValue(e.InnerException));}
      }
      var scan=type.GetMethod("ScanDiscordComposers",BindingFlags.Static|BindingFlags.NonPublic).Invoke(null,new object[]{null,"binding",new Dictionary<string,string>()});
      Console.WriteLine(new JavaScriptSerializer().Serialize(new {fingerprints=output,draftChecks=draftChecks,preflightCodes=codes,emptyScanComplete=(bool)scan.GetType().GetField("Complete").GetValue(scan)}));return 0;
    } catch(Exception e){Console.Error.WriteLine(e.GetType().Name);return 1;}
  }
}`,
    );
    const executable = path.join(folder, 'PaneHashProbe.exe');
    compile([source], executable);
    const result = spawnSync(executable, [library], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const values = report.fingerprints;
    assert.equal(
      values[0],
      createHash('sha256')
        .update('discord-pane-v1\0' + '100\0' + '200\0' + '300\0left-container')
        .digest('hex'),
    );
    assert.equal(new Set(values.slice(0, 5)).size, 5);
    assert.equal(values[5], null);
    assert.deepEqual(report.draftChecks, [true, false, false, false, false]);
    assert.deepEqual(report.preflightCodes, [
      'unchanged',
      'COMPUTER_OBSERVATION_CHANGED',
      'COMPUTER_FIELD_STALE',
      'COMPUTER_OBSERVATION_CHANGED',
    ]);
    assert.equal(report.emptyScanComplete, false);
  },
);
