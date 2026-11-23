// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.IO;
using System.Diagnostics;
using System.Reflection;
using System.Windows.Forms;
using System.Text;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
[assembly:AssemblyTitle("Capri")]
[assembly:AssemblyProduct("Capri")]
[assembly:AssemblyCompany("Overyx and Capri contributors")]
internal static class CapriApplication {
    [STAThread] private static int Main(string[] args) {
        string root=Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        if(args.Length==1 && args[0]=="--teleport") return 0; // An older Explorer menu can still reference this launcher.
        try {
            if(CapriUpdateState.BlocksStartup(root)) {
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

// Keep this bootstrap check equivalent to runtime/src/host/update-state.mjs.
// Do not delete receipts here or trust a dead worker as proof of rollback.
internal static class CapriUpdateState {
    [StructLayout(LayoutKind.Sequential)] private struct FileInformation {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Created,Accessed,Written;
        public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;
    }
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GetFileInformationByHandle(SafeFileHandle file,out FileInformation info);
    private static Dictionary<string,object> Record(string file,int maximum) {
        for(string cursor=Path.GetFullPath(file);cursor!=null;cursor=Path.GetDirectoryName(cursor)) {
            if((File.GetAttributes(cursor)&FileAttributes.ReparsePoint)!=0)throw new IOException("Linked update metadata");
        }
        using(FileStream stream=File.OpenRead(file)) {
            FileInformation info;
            if(!GetFileInformationByHandle(stream.SafeFileHandle,out info)||info.Links!=1)throw new IOException("Linked update metadata");
            if(stream.Length>maximum)throw new IOException("Update metadata exceeds its limit");
            using(StreamReader reader=new StreamReader(stream,Encoding.UTF8,true)) {
                return new JavaScriptSerializer {MaxJsonLength=maximum,RecursionLimit=64}.Deserialize<Dictionary<string,object>>(reader.ReadToEnd());
            }
        }
    }
    private static object Value(Dictionary<string,object> record,string key) {
        object value;return record!=null&&record.TryGetValue(key,out value)?value:null;
    }
    internal static bool BlocksStartup(string root) {
        string active=Path.Combine(root,".runtime","updates","active.json");
        if(!File.Exists(active))return false;
        try {
            Dictionary<string,object> pending=Record(active,65536);
            string id=Value(pending,"id") as string;
            if(!Object.Equals(Value(pending,"schemaVersion"),1)||id==null||!System.Text.RegularExpressions.Regex.IsMatch(id,"^[a-f0-9-]{36}$"))return true;
            Dictionary<string,object> journal=Record(Path.Combine(root,".runtime","updates","backups",id,"journal.json"),2*1024*1024);
            string phase=Value(journal,"phase") as string;
            if(!Object.Equals(Value(journal,"schemaVersion"),1)||!Object.Equals(Value(journal,"id"),id)||(phase!="complete"&&phase!="rolled-back"))return true;
            string file=Path.Combine(root,".runtime","installer","install.lock.json");
            if(!File.Exists(file))return false;
            object value=Value(Record(file,65536),"pid");
            if(!(value is int)||(int)value<=0)return true;
            try {using(Process worker=Process.GetProcessById((int)value)){return !worker.HasExited;}}
            catch(ArgumentException){return false;}
        } catch {return true;}
    }
}
