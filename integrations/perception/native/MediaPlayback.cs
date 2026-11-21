// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using Windows.Foundation;
using Windows.Media;
using Windows.Media.Control;

internal static class MediaPlayback {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern int GetApplicationUserModelId(IntPtr process, ref uint length, StringBuilder value);
    [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr window, ref Guid iid, out IPropertyStore store);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropertyValue value);

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropertyValue value);
    }
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    struct PropertyKey { public Guid FormatId; public uint Id; }
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    struct PropertyValue {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(8)] public IntPtr StringValue;
    }

    sealed class App {
        public readonly string Owner;
        public readonly string[] Captions;
        public readonly string[] MediaIds;
        public readonly bool Browser;
        public App(string owner, bool browser, string[] captions, params string[] ids) {
            Owner = owner; Browser = browser; Captions = captions; MediaIds = ids;
        }
    }

    static readonly StringComparer IgnoreCase = StringComparer.OrdinalIgnoreCase;
    static readonly Dictionary<string, App> Apps = new Dictionary<string, App>(IgnoreCase) {
        { "chrome", new App("Google", true, new[] { " - Google Chrome" }, "Chrome") },
        { "msedge", new App("Microsoft", true, new[] { " - Microsoft Edge" }, "MSEdge", "Microsoft.MicrosoftEdge.Stable_8wekyb3d8bbwe!MSEDGE") },
        { "firefox", new App("Mozilla", true, new[] { " — Mozilla Firefox", " - Mozilla Firefox" }, "Mozilla.Firefox", "Firefox") },
        { "brave", new App("Brave", true, new[] { " - Brave" }, "Brave", "Brave.Browser") },
        { "opera", new App("Opera", true, new[] { " - Opera", " - Opera GX" }, "Opera", "Opera GX") },
        { "vivaldi", new App("Vivaldi", true, new[] { " - Vivaldi" }, "Vivaldi") },
        { "vlc", new App("VideoLAN", false, new[] { " - VLC media player" }, "VLC media player", "VideoLAN.VLC") },
    };
    static readonly Regex Controls = new Regex(@"[\p{Cc}\p{Cf}]", RegexOptions.CultureInvariant);
    static readonly Regex Spacing = new Regex(@"\s+", RegexOptions.CultureInvariant);
    static readonly Regex Links = new Regex(@"\b(?:https?://|file:|data:|blob:|www\.)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    static readonly TimeSpan MaxTimeline = TimeSpan.FromDays(7);

    sealed class WindowSample {
        public uint Pid;
        public DateTime Started;
        public string Caption, Image, WindowAumid, ProcessAumid;
        public App KnownApp;
    }

    static string WindowAppId(IntPtr window) {
        IPropertyStore store = null;
        var iid = typeof(IPropertyStore).GUID;
        try {
            if (SHGetPropertyStoreForWindow(window, ref iid, out store) != 0 || store == null) return null;
            var key = new PropertyKey { FormatId = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), Id = 5 };
            PropertyValue value;
            if (store.GetValue(ref key, out value) != 0) return null;
            try {
                return value.Type == 31 && value.StringValue != IntPtr.Zero ? Marshal.PtrToStringUni(value.StringValue) : null;
            } finally { PropVariantClear(ref value); }
        } catch { return null; }
        finally { if (store != null) Marshal.ReleaseComObject(store); }
    }

    static string ProcessAppId(Process process) {
        try {
            uint size = 512;
            var value = new StringBuilder((int)size);
            return GetApplicationUserModelId(process.Handle, ref size, value) == 0 ? value.ToString() : null;
        } catch { return null; }
    }

    static WindowSample ReadWindow(IntPtr window, bool includeApp) {
        uint pid;
        if (GetForegroundWindow() != window || !IsWindowVisible(window) || IsIconic(window) ||
            GetWindowThreadProcessId(window, out pid) == 0 || pid == 0) return null;
        var caption = new StringBuilder(512);
        var size = GetWindowText(window, caption, caption.Capacity);
        if (size <= 0 || size == caption.Capacity - 1) return null;
        using (var process = Process.GetProcessById((int)pid)) {
            var sample = new WindowSample { Pid = pid, Started = process.StartTime.ToUniversalTime(), Caption = caption.ToString() };
            if (includeApp) {
                var executable = process.MainModule;
                sample.Image = executable.FileName;
                sample.ProcessAumid = ProcessAppId(process);
                sample.WindowAumid = WindowAppId(window);
                App app;
                string company = executable.FileVersionInfo.CompanyName;
                if (Apps.TryGetValue(process.ProcessName, out app) && company != null &&
                    company.IndexOf(app.Owner, StringComparison.OrdinalIgnoreCase) >= 0)
                    sample.KnownApp = app;
            }
            return sample;
        }
    }

    static bool SameWindow(WindowSample before, WindowSample after) {
        return after != null && before.Pid == after.Pid && before.Started == after.Started && before.Caption == after.Caption;
    }

    static bool SameId(string source, string known) {
        return !String.IsNullOrEmpty(known) && IgnoreCase.Equals(source, known);
    }

    static bool MatchingApp(WindowSample window, string source) {
        if (String.IsNullOrEmpty(source) || source.Length > 512) return false;
        if (SameId(source, window.WindowAumid) || SameId(source, window.ProcessAumid) || SameId(source, window.Image)) return true;
        if (window.KnownApp == null) return false;
        foreach (var id in window.KnownApp.MediaIds)
            if (SameId(source, id)) return true;
        return false;
    }

    static string WithoutSuffix(string value, string suffix) {
        return value.EndsWith(suffix, StringComparison.OrdinalIgnoreCase) ? value.Substring(0, value.Length - suffix.Length).TrimEnd() : value;
    }

    static string Normalize(string value) {
        return Spacing.Replace(Controls.Replace(value.Normalize(NormalizationForm.FormKC), " "), " ").Trim();
    }

    static string PlayerTitle(WindowSample window, out bool youtube) {
        var title = Normalize(window.Caption);
        var app = window.KnownApp;
        if (app != null) {
            foreach (var suffix in app.Captions) {
                var trimmed = WithoutSuffix(title, suffix);
                if (trimmed.Length == title.Length) continue;
                title = trimmed;
                break;
            }
        }
        var videoTitle = WithoutSuffix(title, " - YouTube");
        youtube = app != null && app.Browser && videoTitle.Length < title.Length && videoTitle.Length > 0;
        return youtube ? videoTitle : title;
    }

    static T Wait<T>(IAsyncOperation<T> operation, Stopwatch clock) {
        while (operation.Status == AsyncStatus.Started && clock.ElapsedMilliseconds < 900) Thread.Sleep(12);
        if (operation.Status == AsyncStatus.Completed) return operation.GetResults();
        operation.Cancel();
        throw new TimeoutException();
    }

    static object Read(IntPtr window, DateTimeOffset capturedAt) {
        var clock = Stopwatch.StartNew();
        var before = ReadWindow(window, true);
        if (before == null || before.Started > capturedAt.UtcDateTime) return null;
        bool youtube;
        var expected = PlayerTitle(before, out youtube);
        if (expected.Length == 0 || expected.Length > 180 || Links.IsMatch(expected)) return null;
        var manager = Wait(GlobalSystemMediaTransportControlsSessionManager.RequestAsync(), clock);
        GlobalSystemMediaTransportControlsSession session = null;
        string title = null;
        int checkedSources = 0;
        foreach (var candidate in manager.GetSessions()) {
            if (clock.ElapsedMilliseconds >= 900) return null;
            if (!MatchingApp(before, candidate.SourceAppUserModelId)) continue;
            if (++checkedSources > 6) return null;
            var playback = candidate.GetPlaybackInfo();
            if (!IsVideo(playback, youtube)) continue;
            var media = Wait(candidate.TryGetMediaPropertiesAsync(), clock);
            var value = media == null ? null : media.Title;
            if (String.IsNullOrWhiteSpace(value) || !IgnoreCase.Equals(Normalize(value), expected)) continue;
            if (session != null) return null;
            session = candidate;
            title = Normalize(value);
        }
        if (session == null || clock.ElapsedMilliseconds >= 900) return null;
        var firstInfo = session.GetPlaybackInfo();
        GlobalSystemMediaTransportControlsSessionTimelineProperties timeline = null;
        try { timeline = session.GetTimelineProperties(); }
        catch (COMException) { }
        var currentMedia = Wait(session.TryGetMediaPropertiesAsync(), clock);
        var lastInfo = session.GetPlaybackInfo();
        if (!IsVideo(lastInfo, youtube) || currentMedia == null || currentMedia.Title == null ||
            !IgnoreCase.Equals(title, Normalize(currentMedia.Title))) return null;
        long? position = null, duration = null;
        if (timeline != null && firstInfo.PlaybackStatus == lastInfo.PlaybackStatus && firstInfo.PlaybackRate == lastInfo.PlaybackRate) {
            try {
                var latest = session.GetTimelineProperties();
                if (latest != null && latest.LastUpdatedTime == timeline.LastUpdatedTime && latest.Position == timeline.Position &&
                    latest.StartTime == timeline.StartTime && latest.EndTime == timeline.EndTime)
                    Timeline(timeline, lastInfo, capturedAt, out position, out duration);
            } catch (COMException) { }
        }
        if (clock.ElapsedMilliseconds >= 900 || !SameWindow(before, ReadWindow(window, false))) return null;
        return new { title = title, positionMs = position, durationMs = duration };
    }

    static bool IsVideo(GlobalSystemMediaTransportControlsSessionPlaybackInfo info, bool youtube) {
        if (info == null || info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Closed) return false;
        return info.PlaybackType == MediaPlaybackType.Video || (youtube && !info.PlaybackType.HasValue);
    }

    static void Timeline(GlobalSystemMediaTransportControlsSessionTimelineProperties timeline,
        GlobalSystemMediaTransportControlsSessionPlaybackInfo info, DateTimeOffset at, out long? position, out long? duration) {
        position = null;
        duration = null;
        var age = at - timeline.LastUpdatedTime;
        var runTime = timeline.EndTime - timeline.StartTime;
        var offset = timeline.Position - timeline.StartTime;
        if (age < TimeSpan.Zero || age > TimeSpan.FromSeconds(30) || runTime <= TimeSpan.Zero ||
            runTime > MaxTimeline || offset < TimeSpan.Zero || offset > runTime) return;
        duration = (long)Math.Round(runTime.TotalMilliseconds);
        var current = offset.TotalMilliseconds;
        if (info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing) {
            var rate = info.PlaybackRate;
            if (!rate.HasValue || Double.IsNaN(rate.Value) || rate.Value <= 0 || rate.Value > 16) return;
            current += age.TotalMilliseconds * rate.Value;
        } else if (info.PlaybackStatus != GlobalSystemMediaTransportControlsSessionPlaybackStatus.Paused) return;
        if (current <= runTime.TotalMilliseconds) position = (long)Math.Round(current);
    }

    [MTAThread]
    static void Main(string[] args) {
        object receipt = null;
        try {
            const long UnixEpochTicks = 621355968000000000L;
            uint raw;
            long capturedAt;
            if (args.Length == 2 && UInt32.TryParse(args[0], NumberStyles.None, CultureInfo.InvariantCulture, out raw) && raw != 0 &&
                Int64.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out capturedAt) &&
                capturedAt >= 0 && capturedAt <= 253402300799999L) {
                var at = new DateTimeOffset(UnixEpochTicks + capturedAt * TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
                var age = DateTimeOffset.UtcNow - at;
                if (age >= TimeSpan.Zero && age <= TimeSpan.FromMilliseconds(4500)) receipt = Read(new IntPtr(raw), at);
            }
        } catch { }
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.WriteLine(receipt == null ? "null" : new JavaScriptSerializer().Serialize(receipt));
    }
}
