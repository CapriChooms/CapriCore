// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test(
  'uninstall progress repaints independently, counts real operations, and never reports failed work as complete',
  { skip: process.platform !== 'win32' },
  () => {
    const parent = path.join(root, '.runtime/uninstall-progress-tests');
    mkdirSync(parent, { recursive: true });
    const folder = mkdtempSync(path.join(parent, 'case-'));
    const source = path.join(folder, 'ProgressProbe.cs');
    const executable = path.join(folder, 'ProgressProbe.exe');
    // This harness only constructs the production progress component. It never
    // imports uninstall.ps1, enumerates an installation, or deletes any file.
    writeFileSync(
      source,
      String.raw`
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Capri.Setup;

internal static class ProgressProbe {
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static T Field<T>(UninstallProgress progress, string name) {
        return (T)typeof(UninstallProgress).GetField(name, BindingFlags.NonPublic | BindingFlags.Instance).GetValue(progress);
    }
    private static T UI<T>(Form form, Func<T> callback) { return (T)form.Invoke(callback); }
    private static void UI(Form form, Action callback) { form.Invoke(callback); }
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static void Wait(Func<bool> ready) {
        for (int i = 0; i < 100; ++i) { if (ready()) return; Thread.Sleep(30); }
        throw new Exception("Progress UI did not repaint within 3 seconds.");
    }
    private static object Capture(UninstallProgress progress, string file) {
        Form form = Field<Form>(progress, "form");
        return UI(form, () => {
            using (var bitmap = new Bitmap(form.Width, form.Height)) {
                form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
                bitmap.Save(file);
            }
            var bar = Field<ProgressBar>(progress, "bar");
            var close = Field<Button>(progress, "close");
            var detail = Field<TextBox>(progress, "details");
            return (object)new { stage = Field<Label>(progress, "stage").Text,
                count = Field<Label>(progress, "count").Text, style = bar.Style.ToString(),
                value = bar.Value, closeEnabled = close.Enabled, closeVisible = close.Visible,
                errorVisible = detail.Visible, details = detail.Text,
                width = form.Width, height = form.Height, rtl = form.RightToLeftLayout };
        });
    }
    private static Form Offscreen(UninstallProgress progress) {
        Form form = Field<Form>(progress, "form");
        UI(form, () => { form.StartPosition = FormStartPosition.Manual; form.Location = new Point(-10000, -10000); });
        return form;
    }
    [STAThread] private static int Main(string[] args) {
        try {
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            var catalog = Json.Deserialize<Dictionary<string, Dictionary<string, string>>>(File.ReadAllText(args[0]));
            var messages = catalog[args[1]];
            bool rtl = args[1] == "ar";
            var snapshots = new Dictionary<string, object>();
            using (var progress = new UninstallProgress(messages, rtl, "")) {
                Form form = Offscreen(progress);
                Check(UI(form, () => Field<Label>(progress, "stage").Text) == messages["progressPreparing"], "Preparing label was not translated.");
                snapshots["preparing"] = Capture(progress, Path.Combine(args[2], args[1] + "-preparing.png"));
                UI(form, () => form.Close());
                Check(!form.IsDisposed, "Closing was allowed during unfinished removal.");
                progress.Report("progressStopping");
                // The caller sleeps just as PowerShell does while waiting for a
                // child process. The dedicated UI thread must still repaint.
                Thread.Sleep(350);
                Check(UI(form, () => Field<Label>(progress, "stage").Text) == messages["progressStopping"], "Caller wait froze stage repaint.");
                progress.Report("progressRemoving");
                for (int i = 0; i < 100000; ++i) progress.Advance();
                Thread.Sleep(350);
                string count = UI(form, () => Field<Label>(progress, "count").Text);
                Check(count == String.Format(messages["progressItems"], 100000L.ToString("N0")), "Counter did not repaint or lost operations.");
                Check(UI(form, () => Field<ProgressBar>(progress, "bar").Style) == ProgressBarStyle.Marquee, "Unfinished progress claimed a percentage.");
                Check(!UI(form, () => Field<Button>(progress, "close").Enabled), "Unsafe cancel button was enabled.");
                snapshots["removing"] = Capture(progress, Path.Combine(args[2], args[1] + "-removing.png"));
                progress.Hide(); Wait(() => !UI(form, () => form.Visible));
                progress.Show(); Wait(() => UI(form, () => form.Visible));
                var completed = Task.Run(() => progress.Complete());
                Wait(() => UI(form, () => Field<ProgressBar>(progress, "bar").Value) == 100);
                Check(!completed.IsCompleted, "Success window disappeared before Close.");
                Thread.Sleep(500); // Let the native progress control finish painting its transition.
                snapshots["complete"] = Capture(progress, Path.Combine(args[2], args[1] + "-complete.png"));
                UI(form, () => Field<Button>(progress, "close").PerformClick());
                Check(completed.Wait(3000), "Close did not release the caller after success.");
            }
            using (var progress = new UninstallProgress(messages, rtl, "")) {
                Form form = Offscreen(progress);
                for (int i = 0; i < 3; ++i) progress.Advance();
                progress.Hide(); Wait(() => !UI(form, () => form.Visible));
                var failed = Task.Run(() => progress.Fail("Synthetic QA file could not be removed. No installation was opened.",
                    "UNINSTALL_LINKED_PATH", "1.0.4"));
                Wait(() => UI(form, () => Field<TextBox>(progress, "details").Visible));
                UI(form, () => {
                    Button report = Field<Button>(progress, "report");
                    Check(report.Visible && report.Enabled && report.Text == messages["reportBug"], "Report button is unavailable or untranslated.");
                    foreach (string name in new[] { "report", "close" }) {
                        Button button = Field<Button>(progress, name);
                        Rectangle bounds = form.RectangleToClient(button.RectangleToScreen(button.ClientRectangle));
                        Check(form.ClientRectangle.Contains(bounds), "Failure button is clipped by the form: " + name);
                    }
                });
                Check(UI(form, () => Field<ProgressBar>(progress, "bar").Value) != 100, "Failure was reported as 100% complete.");
                Check(!failed.IsCompleted, "Failure details disappeared before Close.");
                snapshots["failure"] = Capture(progress, Path.Combine(args[2], args[1] + "-failure.png"));
                UI(form, () => Field<Button>(progress, "close").PerformClick());
                Check(failed.Wait(3000), "Close did not release the caller after failure.");
            }
            string reportUrl = Uri.UnescapeDataString(UninstallProgress.ReportUrl("UNINSTALL_LINKED_PATH", "progressRemoving", "1.0.4", 3));
            Check(reportUrl.Contains("template=bug_report.yml") && reportUrl.Contains("version=1.0.4") &&
                reportUrl.Contains("UNINSTALL_LINKED_PATH\nPhase: progressRemoving\nItems processed: 3"), "Missing safe bug report fields.");
            Check(!UninstallProgress.ReportUrl("private-code", "private-path", "private-version", 0).Contains("private"), "An arbitrary value was included in the report URL.");
            Console.WriteLine(Json.Serialize(new { language = args[1], snapshots = snapshots }));
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
`,
    );
    const compiler = path.join(
      process.env.SystemRoot,
      'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
    );
    const compiled = spawnSync(
      compiler,
      [
        '/nologo',
        '/target:exe',
        '/out:' + executable,
        '/reference:System.Windows.Forms.dll',
        '/reference:System.Drawing.dll',
        '/reference:System.Web.Extensions.dll',
        path.join(root, 'packages/installer/windows/uninstall-window.cs'),
        source,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 },
    );
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const reports = [];
    for (const language of ['en', 'ru', 'ar']) {
      const result = spawnSync(
        executable,
        [path.join(root, 'config/uninstaller-text.json'), language, folder],
        { encoding: 'utf8', windowsHide: true, timeout: 20000 },
      );
      assert.equal(result.status, 0, language + ': ' + result.stdout + result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.snapshots.preparing.value, 0);
      assert.equal(report.snapshots.removing.value, 0);
      assert.equal(report.snapshots.complete.value, 100);
      assert.equal(report.snapshots.failure.value, 0);
      assert.equal(report.snapshots.failure.errorVisible, true);
      assert.equal(report.snapshots.failure.details.includes('Synthetic QA'), true);
      assert.equal(report.snapshots.complete.closeEnabled, true);
      assert.equal(report.snapshots.complete.rtl, language === 'ar');
      reports.push(report);
    }
    writeFileSync(path.join(folder, 'report.json'), JSON.stringify(reports, null, 2));
  },
);
