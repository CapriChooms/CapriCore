// SPDX-License-Identifier: GPL-3.0-only
// Owned native contract fixture, not an Opera browser or a distributed binary.
using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
#if UNRELATED
[assembly: AssemblyCompany("Capri disposable fixture")]
[assembly: AssemblyProduct("Unrelated launcher")]
#else
[assembly: AssemblyCompany("Opera Software AS")]
[assembly: AssemblyProduct("Opera GX Internet Browser")]
#endif
[assembly: AssemblyVersion("1.2.3.4")]
[assembly: AssemblyFileVersion("1.2.3.4")]
class OperaBrowserFixture {
    [STAThread] static void Main(string[] args) {
        if(Path.GetFileName(Application.ExecutablePath).Equals("launcher.exe",StringComparison.OrdinalIgnoreCase)){
            // Invalid browser actions must be rejected before this can execute.
            File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"launcher-ran.txt"),"unexpected");
            return;
        }
        Application.EnableVisualStyles();
        var form=new Form { Text="Capri owned Opera contract "+Guid.NewGuid().ToString("N"), Width=520, Height=180, ShowInTaskbar=true, KeyPreview=true, StartPosition=FormStartPosition.Manual, Location=new Point(0,0) };
        var bar=new ToolStrip { AccessibleName="Browser navigation", Dock=DockStyle.Top };
        var field=new ToolStripTextBox { Name="address", AccessibleName="Address and search bar", Text="about:blank", AutoSize=false, Width=470 };
        bar.Items.Add(field); form.Controls.Add(bar);
        form.KeyDown+=(sender,e)=>{if(e.Control&&e.KeyCode==Keys.L){field.Focus();field.SelectAll();e.SuppressKeyPress=true;}};
        form.Shown+=(sender,e)=>field.Focus();
        var timer=new Timer { Interval=60000 };timer.Tick+=(sender,e)=>form.Close();timer.Start();
        Application.Run(form);
    }
}
