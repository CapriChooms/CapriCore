param([string]$OwnedWindow = '',[string]$DisplayWindow = '',[switch]$Probe,[switch]$WithGeometry,[switch]$Worker)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;

public static class CapriScreenClip {
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct Monitor { public int Size; public Rect Area, Work; public uint Flags; }
    [StructLayout(LayoutKind.Sequential)] struct BitmapInfo {
        public uint Size; public int Width, Height; public ushort Planes, Bits;
        public uint Compression, ImageSize; public int XPixelsPerMeter, YPixelsPerMeter;
        public uint ColorsUsed, ColorsImportant;
    }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll",CharSet=CharSet.Auto)] static extern bool GetMonitorInfo(IntPtr monitor, ref Monitor info);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window, ref Point point);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromRect(ref Rect rect, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int width, int height);
    [DllImport("gdi32.dll")] static extern bool PatBlt(IntPtr dc, int x, int y, int width, int height, uint operation);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc, ref BitmapInfo info, uint usage, out IntPtr bits, IntPtr section, uint offset);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] static extern int SetStretchBltMode(IntPtr dc, int mode);
    [DllImport("gdi32.dll")] static extern bool SetBrushOrgEx(IntPtr dc, int x, int y, IntPtr previous);
    [DllImport("gdi32.dll")] static extern bool StretchBlt(IntPtr target, int dx, int dy, int dw, int dh, IntPtr source, int x, int y, int w, int h, uint operation);
    [DllImport("gdi32.dll")] static extern bool GdiFlush();

    static Rect MonitorArea(IntPtr monitor) {
        Monitor info = new Monitor();
        info.Size = Marshal.SizeOf(typeof(Monitor));
        if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info)) throw new InvalidOperationException("No active display");
        return info.Area;
    }

    static Rect CaptureArea(string ownedWindow, string displayWindow) {
        if (!String.IsNullOrEmpty(ownedWindow)) {
            // The owned-window mode captures only the client rectangle of a generated fixture.
            IntPtr window = new IntPtr(Int64.Parse(ownedWindow, CultureInfo.InvariantCulture));
            Point origin = new Point();
            Rect area;
            if (!IsWindow(window) || !GetClientRect(window, out area) || !ClientToScreen(window, ref origin))
                throw new InvalidOperationException("Fixture unavailable");
            area.Right += origin.X; area.Bottom += origin.Y; area.Left = origin.X; area.Top = origin.Y;
            return area;
        }
        IntPtr foreground = GetForegroundWindow();
        if (foreground == IntPtr.Zero) throw new InvalidOperationException("No foreground window");
        if (!String.IsNullOrEmpty(displayWindow) && foreground.ToInt64() != Int64.Parse(displayWindow, CultureInfo.InvariantCulture))
            throw new InvalidOperationException("The foreground window changed before capture");
        return MonitorArea(MonitorFromWindow(foreground, 2));
    }

    static void CheckSize(int width, int height) {
        if (width <= 0 || height <= 0 || width > 16384 || height > 16384 || (long)width * height > 40000000)
            throw new InvalidOperationException("Display exceeds limits");
    }

    static Rect WindowClientArea(IntPtr window, uint processId) {
        Rect client;
        Point origin = new Point();
        uint owner;
        if (GetWindowThreadProcessId(window, out owner) == 0 || owner != processId ||
            !IsWindowVisible(window) || IsIconic(window) ||
            !GetClientRect(window, out client) || !ClientToScreen(window, ref origin))
            throw new InvalidOperationException("The selected window client is unavailable");
        CheckSize(client.Right - client.Left, client.Bottom - client.Top);
        return new Rect { Left = origin.X, Top = origin.Y, Right = origin.X + client.Right, Bottom = origin.Y + client.Bottom };
    }

    static int OutputEdge(int offset, int sourceLength, int targetLength) {
        return (int)Math.Round((double)offset * targetLength / sourceLength, MidpointRounding.AwayFromZero);
    }

    static void CopyWindowRegion(string identity, Rect area, IntPtr source, IntPtr target, int width, int height) {
        var parts = identity.Split(':');
        if (parts.Length != 2) throw new InvalidOperationException("Invalid window identity");
        IntPtr window = new IntPtr(Int64.Parse(parts[0], CultureInfo.InvariantCulture));
        uint processId = UInt32.Parse(parts[1], CultureInfo.InvariantCulture);
        Rect client = WindowClientArea(window, processId);
        int left = Math.Max(area.Left, client.Left), top = Math.Max(area.Top, client.Top);
        int right = Math.Min(area.Right, client.Right), bottom = Math.Min(area.Bottom, client.Bottom);
        if (left >= right || top >= bottom) throw new InvalidOperationException("The window left the capture region");
        IntPtr dc = CreateCompatibleDC(source), bitmap = IntPtr.Zero, old = IntPtr.Zero;
        if (dc == IntPtr.Zero) throw new InvalidOperationException("Window capture surface unavailable");
        try {
            bitmap = CreateCompatibleBitmap(source, client.Right - client.Left, client.Bottom - client.Top);
            if (bitmap == IntPtr.Zero) throw new InvalidOperationException("Window capture surface unavailable");
            old = SelectObject(dc, bitmap);
            if (old == IntPtr.Zero || old.ToInt64() == -1) throw new InvalidOperationException("Window capture surface unavailable");
            // PW_CLIENTONLY | PW_RENDERFULLCONTENT lets Chromium render its composited client.
            if (!PrintWindow(window, dc, 3)) throw new InvalidOperationException("Window capture failed");
            Rect current = WindowClientArea(window, processId);
            if (current.Left != client.Left || current.Top != client.Top || current.Right != client.Right || current.Bottom != client.Bottom)
                throw new InvalidOperationException("The window moved during capture");
            int x = OutputEdge(left - area.Left, area.Right - area.Left, width);
            int y = OutputEdge(top - area.Top, area.Bottom - area.Top, height);
            int w = OutputEdge(right - area.Left, area.Right - area.Left, width) - x;
            int h = OutputEdge(bottom - area.Top, area.Bottom - area.Top, height) - y;
            if (w <= 0 || h <= 0 || !PatBlt(target, 0, 0, width, height, 0x00000042) ||
                !StretchBlt(target, x, y, w, h, dc, left - client.Left, top - client.Top, right - left, bottom - top, 0x00CC0020))
                throw new InvalidOperationException("Window region capture failed");
        } finally {
            if (old != IntPtr.Zero && old.ToInt64() != -1) SelectObject(dc, old);
            if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
            DeleteDC(dc);
        }
    }

    static byte[] Pixels(Rect area, int width, int height, bool png, string windowIdentity) {
        IntPtr source = GetDC(IntPtr.Zero), target = IntPtr.Zero, bitmap = IntPtr.Zero, old = IntPtr.Zero;
        if (source == IntPtr.Zero) throw new InvalidOperationException("Desktop unavailable");
        try {
            target = CreateCompatibleDC(source);
            if (target == IntPtr.Zero) throw new InvalidOperationException("Capture surface unavailable");
            BitmapInfo info = new BitmapInfo();
            info.Size = 40; info.Width = width; info.Height = -height; info.Planes = 1; info.Bits = 32;
            IntPtr bits;
            bitmap = CreateDIBSection(target, ref info, 0, out bits, IntPtr.Zero, 0);
            if (bitmap == IntPtr.Zero || bits == IntPtr.Zero) throw new InvalidOperationException("Capture surface unavailable");
            old = SelectObject(target, bitmap);
            if (old == IntPtr.Zero || old.ToInt64() == -1) throw new InvalidOperationException("Capture surface unavailable");
            SetStretchBltMode(target, 4);
            SetBrushOrgEx(target, 0, 0, IntPtr.Zero);
            if (windowIdentity != null) CopyWindowRegion(windowIdentity, area, source, target, width, height);
            else if (!StretchBlt(target, 0, 0, width, height, source, area.Left, area.Top, area.Right - area.Left, area.Bottom - area.Top, 0x00CC0020))
                throw new InvalidOperationException("Desktop capture failed");
            GdiFlush();
            if (png) {
                using (Bitmap image = new Bitmap(width, height, width * 4, PixelFormat.Format32bppRgb, bits))
                using (MemoryStream bytes = new MemoryStream()) {
                    image.Save(bytes, ImageFormat.Png);
                    return bytes.ToArray();
                }
            }
            byte[] pixels = new byte[checked(width * height * 4)];
            Marshal.Copy(bits, pixels, 0, pixels.Length);
            for (int i = 3; i < pixels.Length; i += 4) pixels[i] = 255;
            return pixels;
        } finally {
            if (old != IntPtr.Zero && old.ToInt64() != -1) SelectObject(target, old);
            if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
            if (target != IntPtr.Zero) DeleteDC(target);
            ReleaseDC(IntPtr.Zero, source);
        }
    }

    public static void RunWorker() {
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        if (previous == IntPtr.Zero) throw new InvalidOperationException("DPI context unavailable");
        try {
            using (BinaryWriter result = new BinaryWriter(Console.OpenStandardOutput())) {
                string line;
                while ((line = Console.ReadLine()) != null) {
                    Rect area = new Rect();
                    int width = 0, height = 0;
                    byte[] bytes = null;
                    try {
                        string[] args = line.Split('|');
                        if (args.Length != 9) throw new InvalidOperationException("Invalid capture request");
                        if (args[0] == "region" || args[0] == "window-region") {
                            int w = Int32.Parse(args[4]), h = Int32.Parse(args[5]);
                            CheckSize(w, h);
                            area.Left = Int32.Parse(args[2]); area.Top = Int32.Parse(args[3]);
                            area.Right = checked(area.Left + w); area.Bottom = checked(area.Top + h);
                            Rect monitor = MonitorArea(MonitorFromRect(ref area, 0));
                            if (area.Left < monitor.Left || area.Top < monitor.Top || area.Right > monitor.Right || area.Bottom > monitor.Bottom)
                                throw new InvalidOperationException("The requested region is outside its display");
                        } else if (args[0] == "foreground") {
                            area = CaptureArea("", args[1]);
                        } else if (args[0] == "owned") {
                            area = CaptureArea(args[1], "");
                        } else throw new InvalidOperationException("Invalid capture source");
                        int sourceWidth = area.Right - area.Left, sourceHeight = area.Bottom - area.Top;
                        CheckSize(sourceWidth, sourceHeight);
                        int maxWidth = Int32.Parse(args[6]), maxHeight = Int32.Parse(args[7]);
                        if (maxWidth <= 0 || maxWidth > 16384 || maxHeight <= 0 || maxHeight > 16384)
                            throw new InvalidOperationException("Invalid frame size");
                        double scale = Math.Min(1.0, Math.Min((double)maxWidth / sourceWidth, (double)maxHeight / sourceHeight));
                        width = Math.Max(1, (int)Math.Round(sourceWidth * scale, MidpointRounding.AwayFromZero));
                        height = Math.Max(1, (int)Math.Round(sourceHeight * scale, MidpointRounding.AwayFromZero));
                        bytes = Pixels(area, width, height, args[8] == "png", args[0] == "window-region" ? args[1] : null);
                    } catch {
                        // Errors contain no titles, coordinates, or screen pixels.
                    }
                    result.Write(bytes == null ? 1 : 0);
                    result.Write(area.Left); result.Write(area.Top);
                    result.Write(area.Right - area.Left); result.Write(area.Bottom - area.Top);
                    result.Write(width); result.Write(height);
                    result.Write(bytes == null ? 0 : bytes.Length);
                    if (bytes != null) result.Write(bytes);
                    result.Flush();
                }
            }
        } finally { SetThreadDpiAwarenessContext(previous); }
    }

    public static string Capture(string ownedWindow, string displayWindow, bool probe, bool withGeometry) {
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        if (previous == IntPtr.Zero) throw new InvalidOperationException("DPI context unavailable");
        try {
            Rect area = CaptureArea(ownedWindow, displayWindow);
            int width = area.Right - area.Left, height = area.Bottom - area.Top;
            CheckSize(width, height);
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
if($Worker){[CapriScreenClip]::RunWorker()}
else{[Console]::Out.Write([CapriScreenClip]::Capture($OwnedWindow,$DisplayWindow,[bool]$Probe,[bool]$WithGeometry))}
