// Disposable native UI Automation fixture. No owner files or applications.
using System;
using System.Drawing;
using System.Windows.Forms;
class CapriEditFixture {
  [STAThread] static void Main(string[] args) {
    if(args.Length!=0){Environment.Exit(3);return;}
    Application.EnableVisualStyles();
    var form = new Form { Text="Capri disposable text-entry fixture", Width=400, Height=200, ShowInTaskbar=true, StartPosition=FormStartPosition.Manual, Location=new Point(0,0) };
    form.Controls.Add(new TextBox { Name="CapriFixtureText", AccessibleName="Disposable draft", Multiline=false, Dock=DockStyle.Top, Text="Draft: " });
    var timer = new Timer { Interval=45000 }; timer.Tick += (s,e) => form.Close(); timer.Start();
    Application.Run(form);
  }
}
