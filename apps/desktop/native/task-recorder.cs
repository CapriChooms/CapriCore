// Explicit, bounded owner recording. Hook callbacks only enqueue events; UIA runs on a worker.
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;
class TaskRecorder {
 delegate IntPtr Hook(int code,IntPtr message,IntPtr data);
 [DllImport("user32.dll")]static extern IntPtr SetWindowsHookEx(int id,Hook callback,IntPtr module,uint thread);
 [DllImport("user32.dll")]static extern bool UnhookWindowsHookEx(IntPtr hook);
 [DllImport("user32.dll")]static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
 [DllImport("user32.dll")]static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr handle,out uint process);
 [DllImport("user32.dll")]static extern IntPtr WindowFromPoint(Point point);
 [DllImport("user32.dll")]static extern IntPtr GetAncestor(IntPtr window,uint flags);
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr window,out Rect rect);
 [DllImport("user32.dll")]static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern IntPtr GetModuleHandle(string module);
 struct Point{public int x,y;}
 struct Rect{public int left,top,right,bottom;}
 [StructLayout(LayoutKind.Sequential)]struct MouseData{public Point point;public uint data,flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Sequential)]struct KeyData{public uint key,scan,flags,time;public UIntPtr extra;}
 class Event{public string action;public Point point;public string[] keys;public int amount;public long at;public IntPtr window;}
 static readonly JavaScriptSerializer json=new JavaScriptSerializer();
 static readonly BlockingCollection<Event> queue=new BlockingCollection<Event>(256);
 static readonly Stopwatch clock=Stopwatch.StartNew();
 static Hook mouseCallback=Mouse,keyCallback=Keyboard;
 static IntPtr mouseHook,keyHook;static int parentPid,fixturePid;static volatile bool done;static long previous,lastMove;static int count;static bool holding;
 static void Emit(object value){lock(json){Console.WriteLine(json.Serialize(value));Console.Out.Flush();}}
 static IntPtr Mouse(int code,IntPtr message,IntPtr data){
  if(code>=0&&!done){
   int kind=message.ToInt32();long now=clock.ElapsedMilliseconds;
   if(kind==513||kind==514||kind==516||kind==522||(kind==512&&holding&&now-lastMove>=35)){
    var value=(MouseData)Marshal.PtrToStructure(data,typeof(MouseData));
    if((value.flags&1)==0||fixturePid>0){
     if(kind==513)holding=true;else if(kind==514)holding=false;else if(kind==512)lastMove=now;
     queue.TryAdd(new Event{action=kind==513?"down":kind==514?"up":kind==512?"move":kind==516?"right":"scroll",point=value.point,amount=(short)(value.data>>16)/120,at=now,window=GetAncestor(WindowFromPoint(value.point),2)});
    }
   }
  }
  return CallNextHookEx(IntPtr.Zero,code,message,data);
 }
 static IntPtr Keyboard(int code,IntPtr message,IntPtr data){
  if(code>=0&&!done&&(message.ToInt32()==256||message.ToInt32()==260)){
   var value=(KeyData)Marshal.PtrToStructure(data,typeof(KeyData));
   if((value.flags&16)==0||fixturePid>0){int key=(int)value.key;if(key==27)done=true;
    else{
     var keys=new List<string>();if(GetAsyncKeyState(17)<0)keys.Add("CTRL");if(GetAsyncKeyState(16)<0)keys.Add("SHIFT");if(GetAsyncKeyState(18)<0)keys.Add("ALT");if(GetAsyncKeyState(91)<0||GetAsyncKeyState(92)<0)keys.Add("WIN");
     string named=key==13?"ENTER":key==9?"TAB":key==37?"LEFT":key==38?"UP":key==39?"RIGHT":key==40?"DOWN":key==36?"HOME":key==35?"END":null;
     bool shortcut=(keys.Contains("CTRL")||keys.Contains("ALT")||keys.Contains("WIN"))&&((key>=65&&key<=90)||(key>=48&&key<=57));
     if(named!=null||shortcut){keys.Add(named??((char)key).ToString());queue.TryAdd(new Event{action="keys",keys=keys.ToArray(),at=clock.ElapsedMilliseconds,window=GetForegroundWindow()});}
    }
   }
  }return CallNextHookEx(IntPtr.Zero,code,message,data);
 }
 static object Selector(AutomationElement element,Point point,IntPtr window){
  if(element==null||element.Current.IsPassword)return null;
  Rect rect;if(!GetWindowRect(window,out rect)||rect.right<=rect.left||rect.bottom<=rect.top)return null;
  var current=element.Current;string label=current.Name??"",id=current.AutomationId??"";
  return new{label=label.Substring(0,Math.Min(label.Length,100)),role=current.ControlType.ProgrammaticName,automationId=id.Substring(0,Math.Min(id.Length,100)),x=Math.Max(0,Math.Min(1,(double)(point.x-rect.left)/(rect.right-rect.left))),y=Math.Max(0,Math.Min(1,(double)(point.y-rect.top)/(rect.bottom-rect.top)))};
 }
 static void Consume(){
  Event down=null;object from=null;var path=new List<object>();Rect dragBounds=new Rect();
  long lastPoint=0,pointInterval=35;bool displaced=false;
  foreach(var entry in queue.GetConsumingEnumerable()){
   if(done||count>=120)break;
   try{
    if(entry.action=="move"){
     if(down!=null&&entry.window==down.window&&
         entry.point.x>=dragBounds.left&&entry.point.x<dragBounds.right&&
         entry.point.y>=dragBounds.top&&entry.point.y<dragBounds.bottom){
      displaced=displaced||Math.Abs(entry.point.x-down.point.x)>8||Math.Abs(entry.point.y-down.point.y)>8;
      if(entry.at-lastPoint<pointInterval)continue;
      if(path.Count==24){
       for(int index=path.Count-1;index>0;index-=2)path.RemoveAt(index);
       pointInterval*=2;
      }
      path.Add(new{x=(double)(entry.point.x-dragBounds.left)/(dragBounds.right-dragBounds.left),
          y=(double)(entry.point.y-dragBounds.top)/(dragBounds.bottom-dragBounds.top)});
      lastPoint=entry.at;
     }
     continue;
    }
    uint pid;GetWindowThreadProcessId(entry.window,out pid);if(pid==0||pid==parentPid||(fixturePid>0&&pid!=fixturePid))continue;
    string exe;using(var process=Process.GetProcessById((int)pid)){if(process.SessionId!=Process.GetCurrentProcess().SessionId)continue;exe=process.MainModule.FileName;}
    if(String.IsNullOrEmpty(exe)||!exe.EndsWith(".exe",StringComparison.OrdinalIgnoreCase))continue;
    AutomationElement element=entry.action=="keys"?AutomationElement.FocusedElement:AutomationElement.FromPoint(new System.Windows.Point(entry.point.x,entry.point.y));
    if(element==null||element.Current.IsPassword)continue;
    var selector=entry.action=="keys"?null:Selector(element,entry.point,entry.window);
    if(entry.action=="down"){down=entry;from=selector;path.Clear();GetWindowRect(entry.window,out dragBounds);lastPoint=entry.at;pointInterval=35;displaced=false;continue;}
    string action=entry.action;object destination=null;
    if(action=="up"){
     action="click";
     if(down!=null&&down.window==entry.window&&(displaced||Math.Sqrt(Math.Pow(entry.point.x-down.point.x,2)+Math.Pow(entry.point.y-down.point.y,2))>8)){action="drag";destination=selector;selector=from;}
     down=null;from=null;
    }
    if(action!="keys"&&selector==null)continue;
    if(action=="right")action="click";
    count++;Emit(new{type="step",step=new{action,executable=exe,selector,to=destination,trajectory=action=="drag"?path.ToArray():null,keys=entry.keys,amount=entry.amount,button=entry.action=="right"?"right":"left",delayMs=(int)Math.Max(0,Math.Min(2000,entry.at-previous-100))}});previous=entry.at;
   }catch{/* Unknown/password/closed targets produce no recorded data. */}
  }
 }
 [STAThread]static int Main(string[] args){
  try{
   if(args.Length<1||args.Length>2||!Int32.TryParse(args[0],out parentPid)||parentPid<=0)return 2;
   // Owned verification can admit injected input only for its exact fixture PID.
   // The desktop always supplies one argument and never enables this path.
   if(args.Length==2&&(!Int32.TryParse(args[1],out fixturePid)||fixturePid<=0))return 2;
   SetThreadDpiAwarenessContext(new IntPtr(-4));
   mouseHook=SetWindowsHookEx(14,mouseCallback,GetModuleHandle(null),0);keyHook=SetWindowsHookEx(13,keyCallback,GetModuleHandle(null),0);
   if(mouseHook==IntPtr.Zero||keyHook==IntPtr.Zero)return 3;
   var consumer=Task.Run((Action)Consume);
   Task.Run(()=>{try{Console.ReadLine();}finally{done=true;}});
   var timer=new System.Windows.Forms.Timer{Interval=100};timer.Tick+=(s,e)=>{bool alive;try{using(var process=Process.GetProcessById(parentPid))alive=!process.HasExited;}catch{alive=false;}if(done||clock.ElapsedMilliseconds>=120000||count>=120||!alive)Application.ExitThread();};timer.Start();
   Emit(new{type="armed"});Application.Run();done=true;queue.CompleteAdding();consumer.Wait(1000);Emit(new{type="stopped"});return 0;
  }catch{Emit(new{type="failed"});return 1;}
  finally{done=true;if(mouseHook!=IntPtr.Zero)UnhookWindowsHookEx(mouseHook);if(keyHook!=IntPtr.Zero)UnhookWindowsHookEx(keyHook);}
 }
}
