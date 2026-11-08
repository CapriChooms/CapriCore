// Event metadata only: never screenshots, window titles, document text or microphone audio.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

class WindowsEvents {
    delegate void WinEvent(IntPtr hook,uint ev,IntPtr window,int obj,int child,uint thread,uint time);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,WinEvent callback,uint process,uint thread,uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out Rect rect);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window,uint flags);
    [DllImport("user32.dll",CharSet=CharSet.Auto)] static extern bool GetMonitorInfo(IntPtr monitor,ref Monitor monitorInfo);
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastInput info);
    [StructLayout(LayoutKind.Sequential)] struct Rect{public int Left,Top,Right,Bottom;}
    [StructLayout(LayoutKind.Sequential)] struct Monitor{public int Size;public Rect Area,Work;public uint Flags;}
    [StructLayout(LayoutKind.Sequential)] struct LastInput{public uint Size,Time;}
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer();static readonly object OutputLock=new object();
    static readonly HashSet<int> Ignored=new HashSet<int>();static int FilterProcess;static WinEvent Callback;static IntPtr Hook,LocationHook;static bool Idle,LastFullscreen;static IntPtr LastWindow;
    static void Emit(string kind,params object[] pairs){var value=new Dictionary<string,object>{{"schemaVersion",1},{"source","windows-events"},{"id",Guid.NewGuid().ToString()},{"timestamp",(long)(DateTime.UtcNow-new DateTime(1970,1,1)).TotalMilliseconds},{"confidence",1},{"kind",kind}};for(int i=0;i<pairs.Length;i+=2)value[(string)pairs[i]]=pairs[i+1];lock(OutputLock){Console.WriteLine(Json.Serialize(value));Console.Out.Flush();}}
    static void Foreground(bool refresh=false){
        IntPtr window=GetForegroundWindow();if(window==IntPtr.Zero||(!refresh&&window==LastWindow))return;uint pid;GetWindowThreadProcessId(window,out pid);
        if(Ignored.Contains((int)pid)||(FilterProcess!=0&&pid!=FilterProcess))return;
        try{
            string name=Process.GetProcessById((int)pid).ProcessName;
            Rect rectangle;var monitor=new Monitor{Size=Marshal.SizeOf(typeof(Monitor))};bool full=GetWindowRect(window,out rectangle)&&GetMonitorInfo(MonitorFromWindow(window,2),ref monitor)&&rectangle.Left<=monitor.Area.Left+2&&rectangle.Top<=monitor.Area.Top+2&&rectangle.Right>=monitor.Area.Right-2&&rectangle.Bottom>=monitor.Area.Bottom-2;
            if(window==LastWindow&&full==LastFullscreen)return;LastWindow=window;LastFullscreen=full;
            Emit("app.foreground","processName",name,"processId",(int)pid,"fullscreen",full);
        }catch(ArgumentException){}catch(InvalidOperationException){}catch(System.ComponentModel.Win32Exception){}
    }
    sealed class EndWindow:Form{protected override void SetVisibleCore(bool value){base.SetVisibleCore(false);}protected override void WndProc(ref Message m){if(m.Msg==0x11)Emit("session.ending");base.WndProc(ref m);}}
    [STAThread] static void Main(){
        Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
        try{
            var input=Console.ReadLine();if(input==null||input.Length>4096)return;var settings=Json.Deserialize<Dictionary<string,object>>(input);
            if(settings.ContainsKey("filterProcessId"))FilterProcess=Convert.ToInt32(settings["filterProcessId"]);
            if(settings.ContainsKey("ignoredProcessIds"))foreach(object id in (System.Collections.ArrayList)settings["ignoredProcessIds"])Ignored.Add(Convert.ToInt32(id));
            Ignored.Add(Process.GetCurrentProcess().Id);
            Callback=(h,e,w,o,c,t,ms)=>{if(e==3||w==GetForegroundWindow())Foreground(e!=3);};Hook=SetWinEventHook(3,3,IntPtr.Zero,Callback,0,0,0);LocationHook=SetWinEventHook(0x800b,0x800b,IntPtr.Zero,Callback,0,0,0);
            if(Hook==IntPtr.Zero)throw new InvalidOperationException("Windows event hook unavailable");
            var window=new EndWindow();var handle=window.Handle;
            SystemEvents.SessionSwitch+=(s,e)=>{if(e.Reason==SessionSwitchReason.SessionLock)Emit("session.lock");if(e.Reason==SessionSwitchReason.SessionUnlock){Emit("session.unlock");LastWindow=IntPtr.Zero;Foreground();}};
            SystemEvents.PowerModeChanged+=(s,e)=>{if(e.Mode==PowerModes.Suspend)Emit("power.suspend");if(e.Mode==PowerModes.Resume){Emit("power.resume");LastWindow=IntPtr.Zero;Foreground();}};
            var timer=new System.Windows.Forms.Timer{Interval=1000};timer.Tick+=(s,e)=>{Foreground(true);var last=new LastInput{Size=(uint)Marshal.SizeOf(typeof(LastInput))};if(GetLastInputInfo(ref last)){bool idle=unchecked((uint)Environment.TickCount-last.Time)>=300000;if(idle!=Idle){Idle=idle;Emit(idle?"user.idle":"user.return");}}};timer.Start();
            Console.WriteLine("{\"type\":\"ready\",\"source\":\"windows-events\",\"capturesImages\":false,\"capturesTitles\":false}");Console.Out.Flush();Foreground();
            new Thread(()=>{while(Console.ReadLine()!=null){}Application.Exit();}){IsBackground=true}.Start();
            Application.Run(window);timer.Stop();UnhookWinEvent(Hook);if(LocationHook!=IntPtr.Zero)UnhookWinEvent(LocationHook);
        }catch(Exception){Console.Error.WriteLine("Windows event observation unavailable");Environment.ExitCode=1;}
    }
}
