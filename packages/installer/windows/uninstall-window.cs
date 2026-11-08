// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32.SafeHandles;

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
        private ProgressBar bar;
        private Button close;
        private Exception startupError;
        private string stageKey = "progressPreparing", errorDetails;
        private long processed;
        private bool complete, failed, allowClose, disposeRequested;
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
                    window.ClientSize = new Size(560, 228);
                    window.FormBorderStyle = FormBorderStyle.FixedDialog;
                    window.StartPosition = FormStartPosition.CenterScreen;
                    window.MaximizeBox = false;
                    window.ControlBox = false;
                    window.RightToLeft = rightToLeft ? RightToLeft.Yes : RightToLeft.No;
                    window.RightToLeftLayout = rightToLeft;
                    if (File.Exists(iconPath)) window.Icon = new Icon(iconPath);
                    var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(22),
                        ColumnCount = 1, RowCount = 5 };
                    foreach (int height in new[] { 52, 28, 26, 0, 52 })
                        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
                    stage = new Label { Name = "progress-stage", Dock = DockStyle.Fill,
                        Font = new Font(window.Font, FontStyle.Bold) };
                    count = new Label { Name = "progress-count", Dock = DockStyle.Fill };
                    bar = new ProgressBar { Name = "progress-bar", Dock = DockStyle.Fill,
                        Style = ProgressBarStyle.Marquee, MarqueeAnimationSpeed = 25 };
                    details = new TextBox { Name = "progress-error", Dock = DockStyle.Fill,
                        Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Visible = false };
                    close = new Button { Name = "progress-close", Text = Text("progressClose", "Close"),
                        AutoSize = true, Enabled = false, Visible = false };
                    var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill,
                        FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(0, 12, 0, 0) };
                    buttons.Controls.Add(close);
                    layout.Controls.Add(stage, 0, 0);
                    layout.Controls.Add(count, 0, 1);
                    layout.Controls.Add(bar, 0, 2);
                    layout.Controls.Add(details, 0, 3);
                    layout.Controls.Add(buttons, 0, 4);
                    window.Controls.Add(layout);
                    close.Click += (sender, args) => window.Close();
                    window.FormClosing += (sender, args) => { if (!allowClose) args.Cancel = true; };
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
        private void Render() {
            string key, error;
            bool done, failure;
            lock (stateLock) { key = stageKey; error = errorDetails; done = complete; failure = failed; }
            stage.Text = done ? Text("complete", "The selected components were removed.")
                : failure ? Text("failed", "Could not remove the selected components.")
                : Text(key, "Preparing removal…");
            count.Text = String.Format(Text("progressItems", "{0} items processed"), Interlocked.Read(ref processed).ToString("N0"));
            count.Visible = Interlocked.Read(ref processed) > 0 || key == "progressRemoving" || done || failure;
            if (done || failure) {
                bar.Style = ProgressBarStyle.Continuous;
                bar.Value = done ? 100 : 0;
                close.Visible = close.Enabled = allowClose = true;
                form.AcceptButton = close;
                form.CancelButton = close;
                if (failure && !details.Visible) {
                    ((TableLayoutPanel)details.Parent).RowStyles[3].Height = 130;
                    form.ClientSize = new Size(form.ClientSize.Width, form.ClientSize.Height + 130);
                    details.Text = Text("technicalDetails", "Technical details") + ":\r\n" + error;
                    details.Visible = true;
                }
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
        public void Complete() {
            lock (stateLock) complete = true;
            Invoke(() => { Render(); form.Show(); });
            closed.Wait();
        }
        public void Fail(string message) {
            lock (stateLock) { failed = true; errorDetails = message; }
            Invoke(() => { Render(); form.Show(); });
            closed.Wait();
        }
        public void Dispose() {
            disposeRequested = true;
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
        public static int Show(string root, string[][] groups, int defaults, string iconPath,
            IDictionary<string, string> messages, bool rightToLeft) {
            try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) {}
            Application.EnableVisualStyles();
            using (var form = new Form())
            using (var tooltip = new ToolTip()) {
                form.Text = messages["title"];
                form.AutoScaleMode = AutoScaleMode.Dpi;
                form.AutoScaleDimensions = new SizeF(96, 96);
                form.Font = new Font("Segoe UI", 10);
                form.ClientSize = new Size(660, 450);
                form.MinimumSize = new Size(600, 450);
                form.StartPosition = FormStartPosition.CenterScreen;
                form.MaximizeBox = false;
                form.RightToLeft = rightToLeft ? RightToLeft.Yes : RightToLeft.No;
                form.RightToLeftLayout = rightToLeft;
                if (File.Exists(iconPath)) form.Icon = new Icon(iconPath);
                var table = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(22),
                    ColumnCount = 2, RowCount = 8 };
                table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 72));
                table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 28));
                foreach (int height in new[] { 34, 27, 76, 55, 55, 55, 42 })
                    table.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
                table.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
                form.Controls.Add(table);
                Action<Control,int> add = (control,row) => {
                    table.Controls.Add(control, 0, row);
                    table.SetColumnSpan(control, 2);
                };
                add(new Label { Text = form.Text, AutoSize = true, Font = new Font(form.Font.FontFamily, 17, FontStyle.Bold) }, 0);
                var location = new Label { Text = root, AutoEllipsis = true, Dock = DockStyle.Fill };
                tooltip.SetToolTip(location, root);
                add(location, 1);
                add(new Label { Dock = DockStyle.Fill, Text = messages["selectionHelp"] }, 2);
                var checks = new CheckBox[3];
                var sizes = new Label[3];
                string[] labels = {
                    messages["application"], messages["models"], messages["personalData"]
                };
                for (int i = 0; i < 3; ++i) {
                    checks[i] = new CheckBox { Name = "group-" + i, Text = labels[i],
                        Dock = DockStyle.Fill, Checked = (defaults & (1 << i)) != 0 };
                    sizes[i] = new Label { Text = "…", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleRight };
                    table.Controls.Add(checks[i], 0, 3+i);
                    table.Controls.Add(sizes[i], 1, 3+i);
                }
                var status = new Label { Name = "disk-usage", Dock = DockStyle.Fill, AutoEllipsis = true,
                    Text = messages["measuring"] };
                add(status, 6);
                var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft,
                    WrapContents = false };
                var cancel = new Button { Text = messages["cancel"], AutoSize = true, DialogResult = DialogResult.Cancel };
                var remove = new Button { Text = messages["remove"], AutoSize = true, Enabled = false };
                buttons.Controls.Add(cancel);
                buttons.Controls.Add(remove);
                add(buttons, 7);
                form.CancelButton = cancel;
                form.AcceptButton = remove;
                long[] measured = null;
                int result = 0;
                string byteFormat = messages["bytes"];
                Func<int> selection = () => (checks[0].Checked ? 1 : 0) | (checks[1].Checked ? 2 : 0) | (checks[2].Checked ? 4 : 0);
                Action refresh = () => {
                    int mask = selection();
                    if (measured == null) return;
                    remove.Enabled = mask != 0;
                    status.Text = String.Format(messages["selectedSpace"], Size(measured[mask], byteFormat));
                    tooltip.SetToolTip(status, FormatBytes(measured[mask], byteFormat));
                };
                foreach (CheckBox check in checks) check.CheckedChanged += (sender, args) => refresh();
                form.Shown += async (sender, args) => {
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
                    }
                };
                remove.Click += (sender, args) => {
                    if (MessageBox.Show(form, messages["confirm"], form.Text, MessageBoxButtons.YesNo,
                        MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2, ReadingDirection(rightToLeft)) != DialogResult.Yes) return;
                    result = selection();
                    form.DialogResult = DialogResult.OK;
                };
                return form.ShowDialog() == DialogResult.OK ? result : 0;
            }
        }
    }
}
