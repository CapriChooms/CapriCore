// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test(
  'native perch tracking retains transient failures without relaxing window identity',
  { skip: process.platform !== 'win32', timeout: 60000 },
  () => {
    const parent = path.resolve('.runtime/desktop-teleport-watch-unit');
    mkdirSync(parent, { recursive: true });
    const folder = mkdtempSync(path.join(parent, 'fixture-'));
    const compiler = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
    );
    const compile = (output, sources) => {
      const result = spawnSync(
        compiler,
        [
          '/nologo',
          '/platform:x64',
          '/target:' + (output.endsWith('.dll') ? 'library' : 'exe'),
          '/reference:System.Windows.Forms.dll',
          '/reference:System.Drawing.dll',
          '/out:' + output,
          ...sources,
        ],
        { windowsHide: true, encoding: 'utf8', timeout: 20000 },
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    const library = path.join(folder, 'DesktopTeleport.dll');
    compile(library, [path.resolve('packages/installer/windows/desktop-teleport.cs')]);
    const source = path.join(folder, 'WatchFixture.cs');
    writeFileSync(
      source,
      `using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

class OwnedWindow : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams {
    get { var p = base.CreateParams; p.ExStyle |= 0x08000080; return p; }
  }
}
class WatchFixture {
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  static Type native, rectType, identityType;
  static readonly BindingFlags flags = BindingFlags.Static | BindingFlags.NonPublic;
  static readonly StringWriter output = new StringWriter();
  static int checks;
  static object Call(string name, params object[] args) { return native.GetMethod(name, flags).Invoke(null, args); }
  static void Set(string name, object value) { native.GetField(name, flags).SetValue(null, value); }
  static object Get(string name) { return native.GetField(name, flags).GetValue(null); }
  static object Identity(string name) { return Enum.Parse(identityType, name); }
  static void Assert(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
  static string Take() { string value = output.ToString().Trim(); output.GetStringBuilder().Clear(); return value; }
  static object Rect(int x, int y, int width, int height) {
    object value = Activator.CreateInstance(rectType);
    foreach (var field in new[] { "Left", "Top", "Right", "Bottom" })
      rectType.GetField(field).SetValue(value, field == "Left" ? x : field == "Top" ? y : field == "Right" ? x + width : y + height);
    return value;
  }
  static void Bind(Form window, int id = 41) {
    Call("StopFollowing");
    uint pid; uint thread = GetWindowThreadProcessId(window.Handle, out pid);
    Set("anchorId", id); Set("anchorWindow", window.Handle); Set("anchorProcess", pid);
    Set("anchorThread", thread); Set("anchorStartedAt", Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks);
    Take();
  }
  static void Observe(string identity, bool geometry, long now) {
    Call("ApplyAnchorObservation", Identity(identity), true, false, geometry, Rect(20, 30, 300, 180), now);
  }
  static void Pump(int milliseconds) {
    var timer = Stopwatch.StartNew();
    while (timer.ElapsedMilliseconds < milliseconds) { Application.DoEvents(); Thread.Sleep(10); }
  }
  [STAThread] static int Main(string[] args) {
    TextWriter original = Console.Out;
    OwnedWindow window = null;
    System.Windows.Forms.Timer fallback = null;
    IntPtr oldDpi = SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      native = Assembly.LoadFrom(args[0]).GetType("CapriDesktopTeleport", true);
      rectType = native.GetNestedType("Rect", BindingFlags.NonPublic);
      identityType = native.GetNestedType("AnchorIdentity", BindingFlags.NonPublic);
      Console.SetOut(output);
      window = new OwnedWindow { ShowInTaskbar = false, StartPosition = FormStartPosition.Manual, Bounds = new Rectangle(-16000, -16000, 330, 180), Text = "Owned perch tracking fixture" };
      window.Show(); Pump(60); Bind(window);
      Assert(Call("ReadAnchorIdentity").ToString() == "Verified", "Limited process query did not verify the owned HWND.");
      Call("PollAnchor"); Assert(Take().StartsWith("anchor 41 visible "), "Owned window geometry was not visible.");
      for (int i = 0; i < 12; i++) {
        Assert(SetWindowPos(window.Handle, IntPtr.Zero, -16000 + i * 23, -16000, 330, 180, 0x0014), "Owned window move failed.");
        Pump(12); Call("PollAnchor");
        string moved = Take();
        Assert(moved.Length == 0 || moved.StartsWith("anchor 41 visible "), "A horizontal move lost the perch.");
      }
      Assert((int)Get("anchorId") == 41, "A horizontal move changed the identity."); checks++;

      ShowWindow(window.Handle, 7); Pump(40); Call("PollAnchor");
      Assert(Take() == "anchor 41 hidden" && (int)Get("anchorId") == 41, "Minimize must hide without closing.");
      ShowWindow(window.Handle, 4); Pump(40); Call("PollAnchor");
      Assert(Take().StartsWith("anchor 41 visible "), "Restore did not resume tracking."); checks++;

      Bind(window); Set("anchorLifetime", window);
      fallback = new System.Windows.Forms.Timer { Interval = 50 };
      fallback.Tick += delegate { Call("PollAnchor"); };
      Set("anchorTimer", fallback);
      Call("FollowWindow", 52, window.Handle, (uint)Process.GetCurrentProcess().Id, Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks);
      foreach (string field in new[] { "anchorObjectHook", "anchorStateHook" }) {
        IntPtr hook = (IntPtr)Get(field); if (hook != IntPtr.Zero) UnhookWinEvent(hook); Set(field, IntPtr.Zero);
      }
      Assert(fallback.Enabled, "Missing event hooks must retain the timer fallback."); Take();
      SetWindowPos(window.Handle, IntPtr.Zero, -15000, -16000, 330, 180, 0x0014); Pump(130);
      Assert(Take().StartsWith("anchor 52 visible ") && (int)Get("anchorId") == 52, "Zero event hooks prevented verified polling.");
      Call("StopFollowing"); fallback.Dispose(); fallback = null; Set("anchorTimer", null); checks++;

      object[] bounds = { true, Rect(0, 0, 0, 0), true, Rect(75, 90, 330, 180), null };
      Assert((bool)Call("ChooseAnchorRect", bounds), "Degenerate successful DWM read did not use the window rect.");
      Assert((int)rectType.GetField("Left").GetValue(bounds[4]) == 75, "Fallback selected the wrong geometry.");
      bounds = new object[] { false, Rect(0, 0, 0, 0), true, Rect(0, 0, 0, 0), null };
      Assert(!(bool)Call("ChooseAnchorRect", bounds), "Degenerate geometry was accepted."); checks++;

      Bind(window); Observe("Verified", true, 100); Take();
      Assert(Call("ProcessOpenFailure", 5).ToString() == "Unavailable", "Access denied was treated as a closed owner.");
      Assert(Call("ProcessOpenFailure", 87).ToString() == "Closed", "A missing process was retained.");
      Observe("Unavailable", false, 1000); Observe("Unavailable", false, 1749);
      Assert(Take() == "" && (int)Get("anchorId") == 41, "Transient access denial did not hold the last verified placement.");
      Observe("Unavailable", false, 1750);
      Assert(Take() == "anchor 41 hidden" && (int)Get("anchorId") == 41, "Persistent access denial must hide nonterminally.");
      Assert(Call("ReadAnchorIdentity").ToString() == "Verified", "Recovery was not freshly verified.");
      Observe("Verified", true, 1800); Assert(Take().StartsWith("anchor 41 visible "), "Verified recovery did not resume.");
      Observe("Unavailable", false, 2000); Observe("Unavailable", false, 7000);
      Assert(Take().EndsWith("anchor 41 closed") && (int)Get("anchorId") == 0, "Persistent unavailable identity did not clean up."); checks++;

      Bind(window); Observe("Verified", true, 0); Take();
      Observe("Verified", false, 10); Observe("Verified", false, 759);
      Assert(Take() == "", "Transient geometry failure hid the perch.");
      Observe("Verified", false, 760); Assert(Take() == "anchor 41 hidden", "Unavailable geometry was not bounded.");
      Call("PollAnchor"); Assert(Take().StartsWith("anchor 41 visible "), "Fresh valid geometry did not resume."); checks++;

      Bind(window); Set("anchorProcess", (uint)Process.GetCurrentProcess().Id + 1); Call("PollAnchor");
      Assert(Take() == "anchor 41 closed", "PID mismatch was not closed.");
      Bind(window); Set("anchorStartedAt", Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks + 1); Call("PollAnchor");
      Assert(Take() == "anchor 41 closed", "Creation-time mismatch was not closed."); checks++;

      Bind(window); IntPtr destroyed = window.Handle; window.Dispose(); window = null; Call("PollAnchor");
      Assert(Take() == "anchor 41 closed" && (int)Get("anchorId") == 0, "Destroyed HWND was retained."); checks++;
      Console.SetOut(original);
      Console.WriteLine("{\\"passed\\":true,\\"checks\\":" + checks + ",\\"ownedWindowsOnly\\":true,\\"autoElevation\\":false,\\"inputInjected\\":false}");
      return 0;
    } catch (Exception error) { Console.SetOut(original); Console.Error.WriteLine(error); return 1; }
    finally {
      if (native != null) Call("StopFollowing");
      if (fallback != null) fallback.Dispose();
      if (window != null) window.Dispose();
      if (oldDpi != IntPtr.Zero) SetThreadDpiAwarenessContext(oldDpi);
    }
  }
}
`,
    );
    const executable = path.join(folder, 'WatchFixture.exe');
    compile(executable, [source]);
    const result = spawnSync(executable, [library], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      passed: true,
      checks: 8,
      ownedWindowsOnly: true,
      autoElevation: false,
      inputInjected: false,
    });
  },
);
