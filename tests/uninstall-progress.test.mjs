// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test(
  'uninstall progress pauses, resumes and cancels at operation boundaries without claiming success',
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
    private static void ConfirmCancel(UninstallProgress progress, bool answer) {
        typeof(UninstallProgress).GetMethod("ConfirmCancel", BindingFlags.NonPublic | BindingFlags.Instance)
            .Invoke(progress, new object[] { new Func<bool>(() => answer) });
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
    private static void CaptureSelection(string directory, string language, string portrait,
        Dictionary<string, string> messages, bool rtl) {
        string sample = Path.Combine(directory, "selection-fixture.txt");
        File.WriteAllText(sample, "Selection preview only");
        string[][] groups = { new[] { sample }, new string[0], new string[0], new string[0] };
        using (var timer = new System.Windows.Forms.Timer { Interval = 60 }) {
            Exception failure = null;
            int step = 0, ticks = 0;
            timer.Tick += (sender, eventArgs) => {
                Form window = Application.OpenForms["capri-uninstall-selection"];
                if (window == null) return;
                try {
                    if (++ticks > 150) throw new Exception("Selection screen did not finish measuring disk space.");
                    var remove = (Button)window.Controls.Find("selection-remove", true)[0];
                    if (!remove.Enabled) return;
                    window.Location = new Point(-10000, -10000);
                    Check(window.BackColor.GetBrightness() < .2f && window.MinimizeBox, "Selection must use the dark setup theme and offer Minimize.");
                    var cancel = (Button)window.Controls.Find("selection-cancel", true)[0];
                    var custom = (RadioButton)window.Controls.Find("mode-custom", true)[0];
                    foreach (Control control in new Control[] { remove, cancel, custom }) {
                        var rect = window.RectangleToClient(control.RectangleToScreen(control.ClientRectangle));
                        Check(window.ClientRectangle.Contains(rect), "Selection control is clipped: " + control.Name);
                    }
                    foreach (Button button in new[] { remove, cancel }) {
                        int ink = TextRenderer.MeasureText(button.Text, button.Font, Size.Empty,
                            TextFormatFlags.SingleLine | TextFormatFlags.NoPadding).Width;
                        Check(ink <= button.ClientSize.Width - 18 * window.DeviceDpi / 96,
                            "Selection button label is clipped: " + button.Text);
                    }
                    Check(window.Controls.Find("capri-portrait", true)[0].Visible, "Selection portrait is missing.");
                    using (var bitmap = new Bitmap(window.Width, window.Height)) {
                        window.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
                        bitmap.Save(Path.Combine(directory, language + (step == 0 ? "-selection.png" : "-selection-custom.png")));
                    }
                    if (step++ == 0) custom.Checked = true;
                    else window.DialogResult = DialogResult.Cancel;
                } catch (Exception error) {
                    failure = error;
                    window.DialogResult = DialogResult.Cancel;
                }
            };
            timer.Start();
            int choice = UninstallWindow.Show(directory, groups, 1, "", messages, rtl, portrait);
            timer.Stop();
            if (failure != null) throw failure;
            Check(choice == 0 && step == 2 && File.Exists(sample), "Selection preview changed the file or returned a removal plan.");
        }
    }
    [STAThread] private static int Main(string[] args) {
        try {
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            var catalog = Json.Deserialize<Dictionary<string, Dictionary<string, string>>>(File.ReadAllText(args[0]));
            var messages = catalog[args[1]];
            bool rtl = args[1] == "ar";
            CaptureSelection(args[2], args[1], args[3], messages, rtl);
            var snapshots = new Dictionary<string, object>();
            using (var progress = new UninstallProgress(messages, rtl, "")) {
                Form form = Offscreen(progress);
                Check(UI(form, () => Field<Label>(progress, "stage").Text) == messages["progressPreparing"], "Preparing label was not translated.");
                snapshots["preparing"] = Capture(progress, Path.Combine(args[2], args[1] + "-preparing.png"));
                UI(form, () => form.Close());
                Check(!form.IsDisposed, "Closing was allowed during unfinished removal.");
                Check(UI(form, () => form.MinimizeBox && form.ControlBox), "Missing standard window controls.");
                progress.EnableControls();
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
                Check(!UI(form, () => Field<Button>(progress, "close").Enabled), "Close could bypass the worker boundary.");
                snapshots["removing"] = Capture(progress, Path.Combine(args[2], args[1] + "-removing.png"));
                UI(form, () => Field<Button>(progress, "pause").PerformClick());
                var checkpoint = Task.Run(() => progress.WaitForWork());
                Wait(() => UI(form, () => Field<Label>(progress, "stage").Text) == messages["progressPaused"]);
                Check(!checkpoint.IsCompleted, "The worker continued while paused.");
                Check(UI(form, () => Field<Button>(progress, "pause").Text) == messages["progressResume"], "Resume did not replace Pause.");
                snapshots["paused"] = Capture(progress, Path.Combine(args[2], args[1] + "-paused.png"));
                UI(form, () => Field<Button>(progress, "pause").PerformClick());
                Check(checkpoint.Wait(3000) && checkpoint.Result, "Resume did not release the worker.");
                progress.Hide(); Wait(() => !UI(form, () => form.Visible));
                progress.Show(); Wait(() => UI(form, () => form.Visible));
                Check(progress.BeginFinishing(), "The final cleanup was not allowed.");
                Wait(() => !UI(form, () => Field<Button>(progress, "cancel").Enabled));
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
                progress.EnableControls();
                progress.Advance();
                Wait(() => UI(form, () => Field<Button>(progress, "cancel").Enabled));
                UI(form, () => ConfirmCancel(progress, false));
                Check(progress.WaitForWork(), "Dismissing Cancel stopped removal.");
                UI(form, () => Field<Button>(progress, "pause").PerformClick());
                var checkpoint = Task.Run(() => progress.BeginFinishing());
                Wait(() => UI(form, () => Field<Label>(progress, "stage").Text) == messages["progressPaused"]);
                UI(form, () => ConfirmCancel(progress, true));
                Check(checkpoint.Wait(3000) && !checkpoint.Result, "Confirmed Cancel did not unlock and stop the paused worker.");
                var cancelled = Task.Run(() => progress.Cancelled());
                Wait(() => UI(form, () => Field<Label>(progress, "stage").Text) == messages["progressCancelled"]);
                snapshots["cancelled"] = Capture(progress, Path.Combine(args[2], args[1] + "-cancelled.png"));
                UI(form, () => Field<Button>(progress, "close").PerformClick());
                Check(cancelled.Wait(3000), "Close did not release the caller after cancellation.");
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
        path.join(root, 'packages/installer/windows/cyberpunk-theme.cs'),
        source,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 },
    );
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const reports = [];
    for (const language of ['en', 'ru', 'ar']) {
      const result = spawnSync(
        executable,
        [
          path.join(root, 'config/uninstaller-text.json'),
          language,
          folder,
          path.join(root, 'assets/default/capri-uninstall-portrait.png'),
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 20000 },
      );
      assert.equal(result.status, 0, language + ': ' + result.stdout + result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.snapshots.preparing.value, 0);
      assert.equal(report.snapshots.removing.value, 0);
      assert.equal(report.snapshots.complete.value, 100);
      assert.equal(report.snapshots.cancelled.value, 0);
      assert.equal(report.snapshots.cancelled.errorVisible, false);
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
