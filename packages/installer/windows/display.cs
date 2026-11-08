// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
namespace Capri.Setup {
    public static class Display {
        [DllImport("shell32.dll",CharSet=CharSet.Unicode)]private static extern int SetCurrentProcessExplicitAppUserModelID(string id);
        [DllImport("shell32.dll")]private static extern int GetCurrentProcessExplicitAppUserModelID(out IntPtr id);
        public static bool Brand(){try{return SetCurrentProcessExplicitAppUserModelID("Capri.Setup")==0;}catch{return false;}}
        public static string AppId(){
            IntPtr id=IntPtr.Zero;
            try{return GetCurrentProcessExplicitAppUserModelID(out id)==0?Marshal.PtrToStringUni(id):"";}
            catch{return "";}finally{if(id!=IntPtr.Zero)Marshal.FreeCoTaskMem(id);}
        }
        [DllImport("user32.dll")]private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
        [DllImport("user32.dll")]private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
        [DllImport("user32.dll")]private static extern IntPtr GetThreadDpiAwarenessContext();
        [DllImport("user32.dll")]private static extern bool AreDpiAwarenessContextsEqual(IntPtr a,IntPtr b);
        [DllImport("user32.dll")]private static extern uint GetDpiForSystem();
        [DllImport("user32.dll")]private static extern uint GetDpiForWindow(IntPtr window);
        [DllImport("user32.dll")]private static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
        public static bool PerMonitorV2(IntPtr window){try{return AreDpiAwarenessContextsEqual(GetWindowDpiAwarenessContext(window),new IntPtr(-4));}catch{return false;}}
        [DllImport("user32.dll")]private static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
        [DllImport("user32.dll")]private static extern bool ShowWindowAsync(IntPtr window,int mode);
        [DllImport("user32.dll")]private static extern bool SetForegroundWindow(IntPtr window);
        public static bool Focus(int pid,string stamp,long handle) {
            uint actual;IntPtr window=new IntPtr(handle);GetWindowThreadProcessId(window,out actual);
            if(actual!=(uint)pid||!SessionIO.Alive(pid,stamp))return false;
            ShowWindowAsync(window,9);return SetForegroundWindow(window);
        }
        public static bool Enable() {
            IntPtr context=new IntPtr(-4);
            try {SetProcessDpiAwarenessContext(context);}catch{}
            try {SetThreadDpiAwarenessContext(context);return AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(),context);}catch{return false;}
        }
        public static int Dpi(IntPtr window) {try{return (int)(window==IntPtr.Zero?GetDpiForSystem():GetDpiForWindow(window));}catch{return 96;}}
    }
    public class WizardForm : Form {
        public event EventHandler MonitorDpiChanged;
        [StructLayout(LayoutKind.Sequential)]private struct Rect {public int Left,Top,Right,Bottom;}
        protected override void WndProc(ref Message message) {
            bool changed=message.Msg==0x02E0;
            Rect bounds=changed?(Rect)Marshal.PtrToStructure(message.LParam,typeof(Rect)):new Rect();
            base.WndProc(ref message);
            if(changed) {
                MinimumSize=Size.Empty;
                Bounds=new Rectangle(bounds.Left,bounds.Top,bounds.Right-bounds.Left,bounds.Bottom-bounds.Top);
                EventHandler handler=MonitorDpiChanged;if(handler!=null)handler(this,EventArgs.Empty);
            }
        }
    }
}
