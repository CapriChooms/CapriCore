using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Automation;
using System.Threading;

namespace Capri.Spotify {
static class SpotifyAccessibility {
    [StructLayout(LayoutKind.Explicit,Size=40)] struct Input {
        [FieldOffset(0)] public uint Type;
        [FieldOffset(8)] public ushort Key;
        [FieldOffset(10)] public ushort Scan;
        [FieldOffset(12)] public uint Flags;
        [FieldOffset(20)] public uint MouseFlags;
    }
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
    [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,Input[] inputs,int size);
    sealed class ForegroundScope : IDisposable {
        readonly IntPtr Previous,Window;
        public ForegroundScope(AutomationElement element,IntPtr window) {
            Previous=GetForegroundWindow();Window=window;SetForegroundWindow(window);element.SetFocus();Thread.Sleep(120);
            if(GetForegroundWindow()!=window)throw new SpotifyException("focus_required","Bring Spotify to the foreground before using its song menu.");
        }
        public void Dispose(){if(Previous!=IntPtr.Zero && Previous!=Window && GetForegroundWindow()==Window)SetForegroundWindow(Previous);}
    }
    public static IDisposable Foreground(AutomationElement element,IntPtr window){return new ForegroundScope(element,window);}
    public static void Click(AutomationElement element,IntPtr window) {
        if(element==null || !element.Current.IsEnabled)throw new SpotifyException("control_unavailable","This Spotify menu control is unavailable.");
        foreach(var key in new[]{1,2,16,17,18,91,92})if(GetAsyncKeyState(key)<0)throw new SpotifyException("input_busy","Release the mouse and modifier keys before using Spotify's song menu.");
        var rect=element.Current.BoundingRectangle;
        var target=new Point{X=(int)(rect.Left+rect.Width/2),Y=(int)(rect.Top+rect.Height/2)};
        if(rect.IsEmpty || rect.Width<1 || rect.Height<1 || GetForegroundWindow()!=window || GetAncestor(WindowFromPoint(target),2)!=window)
            throw new SpotifyException("control_obscured","Spotify's song menu is covered or outside its visible window. Bring Spotify forward and try again.");
        Point previous;GetCursorPos(out previous);SetCursorPos(target.X,target.Y);
        try{
            if(GetForegroundWindow()!=window || GetAncestor(WindowFromPoint(target),2)!=window)throw new SpotifyException("focus_required","Spotify lost focus before its menu action.");
            var inputs=new[]{new Input{Type=0,MouseFlags=2},new Input{Type=0,MouseFlags=4}};
            if(SendInput(2,inputs,Marshal.SizeOf(typeof(Input)))!=2){SendInput(1,new[]{new Input{Type=0,MouseFlags=4}},Marshal.SizeOf(typeof(Input)));throw new SpotifyException("input_failed","Spotify did not receive the menu click. Check the player before retrying.");}
            Thread.Sleep(120);
        }finally{Point current;if(GetCursorPos(out current) && Math.Abs(current.X-target.X)<3 && Math.Abs(current.Y-target.Y)<3)SetCursorPos(previous.X,previous.Y);}
    }
    static Input Key(ushort key,bool up=false) { return new Input{Type=1,Key=key,Flags=up?2u:0u}; }
    // Chromium's ValuePattern setter changes the accessible value without firing
    // React's input handler. Real text input is limited to this verified field;
    // callers cannot supply keys, coordinates, an executable or another window.
    public static void EnterSearch(AutomationElement field,IntPtr window,string query) {
        if(field==null)throw new SpotifyException("search_unavailable","Spotify's search field is unavailable.");
        foreach(var key in new[]{1,2,16,17,18,91,92})if(GetAsyncKeyState(key)<0)throw new SpotifyException("input_busy","Release the mouse and modifier keys before asking Spotify to search.");
        var previous=GetForegroundWindow();
        try {
            SetForegroundWindow(window);
            try{field.SetFocus();}catch(InvalidOperationException){}
            var focusTimer=Stopwatch.StartNew();
            bool verified=false;
            do {
                var focused=AutomationElement.FocusedElement;
                verified=GetForegroundWindow()==window && focused!=null && focused.GetRuntimeId().SequenceEqual(field.GetRuntimeId());
                if(verified)break;
                Thread.Sleep(50);
            }while(focusTimer.ElapsedMilliseconds<750);
            if(!verified || GetForegroundWindow()!=window)
                throw new SpotifyException("focus_required","Bring Spotify to the foreground and try the search again.");
            var input=new List<Input>{Key(17),Key(65),Key(65,true),Key(17,true)};
            foreach(var character in query){input.Add(new Input{Type=1,Scan=character,Flags=4});input.Add(new Input{Type=1,Scan=character,Flags=6});}
            input.Add(Key(13));input.Add(Key(13,true));
            uint sent=SendInput((uint)input.Count,input.ToArray(),Marshal.SizeOf(typeof(Input)));
            if(sent!=input.Count){SendInput(1,new[]{Key(17,true)},Marshal.SizeOf(typeof(Input)));throw new SpotifyException("input_failed","Spotify did not receive the complete search. Check its search field before retrying.");}
            Thread.Sleep(250);
        } finally { if(previous!=IntPtr.Zero && previous!=window && GetForegroundWindow()==window)SetForegroundWindow(previous); }
    }
    static Dictionary<string,string> Values=new Dictionary<string,string>();
    static DateTime Updated=DateTime.MinValue;
    static IntPtr Window;
    public static bool InvokeDefault(AutomationElement element,IntPtr window) {
        var objects=new List<object>();
        try {
            var automation=new UIAutomationClient.CUIAutomation();objects.Add(automation);
            var root=automation.ElementFromHandle(window);objects.Add(root);
            var condition=automation.CreatePropertyCondition(30005,element.Current.Name);objects.Add(condition);
            var matches=root.FindAll((UIAutomationClient.TreeScope)4,condition);objects.Add(matches);
            for(int i=0;i<matches.Length;i++) {
                var target=matches.GetElement(i);objects.Add(target);
                if(!target.GetRuntimeId().Cast<int>().SequenceEqual(element.GetRuntimeId()))continue;
                UIAutomationClient.IUIAutomationInvokePattern invoke=null;
                try{invoke=target.GetCurrentPattern(10000) as UIAutomationClient.IUIAutomationInvokePattern;}catch(COMException){}
                if(invoke!=null){objects.Add(invoke);invoke.Invoke();return true;}
                UIAutomationClient.IUIAutomationLegacyIAccessiblePattern legacy=null;
                try{legacy=target.GetCurrentPattern(10018) as UIAutomationClient.IUIAutomationLegacyIAccessiblePattern;}catch(COMException){}
                if(legacy!=null){objects.Add(legacy);legacy.DoDefaultAction();return true;}
            }
            return false;
        }finally{foreach(var item in objects.AsEnumerable().Reverse())if(Marshal.IsComObject(item))Marshal.FinalReleaseComObject(item);}
    }
    public static int[] MainId(IntPtr window) {
        var objects=new List<object>();
        try {
            var automation=new UIAutomationClient.CUIAutomation();objects.Add(automation);
            var root=automation.ElementFromHandle(window);objects.Add(root);
            var condition=automation.CreatePropertyCondition(30101,"main");objects.Add(condition);
            var main=root.FindFirst((UIAutomationClient.TreeScope)4,condition);if(main==null)return null;objects.Add(main);
            return main.GetRuntimeId().Cast<int>().ToArray();
        }finally{foreach(var item in objects.AsEnumerable().Reverse())if(Marshal.IsComObject(item))Marshal.FinalReleaseComObject(item);}
    }
    public static string Link(AutomationElement element,IntPtr window) {
        var key=String.Join(",",element.GetRuntimeId());string value;
        if(Window!=window || DateTime.UtcNow-Updated>TimeSpan.FromMilliseconds(250) || !Values.ContainsKey(key))Refresh(window);
        return Values.TryGetValue(key,out value)?value:"";
    }
    static void Refresh(IntPtr window) {
        var objects=new List<object>();var values=new Dictionary<string,string>();
        try {
            var automation=new UIAutomationClient.CUIAutomation();objects.Add(automation);
            var root=automation.ElementFromHandle(window);objects.Add(root);
            var condition=automation.CreatePropertyCondition(30003,50005);objects.Add(condition); // hyperlink
            var links=root.FindAll((UIAutomationClient.TreeScope)4,condition);objects.Add(links);
            for(int i=0;i<links.Length && i<2000;i++) {
                var link=links.GetElement(i);objects.Add(link);
                var value=link.GetCurrentPropertyValue(30045) as string;
                if(String.IsNullOrEmpty(value))value=link.GetCurrentPropertyValue(30093) as string;
                if(!String.IsNullOrEmpty(value))values[String.Join(",",link.GetRuntimeId().Cast<int>())]=value;
            }
            Values=values;Window=window;Updated=DateTime.UtcNow;
        } finally {
            var released=new List<object>();
            foreach(var item in objects.AsEnumerable().Reverse())if(!released.Any(other=>Object.ReferenceEquals(item,other))) {
                released.Add(item);try{if(Marshal.IsComObject(item))Marshal.FinalReleaseComObject(item);}catch(InvalidComObjectException){}
            }
        }
    }
}
}
