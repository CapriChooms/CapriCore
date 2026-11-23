// SPDX-License-Identifier: GPL-3.0-only
// Owned-window input only. Never reads window titles, application text or owner files.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

class PerchRestoreProbe {
  [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct Placement { public uint Size,Flags,Show; public Point Minimum,Maximum; public Rect Normal; }
  [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int X,Y; public uint Data,Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MouseInput Mouse; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint Type; public InputUnion Data; }
  [StructLayout(LayoutKind.Sequential)] struct GuiInfo { public uint Size,Flags; public IntPtr Active,Focus,Capture,MenuOwner,MoveSize,Caret; public Rect CaretRect; }
  delegate bool EnumProc(IntPtr handle,IntPtr state);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPhysicalPoint(Point point);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr handle,uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr handle,int command);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr handle);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr handle);
  [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr handle,ref Placement placement);
  [DllImport("user32.dll")] static extern bool SetWindowPlacement(IntPtr handle,ref Placement placement);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr handle,out Rect rect);
  [DllImport("user32.dll")] static extern int GetWindowLongW(IntPtr handle,int index);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr handle,StringBuilder value,int length);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle,out uint process);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref GuiInfo info);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr state);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern uint SendInput(uint count,Input[] input,int size);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  static readonly object Gate = new object();
  static uint targetProcess,avatarProcess;
  static IntPtr target,held;
  static long heldUntil;
  static Point heldPoint;
  static bool expectMaximized;
  static Point original;
  static object RectValue(Rect value) { return new { x=value.Left,y=value.Top,width=value.Right-value.Left,height=value.Bottom-value.Top }; }
  static bool Contains(Rect rect,Point point) { return point.X>=rect.Left&&point.X<rect.Right&&point.Y>=rect.Top&&point.Y<rect.Bottom; }
  static string Handle(IntPtr value) { return value.ToInt64().ToString(); }
  static uint ProcessOf(IntPtr handle) { uint value;GetWindowThreadProcessId(handle,out value);return value; }
  static object Window(IntPtr handle) {
    uint process;uint thread=GetWindowThreadProcessId(handle,out process);
    var name=new StringBuilder(256);GetClassNameW(handle,name,name.Capacity);
    Rect bounds;GetWindowRect(handle,out bounds);
    uint extra=unchecked((uint)GetWindowLongW(handle,-20));
    return new { hwnd=Handle(handle),processId=process,threadId=thread,windowClass=name.ToString(),visible=IsWindowVisible(handle),minimized=IsIconic(handle),maximized=IsZoomed(handle),bounds=RectValue(bounds),style=unchecked((uint)GetWindowLongW(handle,-16)),exStyle=extra,transparent=(extra&0x20)!=0,layered=(extra&0x80000)!=0,noActivate=(extra&0x08000000)!=0,topmost=(extra&8)!=0 };
  }
  static object Capture(uint thread) {
    GuiInfo info=new GuiInfo();info.Size=(uint)Marshal.SizeOf(typeof(GuiInfo));
    return GetGUIThreadInfo(thread,ref info)?new { threadId=thread,active=Handle(info.Active),focus=Handle(info.Focus),capture=Handle(info.Capture),moveSize=Handle(info.MoveSize) }:(object)null;
  }
  static object PassiveSnapshot(uint processId) {
    Point cursor;GetCursorPos(out cursor);
    var owned=new List<object>();var zOrder=new List<object>();
    EnumWindows((handle,state)=>{
      uint process;uint thread=GetWindowThreadProcessId(handle,out process);
      if(process==processId&&owned.Count<24)owned.Add(new{window=Window(handle),gui=Capture(thread)});
      Rect bounds;if(zOrder.Count<24&&IsWindowVisible(handle)&&GetWindowRect(handle,out bounds)&&Contains(bounds,cursor))zOrder.Add(Window(handle));
      return true;
    },IntPtr.Zero);
    IntPtr hit=WindowFromPhysicalPoint(cursor);
    return new{passive=true,processId=processId,cursor=new{x=cursor.X,y=cursor.Y},leftDown=GetAsyncKeyState(1)<0,windows=owned,hit=Window(hit),hitRoot=Window(GetAncestor(hit,2)),foreground=Window(GetForegroundWindow()),foregroundCapture=Capture(0),zOrderAtCursor=zOrder};
  }
  static List<uint> PassiveThreads(uint processId) {
    var threads=new List<uint>();
    EnumWindows((handle,state)=>{uint process;uint thread=GetWindowThreadProcessId(handle,out process);if(process==processId&&!threads.Contains(thread)&&threads.Count<24)threads.Add(thread);return true;},IntPtr.Zero);
    return threads;
  }
  static void PassiveStream(uint processId,int duration,int interval) {
    Console.WriteLine(Json.Serialize(new{type="start",passive=true,processId=processId,durationMs=duration,intervalMs=interval,startedAtUtc=DateTime.UtcNow.ToString("o"),snapshot=PassiveSnapshot(processId)}));
    Console.Out.Flush();
    var elapsed=Stopwatch.StartNew();var threads=PassiveThreads(processId);long refreshed=0;int samples=0;
    while(elapsed.ElapsedMilliseconds<duration){
      if(elapsed.ElapsedMilliseconds-refreshed>=250){threads=PassiveThreads(processId);refreshed=elapsed.ElapsedMilliseconds;}
      Point point;GetCursorPos(out point);
      IntPtr hit=GetAncestor(WindowFromPhysicalPoint(point),2),foreground=GetForegroundWindow();
      var gui=new List<object>();foreach(uint thread in threads)gui.Add(Capture(thread));
      Console.WriteLine(Json.Serialize(new{type="sample",atMs=elapsed.ElapsedMilliseconds,x=point.X,y=point.Y,leftDown=GetAsyncKeyState(1)<0,hitRoot=Handle(hit),hitProcessId=ProcessOf(hit),foreground=Handle(foreground),foregroundProcessId=ProcessOf(foreground),gui=gui,foregroundGui=Capture(0)}));
      Console.Out.Flush();samples++;Thread.Sleep(interval);
    }
    Console.WriteLine(Json.Serialize(new{type="end",passive=true,samples=samples,elapsedMs=elapsed.ElapsedMilliseconds,snapshot=PassiveSnapshot(processId)}));Console.Out.Flush();
  }
  static object Probe(IntPtr avatar,Point point) {
    var windows=new List<object>();
    EnumWindows((handle,state)=>{Rect bounds;if(windows.Count<24&&IsWindowVisible(handle)&&GetWindowRect(handle,out bounds)&&Contains(bounds,point))windows.Add(Window(handle));return windows.Count<24;},IntPtr.Zero);
    IntPtr physical=WindowFromPhysicalPoint(point),root=GetAncestor(physical,2);
    uint ignored;uint thread=GetWindowThreadProcessId(avatar,out ignored);
    Point cursor;GetCursorPos(out cursor);
    return new { point=new{x=point.X,y=point.Y},cursor=new{x=cursor.X,y=cursor.Y},leftDown=GetAsyncKeyState(1)<0,avatar=Window(avatar),target=Window(target),hit=Window(physical),hitRoot=Window(root),logicalHitRoot=Window(GetAncestor(WindowFromPoint(point),2)),foreground=Window(GetForegroundWindow()),avatarCapture=Capture(thread),foregroundCapture=Capture(0),zOrderAtPoint=windows };
  }
  static void Owned(IntPtr handle,uint process) { if(handle==IntPtr.Zero||!IsWindow(handle)||ProcessOf(handle)!=process)throw new InvalidOperationException("Owned window identity changed; no input sent. HWND="+Handle(handle)+" expected PID="+process+" actual PID="+ProcessOf(handle)); }
  static Point Position(string[] words,int index) {
    Point point=new Point{X=int.Parse(words[index]),Y=int.Parse(words[index+1])};
    int x=GetSystemMetrics(76),y=GetSystemMetrics(77),width=GetSystemMetrics(78),height=GetSystemMetrics(79);
    if(point.X<x||point.Y<y||point.X>=x+width||point.Y>=y+height)throw new InvalidOperationException("Input point is outside the desktop.");
    return point;
  }
  static void Button(bool down) {
    var input=new Input{Type=0,Data=new InputUnion{Mouse=new MouseInput{Flags=down?2u:4u}}};
    if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(Input)))!=1)throw new InvalidOperationException("Windows rejected native mouse input.");
  }
  static void Release() { lock(Gate){if(held!=IntPtr.Zero){try{Button(false);}finally{held=IntPtr.Zero;heldUntil=0;}}} }
  static void Move(IntPtr avatar,Point point) {
    Owned(avatar,avatarProcess);Rect bounds;
    if(!IsWindowVisible(avatar)||!GetWindowRect(avatar,out bounds)||!Contains(bounds,point))throw new InvalidOperationException("Input must remain inside the owned avatar overlay.");
    if(!SetCursorPos(point.X,point.Y))throw new InvalidOperationException("Windows rejected cursor movement.");
    Thread.Sleep(100);
  }
  static void Down(IntPtr avatar,Point point) {
    Point cursor;GetCursorPos(out cursor);
    if(cursor.X!=point.X||cursor.Y!=point.Y)Move(avatar,point);
    else {Owned(avatar,avatarProcess);Rect bounds;if(!IsWindowVisible(avatar)||!GetWindowRect(avatar,out bounds)||!Contains(bounds,point))throw new InvalidOperationException("The owned avatar is not visible at the input point.");}
    IntPtr hit=GetAncestor(WindowFromPhysicalPoint(point),2);
    if(hit!=avatar)throw new InvalidOperationException("Another HWND blocks the owned avatar; no mouse down sent.");
    lock(Gate){if(held!=IntPtr.Zero||GetAsyncKeyState(1)<0)throw new InvalidOperationException("The left button is already held.");Owned(avatar,avatarProcess);Button(true);held=avatar;heldPoint=point;heldUntil=Stopwatch.GetTimestamp()+Stopwatch.Frequency*5;}
    Thread.Sleep(80);
  }
  static void TargetState(bool minimize) {
    Owned(target,targetProcess);if(held!=IntPtr.Zero)throw new InvalidOperationException("Finish the owned input gesture before changing target state.");
    ShowWindow(target,minimize?6:9);if(!minimize)SetForegroundWindow(target);
    var watch=Stopwatch.StartNew();while(watch.ElapsedMilliseconds<1800&&(IsIconic(target)!=minimize||(!minimize&&GetAncestor(GetForegroundWindow(),2)!=target)))Thread.Sleep(20);
    if(IsIconic(target)!=minimize||(!minimize&&GetAncestor(GetForegroundWindow(),2)!=target))throw new InvalidOperationException("The owned target did not reach the requested native state/foreground.");
    if(!minimize&&expectMaximized&&!IsZoomed(target))throw new InvalidOperationException("The owned target did not restore maximized as requested.");
    if(!minimize)expectMaximized=false;
  }
  static object ChangeMinimizedPlacement(bool maximize) {
    Owned(target,targetProcess);
    if(!IsIconic(target)||held!=IntPtr.Zero)throw new InvalidOperationException("Change only the exact owned target while minimized, with no held gesture.");
    Placement placement=new Placement();placement.Size=(uint)Marshal.SizeOf(typeof(Placement));
    if(!GetWindowPlacement(target,ref placement))throw new InvalidOperationException("Owned target placement is unavailable.");
    Rect before=placement.Normal;
    // WINDOWPLACEMENT uses workspace coordinates. Preserve that coordinate space
    // rather than mixing the minimized (-32000,-32000) HWND rectangle into it.
    // WPF_RESTORETOMAXIMIZED is valid with SW_SHOWMINIMIZED, per Microsoft:
    // https://learn.microsoft.com/windows/win32/api/winuser/ns-winuser-windowplacement
    placement.Show=2;
    if(maximize)placement.Flags|=2;
    else {
      placement.Flags&=~2u;
      int width=Math.Max(420,before.Right-before.Left-110),height=Math.Max(260,before.Bottom-before.Top-50);
      int left=before.Left+(before.Left>GetSystemMetrics(76)+120?-90:90);
      int top=before.Top+(before.Top>GetSystemMetrics(77)+180?-80:80);
      placement.Normal=new Rect{Left=left,Top=top,Right=left+width,Bottom=top+height};
    }
    if(!SetWindowPlacement(target,ref placement)||!IsIconic(target))throw new InvalidOperationException("The owned target did not retain its minimized state while changing placement.");
    Placement verified=new Placement();verified.Size=(uint)Marshal.SizeOf(typeof(Placement));
    if(!GetWindowPlacement(target,ref verified))throw new InvalidOperationException("Changed owned placement could not be verified.");
    if(!maximize&&(verified.Normal.Left==before.Left&&verified.Normal.Top==before.Top&&verified.Normal.Right==before.Right&&verified.Normal.Bottom==before.Bottom))throw new InvalidOperationException("Owned target geometry did not change.");
    expectMaximized=maximize;
    return new { ok=true,change=maximize?"maximize-on-restore":"move-resize-minimized",target=Window(target),before=RectValue(before),after=RectValue(verified.Normal),flags=verified.Flags };
  }
  static object Command(string line) {
    string[] words=line.Split(new[]{' '},StringSplitOptions.RemoveEmptyEntries);
    if(words.Length==0||words.Length>5)throw new InvalidOperationException("Invalid probe command.");
    string command=words[0];IntPtr avatar=words.Length>1?new IntPtr(long.Parse(words[1])):IntPtr.Zero;
    if(command=="target-state"){Owned(target,targetProcess);return new{ok=true,target=Window(target)};}
    if(command=="move-resize-minimized"||command=="maximize-on-restore")return ChangeMinimizedPlacement(command=="maximize-on-restore");
    if(command=="minimize"||command=="restore"){TargetState(command=="minimize");return new{ok=true,target=Window(target),foreground=Window(GetForegroundWindow())};}
    Owned(avatar,avatarProcess);
    Point point;if(command=="up"){GetCursorPos(out point);Release();Thread.Sleep(80);return new{ok=true,diagnostics=Probe(avatar,point)};}
    point=Position(words,2);
    if(command=="move")Move(avatar,point);
    else if(command=="down")Down(avatar,point);
    else if(command=="click"){Down(avatar,point);Point released;try{Thread.Sleep(70);GetCursorPos(out released);}finally{Release();}if(released.X!=point.X||released.Y!=point.Y)throw new InvalidOperationException("External cursor movement contaminated the head click; no regression result.");Thread.Sleep(100);}
    else if(command=="drag"){
      lock(Gate){if(held!=avatar)throw new InvalidOperationException("The owned avatar does not hold LMB.");}
      Point from;GetCursorPos(out from);
      if(from.X!=heldPoint.X||from.Y!=heldPoint.Y)throw new InvalidOperationException("External cursor movement interrupted the held gesture.");
      Point previous=from;
      for(int i=1;i<=16;i++){
        Owned(avatar,avatarProcess);lock(Gate){if(held!=avatar)throw new InvalidOperationException("The bounded drag watchdog released LMB.");}
        var next=new Point{X=from.X+(point.X-from.X)*i/16,Y=from.Y+(point.Y-from.Y)*i/16};
        Point observed;GetCursorPos(out observed);if(observed.X!=previous.X||observed.Y!=previous.Y||GetAsyncKeyState(1)>=0)throw new InvalidOperationException("Unrelated cursor/button activity interrupted the native drag.");
        Rect bounds;if(!GetWindowRect(avatar,out bounds)||!Contains(bounds,next))throw new InvalidOperationException("Drag left the owned overlay.");
        IntPtr hit=GetAncestor(WindowFromPhysicalPoint(next),2);
        if(hit!=avatar&&hit!=target&&ProcessOf(hit)!=avatarProcess)throw new InvalidOperationException("An owner window blocks the drag path; stopping input.");
        SetCursorPos(next.X,next.Y);previous=next;Thread.Sleep(70);
      }
    }else if(command!="probe")throw new InvalidOperationException("Unknown probe command.");
    return new{ok=true,diagnostics=Probe(avatar,point)};
  }
  static int Main(string[] args) {
    if(args.Length>=2&&args.Length<=4&&args[0]=="--snapshot-pid-stream"){
      uint processId;int duration=2000,interval=16;
      if(!uint.TryParse(args[1],out processId)||processId==0||(args.Length>=3&&!int.TryParse(args[2],out duration))||(args.Length==4&&!int.TryParse(args[3],out interval))||duration<100||duration>15000||(interval!=16&&interval!=33))return 2;
      try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch(EntryPointNotFoundException){SetProcessDPIAware();}
      PassiveStream(processId,duration,interval);return 0;
    }
    if(args.Length==2&&args[0]=="--snapshot-pid"){
      uint processId;if(!uint.TryParse(args[1],out processId)||processId==0)return 2;
      try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch(EntryPointNotFoundException){SetProcessDPIAware();}
      Console.WriteLine(Json.Serialize(PassiveSnapshot(processId)));return 0;
    }
    if(args.Length!=3)return 2;
    targetProcess=uint.Parse(args[0]);target=new IntPtr(long.Parse(args[1]));avatarProcess=uint.Parse(args[2]);
    try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch(EntryPointNotFoundException){SetProcessDPIAware();}
    Owned(target,targetProcess);GetCursorPos(out original);
    using(var watchdog=new Timer(_=>{lock(Gate){if(held!=IntPtr.Zero&&Stopwatch.GetTimestamp()>heldUntil)Release();}},null,50,50)){
      Console.WriteLine("ready");Console.Out.Flush();
      try{
        string line;while((line=Console.ReadLine())!=null){if(line=="exit")break;if(line.Length>200){Console.WriteLine("{\"ok\":false,\"error\":\"Command exceeds limits.\"}");continue;}
          try{Console.WriteLine(Json.Serialize(Command(line)));}catch(Exception error){Release();Console.WriteLine(Json.Serialize(new{ok=false,error=error.Message}));}Console.Out.Flush();
        }
      }finally{Release();SetCursorPos(original.X,original.Y);}
    }
    return 0;
  }
}
