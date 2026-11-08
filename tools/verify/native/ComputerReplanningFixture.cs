// SPDX-License-Identifier: GPL-3.0-only
// Disposable native input target; the trigger and log belong to this test only.
using System;
using System.IO;
using System.Windows.Forms;
using System.Runtime.InteropServices;

class ComputerReplanningFixture {
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr handle);
  [STAThread] static void Main(string[] args) {
    string log = args[0], trigger = args[1];
    Action<string> record = line => File.AppendAllText(log, line + "\n");
    var form = new Form { Text = "Capri isolated replanning verification", Width = 600, Height = 290, TopMost = true };
    var field = new TextBox { Left = 25, Top = 30, Width = 480, AccessibleName = "Verification text" };
    var save = new Button { Left = 25, Top = 85, Width = 220, Height = 45, Text = "Save fixture draft", AccessibleName = "Save fixture draft" };
    var status = new Label { Left = 25, Top = 155, Width = 480, Height = 40, Text = "Fixture ready", AccessibleName = "Fixture ready" };
    form.Controls.Add(field); form.Controls.Add(save); form.Controls.Add(status);
    field.TextChanged += (s, e) => { if (field.Text == "Capri replanned") record("draft-complete"); };
    save.Click += (s, e) => {
      if (field.Text != "Capri replanned") { record("save-invalid"); return; }
      record("saved"); save.Text = "Draft saved"; save.AccessibleName = "Draft saved";
    };
    bool shown = false;
    var blocker = new Timer { Interval = 50 };
    blocker.Tick += (s, e) => {
      if (shown || !File.Exists(trigger) || field.Text != "Capri replanned") return;
      shown = true; blocker.Stop(); record("dialog-opened");
      using (var dialog = new Form { Text = "Capri fixture blocking dialog", Width = 420, Height = 205, TopMost = true, StartPosition = FormStartPosition.CenterParent, FormBorderStyle = FormBorderStyle.FixedDialog, MinimizeBox = false, MaximizeBox = false }) {
        var note = new Label { Left = 20, Top = 20, Width = 350, Height = 40, Text = "Ordinary fixture reminder", AccessibleName = "Ordinary fixture reminder" };
        var dismiss = new Button { Left = 20, Top = 80, Width = 270, Height = 45, Text = "Dismiss fixture dialog", AccessibleName = "Dismiss fixture dialog" };
        dismiss.Click += (sender, eventArgs) => { record("dialog-dismissed"); dialog.Close(); };
        dialog.Controls.Add(note); dialog.Controls.Add(dismiss);
        dialog.Shown += (sender, eventArgs) => { SetForegroundWindow(dialog.Handle); dismiss.Focus(); };
        dialog.ShowDialog(form);
      }
      status.Text = "Fixture dialog dismissed"; status.AccessibleName = "Fixture dialog dismissed";
      SetForegroundWindow(form.Handle);
    };
    form.Shown += (s, e) => { SetForegroundWindow(form.Handle); field.Focus(); record("ready"); blocker.Start(); };
    var deadline = new Timer { Interval = 120000 };
    deadline.Tick += (s, e) => Application.Exit(); deadline.Start();
    Application.Run(form);
  }
}
