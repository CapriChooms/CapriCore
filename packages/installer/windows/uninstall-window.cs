// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Win32.SafeHandles;
using Theme = Capri.Setup.Cyberpunk;

namespace Capri.Setup {
    // PowerShell may be waiting for core shutdown or filesystem operations. This
    // window owns its message loop so those waits never freeze its progress UI.
    public sealed class UninstallProgress : IDisposable {
        private readonly Dictionary<string, string> messages;
        private readonly bool rightToLeft;
        private readonly string iconPath;
        private readonly Thread thread;
        private readonly ManualResetEventSlim ready = new ManualResetEventSlim();
        private readonly ManualResetEventSlim closed = new ManualResetEventSlim();
        private readonly object stateLock = new object();
        private Form form;
        private Label stage, count;
        private TextBox details;
        private Theme.ProgressBar bar;
        private Button close, report, pause, cancel;
        private Exception startupError;
        private string stageKey = "progressPreparing", errorDetails, failureCode, version;
        private long processed;
        private bool complete, failed, cancelled, failureLayoutShown, allowClose, disposeRequested;
        private bool canControl, pauseRequested, paused, confirmPending, cancelRequested, finishing;
        [DllImport("user32.dll")]
        private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

        public UninstallProgress(IDictionary<string, string> messages, bool rightToLeft, string iconPath) {
            this.messages = new Dictionary<string, string>(messages);
            this.rightToLeft = rightToLeft;
            this.iconPath = iconPath;
            thread = new Thread(Run) { IsBackground = true, Name = "Capri uninstall progress" };
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            if (!ready.Wait(10000)) {
                Dispose();
                throw new TimeoutException("Could not open the uninstall progress window.");
            }
            if (startupError != null) throw new InvalidOperationException("Could not open the uninstall progress window.", startupError);
        }
        private string Text(string key, string fallback) {
            string value;
            return messages.TryGetValue(key, out value) ? value : fallback;
        }
        private void Run() {
            try {
                try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) {}
                Application.EnableVisualStyles();
                using (var window = new Form())
                using (var timer = new System.Windows.Forms.Timer { Interval = 150 }) {
                    form = window;
                    window.Name = "capri-uninstall-progress";
                    window.Text = Text("title", "Uninstall Capri");
                    window.Font = new Font("Segoe UI", 10);
                    window.AutoScaleMode = AutoScaleMode.Dpi;
                    window.AutoScaleDimensions = new SizeF(96, 96);
                    window.ClientSize = new Size(580, 254);
                    window.FormBorderStyle = FormBorderStyle.FixedSingle;
                    window.StartPosition = FormStartPosition.CenterScreen;
                    window.MaximizeBox = false;
                    window.MinimizeBox = true;
                    window.RightToLeft = rightToLeft ? RightToLeft.Yes : RightToLeft.No;
                    window.RightToLeftLayout = rightToLeft;
                    if (File.Exists(iconPath)) window.Icon = new Icon(iconPath);
                    var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(22),
                        ColumnCount = 1, RowCount = 6 };
                    foreach (int height in new[] { 37, 55, 27, 23 })
                        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
                    layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
                    layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
                    var title = new Label { Text = window.Text, Dock = DockStyle.Fill,
                        ForeColor = Theme.Ink.Cyan, Font = new Font(window.Font.FontFamily, 17, FontStyle.Bold) };
                    stage = new Label { Name = "progress-stage", Dock = DockStyle.Fill,
                        TextAlign = ContentAlignment.MiddleLeft,
                        Font = new Font(window.Font, FontStyle.Bold) };
                    count = new Label { Name = "progress-count", Dock = DockStyle.Fill, ForeColor = Theme.Ink.Muted };
                    bar = new Theme.ProgressBar { Name = "progress-bar", Dock = DockStyle.Fill,
                        Style = ProgressBarStyle.Marquee, MarqueeAnimationSpeed = 0, AnimateProgress = true };
                    details = new Theme.TextBox { Name = "progress-error", Dock = DockStyle.Fill,
                        Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Visible = false };
                    close = ActionButton("progress-close", Text("progressClose", "Close"), "primary");
                    report = ActionButton("progress-report", Text("reportBug", "Report a bug"), null);
                    pause = ActionButton("progress-pause", Text("progressPause", "Pause"), "primary");
                    cancel = ActionButton("progress-cancel", Text("cancel", "Cancel"), "danger");
                    var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true,
                        FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(0, 8, 0, 0) };
                    buttons.Controls.Add(close);
                    buttons.Controls.Add(report);
                    buttons.Controls.Add(pause);
                    buttons.Controls.Add(cancel);
                    layout.Controls.Add(title, 0, 0);
                    layout.Controls.Add(stage, 0, 1);
                    layout.Controls.Add(count, 0, 2);
                    layout.Controls.Add(bar, 0, 3);
                    layout.Controls.Add(details, 0, 4);
                    layout.Controls.Add(buttons, 0, 5);
                    window.Controls.Add(layout);
                    Theme.Theme.AttachWindow(window);
                    close.Click += (sender, args) => window.Close();
                    pause.Click += (sender, args) => TogglePause();
                    cancel.Click += (sender, args) => ConfirmCancel(AskToCancel);
                    report.Click += (sender, args) => {
                        if (!OpenReport(failureCode, stageKey, version, Interlocked.Read(ref processed))) {
                            details.Text = ReportUrl(failureCode, stageKey, version, Interlocked.Read(ref processed));
                            details.Focus();
                            details.SelectAll();
                        }
                    };
                    window.FormClosing += (sender, args) => {
                        if (allowClose) return;
                        args.Cancel = true;
                        if (args.CloseReason == CloseReason.UserClosing) ConfirmCancel(AskToCancel);
                    };
                    timer.Tick += (sender, args) => Render();
                    window.Shown += (sender, args) => {
                        if (disposeRequested) { allowClose = true; window.Close(); return; }
                        Render();
                        timer.Start();
                        ready.Set();
                    };
                    Application.Run(window);
                }
            } catch (Exception error) { startupError = error; }
            finally { ready.Set(); closed.Set(); }
        }
        private static Theme.Button ActionButton(string name, string text, string role) {
            return new Theme.Button { Name = name, Text = text, PreviewRole = role,
                AutoSize = true, MinimumSize = new Size(110, 34), Padding = new Padding(12, 0, 12, 0),
                Enabled = false, Visible = false };
        }
        private void Render() {
            string key, error;
            bool done, failure, stopped, stopping, requested, onHold, controls;
            lock (stateLock) {
                key = stageKey; error = errorDetails; done = complete; failure = failed;
                stopped = cancelled; stopping = cancelRequested; requested = pauseRequested; onHold = paused;
                controls = canControl && !finishing;
            }
            bool ended = done || failure || stopped;
            stage.Text = done ? Text("complete", "The selected components were removed.")
                : failure ? Text("failed", "Could not remove the selected components.")
                : stopped ? Text("progressCancelled", "Removal stopped. You can run the uninstaller again.")
                : stopping ? Text("cancel", "Cancel") + "…"
                : onHold ? Text("progressPaused", "Removal paused.")
                : requested ? Text("progressPause", "Pause") + "…"
                : Text(key, "Preparing removal…");
            long items = Interlocked.Read(ref processed);
            count.Text = String.Format(Text("progressItems", "{0} items processed"), items.ToString("N0"));
            count.Visible = items > 0 || key == "progressRemoving" || ended;
            pause.Text = requested ? Text("progressResume", "Resume") : Text("progressPause", "Pause");
            pause.Visible = cancel.Visible = controls && !ended;
            pause.Enabled = cancel.Enabled = controls && !stopping && !ended;
            bar.AnimateProgress = !ended && !onHold;
            if (ended) {
                bar.Style = ProgressBarStyle.Continuous;
                bar.Value = done ? 100 : 0;
                close.Visible = close.Enabled = allowClose = true;
                form.AcceptButton = close;
                form.CancelButton = close;
                if (failure && !failureLayoutShown) {
                    failureLayoutShown = true;
                    int height = Math.Min(form.ClientSize.Height + 150 * form.DeviceDpi / 96,
                        Screen.FromControl(form).WorkingArea.Height - (form.Height - form.ClientSize.Height));
                    form.ClientSize = new Size(form.ClientSize.Width, height);
                    details.Text = Text("technicalDetails", "Technical details") + ":\r\n" + error;
                    details.Visible = true;
                    report.Visible = report.Enabled = true;
                }
            } else {
                form.CancelButton = cancel.Enabled ? cancel : null;
            }
        }
        private void Invoke(Action action) {
            var window = form;
            if (window == null || window.IsDisposed || !window.IsHandleCreated) return;
            try { window.BeginInvoke(action); } catch (InvalidOperationException) {}
        }
        public void Report(string key) { lock (stateLock) stageKey = key; }
        public void Advance() { Interlocked.Increment(ref processed); }
        public void Hide() { Invoke(() => form.Hide()); }
        public void Show() { Invoke(() => form.Show()); }
        public void EnableControls() { lock (stateLock) canControl = true; }
        private bool CanInterrupt() { return canControl && !finishing && !cancelRequested && !complete && !failed; }
        private void TogglePause() {
            lock (stateLock) {
                if (!CanInterrupt() || confirmPending) return;
                pauseRequested = !pauseRequested;
                if (!pauseRequested) paused = false;
                Monitor.PulseAll(stateLock);
            }
            Render();
        }
        private bool AskToCancel() {
            var direction = rightToLeft ? MessageBoxOptions.RightAlign | MessageBoxOptions.RtlReading : 0;
            return MessageBox.Show(form, Text("progressCancelQuestion", "Stop uninstalling? Files already removed cannot be restored."),
                form.Text, MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2, direction) == DialogResult.Yes;
        }
        private void ConfirmCancel(Func<bool> confirm) {
            lock (stateLock) {
                if (!CanInterrupt() || confirmPending) return;
                confirmPending = true;
            }
            bool confirmed = false;
            try { confirmed = confirm(); }
            finally {
                lock (stateLock) {
                    confirmPending = false;
                    if (confirmed && CanInterrupt()) cancelRequested = true;
                    Monitor.PulseAll(stateLock);
                }
                Render();
            }
        }
        public bool WaitForWork() { return WaitForWork(false); }
        public bool BeginFinishing() { return WaitForWork(true); }
        private bool WaitForWork(bool finish) {
            lock (stateLock) {
                while (!cancelRequested && (pauseRequested || confirmPending)) {
                    paused = pauseRequested;
                    Monitor.Wait(stateLock);
                }
                paused = false;
                if (cancelRequested) return false;
                if (finish) { finishing = true; stageKey = "progressFinishing"; }
                return true;
            }
        }
        public void Cancelled() {
            lock (stateLock) cancelled = true;
            Invoke(() => { Render(); form.Show(); });
            closed.Wait();
        }
        public void Complete() {
            lock (stateLock) complete = true;
            Invoke(() => { Render(); form.Show(); });
            closed.Wait();
        }
        public void Fail(string message) { Fail(message, "UNINSTALL_FAILED", ""); }
        public void Fail(string message, string code, string installedVersion) {
            lock (stateLock) {
                failed = true;
                errorDetails = message;
                failureCode = code;
                version = installedVersion;
            }
            Invoke(() => { Render(); form.Show(); });
            closed.Wait();
        }
        internal static string ReportUrl(string code, string phase, string version, long processed) {
            if (!Regex.IsMatch(code ?? "", @"\AUNINSTALL_[A-Z_]{1,40}\z")) code = "UNINSTALL_FAILED";
            if (!Regex.IsMatch(phase ?? "", @"\Aprogress(Preparing|Stopping|Removing|Cleaning|Finishing)\z"))
                phase = "progressPreparing";
            if (!Regex.IsMatch(version ?? "", @"\A[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}\z")) version = "";
            string diagnostics = code + "\nPhase: " + phase + "\nItems processed: " + processed;
            return "https://github.com/CapriChooms/CapriCore/issues/new?template=bug_report.yml" +
                "&title=" + Uri.EscapeDataString("[Bug]: Capri uninstall failed") +
                "&version=" + Uri.EscapeDataString(version) + "&diagnostics=" + Uri.EscapeDataString(diagnostics);
        }
        internal static bool OpenReport(string code, string phase, string version, long processed) {
            try {
                using (Process.Start(new ProcessStartInfo(ReportUrl(code, phase, version, processed)) { UseShellExecute = true })) {}
                return true;
            } catch (Win32Exception) { return false; }
            catch (InvalidOperationException) { return false; }
        }
        public void Dispose() {
            disposeRequested = true;
            lock (stateLock) { cancelRequested = true; Monitor.PulseAll(stateLock); }
            Invoke(() => { allowClose = true; form.Close(); });
            if (Thread.CurrentThread != thread) closed.Wait(5000);
        }
    }
    public static class UninstallWindow {
        [StructLayout(LayoutKind.Sequential)]
        private struct StandardInfo {
            public long Allocated, Length;
            public uint Links;
            public byte DeletePending, IsDirectory;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct FileId {
            public uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow,
                WriteHigh, Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
        }
        private sealed class SharedFile {
            public uint Links;
            public long Bytes;
            public readonly List<int> Masks = new List<int>();
        }
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        private static extern SafeFileHandle CreateFile(string name, uint access, uint share,
            IntPtr security, uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int infoClass,
            out StandardInfo info, uint size);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileId info);
        [DllImport("user32.dll")]
        private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

        private static void Collect(string path, int mask, Dictionary<string, int> files) {
            FileAttributes attributes;
            try { attributes = File.GetAttributes(path); }
            catch (FileNotFoundException) { return; }
            catch (DirectoryNotFoundException) { return; }
            if ((attributes & FileAttributes.ReparsePoint) != 0) return;
            if ((attributes & FileAttributes.Directory) != 0) {
                foreach (string child in Directory.EnumerateFileSystemEntries(path))
                    Collect(child, mask, files);
            } else {
                int previous;
                files.TryGetValue(path, out previous);
                files[path] = previous | mask;
            }
        }
        private static bool Selected(int flags, int selection) {
            return (flags & selection) != 0 || (selection == 7 && (flags & 8) != 0);
        }
        // Slots 1..7 hold bytes released by each combination. Shared hard links
        // release disk blocks only if every reference is removed.
        public static long[] Measure(string[][] groups) {
            var files = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < groups.Length; ++i)
                foreach (string path in groups[i]) Collect(Path.GetFullPath(path), 1 << i, files);
            var totals = new long[8];
            var shared = new Dictionary<string, SharedFile>(StringComparer.Ordinal);
            foreach (var file in files) {
                using (SafeFileHandle handle = CreateFile(@"\\?\" + file.Key, 0x80, 7,
                    IntPtr.Zero, 3, 0x00200000, IntPtr.Zero)) {
                    StandardInfo info;
                    if (handle.IsInvalid || !GetFileInformationByHandleEx(handle, 1, out info,
                        (uint)Marshal.SizeOf(typeof(StandardInfo)))) {
                        int error = Marshal.GetLastWin32Error();
                        if (error == 2 || error == 3) continue;
                        throw new Win32Exception(error, file.Key);
                    }
                    if (info.Links <= 1) {
                        for (int selection = 1; selection < totals.Length; ++selection)
                            if (Selected(file.Value, selection)) totals[selection] += info.Allocated;
                        continue;
                    }
                    FileId id;
                    if (!GetFileInformationByHandle(handle, out id))
                        throw new Win32Exception(Marshal.GetLastWin32Error(), file.Key);
                    string key = id.Volume + ":" + id.IndexHigh + ":" + id.IndexLow;
                    SharedFile group;
                    if (!shared.TryGetValue(key, out group))
                        shared[key] = group = new SharedFile { Links = info.Links, Bytes = info.Allocated };
                    group.Masks.Add(file.Value);
                }
            }
            foreach (var group in shared.Values)
                for (int selection = 1; selection < totals.Length; ++selection) {
                    int count = group.Masks.FindAll(mask => Selected(mask, selection)).Count;
                    if (count == group.Links) totals[selection] += group.Bytes;
                }
            return totals;
        }

        private static MessageBoxOptions ReadingDirection(bool rightToLeft) {
            return rightToLeft ? MessageBoxOptions.RtlReading | MessageBoxOptions.RightAlign : 0;
        }
        public static void Complete(string message, bool rightToLeft) {
            MessageBox.Show(message, "Capri", MessageBoxButtons.OK, MessageBoxIcon.Information,
                MessageBoxDefaultButton.Button1, ReadingDirection(rightToLeft));
        }
        private static string FormatBytes(long bytes, string format) {
            return String.Format(format, bytes.ToString("N0"));
        }
        private static string Size(long bytes, string byteFormat) {
            if (bytes >= 1000000000) return (bytes / 1000000000d).ToString("0.00") + " GB";
            if (bytes >= 1000000) return (bytes / 1000000d).ToString("0.00") + " MB";
            if (bytes >= 1000) return (bytes / 1000d).ToString("0.##") + " kB";
            return FormatBytes(bytes, byteFormat);
        }
        private static Bitmap LoadPortrait(string path) {
            if (!File.Exists(path)) return null;
            try {
                using (var stream = File.OpenRead(path))
                using (var image = Image.FromStream(stream))
                    return new Bitmap(image);
            } catch (IOException) { return null; }
              catch (UnauthorizedAccessException) { return null; }
              catch (ArgumentException) { return null; }
              catch (ExternalException) { return null; }
              catch (OutOfMemoryException) { return null; } // GDI+ can report this for invalid image data.
        }
        public static int Show(string root, string[][] groups, int defaults, string iconPath,
            IDictionary<string, string> messages, bool rightToLeft, string portraitPath) {
            try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) {}
            Application.EnableVisualStyles();
            Func<string, string, string> text = (key, fallback) => {
                string value;
                return messages.TryGetValue(key, out value) ? value : fallback;
            };
            using (var portrait = LoadPortrait(portraitPath))
            using (var form = new Form())
            using (var tooltip = new ToolTip()) {
                const int presetHeight = 360, customHeight = 564;
                defaults &= 7;
                form.Name = "capri-uninstall-selection";
                form.Text = messages["title"];
                form.AutoScaleMode = AutoScaleMode.Dpi;
                form.AutoScaleDimensions = new SizeF(96, 96);
                form.Font = new Font("Segoe UI", 10);
                form.ClientSize = new Size(660, defaults == 1 || defaults == 7 ? presetHeight : customHeight);
                form.MinimumSize = new Size(600, 380);
                form.StartPosition = FormStartPosition.CenterScreen;
                form.MaximizeBox = false;
                form.MinimizeBox = true;
                form.RightToLeft = rightToLeft ? RightToLeft.Yes : RightToLeft.No;
                form.RightToLeftLayout = rightToLeft;
                if (File.Exists(iconPath)) form.Icon = new Icon(iconPath);
                var table = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(22),
                    ColumnCount = 2, RowCount = 5 };
                table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 72));
                table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 28));
                table.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
                table.RowStyles.Add(new RowStyle(SizeType.Absolute, portrait == null ? 27 : 47));
                table.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
                table.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
                table.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
                form.Controls.Add(table);
                Action<Control,int> add = (control,row) => {
                    table.Controls.Add(control, 0, row);
                    table.SetColumnSpan(control, 2);
                };
                var title = new Label { Text = form.Text, AutoSize = true,
                    ForeColor = Theme.Ink.Cyan, Font = new Font(form.Font.FontFamily, 17, FontStyle.Bold) };
                var location = new Label { Text = root, AutoEllipsis = true, Dock = DockStyle.Fill, ForeColor = Theme.Ink.Muted };
                tooltip.SetToolTip(location, root);
                if (portrait == null) {
                    add(title, 0);
                    add(location, 1);
                } else {
                    table.Controls.Add(title, 0, 0);
                    table.Controls.Add(location, 0, 1);
                    var picture = new PictureBox { Name = "capri-portrait", Image = portrait,
                        SizeMode = PictureBoxSizeMode.Zoom, Dock = DockStyle.Fill,
                        Margin = new Padding(8, 0, 0, 10) };
                    table.Controls.Add(picture, 1, 0);
                    table.SetRowSpan(picture, 2);
                }
                var optionsViewport = new Panel { Dock = DockStyle.Fill, AutoScroll = true,
                    Margin = new Padding(0, 4, 0, 8) };
                var options = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true,
                    AutoSizeMode = AutoSizeMode.GrowAndShrink, ColumnCount = 1 };
                options.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
                optionsViewport.Controls.Add(options);
                add(optionsViewport, 2);
                Func<string, string, RadioButton> mode = (name, label) => {
                    var button = new Theme.RadioButton { Name = "mode-" + name, Text = label, SurveyAnswer = true,
                        Dock = DockStyle.Fill, MinimumSize = new Size(0, 38) };
                    options.Controls.Add(button);
                    return button;
                };
                var standard = mode("standard", text("standardRemoval", "Uninstall Capri and keep models and personal data"));
                var complete = mode("complete", text("completeRemoval", "Uninstall Capri and delete all its files and data"));
                var custom = mode("custom", text("customRemoval", "Choose what to remove"));
                (defaults == 1 ? standard : defaults == 7 ? complete : custom).Checked = true;
                var components = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true,
                    AutoSizeMode = AutoSizeMode.GrowAndShrink, ColumnCount = 2, RowCount = 4,
                    Margin = new Padding(20, 2, 3, 2) };
                components.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 72));
                components.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 28));
                components.RowStyles.Add(new RowStyle(SizeType.Absolute, 78));
                for (int i = 0; i < 3; ++i) components.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
                var help = new Label { Dock = DockStyle.Fill, Text = messages["selectionHelp"] };
                components.Controls.Add(help, 0, 0);
                components.SetColumnSpan(help, 2);
                options.Controls.Add(components);
                var checks = new CheckBox[3];
                var sizes = new Label[3];
                string[] labels = {
                    messages["application"], messages["models"], messages["personalData"]
                };
                for (int i = 0; i < 3; ++i) {
                    checks[i] = new Theme.CheckBox { Name = "group-" + i, Text = labels[i],
                        Dock = DockStyle.Fill, Checked = (defaults & (1 << i)) != 0 };
                    sizes[i] = new Label { Text = "…", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleRight };
                    components.Controls.Add(checks[i], 0, i + 1);
                    components.Controls.Add(sizes[i], 1, i + 1);
                }
                var status = new Label { Name = "disk-usage", Dock = DockStyle.Fill, AutoEllipsis = true,
                    Text = messages["measuring"] };
                add(status, 3);
                var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft,
                    WrapContents = false };
                var cancel = new Theme.Button { Name = "selection-cancel", Text = messages["cancel"], AutoSize = true,
                    Padding = new Padding(12, 0, 12, 0), MinimumSize = new Size(96, 34),
                    PreviewRole = "danger", DialogResult = DialogResult.Cancel };
                var remove = new Theme.Button { Name = "selection-remove", Text = messages["remove"], AutoSize = true,
                    Padding = new Padding(12, 0, 12, 0), MinimumSize = new Size(128, 34),
                    PreviewRole = "primary", Enabled = false };
                var report = new Theme.Button { Text = messages["reportBug"], AutoSize = true,
                    Padding = new Padding(12, 0, 12, 0), MinimumSize = new Size(96, 34), Visible = false };
                buttons.Controls.Add(cancel);
                buttons.Controls.Add(remove);
                buttons.Controls.Add(report);
                add(buttons, 4);
                Theme.Theme.AttachWindow(form);
                form.CancelButton = cancel;
                form.AcceptButton = remove;
                long[] measured = null;
                int result = 0;
                string byteFormat = messages["bytes"];
                Func<int> selection = () => standard.Checked ? 1 : complete.Checked ? 7 :
                    (checks[0].Checked ? 1 : 0) | (checks[1].Checked ? 2 : 0) | (checks[2].Checked ? 4 : 0);
                Action refresh = () => {
                    int mask = selection();
                    components.Visible = custom.Checked;
                    remove.Text = custom.Checked ? messages["remove"] : text("uninstallAction", "Uninstall Capri");
                    if (measured == null) return;
                    remove.Enabled = mask != 0;
                    status.Text = String.Format(messages["selectedSpace"], Size(measured[mask], byteFormat));
                    tooltip.SetToolTip(status, FormatBytes(measured[mask], byteFormat));
                };
                Action fitOptions = () => {
                    var workArea = Screen.FromControl(form).WorkingArea;
                    int frame = form.Height - form.ClientSize.Height;
                    int target = (custom.Checked ? customHeight : presetHeight) * form.DeviceDpi / 96;
                    form.ClientSize = new Size(form.ClientSize.Width, Math.Min(target, workArea.Height - frame));
                    if (form.Bottom > workArea.Bottom) form.Top = Math.Max(workArea.Top, workArea.Bottom - form.Height);
                    optionsViewport.AutoScrollPosition = Point.Empty;
                };
                foreach (CheckBox check in checks) check.CheckedChanged += (sender, args) => refresh();
                foreach (RadioButton choice in new[] { standard, complete, custom })
                    choice.CheckedChanged += (sender, args) => {
                        if (!((RadioButton)sender).Checked) return;
                        refresh();
                        fitOptions();
                    };
                refresh();
                form.Shown += async (sender, args) => {
                    fitOptions();
                    try {
                        measured = await Task.Run(() => Measure(groups));
                        if (form.IsDisposed) return;
                        for (int i = 0; i < sizes.Length; ++i) {
                            long bytes = measured[1 << i];
                            sizes[i].Text = Size(bytes, byteFormat);
                            tooltip.SetToolTip(sizes[i], FormatBytes(bytes, byteFormat));
                        }
                        refresh();
                    } catch {
                        if (form.IsDisposed) return;
                        status.Text = messages["measureFailed"];
                        report.Visible = true;
                    }
                };
                report.Click += (sender, args) => {
                    if (!UninstallProgress.OpenReport("UNINSTALL_MEASURE_FAILED", "progressPreparing", "", 0))
                        MessageBox.Show(form, UninstallProgress.ReportUrl("UNINSTALL_MEASURE_FAILED", "progressPreparing", "", 0), form.Text);
                };
                remove.Click += (sender, args) => {
                    int mask = selection();
                    if (mask == 0 || measured == null) return;
                    string confirmation = mask == 7
                        ? text("confirmCompleteRemoval", "Permanently delete Capri, downloaded models, and personal data?")
                        : messages["confirm"];
                    if (MessageBox.Show(form, confirmation, form.Text, MessageBoxButtons.YesNo,
                        MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2, ReadingDirection(rightToLeft)) != DialogResult.Yes) return;
                    result = mask;
                    form.DialogResult = DialogResult.OK;
                };
                return form.ShowDialog() == DialogResult.OK ? result : 0;
            }
        }
    }
}
