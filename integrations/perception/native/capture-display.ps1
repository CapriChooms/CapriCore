param([string]$OwnedWindow = '',[switch]$Probe,[switch]$WithGeometry)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class CapriScreenClip {
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct Monitor { public int Size; public Rect Area, Work; public uint Flags; }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll",CharSet=CharSet.Auto)] static extern bool GetMonitorInfo(IntPtr monitor, ref Monitor info);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window, ref Point point);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    public static string Capture(string ownedWindow, bool probe, bool withGeometry) {
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        if (previous == IntPtr.Zero) throw new InvalidOperationException("DPI context unavailable");
        try {
            Rect area;
            if (!String.IsNullOrEmpty(ownedWindow)) {
                // Verification captures only the client rectangle of its generated owned window.
                IntPtr window = new IntPtr(Int64.Parse(ownedWindow)); Point origin = new Point();
                if (!IsWindow(window) || !GetClientRect(window, out area) || !ClientToScreen(window, ref origin)) throw new InvalidOperationException("Fixture unavailable");
                area.Right += origin.X; area.Bottom += origin.Y; area.Left = origin.X; area.Top = origin.Y;
            } else {
                IntPtr window = GetForegroundWindow(); if (window == IntPtr.Zero) throw new InvalidOperationException("No foreground window");
                IntPtr monitor = MonitorFromWindow(window, 2); Monitor info = new Monitor(); info.Size = Marshal.SizeOf(typeof(Monitor));
                if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info)) throw new InvalidOperationException("No active display");
                area = info.Area;
            }
            int width = area.Right - area.Left, height = area.Bottom - area.Top;
            if (width <= 0 || height <= 0 || width > 16384 || height > 16384 || (long)width * height > 40000000) throw new InvalidOperationException("Display exceeds limits");
            if (probe) return String.Format("{{\"x\":{0},\"y\":{1},\"width\":{2},\"height\":{3}}}",area.Left,area.Top,width,height);
            using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format32bppRgb))
            using (Graphics graphics = Graphics.FromImage(bitmap))
            using (MemoryStream bytes = new MemoryStream()) {
                graphics.CopyFromScreen(area.Left, area.Top, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
                bitmap.Save(bytes, ImageFormat.Png); string png=Convert.ToBase64String(bytes.ToArray());
                if(withGeometry)return String.Format("{{\"x\":{0},\"y\":{1},\"width\":{2},\"height\":{3},\"png\":\"{4}\"}}",area.Left,area.Top,width,height,png);
                return png;
            }
        } finally { SetThreadDpiAwarenessContext(previous); }
    }
}
'@
[Console]::Out.Write([CapriScreenClip]::Capture($OwnedWindow,[bool]$Probe,[bool]$WithGeometry))
