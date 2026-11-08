// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Threading;
using System.Web.Script.Serialization;

namespace Capri.Setup {
    // Shared by the UI and its worker. No Node/Python installation is needed for recovery.
    public static class SessionIO {
        private static readonly object LogLock=new object();
        public static string Stamp(int pid) { using(Process p=Process.GetProcessById(pid))return p.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture); }
        public static bool Alive(int pid,string stamp) { try { using(Process p=Process.GetProcessById(pid))return !p.HasExited && Stamp(pid)==stamp; }catch{return false;} }
        public static void NoLinks(string file) {
            for(string cursor=Path.GetFullPath(file);!String.IsNullOrEmpty(cursor);cursor=Path.GetDirectoryName(cursor))
                if((File.Exists(cursor)||Directory.Exists(cursor))&&(File.GetAttributes(cursor)&FileAttributes.ReparsePoint)!=0)throw new IOException("Installer control paths cannot contain links.");
        }
        public static Dictionary<string,object> Read(string file) {
            NoLinks(file);
            if(new FileInfo(file).Length>2*1024*1024)throw new InvalidDataException("Installer record exceeds its size limit.");
            string text;
            using(FileStream stream=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete))
            using(StreamReader reader=new StreamReader(stream,Encoding.UTF8))text=reader.ReadToEnd();
            Dictionary<string,object> result;
            try {result=new JavaScriptSerializer{MaxJsonLength=2*1024*1024}.Deserialize<Dictionary<string,object>>(text);}
            catch(ArgumentException error){throw new InvalidDataException("Invalid installer JSON: "+Path.GetFileName(file),error);}
            catch(InvalidOperationException error){throw new InvalidDataException("Invalid installer JSON: "+Path.GetFileName(file),error);}
            if(result==null)throw new InvalidDataException("Installer JSON must contain an object: "+Path.GetFileName(file));
            return result;
        }
        public static string Get(Dictionary<string,object> value,string key) { object item;return value!=null&&value.TryGetValue(key,out item)?Convert.ToString(item,CultureInfo.InvariantCulture):""; }
        public static void Write(string file,object value) {
            NoLinks(file);Directory.CreateDirectory(Path.GetDirectoryName(file));
            string temporary=file+"."+Guid.NewGuid().ToString("N")+".tmp",backup=temporary+".bak";
            try {
                byte[] bytes=new UTF8Encoding(false).GetBytes(new JavaScriptSerializer().Serialize(value));
                using(FileStream output=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None,4096,FileOptions.WriteThrough)) {
                    output.Write(bytes,0,bytes.Length);output.Flush(true);
                }
                if(File.Exists(file))File.Replace(temporary,file,backup);else File.Move(temporary,file);
            }finally{if(File.Exists(temporary))File.Delete(temporary);if(File.Exists(backup))File.Delete(backup);}
        }
        public static FileStream Gate(string file) {
            NoLinks(file);Directory.CreateDirectory(Path.GetDirectoryName(file));
            for(int attempt=0;;attempt++) {
                try{return new FileStream(file,FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);}
                catch(IOException){if(attempt>=20)throw;Thread.Sleep(25);}
            }
        }
        public static FileStream TryGate(string file) {
            NoLinks(file);Directory.CreateDirectory(Path.GetDirectoryName(file));
            try{return new FileStream(file,FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);}
            catch(IOException error){int code=error.HResult&0xffff;if(code==32||code==33)return null;throw;}
        }
        public static void Log(string file,string kind,string message) {
            lock(LogLock) {
                NoLinks(file);Directory.CreateDirectory(Path.GetDirectoryName(file));
                if(File.Exists(file)&&new FileInfo(file).Length>2*1024*1024) {
                    string previous=file+".previous";NoLinks(previous);
                    if(File.Exists(previous))File.Delete(previous);File.Move(file,previous);
                }
                File.AppendAllText(file,new JavaScriptSerializer().Serialize(new {timestamp=DateTime.UtcNow.ToString("o"),kind=kind,message=message})+"\n",new UTF8Encoding(false));
            }
        }
        public static void Pause(string session,string reason) {
            string file=Path.Combine(session,"pause");NoLinks(file);
            try { using(FileStream stream=new FileStream(file,FileMode.CreateNew,FileAccess.Write,FileShare.ReadWrite)) {} }
            catch(IOException) {if(!File.Exists(file))throw;}
            Write(Path.Combine(session,"ui-loss.json"),new {reason=reason,detectedAt=DateTime.UtcNow.ToString("o")});
        }
    }
    public sealed class UiLease : IDisposable {
        private readonly string session,id,stamp;private readonly int pid;private long window;private bool disposed;
        public string Id {get{return id;}}
        // Only ephemeral UI ownership/heartbeat records may be regenerated.
        // Keep damaged evidence; never reset the request, target, download cache or journal.
        private static Dictionary<string,object> ReadLeaseRecord(string folder,string name) {
            string file=Path.Combine(folder,name);
            try{return SessionIO.Read(file);}
            catch(FileNotFoundException){return null;}
            catch(InvalidDataException error) {
                string backup=file+"."+Guid.NewGuid().ToString("N")+".corrupt";
                SessionIO.NoLinks(file);SessionIO.NoLinks(backup);
                File.Move(file,backup);
                SessionIO.Log(Path.Combine(folder,"ui-events.jsonl"),"ui-record-recovered",Path.GetFileName(backup)+": "+error.Message);
                return null;
            }
        }
        public UiLease(string folder,long windowHandle) {
            session=folder;pid=Process.GetCurrentProcess().Id;stamp=SessionIO.Stamp(pid);id=Guid.NewGuid().ToString("N");window=windowHandle;
            using(FileStream gate=SessionIO.Gate(Path.Combine(session,"ui-control.lock"))) {
                string ownerFile=Path.Combine(session,"ui-owner.json"),heartbeatFile=Path.Combine(session,"ui-heartbeat.json");
                bool reconnecting=File.Exists(ownerFile)||File.Exists(heartbeatFile);
                Dictionary<string,object> owner=ReadLeaseRecord(session,"ui-owner.json"),beat=ReadLeaseRecord(session,"ui-heartbeat.json");
                if(Healthy(owner,beat,15000))throw new IOException("INSTALLER_UI_ALREADY_OPEN");
                if(reconnecting)SessionIO.Pause(session,"ui-ownership-recovered");
                SessionIO.Write(ownerFile,new {id=id,pid=pid,stamp=stamp,windowHandle=windowHandle});
                WriteHeartbeat(true);
            }
        }
        public static bool Healthy(Dictionary<string,object> owner,Dictionary<string,object> beat,int timeout) {
            int ownerPid;DateTime at;uint pulse;
            if(!Int32.TryParse(SessionIO.Get(owner,"pid"),out ownerPid)||SessionIO.Get(owner,"id")!=SessionIO.Get(beat,"id"))return false;
            double age;
            // Wall-clock/NTP changes must not make a responsive UI appear dead.
            // Unsigned subtraction also handles the TickCount wrap every 49 days.
            if(UInt32.TryParse(SessionIO.Get(beat,"uptimeMs"),NumberStyles.None,CultureInfo.InvariantCulture,out pulse))age=unchecked((uint)Environment.TickCount-pulse);
            else {
                if(!DateTime.TryParse(SessionIO.Get(beat,"at"),CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out at))return false;
                age=(DateTime.UtcNow-at.ToUniversalTime()).TotalMilliseconds;
            }
            return SessionIO.Get(beat,"connected")=="True"&&age>=-10000&&age<=timeout&&SessionIO.Alive(ownerPid,SessionIO.Get(owner,"stamp"));
        }
        public bool IsOwner() {
            if(disposed)return false;
            try {return SessionIO.Get(SessionIO.Read(Path.Combine(session,"ui-owner.json")),"id")==id;}catch{return false;}
        }
        public bool Superseded {
            get {
                string other=SessionIO.Get(SessionIO.Read(Path.Combine(session,"ui-owner.json")),"id");Guid parsed;
                if(!Guid.TryParseExact(other,"N",out parsed))throw new IOException("Installer UI ownership record is invalid.");
                return other!=id;
            }
        }
        public void Window(long handle) {
            if(window==handle)return;
            using(FileStream gate=SessionIO.Gate(Path.Combine(session,"ui-control.lock"))) {
                if(!IsOwner())return;
                SessionIO.Write(Path.Combine(session,"ui-owner.json"),new {id=id,pid=pid,stamp=stamp,windowHandle=handle});window=handle;
            }
        }
        public bool Heartbeat() {
            return Heartbeat(true);
        }
        public bool Heartbeat(bool visible) {
            // A busy guard/control write is not loss of UI ownership. Retry on the next UI tick.
            using(FileStream gate=SessionIO.TryGate(Path.Combine(session,"ui-control.lock"))) {
                if(gate==null||!IsOwner())return false;
                WriteHeartbeat(visible);return true;
            }
        }
        private void WriteHeartbeat(bool visible) {
            SessionIO.Write(Path.Combine(session,"ui-heartbeat.json"),new {id=id,at=DateTime.UtcNow.ToString("o"),uptimeMs=unchecked((uint)Environment.TickCount),connected=visible});
        }
        public void Control(string action) {
            using(FileStream gate=SessionIO.Gate(Path.Combine(session,"ui-control.lock"))) {
                if(!IsOwner())throw new IOException("INSTALLER_UI_SUPERSEDED");
                if(action=="resume") {
                    // Publish liveness BEFORE removing pause under the same gate as the guard.
                    WriteHeartbeat(true);
                    foreach(string name in new string[]{"pause","ui-loss.json"}) {string file=Path.Combine(session,name);SessionIO.NoLinks(file);if(File.Exists(file))File.Delete(file);}
                }else if(action=="pause"||action=="cancel") {
                    string file=Path.Combine(session,action);SessionIO.NoLinks(file);File.WriteAllText(file,action);
                }else throw new ArgumentException("Unknown installation control.");
                SessionIO.Log(Path.Combine(session,"ui-events.jsonl"),"control",action);
            }
        }
        public void Dispose() {
            try {using(FileStream gate=SessionIO.Gate(Path.Combine(session,"ui-control.lock"))) {
                if(IsOwner())WriteHeartbeat(false);
            }}catch{}finally{disposed=true;}
        }
    }
    public sealed class WorkerGuard : IDisposable {
        private readonly string session;private readonly int timeout;private Timer timer;private int checking;private bool lost,pending;private uint unhealthySince;
        private readonly ProcessStartInfo recoveryUi;
        private Process observedUi;
        private string observedOwner;
        private bool recoveryAttempted;

        public WorkerGuard(string folder,int timeoutMilliseconds) : this(folder,timeoutMilliseconds,null) {}
        public WorkerGuard(string folder,int timeoutMilliseconds,ProcessStartInfo recoveryUi) {
            session=folder;
            timeout=timeoutMilliseconds;
            this.recoveryUi=recoveryUi;
            timer=new Timer(Check,null,0,500);
        }

        private void ObserveUi(string owner,int pid,string stamp) {
            if(observedOwner!=owner) {
                if(observedUi!=null)observedUi.Dispose();
                observedUi=null;
                observedOwner=owner;
            }
            if(observedUi!=null)return;
            Process candidate=null;
            try {
                candidate=Process.GetProcessById(pid);
                // Keep a process handle so the exit code remains readable after a hard crash.
                if(candidate.Handle!=IntPtr.Zero && candidate.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture)==stamp) {
                    observedUi=candidate;
                    candidate=null;
                }
            }catch(ArgumentException){}catch(InvalidOperationException){}catch(System.ComponentModel.Win32Exception){}
            finally{if(candidate!=null)candidate.Dispose();}
        }

        private string DescribeExit(string owner) {
            try {
                if(observedOwner==owner && observedUi!=null && observedUi.HasExited)
                    return "; exitCode=0x"+unchecked((uint)observedUi.ExitCode).ToString("X8",CultureInfo.InvariantCulture);
            }catch(InvalidOperationException){}catch(System.ComponentModel.Win32Exception){}
            return "; exitCode=unavailable";
        }

        private void RecoverUi(string owner) {
            int pid;
            try {
                using(Process ui=Process.Start(recoveryUi))pid=ui.Id;
            }catch(Exception error) {
                SessionIO.Log(Path.Combine(session,"worker-guard.jsonl"),"ui-recovery-failed",error.ToString());
                return;
            }
            SessionIO.Log(Path.Combine(session,"worker-guard.jsonl"),"ui-recovery-launched","Previous owner "+owner+"; PID "+pid);
        }

        private void Check(object unused) {
            if(Interlocked.Exchange(ref checking,1)!=0)return;
            try {
                string eventKind=null,eventMessage=null,restoreOwner=null;
                using(FileStream gate=SessionIO.TryGate(Path.Combine(session,"ui-control.lock"))) {
                    if(gate==null)return;
                    bool healthy=false,immediate=false;string reason="ui-heartbeat-missing";
                    string ownerId=null;
                    bool abruptExit=false;
                    try {
                        Dictionary<string,object> owner=SessionIO.Read(Path.Combine(session,"ui-owner.json")),beat=SessionIO.Read(Path.Combine(session,"ui-heartbeat.json"));
                        healthy=UiLease.Healthy(owner,beat,timeout);
                        ownerId=SessionIO.Get(owner,"id");
                        string stamp=SessionIO.Get(owner,"stamp");
                        int pid;
                        bool validPid=Int32.TryParse(SessionIO.Get(owner,"pid"),out pid)&&pid>0&&!String.IsNullOrEmpty(stamp);
                        bool alive=validPid&&SessionIO.Alive(pid,stamp);
                        if(alive)ObserveUi(ownerId,pid,stamp);
                        reason=!alive?"ui-process-exited":SessionIO.Get(beat,"connected")=="False"?"ui-window-hidden":"ui-heartbeat-stale";
                        immediate=!alive||reason=="ui-window-hidden";
                        Guid identity;
                        abruptExit=validPid&&!alive&&Guid.TryParseExact(ownerId,"N",out identity)&&
                            SessionIO.Get(beat,"id")==ownerId&&SessionIO.Get(beat,"connected")=="True";
                    }catch(Exception error){reason="ui-heartbeat-unreadable: "+error.Message;}
                    uint now=unchecked((uint)Environment.TickCount);
                    if(healthy) {
                        pending=false;
                        if(lost) {eventKind="ui-reconnected";eventMessage=File.Exists(Path.Combine(session,"pause"))?"Explicit Resume is required; pause retained.":"UI liveness restored after explicit Resume.";lost=false;}
                    }else {
                        if(!pending){pending=true;unhealthySince=now;eventKind="ui-heartbeat-delayed";eventMessage=reason;}
                        int confirmation=reason=="ui-heartbeat-stale"?Math.Min(5000,Math.Max(500,timeout/3)):Math.Min(2000,Math.Max(500,timeout/3));
                        if(immediate||unchecked(now-unhealthySince)>=(uint)confirmation) {
                            if(!lost||!File.Exists(Path.Combine(session,"pause"))) {
                                SessionIO.Pause(session,reason);eventKind="ui-lost";eventMessage=reason+"; timeoutMs="+timeout+"; confirmationMs="+(immediate?0:confirmation);
                            }
                            if(abruptExit && recoveryUi!=null && !recoveryAttempted && !File.Exists(Path.Combine(session,"cancel"))) {
                                recoveryAttempted=true;
                                restoreOwner=ownerId;
                                eventKind="ui-lost";
                                eventMessage=reason+"; recovery=attempted"+DescribeExit(ownerId);
                            }else if(eventKind=="ui-lost" && reason=="ui-process-exited") {
                                eventMessage+=DescribeExit(ownerId);
                            }
                            lost=true;
                        }
                    }
                }
                try {
                    if(eventKind!=null)SessionIO.Log(Path.Combine(session,"worker-guard.jsonl"),eventKind,eventMessage);
                }finally {
                    if(restoreOwner!=null)RecoverUi(restoreOwner);
                }
            }catch(Exception error) {try{SessionIO.Log(Path.Combine(session,"worker-guard.jsonl"),"guard-error",error.ToString());}catch{}}
            finally{Interlocked.Exchange(ref checking,0);}
        }
        public void Dispose() {
            Timer current=Interlocked.Exchange(ref timer,null);
            if(current==null)return;
            using(ManualResetEvent stopped=new ManualResetEvent(false)) {
                if(current.Dispose(stopped))stopped.WaitOne();
            }
            if(observedUi!=null)observedUi.Dispose();
        }
    }
    // Read bounded complete UTF-8 lines. A partial JSON/UTF-8 append never crashes the UI.
    public sealed class EventCursor {
        private readonly string file;private long offset;private readonly MemoryStream pending=new MemoryStream();private bool oversized;
        public EventCursor(string path){file=path;}
        public string[] Read() {return Read(128);}
        public string[] Read(int maximumLines) {
            if(maximumLines<1||maximumLines>256)throw new ArgumentOutOfRangeException("maximumLines");
            List<string> lines=new List<string>();if(!File.Exists(file))return lines.ToArray();SessionIO.NoLinks(file);
            using(FileStream input=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)) {
                if(input.Length<offset){offset=0;pending.SetLength(0);}input.Position=offset;
                byte[] bytes=new byte[65536];int count=input.Read(bytes,0,bytes.Length);
                for(int index=0;index<count;index++) {
                    offset++;
                    if(bytes[index]==10){
                        try {
                            if(oversized)throw new IOException("Installer event exceeds its size limit.");
                            lines.Add(new UTF8Encoding(false,true).GetString(pending.ToArray()).TrimEnd('\r'));
                        }catch(Exception error){lines.Add(new JavaScriptSerializer().Serialize(new {type="ui-reader-error",message=error.Message}));}
                        pending.SetLength(0);oversized=false;
                        if(lines.Count>=maximumLines)break;
                    }else if(!oversized) {
                        if(pending.Length>=262144){pending.SetLength(0);oversized=true;}else pending.WriteByte(bytes[index]);
                    }
                }
            }
            return lines.ToArray();
        }
        public bool AtEnd {get{try{return !File.Exists(file)||new FileInfo(file).Length<=offset;}catch{return false;}}}
    }
}
