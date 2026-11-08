// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.IO;
using System.Diagnostics;
using System.Reflection;
using System.Windows.Forms;
using System.Text;
[assembly:AssemblyTitle("Capri")]
[assembly:AssemblyProduct("Capri")]
[assembly:AssemblyCompany("Overyx and Capri contributors")]
internal static class CapriApplication {
    [STAThread] private static int Main(string[] args) {
        string root=Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        if(args.Length==1 && args[0]=="--teleport") return 0; // An older Explorer menu can still reference this launcher.
        try {
            if(File.Exists(Path.Combine(root,".runtime","updates","active.json"))) {
                CapriSetupLocale.SelectInstalled(root);
                ShowFailure(CapriSetupLocale.Text("launcherUpdateActive",
                    "An update is running or was interrupted. Wait for it to finish. If the update window is closed, run Capri Setup to repair the installation. Your data will be kept."),
                    MessageBoxIcon.Warning);
                return 1;
            }
            string node=Path.Combine(root,".runtime",CapriApplicationInfo.NodeDirectory,"node.exe");
            string cli=Path.Combine(root,"packages","runtime","bin","capri.mjs");
            ProcessStartInfo start=new ProcessStartInfo(node,"\""+cli+"\" desktop --wait");
            start.WorkingDirectory=root;start.UseShellExecute=false;start.CreateNoWindow=true;start.RedirectStandardError=true;start.RedirectStandardOutput=true;
            using(Process process=Process.Start(start)) {
                StringBuilder errors=new StringBuilder();
                process.ErrorDataReceived+=(sender,eventArgs)=>{if(eventArgs.Data!=null)lock(errors){errors.AppendLine(eventArgs.Data);if(errors.Length>4000)errors.Remove(0,errors.Length-4000);}};
                process.OutputDataReceived+=(sender,eventArgs)=>{};
                process.BeginErrorReadLine();process.BeginOutputReadLine();process.WaitForExit();
                if(process.ExitCode!=0)throw new InvalidOperationException(errors.ToString());
            }
            return 0;
        } catch(Exception error) {
            CapriSetupLocale.SelectInstalled(root);
            ShowFailure(CapriSetupLocale.Text("launcherFailed","Capri could not start.")+"\n"+error.Message,
                MessageBoxIcon.Error);
            return 1;
        }
    }
    private static void ShowFailure(string text, MessageBoxIcon icon) {
        MessageBox.Show(text,"Capri",MessageBoxButtons.OK,icon,MessageBoxDefaultButton.Button1,
            CapriSetupLocale.RightToLeft ? MessageBoxOptions.RtlReading | MessageBoxOptions.RightAlign : 0);
    }
}
