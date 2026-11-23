// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Reflection;
[assembly:AssemblyTitle("Capri Update")]
[assembly:AssemblyProduct("Capri")]
internal static class CapriUpdateHost {
    private static readonly object gate=new object();
    private static void Log(string file,string text) {
        lock(gate) {
            try {
                using(var stream=new FileStream(file,FileMode.Append,FileAccess.Write,FileShare.ReadWrite))
                using(var writer=new StreamWriter(stream,new UTF8Encoding(false)))writer.WriteLine(text);
            } catch { /* Diagnostic failure must not terminate an active update. */ }
        }
    }
    private static string Quote(string value) {
        if(String.IsNullOrWhiteSpace(value)||!Path.IsPathRooted(value)||value.IndexOf('"')>=0)throw new ArgumentException("Expected an absolute update path");
        return "\""+value+"\"";
    }
    [STAThread] private static int Main(string[] args) {
        if(args.Length!=4)return 2;
        try {
            var start=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe"));
            start.Arguments="-NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -File "+Quote(args[0])+" -Request "+Quote(args[1]);
            start.WorkingDirectory=Path.GetDirectoryName(args[1]);
            start.UseShellExecute=false;start.CreateNoWindow=true;
            start.RedirectStandardOutput=true;start.RedirectStandardError=true;
            start.StandardOutputEncoding=Encoding.UTF8;start.StandardErrorEncoding=Encoding.UTF8;
            using(var ui=Process.Start(start)) {
                Log(args[2],"Update UI process started: "+ui.Id);
                ui.OutputDataReceived+=(sender,data)=>{if(data.Data!=null)Log(args[2],data.Data);};
                ui.ErrorDataReceived+=(sender,data)=>{if(data.Data!=null)Log(args[3],data.Data);};
                ui.BeginOutputReadLine();ui.BeginErrorReadLine();ui.WaitForExit();
                Log(args[2],"Update UI process exited: "+ui.ExitCode);
                return ui.ExitCode;
            }
        }catch(Exception error){Log(args[3],error.ToString());return 1;}
    }
}
