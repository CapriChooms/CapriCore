// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Threading;
using System.Threading.Tasks;

internal static class CapriSetup {
    private static readonly object LogLock=new object();
    private static string diagnosticLog="";
    private static void Log(string kind,string message) {
        if(String.IsNullOrEmpty(diagnosticLog))return;
        try {lock(LogLock) {
            if(File.Exists(diagnosticLog)&&new FileInfo(diagnosticLog).Length>2*1024*1024){
                string previous=diagnosticLog+".previous";NoLinks(previous);
                if(File.Exists(previous))File.Delete(previous);File.Move(diagnosticLog,previous);
            }
            File.AppendAllText(diagnosticLog,new JavaScriptSerializer().Serialize(new {timestamp=DateTime.UtcNow.ToString("o"),kind=kind,message=message})+"\n",new UTF8Encoding(false));
        }}catch{}
    }
    private static string L(string key) { return CapriSetupLocale.Text(key); }

    internal static void RunWizard(ProcessStartInfo start,string uiLog) {
        using(Process wizard=Process.Start(start)) {
            Log("ui-process-start","PID "+wizard.Id+"; log="+uiLog);
            StringBuilder error=new StringBuilder();
            var stderrDone=new TaskCompletionSource<bool>();
            var stdoutDone=new TaskCompletionSource<bool>();
            wizard.ErrorDataReceived+=delegate(object sender,DataReceivedEventArgs data) {
                if(data.Data==null){stderrDone.TrySetResult(true);return;}
                lock(error) {
                    if(error.Length<12000)error.AppendLine(data.Data);
                }
                Log("ui-stderr",data.Data);
            };
            wizard.OutputDataReceived+=delegate(object sender,DataReceivedEventArgs data) {
                if(data.Data==null)stdoutDone.TrySetResult(true);
                else Log("ui-stdout",data.Data);
            };
            wizard.BeginErrorReadLine();
            wizard.BeginOutputReadLine();
            // A descendant can inherit a pipe and keep it open after the wizard exits.
            // Wait for the wizard process itself, then give diagnostics a bounded drain.
            while(!wizard.WaitForExit(1000)) {}
            int exitCode=wizard.ExitCode;
            Log("ui-process-exit","PID "+wizard.Id+"; exitCode="+exitCode);
            if(!Task.WaitAll(new Task[]{stderrDone.Task,stdoutDone.Task},750))
                Log("ui-stream-drain-timeout","At least one output stream remained open after the wizard exited.");
            if(exitCode==0)return;
            if(File.Exists(Path.ChangeExtension(uiLog,"worker.json"))) {
                Log("ui-exit-delegated","The installer session owns recovery and its final status.");
                return;
            }
            string details;
            lock(error)details=error.ToString().Trim();
            throw new InvalidOperationException(L("wizardFailed")+"\n"+L("technicalDetails")+":\n"+
                "powershell.exe ("+exitCode+" / 0x"+unchecked((uint)exitCode).ToString("X8")+")"+
                (details.Length==0?"":"\n"+details));
        }
    }
    private static void NoLinks(string file) {
        string cursor=Path.GetFullPath(file);
        while(!String.IsNullOrEmpty(cursor)) {
            if((Directory.Exists(cursor)||File.Exists(cursor)) && (File.GetAttributes(cursor)&FileAttributes.ReparsePoint)!=0) throw new InvalidOperationException(L("bootstrapLinks"));
            cursor=Path.GetDirectoryName(cursor);
        }
    }
    private static string Hex(byte[] bytes) {return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant();}
    private static bool Matches(ZipArchiveEntry entry,string file) {
        NoLinks(file);
        if(!File.Exists(file)||new FileInfo(file).Length!=entry.Length)return false;
        using(SHA256 hash=SHA256.Create())
        using(Stream current=File.OpenRead(file))
        using(Stream expected=entry.Open())return Hex(hash.ComputeHash(current))==Hex(hash.ComputeHash(expected));
    }
    private static string Unpack(string target, bool explicitTarget, string resource, string checksum, long maximumSize) {
        target=Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar);NoLinks(target);
        if(explicitTarget && Directory.Exists(target) && Directory.GetFileSystemEntries(target).Length>0)throw new InvalidOperationException(L("bootstrapEmptyFolder"));
        Directory.CreateDirectory(target);
        using(Stream input=Assembly.GetExecutingAssembly().GetManifestResourceStream(resource))
        using(MemoryStream payload=new MemoryStream()) {
            if(input==null)throw new InvalidOperationException(L("bootstrapMissingPayload"));
            input.CopyTo(payload);payload.Position=0;
            using(SHA256 hash=SHA256.Create())if(Hex(hash.ComputeHash(payload))!=checksum)throw new InvalidOperationException(L("bootstrapChecksum"));
            payload.Position=0;
            using(ZipArchive zip=new ZipArchive(payload,ZipArchiveMode.Read)) {
                System.Collections.Generic.HashSet<string> seen=new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
                long size=0;
                foreach(ZipArchiveEntry entry in zip.Entries) {
                    string name=entry.FullName.Replace('/',Path.DirectorySeparatorChar);
                    string file=Path.GetFullPath(Path.Combine(target,name));
                    if(Path.IsPathRooted(name)||name.IndexOf(':')>=0||!file.StartsWith(target+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||!seen.Add(file.TrimEnd(Path.DirectorySeparatorChar)))throw new InvalidOperationException(L("bootstrapPath"));
                    size+=entry.Length;if(size>maximumSize)throw new InvalidOperationException(L("bootstrapTooLarge"));NoLinks(file);
                }
                foreach(ZipArchiveEntry entry in zip.Entries) {
                    string file=Path.Combine(target,entry.FullName.Replace('/',Path.DirectorySeparatorChar));
                    if(entry.FullName.EndsWith("/")){Directory.CreateDirectory(file);continue;}
                    Directory.CreateDirectory(Path.GetDirectoryName(file));
                    // A second Setup must not rewrite sources used by the active worker.
                    if(!Matches(entry,file))entry.ExtractToFile(file,true);
                }
            }
        }
        return target;
    }
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    private static extern bool LookupAccountSid(string systemName,byte[] sid,StringBuilder name,ref uint nameChars,
        StringBuilder domain,ref uint domainChars,out int accountType);

    private static bool IsUserAccount(SecurityIdentifier user) {
        const int insufficientBuffer=122,sidTypeUser=1;
        byte[] sid=new byte[user.BinaryLength];user.GetBinaryForm(sid,0);
        uint nameChars=0,domainChars=0;int accountType;
        if(LookupAccountSid(null,sid,null,ref nameChars,null,ref domainChars,out accountType))return accountType==sidTypeUser;
        if(Marshal.GetLastWin32Error()!=insufficientBuffer||nameChars==0||nameChars>32768||domainChars>32768)return false;
        return LookupAccountSid(null,sid,new StringBuilder((int)nameChars),ref nameChars,
            new StringBuilder((int)domainChars),ref domainChars,out accountType)&&accountType==sidTypeUser;
    }

    internal static void CreateProvisionedDirectory(string target,SecurityIdentifier user) {
        if(!IsUserAccount(user))throw new UnauthorizedAccessException("Setup requires a Windows user account.");
        NoLinks(target);
        if(Directory.Exists(target))return;
        var acl=new DirectorySecurity();
        acl.SetAccessRuleProtection(true,false);
        var inherit=InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit;
        acl.AddAccessRule(new FileSystemAccessRule(
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null),
            FileSystemRights.FullControl,inherit,PropagationFlags.None,AccessControlType.Allow));
        acl.AddAccessRule(new FileSystemAccessRule(
            new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null),
            FileSystemRights.FullControl,inherit,PropagationFlags.None,AccessControlType.Allow));
        acl.AddAccessRule(new FileSystemAccessRule(user,FileSystemRights.Modify,inherit,
            PropagationFlags.None,AccessControlType.Allow));
        Directory.CreateDirectory(target,acl);
    }

    // The elevated invocation can only create the fixed directory. It never
    // opens the user session or runs the PowerShell/Node installation worker.
    private static int ProvisionDefaultTarget(string account) {
        try {
            using(var identity=WindowsIdentity.GetCurrent())
                if(!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))return 1;
            string target=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Capri");
            CreateProvisionedDirectory(target,new SecurityIdentifier(account));
            return 0;
        } catch {return 1;}
    }
    [STAThread] private static int Main(string[] args) {
        if(args.Length==2 && args[0]=="--provision-default-target")return ProvisionDefaultTarget(args[1]);
        Application.EnableVisualStyles();
        bool extract=args.Length==2 && args[0]=="--extract-only";
        try {
            string uiLog="";
            if(!extract) {
                string logs=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Capri","Installer","logs");NoLinks(logs);Directory.CreateDirectory(logs);
                string id=Guid.NewGuid().ToString("N");diagnosticLog=Path.Combine(logs,"launcher-"+id+".jsonl");uiLog=Path.Combine(logs,"ui-"+id+".jsonl");
                Log("launcher-start","PID "+Process.GetCurrentProcess().Id);
            }
            bool chooseLanguage=args.Length==1 && args[0].StartsWith("--language=",StringComparison.Ordinal);
            if(chooseLanguage && !CapriSetupLocale.Select(args[0].Substring("--language=".Length)))throw new ArgumentException(L("unsupportedArguments"));
            if(args.Length>0 && !extract && !chooseLanguage)throw new ArgumentException(L("unsupportedArguments"));
            string cacheKey=CapriPayloadInfo.Sha256;
            if(!String.IsNullOrEmpty(CapriPayloadInfo.VoiceSha256))using(SHA256 keyHash=SHA256.Create())cacheKey=Hex(keyHash.ComputeHash(Encoding.UTF8.GetBytes(CapriPayloadInfo.Sha256+CapriPayloadInfo.VoiceSha256)));
            Log("payload",cacheKey);
            string target=extract?args[1]:Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Capri","Setup",cacheKey);
            string source,voice="";
            using(Mutex payloadLock=new Mutex(false,"Local\\Capri.Setup.Payload."+cacheKey)) {
                bool acquired=false;
                try {
                    try{acquired=payloadLock.WaitOne(30000);}catch(AbandonedMutexException){acquired=true;}
                    if(!acquired)throw new IOException(L("wizardFailed")+"\n"+L("technicalDetails")+": Payload extraction lock timed out.");
                    source=Unpack(target,extract,"CapriPayload",CapriPayloadInfo.Sha256,100*1024*1024);
                    if(!String.IsNullOrEmpty(CapriPayloadInfo.VoiceSha256))voice=Unpack(Path.Combine(source,".bundled-voice"),false,"CapriVoicePayload",CapriPayloadInfo.VoiceSha256,200*1024*1024);
                }finally{if(acquired)payloadLock.ReleaseMutex();}
            }
            if(extract)return 0;
            string script=Path.Combine(source,"packages","installer","windows","wizard.ps1");
            ProcessStartInfo start=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe"),"-NoProfile -STA -ExecutionPolicy Bypass -File \""+script+"\" -Language "+CapriSetupLocale.Language+" -UiLogPath \""+uiLog+"\""+(voice.Length>0?" -BundledVoicePack \""+voice+"\"":""));
            start.UseShellExecute=false;start.CreateNoWindow=true;start.WorkingDirectory=source;start.RedirectStandardError=true;start.StandardErrorEncoding=Encoding.UTF8;
            start.RedirectStandardOutput=true;start.StandardOutputEncoding=Encoding.UTF8;
            start.EnvironmentVariables["CAPRI_SETUP_LAUNCHER"]=Assembly.GetExecutingAssembly().Location;
            RunWizard(start,uiLog);
            return 0;
        } catch(Exception error) {
            Log("launcher-error",error.ToString());
            if(extract)File.WriteAllText(Path.Combine(Path.GetTempPath(),"CapriSetup-last-error.txt"),error.ToString());
            else MessageBox.Show(error.Message+"\n\n"+diagnosticLog,L("title"),MessageBoxButtons.OK,
                MessageBoxIcon.Error,MessageBoxDefaultButton.Button1,
                CapriSetupLocale.RightToLeft ? MessageBoxOptions.RtlReading | MessageBoxOptions.RightAlign : 0);
            return 1;
        }
    }
}
