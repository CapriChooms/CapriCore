// Fixed AppContainer launcher. No shell. A Job Object owns every sandbox process.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
class ToolSandbox {
 [StructLayout(LayoutKind.Sequential)]struct SidAttr{public IntPtr sid;public uint attributes;}
 [StructLayout(LayoutKind.Sequential)]struct Capabilities{public IntPtr sid,capabilities;public int count,reserved;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct Startup{public int size;public string reserved,desktop,title;public int x,y,xsize,ysize,xchars,ychars,fill,flags;public short show,reserved2;public IntPtr extra,input,output,error;}
 [StructLayout(LayoutKind.Sequential)]struct StartupEx{public Startup start;public IntPtr attributes;}
 [StructLayout(LayoutKind.Sequential)]struct ProcessInfo{public IntPtr process,thread;public int pid,tid;}
 [StructLayout(LayoutKind.Sequential)]struct BasicLimits{public long processTime,jobTime;public uint flags;public UIntPtr min,max;public uint active;public UIntPtr affinity;public uint priority,scheduling;}
 [StructLayout(LayoutKind.Sequential)]struct IoCounters{public ulong r,w,o,rb,wb,ob;}
 [StructLayout(LayoutKind.Sequential)]struct ExtendedLimits{public BasicLimits basic;public IoCounters io;public UIntPtr processMemory,jobMemory,peakProcess,peakJob;}
 [DllImport("userenv.dll",CharSet=CharSet.Unicode)]static extern int CreateAppContainerProfile(string name,string display,string description,IntPtr caps,uint count,out IntPtr sid);
 [DllImport("userenv.dll",CharSet=CharSet.Unicode)]static extern int DeriveAppContainerSidFromAppContainerName(string name,out IntPtr sid);
 [DllImport("userenv.dll",CharSet=CharSet.Unicode)]static extern int DeleteAppContainerProfile(string name);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool ConvertStringSidToSid(string value,out IntPtr sid);
 [DllImport("advapi32.dll")]static extern IntPtr FreeSid(IntPtr sid);
 [DllImport("kernel32.dll")]static extern IntPtr LocalFree(IntPtr pointer);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
 [DllImport("kernel32.dll")]static extern void DeleteProcThreadAttributeList(IntPtr list);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CreateProcess(string exe,StringBuilder command,IntPtr processAttrs,IntPtr threadAttrs,bool inherit,int flags,IntPtr environment,string directory,ref StartupEx startup,out ProcessInfo info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr CreateJobObject(IntPtr security,string name);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetInformationJobObject(IntPtr job,int type,IntPtr info,uint length);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")]static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll")]static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
 [DllImport("kernel32.dll")]static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll")]static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct Display{public string name,description;}
 [StructLayout(LayoutKind.Sequential)]struct Blob{public uint size;public IntPtr data;}
 [StructLayout(LayoutKind.Sequential)]struct WfpSession{public Guid key;public Display display;public uint flags,timeout,pid;public IntPtr sid,username;public int kernel;}
 [StructLayout(LayoutKind.Sequential)]struct SubLayer{public Guid key;public Display display;public uint flags;public IntPtr provider;public Blob data;public ushort weight;}
 [StructLayout(LayoutKind.Sequential)]struct WfpValue{public uint type;public IntPtr data;}
 [StructLayout(LayoutKind.Sequential)]struct WfpCondition{public Guid key;public uint match;public WfpValue value;}
 [StructLayout(LayoutKind.Sequential)]struct WfpAction{public uint type;public Guid key;}
 [StructLayout(LayoutKind.Explicit,Size=16)]struct Context{[FieldOffset(0)]public ulong value;[FieldOffset(0)]public Guid key;}
 [StructLayout(LayoutKind.Sequential)]struct Filter{public Guid key;public Display display;public uint flags;public IntPtr provider;public Blob data;public Guid layer,sublayer;public WfpValue weight;public uint count;public IntPtr condition;public WfpAction action;public Context context;public IntPtr reserved;public ulong id;public WfpValue effectiveWeight;}
 [DllImport("fwpuclnt.dll",CharSet=CharSet.Unicode)]static extern uint FwpmEngineOpen0(string server,uint auth,IntPtr identity,ref WfpSession session,out IntPtr engine);
 [DllImport("fwpuclnt.dll")]static extern uint FwpmEngineClose0(IntPtr engine);
 [DllImport("fwpuclnt.dll")]static extern uint FwpmSubLayerAdd0(IntPtr engine,ref SubLayer sublayer,IntPtr security);
 [DllImport("fwpuclnt.dll")]static extern uint FwpmFilterAdd0(IntPtr engine,ref Filter filter,IntPtr security,out ulong id);
 static uint networkError;
 static void NetworkCheck(uint code){if(code!=0){networkError=code;throw new InvalidOperationException("Network isolation unavailable.");}}
 static IntPtr BlockNetwork(IntPtr sid){
  // Explicit per-AppContainer IPv4/IPv6 block, including on hosts whose VPN or
  // firewall configuration bypasses default AppContainer network isolation.
  IntPtr engine=IntPtr.Zero,condition=IntPtr.Zero,weight=IntPtr.Zero;
  try{
   var session=new WfpSession{key=Guid.NewGuid(),display=new Display{name="Capri temporary tool isolation"},flags=1};
   NetworkCheck(FwpmEngineOpen0(null,10,IntPtr.Zero,ref session,out engine));
   var sublayer=new SubLayer{key=Guid.NewGuid(),display=new Display{name="Capri isolated tool network block"},weight=65535};
   NetworkCheck(FwpmSubLayerAdd0(engine,ref sublayer,IntPtr.Zero));
   var value=new WfpCondition{key=new Guid("71bc78fa-f17c-4997-a602-6abb261f351c"),match=0,value=new WfpValue{type=13,data=sid}};
   condition=Marshal.AllocHGlobal(Marshal.SizeOf(value));Marshal.StructureToPtr(value,condition,false);
   weight=Marshal.AllocHGlobal(8);Marshal.WriteInt64(weight,-1);
   foreach(string layer in new[]{"c38d57d1-05a7-4c33-904f-7fbceee60e82","4a72393b-319f-44bc-84c3-ba54dcb3b6b4","e1cd9fe7-f4b5-4273-96c0-592e487b8650","a3b42c97-9f04-4672-b87e-cee9c483257f"}){
    var filter=new Filter{key=Guid.NewGuid(),display=new Display{name="Capri offline user tool"},flags=8,layer=new Guid(layer),sublayer=sublayer.key,weight=new WfpValue{type=4,data=weight},count=1,condition=condition,action=new WfpAction{type=0x1001}};
    ulong id;NetworkCheck(FwpmFilterAdd0(engine,ref filter,IntPtr.Zero,out id));
   }
   return engine;
  }catch{if(engine!=IntPtr.Zero)FwpmEngineClose0(engine);throw;}
  finally{if(condition!=IntPtr.Zero)Marshal.FreeHGlobal(condition);if(weight!=IntPtr.Zero)Marshal.FreeHGlobal(weight);}
 }
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool GetTokenInformation(IntPtr token,int type,out int info,int size,out int length);
 static volatile bool tooLarge,cancelled;
 static void Check(bool success){if(!success)throw new InvalidOperationException("Sandbox operation failed: "+Marshal.GetLastWin32Error());}
 static void Grant(string directory,SecurityIdentifier sid,bool write){
  var security=Directory.GetAccessControl(directory);
  security.AddAccessRule(new FileSystemAccessRule(sid,write?FileSystemRights.Modify:FileSystemRights.ReadAndExecute,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
  Directory.SetAccessControl(directory,security);
 }
 static string Quote(string value){
  if(value.IndexOf('\0')>=0)throw new InvalidOperationException();
  var result=new StringBuilder("\"");int slashes=0;
  foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='\"'){result.Append('\\',slashes*2+1);result.Append(c);}else{result.Append('\\',slashes);result.Append(c);}slashes=0;}
  result.Append('\\',slashes*2);return result.Append('"').ToString();
 }
 static string ReadBounded(Stream stream,bool keep){
  var result=new MemoryStream();var buffer=new byte[4096];int count;
  while((count=stream.Read(buffer,0,buffer.Length))>0){if(result.Length+count>65536){tooLarge=true;return "";}if(keep)result.Write(buffer,0,count);else result.SetLength(result.Length+count);}
  return keep?Encoding.UTF8.GetString(result.ToArray()):"";
 }
 static int Main(string[] args){
  Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
  if(args.Length==2&&args[0]=="--cleanup"&&System.Text.RegularExpressions.Regex.IsMatch(args[1],@"^Capri\.Tool\.[a-f0-9]{24}$")){DeleteAppContainerProfile(args[1]);return 0;}
  IntPtr sid=IntPtr.Zero,network=IntPtr.Zero,list=IntPtr.Zero,capsPtr=IntPtr.Zero,capEntry=IntPtr.Zero,job=IntPtr.Zero,environment=IntPtr.Zero,handles=IntPtr.Zero,networkEngine=IntPtr.Zero;
  string profile=null,stage="request";
  ProcessInfo process=new ProcessInfo();
  var json=new JavaScriptSerializer{MaxJsonLength=1048576};
  try{
   string request=Console.ReadLine();if(request==null||request.Length>524288)throw new InvalidOperationException();
   var q=json.Deserialize<Dictionary<string,object>>(request);
   string name=profile=(string)q["profile"],code=Path.GetFullPath((string)q["code"]),output=Path.GetFullPath((string)q["output"]),runtime=Path.GetFullPath((string)q["runtime"]),exe=Path.GetFullPath((string)q["executable"]);
   int timeout=Convert.ToInt32(q["timeoutMs"]);if(timeout<100||timeout>60000||!exe.StartsWith(runtime+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException();
   stage="profile";if(CreateAppContainerProfile(name,name,"Capri explicitly approved user tool",IntPtr.Zero,0,out sid)<0){if(DeriveAppContainerSidFromAppContainerName(name,out sid)<0)throw new InvalidOperationException();}
   stage="permissions";var identity=new SecurityIdentifier(sid);Grant(code,identity,false);Grant(runtime,identity,false);Grant(output,identity,true);
   if(!(bool)q["network"]){stage="network";networkEngine=BlockNetwork(sid);}
   var capabilities=new Capabilities{sid=sid};
   if((bool)q["network"]){Check(ConvertStringSidToSid("S-1-15-3-1",out network));var entry=new SidAttr{sid=network,attributes=4};capEntry=Marshal.AllocHGlobal(Marshal.SizeOf(entry));Marshal.StructureToPtr(entry,capEntry,false);capabilities.capabilities=capEntry;capabilities.count=1;}
   capsPtr=Marshal.AllocHGlobal(Marshal.SizeOf(capabilities));Marshal.StructureToPtr(capabilities,capsPtr,false);
   IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);list=Marshal.AllocHGlobal(size);Check(InitializeProcThreadAttributeList(list,2,0,ref size));
   Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x20009),capsPtr,new IntPtr(Marshal.SizeOf(capabilities)),IntPtr.Zero,IntPtr.Zero));
   stage="job";job=CreateJobObject(IntPtr.Zero,null);Check(job!=IntPtr.Zero);
   var limits=new ExtendedLimits{basic=new BasicLimits{flags=0x2000|0x100|8|2,active=1,processTime=300000000},processMemory=new UIntPtr(256*1024*1024)};
   IntPtr limitsPtr=Marshal.AllocHGlobal(Marshal.SizeOf(limits));try{Marshal.StructureToPtr(limits,limitsPtr,false);Check(SetInformationJobObject(job,9,limitsPtr,(uint)Marshal.SizeOf(limits)));}finally{Marshal.FreeHGlobal(limitsPtr);}
   using(var input=new AnonymousPipeServerStream(PipeDirection.Out,HandleInheritability.Inheritable))
   using(var stdout=new AnonymousPipeServerStream(PipeDirection.In,HandleInheritability.Inheritable))
   using(var stderr=new AnonymousPipeServerStream(PipeDirection.In,HandleInheritability.Inheritable)){
    var startup=new StartupEx{start=new Startup{size=Marshal.SizeOf(typeof(StartupEx)),flags=0x100,input=new IntPtr(Int64.Parse(input.GetClientHandleAsString())),output=new IntPtr(Int64.Parse(stdout.GetClientHandleAsString())),error=new IntPtr(Int64.Parse(stderr.GetClientHandleAsString()))},attributes=list};
    handles=Marshal.AllocHGlobal(IntPtr.Size*3);Marshal.WriteIntPtr(handles,0,startup.start.input);Marshal.WriteIntPtr(handles,IntPtr.Size,startup.start.output);Marshal.WriteIntPtr(handles,IntPtr.Size*2,startup.start.error);
    Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x20002),handles,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero));
    string command=Quote(exe);foreach(var item in (System.Collections.IEnumerable)q["arguments"])command+=" "+Quote((string)item);
    string windows=Environment.GetEnvironmentVariable("SystemRoot")??@"C:\Windows";
    string env="APPDATA="+Environment.GetEnvironmentVariable("APPDATA")+"\0LOCALAPPDATA="+Environment.GetEnvironmentVariable("LOCALAPPDATA")+"\0PATH="+runtime+";"+Path.Combine(windows,"System32")+"\0PYTHONDONTWRITEBYTECODE=1\0PYTHONIOENCODING=utf-8\0PYTHONUTF8=1\0SystemDrive="+Path.GetPathRoot(windows).TrimEnd('\\')+"\0SystemRoot="+windows+"\0TEMP="+output+"\0TMP="+output+"\0USERPROFILE="+Environment.GetEnvironmentVariable("USERPROFILE")+"\0WINDIR="+windows+"\0\0";
    environment=Marshal.StringToHGlobalUni(env);
    stage="create";Check(CreateProcess(exe,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x00080000|0x08000000|0x400|4,environment,code,ref startup,out process));
    stage="token";IntPtr token;Check(OpenProcessToken(process.process,8,out token));try{int flag,length;Check(GetTokenInformation(token,29,out flag,4,out length));Check(flag==1);}finally{CloseHandle(token);}
    stage="assign";Check(AssignProcessToJobObject(job,process.process));Check(ResumeThread(process.thread)!=0xffffffff);stage="run";
    input.DisposeLocalCopyOfClientHandle();stdout.DisposeLocalCopyOfClientHandle();stderr.DisposeLocalCopyOfClientHandle();
    var read=Task.Run(()=>ReadBounded(stdout,true));var errors=Task.Run(()=>ReadBounded(stderr,true));
    var write=Task.Run(()=>{using(var writer=new StreamWriter(input,new UTF8Encoding(false))){writer.Write((string)q["input"]);writer.Flush();}});
    // The private launcher pipe also cancels on owner exit/EOF. Terminate the
    // script before closing the temporary network-block session.
    Task.Run(()=>{try{Console.ReadLine();}finally{cancelled=true;}});
    var timer=Stopwatch.StartNew();
    while(WaitForSingleObject(process.process,25)==258){if(timer.ElapsedMilliseconds>timeout||tooLarge||cancelled){TerminateProcess(process.process,1);throw new InvalidOperationException("Tool timed out or exceeded its output limit.");}}
    uint exit;Check(GetExitCodeProcess(process.process,out exit));
    if(!Task.WaitAll(new Task[]{read,errors,write},1000)||tooLarge)throw new InvalidOperationException("Invalid tool output.");
    string diagnostic=errors.Result;
    string reason=diagnostic.Contains("EACCES")?"access_denied":diagnostic.Contains("EPERM")?"operation_denied":diagnostic.Contains("Cannot find module")||diagnostic.Contains("ERR_MODULE_NOT_FOUND")?"module_unavailable":diagnostic.Contains("ENOMEM")?"memory_limit":"tool_exit";
    Console.WriteLine(json.Serialize(new{ok=exit==0,appContainer=true,exitCode=exit,reason,output=read.Result}));return exit==0?0:1;
   }
  }catch{Console.WriteLine(json.Serialize(new{ok=false,stage,code=networkError!=0?networkError:(uint)Marshal.GetLastWin32Error(),error="The isolated tool failed, timed out or was blocked by Windows."}));return 1;}
  finally{
   if(process.process!=IntPtr.Zero){TerminateProcess(process.process,1);CloseHandle(process.process);}if(process.thread!=IntPtr.Zero)CloseHandle(process.thread);if(job!=IntPtr.Zero)CloseHandle(job);
   if(networkEngine!=IntPtr.Zero)FwpmEngineClose0(networkEngine);
   if(list!=IntPtr.Zero){DeleteProcThreadAttributeList(list);Marshal.FreeHGlobal(list);}if(capsPtr!=IntPtr.Zero)Marshal.FreeHGlobal(capsPtr);if(capEntry!=IntPtr.Zero)Marshal.FreeHGlobal(capEntry);if(environment!=IntPtr.Zero)Marshal.FreeHGlobal(environment);if(network!=IntPtr.Zero)LocalFree(network);if(sid!=IntPtr.Zero)FreeSid(sid);
   if(handles!=IntPtr.Zero)Marshal.FreeHGlobal(handles);if(profile!=null)DeleteAppContainerProfile(profile);
  }
 }
}
