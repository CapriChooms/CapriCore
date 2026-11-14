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
    const string draft = "Capri replanned";
    const string confirmation = "Подтверждаю café";
    var form = new Form { Text = "Capri isolated replanning verification", Width = 600, Height = 290, TopMost = true };
    var field = new TextBox { Left = 25, Top = 30, Width = 480, AccessibleName = "Verification text" };
    var save = new Button { Left = 25, Top = 85, Width = 220, Height = 45, Text = "Save fixture draft", AccessibleName = "Save fixture draft" };
    var status = new Label { Left = 25, Top = 155, Width = 480, Height = 40, Text = "Fixture ready", AccessibleName = "Fixture ready" };
    form.Controls.Add(field); form.Controls.Add(save); form.Controls.Add(status);
    field.TextChanged += (s, e) => { if (field.Text == draft) record("draft-complete"); };
    save.Click += (s, e) => {
      if (field.Text != draft) { record("save-invalid"); return; }
      using (var confirmationDialog = new Form { Text = "Capri fixture save confirmation", Width = 460, Height = 195, TopMost = true, StartPosition = FormStartPosition.CenterParent, FormBorderStyle = FormBorderStyle.FixedDialog }) {
        var input = new TextBox { Left = 20, Top = 20, Width = 350, AccessibleName = "Save confirmation text" };
        var cancel = new Button { Left = 20, Top = 75, Width = 150, Height = 40, Text = "Discard draft" };
        var confirm = new Button { Left = 200, Top = 75, Width = 170, Height = 40, Text = "Confirm save" };
        cancel.Click += (sender, eventArgs) => { record("discard-clicked"); confirmationDialog.Close(); };
        confirm.Click += (sender, eventArgs) => {
          if (input.Text != confirmation) { record("confirmation-invalid"); return; }
          confirmationDialog.DialogResult = DialogResult.OK;
        };
        input.TextChanged += (sender, eventArgs) => { if (input.Text == confirmation) record("confirmation-entered"); };
        confirmationDialog.Controls.AddRange(new Control[] { input, cancel, confirm });
        confirmationDialog.Shown += (sender, eventArgs) => {
          record("confirmation-opened");
          SetForegroundWindow(confirmationDialog.Handle);
          cancel.Focus();
        };
        if (confirmationDialog.ShowDialog(form) != DialogResult.OK) return;
      }
      SetForegroundWindow(form.Handle);
      record("saved"); save.Text = "Draft saved"; save.AccessibleName = "Draft saved";
    };
    bool shown = false;
    var blocker = new Timer { Interval = 50 };
    blocker.Tick += (s, e) => {
      if (shown || !File.Exists(trigger) || field.Text != draft) return;
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
