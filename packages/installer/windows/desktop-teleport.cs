// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

internal static class CapriDesktopTeleport {
    private const int WhMouseLowLevel = 14;
    private const int WhKeyboardLowLevel = 13;
    private const int LeftDown = 0x0201;
    private const int LeftUp = 0x0202;
    private const int RightDown = 0x0204;
    private const int RightUp = 0x0205;
    private const int MiddleDown = 0x0207;
    private const int XDown = 0x020B;
    private static readonly object State = new object();
    private static readonly Hook Mouse = ObserveMouse;
    private static readonly Hook Keyboard = ObserveKeyboard;
    private static Point? origin;
    private static IntPtr releaseWindow;
    private static int releaseId;
    private static bool trackRelease;
    private static IntPtr anchorWindow;
    private static uint anchorProcess;
    private static int anchorId;
    private static string lastAnchor;
    private static Control anchorLifetime;
    private static uint anchorThread;
    private static long anchorStartedAt;
    private static long anchorUnavailableAt = -1;
    private const int AnchorHoldMs = 750;
    private const int AnchorUnavailableTimeoutMs = 5000;
    private static IntPtr anchorObjectHook;
    private static IntPtr anchorStateHook;
    private static int anchorGeneration;
    private static bool anchorUpdatePending;
    private static bool anchorDestroyed;
    private static readonly WinEvent AnchorEvent = ObserveAnchor;

    [StructLayout(LayoutKind.Sequential)]
    private struct Point {
        public int X, Y;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime { public uint Low, High; }
    private enum AnchorIdentity { Unavailable, Verified, Closed }

    private delegate IntPtr Hook(int code, IntPtr message, IntPtr data);
    private delegate void WinEvent(IntPtr hook, uint kind, IntPtr window, int objectId, int childId, uint thread, uint time);
    [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(int kind, Hook callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPhysicalPoint(Point point);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attr, out Rect rect, int size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] private static extern IntPtr SetWinEventHook(uint first, uint last, IntPtr module, WinEvent callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(IntPtr process, out FileTime created, out FileTime exited, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);

    private static string WindowClass(IntPtr window) {
        StringBuilder name = new StringBuilder(128);
        GetClassName(window, name, name.Capacity);
        return name.ToString();
    }

    private static bool IsExplorer(IntPtr window) {
        uint process, shell;
        GetWindowThreadProcessId(window, out process);
        GetWindowThreadProcessId(GetShellWindow(), out shell);
        return process != 0 && process == shell;
    }

    private static bool IsDesktop(IntPtr window, string root) {
        if (root != "Progman" && root != "WorkerW") return false;
        string hit = WindowClass(window);
        return hit == "SysListView32" || hit == "SHELLDLL_DefView" || hit == "Progman" || hit == "WorkerW";
    }

    private static IntPtr ObserveMouse(int code, IntPtr message, IntPtr data) {
        int kind = message.ToInt32();
        if (code >= 0 && kind == LeftUp) {
            int id;
            lock (State) {
                id = trackRelease ? releaseId : 0;
                trackRelease = false;
            }
            if (id != 0) {
                Point point = (Point)Marshal.PtrToStructure(data, typeof(Point));
                ThreadPool.QueueUserWorkItem(_ => {
                    try {
                        Console.WriteLine(String.Format(CultureInfo.InvariantCulture, "release {0} {1} {2}", id, point.X, point.Y));
                    } catch (IOException) {}
                });
            }
        } else if (code >= 0 && (kind == RightDown || kind == RightUp || kind == LeftDown || kind == MiddleDown || kind == XDown)) {
            // MSLLHOOKSTRUCT begins with the physical, per-monitor-aware cursor point.
            Point point = (Point)Marshal.PtrToStructure(data, typeof(Point));
            IntPtr window = WindowFromPhysicalPoint(point);
            IntPtr root = GetAncestor(window, 2); // GA_ROOT
            bool explorer = IsExplorer(window);
            string rootClass = explorer ? WindowClass(root) : "";
            bool desktop = explorer && IsDesktop(window, rootClass);
            bool shellMenu = explorer && !desktop && rootClass != "CabinetWClass" &&
                rootClass != "ExploreWClass" && rootClass != "Shell_TrayWnd" && rootClass != "Shell_SecondaryTrayWnd";
            lock (State) {
                if (kind == RightDown && desktop) origin = point;
                // The desktop button-up and menu navigation preserve the original right-down point.
                else if (!(kind == RightUp && desktop) && !shellMenu)
                    origin = null;
                if (kind == LeftDown) {
                    trackRelease = releaseWindow != IntPtr.Zero && root == releaseWindow;
                }
            }
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }

    private static IntPtr ObserveKeyboard(int code, IntPtr message, IntPtr data) {
        if (code >= 0 && (message.ToInt32() == 0x0100 || message.ToInt32() == 0x0104)) {
            int key = Marshal.ReadInt32(data);
            if (key == 0x1B || key == 0x5D || (key == 0x79 && GetAsyncKeyState(0x10) < 0)) {
                // Esc dismisses the original menu. Apps and Shift+F10 create a new one.
                lock (State) origin = null;
            }
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }

    private static void Listen(string pipeName, Control lifetime) {
        try {
            PipeSecurity access = new PipeSecurity();
            access.SetAccessRuleProtection(true, false);
            using (WindowsIdentity user = WindowsIdentity.GetCurrent()) {
                access.AddAccessRule(new PipeAccessRule(user.User, PipeAccessRights.FullControl, AccessControlType.Allow));
            }
            using (var pipe = new NamedPipeServerStream(pipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.None, 64, 0, access)) {
                Console.WriteLine("ready");
                while (true) {
                    pipe.WaitForConnection();
                    // The private pipe name identifies the current registration. A connection is the command.
                    Point? point;
                    lock (State) {
                        point = origin;
                        origin = null;
                    }
                    pipe.Disconnect();
                    if (point.HasValue) {
                        Console.WriteLine(String.Format(CultureInfo.InvariantCulture, "{0} {1}", point.Value.X, point.Value.Y));
                    }
                }
            }
        } catch (IOException) { Exit(lifetime); }
        catch (UnauthorizedAccessException) { Exit(lifetime); }
    }

    private static int Watch(string pipeName) {
        IntPtr module = GetModuleHandle(null);
        IntPtr mouseHook = SetWindowsHookEx(WhMouseLowLevel, Mouse, module, 0);
        IntPtr keyboardHook = SetWindowsHookEx(WhKeyboardLowLevel, Keyboard, module, 0);
        try {
            if (mouseHook == IntPtr.Zero || keyboardHook == IntPtr.Zero) return 1;
            using (var lifetime = new Control()) {
                // The inherited pipes are the lifetime link with the Electron parent.
                IntPtr handle = lifetime.Handle;
                var server = new Thread(() => Listen(pipeName, lifetime)) { IsBackground = true };
                var parent = new Thread(() => ReadParent(lifetime)) { IsBackground = true };
                server.Start();
                parent.Start();
                // Movement arrives through target-scoped WinEvents. This slow
                // identity/visibility check is only a fallback, never a frame clock.
                using (var geometry = new System.Windows.Forms.Timer { Interval = 500 }) {
                    geometry.Tick += (_, __) => PollAnchor();
                    anchorTimer = geometry;
                    anchorLifetime = lifetime;
                    try { Application.Run(); }
                    finally { StopFollowing(); anchorLifetime = null; anchorTimer = null; }
                }
            }
            return 0;
        } finally {
            if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
            if (keyboardHook != IntPtr.Zero) UnhookWindowsHookEx(keyboardHook);
        }
    }

    private static System.Windows.Forms.Timer anchorTimer;

    private static void StopFollowing() {
        if (anchorTimer != null) anchorTimer.Stop();
        anchorGeneration++;
        anchorId = 0;
        anchorWindow = IntPtr.Zero;
        anchorProcess = 0;
        anchorThread = 0;
        anchorStartedAt = 0;
        anchorUnavailableAt = -1;
        anchorUpdatePending = false;
        anchorDestroyed = false;
        lastAnchor = null;
        // Out-of-context hooks are installed and removed on this same UI thread.
        // https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-setwineventhook
        // https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-unhookwinevent
        if (anchorObjectHook != IntPtr.Zero) UnhookWinEvent(anchorObjectHook);
        if (anchorStateHook != IntPtr.Zero) UnhookWinEvent(anchorStateHook);
        anchorObjectHook = anchorStateHook = IntPtr.Zero;
    }

    private static void CloseAnchor() {
        int id = anchorId;
        StopFollowing();
        if (id != 0) SendAnchor(id, "closed");
    }

    private static void ObserveAnchor(IntPtr hook, uint kind, IntPtr window, int objectId, int childId, uint thread, uint time) {
        if (anchorId == 0 || window != anchorWindow ||
            (hook != anchorObjectHook && hook != anchorStateHook)) return;
        // OBJID_WINDOW / CHILDID_SELF only; never follow controls inside the app.
        if (kind >= 0x8000 && (objectId != 0 || childId != 0)) return;
        if (kind != 0x8001 && kind != 0x8002 && kind != 0x8003 &&
            kind != 0x800A && kind != 0x800B && kind != 0x0016 && kind != 0x0017) return;
        if (kind == 0x8001) anchorDestroyed = true;
        if (anchorUpdatePending) return;
        anchorUpdatePending = true;
        int generation = anchorGeneration;
        try {
            anchorLifetime.BeginInvoke((Action)(() => {
                if (generation != anchorGeneration || anchorId == 0) return;
                anchorUpdatePending = false;
                // One queued update reads the latest rect after a burst. There is
                // no WM_TIMER debounce to halve an otherwise 60 Hz move stream.
                PollAnchor();
            }));
        } catch (InvalidOperationException) { CloseAnchor(); }
    }

    private static void FollowWindow(int id, IntPtr window, uint process, long ticks) {
        StopFollowing();
        if (id <= 0) return;
        if (window == IntPtr.Zero || process == 0 || ticks <= 0) { SendAnchor(id, "closed"); return; }
        uint actual;
        uint thread = GetWindowThreadProcessId(window, out actual);
        if (!IsWindow(window) || (actual != 0 && actual != process)) { SendAnchor(id, "closed"); return; }
        anchorWindow = window;
        anchorProcess = process;
        anchorThread = thread;
        anchorStartedAt = ticks;
        anchorId = id;
        // Missing cross-process hooks must not masquerade as a closed window.
        // The identity-checked timer remains a fallback for restricted targets.
        anchorObjectHook = SetWinEventHook(0x8001, 0x800B, IntPtr.Zero, AnchorEvent, process, thread, 0);
        anchorStateHook = SetWinEventHook(0x0016, 0x0017, IntPtr.Zero, AnchorEvent, process, thread, 0);
        PollAnchor();
        if (anchorId != 0 && anchorTimer != null) anchorTimer.Start();
    }

    private static void SendAnchor(int id, string state) {
        try { Console.WriteLine(String.Format(CultureInfo.InvariantCulture, "anchor {0} {1}", id, state)); }
        catch (IOException) {}
    }

    private static void PollAnchor() {
        if (anchorId == 0) return;
        AnchorIdentity identity = ReadAnchorIdentity();
        bool visible = false, iconic = false, geometry = false;
        Rect rect = new Rect();
        if (identity == AnchorIdentity.Verified) {
            visible = IsWindowVisible(anchorWindow);
            iconic = IsIconic(anchorWindow);
        }
        if (identity == AnchorIdentity.Verified && visible && !iconic) {
            IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
            try {
                Rect dwm, outer = new Rect();
                bool dwmReady = DwmGetWindowAttribute(anchorWindow, 9, out dwm, Marshal.SizeOf(typeof(Rect))) == 0;
                bool outerReady = (!dwmReady || !UsableAnchorRect(dwm)) && GetWindowRect(anchorWindow, out outer);
                geometry = ChooseAnchorRect(dwmReady, dwm, outerReady, outer, out rect);
            } finally { if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous); }
        }
        ApplyAnchorObservation(identity, visible, iconic, geometry, rect, Stopwatch.GetTimestamp() * 1000 / Stopwatch.Frequency);
    }

    private static AnchorIdentity ProcessOpenFailure(int error) {
        // Access denied is not evidence that the verified owner has exited.
        return error == 87 ? AnchorIdentity.Closed : AnchorIdentity.Unavailable;
    }

    private static AnchorIdentity ReadAnchorIdentity() {
        if (anchorDestroyed || !IsWindow(anchorWindow)) return AnchorIdentity.Closed;
        uint actual;
        uint thread = GetWindowThreadProcessId(anchorWindow, out actual);
        if ((actual != 0 && actual != anchorProcess) || (thread != 0 && anchorThread != 0 && thread != anchorThread)) return AnchorIdentity.Closed;
        if (actual == 0 || thread == 0) return AnchorIdentity.Unavailable;
        // .NET Process.HasExited/StartTime can request more rights than a
        // non-elevated tracker needs. Never elevate; query only public identity.
        IntPtr process = OpenProcess(0x1000, false, actual); // PROCESS_QUERY_LIMITED_INFORMATION
        if (process == IntPtr.Zero) return ProcessOpenFailure(Marshal.GetLastWin32Error());
        try {
            FileTime created, exited, kernel, user;
            uint code;
            if (!GetProcessTimes(process, out created, out exited, out kernel, out user) || !GetExitCodeProcess(process, out code)) return AnchorIdentity.Unavailable;
            long ticks;
            try { ticks = DateTime.FromFileTimeUtc(((long)created.High << 32) | created.Low).Ticks; }
            catch (ArgumentOutOfRangeException) { return AnchorIdentity.Unavailable; }
            if (ticks != anchorStartedAt || code != 259) return AnchorIdentity.Closed;
            if (anchorThread == 0) anchorThread = thread;
            return AnchorIdentity.Verified;
        } finally { CloseHandle(process); }
    }

    private static bool UsableAnchorRect(Rect rect) { return rect.Right > rect.Left && rect.Bottom > rect.Top; }

    private static bool ChooseAnchorRect(bool dwmReady, Rect dwm, bool outerReady, Rect outer, out Rect rect) {
        if (dwmReady && UsableAnchorRect(dwm)) { rect = dwm; return true; }
        if (outerReady && UsableAnchorRect(outer)) { rect = outer; return true; }
        rect = new Rect();
        return false;
    }

    private static void ApplyAnchorObservation(AnchorIdentity identity, bool visible, bool iconic, bool geometry, Rect rect, long now) {
        if (anchorId == 0) return;
        if (identity == AnchorIdentity.Closed) { CloseAnchor(); return; }
        if (identity != AnchorIdentity.Verified || (visible && !iconic && !geometry)) {
            if (anchorUnavailableAt < 0) anchorUnavailableAt = now;
            long unavailable = now - anchorUnavailableAt;
            if (unavailable >= AnchorUnavailableTimeoutMs) { CloseAnchor(); return; }
            if (lastAnchor == null || unavailable >= AnchorHoldMs) PublishAnchor("hidden");
            return;
        }
        anchorUnavailableAt = -1;
        string state = visible && !iconic
            ? String.Format(CultureInfo.InvariantCulture, "visible {0} {1} {2} {3}", rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top)
            : "hidden";
        PublishAnchor(state);
    }

    private static void PublishAnchor(string state) {
        if (state == lastAnchor) return;
        lastAnchor = state;
        SendAnchor(anchorId, state);
    }

    private static void ReadParent(Control lifetime) {
        try {
            string line;
            while ((line = Console.ReadLine()) != null) {
                string[] command = line.Split(' ');
                long handle;
                int id;
                uint process;
                long ticks;
                if (command.Length == 5 && command[0] == "follow" && int.TryParse(command[1], out id) && long.TryParse(command[2], out handle) && uint.TryParse(command[3], out process) && long.TryParse(command[4], out ticks)) {
                    int nextId = id;
                    IntPtr nextHandle = new IntPtr(handle);
                    uint nextProcess = process;
                    long nextTicks = ticks;
                    lifetime.BeginInvoke((Action)(() => FollowWindow(nextId, nextHandle, nextProcess, nextTicks)));
                    continue;
                }
                if (command.Length != 2 || !long.TryParse(command[0], out handle) || !int.TryParse(command[1], out id)) continue;
                lock (State) {
                    releaseWindow = new IntPtr(handle);
                    releaseId = id;
                    trackRelease = false;
                }
            }
        } catch (IOException) {}
        catch (InvalidOperationException) {}
        finally { Exit(lifetime); }
    }

    private static void Exit(Control lifetime) {
        try { lifetime.BeginInvoke((Action)Application.ExitThread); }
        catch (InvalidOperationException) {} // Another lifetime signal already closed the control.
    }

    [STAThread]
    private static int Main(string[] args) {
        if (args.Length != 2 || !Regex.IsMatch(args[1], @"\A[0-9a-f]{32}\z")) return 1;
        string pipeName = "Capri.DesktopTeleport." + args[1];
        if (args[0] == "--watch") return Watch(pipeName);
        if (args[0] != "--teleport") return 1;
        try {
            using (var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.Out)) {
                pipe.Connect(750);
            }
        } catch (TimeoutException) {} catch (IOException) {} catch (UnauthorizedAccessException) {}
        return 0;
    }
}
