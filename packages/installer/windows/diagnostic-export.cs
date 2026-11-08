// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using System.Linq;
using System.Web.Script.Serialization;
using System.Runtime.InteropServices;
using System.Management;
using System.Threading.Tasks;

namespace Capri.Setup {
public static class DiagnosticArchive {
    const int FileLimit=256*1024, TotalLimit=12*1024*1024;
    static Dictionary<string,object> Obj(params object[] pairs) {
        var result=new Dictionary<string,object>();for(int i=0;i<pairs.Length;i+=2)result[(string)pairs[i]]=pairs[i+1];return result;
    }
    [StructLayout(LayoutKind.Sequential)] class MemoryStatus {
        public uint length=(uint)Marshal.SizeOf(typeof(MemoryStatus)),load;
        public ulong total,available,pageTotal,pageAvailable,virtualTotal,virtualAvailable,extended;
    }
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GlobalMemoryStatusEx([In,Out] MemoryStatus value);
    [DllImport("shell32.dll")] static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid id,uint flags,IntPtr token,out IntPtr path);
    public static string Downloads() {
        IntPtr ptr;int result=SHGetKnownFolderPath(new Guid("374DE290-123F-4565-9164-39C4925E467B"),0,IntPtr.Zero,out ptr);
        if(result!=0)return Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        try{return Marshal.PtrToStringUni(ptr);}finally{Marshal.FreeCoTaskMem(ptr);}
    }
    static void NoLinks(string file) {
        for(string cursor=Path.GetFullPath(file);!String.IsNullOrEmpty(cursor);cursor=Path.GetDirectoryName(cursor))
            if((File.Exists(cursor)||Directory.Exists(cursor))&&(File.GetAttributes(cursor)&FileAttributes.ReparsePoint)!=0)throw new IOException("Diagnostic sources cannot contain filesystem links.");
    }
    sealed class Collector {
        readonly Dictionary<string,string> logs=new Dictionary<string,string>();
        readonly HashSet<string> capturedPaths=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        public List<object> Inventory=new List<object>();
        public List<string> Warnings=new List<string>();
        readonly List<KeyValuePair<string,string>> paths=new List<KeyValuePair<string,string>>();
        readonly List<string> secrets=new List<string>();
        public readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=2*1024*1024};
        int total;
        public Collector(string source) {
            RedactPath(source,"<SOURCE>");
            RedactPath(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),"<HOME>");
            foreach(System.Collections.DictionaryEntry item in Environment.GetEnvironmentVariables())
                if(Regex.IsMatch(Convert.ToString(item.Key),"TOKEN|SECRET|PASSWORD|API_KEY",RegexOptions.IgnoreCase)&&Convert.ToString(item.Value).Length>=8)secrets.Add(Convert.ToString(item.Value));
        }
        public void RedactPath(string value,string replacement) {
            if(String.IsNullOrEmpty(value))return;
            string full=Path.GetFullPath(value).TrimEnd('\\','/');
            if(full.Length<=2)return;
            paths.Add(new KeyValuePair<string,string>(full,replacement));
            paths.Sort((a,b)=>b.Key.Length.CompareTo(a.Key.Length));
        }
        public string Clean(string value) {
            foreach(string secret in secrets)value=value.Replace(secret,"[REDACTED]");
            value=Regex.Replace(value,@"(?im)\b(authorization|proxy-authorization|cookie|set-cookie)\s*[:=][^\r\n]*","$1: [REDACTED]");
            value=Regex.Replace(value,@"(?i)(https?://)[^\s/:@]+:[^\s/@]+@","$1[REDACTED]@");
            value=Regex.Replace(value,@"(?i)([?&](?:token|access_token|key|signature|sig|password)=)[^\s&""']+","$1[REDACTED]");
            value=Regex.Replace(value,@"(?i)(""(?:authorization|proxy-authorization|cookie|token|access_token|refresh_token|hf_token|api_key|password|secret|prompt|messages|history|personality)""\s*:\s*)""(?:\\.|[^""\\])*""","$1\"[REDACTED]\"");
            value=Regex.Replace(value,@"(?im)\b((?:HF_TOKEN|[A-Z_]*API_KEY|[A-Z_]*PASSWORD|[A-Z_]*SECRET)\s*=\s*)[^\r\n\s]+","$1[REDACTED]");
            value=Regex.Replace(value,@"\b(?:sk-or-v1-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|hf_[A-Za-z0-9]{20,})\b","[REDACTED]");
            foreach(var item in paths) {
                value=Regex.Replace(value,Regex.Escape(item.Key),m=>item.Value,RegexOptions.IgnoreCase);
                value=Regex.Replace(value,Regex.Escape(item.Key.Replace("\\","\\\\")),m=>item.Value,RegexOptions.IgnoreCase);
                value=Regex.Replace(value,Regex.Escape(item.Key.Replace('\\','/')),m=>item.Value,RegexOptions.IgnoreCase);
            }
            return value;
        }
        public object CleanMetadata(object value) {
            string text=value as string;
            if(text!=null)return Clean(text);
            var map=value as IDictionary<string,object>;
            if(map!=null)return map.ToDictionary(pair=>pair.Key,pair=>
                Regex.IsMatch(pair.Key,@"^(authorization|proxy-authorization|cookie|token|access_token|refresh_token|hf_token|api_key|password|secret|prompt|messages|history|personality)$",RegexOptions.IgnoreCase)
                    ? "[REDACTED]" : CleanMetadata(pair.Value));
            var list=value as System.Collections.IEnumerable;
            if(list!=null)return list.Cast<object>().Select(CleanMetadata).ToArray();
            return value;
        }
        public string SetupLog(string failure) {
            var text=new StringBuilder("Capri setup log\n");
            text.AppendLine("Captured (UTC): "+DateTime.UtcNow.ToString("o"));
            if(!String.IsNullOrWhiteSpace(failure))text.AppendLine(Clean(failure));
            foreach(var log in logs) {
                text.AppendLine().AppendLine("--- "+Clean(log.Key)+" ---");
                text.AppendLine(log.Value.TrimEnd('\r','\n'));
            }
            if(logs.Count==0)text.AppendLine("No setup events have been recorded yet.");
            if(Warnings.Count>0)text.AppendLine().AppendLine("--- Collection warnings ---").AppendLine(String.Join("\n",Warnings.Select(Clean)));
            return text.ToString();
        }
        public void Log(string file,string name) {
            try {
                NoLinks(file);if(!File.Exists(file)||!capturedPaths.Add(Path.GetFullPath(file)))return;
                using(var input=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)) {
                    long size=input.Length,offset=Math.Max(0,size-FileLimit);input.Position=offset;
                    byte[] buffer=new byte[(int)Math.Min(size,FileLimit)];int used=0,read;
                    while(used<buffer.Length&&(read=input.Read(buffer,used,buffer.Length-used))>0)used+=read;
                    string text=Encoding.UTF8.GetString(buffer,0,used);
                    if(offset>0){int newline=text.IndexOf('\n');text=newline>=0?text.Substring(newline+1):"";}
                    text=Clean(text);
                    int bytes=Encoding.UTF8.GetByteCount(text);
                    if(total+bytes>TotalLimit){Warnings.Add("Report size limit: "+name);return;}
                    logs[name]=text;total+=bytes;
                    Inventory.Add(Obj("file",name,"sourceBytes",size,"capturedBytes",used,"truncated",offset>0));
                }
            }catch(Exception e){Warnings.Add(name+": "+e.GetType().Name+" "+Clean(e.Message));}
        }
        public Dictionary<string,object> Metadata(string file,string[] keys) {
            var result=new Dictionary<string,object>();
            try {
                NoLinks(file);if(!File.Exists(file))return result;
                if(new FileInfo(file).Length>1024*1024)throw new IOException("Metadata exceeds size limit");
                var raw=Json.DeserializeObject(File.ReadAllText(file)) as Dictionary<string,object>;
                if(raw==null)throw new IOException("Metadata is not an object");
                foreach(string key in keys)if(raw.ContainsKey(key))result[key]=raw[key];
            }catch(Exception e){Warnings.Add(Path.GetFileName(file)+": "+e.GetType().Name);}
            return result;
        }
        public void Recent(string directory,string pattern,int count,string prefix) {
            try {
                NoLinks(directory);if(!Directory.Exists(directory))return;
                foreach(var file in new DirectoryInfo(directory).GetFiles(pattern).OrderByDescending(f=>f.LastWriteTimeUtc).Take(count))Log(file.FullName,prefix+file.Name);
            }catch(Exception e){Warnings.Add(prefix+": "+e.GetType().Name);}
        }
    }
    static object SystemInfo() {
        var memory=new MemoryStatus();bool known=GlobalMemoryStatusEx(memory);
        var gpus=new List<object>();
        var task=Task.Run(()=>{
            var found=new List<object>();
            using(var search=new ManagementObjectSearcher("SELECT Name, DriverVersion, AdapterRAM FROM Win32_VideoController"))
                foreach(ManagementObject gpu in search.Get())using(gpu)found.Add(Obj("name",Convert.ToString(gpu["Name"]),"driver",Convert.ToString(gpu["DriverVersion"]),"adapterRamReported",gpu["AdapterRAM"]));
            return found;
        });
        try{if(task.Wait(1500))gpus=task.Result;}catch{}
        return Obj("os",Environment.OSVersion.ToString(),"architecture",Environment.Is64BitOperatingSystem?"x64":"x86","cpu",Environment.GetEnvironmentVariable("PROCESSOR_IDENTIFIER"),"cpuThreads",Environment.ProcessorCount,
            "ramBytes",known?(object)memory.total:null,"availableRamBytes",known?(object)memory.available:null,"gpus",gpus,
            "gpuMemoryNote","WMI AdapterRAM is a driver-reported 32-bit value; not a reliable VRAM capacity for modern GPUs.");
    }
    static Collector Collect(string source,string registry,ref string session,string uiLog,ref string target) {
        var c=new Collector(source);
        c.RedactPath(registry,"<SETUP>");
        if(String.IsNullOrEmpty(session)&&!String.IsNullOrEmpty(registry)) {
            var active=c.Metadata(Path.Combine(registry,"active.json"),new[]{"id"});
            object id;if(active.TryGetValue("id",out id)&&Regex.IsMatch(Convert.ToString(id),"^[a-f0-9]{32}$"))session=Path.Combine(registry,"sessions",Convert.ToString(id));
            if(String.IsNullOrEmpty(session))try{
                string sessions=Path.Combine(registry,"sessions");NoLinks(sessions);
                if(Directory.Exists(sessions))session=new DirectoryInfo(sessions).GetDirectories().Where(d=>Regex.IsMatch(d.Name,"^[a-f0-9]{32}$")).OrderByDescending(d=>d.LastWriteTimeUtc).Select(d=>d.FullName).FirstOrDefault();
            }catch(Exception e){c.Warnings.Add("Session discovery: "+e.GetType().Name);}
        }
        if(!String.IsNullOrEmpty(session)&&String.IsNullOrEmpty(target)) {
            object value;var request=c.Metadata(Path.Combine(session,"request.json"),new[]{"target"});
            if(request.TryGetValue("target",out value)&&value is string)target=(string)value;
        }
        if(!String.IsNullOrEmpty(target))try {
            if(!Regex.IsMatch(target,@"^[a-zA-Z]:[\\/]")||target.IndexOf(':',2)>=0)throw new ArgumentException();
            target=Path.GetFullPath(target);
            c.RedactPath(target,"<INSTALL>");
        }catch(Exception error){
            if(!(error is ArgumentException||error is NotSupportedException||error is PathTooLongException))throw;
            c.Warnings.Add("Invalid installation path in setup metadata.");target=null;
        }
        if(!String.IsNullOrEmpty(session))
            foreach(string file in new[]{"events.jsonl","worker.log","worker.error.log","worker-guard.jsonl","ui-events.jsonl"})
                c.Log(Path.Combine(session,file),"session/"+file);
        if(!String.IsNullOrEmpty(uiLog))c.Log(uiLog,"logs/current-ui.jsonl");
        if(!String.IsNullOrEmpty(registry))c.Recent(Path.Combine(registry,"logs"),"*.jsonl",4,"logs/ui/");
        if(!String.IsNullOrEmpty(target))c.Recent(Path.Combine(target,".runtime/npm-cache/_logs"),"*.log",3,"logs/npm/");
        if(!String.IsNullOrEmpty(target)){
            c.Log(Path.Combine(target,"logs/ollama.stderr.log"),"logs/runtime/ollama.stderr.log");
            c.Log(Path.Combine(target,"logs/ollama.stdout.log"),"logs/runtime/ollama.stdout.log");
        }
        return c;
    }
    static void WriteTextFile(string destination,string text) {
        NoLinks(destination);Directory.CreateDirectory(Path.GetDirectoryName(destination));
        string temporary=destination+"."+Guid.NewGuid().ToString("N")+".tmp";
        try {
            using(var file=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None))
            using(var writer=new StreamWriter(file,new UTF8Encoding(true)))writer.Write(text);
            if(File.Exists(destination))File.Replace(temporary,destination,null);
            else File.Move(temporary,destination);
        }finally{if(File.Exists(temporary))try{File.Delete(temporary);}catch{}}
    }
    public static string SaveLog(string source,string registry,string session,string uiLog,string target,string failure) {
        var c=Collect(source,registry,ref session,uiLog,ref target);
        string destination=Path.Combine(registry,"reports","setup.log");
        WriteTextFile(destination,c.SetupLog(failure));
        return destination;
    }
    public static string Export(string source,string registry,string session,string uiLog,string target,string outputDirectory,string failure) {
        var c=Collect(source,registry,ref session,uiLog,ref target);
        var installation=Obj(
            "release",c.Metadata(Path.Combine(source,"config/release.json"),new[]{"tag","repository","channel"}),
            "package",c.Metadata(Path.Combine(source,"package.json"),new[]{"name","version"}),
            "identity",String.IsNullOrEmpty(target)?null:c.Metadata(Path.Combine(target,".capri-install.json"),new[]{"schemaVersion","productId","version","releaseTag"}),
            "state",String.IsNullOrEmpty(target)?null:c.Metadata(Path.Combine(target,".runtime/installer/state.json"),new[]{"schemaVersion","status","updatedAt","steps","currentStep","error"}));
        var metadata=Obj("schemaVersion",2,"system",SystemInfo(),"installation",installation);
        if(!String.IsNullOrEmpty(session)) {
            metadata["session"]=c.Metadata(Path.Combine(session,"session.json"),new[]{"schemaVersion","id","releaseTag","language","createdAt"});
            metadata["request"]=c.Metadata(Path.Combine(session,"request.json"),new[]{"schemaVersion","profile","inferenceMode","modelSource","interfaceLanguage","conversationLanguage","recognition","router","downloadModels","voiceMode","desktopShortcut","startMenuShortcut","repair"});
            metadata["worker"]=c.Metadata(Path.Combine(session,"worker.done.json"),new[]{"exitCode","endedAt"});
            metadata["lastHeartbeat"]=c.Metadata(Path.Combine(session,"ui-heartbeat.json"),new[]{"at","connected"});
            metadata["pause"]=c.Metadata(Path.Combine(session,"ui-loss.json"),new[]{"reason","detectedAt"});
        }
        metadata["logs"]=c.Inventory;
        metadata["warnings"]=c.Warnings;
        metadata["bytesPerLog"]=FileLimit;
        metadata["totalLogBytesLimit"]=TotalLimit;
        string text="# Capri setup diagnostic report\n\nCreated (UTC): "+DateTime.UtcNow.ToString("o")+"\n\n## Reported setup failure\n\n"+(String.IsNullOrWhiteSpace(failure)?"Inspect setup.log for the setup events.":c.Clean(failure))+
            "\n\n## Contents\n\n- setup.log contains setup events and recent npm/UI/Ollama log tails.\n- setup.json contains selected setup options, versions, system information and collection warnings.\n\n## Privacy\n\nNothing was uploaded. Models, recordings, screenshots, conversation history, personality, credentials and raw application configuration are excluded. Logs and personal paths receive best-effort redaction; review the ZIP before sharing. AdapterRAM in setup.json is not authoritative VRAM capacity.\n";
        var files=new Dictionary<string,string>{
            {"REPORT.md",text},
            {"setup.log",c.SetupLog(failure)},
            {"setup.json",c.Json.Serialize(c.CleanMetadata(metadata))}
        };
        Directory.CreateDirectory(outputDirectory);
        string destination=Path.Combine(outputDirectory,"capri-setup-diagnostics-"+DateTime.UtcNow.ToString("yyyy-MM-ddTHH-mm-ss-fffZ")+"-"+Guid.NewGuid().ToString("N").Substring(0,6)+".zip");
        string temporary=destination+".tmp";
        try {
            using(var output=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None))
            using(var zip=new ZipArchive(output,ZipArchiveMode.Create,false,Encoding.UTF8))
                foreach(var file in files)using(var writer=new StreamWriter(zip.CreateEntry(file.Key,CompressionLevel.Optimal).Open(),new UTF8Encoding(false)))writer.Write(file.Value);
            File.Move(temporary,destination);return destination;
        }finally{if(File.Exists(temporary))try{File.Delete(temporary);}catch{}}
    }
}
}
