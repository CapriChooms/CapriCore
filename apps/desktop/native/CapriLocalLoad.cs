// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

// Documented Windows Job Object CPU quotas. No clock/power changes, process
// suspension, model restarts or termination of model processes.
internal static class CapriLocalLoad {
    [StructLayout(LayoutKind.Sequential)] struct Rate { public uint Flags, CpuRate; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Entry {
        public uint Size, Usage; public int Pid; public IntPtr Heap; public uint Module, Threads;
        public int Parent, Priority; public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string Image;
    }
    [StructLayout(LayoutKind.Sequential)] struct Counter { public IntPtr Name; public uint Status; public double Value; }
    sealed class Owned {
        public int Pid; public IntPtr Handle; public long Started, Cpu;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a,string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll")] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref Rate value,uint length);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr value);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern bool DuplicateHandle(IntPtr sourceProcess,IntPtr source,IntPtr targetProcess,out IntPtr target,uint access,bool inherit,uint options);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr value,uint timeout);
    [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process,out long start,out long exit,out long kernel,out long user);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr process,uint flags,StringBuilder path,ref int size);
    [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snap,ref Entry e);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr snap,ref Entry e);
    [DllImport("pdh.dll",CharSet=CharSet.Unicode)] static extern uint PdhOpenQueryW(string source,IntPtr data,out IntPtr query);
    [DllImport("pdh.dll",CharSet=CharSet.Unicode)] static extern uint PdhAddEnglishCounterW(IntPtr query,string path,IntPtr data,out IntPtr counter);
    [DllImport("pdh.dll")] static extern uint PdhCollectQueryData(IntPtr query);
    [DllImport("pdh.dll")] static extern uint PdhCloseQuery(IntPtr query);
    [DllImport("pdh.dll",CharSet=CharSet.Unicode)] static extern uint PdhGetFormattedCounterArrayW(IntPtr counter,uint format,ref uint size,out uint count,IntPtr items);
    static readonly Regex Engine = new Regex(@"^pid_([0-9]+)_luid_(0x[0-9a-f]{8}_0x[0-9a-f]{8})_phys_([0-9]+)_eng_([0-9]+)_engtype_[a-z0-9_]+$", RegexOptions.IgnoreCase);
    static volatile bool stopped;
    static int requested=10000;
    static long lastCommand;
    static readonly Stopwatch Clock=Stopwatch.StartNew();
    static void SetCap(IntPtr job,int cap) {
        var rate=new Rate { Flags=5, CpuRate=(uint)cap };
        if(!SetInformationJobObject(job,15,ref rate,8)) throw new InvalidOperationException("quota-unavailable");
    }
    static Owned Read(int pid, bool quota) {
        IntPtr handle=OpenProcess(0x1000u | 0x100000u | (quota?0x101u:0u),false,pid);
        if(handle==IntPtr.Zero) return null;
        long start,exit,kernel,user;
        if(!GetProcessTimes(handle,out start,out exit,out kernel,out user)) {CloseHandle(handle);return null;}
        return new Owned {Pid=pid,Handle=handle,Started=DateTime.FromFileTimeUtc(start).Ticks,Cpu=kernel+user};
    }
    static string Image(Owned process) {
        var value=new StringBuilder(32768); int size=value.Capacity;
        return QueryFullProcessImageNameW(process.Handle,0,value,ref size)?Path.GetFullPath(value.ToString()):null;
    }
    static bool Scan(Owned root,string folder,IntPtr job,Dictionary<int,Owned> owned) {
        bool membershipChanged=false;
        foreach(var pid in new List<int>(owned.Keys)) if(WaitForSingleObject(owned[pid].Handle,0)!=258) {CloseHandle(owned[pid].Handle);owned.Remove(pid);membershipChanged=true;}
        var entries=new List<Entry>();
        IntPtr snap=CreateToolhelp32Snapshot(2,0); if(snap==new IntPtr(-1)) throw new InvalidOperationException();
        try {
            var e=new Entry {Size=(uint)Marshal.SizeOf(typeof(Entry))};
            if(!Process32FirstW(snap,ref e))throw new InvalidOperationException();
            do {entries.Add(e);}while(Process32NextW(snap,ref e));
        } finally {CloseHandle(snap);}
        var cone=new Dictionary<int,long> {{root.Pid,root.Started}};
        for(int pass=0;pass<8;pass++) {
            bool changed=false;
            foreach(var e in entries) {
                if(cone.ContainsKey(e.Pid)||!cone.ContainsKey(e.Parent))continue;
                var candidate=Read(e.Pid,false); if(candidate==null)continue;
                try {
                    if(candidate.Started<cone[e.Parent])continue;
                    cone[e.Pid]=candidate.Started;changed=true;
                    if(owned.ContainsKey(e.Pid)||!String.Equals(e.Image,"llama-server.exe",StringComparison.OrdinalIgnoreCase))continue;
                    string image=Image(candidate);
                    if(image==null||!image.StartsWith(folder,StringComparison.OrdinalIgnoreCase))continue;
                    var model=Read(e.Pid,true); if(model==null||model.Started!=candidate.Started) {if(model!=null)CloseHandle(model.Handle);continue;}
                    bool member;
                    if(!IsProcessInJob(model.Handle,job,out member)||(!member&&!AssignProcessToJobObject(job,model.Handle))) {CloseHandle(model.Handle);throw new InvalidOperationException("assign-unavailable");}
                    owned.Add(e.Pid,model);
                    membershipChanged=true;
                } finally {CloseHandle(candidate.Handle);}
            }
            if(!changed)break;
        }
        return membershipChanged;
    }
    static double? Gpu(IntPtr query,IntPtr counter,Dictionary<int,Owned> owned,HashSet<string> devices,bool first) {
        if(query==IntPtr.Zero||counter==IntPtr.Zero||PdhCollectQueryData(query)!=0||first)return null;
        uint size=0,count; uint status=PdhGetFormattedCounterArrayW(counter,0x200,ref size,out count,IntPtr.Zero);
        if(status!=0x800007D2||size==0||size>4*1024*1024)return null;
        var totals=new Dictionary<string,double>();
        IntPtr buffer=Marshal.AllocHGlobal((int)size);
        try {
            if(PdhGetFormattedCounterArrayW(counter,0x200,ref size,out count,buffer)!=0)return null;
            int stride=Marshal.SizeOf(typeof(Counter)); if(count>8192||count>size/stride)return null;
            for(int i=0;i<count;i++) {
                var item=(Counter)Marshal.PtrToStructure(IntPtr.Add(buffer,i*stride),typeof(Counter));
                string name=Marshal.PtrToStringUni(item.Name);var match=Engine.Match(name??"");
                if(!match.Success||item.Status>1||Double.IsNaN(item.Value)||Double.IsInfinity(item.Value)||item.Value<0||item.Value>100)continue;
                string luid=match.Groups[2].Value.ToUpperInvariant();int pid;
                if(Int32.TryParse(match.Groups[1].Value,out pid)&&owned.ContainsKey(pid))devices.Add(luid);
                string key=luid+"/"+match.Groups[3].Value+"/"+match.Groups[4].Value;
                double before;totals.TryGetValue(key,out before);totals[key]=Math.Min(100,before+item.Value);
            }
        } finally {Marshal.FreeHGlobal(buffer);}
        double? value=null;
        foreach(var pair in totals)if(devices.Contains(pair.Key.Split('/')[0]))value=Math.Max(value??0,pair.Value);
        return value;
    }
    static int Main(string[] args) {
        IntPtr job=IntPtr.Zero,parent=IntPtr.Zero,query=IntPtr.Zero,counter=IntPtr.Zero;Owned root=null;
        var owned=new Dictionary<int,Owned>();
        try {
            int rootId,ownerId;long started;
            bool reset=args.Length>=5&&args[4]=="--reset";long retained=0;
            if((args.Length!=4&&!(reset&&(args.Length==5||args.Length==6)))||(args.Length==6&&(!Int64.TryParse(args[5],out retained)||retained<1))||!Int32.TryParse(args[0],out rootId)||rootId<1||!Int64.TryParse(args[1],out started)||started<1||!Int32.TryParse(args[3],out ownerId)||ownerId<1||!Path.IsPathRooted(args[2]))return 2;
            bool native=String.Equals(Path.GetFileName(args[2]),"llama-server.exe",StringComparison.OrdinalIgnoreCase);
            root=Read(rootId,false);
            if(root==null||root.Started!=started||!String.Equals(Image(root),Path.GetFullPath(args[2]),StringComparison.OrdinalIgnoreCase))return 2;
            string folder=Path.Combine(Path.GetDirectoryName(Path.GetFullPath(args[2])),"lib","ollama")+Path.DirectorySeparatorChar;
            job=CreateJobObject(IntPtr.Zero,"Local\\Capri.LocalLoad."+rootId+"."+started);
            if(job==IntPtr.Zero)throw new InvalidOperationException();
            SetCap(job,10000); // Also releases a previous helper's stale quota.
            parent=OpenProcess(0x100040,false,ownerId);if(parent==IntPtr.Zero)return 2;
            if(reset) {
                if(retained!=0){IntPtr ignored;DuplicateHandle(parent,new IntPtr(retained),IntPtr.Zero,out ignored,0,false,1);}
                return 0;
            }
            if(native) {
                var model=Read(rootId,true);
                if(model==null||model.Started!=started) {if(model!=null)CloseHandle(model.Handle);return 2;}
                bool member;
                if(!IsProcessInJob(model.Handle,job,out member)||(!member&&!AssignProcessToJobObject(job,model.Handle))) {
                    CloseHandle(model.Handle);throw new InvalidOperationException("assign-unavailable");
                }
                owned.Add(rootId,model);
            }
            // Keep the named job reachable if this helper is forcibly killed.
            // The desktop owns this non-inheritable handle until its reset helper
            // restores the quota and closes it exactly once (or the desktop exits).
            IntPtr retainedJob;
            if(!DuplicateHandle(GetCurrentProcess(),job,parent,out retainedJob,0,false,2))throw new InvalidOperationException();
            var json=new JavaScriptSerializer {MaxJsonLength=4096};
            var reader=new Thread(()=>{
                try {string line;while((line=Console.ReadLine())!=null) {
                    if(line.Length>1024)break;
                    var packet=json.Deserialize<Dictionary<string,object>>(line);
                    if(packet.Count==1&&packet.ContainsKey("stop")&&packet["stop"] is bool&&(bool)packet["stop"])break;
                    object value;
                    if(packet.Count!=1||!packet.TryGetValue("cap",out value)||!(value is int)||(int)value<1||(int)value>10000)break;
                    Interlocked.Exchange(ref requested,(int)value);Interlocked.Exchange(ref lastCommand,Clock.ElapsedMilliseconds);
                }}catch{}finally {stopped=true;}
            });reader.IsBackground=true;reader.Start();
            if(PdhOpenQueryW(null,IntPtr.Zero,out query)==0)PdhAddEnglishCounterW(query,@"\GPU Engine(*)\Utilization Percentage",IntPtr.Zero,out counter);
            bool first=true;long nextScan=0,lastSample=0;int applied=10000;
            var devices=new HashSet<string>();Console.WriteLine(json.Serialize(new {ready=true,jobHandle=retainedJob.ToInt64().ToString()}));
            while(!stopped&&WaitForSingleObject(parent,0)==258&&WaitForSingleObject(root.Handle,0)==258) {
                long now=Clock.ElapsedMilliseconds;
                if(!native&&now>=nextScan) {if(Scan(root,folder,job,owned)||owned.Count==0)devices.Clear();nextScan=now+1000;}
                int cap=now-Interlocked.Read(ref lastCommand)>5000?10000:Interlocked.CompareExchange(ref requested,0,0);
                if(cap!=applied){SetCap(job,cap);applied=cap;}
                if(now-lastSample>=500) {
                    long delta=0;foreach(var model in owned.Values) {
                        long start,exit,kernel,user;
                        if(GetProcessTimes(model.Handle,out start,out exit,out kernel,out user)&&DateTime.FromFileTimeUtc(start).Ticks==model.Started){long total=kernel+user;delta+=Math.Max(0,total-model.Cpu);model.Cpu=total;}
                    }
                    double cpu=lastSample==0?0:Math.Min(100,delta/10000.0/Math.Max(1,now-lastSample)/Math.Max(1,Environment.ProcessorCount)*100);
                    double? gpu=Gpu(query,counter,owned,devices,first);first=false;lastSample=now;
                    Console.WriteLine(new JavaScriptSerializer().Serialize(new {members=owned.Count,cpuPercent=cpu,gpuPercent=gpu,appliedCpuPercent=applied/100.0}));
                }
                Thread.Sleep(100);
            }
            return 0;
        } catch {try{Console.WriteLine("{\"error\":\"Local model load control is unavailable.\"}");}catch{}return 1;}
        finally {
            if(job!=IntPtr.Zero){try{SetCap(job,10000);}catch{}CloseHandle(job);}
            if(query!=IntPtr.Zero)PdhCloseQuery(query);
            foreach(var model in owned.Values)CloseHandle(model.Handle);
            if(root!=null)CloseHandle(root.Handle);if(parent!=IntPtr.Zero)CloseHandle(parent);
        }
    }
}
